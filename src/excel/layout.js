import { HEADER_KEYWORDS } from "./constants.js";
import {
    normalizeText,
    kwMatches,
    parseNumericCell,
    looksLikePrice,
    looksLikeSafePrice,
    looksLikeArea,
    looksLikeFloor,
    looksLikeRooms,
    hasCurrencySymbol,
    hasAreaSymbol,
    classifyPrice
} from "./utils.js";

export function detectHeaderRow(data) {
    let bestRow = null;
    let maxMatches = 0;

    for (let i = 0; i < Math.min(10, data.length); i++) {
        const row = data[i];
        if (!row) continue;
        let matches = 0;
        for (const cell of row) {
            const text = normalizeText(cell);
            if (!text) continue;
            for (const keywords of Object.values(HEADER_KEYWORDS)) {
                if (keywords.some(kw => kwMatches(text, kw))) {
                    matches++;
                    break;
                }
            }
        }
        if (matches > maxMatches) {
            maxMatches = matches;
            bestRow = i;
        }
    }

    return maxMatches >= 2 ? bestRow : null;
}

/**
 * Heuristic Classification Engine.
 * Analyzes a row of header strings and optionally the underlying data rows.
 * Maps identified columns to standard database fields (id, area, price_total, etc).
 * Uses keyword matching first, then falls back to robust statistical analysis of numeric data.
 * 
 * @param {Array<string>} row - The header row to analyze
 * @param {Array<Array>} [dataRows=[]] - Sample data rows to analyze if headers are ambiguous/missing
 * @returns {Object} Column mapping, e.g., { id: 0, area: 2, price_total: 4 }
 */
export function mapHeaderColumns(row, dataRows = []) {
    const colMap = {};

    // 1. Match by keywords in header
    const assignedCols = new Set();
    const ambiguousPriceCols = [];

    // Prioritize explicit unique keywords before ambiguous ones
    for (const [key, keywords] of Object.entries(HEADER_KEYWORDS)) {
        if (key === "price_ambiguous") {
            for (let col = 0; col < row.length; col++) {
                if (assignedCols.has(col)) continue;
                const text = normalizeText(row[col]);
                if (!text) continue;
                if (keywords.some(kw => kwMatches(text, kw))) {
                    ambiguousPriceCols.push(col);
                }
            }
            continue;
        }

        for (let col = 0; col < row.length; col++) {
            if (assignedCols.has(col)) continue;
            const text = normalizeText(row[col]);
            if (!text) continue;
            if (keywords.some(kw => kwMatches(text, kw))) {
                if (!(key in colMap)) colMap[key] = col;
                assignedCols.add(col);
                break;
            }
        }
    }

    // 2. Fallback — currency symbol in header → treat as price_total
    if (!("price_total" in colMap)) {
        for (let col = 0; col < row.length; col++) {
            const text = normalizeText(row[col]);
            if (!text) continue;
            if (hasCurrencySymbol(text)) {
                colMap.price_total = col;
                break;
            }
        }
    }

    if (!("area" in colMap) && !("new_area" in colMap)) {
        for (let col = 0; col < row.length; col++) {
            const text = normalizeText(row[col]);
            if (!text) continue;
            if (hasAreaSymbol(text)) {
                colMap.area = col;
                break;
            }
        }
    }

    // 3. Fallback — detect by data values in first few rows
    if (dataRows.length > 0) {
        const colCount = Math.max(...dataRows.map(r => (r || []).length));

        // Analyze each column's numeric characteristics
        const colStats = [];
        for (let col = 0; col < colCount; col++) {
            const vals = dataRows.slice(0, 10).map(r => parseNumericCell((r || [])[col])).filter(v => v !== null);
            if (!vals.length) { colStats.push(null); continue; }
            const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
            const allInts = vals.every(v => Number.isInteger(v));
            const maxVal = Math.max(...vals);
            colStats.push({ avg, allInts, maxVal, vals });
        }

        // Evaluate ambiguous price columns based on their actual data
        for (const col of ambiguousPriceCols) {
            const st = colStats[col];
            if (!st) continue;

            // Try to classify based on average
            const mockClassification = classifyPrice(st.avg, "AMD") || classifyPrice(st.avg, "USD");

            if (mockClassification === "total" || looksLikeSafePrice(st.avg)) {
                if (!("price_total" in colMap)) {
                    colMap.price_total = col;
                }
            } else if (mockClassification === "sqm" || st.avg >= 250) {
                if (!("price_sqm" in colMap)) {
                    colMap.price_sqm = col;
                }
            }
        }

        // Price: not yet found — look for large numbers
        if (!("price_total" in colMap)) {
            // First try "safe" threshold (>= 10M)
            let bestCol = -1, bestAvg = 0;
            for (let col = 0; col < colCount; col++) {
                if (Object.values(colMap).includes(col)) continue;
                const st = colStats[col];
                if (!st) continue;
                if (looksLikeSafePrice(st.avg) && st.avg > bestAvg) {
                    bestAvg = st.avg;
                    bestCol = col;
                }
            }
            // If not found at safe threshold, try 1M+
            if (bestCol < 0) {
                for (let col = 0; col < colCount; col++) {
                    if (Object.values(colMap).includes(col)) continue;
                    const st = colStats[col];
                    if (!st) continue;
                    if (looksLikePrice(st.avg) && st.avg > bestAvg) {
                        bestAvg = st.avg;
                        bestCol = col;
                    }
                }
            }
            if (bestCol >= 0) colMap.price_total = bestCol;
        }

        if (!("price_sqm" in colMap)) {
            let bestCol = -1, bestAvg = 0;
            for (let col = 0; col < colCount; col++) {
                if (Object.values(colMap).includes(col)) continue;
                const st = colStats[col];
                if (!st) continue;
                const isSqm = st.vals.every(v => (v >= 250 && v <= 20000) || (v >= 100000 && v <= 5000000));
                if (isSqm && st.avg > bestAvg) {
                    bestAvg = st.avg;
                    bestCol = col;
                }
            }
            if (bestCol >= 0) colMap.price_sqm = bestCol;
        }

        // Area: not yet found — look for decimals in AREA_MIN..AREA_MAX range
        if (!("area" in colMap) && !("new_area" in colMap)) {
            for (let col = 0; col < colCount; col++) {
                if (Object.values(colMap).includes(col)) continue;
                const st = colStats[col];
                if (!st) continue;
                const allInRange = st.vals.every(v => looksLikeArea(v));
                const hasDecimals = st.vals.some(v => !Number.isInteger(v));
                if (allInRange && hasDecimals) {
                    colMap.area = col;
                    break;
                }
            }
            // fallback: integers in area range
            if (!("area" in colMap) && !("new_area" in colMap)) {
                for (let col = 0; col < colCount; col++) {
                    if (Object.values(colMap).includes(col)) continue;
                    const st = colStats[col];
                    if (!st) continue;
                    if (st.vals.every(v => looksLikeArea(v))) {
                        colMap.area = col;
                        break;
                    }
                }
            }
        }

        // ID: look for sequential integers
        if (!("id" in colMap)) {
            let bestCol = -1, maxUniqueRatio = -1;
            for (let col = 0; col < colCount; col++) {
                if (Object.values(colMap).includes(col)) continue;
                const rawVals = dataRows.slice(0, 15).map(r => (r || [])[col]);
                const numericVals = rawVals.map(parseNumericCell).filter(v => v !== null && v > 0 && v < 10000);

                // IDs usually have high uniqueness mostly
                if (numericVals.length >= 2) {
                    const uniqueVals = new Set(numericVals).size;
                    const ratio = uniqueVals / numericVals.length;
                    if (ratio > maxUniqueRatio) {
                        maxUniqueRatio = ratio;
                        bestCol = col;
                    }
                }
            }
            if (bestCol >= 0 && maxUniqueRatio > 0.5) colMap.id = bestCol; // Need at least some uniqueness to be an ID
        }

        // Floor: small integers with low uniqueness
        if (!("floor" in colMap)) {
            let bestCol = -1, minUniqueRatio = Infinity;
            for (let col = 0; col < colCount; col++) {
                if (Object.values(colMap).includes(col)) continue;
                const st = colStats[col];
                if (!st) continue;

                const rawVals = dataRows.slice(0, 20).map(r => (r || [])[col]);
                const nonNullCount = rawVals.filter(v => v !== null && v !== "").length;
                if (nonNullCount < 2) continue; // too sparse to judge

                if (st.allInts && st.vals.every(v => looksLikeFloor(v)) && st.avg < 100) {
                    const uniqueVals = new Set(st.vals).size;
                    const ratio = uniqueVals / st.vals.length;

                    if (ratio < minUniqueRatio) {
                        minUniqueRatio = ratio;
                        bestCol = col;
                    }
                }
            }
            if (bestCol >= 0 && minUniqueRatio < 0.8) colMap.floor = bestCol; // Floors should repeat occasionally
        }

        // Rooms: small integers, different from floor
        if (!("rooms" in colMap)) {
            for (let col = 0; col < colCount; col++) {
                if (Object.values(colMap).includes(col)) continue;
                const st = colStats[col];
                if (!st) continue;
                const uniqueVals = new Set(st.vals);
                if (st.allInts && st.vals.every(v => looksLikeRooms(v)) && uniqueVals.size <= 8) {
                    colMap.rooms = col;
                    break;
                }
            }
        }
    }

    return colMap;
}

/**
 * Attempts AI mapping first, validates it, and fills missing columns with heuristics.
 */
export function determineColumnMappingAsync(headers, dataRows) {
    // Browser version: heuristic only (no AI)
    const heuristicMap = mapHeaderColumns(headers, dataRows);
    return heuristicMap;
}

/**
 * Detects the presence of header rows and partitions the sheet into discrete logical table blocks.
 * It identifies visual gaps (empty columns) between separate tables (e.g., side-by-side matrices) and
 * validates whether these partitions are structurally independent or just visual padding.
 * 
 * @param {Array<Array>} data - The full sheet data
 * @returns {Array<Object>|null} An array of table blocks with localized headers, or null if no headers
 */
export function hasHeaderRow(data) {
    const rowIndex = detectHeaderRow(data);
    if (rowIndex === null) return null;

    const combinedRow = [];
    for (let r = rowIndex; r < Math.min(rowIndex + 3, data.length); r++) {
        const row = data[r] || [];
        for (let c = 0; c < row.length; c++) {
            if (row[c] !== null && row[c] !== undefined && String(row[c]).trim() !== "") {
                combinedRow[c] = (combinedRow[c] ? combinedRow[c] + " " : "") + String(row[c]).trim();
            }
        }
    }

    const tableBlocks = [];
    let start = 0;
    let gap = 0;
    for (let c = 0; c <= combinedRow.length; c++) {
        const isEmpty = c === combinedRow.length || !combinedRow[c];
        if (isEmpty) {
            gap++;
            if (gap >= 1) {
                const lastValidCol = c - gap;
                if (lastValidCol >= start) {
                    const slice = combinedRow.slice(start, lastValidCol + 1);
                    const hasKeyword = slice.some(cell => {
                        if (!cell) return false;
                        const text = normalizeText(cell);
                        return Object.values(HEADER_KEYWORDS).some(kws =>
                            kws.some(kw => kwMatches(text, kw))
                        );
                    });
                    if (hasKeyword) tableBlocks.push({ startCol: start, endCol: lastValidCol });
                }
                start = c;
            }
        } else {
            if (gap >= 1) start = c;
            gap = 0;
        }
    }

    // ── Table Partition Validation ────────────────────────────────────────────────
    // The previous pass extracted potential blocks based on empty column gaps.
    // However, some Excel files use empty columns strictly for visual padding inside 
    // a single unified table (e.g., aldina.xlsx). 
    // If a detected "block" lacks the necessary constituent fields to be an independent 
    // table (like ID/Area or ID/Price), it must be a fragment of a larger table.
    // We iteratively merge these weak fragments with adjacent fragments.

    const blocksWithMapping = tableBlocks.map(block => {
        const sliceStr = combinedRow.slice(block.startCol, block.endCol + 1);
        const dataRows = data.slice(rowIndex + 1, rowIndex + 10).map(r =>
            r ? r.slice(block.startCol, block.endCol + 1) : []
        );
        const headers = determineColumnMappingAsync(sliceStr, dataRows);
        return { block, headers };
    });

    /**
     * Determines if a block has enough critical mapped columns to stand on its own as a table.
     */
    const isStrongBlock = (headers) => {
        const hasId = "id" in headers;
        const hasArea = "area" in headers || "new_area" in headers;
        const hasPrice = "price_total" in headers || "price_sqm" in headers;
        return (hasId && hasArea) || (hasId && hasPrice) || (hasArea && hasPrice);
    };

    // Merge adjacent weak blocks iteratively
    const consolidatedBlocks = [];
    let currentConsolidated = null;

    for (let i = 0; i < blocksWithMapping.length; i++) {
        const info = blocksWithMapping[i];

        if (!currentConsolidated) {
            currentConsolidated = info;
        } else {
            // Should we merge currentConsolidated and info?
            if (!isStrongBlock(currentConsolidated.headers) || !isStrongBlock(info.headers)) {
                // Merge them into a single larger block bridging the gap
                const newStart = currentConsolidated.block.startCol;
                const newEnd = info.block.endCol;
                const sliceStr = combinedRow.slice(newStart, newEnd + 1);
                const dataRows = data.slice(rowIndex + 1, rowIndex + 10).map(r =>
                    r ? r.slice(newStart, newEnd + 1) : []
                );
                const mergedHeaders = determineColumnMappingAsync(sliceStr, dataRows);

                currentConsolidated = {
                    block: { startCol: newStart, endCol: newEnd },
                    headers: mergedHeaders
                };
            } else {
                consolidatedBlocks.push(currentConsolidated);
                currentConsolidated = info;
            }
        }
    }

    if (currentConsolidated) consolidatedBlocks.push(currentConsolidated);

    // Filter to only return actual valid blocks
    const finalResult = [];
    for (const info of consolidatedBlocks) {
        if (Object.keys(info.headers).length >= 2) {
            const absHeaders = {};
            for (const [key, relCol] of Object.entries(info.headers)) {
                absHeaders[key] = relCol + info.block.startCol;
            }
            finalResult.push({ rowIndex, headers: absHeaders, startCol: info.block.startCol, endCol: info.block.endCol });
        }
    }

    // Fallback: if somehow everything failed, try to just treat the whole row as 1 table
    if (finalResult.length === 0) {
        const dataRows = data.slice(rowIndex + 1, rowIndex + 10);
        const allHeaders = determineColumnMappingAsync(combinedRow, dataRows);
        if (Object.keys(allHeaders).length >= 2) {
            return [{ rowIndex, headers: allHeaders, startCol: 0, endCol: combinedRow.length - 1 }];
        }
        return null;
    }

    return finalResult;
}

export function isAlternatingLayout(data) {
    for (let i = 0; i < Math.min(10, data.length - 1); i++) {
        const row1 = data[i];
        const row2 = data[i + 1];
        if (!row1 || !row2) continue;
        let validPairs = 0;
        const floorStr = String(row1[0] || "");
        if (!floorStr || !/\d/.test(floorStr) || isNaN(parseInt(floorStr))) continue;
        for (let col = 1; col + 1 < row1.length; col += 2) {
            const area = parseNumericCell(row1[col + 1]);
            const price = parseNumericCell(row2[col + 1]);
            // Price row can contain price_sqm (100K-5M) OR total prices (>1M)
            const priceOk = price === null || (price >= 100000 || looksLikePrice(price));
            if (area && looksLikeArea(area) && priceOk) validPairs++;
        }
        if (validPairs >= 1) return i - 1 < 0 ? 0 : i - 1;
    }
    return null;
}
