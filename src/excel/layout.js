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
    hasAreaSymbol
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

// Our 100% reliable heuristic fallback
export function mapHeaderColumns(row, dataRows = []) {
    const colMap = {};

    // 1. Match by keywords in header
    const assignedCols = new Set();
    // Prioritize explicit unique keywords before ambiguous ones
    for (const [key, keywords] of Object.entries(HEADER_KEYWORDS)) {
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
            if (gap >= 1) { // We use gap >= 1 to catch side-by-side tables separated by only 1 empty column
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

    if (tableBlocks.length === 0) {
        const dataRows = data.slice(rowIndex + 1, rowIndex + 10);
        const headers = determineColumnMappingAsync(combinedRow, dataRows);
        return Object.keys(headers).length >= 2
            ? [{ rowIndex, headers, startCol: 0, endCol: combinedRow.length - 1 }]
            : null;
    }

    const result = [];
    for (const block of tableBlocks) {
        const sliceStr = combinedRow.slice(block.startCol, block.endCol + 1);
        const dataRows = data.slice(rowIndex + 1, rowIndex + 10).map(r =>
            r ? r.slice(block.startCol, block.endCol + 1) : []
        );
        const headers = determineColumnMappingAsync(sliceStr, dataRows);

        const absHeaders = {};
        for (const [key, relCol] of Object.entries(headers)) {
            absHeaders[key] = relCol + block.startCol;
        }

        if (Object.keys(absHeaders).length >= 2) {
            result.push({ rowIndex, headers: absHeaders, startCol: block.startCol, endCol: block.endCol });
        }
    }

    return result.length > 0 ? result : null;
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
            const priceOk = price && (price >= 100000 || looksLikePrice(price));
            if (area && looksLikeArea(area) && priceOk) validPairs++;
        }
        if (validPairs >= 1) return i - 1 < 0 ? 0 : i - 1;
    }
    return null;
}
