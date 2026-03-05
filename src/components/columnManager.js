const STORAGE_KEY = "dt_column_settings";

export const COLUMN_METADATA = {
    "building": { desc: "The name of the building or project." },
    "sheet": { desc: "The original Excel sheet name." },
    "id": { desc: "Apartment ID or number." },
    "floor": { desc: "Floor number of the apartment." },
    "rooms": { desc: "Number of rooms." },
    "price": { desc: "Total price of the apartment." },
    "price_sqm": { desc: "Price per square meter." },
    "area": { desc: "Primary area used for calculations (in sqm)." },
    "area_orig": { desc: "Original area extracted from the document." },
    "status": { desc: "Availability status (e.g., Sold, Available)." },
    "currency": { desc: "Currency symbol (e.g., $, ֏, €)." },
    "source_file": { desc: "The name of the source Excel file." }
};

/**
 * Applies saved column settings (deletions + renames) to data array.
 * Can be called statically without an instance — e.g. right after merge.
 * Returns new array with columns removed/renamed per stored settings.
 */
export function applyStoredColumnSettings(data) {
    if (!data || !data.length) return data;

    const saved = loadColumnSettings();
    if (!saved) return data;

    const { deleted, renamed } = saved;
    const hasDeleted = deleted && deleted.length > 0;
    const hasRenamed = renamed && Object.keys(renamed).length > 0;

    if (!hasDeleted && !hasRenamed) return data;

    return data.map(item => {
        const newItem = {};
        for (const key of Object.keys(item)) {
            // Skip deleted columns
            if (hasDeleted && deleted.includes(key)) continue;
            // Rename if needed
            const finalKey = (hasRenamed && renamed[key]) ? renamed[key] : key;
            newItem[finalKey] = item[key];
        }
        return newItem;
    });
}

function loadColumnSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function saveColumnSettings(settings) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // quota exceeded or similar — silently ignore
    }
}

export function clearColumnSettings() {
    localStorage.removeItem(STORAGE_KEY);
}

export class ColumnManager {
    constructor(mergedData, onSaveCallback) {
        this.mergedData = mergedData || [];
        this.onSaveCallback = onSaveCallback;

        this.overlay = document.getElementById("colManagerOverlay");
        this.body = document.getElementById("colManagerBody");
        this.btnSave = document.getElementById("btnColManagerSave");
        this.btnCancel = document.getElementById("btnColManagerCancel");
        this.btnClose = document.getElementById("btnColManagerClose");
        this.btnReset = document.getElementById("btnColManagerReset");

        this.columns = []; // Array of { origName, newName, deleted }

        this.bindEvents();
    }

    bindEvents() {
        this.btnSave.onclick = () => this.save();
        this.btnCancel.onclick = () => this.close();
        this.btnClose.onclick = () => this.close();
        if (this.btnReset) {
            this.btnReset.onclick = () => this.resetAll();
        }
        // Close on clicking outside modal
        this.overlay.onclick = (e) => {
            if (e.target === this.overlay) this.close();
        };
    }

    open() {
        // Find all unique columns from current data
        const allKeys = new Set();
        this.mergedData.forEach(item => {
            Object.keys(item).forEach(k => allKeys.add(k));
        });

        // Load saved settings
        const saved = loadColumnSettings();

        // Initialize state — overlay saved renames/deletions on top
        this.columns = Array.from(allKeys).map(key => ({
            origName: key,
            newName: (saved && saved.renamed && saved.renamed[key]) ? saved.renamed[key] : key,
            deleted: (saved && saved.deleted && saved.deleted.includes(key)) ? true : false
        }));

        // Also add columns that are in saved.deleted but NOT in current data
        // (so user can see & restore them)
        if (saved && saved.deleted) {
            for (const delKey of saved.deleted) {
                if (!allKeys.has(delKey)) {
                    this.columns.push({
                        origName: delKey,
                        newName: delKey,
                        deleted: true
                    });
                }
            }
        }

        this.render();
        this.overlay.classList.add("visible");
    }

    close() {
        this.overlay.classList.remove("visible");
    }

    resetAll() {
        clearColumnSettings();
        // Re-initialize all columns as not deleted, original names
        this.columns = this.columns
            .filter(col => {
                // Remove columns that don't exist in current data (ghost deleted ones)
                const allKeys = new Set();
                this.mergedData.forEach(item => Object.keys(item).forEach(k => allKeys.add(k)));
                return allKeys.has(col.origName);
            })
            .map(col => ({
                origName: col.origName,
                newName: col.origName,
                deleted: false
            }));
        this.render();
    }

    render() {
        this.body.innerHTML = "";

        if (this.columns.length === 0) {
            this.body.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-style: italic; padding: 20px;">No columns found.</div>`;
            return;
        }

        // Show saved-settings indicator
        const saved = loadColumnSettings();
        if (saved && (saved.deleted?.length || Object.keys(saved.renamed || {}).length)) {
            const indicator = document.createElement("div");
            indicator.style.cssText = "font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; color: var(--accent); padding: 8px 0 12px; border-bottom: 1px solid var(--border); margin-bottom: 8px;";
            const dCount = saved.deleted?.length || 0;
            const rCount = Object.keys(saved.renamed || {}).length;
            indicator.textContent = `💾 Saved settings: ${dCount} deleted, ${rCount} renamed`;
            this.body.appendChild(indicator);
        }

        this.columns.forEach((col, index) => {
            const row = document.createElement("div");
            row.className = `col-row ${col.deleted ? "deleted" : ""}`;

            const meta = COLUMN_METADATA[col.origName] || { desc: "Custom or extracted property." };

            // Info block
            const infoDiv = document.createElement("div");
            infoDiv.className = "col-info";
            infoDiv.innerHTML = `
                <div class="col-name-orig">${col.origName}</div>
                <div class="col-desc">${meta.desc}</div>
            `;

            // Input block
            const inputDiv = document.createElement("div");
            const input = document.createElement("input");
            input.className = "col-input";
            input.type = "text";
            input.value = col.newName;
            input.disabled = col.deleted;
            input.placeholder = "New column name...";
            input.oninput = (e) => {
                col.newName = e.target.value.trim();
            };
            inputDiv.appendChild(input);

            // Action block
            const actionDiv = document.createElement("div");
            const btnToggle = document.createElement("button");
            btnToggle.className = "col-delete-btn";
            btnToggle.innerHTML = col.deleted ? "↩ Restore" : "🗑 Delete";
            btnToggle.onclick = () => {
                col.deleted = !col.deleted;
                this.render(); // re-render to update UI state
            };
            actionDiv.appendChild(btnToggle);

            row.appendChild(infoDiv);
            row.appendChild(inputDiv);
            row.appendChild(actionDiv);

            this.body.appendChild(row);
        });
    }

    save() {
        // Build settings to persist
        const deleted = [];
        const renamed = {};

        this.columns.forEach(col => {
            if (col.deleted) {
                deleted.push(col.origName);
            } else if (col.newName && col.newName !== col.origName) {
                renamed[col.origName] = col.newName;
            }
        });

        // Persist to localStorage
        saveColumnSettings({ deleted, renamed });

        // Apply transformations to data
        const transformedData = this.mergedData.map(item => {
            const newItem = {};
            this.columns.forEach(col => {
                // If it's not deleted, add it to the new item under the new name
                if (!col.deleted && item.hasOwnProperty(col.origName)) {
                    const finalName = col.newName || col.origName;
                    newItem[finalName] = item[col.origName];
                }
            });
            return newItem;
        });

        if (this.onSaveCallback) {
            this.onSaveCallback(transformedData);
        }

        this.close();
    }
}
