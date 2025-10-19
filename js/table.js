import { getRowExpiry, attachCountdown, clearCountdowns, TIMER_TAGS } from './bookmarkTimers.js';

const EXCLUDED_COLUMNS = ["Jumps", "CON", "REG", "Date"];
const REMAINING_COLUMN = 'Remaining';

let cachedKeys = [];
let cachedData = [];
let cachedFilter = null;
let highlightStatus = new Map();

function displayTable(keys, data, filterSystem = null) {
    cachedKeys = Array.isArray(keys) ? [...keys] : [];
    if (!cachedKeys.includes(REMAINING_COLUMN)) {
        const expiryIndex = cachedKeys.indexOf('Expiry');
        if (expiryIndex >= 0) {
            cachedKeys.splice(expiryIndex + 1, 0, REMAINING_COLUMN);
        } else {
            cachedKeys.push(REMAINING_COLUMN);
        }
    }
    cachedData = Array.isArray(data) ? data : [];
    cachedFilter = filterSystem;
    renderTable();

    if (typeof window.setSignatureBookmarkData === 'function') {
        window.setSignatureBookmarkData(cachedData);
    }
}

function renderTable() {
    const tableContainer = document.getElementById('tableContainer');
    if (!tableContainer) {
        return;
    }

    clearCountdowns(TIMER_TAGS.TABLE);

    const filteredData = cachedFilter
        ? cachedData.filter((row) => row['SOL'] === cachedFilter)
        : cachedData;
    const sortedData = sortRows(filteredData);

    const table = document.createElement('table');
    table.appendChild(buildHeaderRow());
    table.appendChild(buildBody(sortedData));

    tableContainer.innerHTML = '';
    tableContainer.appendChild(table);
}

function buildHeaderRow() {
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    cachedKeys.forEach((key) => {
        if (!EXCLUDED_COLUMNS.includes(key)) {
            const th = document.createElement('th');
            th.textContent = key;
            headerRow.appendChild(th);
        }
    });
    thead.appendChild(headerRow);
    return thead;
}

function buildBody(rows) {
    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
        const tr = document.createElement('tr');
        const label = (row['Label'] || '').toString();
        if (label.startsWith('-')) {
            tr.classList.add('highlight');
        }

        const status = highlightStatus.get(createBookmarkKey(row));
        if (status === 'matched') {
            tr.classList.add('bookmark-matched');
        } else if (status === 'stale') {
            tr.classList.add('bookmark-stale');
        }

        cachedKeys.forEach((key) => {
            if (!EXCLUDED_COLUMNS.includes(key)) {
                const td = document.createElement('td');
                if (key === REMAINING_COLUMN) {
                    td.classList.add('bookmark-remaining');
                    const expiryInfo = getRowExpiry(row);
                    attachCountdown(td, expiryInfo, {
                        tag: TIMER_TAGS.TABLE,
                        style: 'default'
                    });
                } else if (key === 'Expiry') {
                    td.textContent = row[key] ? row[key] : '—';
                } else {
                    td.textContent = row[key] || '';
                }
                tr.appendChild(td);
            }
        });
        tbody.appendChild(tr);
    });
    return tbody;
}

function sortRows(data) {
    const rows = [...data];
    return rows.sort((a, b) => {
        const rawA = (a['Label'] || '').toString().trimStart();
        const rawB = (b['Label'] || '').toString().trimStart();

        const catA = sortCategory(rawA);
        const catB = sortCategory(rawB);
        if (catA !== catB) {
            return catA - catB;
        }

        const la = normalizeLabel(rawA);
        const lb = normalizeLabel(rawB);
        return la.localeCompare(lb, undefined, { sensitivity: 'base' });
    });
}

function sortCategory(label) {
    if (label.startsWith('--')) return 0;
    if (label.startsWith('-')) return 1;
    if (/^[^A-Za-z0-9]/.test(label)) return 2;
    return 3;
}

function normalizeLabel(label) {
    return label.replace(/^[^A-Za-z0-9]+/, '');
}

function updateBookmarkSignatureMatches(statusMap) {
    if (statusMap instanceof Map) {
        highlightStatus = statusMap;
    } else {
        highlightStatus = new Map();
        Object.entries(statusMap || {}).forEach(([key, value]) => {
            highlightStatus.set(key, value);
        });
    }

    if (cachedKeys.length > 0 && cachedData.length > 0) {
        renderTable();
    }
}

function createBookmarkKey(row) {
    const parts = [
        row?.Label ?? '',
        row?.Type ?? '',
        row?.SOL ?? '',
        row?.Expiry ?? '',
        row?.Creator ?? ''
    ];
    return parts.join('|');
}

window.displayTable = displayTable;
window.updateBookmarkSignatureMatches = updateBookmarkSignatureMatches;
window.createBookmarkKey = createBookmarkKey;
window.renderActiveTable = renderTable;
window.getCurrentTableFilter = () => cachedFilter;
