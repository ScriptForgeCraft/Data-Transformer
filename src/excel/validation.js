import { AREA_MIN, AREA_MAX } from "./constants.js";
import { looksLikePrice, classifyPrice } from "./utils.js";

/**
 * Performs final cross-validation of all extracted fields for a given flat.
 * PRINCIPLE: If a value is 100% confidently bound to one field, it cannot 
 * be simultaneously reused for another field. Corrects drifting IDs, Areas, and Prices.
 * 
 * @param {Object} flat - The unstructured flat object extracted from the row
 * @returns {Object} A strictly validated flat object
 */
export function postValidateFlat(flat) {
    let { id, area, area_orig, price, price_sqm, rooms, currency } = flat;

    // Set of "claimed" values to prevent a single value from fulfilling two different fields
    const claimedValues = new Set();

    // Mark explicitly mapped fields as claimed
    if (id !== null) claimedValues.add(String(id));

    // ── Helpers ───────────────────────────────────────────────────────────────
    const looksLikeId = (v) => v !== null && Number.isInteger(v) && v >= 1 && v <= 9999;
    const isDecimal = (v) => v !== null && !Number.isInteger(v);
    const isClaimed = (v) => v !== null && claimedValues.has(String(v));

    // ── 1. Recovery Mechanism: If ID is missing, attempt to salvage from other fields ──
    if (id === null) {
        // Case A: Mapped Area looks suspiciously like an ID (small integer < 500)
        if (area !== null && looksLikeId(area) && Number.isInteger(area) && area < 500) {
            if (price !== null && price_sqm !== null) {
                const calculatedArea = price / price_sqm;
                if (calculatedArea >= AREA_MIN && calculatedArea <= AREA_MAX && calculatedArea !== area) {
                    // The mapped 'area' is actually the ID; compute real area from price formulas
                    id = String(area);
                    claimedValues.add(id);
                    area = Math.round(calculatedArea * 10) / 10;
                    area_orig = area;
                }
            } else if (Number.isInteger(area) && price_sqm !== null && price_sqm <= 10) {
                id = String(area);
                claimedValues.add(id);
                area = null;
                area_orig = null;
                price_sqm = null;
            }
        }

        // Case B: Mapped Price looks suspiciously like an ID and not like a price
        if (id === null && price !== null && looksLikeId(price) && price < 500 && !looksLikePrice(price)) {
            id = String(price);
            claimedValues.add(id);
            price = null;
        }
    }

    // ── 2. Decimals found in ID bounds range are likely misplaced Area ──
    if (id !== null) {
        const idNum = parseFloat(id);
        if (!isNaN(idNum) && isDecimal(idNum) && idNum >= AREA_MIN && idNum <= AREA_MAX) {
            if (area !== null && looksLikeId(area)) {
                // Swap ID and Area
                const realId = String(area);
                const realArea = idNum;
                // Verify realId hasn't been claimed by something else
                if (!isClaimed(realId) || realId === id) {
                    id = realId;
                    claimedValues.add(id);
                    area = realArea;
                    area_orig = realArea;
                }
            }
        }
    }

    // ── 3. Deduplication Check: Area and ID cannot identical ─────────────────
    if (id !== null && area !== null) {
        const areaStr = String(area);
        if (claimedValues.has(areaStr) && areaStr === String(id)) {
            // Priority given to ID. Clear false Area duplicate.
            area = null;
            area_orig = null;
        }
    }

    // ── 4. Verify that Price Per Sqm is realistically dimensioned ────────────────
    if (price_sqm !== null && price_sqm <= 10) {
        price_sqm = null;
    }

    // ── 5. Unrealistic small total prices are purged or reassigned to ID ───
    if (price !== null && classifyPrice(price, currency) === null && !looksLikePrice(price)) {
        if (id === null && Number.isInteger(price) && price < 500 && !isClaimed(String(price))) {
            id = String(price);
            claimedValues.add(id);
        }
        price = null;
    }

    // ── 6. Exorbitant Area values are actually Total Price ───────────────────
    if (area !== null && area > AREA_MAX && (classifyPrice(area, currency) !== null || looksLikePrice(area))) {
        if (price === null) {
            price = area;
        }
        area = null;
        area_orig = null;
    }

    // ── 7. Price Per Sqm cannot be identical to ID ───────────────────────────
    if (id !== null && price_sqm !== null && claimedValues.has(String(price_sqm))) {
        price_sqm = null;
    }

    // ── 8. Final Recalculation pass after corrections ───────────────────────────
    if (area && area > 0) {
        if (price !== null && price_sqm === null) {
            price_sqm = Math.round(price / area);
        } else if (price_sqm !== null && price === null) {
            price = Math.round(price_sqm * area);
        }
    }

    return { ...flat, id, area, area_orig, price, price_sqm, rooms, currency };
}

/**
 * Merges staggered dual-row logic where a single flat spans two Excel rows.
 * e.g.,
 *   Row A: ID + Area
 *   Row B: Total Price / Price Per Sqm
 * Combines A→B or B→A paired layouts into a single output object.
 * 
 * @param {Array<Object>} flats - Sequence of raw parsed flat objects
 * @returns {Array<Object>} Sequence of logically merged flat objects
 */
export function mergeAdjacentFlats(flats) {
    const merged = [];
    let i = 0;

    while (i < flats.length) {
        const current = flats[i];
        const next = flats[i + 1];

        if (next &&
            current.sheet === next.sheet &&
            (current.floor === next.floor || next.floor === null || current.floor === null)) {

            const curHasId = current.id !== null && !/^\d{3},\d{3}$/.test(current.id);
            const curHasArea = current.area !== null && current.area > 0;
            const curNoPrice = current.price === null && current.price_sqm === null;

            const nextNoId = next.id === null || /^\d{3},\d{3}$/.test(next.id);
            const nextHasPrice = next.price !== null || next.price_sqm !== null;
            const nextNoArea = next.area === null;

            // Pattern A→B: Row A contains ID+Area; Row B contains Price
            if (curHasId && curHasArea && curNoPrice && nextHasPrice && nextNoArea) {
                const mergedFlat = {
                    ...current,
                    price: next.price,
                    price_sqm: next.price_sqm,
                    rooms: current.rooms || next.rooms,
                    status: current.status || next.status,
                    currency: current.currency || next.currency
                };

                if (mergedFlat.area && mergedFlat.area > 0) {
                    if (mergedFlat.price !== null && mergedFlat.price_sqm === null) {
                        mergedFlat.price_sqm = Math.round(mergedFlat.price / mergedFlat.area);
                    } else if (mergedFlat.price_sqm !== null && mergedFlat.price === null) {
                        mergedFlat.price = Math.round(mergedFlat.price_sqm * mergedFlat.area);
                    }
                }

                merged.push(mergedFlat);
                i += 2;
                continue;
            }

            // Pattern B→A (Reversed sequence)
            if (next.id !== null && next.area !== null && next.area > 0 &&
                next.price === null && next.price_sqm === null &&
                !curHasId && (current.price !== null || current.price_sqm !== null)) {

                const mergedFlat = {
                    ...next,
                    price: current.price,
                    price_sqm: current.price_sqm,
                    rooms: next.rooms || current.rooms,
                    status: next.status || current.status,
                    currency: next.currency || current.currency
                };

                if (mergedFlat.area && mergedFlat.area > 0) {
                    if (mergedFlat.price !== null && mergedFlat.price_sqm === null) {
                        mergedFlat.price_sqm = Math.round(mergedFlat.price / mergedFlat.area);
                    } else if (mergedFlat.price_sqm !== null && mergedFlat.price === null) {
                        mergedFlat.price = Math.round(mergedFlat.price_sqm * mergedFlat.area);
                    }
                }

                merged.push(mergedFlat);
                i += 2;
                continue;
            }
        }

        merged.push(current);
        i++;
    }

    return merged;
}
