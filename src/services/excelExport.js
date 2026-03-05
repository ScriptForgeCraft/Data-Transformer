import * as XLSX from "xlsx";

/**
 * Convert an array of apartment objects to an Excel workbook Blob.
 * @param {Array} apartments - array of flat objects
 * @param {Object} [projectData] - optional project info from Word
 * @returns {Blob} - Excel file as Blob
 */
export function createExcelFromData(apartments, projectData = null) {
    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Apartments ──────────────────────────────────────────────────
    if (apartments.length > 0) {
        const standardHeaders = [
            "building", "sheet", "floor", "id", "rooms",
            "price", "price_sqm", "area", "area_orig", "status"
        ];

        // Gather all unique keys from all objects to catch Word properties
        const allKeys = new Set();
        apartments.forEach(flat => Object.keys(flat).forEach(k => allKeys.add(k)));

        const extraHeaders = Array.from(allKeys).filter(k => !standardHeaders.includes(k));
        const headers = [...standardHeaders, ...extraHeaders];

        const rows = apartments.map(flat => headers.map(h => flat[h] ?? ""));
        const wsData = [headers, ...rows];
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // Auto-width columns
        ws["!cols"] = headers.map((h, i) => {
            const maxLen = Math.max(
                h.length,
                ...rows.map(r => String(r[i] ?? "").length)
            );
            return { wch: Math.min(maxLen + 2, 30) };
        });

        XLSX.utils.book_append_sheet(wb, ws, "Apartments");
    }

    // Generate buffer and create Blob
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    return new Blob([wbout], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
}

/**
 * Parse a JSON object (merged format) back into Excel Blob.
 * Expects { project: {...}, apartments: [...] } or just [...] array.
 */
export function jsonToExcel(jsonData) {
    if (Array.isArray(jsonData)) {
        return createExcelFromData(jsonData);
    }

    const apartments = jsonData.apartments || [];
    const project = jsonData.project || null;
    return createExcelFromData(apartments, project);
}
