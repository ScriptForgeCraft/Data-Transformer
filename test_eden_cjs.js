const XLSX = require("xlsx");
const fs = require("fs");

// We can't easily require ES modules from the project if it's set up without type:module.
// Instead, I'll just write a script that loads the excel file, finds the header rows, and prints them out.
const buf = fs.readFileSync("../eden/Էդեն Պարկ վաճառքներ.xlsx");
const workbook = XLSX.read(buf, { type: "buffer" });
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

let log = "";
for (let i = 0; i < 20; i++) {
    log += i + ": " + (data[i] ? data[i].map(c => c !== null ? String(c).substring(0, 15) : 'null').join(' | ') : 'null') + "\n";
}
console.log(log);
