const {
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
} = require("./constants");

function normalizeText(str) {
    return String(str || "").toLowerCase().trim();
}

function kwMatches(text, kw) {
    const kwNorm = normalizeText(kw);
    const textNorm = normalizeText(text);
    if (textNorm === kwNorm) return true;

    if (kwNorm.length <= 3) {
        const escaped = kwNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(^|[\\s/\\\\:\\-.,])${escaped}([\\s/\\\\:\\-.,]|$)`, 'iu');
        return regex.test(textNorm);
    }

    return textNorm.includes(kwNorm);
}

function textToNumber(text) {
    if (!text || typeof text !== "string") return 1;

    let multiplier = 1;
    const lower = text.toLowerCase();

    // Millions 
    if (lower.includes("միլիոն") || lower.includes("մլն") ||
        lower.includes("миллион") || lower.includes("млн") ||
        lower.includes("million") || lower.includes("mil") || lower.includes("m")) {
        multiplier = 1_000_000;
    }
    // Thousands
    else if (lower.includes("հազար") || lower.includes("հազ") ||
        lower.includes("тысяч") || lower.includes("тыс") ||
        lower.includes("thousand") || lower.includes("k")) {
        multiplier = 1_000;
    }

    return multiplier;
}

function parseNumericCell(raw) {
    if (typeof raw === "number") return raw;
    if (typeof raw === "string") {
        const lower = raw.toLowerCase();

        // Check if string contains textual multipliers
        const hasMillions = /միլիոն|մլն|миллион|млн|million|mil|\bm\b/.test(lower);
        // Added 'հզ' explicitly to thousands matchers
        const hasThousands = /հազար|հազ|հզ|тысяч|тыс|thousand|\bk\b/.test(lower);

        if (hasMillions || hasThousands) {
            let total = 0;
            // Added 'հզ' to regex word options
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
            .replace(/[^\d.]/g, "");

        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? null : parsed;
    }
    return null;
}

function looksLikePrice(val) {
    return val !== null && val >= PRICE_MIN_THRESHOLD;
}

function looksLikeSafePrice(val) {
    return val !== null && val >= PRICE_SAFE_THRESHOLD;
}

function looksLikeArea(val) {
    return val !== null && val >= AREA_MIN && val <= AREA_MAX;
}

function looksLikeFloor(val) {
    return val !== null && Number.isInteger(val) && val >= FLOOR_MIN && val <= FLOOR_MAX;
}

function looksLikeRooms(val) {
    return val !== null && Number.isInteger(val) && val >= ROOMS_MIN && val <= ROOMS_MAX;
}

function hasCurrencySymbol(str) {
    const s = normalizeText(str);
    return CURRENCY_SYMBOLS.some(sym => s.includes(sym));
}

function hasAreaSymbol(str) {
    const s = normalizeText(str);
    return AREA_SYMBOLS.some(sym => s.includes(sym));
}

function findPriceInRow(row, excludeCols = []) {
    for (let col = 0; col < row.length; col++) {
        if (excludeCols.includes(col)) continue;
        const cell = String(row[col] || "");
        if (hasCurrencySymbol(cell)) {
            return parseNumericCell(cell);
        }
    }
    return null;
}

function findAreaInRow(row, excludeCols = []) {
    for (let col = 0; col < row.length; col++) {
        if (excludeCols.includes(col)) continue;
        const cell = String(row[col] || "");
        if (hasAreaSymbol(cell)) {
            return parseNumericCell(cell);
        }
    }
    return null;
}

function extractFallbackValues(row, skipColsRaw, area, currentPrice, currentPriceSqm) {
    const skipCols = new Set(skipColsRaw);
    let price = currentPrice;
    let price_sqm = currentPriceSqm;

    const unused = [];
    for (let c = 0; c < row.length; c++) {
        if (skipCols.has(c)) continue;
        const val = parseNumericCell(row[c]);
        // Also skip if it exactly matches the area we extracted
        if (val !== null && val !== area) {
            unused.push({ col: c, val });
        }
    }

    if (unused.length === 0) return { price, price_sqm };

    if (price === null) {
        const idx = unused.findIndex(x => looksLikeSafePrice(x.val));
        if (idx >= 0) {
            price = unused[idx].val;
            unused.splice(idx, 1);
        }
    }

    if (price_sqm === null) {
        const idx = unused.findIndex(x => (x.val >= 250 && x.val <= 20000) || (x.val >= 100000 && x.val <= 5000000));
        if (idx >= 0) {
            price_sqm = unused[idx].val;
            unused.splice(idx, 1);
        }
    }

    if (price === null) {
        const idx = unused.findIndex(x => looksLikePrice(x.val) || x.val >= 10000);
        if (idx >= 0) {
            price = unused[idx].val;
            unused.splice(idx, 1);
        }
    }

    return { price, price_sqm };
}

module.exports = {
    normalizeText,
    kwMatches,
    textToNumber,
    parseNumericCell,
    looksLikePrice,
    looksLikeSafePrice,
    looksLikeArea,
    looksLikeFloor,
    looksLikeRooms,
    hasCurrencySymbol,
    hasAreaSymbol,
    findPriceInRow,
    findAreaInRow,
    extractFallbackValues
};
