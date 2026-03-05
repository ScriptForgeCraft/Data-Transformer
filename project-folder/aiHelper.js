// aiHelper.js
const {
    AREA_MIN, AREA_MAX,
    FLOOR_MIN, FLOOR_MAX,
    ROOMS_MIN, ROOMS_MAX
} = require("./constants");
const { parseNumericCell } = require("./utils");

// ── Простой in-memory кэш (ключ — строковое представление заголовков) ───────
const _mappingCache = new Map();

function _cacheKey(headers) {
    return JSON.stringify(headers.map(h => String(h || "").toLowerCase().trim()));
}

// ── Timeout-обёртка для fetch ─────────────────────────────────────────────────
async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 15000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(resource, {
        ...options,
        signal: controller.signal
    });
    clearTimeout(id);
    return response;
}

/**
 * Вызывает Gemini API для определения маппинга колонок.
 * Возвращает объект { id: colIndex, area: colIndex, ... } или null.
 *
 * Если заголовки уже встречались — возвращает кэшированный результат
 * без лишних запросов к API.
 */
async function getAILayoutMapping(headers, sampleData) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.warn("⚠️  [AI] GEMINI_API_KEY не найден — AI пропускается.");
        return null;
    }

    // Проверяем кэш до вызова API
    const cacheKey = _cacheKey(headers);
    if (_mappingCache.has(cacheKey)) {
        console.log(`[AI] 📦 Ответ из кэша для данного набора заголовков.`);
        return _mappingCache.get(cacheKey);
    }

    // Если все заголовки пустые — нет смысла спрашивать AI
    const hasRealHeaders = headers.some(h => h && String(h).trim() !== "");
    const headerSection = hasRealHeaders
        ? headers.map((h, i) => `[Col ${i}]: "${h || ""}"`).join("\n")
        : "(заголовков нет — анализируй данные)";

    console.log(`[AI] 🤖 Отправляю запрос к Gemini (${headers.length} колонок)...`);

    const prompt = `
You are a data extraction expert for real estate Excel files.
I need to map column indices to schema fields.

Schema fields: "id", "floor", "area", "new_area", "price_total", "price_sqm", "rooms", "status".

Column headers (0-indexed):
${headerSection}

Sample data rows (up to 5):
${sampleData.slice(0, 5).map(r => JSON.stringify(r)).join("\n")}

RULES:
1. "id" = apartment number/identifier (integer or string like "101", "2А", "A-1-5"). NOT a decimal, NOT a price.
2. "floor" = small integer (${FLOOR_MIN} to ${FLOOR_MAX}).
3. "area" = square meters, usually ${AREA_MIN}–${AREA_MAX}, can be decimal.
4. "price_total" = full apartment price (usually >= 1,000,000).
5. "price_sqm" = price per square meter (usually 100,000–5,000,000).
6. "rooms" = number of rooms, small integer (${ROOMS_MIN}–${ROOMS_MAX}).
7. "status" = text like "available", "sold", "reserved".
8. CRITICAL: Each column index must appear at most ONCE in your answer. If a column is mapped to "id", it CANNOT also be mapped to "area" or any other field.
9. If unsure about a field, omit it — do NOT guess wrong.
10. Headers may be in Armenian, Russian, or English.

Return ONLY a valid JSON object mapping field names to integer column indices.
Example: {"id": 1, "area": 3, "price_total": 4}
NO markdown, NO backticks, NO explanation.
`;

    try {
        const response = await fetchWithTimeout(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.0 }
                }),
                timeout: 15000
            }
        );

        if (!response.ok) {
            console.warn(`[AI] ⚠️  API вернул статус ${response.status}`);
            return null;
        }

        const data = await response.json();
        const textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!textResponse) {
            console.warn("[AI] ⚠️  Пустой ответ от Gemini.");
            return null;
        }

        // Очищаем от возможного markdown
        const cleanedText = textResponse
            .replace(/```json/gi, "")
            .replace(/```/g, "")
            .trim();

        const mapping = JSON.parse(cleanedText);
        if (typeof mapping !== "object" || mapping === null) return null;

        // Валидация: значения должны быть целыми числами в допустимом диапазоне
        const validMapping = {};
        const maxCol = headers.length > 0 ? headers.length - 1 : 999;
        const usedCols = new Set(); // КЛЮЧЕВОЕ: каждая колонка — только одному полю

        for (const [key, value] of Object.entries(mapping)) {
            if (Number.isInteger(value) && value >= 0 && value <= maxCol) {
                if (!usedCols.has(value)) {
                    validMapping[key] = value;
                    usedCols.add(value);
                } else {
                    console.warn(`[AI] ⚠️  Колонка ${value} уже занята — дублирование для "${key}" отклонено.`);
                }
            }
        }

        if (Object.keys(validMapping).length > 0) {
            console.log(`[AI] ✅ Маппинг определён:`, validMapping);
            // Сохраняем в кэш
            _mappingCache.set(cacheKey, validMapping);
            return validMapping;
        }

        return null;

    } catch (error) {
        if (error.name === "AbortError") {
            console.warn("[AI] ⏱️  Таймаут запроса — переходим к эвристике.");
        } else {
            console.warn("[AI] ⚠️  Ошибка запроса:", error.message);
        }
        return null;
    }
}

/**
 * Валидирует маппинг от AI против реальных данных.
 * Удаляет поля, которые явно не соответствуют ожидаемым диапазонам.
 */
function validateAIMapping(aiMap, sampleData) {
    if (!aiMap) return {};

    const validMap = { ...aiMap };

    const getSampleVals = (colIndex) =>
        sampleData
            .slice(0, 10)
            .map(r => parseNumericCell((r || [])[colIndex]))
            .filter(v => v !== null);

    if (validMap.floor !== undefined) {
        const vals = getSampleVals(validMap.floor);
        if (vals.length > 0 && !vals.every(v =>
            Number.isInteger(v) && v >= FLOOR_MIN && v <= FLOOR_MAX
        )) {
            console.warn(`[AI] Отклоняю floor (col ${validMap.floor}) — данные вне диапазона.`);
            delete validMap.floor;
        }
    }

    if (validMap.area !== undefined) {
        const vals = getSampleVals(validMap.area);
        if (vals.length > 0 && !vals.every(v => v >= AREA_MIN && v <= AREA_MAX)) {
            console.warn(`[AI] Отклоняю area (col ${validMap.area}) — данные вне диапазона.`);
            delete validMap.area;
        }
    }

    if (validMap.rooms !== undefined) {
        const vals = getSampleVals(validMap.rooms);
        if (vals.length > 0 && !vals.every(v =>
            Number.isInteger(v) && v >= ROOMS_MIN && v <= ROOMS_MAX
        )) {
            console.warn(`[AI] Отклоняю rooms (col ${validMap.rooms}) — данные вне диапазона.`);
            delete validMap.rooms;
        }
    }

    return validMap;
}

module.exports = {
    getAILayoutMapping,
    validateAIMapping
};
