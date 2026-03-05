import * as XLSX from "xlsx";
import { flatIdPattern, PRICE_MIN_THRESHOLD } from "./constants.js";
import { parseNumericCell } from "./utils.js";
import { isAlternatingLayout, hasHeaderRow } from "./layout.js";
import { processHeaderBlock, processNoHeaderSheet } from "./processors.js";
import { postValidateFlat, mergeAdjacentFlats } from "./validation.js";

/**
 * Parse an Excel file (File object) and return array of apartment objects.
 * Browser-compatible version (no AI, heuristic only).
 */
export async function parseExcelFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    const workbook = XLSX.read(data, { type: "array" });

    const allFlats = [];

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const sheetData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

        if (!sheetData.length) continue;

        const buildingName = sheetName;

        const alternatingHeaderRow = isAlternatingLayout(sheetData);
        const headerBlocks = hasHeaderRow(sheetData);

        if (alternatingHeaderRow !== null) {
            let i = alternatingHeaderRow + 1;
            while (i < sheetData.length) {
                const dataRow = sheetData[i];
                const priceRow = sheetData[i + 1];
                if (!dataRow || !priceRow) break;

                const floor = typeof dataRow[0] === "number" ? dataRow[0] : null;
                if (floor === null) { i += 2; continue; }

                for (let col = 1; col + 1 < dataRow.length; col += 2) {
                    const id = dataRow[col];
                    const area = dataRow[col + 1];
                    const priceRaw = priceRow ? parseNumericCell(priceRow[col + 1]) : null;

                    if (id === null && area === null) continue;

                    let price = null;
                    let price_sqm = null;
                    if (priceRaw !== null) {
                        if (priceRaw >= PRICE_MIN_THRESHOLD) {
                            price = priceRaw;
                        } else {
                            price_sqm = priceRaw;
                        }
                    }

                    const areaVal = typeof area === "number" ? area : parseNumericCell(area);

                    if (areaVal && areaVal > 0) {
                        if (price !== null && price_sqm === null) {
                            price_sqm = Math.round(price / areaVal);
                        } else if (price_sqm !== null && price === null) {
                            price = Math.round(price_sqm * areaVal);
                        }
                    }

                    const rawFlat = {
                        building: buildingName,
                        sheet: sheetName,
                        floor,
                        id: id !== null ? String(id) : null,
                        rooms: null,
                        price,
                        price_sqm,
                        area: areaVal,
                        area_orig: areaVal,
                        status: null
                    };
                    const validatedFlat = postValidateFlat(rawFlat);
                    if (!validatedFlat.id && !validatedFlat.area && !validatedFlat.price) continue;
                    allFlats.push(validatedFlat);
                }
                i += 2;
            }

        } else if (headerBlocks) {
            for (const block of headerBlocks) {
                processHeaderBlock(sheetData, block, buildingName, sheetName, allFlats);
            }

        } else {
            let foundFlatIds = false;
            const buildingNameFallback = typeof sheetData[0]?.[0] === "string"
                ? sheetData[0][0].trim()
                : sheetName;

            for (let i = 0; i < sheetData.length; i++) {
                const row = sheetData[i];
                if (!row) continue;

                const hasFlatIds = row.some(
                    cell => typeof cell === "string" && flatIdPattern.test(cell.trim())
                );

                if (hasFlatIds) {
                    foundFlatIds = true;
                    const idsRow = row;
                    const pricesRow = sheetData[i + 1] || [];
                    const areasRow = sheetData[i + 2] || [];

                    const floor = typeof pricesRow[0] === "number" ? pricesRow[0] : null;

                    for (let col = 0; col < idsRow.length; col++) {
                        const id = idsRow[col];
                        if (typeof id === "string" && flatIdPattern.test(id.trim())) {
                            const price = typeof pricesRow[col] === "number" ? pricesRow[col] : null;
                            const area = typeof areasRow[col] === "number" ? areasRow[col] : null;

                            allFlats.push({
                                building: buildingNameFallback,
                                sheet: sheetName,
                                floor,
                                id: id.trim(),
                                rooms: null,
                                price,
                                price_sqm: null,
                                area,
                                area_orig: null,
                                status: null
                            });
                        }
                    }
                }
            }

            if (!foundFlatIds) {
                processNoHeaderSheet(sheetData, buildingNameFallback, sheetName, allFlats);
            }
        }
    }

    const finalFlats = mergeAdjacentFlats(allFlats);
    finalFlats.forEach((flat) => {
        flat.source_file = file.name;
    });
    return finalFlats;
}
