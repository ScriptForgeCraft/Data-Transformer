require("dotenv").config();
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const { flatIdPattern, PRICE_MIN_THRESHOLD } = require("./constants");
const { parseNumericCell } = require("./utils");
const { isAlternatingLayout, hasHeaderRow } = require("./layout");
const { processHeaderBlock, processNoHeaderSheet } = require("./processors");
const { postValidateFlat, mergeAdjacentFlats } = require("./validation");

// ── Пути к папкам ───────────────────────────────────────────────────────────
const INPUT_DIR = path.join(__dirname, "input");
const OUTPUT_DIR = path.join(__dirname, "output");

// Создаём папки, если не существуют
if (!fs.existsSync(INPUT_DIR)) fs.mkdirSync(INPUT_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function processFile(filePath) {
    const fileName = path.basename(filePath, path.extname(filePath));
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📂 Обрабатываю файл: ${path.basename(filePath)}`);
    console.log(`${"=".repeat(60)}`);

    let workbook;
    try {
        workbook = XLSX.readFile(filePath);
    } catch (err) {
        console.error(`❌ Не удалось прочитать файл: ${filePath}\n   ${err.message}`);
        return null;
    }

    const allFlats = [];

    // ─── ГЛАВНЫЙ ЦИКЛ ────────────────────────────────────────────────────────
    for (const sheetName of workbook.SheetNames) {
        console.log(`\n  📋 Лист: "${sheetName}"`);

        let sheet, data;
        try {
            sheet = workbook.Sheets[sheetName];
            data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
        } catch (err) {
            console.error(`  ⚠️  Ошибка чтения листа "${sheetName}": ${err.message}`);
            continue;
        }

        if (!data.length) {
            console.log(`  ⏭️  Лист пустой, пропускаю.`);
            continue;
        }

        const buildingName = sheetName;
        const flatsBefore = allFlats.length;

        try {
            const alternatingHeaderRow = isAlternatingLayout(data);
            const headerBlocks = await hasHeaderRow(data);

            if (alternatingHeaderRow !== null) {
                // ── Чередующийся лейаут (этаж/площадь/цена по строкам) ──────
                console.log(`  🔀 Обнаружен чередующийся формат (строка ${alternatingHeaderRow})`);
                let i = alternatingHeaderRow + 1;

                while (i < data.length) {
                    const dataRow = data[i];
                    const priceRow = data[i + 1];

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

                        // Взаимный расчёт цены
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
                // ── Формат с заголовками ─────────────────────────────────────
                console.log(`  📊 Обнаружен формат с заголовками (блоков: ${headerBlocks.length})`);
                for (const block of headerBlocks) {
                    await processHeaderBlock(data, block, buildingName, sheetName, allFlats);
                }

            } else {
                // ── Формат без заголовков ────────────────────────────────────
                console.log(`  🔍 Нет заголовков — использую AI + эвристику`);
                let foundFlatIds = false;
                const buildingNameFallback = typeof data[0]?.[0] === "string"
                    ? data[0][0].trim()
                    : sheetName;

                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    if (!row) continue;

                    const hasFlatIds = row.some(
                        cell => typeof cell === "string" && flatIdPattern.test(cell.trim())
                    );

                    if (hasFlatIds) {
                        foundFlatIds = true;
                        const idsRow = row;
                        const pricesRow = data[i + 1] || [];
                        const areasRow = data[i + 2] || [];

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
                    await processNoHeaderSheet(data, buildingNameFallback, sheetName, allFlats);
                }
            }

        } catch (err) {
            console.error(`  ❌ Ошибка обработки листа "${sheetName}": ${err.message}`);
            continue;
        }

        const addedCount = allFlats.length - flatsBefore;
        console.log(`  ✅ Квартир найдено: ${addedCount}`);
    }

    const finalFlats = mergeAdjacentFlats(allFlats);
    console.log(`\n📦 Итого квартир после объединения: ${finalFlats.length}`);

    // ── Сохранение в output/ ────────────────────────────────────────────────
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const outFileName = `${fileName}_${timestamp}.json`;
    const outFilePath = path.join(OUTPUT_DIR, outFileName);

    fs.writeFileSync(outFilePath, JSON.stringify(finalFlats, null, 2), "utf-8");
    console.log(`\n💾 Результат сохранён: output/${outFileName}`);

    return { file: path.basename(filePath), count: finalFlats.length, outputFile: outFileName };
}

async function main() {
    // Найти все .xlsx файлы в папке input/
    let files;
    try {
        files = fs.readdirSync(INPUT_DIR).filter(f => f.toLowerCase().endsWith(".xlsx"));
    } catch (err) {
        console.error(`❌ Не удалось прочитать папку input/: ${err.message}`);
        process.exit(1);
    }

    if (files.length === 0) {
        console.log(`⚠️  Нет Excel-файлов в папке input/`);
        console.log(`   Положите .xlsx файлы в папку: ${INPUT_DIR}`);
        process.exit(0);
    }

    console.log(`\n🚀 Найдено файлов: ${files.length}`);

    const results = [];
    for (const file of files) {
        const filePath = path.join(INPUT_DIR, file);
        const result = await processFile(filePath);
        if (result) results.push(result);
    }

    // ── Итоговый отчёт ──────────────────────────────────────────────────────
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📊 ИТОГОВЫЙ ОТЧЁТ`);
    console.log(`${"=".repeat(60)}`);
    for (const r of results) {
        console.log(`  ✅ ${r.file} → ${r.count} квартир → output/${r.outputFile}`);
    }
    console.log(`\n✨ Готово! Результаты в папке: ${OUTPUT_DIR}`);
}

main().catch(err => {
    console.error("❌ Критическая ошибка:", err);
    process.exit(1);
});
