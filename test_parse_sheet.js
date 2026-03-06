import * as XLSX from "xlsx";
import * as fs from "fs";
import { detectHeaderRow } from "./src/excel/layout.js";

async function run() {
    const filePath = "C:/Users/scrip/Desktop/Էդեն Պարկ վաճառքներ.xlsx";
    const buffer = fs.readFileSync(filePath);

    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = "3Բ եվ 3Ե";

    const sheet = workbook.Sheets[sheetName];
    if (sheet) {
        const sheetData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
        console.log("Detecting header row...");
        const res = detectHeaderRow(sheetData);
        console.log(`detectHeaderRow returned: ${res}`);
    }
}

run().catch(console.error);
