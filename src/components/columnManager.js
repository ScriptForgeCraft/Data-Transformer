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

export class ColumnManager {
    constructor(mergedData, onSaveCallback) {
        this.mergedData = mergedData || [];
        this.onSaveCallback = onSaveCallback;

        this.overlay = document.getElementById("colManagerOverlay");
        this.body = document.getElementById("colManagerBody");
        this.btnSave = document.getElementById("btnColManagerSave");
        this.btnCancel = document.getElementById("btnColManagerCancel");
        this.btnClose = document.getElementById("btnColManagerClose");

        this.columns = []; // Array of { origName, newName, deleted }

        this.bindEvents();
    }

    bindEvents() {
        this.btnSave.onclick = () => this.save();
        this.btnCancel.onclick = () => this.close();
        this.btnClose.onclick = () => this.close();
        // Close on clicking outside modal
        this.overlay.onclick = (e) => {
            if (e.target === this.overlay) this.close();
        };
    }

    open() {
        // Find all unique columns
        const allKeys = new Set();
        this.mergedData.forEach(item => {
            Object.keys(item).forEach(k => allKeys.add(k));
        });

        // Initialize state
        this.columns = Array.from(allKeys).map(key => ({
            origName: key,
            newName: key,
            deleted: false
        }));

        this.render();
        this.overlay.classList.add("visible");
    }

    close() {
        this.overlay.classList.remove("visible");
    }

    render() {
        this.body.innerHTML = "";

        if (this.columns.length === 0) {
            this.body.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-style: italic; padding: 20px;">No columns found.</div>`;
            return;
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
        // Apply transformations to data
        const transformedData = this.mergedData.map(item => {
            const newItem = {};
            this.columns.forEach(col => {
                // If it's not deleted, add it to the new item under the new name
                if (!col.deleted && item.hasOwnProperty(col.origName)) {
                    // Use newName if available, else fallback to origName
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
