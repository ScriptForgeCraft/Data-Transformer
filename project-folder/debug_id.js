const XLSX = require("xlsx");
const wb = XLSX.readFile("file.xlsx");

console.log("All sheet names:", wb.SheetNames);

const targetSheet = wb.SheetNames.find(s => s.includes("4") && s.includes("5"));
const sheetName = targetSheet || "4Ա և 5Ա";
console.log("\nUsing sheet:", sheetName);

const s = wb.Sheets[sheetName];
if (!s) {
    console.log("Sheet not found!");
    process.exit(1);
}

const d = XLSX.utils.sheet_to_json(s, { header: 1, defval: null });
console.log("\nFirst 10 rows:");
for (let i = 0; i < Math.min(10, d.length); i++) {
    console.log("Row", i, ":", JSON.stringify(d[i]));
}
