function displayTable(keys, data, filterSystem = null) {
    const tableContainer = document.getElementById('tableContainer');
    const filteredData = filterSystem ? data.filter(row => row['SOL'] === filterSystem) : data;
    // Sort by Label (case-insensitive)
    const sortedData = [...filteredData].sort((a, b) => {
        const rawA = (a['Label'] || '').toString().trimStart();
        const rawB = (b['Label'] || '').toString().trimStart();

        const category = (s) => {
            if (s.startsWith('--')) return 0;            // Highest priority
            if (s.startsWith('-')) return 1;             // Next priority
            if (/^[^A-Za-z0-9]/.test(s)) return 2;       // Other special chars
            return 3;                                    // Alphanumeric A-Z 0-9
        };

        const catA = category(rawA);
        const catB = category(rawB);
        if (catA !== catB) return catA - catB;

        // Within the same category, sort case-insensitively by label ignoring leading non-alphanumerics
        const normalize = (s) => s.replace(/^[^A-Za-z0-9]+/, '');
        const la = normalize(rawA);
        const lb = normalize(rawB);
        return la.localeCompare(lb, undefined, { sensitivity: 'base' });
    });
    const excludeColumns = ["Jumps", "CON", "REG", "Date"];
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    keys.forEach(key => {
        if (!excludeColumns.includes(key)) {
            const th = document.createElement('th');
            th.textContent = key;
            headerRow.appendChild(th);
        }
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    sortedData.forEach(row => {
        const tr = document.createElement('tr');
        if (row['Label'] && row['Label'].startsWith('-')) {
            tr.classList.add('highlight');
        }
        keys.forEach(key => {
            if (!excludeColumns.includes(key)) {
                const td = document.createElement('td');
                td.textContent = row[key] || '';
                tr.appendChild(td);
            }
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableContainer.innerHTML = '';
    tableContainer.appendChild(table);
}

window.displayTable = displayTable;
