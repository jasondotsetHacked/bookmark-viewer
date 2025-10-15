const SIGNATURE_STORAGE_KEY = 'signatureModule:text';
const SIGNATURE_AUTOSYNC_KEY = 'signatureModule:autoSync';

const TRACKABLE_LABEL_PATTERNS = [
    /^--\s*[A-Z0-9]{3}/i,
    /^-\s*[A-Z0-9]{3}/i,
    /^[A-Z0-9]{3}-\d{3}/i
];

const signatureState = {
    rawText: '',
    autoSync: true,
    signatures: [],
    bookmarksAll: [],
    activeBookmarks: [],
    bookmarkIndex: new Map(),
    matches: [],
    missing: [],
    stale: [],
    currentSystem: null
};

function initSignatureModule() {
    const input = document.getElementById('signatureInput');
    const applyButton = document.getElementById('processSignatureButton');
    const clearButton = document.getElementById('clearSignatureButton');
    const autoSyncToggle = document.getElementById('signatureAutoSync');

    if (!input || !applyButton || !clearButton || !autoSyncToggle) {
        console.warn('Signature module elements missing from DOM');
        return;
    }

    const storedText = localStorage.getItem(SIGNATURE_STORAGE_KEY) ?? '';
    const storedAutoSync = localStorage.getItem(SIGNATURE_AUTOSYNC_KEY);

    if (storedText) {
        input.value = storedText;
        signatureState.rawText = storedText;
    }
    if (storedAutoSync !== null) {
        signatureState.autoSync = storedAutoSync === 'true';
        autoSyncToggle.checked = signatureState.autoSync;
    }

    applyButton.addEventListener('click', () => {
        signatureState.rawText = input.value;
        persistSignatureText();
        runSignatureAnalysis({ reparse: true });
    });

    clearButton.addEventListener('click', () => {
        input.value = '';
        signatureState.rawText = '';
        persistSignatureText();
        signatureState.signatures = [];
        runSignatureAnalysis({ reparse: false });
    });

    input.addEventListener('input', () => {
        signatureState.rawText = input.value;
        if (signatureState.autoSync) {
            persistSignatureText();
            runSignatureAnalysis({ reparse: true });
        }
    });

    autoSyncToggle.addEventListener('change', (event) => {
        signatureState.autoSync = Boolean(event.target.checked);
        localStorage.setItem(SIGNATURE_AUTOSYNC_KEY, signatureState.autoSync ? 'true' : 'false');
        if (signatureState.autoSync) {
            runSignatureAnalysis({ reparse: true });
        }
    });

    if (signatureState.rawText.trim()) {
        runSignatureAnalysis({ reparse: true });
    } else {
        updateSignatureUI();
    }
}

function persistSignatureText() {
    try {
        localStorage.setItem(SIGNATURE_STORAGE_KEY, signatureState.rawText);
    } catch (error) {
        console.warn('Unable to persist signature text', error);
    }
}

function runSignatureAnalysis({ reparse = true } = {}) {
    if (reparse) {
        signatureState.signatures = parseSignatures(signatureState.rawText);
    }
    signatureState.activeBookmarks = collectActiveBookmarks();
    rebuildBookmarkIndex();
    computeSignatureMatches();
    updateSignatureUI();
}

function parseSignatures(rawText) {
    return rawText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => {
            const columns = line.split('\t').map((cell) => cell.trim());
            const primary = columns[0] ?? '';
            const idMatch = primary.match(/([A-Z0-9]{3})[- ]?([A-Z0-9]{3})?/i);
            const signatureId = primary.toUpperCase();
            const prefix = idMatch ? idMatch[1].toUpperCase() : null;
            return {
                index,
                line,
                columns,
                signatureId,
                prefix,
                distance: columns[columns.length - 1] || ''
            };
        })
        .filter((entry) => entry.prefix);
}

function collectActiveBookmarks() {
    if (!signatureState.currentSystem) {
        return [];
    }

    return signatureState.bookmarksAll.filter((row) => {
        if (!row || row.SOL !== signatureState.currentSystem) {
            return false;
        }
        return isTrackableBookmark(row.Label);
    });
}

function setBookmarkData(bookmarks) {
    signatureState.bookmarksAll = Array.isArray(bookmarks) ? bookmarks : [];
    runSignatureAnalysis({ reparse: false });
}

function setSignatureActiveSystem(systemName, bookmarks) {
    signatureState.currentSystem = systemName || null;
    if (Array.isArray(bookmarks)) {
        signatureState.bookmarksAll = bookmarks;
    }
    runSignatureAnalysis({ reparse: false });
}

function rebuildBookmarkIndex() {
    const index = new Map();
    signatureState.activeBookmarks.forEach((row, rowIndex) => {
        const label = row?.Label || '';
        const prefix = extractBookmarkPrefix(label);
        if (!prefix) {
            return;
        }

        const key = resolveBookmarkKey(row);
        const entry = {
            key,
            row,
            label,
            prefix,
            rowIndex
        };

        if (!index.has(prefix)) {
            index.set(prefix, []);
        }
        index.get(prefix).push(entry);
    });
    signatureState.bookmarkIndex = index;
}

function computeSignatureMatches() {
    const bookmarkStatus = new Map();
    const hasSystem = Boolean(signatureState.currentSystem);
    const hasSignatures = signatureState.signatures.length > 0;

    if (!hasSystem || !hasSignatures) {
        signatureState.matches = [];
        signatureState.missing = [];
        signatureState.stale = [];
        pushBookmarkHighlights(new Map());
        return;
    }

    if (signatureState.activeBookmarks.length === 0) {
        signatureState.matches = [];
        signatureState.missing = [...signatureState.signatures];
        signatureState.stale = [];
        pushBookmarkHighlights(new Map());
        return;
    }

    const matchedEntries = [];
    const missingSignatures = [];
    const matchedKeys = new Set();

    signatureState.signatures.forEach((signature) => {
        const candidates = signatureState.bookmarkIndex.get(signature.prefix) || [];
        if (candidates.length === 0) {
            missingSignatures.push(signature);
            return;
        }

        const available = candidates.find((candidate) => !matchedKeys.has(candidate.key)) || candidates[0];
        matchedKeys.add(available.key);
        bookmarkStatus.set(available.key, 'matched');
        matchedEntries.push({
            signature,
            bookmark: available.row
        });
    });

    const staleBookmarks = [];
    signatureState.bookmarkIndex.forEach((entries) => {
        entries.forEach((entry) => {
            if (!matchedKeys.has(entry.key)) {
                staleBookmarks.push(entry.row);
                bookmarkStatus.set(entry.key, 'stale');
            }
        });
    });

    signatureState.matches = matchedEntries;
    signatureState.missing = missingSignatures;
    signatureState.stale = staleBookmarks;

    pushBookmarkHighlights(bookmarkStatus);
}

function pushBookmarkHighlights(statusMap) {
    if (typeof window.updateBookmarkSignatureMatches === 'function') {
        window.updateBookmarkSignatureMatches(statusMap);
    }
}

function updateSignatureUI() {
    const missingList = document.getElementById('missingSignaturesList');
    const staleList = document.getElementById('staleBookmarksList');
    const matchedList = document.getElementById('matchedSignaturesList');
    const missingCount = document.getElementById('summaryMissingCount');
    const staleCount = document.getElementById('summaryStaleCount');
    const matchedCount = document.getElementById('summaryMatchedCount');
    const systemDisplay = document.getElementById('signatureActiveSystem');

    if (systemDisplay) {
        systemDisplay.textContent = signatureState.currentSystem
            ? `System: ${signatureState.currentSystem}`
            : 'No system selected';
    }

    const hasSystem = Boolean(signatureState.currentSystem);
    const hasSignatures = signatureState.signatures.length > 0;

    if (!hasSystem) {
        renderList(missingList, [], () => '', 'Select a system on the map to begin.');
        renderList(staleList, [], () => '', '');
        renderList(matchedList, [], () => '', '');
        updateSummaryCounts({ missing: 0, stale: 0, matched: 0 }, missingCount, staleCount, matchedCount);
        return;
    }

    if (!hasSignatures) {
        renderList(missingList, [], () => '', 'Paste signature scan results to compare.');
        renderList(staleList, [], () => '', '');
        renderList(matchedList, [], () => '', '');
        updateSummaryCounts({ missing: 0, stale: 0, matched: 0 }, missingCount, staleCount, matchedCount);
        return;
    }

    renderList(
        missingList,
        signatureState.missing,
        (signature) => `<li>${signature.signatureId}</li>`,
        signatureState.missing.length ? '' : 'All signatures accounted for.'
    );
    renderList(
        staleList,
        signatureState.stale,
        (row) => `<li>${row.Label || 'Unknown bookmark'}</li>`,
        signatureState.stale.length ? '' : 'No stale bookmarks.'
    );
    renderList(
        matchedList,
        signatureState.matches,
        ({ signature, bookmark }) => `<li>${signature.signatureId} ↔ ${bookmark.Label}</li>`,
        signatureState.matches.length ? '' : 'No matches yet.'
    );

    updateSummaryCounts(
        {
            missing: signatureState.missing.length,
            stale: signatureState.stale.length,
            matched: signatureState.matches.length
        },
        missingCount,
        staleCount,
        matchedCount
    );
}

function renderList(target, items, renderItem, placeholder) {
    if (!target) {
        return;
    }

    if (!items || items.length === 0) {
        target.innerHTML = placeholder
            ? `<li class="signature-placeholder">${placeholder}</li>`
            : '';
        return;
    }

    target.innerHTML = items.map(renderItem).join('');
}

function updateSummaryCounts(counts, missingCountEl, staleCountEl, matchedCountEl) {
    if (missingCountEl) {
        missingCountEl.textContent = String(counts.missing ?? 0);
    }
    if (staleCountEl) {
        staleCountEl.textContent = String(counts.stale ?? 0);
    }
    if (matchedCountEl) {
        matchedCountEl.textContent = String(counts.matched ?? 0);
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

document.addEventListener('DOMContentLoaded', initSignatureModule);

window.setSignatureBookmarkData = setBookmarkData;
window.setSignatureActiveSystem = setSignatureActiveSystem;
window.rebuildSignatureMatches = () => runSignatureAnalysis({ reparse: true });
window.extractBookmarkPrefix = extractBookmarkPrefix;
window.createBookmarkKeyFallback = localBookmarkKey;
