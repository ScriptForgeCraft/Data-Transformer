import * as XLSX from "xlsx";
import * as fs from "fs";
import { HEADER_KEYWORDS } from "./src/excel/constants.js";
import { normalizeText, kwMatches } from "./src/excel/utils.js";

async function run() {
    const filePath = "C:/Users/scrip/Desktop/Էդեն Պարկ վաճառքներ.xlsx";
    const buffer = fs.readFileSync(filePath);

    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = "3Բ եվ 3Ե";
    const sheet = workbook.Sheets[sheetName];
    const sheetData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

    const row = sheetData[0];
    console.log("Analyzing TRUE row 0:");
    console.dir(row, { maxArrayLength: null });

    let matches = 0;
    for (const cell of row) {
        if (cell === null || cell === undefined) continue;
        const text = normalizeText(cell);
        if (!text) continue;

        for (const [key, keywords] of Object.entries(HEADER_KEYWORDS)) {
            for (const kw of keywords) {
                if (kwMatches(text, kw)) {
                    console.log(`  -> TEXT: '${text}' Matched keyword [${key}]: '${kw}'`);
                    matches++;
                    break;
                }
            }
        }
    }
    console.log(`Total true matches: ${matches}`);
}

run().catch(console.error);
