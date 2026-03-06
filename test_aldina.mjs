import * as XLSX from "xlsx";
import { parseExcelFile } from "./src/excel/excelParser.js";
import fs from "fs";

async function run() {
    try {
        const buf = fs.readFileSync("../aldina/aldina.xlsx");
        // Mock File object
        const file = {
            name: "aldina.xlsx",
            arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        };
        const flats = await parseExcelFile(file);
        console.log("Found flats:", flats.length);
        console.log(JSON.stringify(flats.slice(0, 10), null, 2));
    } catch (e) {
        console.error("Test failed:", e);
    }
}
run();
