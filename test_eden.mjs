import * as XLSX from "xlsx";
import { parseExcelFile } from "./src/excel/excelParser.js";
import fs from "fs";

async function run() {
    try {
        const buf = fs.readFileSync("../eden/Էդեն Պարկ վաճառքներ.xlsx");
        const file = {
            name: "Էդեն Պարկ վաճառքներ.xlsx",
            arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        };
        const flats = await parseExcelFile(file);
        console.log("Found flats:", flats.length);
        console.log("First 5 flats:", JSON.stringify(flats.slice(0, 5), null, 2));
    } catch (e) {
        console.error("Test failed:", e);
    }
}
run();
