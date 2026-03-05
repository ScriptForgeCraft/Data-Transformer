const { AREA_MIN, AREA_MAX } = require("./constants");
const { looksLikePrice } = require("./utils");

// ── Пост-валидация: перекрёстная проверка всех полей ─────────────────────────
// ПРИНЦИП: если значение уже 100% привязано к полю, оно не может
//          повторно использоваться для другого поля.
function postValidateFlat(flat) {
    let { id, area, area_orig, price, price_sqm, rooms } = flat;

    // Множество «занятых» значений (чтобы одно значение не попало в два поля)
    const claimedValues = new Set();

    // Помечаем значения, которые уже надёжно определены
    if (id !== null) claimedValues.add(String(id));

    // ── Хелперы ───────────────────────────────────────────────────────────────
    const looksLikeId = (v) => v !== null && Number.isInteger(v) && v >= 1 && v <= 9999;
    const isDecimal = (v) => v !== null && !Number.isInteger(v);
    const isClaimed = (v) => v !== null && claimedValues.has(String(v));

    // ── 1. Если id == null — пробуем спасти из других полей ──────────────────
    if (id === null) {
        // Случай A: area выглядит как ID (целое число < 500)
        if (area !== null && looksLikeId(area) && Number.isInteger(area) && area < 500) {
            if (price !== null && price_sqm !== null) {
                const calculatedArea = price / price_sqm;
                if (calculatedArea >= AREA_MIN && calculatedArea <= AREA_MAX && calculatedArea !== area) {
                    // area на самом деле — ID, вычисляем настоящую площадь
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

        // Случай B: price выглядит как ID
        if (id === null && price !== null && looksLikeId(price) && price < 500 && !looksLikePrice(price)) {
            id = String(price);
            claimedValues.add(id);
            price = null;
        }
    }

    // ── 2. Если id — десятичное число в диапазоне площади — вероятно, это площадь ──
    if (id !== null) {
        const idNum = parseFloat(id);
        if (!isNaN(idNum) && isDecimal(idNum) && idNum >= AREA_MIN && idNum <= AREA_MAX) {
            if (area !== null && looksLikeId(area)) {
                // Меняем местами
                const realId = String(area);
                const realArea = idNum;
                // Убеждаемся, что realId не было уже занято другим полем
                if (!isClaimed(realId) || realId === id) {
                    id = realId;
                    claimedValues.add(id);
                    area = realArea;
                    area_orig = realArea;
                }
            }
        }
    }

    // ── 3. Проверка: если area совпадает со значением id — убираем дубль ─────
    // (Это главная проблема, о которой говорил пользователь)
    if (id !== null && area !== null) {
        const areaStr = String(area);
        if (claimedValues.has(areaStr) && areaStr === String(id)) {
            // area имеет то же значение что и id — это дубль, обнуляем area
            area = null;
            area_orig = null;
        }
    }

    // ── 4. Проверка: price_sqm не может быть крошечным числом ────────────────
    if (price_sqm !== null && price_sqm <= 10) {
        price_sqm = null;
    }

    // ── 5. Слишком маленькая «цена» — это не цена ────────────────────────────
    if (price !== null && price < 1000 && !looksLikePrice(price)) {
        if (id === null && Number.isInteger(price) && price < 500 && !isClaimed(String(price))) {
            id = String(price);
            claimedValues.add(id);
        }
        price = null;
    }

    // ── 6. Слишком большая «площадь» — вероятно, это цена ───────────────────
    if (area !== null && area > AREA_MAX && looksLikePrice(area)) {
        if (price === null) {
            price = area;
        }
        area = null;
        area_orig = null;
    }

    // ── 7. Проверка: price_sqm не должен совпадать со значением id ───────────
    if (id !== null && price_sqm !== null && claimedValues.has(String(price_sqm))) {
        price_sqm = null;
    }

    // ── 8. Пересчёт перекрёстных значений после всех корректировок ───────────
    if (area && area > 0) {
        if (price !== null && price_sqm === null) {
            price_sqm = Math.round(price / area);
        } else if (price_sqm !== null && price === null) {
            price = Math.round(price_sqm * area);
        }
    }

    return { ...flat, id, area, area_orig, price, price_sqm, rooms };
}

// ── Слияние спаренных строк ───────────────────────────────────────────────────
// Некоторые матричные лейауты создают две строки на квартиру:
//   Строка A: id + area, без цены
//   Строка B: цена, без id и area
// Объединяем их в одну запись.
function mergeAdjacentFlats(flats) {
    const merged = [];
    let i = 0;

    while (i < flats.length) {
        const current = flats[i];
        const next = flats[i + 1];

        if (next &&
            current.sheet === next.sheet &&
            current.floor === next.floor) {

            const curHasId = current.id !== null && !/^\d{3},\d{3}$/.test(current.id);
            const curHasArea = current.area !== null && current.area > 0;
            const curNoPrice = current.price === null && current.price_sqm === null;

            const nextNoId = next.id === null || /^\d{3},\d{3}$/.test(next.id);
            const nextHasPrice = next.price !== null || next.price_sqm !== null;
            const nextNoArea = next.area === null;

            // Паттерн A→B: id+area/нет цены + нет id+area/цена
            if (curHasId && curHasArea && curNoPrice && nextHasPrice && nextNoArea) {
                const mergedFlat = {
                    ...current,
                    price: next.price,
                    price_sqm: next.price_sqm,
                    rooms: current.rooms || next.rooms,
                    status: current.status || next.status
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

            // Паттерн B→A (обратный)
            if (next.id !== null && next.area !== null && next.area > 0 &&
                next.price === null && next.price_sqm === null &&
                !curHasId && (current.price !== null || current.price_sqm !== null)) {

                const mergedFlat = {
                    ...next,
                    price: current.price,
                    price_sqm: current.price_sqm,
                    rooms: next.rooms || current.rooms,
                    status: next.status || current.status
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

module.exports = {
    postValidateFlat,
    mergeAdjacentFlats
};
