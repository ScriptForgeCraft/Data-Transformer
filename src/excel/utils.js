import {
    CURRENCY_SYMBOLS,
    AREA_SYMBOLS,
    PRICE_MIN_THRESHOLD,
    PRICE_SAFE_THRESHOLD,
    AREA_MIN,
    AREA_MAX,
    FLOOR_MIN,
    FLOOR_MAX,
    ROOMS_MIN,
    ROOMS_MAX
} from "./constants.js";

export function normalizeText(str) {
    return String(str || "").toLowerCase().trim();
}

export function kwMatches(text, kw) {
    const kwNorm = normalizeText(kw);
    const textNorm = normalizeText(text);
    if (textNorm === kwNorm) return true;

    // Use word boundaries for words up to 5 characters (e.g. 'հարկ', 'этаж', 'room', 'բնակ')
    if (kwNorm.length <= 5) {
        const escaped = kwNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(^|[\\s/\\\\:\\-.,\\d\\(])${escaped}([\\s/\\\\:\\-.,\\)ընիաեуяք]|$)`, 'iu');
        return regex.test(textNorm);
    }

    return textNorm.includes(kwNorm);
}


/**
 * Parses a cell value into a clean numeric format.
 * Automatically handles string-based numbers containing textual multipliers 
 * (e.g. "1.5 million", "200k", "50 тыс").
 * 
 * @param {string|number} raw - The raw cell value to parse
 * @returns {number|null} The parsed numeric value, or null if invalid
 */
export function parseNumericCell(raw) {
    if (typeof raw === "number") return raw;
    if (typeof raw === "string") {
        const lower = raw.toLowerCase().trim();
        if (!lower) return null;

        // Reject values that resemble dates, phone numbers, or complex string IDs (e.g., A-15-1 or 2024/02/01)
        if ((raw.match(/[-/\\]/g) || []).length >= 2) return null;
        if (/\d{2}\.\d{2}\.\d{4}/.test(raw)) return null;

        // Reject random hash/ID values containing a mix of letters and many digits
        if (/[a-zа-яա-ֆ]/i.test(raw) && (raw.match(/\d/g) || []).length >= 8) return null;

        const digitCount = (raw.match(/\d/g) || []).length;
        if (digitCount >= 11) return null; // Prices >= 100 billion are virtually impossible, this is likely a phone/account number

        // Check if string contains textual multipliers
        const hasMillions = /միլիոն|մլն|миллион|млн|million|mil|\bm\b/.test(lower);
        const hasThousands = /հազար|հազ|հզ|тысяч|тыс|thousand|\bk\b/.test(lower);

        if (hasMillions || hasThousands) {
            let total = 0;
            const regex = /(\d[\d.,]*)\s*(միլիոն|մլն|миллиոն|млն|million|mil|m|հազար|հազ|հզ|тысяч|тыс|thousand|k)?/gi;
            let match;

            const normalizedText = lower.replace(/[\u2024\u00b7\u0589\u02D9\u066B\u066C]/g, ".");

            let foundAny = false;
            while ((match = regex.exec(normalizedText)) !== null) {
                const numStr = match[1].replace(/,/g, "");
                const num = parseFloat(numStr);
                if (isNaN(num)) continue;

                foundAny = true;
                const word = match[2] || "";
                let mult = 1;

                if (/միլիոն|մլն|миллион|млն|million|mil|m/.test(word)) mult = 1_000_000;
                else if (/հազար|հազ|հզ|тысяч|тыс|thousand|k/.test(word)) mult = 1_000;

                total += num * mult;
            }
            if (foundAny && total > 0) return total;
        }

        // Standard fallback for strings without textual multipliers
        const cleaned = raw
            .replace(/[\u2024\u00b7\u0589\u02D9\u066B\u066C]/g, ".")
            .replace(/\s/g, "")
            .replace(/[^\d.-]/g, "");

        if (!cleaned || cleaned === "-") return null;

        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? null : parsed;
    }
    return null;
}

export function looksLikePrice(val) {
    return val !== null && val >= PRICE_MIN_THRESHOLD;
}

export function looksLikeSafePrice(val) {
    return val !== null && val >= PRICE_SAFE_THRESHOLD;
}

export function looksLikeArea(val) {
    return val !== null && val >= AREA_MIN && val <= AREA_MAX;
}

export function looksLikeFloor(val) {
    return val !== null && Number.isInteger(val) && val >= FLOOR_MIN && val <= FLOOR_MAX;
}

export function looksLikeRooms(val) {
    return val !== null && Number.isInteger(val) && val >= ROOMS_MIN && val <= ROOMS_MAX;
}

export function hasCurrencySymbol(str) {
    const s = normalizeText(str);
    return CURRENCY_SYMBOLS.some(sym => s.includes(sym));
}

export function hasAreaSymbol(str) {
    const s = normalizeText(str);
    return AREA_SYMBOLS.some(sym => s.includes(sym));
}

export function detectCurrency(str) {
    if (typeof str !== "string") return null;
    const s = str.toLowerCase();
    if (s.includes("$") || s.includes("usd")) return "$";
    if (s.includes("€") || s.includes("eur")) return "€";
    if (s.includes("₽") || s.includes("rub")) return "₽";
    if (s.includes("֏") || s.includes("amd") || s.includes("դրամ")) return "֏";
    return null;
}

/**
 * Heuristically classifies whether a numeric value represents a Total Price or a Price per Sqm
 * based on the currency and the magnitude of the number.
 * 
 * @param {number} val - The price numeric value
 * @param {string} currency - The detected currency symbol (e.g. `$`, `֏`, `₽`)
 * @returns {"total"|"sqm"|null} The classification, or null if ambiguous/invalid
 */
export function classifyPrice(val, currency) {
    if (val === null || val < 100) return null; // Too small to be a realistic price/sqm

    if (currency === "$" || currency === "€") {
        if (val >= 8000) return "total";
        return "sqm";
    } else if (currency === "₽") {
        if (val < 50000) return null;
        if (val >= 1000000) return "total";
        return "sqm";
    } else if (currency === "֏") {
        if (val >= 4000000) return "total";
        return "sqm";
    } else {
        // Unknown currency fallback behavior
        if (val >= 4000000) return "total"; // Clearly AMD total price 
        if (val >= 100000) return "sqm"; // AMD price_sqm or large USD total. Usually in AMD, this is price per sqm.
        if (val >= 8000) return "total"; // Small USD total
        return "sqm"; // USD sqm
    }
}

export function findPriceAndCurrencyInRow(row, excludeCols = [], startCol = 0, endCol = row.length - 1) {
    for (let col = startCol; col <= Math.min(endCol, row.length - 1); col++) {
        if (excludeCols.includes(col)) continue;
        const cell = String(row[col] || "");
        if (hasCurrencySymbol(cell)) {
            const val = parseNumericCell(cell);
            if (val !== null) return { value: val, currency: detectCurrency(cell) };
        }
    }
    return null;
}

export function findAreaInRow(row, excludeCols = [], startCol = 0, endCol = row.length - 1) {
    for (let col = startCol; col <= Math.min(endCol, row.length - 1); col++) {
        if (excludeCols.includes(col)) continue;
        const cell = String(row[col] || "");
        if (hasAreaSymbol(cell)) {
            return parseNumericCell(cell);
        }
    }
    return null;
}

/**
 * Sweeps through a row's unassigned columns to find stranded price or area values.
 * Used when explicit column mapping leaves critical fields empty but data exists.
 * 
 * @param {Array} row - The row data array
 * @param {Array<number>} skipCols - Columns already mapped to specific fields
 * @param {number|null} area - Already identified area
 * @param {number|null} currentPrice - Already identified total price
 * @param {number|null} currentPriceSqm - Already identified price per sqm
 * @param {string|null} currentCurrency - Already identified currency
 * @param {number} startCol - Start column index
 * @param {number} endCol - End column index
 * @returns {Object} An object containing the patched {price, price_sqm, currency}
 */
export function extractFallbackValues(row, skipColsRaw, area, currentPrice, currentPriceSqm, currentCurrency, startCol = 0, endCol = row.length - 1) {
    const skipCols = new Set(skipColsRaw);
    let price = currentPrice;
    let price_sqm = currentPriceSqm;
    let currency = currentCurrency;

    const unused = [];
    for (let c = startCol; c <= Math.min(endCol, row.length - 1); c++) {
        if (skipCols.has(c)) continue;
        const cellStr = String(row[c] || "");
        const val = parseNumericCell(row[c]);
        const cellCurrency = detectCurrency(cellStr);
        if (val !== null && val !== area) {
            unused.push({ col: c, val, currency: cellCurrency });
        }
    }

    if (unused.length === 0) return { price, price_sqm, currency };

    for (let i = unused.length - 1; i >= 0; i--) {
        const item = unused[i];
        const effCurrency = item.currency || currency;
        const type = classifyPrice(item.val, effCurrency);

        if (type === "total" && price === null) {
            price = item.val;
            if (item.currency && !currency) currency = item.currency;
            unused.splice(i, 1);
        } else if (type === "sqm" && price_sqm === null) {
            price_sqm = item.val;
            if (item.currency && !currency) currency = item.currency;
            unused.splice(i, 1);
        }
    }

    return { price, price_sqm, currency };
}
