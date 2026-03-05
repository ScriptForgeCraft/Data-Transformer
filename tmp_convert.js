// Script to convert project-folder CJS modules to src/excel ESM modules
// and create all new files for the unified pipeline
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PF = path.join(ROOT, "project-folder");
const SRC = path.join(ROOT, "src");

// Ensure directories exist
[
    path.join(SRC, "excel"),
    path.join(SRC, "parsers"),
    path.join(SRC, "services"),
].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ── 1. Convert CJS files to ESM ─────────────────────────────────────────────
function cjsToEsm(content, filename) {
    let result = content;

    // Remove dotenv
    result = result.replace(/require\("dotenv"\)\.config\(\);?\s*\n?/g, "");

    // Extract module.exports names
    const exportsMatch = result.match(/module\.exports\s*=\s*\{([^}]+)\}/s);
    const exportedNames = [];
    if (exportsMatch) {
        exportsMatch[1].split(",").forEach(n => {
            const trimmed = n.trim();
            if (trimmed) exportedNames.push(trimmed);
        });
    }
    // Remove module.exports block
    result = result.replace(/\n*module\.exports\s*=\s*\{[\s\S]*?\};\s*$/m, "\n");

    // Convert require() to import
    // Pattern: const { X, Y } = require("./module");
    result = result.replace(
        /(?:const|let|var)\s+(\{[^}]+\})\s*=\s*require\(["']([^"']+)["']\);?/g,
        (match, bindings, mod) => {
            return `import ${bindings} from "${mod}";`;
        }
    );
    // Pattern: const X = require("module");
    result = result.replace(
        /(?:const|let|var)\s+(\w+)\s*=\s*require\(["']([^"']+)["']\);?/g,
        (match, name, mod) => {
            return `import ${name} from "${mod}";`;
        }
    );

    // Add export to declarations of exported names
    for (const name of exportedNames) {
        // async function name(
        result = result.replace(
            new RegExp(`(^|\\n)(async\\s+function\\s+${name}\\b)`, "m"),
            "$1export $2"
        );
        // function name(
        result = result.replace(
            new RegExp(`(^|\\n)(function\\s+${name}\\b)`, "m"),
            "$1export $2"
        );
        // const name =
        result = result.replace(
            new RegExp(`(^|\\n)(const\\s+${name}\\s*=)`, "m"),
            "$1export $2"
        );
    }

    return result.trim() + "\n";
}

// Files to convert
const filesToConvert = ["constants.js", "utils.js", "layout.js", "processors.js", "validation.js"];

for (const file of filesToConvert) {
    const srcPath = path.join(PF, file);
    let content = fs.readFileSync(srcPath, "utf8");

    // Special handling for layout.js - remove AI dependency
    if (file === "layout.js") {
        // Remove aiHelper import
        content = content.replace(
            /(?:const|let|var)\s+\{[^}]*\}\s*=\s*require\(["']\.\/aiHelper["']\);?\s*\n?/g,
            ""
        );
        // Replace determineColumnMappingAsync to not use AI
        // The function calls getAILayoutMapping + validateAIMapping, we replace with just heuristic
        content = content.replace(
            /async function determineColumnMappingAsync\(headers, dataRows\)\s*\{[\s\S]*?return finalMap;\s*\n\s*\}/m,
            `function determineColumnMappingAsync(headers, dataRows) {
    // Browser version: heuristic only (no AI)
    const heuristicMap = mapHeaderColumns(headers, dataRows);
    return heuristicMap;
}`
        );
        // Also make hasHeaderRow sync since determineColumnMappingAsync is now sync
        content = content.replace(/async function hasHeaderRow/g, "function hasHeaderRow");
        content = content.replace(/const headerBlocks = await hasHeaderRow/g, "const headerBlocks = hasHeaderRow");
        content = content.replace(/const headers = await determineColumnMappingAsync/g, "const headers = determineColumnMappingAsync");
    }

    // Special handling for processors.js - make functions sync since layout is now sync
    if (file === "processors.js") {
        content = content.replace(/async function processHeaderBlock/g, "function processHeaderBlock");
        content = content.replace(/async function processNoHeaderSheet/g, "function processNoHeaderSheet");
        content = content.replace(/await processHeaderBlock/g, "processHeaderBlock");
        content = content.replace(/await processNoHeaderSheet/g, "processNoHeaderSheet");
        content = content.replace(/const headers = await determineColumnMappingAsync/g, "const headers = determineColumnMappingAsync");
    }

    const esmContent = cjsToEsm(content, file);
    const dstPath = path.join(SRC, "excel", file);
    fs.writeFileSync(dstPath, esmContent, "utf8");
    console.log(`[OK] ${file} -> src/excel/${file} (${esmContent.length} chars)`);
}

// ── 2. Create Word Parser ────────────────────────────────────────────────────
const wordParser = `import mammoth from "mammoth";

function splitMergedLines(line) {
    const results = [];
    const segmentPattern = /(?<=\\S)\\s+(?=[^\\s\\d,.()\\[\\]{}'"-\u2013\u2014][^-\u2013\u2014\\n]{1,}(?:\\s[-\u2013\u2014]|[-\u2013\u2014]\\s))/g;
    const splitPoints = [];
    let m;
    while ((m = segmentPattern.exec(line)) !== null) {
        splitPoints.push(m.index + m[0].length);
    }
    if (splitPoints.length === 0) return [line];
    const validSplits = splitPoints.filter(pos => {
        const after = line.slice(pos);
        return /^.+?(?:\\s[-\u2013\u2014]|[-\u2013\u2014]\\s).+$/.test(after);
    });
    if (validSplits.length === 0) return [line];
    let prev = 0;
    for (const pos of validSplits) {
        results.push(line.slice(prev, pos).trim());
        prev = pos;
    }
    results.push(line.slice(prev).trim());
    return results.filter(Boolean);
}

function splitKeyValue(line) {
    const match = line.match(/^(.+?)(?:\\s[-\u2013\u2014]|[-\u2013\u2014]\\s)\\s*(.+)$/);
    if (!match) return null;
    return { key: match[1].trim(), value: match[2].trim().replace(/\\s+/g, " ") };
}

export function parseTextToJSON(text) {
    const rawLines = text.split(/\\r?\\n/);
    const mergedLines = [];
    for (const line of rawLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const hasSeparator = /[-\u2013\u2014]/.test(trimmed);
        if (!hasSeparator && mergedLines.length > 0) {
            mergedLines[mergedLines.length - 1] += " " + trimmed;
        } else {
            mergedLines.push(trimmed);
        }
    }
    const result = {};
    for (const line of mergedLines) {
        const match = line.match(/^(.+?)(?:\\s[-\u2013\u2014]|[-\u2013\u2014]\\s)\\s*(.+)$/);
        if (!match) continue;
        const key = match[1].trim();
        let value = match[2].trim().replace(/\\s+/g, " ");
        value = value.replace(/(^|,\\s*)-(\\d+\\s*[\u2013\u2014-])/g, "$1$2");
        if (key && value) result[key] = value;
    }
    return result;
}

export async function parseWordFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return parseTextToJSON(result.value);
}
`;
fs.writeFileSync(path.join(SRC, "parsers", "wordParser.js"), wordParser, "utf8");
console.log("[OK] parsers/wordParser.js created");

// ── 3. Create Merge Service ─────────────────────────────────────────────────
const mergeService = `/**
 * Merges Word JSON (project info) with Excel flats array
 * into a single unified JSON structure.
 */
export function mergeProjectData(wordJson, excelFlats) {
    return {
        project: { ...wordJson },
        apartments: [...excelFlats],
        meta: {
            generated_at: new Date().toISOString(),
            word_fields: Object.keys(wordJson).length,
            total_apartments: excelFlats.length,
        }
    };
}
`;
fs.writeFileSync(path.join(SRC, "services", "mergeService.js"), mergeService, "utf8");
console.log("[OK] services/mergeService.js created");

// ── 4. Create Excel Parser (browser version) ────────────────────────────────
const excelParser = `import * as XLSX from "xlsx";
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

    return mergeAdjacentFlats(allFlats);
}
`;
fs.writeFileSync(path.join(SRC, "excel", "excelParser.js"), excelParser, "utf8");
console.log("[OK] excel/excelParser.js created");

console.log("\\n=== All files created successfully! ===");
