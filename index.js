import { parseWord } from "./parsers/wordParser.js";
import { parseExcel } from "./parsers/excelParser.js";
import { mergeProjectData } from "./services/mergeService.js";
import fs from "fs";

async function main() {
    const wordData = await parseWord("./input/project.docx");
    const excelData = await parseExcel("./input/apartments.xlsx");

    const result = mergeProjectData(wordData, excelData);

    fs.writeFileSync(
        "./output/project.json",
        JSON.stringify(result, null, 2)
    );
}

main();