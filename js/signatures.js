const SIGNATURE_DATA_KEY = 'signatureModule:systemSignatures:v1';

const TRACKABLE_LABEL_PATTERNS = [
    /^--\s*[A-Z0-9]{3}/i,
    /^-\s*[A-Z0-9]{3}/i,
    /^[A-Z0-9]{3}-\d{3}/i
];

const STATUS_LABELS = {
    missing: 'Needs scan',
    stale: 'Removable',
    matched: 'Matched'
};

const signatureState = {
    perSystem: new Map(),
    currentSystem: null,
    bookmarksAll: [],
    signatures: [],
    activeBookmarks: [],
    matches: [],
    missing: [],
    stale: [],
    tableRows: []
};

const signatureDom = {
    readButton: null,
    clearButton: null,
    tableContainer: null,
    statusLabel: null,
    message: null
};

let signatureMessageTimeout = null;

document.addEventListener('DOMContentLoaded', initSignatureModule);

function initSignatureModule() {
    signatureDom.readButton = document.getElementById('readSignaturesButton');
    signatureDom.clearButton = document.getElementById('clearSignaturesButton');
    signatureDom.tableContainer = document.getElementById('signatureTableContainer');
    signatureDom.statusLabel = document.getElementById('signatureActiveSystem');
    signatureDom.message = document.getElementById('signatureMessage');

    if (!signatureDom.readButton || !signatureDom.clearButton || !signatureDom.tableContainer) {
        console.warn('Signature module elements missing from DOM');
        return;
    }

    signatureState.perSystem = loadStoredSignatures();

    signatureDom.readButton.addEventListener('click', handleReadSignatures);
    signatureDom.clearButton.addEventListener('click', handleClearSignatures);

    updateSignatureUI();
}

function loadStoredSignatures() {
    try {
        const raw = localStorage.getItem(SIGNATURE_DATA_KEY);
        if (!raw) {
            return new Map();
        }
        const parsed = JSON.parse(raw);
        const map = new Map();
        Object.entries(parsed).forEach(([system, values]) => {
            if (!Array.isArray(values)) {
                return;
            }
            const normalized = values
                .map((entry) => normalizeStoredSignature(entry))
                .filter(Boolean);
            if (normalized.length > 0) {
                map.set(system, normalized);
            }
        });
        return map;
    } catch (error) {
        console.warn('Failed to load stored signatures', error);
        return new Map();
    }
}

function persistSignatures() {
    try {
        const payload = {};
        signatureState.perSystem.forEach((signatures, system) => {
            payload[system] = signatures.map((signature) => signature.signatureId);
        });
        localStorage.setItem(SIGNATURE_DATA_KEY, JSON.stringify(payload));
    } catch (error) {
        console.warn('Failed to persist signatures', error);
    }
}

function normalizeStoredSignature(entry) {
    if (!entry) {
        return null;
    }
    if (typeof entry === 'string') {
        return toSignatureObject(entry);
    }
    if (typeof entry.signatureId === 'string') {
        return toSignatureObject(entry.signatureId);
    }
    return null;
}

function toSignatureObject(value) {
    const cleaned = (value || '').trim().toUpperCase();
    const match = cleaned.match(/^([A-Z0-9]{3})[-\s]?([A-Z0-9]{3})$/);
    if (!match) {
        return null;
    }
    const prefix = match[1];
    const suffix = match[2];
    return {
        signatureId: `${prefix}-${suffix}`,
        prefix
    };
}

async function handleReadSignatures() {
    if (!signatureState.currentSystem) {
        showSignatureMessage('Select a system before reading signatures.', true);
        return;
    }

    try {
        const clipboardText = await navigator.clipboard.readText();
        const parsed = parseClipboardSignatures(clipboardText);
        if (parsed.length === 0) {
            showSignatureMessage('Clipboard did not contain recognizable signatures.', true);
            return;
        }
        signatureState.perSystem.set(signatureState.currentSystem, parsed);
        persistSignatures();
        signatureState.signatures = parsed;
        showSignatureMessage(`Loaded ${parsed.length} signatures from clipboard.`);
        runSignatureAnalysis();
    } catch (error) {
        console.error('Failed to read signatures from clipboard', error);
        showSignatureMessage('Unable to read clipboard. Grant permission and try again.', true);
    }
}

function handleClearSignatures() {
    const system = signatureState.currentSystem;
    if (!system) {
        return;
    }
    if (!signatureState.perSystem.has(system)) {
        showSignatureMessage('No stored signatures to clear for this system.', true);
        return;
    }
    signatureState.perSystem.delete(system);
    persistSignatures();
    signatureState.signatures = [];
    showSignatureMessage('Removed stored signatures for this system.');
    runSignatureAnalysis();
}

function parseClipboardSignatures(rawText) {
    if (!rawText) {
        return [];
    }

    return rawText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const columns = line.split('\t').map((cell) => cell.trim()).filter(Boolean);
            const candidate = columns[0] || line.split(/\s+/)[0];
            return toSignatureObject(candidate);
        })
        .filter(Boolean);
}

function setBookmarkData(bookmarks) {
    signatureState.bookmarksAll = Array.isArray(bookmarks) ? bookmarks : [];
    runSignatureAnalysis();
}

function setSignatureActiveSystem(systemName) {
    showSignatureMessage('');
    signatureState.currentSystem = systemName || null;
    if (signatureState.currentSystem && signatureState.perSystem.has(signatureState.currentSystem)) {
        signatureState.signatures = [...signatureState.perSystem.get(signatureState.currentSystem)];
    } else {
        signatureState.signatures = [];
    }
    runSignatureAnalysis();
}

function runSignatureAnalysis() {
    const system = signatureState.currentSystem;
    if (!system) {
        signatureState.activeBookmarks = [];
        signatureState.matches = [];
        signatureState.missing = [];
        signatureState.stale = [];
        signatureState.tableRows = [];
        pushBookmarkHighlights(new Map());
        updateSignatureUI();
        return;
    }

    signatureState.activeBookmarks = collectActiveBookmarks(system);

    if (!signatureState.signatures || signatureState.signatures.length === 0) {
        signatureState.matches = [];
        signatureState.missing = [];
        signatureState.stale = [];
        signatureState.tableRows = [];
        pushBookmarkHighlights(new Map());
        updateSignatureUI();
        return;
    }

    const results = computeSignatureMatches(signatureState.signatures, signatureState.activeBookmarks);
    signatureState.matches = results.matches;
    signatureState.missing = results.missing;
    signatureState.stale = results.stale;
    signatureState.tableRows = results.rows;
    pushBookmarkHighlights(results.bookmarkStatus);
    updateSignatureUI();
}

function collectActiveBookmarks(system) {
    return signatureState.bookmarksAll.filter((row) => {
        if (!row || row.SOL !== system) {
            return false;
        }
        return isTrackableBookmark(row.Label);
    });
}

function computeSignatureMatches(signatures, bookmarks) {
    const bookmarkIndex = new Map();
    const matchedKeys = new Set();
    const matches = [];
    const missing = [];
    const stale = [];
    const bookmarkStatus = new Map();

    bookmarks.forEach((row) => {
        const label = row?.Label || '';
        const prefix = extractBookmarkPrefix(label);
        if (!prefix) {
            return;
        }
        const key = resolveBookmarkKey(row);
        const entry = { key, row, prefix };
        if (!bookmarkIndex.has(prefix)) {
            bookmarkIndex.set(prefix, []);
        }
        bookmarkIndex.get(prefix).push(entry);
    });

    signatures.forEach((signature) => {
        const candidates = bookmarkIndex.get(signature.prefix) || [];
        if (candidates.length === 0) {
            missing.push(signature);
            return;
        }

        const available = candidates.find((candidate) => !matchedKeys.has(candidate.key)) || candidates[0];
        matchedKeys.add(available.key);
        bookmarkStatus.set(available.key, 'matched');
        matches.push({
            signature,
            bookmark: available.row
        });
    });

    bookmarkIndex.forEach((entries) => {
        entries.forEach((entry) => {
            if (!matchedKeys.has(entry.key)) {
                stale.push(entry.row);
                bookmarkStatus.set(entry.key, 'stale');
            }
        });
    });

    const rows = [];
    missing.forEach((signature) => {
        rows.push({
            status: 'missing',
            signatureId: signature.signatureId,
            bookmarkLabel: ''
        });
    });
    stale.forEach((row) => {
        rows.push({
            status: 'stale',
            signatureId: '',
            bookmarkLabel: row.Label || ''
        });
    });
    matches.forEach(({ signature, bookmark }) => {
        rows.push({
            status: 'matched',
            signatureId: signature.signatureId,
            bookmarkLabel: bookmark.Label || ''
        });
    });

    return { matches, missing, stale, bookmarkStatus, rows };
}

function updateSignatureUI() {
    if (signatureDom.statusLabel) {
        signatureDom.statusLabel.textContent = signatureState.currentSystem
            ? `System: ${signatureState.currentSystem}`
            : 'No system selected';
    }

    if (signatureDom.readButton) {
        signatureDom.readButton.disabled = !signatureState.currentSystem;
    }

    if (signatureDom.clearButton) {
        signatureDom.clearButton.disabled =
            !signatureState.currentSystem || signatureState.signatures.length === 0;
    }

    if (!signatureState.currentSystem) {
        clearSignatureDisplay();
        return;
    }

    if (signatureState.signatures.length === 0) {
        renderSignaturePlaceholder('No signatures stored. Use Read Clipboard after copying scan results.');
        return;
    }

    if (!signatureState.tableRows.length) {
        renderSignaturePlaceholder('No signature status to display.');
        return;
    }

    renderSignatureTable(signatureState.tableRows);
}

function renderSignaturePlaceholder(message, isError = false) {
    if (!signatureDom.tableContainer) {
        return;
    }
    const className = isError ? 'signature-placeholder signature-message-error' : 'signature-placeholder';
    signatureDom.tableContainer.innerHTML = `<p class="${className}">${message}</p>`;
}

function clearSignatureDisplay() {
    if (!signatureDom.tableContainer) {
        return;
    }
    signatureDom.tableContainer.innerHTML = '';
}

function renderSignatureTable(rows) {
    if (!signatureDom.tableContainer) {
        return;
    }
    const table = document.createElement('table');
    table.classList.add('signature-table');

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Signature', 'Bookmark', 'Status'].forEach((label) => {
        const th = document.createElement('th');
        th.textContent = label;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
        const tr = document.createElement('tr');
        if (row.status === 'missing') {
            tr.classList.add('bookmark-missing');
        } else if (row.status === 'stale') {
            tr.classList.add('bookmark-stale');
        } else if (row.status === 'matched') {
            tr.classList.add('bookmark-matched');
        }

        const signatureCell = document.createElement('td');
        signatureCell.textContent = row.signatureId || '—';

        const bookmarkCell = document.createElement('td');
        bookmarkCell.textContent = row.bookmarkLabel || '—';

        const statusCell = document.createElement('td');
        statusCell.textContent = STATUS_LABELS[row.status] || row.status;

        tr.append(signatureCell, bookmarkCell, statusCell);
        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    signatureDom.tableContainer.innerHTML = '';
    signatureDom.tableContainer.appendChild(table);
}

function showSignatureMessage(message, isError = false, timeoutMs = 6000) {
    if (!signatureDom.message) {
        return;
    }
    if (signatureMessageTimeout) {
        clearTimeout(signatureMessageTimeout);
        signatureMessageTimeout = null;
    }
    signatureDom.message.textContent = message || '';
    signatureDom.message.classList.toggle('error', Boolean(isError && message));
    if (message && timeoutMs) {
        signatureMessageTimeout = setTimeout(() => {
            signatureDom.message.textContent = '';
            signatureDom.message.classList.remove('error');
        }, timeoutMs);
    }
}

function pushBookmarkHighlights(statusMap) {
    if (typeof window.updateBookmarkSignatureMatches === 'function') {
        window.updateBookmarkSignatureMatches(statusMap);
    }
}

function isTrackableBookmark(label) {
    if (!label || typeof label !== 'string') {
        return false;
    }
    const trimmed = label.trim();
    return TRACKABLE_LABEL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function extractBookmarkPrefix(label) {
    if (!label) {
        return null;
    }
    const cleaned = label.trim().replace(/^[-\s]+/, '');
    const match = cleaned.match(/([A-Z0-9]{3})/);
    return match ? match[1].toUpperCase() : null;
}

function resolveBookmarkKey(row) {
    if (typeof window.createBookmarkKey === 'function') {
        return window.createBookmarkKey(row);
    }
    return localBookmarkKey(row);
}

function localBookmarkKey(row) {
    const parts = [
        row?.Label ?? '',
        row?.Type ?? '',
        row?.SOL ?? '',
        row?.Expiry ?? '',
        row?.Creator ?? ''
    ];
    return parts.join('|');
}

window.setSignatureBookmarkData = setBookmarkData;
window.setSignatureActiveSystem = setSignatureActiveSystem;
window.rebuildSignatureMatches = runSignatureAnalysis;
window.extractBookmarkPrefix = extractBookmarkPrefix;
window.createBookmarkKeyFallback = localBookmarkKey;



