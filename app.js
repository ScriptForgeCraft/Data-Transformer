import mammoth from "mammoth";
const fileInput = document.getElementById("fileInput");
const dropZone = document.getElementById("dropZone");
const output = document.getElementById("output");
const status = document.getElementById("status");
const outputWrap = document.getElementById("outputWrapper");
const copyBtn = document.getElementById("copyBtn");
const countBadge = document.getElementById("countBadge");

// ── Drag & drop ──────────────────────────────────────────────────────────────
dropZone.addEventListener("dragover", e => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", e => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
});

fileInput.addEventListener("change", e => {
    const file = e.target.files[0];
    if (file) processFile(file);
});

// ── Copy button ──────────────────────────────────────────────────────────────
copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(output.dataset.raw || "").then(() => {
        copyBtn.textContent = "copied ✓";
        copyBtn.classList.add("copied");
        setTimeout(() => {
            copyBtn.textContent = "copy";
            copyBtn.classList.remove("copied");
        }, 2000);
    });
});

// ── Main processing ──────────────────────────────────────────────────────────
async function processFile(file) {
    if (!file.name.endsWith(".docx")) {
        setStatus("❌ Нужен файл .docx", "err");
        return;
    }

    setStatus("⏳ Читаю файл…", "");

    try {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        const jsonData = parseTextToJSON(result.value);
        const raw = JSON.stringify(jsonData, null, 2);
        const keyCount = Object.keys(jsonData).length;

        output.dataset.raw = raw;
        output.innerHTML = syntaxHighlight(raw);
        output.classList.add("visible");
        outputWrap.style.display = "block";
        countBadge.textContent = `${keyCount} keys`;

        setStatus(`✓ Готово — распарсено ${keyCount} полей из "${file.name}"`, "ok");
    } catch (err) {
        console.error(err);
        setStatus("❌ Ошибка: " + err.message, "err");
    }
}

// ── Parser ───────────────────────────────────────────────────────────────────

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

function parseTextToJSON(text) {
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

        // Убираем минус перед числами-индексами (-1, -2, -3...)
        // Только если минус стоит в начале строки или после ", "
        // и после него сразу цифра (это нумерация, не отрицательное число)
        value = value.replace(/(^|,\s*)-(\d+\s*[–—-])/g, "$1$2");

        if (key && value) result[key] = value;
    }

    return result;
}
// ── Syntax highlight ─────────────────────────────────────────────────────────
function syntaxHighlight(json) {
    return json
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
        .replace(/: "([^"]*)"/g, ': <span class="json-str">"$1"</span>')
        .replace(/[{},[\]]/g, s => `<span class="json-punct">${s}</span>`);
}

// ── Status helper ─────────────────────────────────────────────────────────────
function setStatus(msg, type) {
    status.textContent = msg;
    status.className = "status visible " + type;
}
// ── Download button ───────────────────────────────────────────────────────────
const downloadBtn = document.getElementById("downloadBtn");

downloadBtn.addEventListener("click", () => {
    const raw = output.dataset.raw;
    if (!raw) return;

    const blob = new Blob([raw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "output.json";
    a.click();
    URL.revokeObjectURL(url);
});