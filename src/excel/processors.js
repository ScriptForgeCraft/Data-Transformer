// processors.js
import {
    normalizeText,
    parseNumericCell,
    looksLikeArea,
    looksLikePrice,
    findAreaInRow,
    findPriceAndCurrencyInRow,
    detectCurrency,
    extractFallbackValues
} from "./utils.js";
import { determineColumnMappingAsync } from "./layout.js";
import { postValidateFlat } from "./validation.js";

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED EXTRACTOR: Extracts data from a single row according to column layout
// Used by both header and headerless processors to avoid code duplication
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parses a single Excel row array into a structured Flat object based on the mapped headers.
 * Implements complex heuristics to calculate missing fields (like total price from sqm)
 * and safely locate drifting IDs/prices from unassigned columns.
 * 
 * @param {Array} row - Raw row data
 * @param {Object} headers - Mapped column indices (e.g., { id: 0, area: 1, price_total: 2 })
 * @param {string} buildingName - Identified building name for the block
 * @param {string} sheetName - Source sheet name
 * @param {number|string|null} lastFloor - Extracted floor from this or recent rows
 * @param {number} startCol - Start boundary for column iteration
 * @param {number} endCol - End boundary for column iteration
 * @returns {Object} Structured extracting data for a single flat
 */
function extractFlatFromRow(row, headers, buildingName, sheetName, lastFloor, startCol = 0, endCol = row.length - 1) {
    // ── Area ────────────────────────────────────────────────────────────────
    let area = null;
    if (headers.new_area !== undefined && row[headers.new_area] != null) {
        area = parseNumericCell(row[headers.new_area]);
    }
    if (area === null && headers.area !== undefined && row[headers.area] != null) {
        area = parseNumericCell(row[headers.area]);
    }
    if (area === null) area = findAreaInRow(row, Object.values(headers), startCol, endCol);

    const area_orig = headers.area !== undefined
        ? parseNumericCell(row[headers.area])
        : null;

    // ── Price ───────────────────────────────────────────────────────────────
    let price = null;
    let currency = null;

    if (headers.price_total !== undefined && row[headers.price_total] != null) {
        const cellVal = row[headers.price_total];
        price = parseNumericCell(cellVal);
        currency = detectCurrency(String(cellVal || ""));
    }

    if (price === null) {
        const pInfo = findPriceAndCurrencyInRow(row, Object.values(headers), startCol, endCol);
        if (pInfo) {
            price = pInfo.value;
            currency = pInfo.currency;
        }
    }

    let price_sqm = headers.price_sqm !== undefined
        ? parseNumericCell(row[headers.price_sqm])
        : null;

    if (price_sqm !== null && !currency && headers.price_sqm !== undefined) {
        const cellVal = row[headers.price_sqm];
        currency = detectCurrency(String(cellVal || ""));
    }

    // Fallback: Analyze unused cells for orphaned price values
    const fb = extractFallbackValues(row, Object.values(headers), area, price, price_sqm, currency, startCol, endCol);
    price = fb.price;
    price_sqm = fb.price_sqm;
    if (fb.currency && !currency) currency = fb.currency;

    // ── ID ──────────────────────────────────────────────────────────────────
    const idRaw = headers.id !== undefined ? String(row[headers.id] ?? "").trim() : "";
    // Numbers with dots are probably areas, not IDs (e.g. 47.5 or 101.2)
    const idIsFloat = /^\d+[.\u0589\u2024\u00b7]\d+$/.test(idRaw);
    let id = idRaw && /\d/.test(idRaw) && !idIsFloat ? idRaw : null;

    // If ID is not found in the mapped column — search remaining cells AFTER extracting price and area
    if (!id) {
        const skipCols = new Set(Object.values(headers));
        for (let c = startCol; c <= Math.min(endCol, row.length - 1); c++) {
            if (skipCols.has(c)) continue;
            const cellValRaw = row[c];
            const cell = String(cellValRaw || "").trim();
            const num = parseNumericCell(cellValRaw);
            const cellIsFloat = /^\d+[.\u0589\u2024\u00b7]\d+$/.test(cell);
            const isFloorText = /^\d+\s*[-‐֊]?(ին|րդ|th|st|nd|rd|ый|ой|ий|ая|яя|ье)$/i.test(cell) || /հարկ|этаж|floor/i.test(cell);

            // If this value is already consumed by price or area, skip it
            if (num !== null && (num === area || num === price || num === price_sqm)) continue;

            if (
                cell &&
                /\d/.test(cell) &&
                cell.length <= 15 &&
                !cellIsFloat &&
                !isFloorText &&
                (!num || (!looksLikeArea(num) && !looksLikePrice(num)))
            ) {
                id = cell;
                break; // Found the best candidate for ID
            }
        }
    }

    // ── Rooms / Status ──────────────────────────────────────────────────────
    const rooms = headers.rooms !== undefined
        ? parseNumericCell(row[headers.rooms])
        : null;
    const status = headers.status !== undefined
        ? normalizeText(row[headers.status])
        : null;

    // ── Mutual Price Calculation ────────────────────────────────────────────
    if (area && area > 0) {
        if (price !== null && price_sqm === null) {
            price_sqm = Math.round(price / area);
        } else if (price_sqm !== null && price === null) {
            price = Math.round(price_sqm * area);
        } else if (price !== null && price_sqm !== null) {
            // Check consistency (5% tolerance) between total price and sqm price
            const expectedSqm = price / area;
            const errorMargin = Math.abs(expectedSqm - price_sqm) / price_sqm;
            if (errorMargin > 0.05) {
                price_sqm = Math.round(price / area); // Override anomalous sqm mappings
            }
        }
    }

    return { id, area, area_orig, price, price_sqm, rooms, status, floor: lastFloor, currency };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sheet Processor: Block with Header Row Found
// ═══════════════════════════════════════════════════════════════════════════════
export function processHeaderBlock(data, blockInfo, fallbackBuildingName, sheetName, allFlats) {
    const { rowIndex, headers, startCol, endCol } = blockInfo;
    let lastFloor = null;

    let buildingName = fallbackBuildingName;
    for (let r = rowIndex - 1; r >= Math.max(0, rowIndex - 3); r--) {
        const titleRow = data[r];
        if (!titleRow) continue;
        for (let c = startCol; c <= endCol; c++) {
            if (titleRow[c] && typeof titleRow[c] === 'string' && titleRow[c].trim().length > 3) {
                const t = titleRow[c].trim();
                // Avoid using generic terms like "total" as building name
                if (!t.toLowerCase().includes("ընդամենը") && !t.toLowerCase().includes("total")) {
                    buildingName = t;
                    break;
                }
            }
        }
        if (buildingName !== fallbackBuildingName) break;
    }

    for (let i = rowIndex + 1; i < data.length; i++) {
        const row = data[i];
        if (!row || row.every(cell => cell === null || cell === "")) continue;

        // Update the current floor if a number is found in the floor column
        if (headers.floor !== undefined) {
            const floorCell = row[headers.floor];
            if (floorCell !== null && floorCell !== undefined && floorCell !== "") {
                const floorStr = String(floorCell).trim();
                const floorMatch = floorStr.match(/^(-?\d+)/);
                if (floorMatch) lastFloor = parseInt(floorMatch[1]);
                else lastFloor = floorStr;
            }
        }

        const extracted = extractFlatFromRow(row, headers, buildingName, sheetName, lastFloor, startCol, endCol);
        if (!extracted.id && !extracted.area && !extracted.price) continue;

        const rawFlat = {
            building: buildingName,
            sheet: sheetName,
            floor: extracted.floor,
            id: extracted.id || null,
            rooms: extracted.rooms,
            price: extracted.price,
            price_sqm: extracted.price_sqm,
            price_sqm_sale: extracted.price_sqm_sale ?? null,
            price_total_sale: extracted.price_total_sale ?? null,
            area: extracted.area,
            area_orig: extracted.area_orig,
            status: extracted.status,
            currency: extracted.currency
        };

        const validatedFlat = postValidateFlat(rawFlat);
        if (!validatedFlat.id && !validatedFlat.area && !validatedFlat.price) continue;
        allFlats.push(validatedFlat);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sheet Processor: AI + Heuristics for Headerless Sheets
// ═══════════════════════════════════════════════════════════════════════════════
export function processNoHeaderSheet(data, buildingName, sheetName, allFlats) {
    // Find the first row containing actual data (at least 3 non-empty cells)
    let dataStart = 0;
    for (let i = 0; i < Math.min(5, data.length); i++) {
        const row = data[i];
        if (row && row.filter(c => c !== null && c !== "").length >= 3) {
            dataStart = i;
            break;
        }
    }

    const sampleRows = data
        .slice(dataStart, dataStart + 20)
        .filter(r => r && r.some(c => c !== null));
    if (!sampleRows.length) return;

    const colCount = Math.max(...sampleRows.map(r => r.length));

    // Determine mapping via AI + heuristics (empty headers array indicates no headers)
    const headers = determineColumnMappingAsync(new Array(colCount).fill(""), sampleRows);
    if (Object.keys(headers).length < 2) return;

    let lastFloor = null;

    for (let i = dataStart; i < data.length; i++) {
        const row = data[i];
        if (!row || row.every(cell => cell === null || cell === "")) continue;

        // Track floating floor numbers
        if (headers.floor !== undefined) {
            const floorCell = row[headers.floor];
            if (floorCell !== null && floorCell !== undefined && floorCell !== "") {
                const floorMatch = String(floorCell).trim().match(/^(-?\d+)/);
                if (floorMatch) lastFloor = parseInt(floorMatch[1]);
            }
        }

        const extracted = extractFlatFromRow(row, headers, buildingName, sheetName, lastFloor);
        if (!extracted.id && !extracted.area && !extracted.price) continue;

        const rawFlat = {
            building: buildingName,
            sheet: sheetName,
            floor: extracted.floor,
            id: extracted.id || null,
            rooms: extracted.rooms,
            price: extracted.price,
            price_sqm: extracted.price_sqm,
            price_sqm_sale: extracted.price_sqm_sale ?? null,
            price_total_sale: extracted.price_total_sale ?? null,
            area: extracted.area,
            area_orig: extracted.area_orig,
            status: extracted.status,
            currency: extracted.currency
        };

        const validatedFlat = postValidateFlat(rawFlat);
        if (!validatedFlat.id && !validatedFlat.area && !validatedFlat.price) continue;
        allFlats.push(validatedFlat);
    }
}
