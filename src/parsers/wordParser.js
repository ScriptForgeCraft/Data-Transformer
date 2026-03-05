import mammoth from "mammoth";

function splitMergedLines(line) {
    const results = [];
    const segmentPattern = /(?<=\S)\s+(?=[^\s\d,.()\[\]{}'"-–—][^-–—\n]{1,}(?:\s[-–—]|[-–—]\s))/g;
    const splitPoints = [];
    let m;
    while ((m = segmentPattern.exec(line)) !== null) {
        splitPoints.push(m.index + m[0].length);
    }
    if (splitPoints.length === 0) return [line];
    const validSplits = splitPoints.filter(pos => {
        const after = line.slice(pos);
        return /^.+?(?:\s[-–—]|[-–—]\s).+$/.test(after);
    });
    if (validSplits.length === 0) return [line];
    let prev = 0;
    for (const pos of validSplits) {
        results.push(line.slice(prev, pos).trim());
        prev = pos;
    }
    results.push(line.slice(prev).trim());
    return results.filter(Boolean);
}

function splitKeyValue(line) {
    const match = line.match(/^(.+?)(?:\s[-–—]|[-–—]\s)\s*(.+)$/);
    if (!match) return null;
    return { key: match[1].trim(), value: match[2].trim().replace(/\s+/g, " ") };
}

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
