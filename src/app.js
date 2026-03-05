import { parseWordFile } from "./parsers/wordParser.js";
import { parseExcelFile } from "./excel/excelParser.js";
import { mergeProjectData } from "./services/mergeService.js";
import { createExcelFromData, jsonToExcel } from "./services/excelExport.js";

// ── State ────────────────────────────────────────────────────────────────────
let wordData = null;
let excelDataSets = [];   // array of { fileName, flats[] }
let mergedData = null;
let pipelineMode = null;  // "word+excel" | "multi-excel" | null

// ── DOM refs ─────────────────────────────────────────────────────────────────
const modeScreen = document.getElementById("modeScreen");
const pipelineScreen = document.getElementById("pipelineScreen");
const jsonConverterScreen = document.getElementById("jsonConverterScreen");

const btnModeWordExcel = document.getElementById("btnModeWordExcel");
const btnModeMultiExcel = document.getElementById("btnModeMultiExcel");
const btnModeJsonExcel = document.getElementById("btnModeJsonExcel");
const btnBackToMode = document.getElementById("btnBackToMode");
const btnBackToMode2 = document.getElementById("btnBackToMode2");

const stepperContainer = document.getElementById("stepperContainer");
const allStepEls = document.querySelectorAll(".step");
const allStepperSteps = document.querySelectorAll(".stepper-step");

// Word
const wordStep = document.getElementById("stepWord");
const wordDropZone = document.getElementById("wordDropZone");
const wordInput = document.getElementById("wordInput");
const wordPreview = document.getElementById("wordPreview");
const wordStatus = document.getElementById("wordStatus");
const wordFileName = document.getElementById("wordFileName");
const wordKeyCount = document.getElementById("wordKeyCount");
const btnEditWordJson = document.getElementById("btnEditWordJson");
const wordTextarea = document.getElementById("wordTextarea");

// Excel
const excelStep = document.getElementById("stepExcel");
const excelDropZone = document.getElementById("excelDropZone");
const excelInput = document.getElementById("excelInput");
const excelPreview = document.getElementById("excelPreview");
const excelStatus = document.getElementById("excelStatus");
const excelFileList = document.getElementById("excelFileList");
const excelFlatCount = document.getElementById("excelFlatCount");
const btnEditExcelJson = document.getElementById("btnEditExcelJson");
const excelTextarea = document.getElementById("excelTextarea");

// Merge
const mergeStep = document.getElementById("stepMerge");
const mergeBtn = document.getElementById("mergeBtn");
const mergePreview = document.getElementById("mergePreview");
const mergeStatus = document.getElementById("mergeStatus");
const downloadJsonBtn = document.getElementById("downloadJsonBtn");
const downloadExcelBtn = document.getElementById("downloadExcelBtn");
const copyBtn = document.getElementById("copyBtn");
const mergeWordChip = document.getElementById("mergeWordChip");
const btnEditMergeJson = document.getElementById("btnEditMergeJson");
const mergeTextarea = document.getElementById("mergeTextarea");

// JSON → Excel
const jsonDropZone = document.getElementById("jsonDropZone");
const jsonInput = document.getElementById("jsonInput");
const jsonFileName = document.getElementById("jsonFileName");
const jsonStatus = document.getElementById("jsonStatus");
const jsonTextInput = document.getElementById("jsonTextInput");
const btnProcessJsonText = document.getElementById("btnProcessJsonText");
const downloadFromJsonBtn = document.getElementById("downloadFromJsonBtn");

let currentStep = 1;
let steps = [];  // will be configured per mode

// ── Mode Selection ───────────────────────────────────────────────────────────
function showModeScreen() {
    modeScreen.style.display = "block";
    pipelineScreen.style.display = "none";
    jsonConverterScreen.style.display = "none";
    // Reset state
    wordData = null;
    excelDataSets = [];
    mergedData = null;
    pipelineMode = null;
    currentStep = 1;
    // Reset UI
    wordDropZone.classList.remove("has-file");
    excelDropZone.classList.remove("has-file");
    wordFileName.textContent = "";
    excelFileList.innerHTML = "";
    wordPreview.classList.remove("visible");
    excelPreview.classList.remove("visible");
    mergePreview.classList.remove("visible");
    wordStatus.classList.remove("visible");
    excelStatus.classList.remove("visible");
    mergeStatus.classList.remove("visible");
    wordKeyCount.textContent = "0";
    excelFlatCount.textContent = "0";
    downloadJsonBtn.style.display = "none";
    downloadExcelBtn.style.display = "none";
    copyBtn.style.display = "none";
    btnEditWordJson.style.display = "none";
    btnEditExcelJson.style.display = "none";

    // Reset edit modes
    wordPreview.style.display = "";
    wordTextarea.style.display = "none";
    btnEditWordJson.textContent = "Edit JSON";
    btnEditWordJson.classList.replace("btn-primary", "btn-secondary");

    excelPreview.style.display = "";
    excelTextarea.style.display = "none";
    btnEditExcelJson.textContent = "Edit JSON";
    btnEditExcelJson.classList.replace("btn-primary", "btn-secondary");
}

function startPipeline(mode) {
    pipelineMode = mode;
    modeScreen.style.display = "none";
    pipelineScreen.style.display = "block";
    jsonConverterScreen.style.display = "none";

    if (mode === "word+excel") {
        // 3-step: Word → Excel → Merge
        excelInput.removeAttribute("multiple");
        steps = ["word", "excel", "merge"];
        configStepper(["Word", "Excel", "Merge"]);
        mergeWordChip.style.display = "inline-flex";
    } else {
        // 2-step: Excel (multi) → Merge
        excelInput.setAttribute("multiple", "");
        steps = ["excel", "merge"];
        configStepper(["Excel", "Merge"]);
        mergeWordChip.style.display = "none";
    }

    currentStep = 1;
    updateStepper();
}

function startJsonConverter() {
    modeScreen.style.display = "none";
    pipelineScreen.style.display = "none";
    jsonConverterScreen.style.display = "block";
    jsonDropZone.classList.remove("has-file");
    jsonFileName.textContent = "";
    jsonStatus.classList.remove("visible");
    jsonTextInput.value = "";
    downloadFromJsonBtn.style.display = "none";
}

// ── Stepper ──────────────────────────────────────────────────────────────────
function configStepper(labels) {
    stepperContainer.innerHTML = "";
    labels.forEach((label, i) => {
        if (i > 0) {
            const line = document.createElement("div");
            line.className = "stepper-line";
            stepperContainer.appendChild(line);
        }
        const step = document.createElement("div");
        step.className = "stepper-step";
        step.innerHTML = `<span class="num">${i + 1}</span><span class="label">${label}</span>`;
        step.addEventListener("click", () => {
            if (i + 1 <= currentStep) goToStep(i + 1);
        });
        stepperContainer.appendChild(step);
    });
}

function updateStepper() {
    const stepperSteps = stepperContainer.querySelectorAll(".stepper-step");
    stepperSteps.forEach((si, i) => {
        si.classList.remove("active", "completed");
        if (i + 1 < currentStep) si.classList.add("completed");
        if (i + 1 === currentStep) si.classList.add("active");
    });

    // Show correct step content
    allStepEls.forEach(s => s.classList.remove("active"));
    const stepKey = steps[currentStep - 1];
    if (stepKey === "word") wordStep.classList.add("active");
    if (stepKey === "excel") excelStep.classList.add("active");
    if (stepKey === "merge") mergeStep.classList.add("active");
}

function goToStep(step) {
    currentStep = step;
    updateStepper();
}

// ── Drag & Drop helpers ──────────────────────────────────────────────────────
function setupDropZone(zone, input, onFiles) {
    zone.addEventListener("dragover", e => {
        e.preventDefault();
        zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => {
        zone.classList.remove("drag-over");
    });
    zone.addEventListener("drop", e => {
        e.preventDefault();
        zone.classList.remove("drag-over");
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(files);
    });
    input.addEventListener("change", e => {
        const files = Array.from(e.target.files);
        if (files.length) onFiles(files);
    });
}

// ── Status / Syntax helpers ──────────────────────────────────────────────────
function setStatus(el, msg, type) {
    el.textContent = msg;
    el.className = "status visible " + type;
}

function syntaxHighlight(json) {
    return json
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
        .replace(/: "([^"]*)"/g, ': <span class="json-str">"$1"</span>')
        .replace(/: (\d+\.?\d*)/g, ': <span class="json-num">$1</span>')
        .replace(/: (null)/g, ': <span class="json-null">$1</span>')
        .replace(/[{}\[\]]/g, s => `<span class="json-punct">${s}</span>`);
}

function renderJSON(el, data, maxLines = 50) {
    const raw = JSON.stringify(data, null, 2);
    const lines = raw.split("\n");
    const truncated = lines.length > maxLines
        ? lines.slice(0, maxLines).join("\n") + `\n\n  ... (${lines.length - maxLines} more lines)`
        : raw;
    el.innerHTML = syntaxHighlight(truncated);
    el.dataset.raw = raw;
    el.classList.add("visible");
}

// ── Word file processing ─────────────────────────────────────────────────────
async function processWordFile(files) {
    const file = files[0];
    if (!file.name.endsWith(".docx")) {
        setStatus(wordStatus, "\u274c\u00a0\u041d\u0443\u0436\u0435\u043d .docx \u0444\u0430\u0439\u043b", "err");
        return;
    }
    setStatus(wordStatus, "\u23f3\u00a0\u0427\u0438\u0442\u0430\u044e \u0444\u0430\u0439\u043b\u2026", "");
    wordFileName.textContent = file.name;
    wordDropZone.classList.add("has-file");

    try {
        wordData = await parseWordFile(file);
        const keyCount = Object.keys(wordData).length;
        wordKeyCount.textContent = `${keyCount} fields`;

        if (wordPreview.style.display === "none") {
            wordPreview.style.display = "";
            wordTextarea.style.display = "none";
            btnEditWordJson.textContent = "Edit JSON";
            btnEditWordJson.classList.replace("btn-primary", "btn-secondary");
        }

        renderJSON(wordPreview, wordData);
        btnEditWordJson.style.display = "inline-flex";

        setStatus(wordStatus, `\u2713 \u0413\u043e\u0442\u043e\u0432\u043e \u2014 ${keyCount} \u043f\u043e\u043b\u0435\u0439`, "ok");
        setTimeout(() => goToStep(currentStep + 1), 500);
    } catch (err) {
        console.error(err);
        setStatus(wordStatus, "\u274c " + err.message, "err");
    }
}

// ── Excel file processing ────────────────────────────────────────────────────
async function processExcelFiles(files) {
    const xlsxFiles = files.filter(f => f.name.match(/\.xlsx?$/i));
    if (!xlsxFiles.length) {
        setStatus(excelStatus, "\u274c\u00a0\u041d\u0443\u0436\u043d\u044b .xlsx \u0444\u0430\u0439\u043b\u044b", "err");
        return;
    }

    // In word+excel mode only 1 file allowed
    if (pipelineMode === "word+excel" && xlsxFiles.length > 1) {
        setStatus(excelStatus, "\u274c\u00a0\u0412 \u0440\u0435\u0436\u0438\u043c\u0435 Word+Excel \u043c\u043e\u0436\u043d\u043e \u0442\u043e\u043b\u044c\u043a\u043e 1 \u0444\u0430\u0439\u043b", "err");
        return;
    }

    excelDropZone.classList.add("has-file");
    excelFileList.innerHTML = "";
    excelDataSets = [];

    setStatus(excelStatus, `\u23f3\u00a0\u041e\u0431\u0440\u0430\u0431\u0430\u0442\u044b\u0432\u0430\u044e ${xlsxFiles.length} \u0444\u0430\u0439\u043b(a/\u043e\u0432)\u2026`, "");

    let totalFlats = 0;
    for (const file of xlsxFiles) {
        try {
            const flats = await parseExcelFile(file);
            excelDataSets.push({ fileName: file.name, flats });
            totalFlats += flats.length;

            // Show file in list
            const chip = document.createElement("div");
            chip.className = "file-chip";
            chip.innerHTML = `<span>\ud83d\udcca</span> ${file.name} <span class="file-chip-badge">${flats.length}</span>`;
            excelFileList.appendChild(chip);
        } catch (err) {
            console.error(`Error processing ${file.name}:`, err);
            const chip = document.createElement("div");
            chip.className = "file-chip file-chip-err";
            chip.innerHTML = `<span>\u274c</span> ${file.name} <span class="file-chip-badge">error</span>`;
            excelFileList.appendChild(chip);
        }
    }

    excelFlatCount.textContent = `${totalFlats} flats`;
    const allFlats = excelDataSets.flatMap(ds => ds.flats);

    if (excelPreview.style.display === "none") {
        excelPreview.style.display = "";
        excelTextarea.style.display = "none";
        btnEditExcelJson.textContent = "Edit JSON";
        btnEditExcelJson.classList.replace("btn-primary", "btn-secondary");
    }

    renderJSON(excelPreview, allFlats, 30);
    btnEditExcelJson.style.display = "inline-flex";

    setStatus(excelStatus, `\u2713 ${totalFlats} \u043a\u0432\u0430\u0440\u0442\u0438\u0440 \u0438\u0437 ${excelDataSets.length} \u0444\u0430\u0439\u043b(\u043e\u0432)`, "ok");
    setTimeout(() => goToStep(currentStep + 1), 500);
}

// ── Merge ────────────────────────────────────────────────────────────────────
function doMerge() {
    if (excelDataSets.length === 0) return;

    const allFlats = excelDataSets.flatMap(ds => ds.flats);
    setStatus(mergeStatus, "\u23f3\u00a0\u041e\u0431\u044a\u0435\u0434\u0438\u043d\u044f\u044e\u2026", "");

    try {
        if (pipelineMode === "word+excel" && wordData) {
            mergedData = mergeProjectData(wordData, allFlats);
        } else {
            // Multi-excel: just the apartments
            mergedData = [...allFlats];
        }

        renderJSON(mergePreview, mergedData, 80);
        // Reset edit mode
        if (mergePreview.style.display === "none") {
            mergePreview.style.display = "block";
            mergeTextarea.style.display = "none";
            btnEditMergeJson.textContent = "Edit JSON";
        }

        const aCount = mergedData.length;
        const pFields = (pipelineMode === "word+excel" && wordData) ? Object.keys(wordData).length : 0;
        const summary = pFields > 0
            ? `\u2713 ${pFields} \u043f\u043e\u043b\u0435\u0439 + ${aCount} \u043a\u0432\u0430\u0440\u0442\u0438\u0440`
            : `\u2713 ${aCount} \u043a\u0432\u0430\u0440\u0442\u0438\u0440 \u043e\u0431\u044a\u0435\u0434\u0438\u043d\u0435\u043d\u043e`;
        setStatus(mergeStatus, summary, "ok");

        downloadJsonBtn.style.display = "inline-flex";
        downloadExcelBtn.style.display = "inline-flex";
        copyBtn.style.display = "inline-flex";
    } catch (err) {
        console.error(err);
        setStatus(mergeStatus, "\u274c " + err.message, "err");
    }
}

// ── Downloads ────────────────────────────────────────────────────────────────
function downloadJSON() {
    if (!mergedData) return;
    const raw = JSON.stringify(mergedData, null, 2);
    const blob = new Blob([raw], { type: "application/json" });
    downloadBlob(blob, "project_merged.json");
}

function downloadExcel() {
    if (!mergedData) return;
    const projectInfo = pipelineMode === "word+excel" ? wordData : null;
    const apartments = mergedData;
    const blob = createExcelFromData(apartments, projectInfo);
    downloadBlob(blob, "project_merged.xlsx");
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function copyJSON() {
    if (!mergedData) return;
    const raw = JSON.stringify(mergedData, null, 2);
    navigator.clipboard.writeText(raw).then(() => {
        copyBtn.textContent = "copied \u2713";
        copyBtn.classList.add("copied");
        setTimeout(() => {
            copyBtn.textContent = "copy";
            copyBtn.classList.remove("copied");
        }, 2000);
    });
}

// ── JSON → Excel converter ──────────────────────────────────────────────────
let loadedJsonForExcel = null;

async function processJsonFile(files) {
    const file = files[0];
    if (!file.name.endsWith(".json")) {
        setStatus(jsonStatus, "❌ Нужен .json файл", "err");
        return;
    }
    jsonDropZone.classList.add("has-file");
    jsonFileName.textContent = file.name;
    setStatus(jsonStatus, "⏳ Читаю JSON…", "");

    try {
        const text = await file.text();
        jsonTextInput.value = text;

        setStatus(jsonStatus, "✓ Файл загружен в редактор. Исправьте ошибки (если есть) и нажмите Process JSON.", "ok");
    } catch (err) {
        console.error(err);
        setStatus(jsonStatus, "❌ " + err.message, "err");
    }
}

btnProcessJsonText.addEventListener("click", () => {
    const text = jsonTextInput.value.trim();
    if (!text) {
        setStatus(jsonStatus, "❌ Пустой JSON", "err");
        return;
    }
    setStatus(jsonStatus, "⏳ Проверяю JSON…", "");
    try {
        loadedJsonForExcel = JSON.parse(text);
        const isArray = Array.isArray(loadedJsonForExcel);
        const count = isArray ? loadedJsonForExcel.length : (loadedJsonForExcel.apartments?.length || 0);
        setStatus(jsonStatus, `✓ JSON корректен — ${count} квартир ready for pipeline.`, "ok");
        downloadFromJsonBtn.style.display = "inline-flex";
    } catch (err) {
        console.error(err);
        setStatus(jsonStatus, "❌ Ошибка формата JSON: " + err.message + ". Исправьте текст выше.", "err");
        downloadFromJsonBtn.style.display = "none";
    }
});

function downloadExcelFromJson() {
    if (!loadedJsonForExcel) return;
    const blob = jsonToExcel(loadedJsonForExcel);
    downloadBlob(blob, "converted.xlsx");
}

// ── Wire up events ───────────────────────────────────────────────────────────
btnModeWordExcel.addEventListener("click", () => startPipeline("word+excel"));
btnModeMultiExcel.addEventListener("click", () => startPipeline("multi-excel"));
btnModeJsonExcel.addEventListener("click", startJsonConverter);
btnBackToMode.addEventListener("click", showModeScreen);
btnBackToMode2.addEventListener("click", showModeScreen);

setupDropZone(wordDropZone, wordInput, processWordFile);
setupDropZone(excelDropZone, excelInput, processExcelFiles);
setupDropZone(jsonDropZone, jsonInput, processJsonFile);

mergeBtn.addEventListener("click", doMerge);
downloadJsonBtn.addEventListener("click", downloadJSON);
downloadExcelBtn.addEventListener("click", downloadExcel);
copyBtn.addEventListener("click", copyJSON);
downloadFromJsonBtn.addEventListener("click", downloadExcelFromJson);

btnEditMergeJson.addEventListener("click", () => {
    if (mergePreview.style.display !== "none") {
        // Switch to Edit Mode
        mergeTextarea.value = JSON.stringify(mergedData, null, 2);
        mergePreview.style.display = "none";
        mergeTextarea.style.display = "block";
        btnEditMergeJson.textContent = "Save JSON";
        btnEditMergeJson.classList.replace("btn-secondary", "btn-primary");
    } else {
        // Save Mode
        try {
            mergedData = JSON.parse(mergeTextarea.value);
            mergeTextarea.style.display = "none";
            mergePreview.style.display = "";
            btnEditMergeJson.textContent = "Edit JSON";
            btnEditMergeJson.classList.replace("btn-primary", "btn-secondary");
            renderJSON(mergePreview, mergedData, 80);
            setStatus(mergeStatus, "✓ JSON успешно обновлен вручную!", "ok");
        } catch (e) {
            setStatus(mergeStatus, "❌ Ошибка JSON: " + e.message, "err");
        }
    }
});

btnEditWordJson.addEventListener("click", () => {
    if (!wordData) return;
    if (wordPreview.style.display !== "none") {
        wordTextarea.value = JSON.stringify(wordData, null, 2);
        wordPreview.style.display = "none";
        wordTextarea.style.display = "block";
        btnEditWordJson.textContent = "Save JSON";
        btnEditWordJson.classList.replace("btn-secondary", "btn-primary");
    } else {
        try {
            wordData = JSON.parse(wordTextarea.value);
            wordTextarea.style.display = "none";
            wordPreview.style.display = "";
            btnEditWordJson.textContent = "Edit JSON";
            btnEditWordJson.classList.replace("btn-primary", "btn-secondary");
            renderJSON(wordPreview, wordData, 80);
            const keyCount = Object.keys(wordData).length;
            wordKeyCount.textContent = `${keyCount} fields`;
            setStatus(wordStatus, `✓ Готово — ${keyCount} полей (изменено вручную)`, "ok");
        } catch (e) {
            setStatus(wordStatus, "❌ Ошибка JSON: " + e.message, "err");
        }
    }
});

btnEditExcelJson.addEventListener("click", () => {
    if (excelDataSets.length === 0) return;
    if (excelPreview.style.display !== "none") {
        const allFlats = excelDataSets.flatMap(ds => ds.flats);
        excelTextarea.value = JSON.stringify(allFlats, null, 2);
        excelPreview.style.display = "none";
        excelTextarea.style.display = "block";
        btnEditExcelJson.textContent = "Save JSON";
        btnEditExcelJson.classList.replace("btn-secondary", "btn-primary");
    } else {
        try {
            const parsedFlats = JSON.parse(excelTextarea.value);
            excelDataSets = [{ fileName: "manual_edit.json", flats: parsedFlats }];
            excelTextarea.style.display = "none";
            excelPreview.style.display = "";
            btnEditExcelJson.textContent = "Edit JSON";
            btnEditExcelJson.classList.replace("btn-primary", "btn-secondary");
            renderJSON(excelPreview, parsedFlats, 30);
            excelFlatCount.textContent = `${parsedFlats.length} flats`;
            setStatus(excelStatus, `✓ ${parsedFlats.length} квартир (изменено вручную)`, "ok");
        } catch (e) {
            setStatus(excelStatus, "❌ Ошибка JSON: " + e.message, "err");
        }
    }
});

// Init
showModeScreen();
