import * as XLSX from "xlsx";
import { getStoredColumnSettings } from "../components/columnManager.js";

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
        // Preferred order for known headers
        const preferredOrder = [
            "building", "sheet", "floor", "id", "rooms",
            "price", "price_sqm", "area", "area_orig", "status", "currency"
        ];

        // Gather all unique keys from all objects to see what actually exists
        const allKeys = new Set();
        apartments.forEach(flat => Object.keys(flat).forEach(k => allKeys.add(k)));

        let headers = [];
        const settings = getStoredColumnSettings();
        const hasCustomOrder = settings && settings.order && settings.order.length > 0;

        if (hasCustomOrder) {
            headers = settings.order
                .map(orig => (settings.renamed && settings.renamed[orig]) ? settings.renamed[orig] : orig)
                .filter(k => allKeys.has(k));
            const extraHeaders = Array.from(allKeys).filter(k => !headers.includes(k));
            headers = [...headers, ...extraHeaders];
        } else {
            // Filter preferred order to only include keys that exist in the data
            const standardHeaders = preferredOrder.filter(k => allKeys.has(k));
            // Add any extra headers that aren't in the standard list
            const extraHeaders = Array.from(allKeys).filter(k => !standardHeaders.includes(k));
            headers = [...standardHeaders, ...extraHeaders];
        }

        const rows = apartments.map(flat => headers.map(h => flat[h] ?? ""));
        const wsData = [headers, ...rows];
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        for (let R = 1; R <= rows.length; ++R) {
            const flat = apartments[R - 1];
            const curLabel = String(flat.currency || "").trim();
            for (let C = 0; C < headers.length; ++C) {
                if (headers[C] === "price" || headers[C] === "price_sqm") {
                    const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
                    const cell = ws[cellAddress];
                    if (cell && cell.t === "n") {
                        if (curLabel === "$") cell.z = '"$"#,##0';
                        else if (curLabel === "€") cell.z = '[$€-2] #,##0';
                        else if (curLabel === "֏") cell.z = '#,##0 [$֏]';
                        else if (curLabel === "₽") cell.z = '#,##0 [$₽-419]';
                    }
                }
            }
        }

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
