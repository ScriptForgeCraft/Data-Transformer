import mammoth from "mammoth";





export function parseTextToJSON(text) {
    const rawLines = text.split(/\r?\n/);
    const mergedLines = [];
    for (const line of rawLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const hasSeparator = /[-–—]/.test(trimmed);
        if (!hasSeparator && mergedLines.length > 0) {
            mergedLines[mergedLines.length - 1] += " " + trimmed;
        } else {
            mergedLines.push(trimmed);
        }
    }
    const result = {};
    for (const line of mergedLines) {
        const match = line.match(/^(.+?)(?:\s[-–—]|[-–—]\s)\s*(.+)$/);
        if (!match) continue;
        const key = match[1].trim();
        let value = match[2].trim().replace(/\s+/g, " ");
        value = value.replace(/(^|,\s*)-(\d+\s*[–—-])/g, "$1$2");
        if (key && value) result[key] = value;
    }
    return result;
}

export async function parseWordFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return parseTextToJSON(result.value);
}
