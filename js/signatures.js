import { loadSystemsData } from './loadSystemsData.js';
const SIGNATURE_DATA_KEY = 'signatureModule:systemSignatures:v1';
const HISTORY_VERSION_SOURCE_CLIPBOARD = 'clipboard';
const HISTORY_VERSION_SOURCE_CLEAR = 'clear';

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

const SIGNATURE_OVERRIDE = {
    AUTO: 'auto',
    FORCE_ON: 'forceOn',
    FORCE_OFF: 'forceOff'
};
const VALID_OVERRIDE_STATES = new Set(Object.values(SIGNATURE_OVERRIDE));

let systemsDataPromise = null;
let systemsDataCache = null;
let wormholeTypeCache = null;
let systemNameLookup = null;

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
    historyBackButton: null,
    historyForwardButton: null,
    tableContainer: null,
    statusLabel: null,
    message: null,
    tutorialButton: null,
    tutorialModal: null,
    tutorialClose: null,
    tutorialConfirm: null
};

let signatureMessageTimeout = null;
let tutorialPreviousFocus = null;

document.addEventListener('DOMContentLoaded', initSignatureModule);

function initSignatureModule() {
    signatureDom.readButton = document.getElementById('readSignaturesButton');
    signatureDom.clearButton = document.getElementById('clearSignaturesButton');
    signatureDom.historyBackButton = document.getElementById('signatureHistoryBackButton');
    signatureDom.historyForwardButton = document.getElementById('signatureHistoryForwardButton');
    signatureDom.tableContainer = document.getElementById('signatureTableContainer');
    signatureDom.statusLabel = document.getElementById('signatureActiveSystem');
    signatureDom.message = document.getElementById('signatureMessage');
    signatureDom.tutorialButton = document.getElementById('wormholeTutorialButton');
    signatureDom.tutorialModal = document.getElementById('wormholeTutorialModal');
    signatureDom.tutorialClose = document.getElementById('wormholeTutorialCloseButton');
    signatureDom.tutorialConfirm = document.getElementById('wormholeTutorialConfirmButton');

    if (!signatureDom.readButton || !signatureDom.clearButton || !signatureDom.tableContainer) {
        console.warn('Signature module elements missing from DOM');
        return;
    }

    signatureState.perSystem = loadStoredSignatures();

    signatureDom.readButton.addEventListener('click', handleReadSignatures);
    signatureDom.clearButton.addEventListener('click', handleClearSignatures);
    if (signatureDom.historyBackButton) {
        signatureDom.historyBackButton.addEventListener('click', handleSignatureHistoryBack);
    }
    if (signatureDom.historyForwardButton) {
        signatureDom.historyForwardButton.addEventListener('click', handleSignatureHistoryForward);
    }

    wireTutorialModal();
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
        Object.entries(parsed || {}).forEach(([system, value]) => {
            const history = normalizeSystemHistory(value);
            if (history.versions.length > 0 || history.currentIndex >= 0 || history.overrides.size > 0) {
                map.set(system, history);
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
        signatureState.perSystem.forEach((history, system) => {
            if (!history || !Array.isArray(history.versions)) {
                return;
            }
            const serialized = serializeSystemHistory(history);
            if (serialized) {
                payload[system] = serialized;
            }
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
    let normalized = null;
    if (typeof entry === 'string') {
        normalized = toSignatureObject(entry);
    } else if (typeof entry.signatureId === 'string') {
        normalized = toSignatureObject(entry.signatureId, entry);
    }
    if (!normalized) {
        return null;
    }
    if (Array.isArray(normalized.rawColumns)) {
        normalized.rawColumns = [...normalized.rawColumns];
    } else if (normalized.rawColumns && !Array.isArray(normalized.rawColumns)) {
        delete normalized.rawColumns;
    }
    return normalized;
}

function createEmptySystemHistory() {
    return {
        versions: [],
        currentIndex: -1,
        overrides: new Map()
    };
}

function normalizeSystemHistory(value) {
    const history = createEmptySystemHistory();

    if (!value) {
        return history;
    }

    if (Array.isArray(value)) {
        const signatures = sanitizeSignatureList(value);
        const version = createHistoryVersion(signatures, { source: HISTORY_VERSION_SOURCE_CLIPBOARD });
        history.versions = [version];
        history.currentIndex = history.versions.length - 1;
        return history;
    }

    if (typeof value === 'object') {
        const rawVersions = Array.isArray(value.versions)
            ? value.versions
            : Array.isArray(value.history)
                ? value.history
                : null;

        if (rawVersions) {
            rawVersions.forEach((entry) => {
                const version = normalizeHistoryVersion(entry);
                if (version) {
                    history.versions.push(version);
                }
            });
        } else if (Array.isArray(value.signatures)) {
            const version = createHistoryVersion(value.signatures, {
                id: typeof value.id === 'string' ? value.id : null,
                timestamp: typeof value.timestamp === 'number' ? value.timestamp : Date.now(),
                source: typeof value.source === 'string' ? value.source : HISTORY_VERSION_SOURCE_CLIPBOARD
            });
            history.versions.push(version);
        }

        if (history.versions.length > 0) {
            const storedIndex = Number.isInteger(value.currentIndex)
                ? Number(value.currentIndex)
                : history.versions.length - 1;
            history.currentIndex = Math.min(Math.max(storedIndex, 0), history.versions.length - 1);
        }

        history.overrides = normalizeOverrideMap(value.overrides);
        return history;
    }

    return history;
}

function normalizeHistoryVersion(entry) {
    if (!entry) {
        return null;
    }
    if (Array.isArray(entry)) {
        return createHistoryVersion(entry, { source: HISTORY_VERSION_SOURCE_CLIPBOARD });
    }
    const signatures = Array.isArray(entry.signatures)
        ? entry.signatures
        : Array.isArray(entry.data)
            ? entry.data
            : Array.isArray(entry.items)
                ? entry.items
                : Array.isArray(entry.entries)
                    ? entry.entries
                    : Array.isArray(entry.signatureIds)
                        ? entry.signatureIds
                        : [];
    return createHistoryVersion(signatures, {
        id: typeof entry.id === 'string' ? entry.id : null,
        timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
        source: typeof entry.source === 'string' ? entry.source : HISTORY_VERSION_SOURCE_CLIPBOARD
    });
}

function normalizeOverrideMap(rawOverrides) {
    if (!rawOverrides) {
        return new Map();
    }
    if (rawOverrides instanceof Map) {
        const map = new Map();
        rawOverrides.forEach((value, key) => {
            if (
                typeof key === 'string' &&
                typeof value === 'string' &&
                value !== SIGNATURE_OVERRIDE.AUTO &&
                VALID_OVERRIDE_STATES.has(value)
            ) {
                map.set(key, value);
            }
        });
        return map;
    }
    const map = new Map();
    if (typeof rawOverrides === 'object') {
        Object.entries(rawOverrides).forEach(([key, value]) => {
            if (
                typeof key === 'string' &&
                typeof value === 'string' &&
                value !== SIGNATURE_OVERRIDE.AUTO &&
                VALID_OVERRIDE_STATES.has(value)
            ) {
                map.set(key, value);
            }
        });
    }
    return map;
}

function sanitizeSignatureList(signatures) {
    if (!Array.isArray(signatures)) {
        return [];
    }
    return signatures
        .map((entry) => normalizeStoredSignature(entry))
        .filter(Boolean);
}

function cloneSignatureList(signatures) {
    return sanitizeSignatureList(signatures);
}

function createHistoryVersion(signatures, { id = null, timestamp = Date.now(), source = HISTORY_VERSION_SOURCE_CLIPBOARD } = {}) {
    const normalizedSignatures = sanitizeSignatureList(signatures);
    return {
        id: id || generateHistoryVersionId(),
        timestamp,
        source,
        signatures: normalizedSignatures
    };
}

function generateHistoryVersionId() {
    return `v${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function serializeSystemHistory(history) {
    if (!history) {
        return null;
    }
    const versions = Array.isArray(history.versions) ? history.versions : [];
    const serializedVersions = versions.map((version) => ({
        id: typeof version.id === 'string' ? version.id : generateHistoryVersionId(),
        timestamp: typeof version.timestamp === 'number' ? version.timestamp : Date.now(),
        source: typeof version.source === 'string' ? version.source : HISTORY_VERSION_SOURCE_CLIPBOARD,
        signatures: sanitizeSignatureList(version.signatures)
    }));
    if (serializedVersions.length === 0 && getOverrideSize(history.overrides) === 0) {
        return null;
    }

    const normalizedIndex = serializedVersions.length === 0
        ? -1
        : Math.min(
            Math.max(
                Number.isInteger(history.currentIndex) ? Number(history.currentIndex) : serializedVersions.length - 1,
                0
            ),
            serializedVersions.length - 1
        );

    return {
        currentIndex: normalizedIndex,
        versions: serializedVersions,
        overrides: overridesMapToObject(history.overrides)
    };
}

function overridesMapToObject(overrides) {
    if (!overrides) {
        return {};
    }
    if (overrides instanceof Map) {
        const result = {};
        overrides.forEach((value, key) => {
            if (
                typeof key === 'string' &&
                typeof value === 'string' &&
                value !== SIGNATURE_OVERRIDE.AUTO &&
                VALID_OVERRIDE_STATES.has(value)
            ) {
                result[key] = value;
            }
        });
        return result;
    }
    if (typeof overrides === 'object') {
        const result = {};
        Object.entries(overrides).forEach(([key, value]) => {
            if (
                typeof key === 'string' &&
                typeof value === 'string' &&
                value !== SIGNATURE_OVERRIDE.AUTO &&
                VALID_OVERRIDE_STATES.has(value)
            ) {
                result[key] = value;
            }
        });
        return result;
    }
    return {};
}

function getOverrideSize(overrides) {
    if (!overrides) {
        return 0;
    }
    if (overrides instanceof Map) {
        return overrides.size;
    }
    if (typeof overrides === 'object') {
        return Object.keys(overrides).length;
    }
    return 0;
}

function getSystemHistory(system, { createIfMissing = false } = {}) {
    if (!system) {
        return null;
    }
    let history = signatureState.perSystem.get(system);
    if (!history && createIfMissing) {
        history = createEmptySystemHistory();
        signatureState.perSystem.set(system, history);
    }
    if (!history) {
        return null;
    }
    if (!Array.isArray(history.versions)) {
        history.versions = [];
    }
    if (!(history.overrides instanceof Map)) {
        history.overrides = normalizeOverrideMap(history.overrides);
    }
    if (!Number.isInteger(history.currentIndex)) {
        history.currentIndex = history.versions.length > 0 ? history.versions.length - 1 : -1;
    } else if (history.versions.length === 0) {
        history.currentIndex = -1;
    } else {
        history.currentIndex = Math.min(
            Math.max(history.currentIndex, 0),
            history.versions.length - 1
        );
    }
    return history;
}

function pushSystemVersion(system, signatures, source = HISTORY_VERSION_SOURCE_CLIPBOARD) {
    if (!system) {
        return { index: -1, version: null };
    }
    const history = getSystemHistory(system, { createIfMissing: true });
    const branchStart = Math.max(history.currentIndex, -1);
    const retainedVersions = history.versions.slice(0, branchStart + 1);
    const version = createHistoryVersion(signatures, { source });
    retainedVersions.push(version);
    history.versions = retainedVersions;
    const newIndex = retainedVersions.length - 1;
    history.currentIndex = newIndex;
    pruneOverridesForSystem(system, history);
    signatureState.perSystem.set(system, history);
    return { index: newIndex, version };
}

function applyHistoryIndex(system, index) {
    if (!system) {
        signatureState.signatures = [];
        return null;
    }
    const history = getSystemHistory(system);
    if (!history || history.versions.length === 0) {
        signatureState.signatures = [];
        return null;
    }
    const boundedIndex = Math.min(Math.max(index, 0), history.versions.length - 1);
    history.currentIndex = boundedIndex;
    signatureState.perSystem.set(system, history);
    const version = history.versions[boundedIndex];
    signatureState.signatures = cloneSignatureList(version.signatures);
    return version;
}

function getHistoryNavigationState(system) {
    const history = getSystemHistory(system);
    if (!history || history.versions.length === 0 || history.currentIndex < 0) {
        return { hasBack: false, hasForward: false };
    }
    return {
        hasBack: history.currentIndex > 0,
        hasForward: history.currentIndex < history.versions.length - 1
    };
}

function describeSignatureCount(count) {
    return `${count} signature${count === 1 ? '' : 's'}`;
}

function formatHistoryActionMessage(action, version) {
    if (!version) {
        return `${action} to empty signature set.`;
    }
    const count = version.signatures ? version.signatures.length : 0;
    return `${action} to ${describeSignatureCount(count)}.`;
}

function pruneOverridesForSystem(system, history = null) {
    if (!system) {
        return;
    }
    const targetHistory = history || getSystemHistory(system);
    if (!targetHistory || !(targetHistory.overrides instanceof Map) || targetHistory.overrides.size === 0) {
        return;
    }
    const knownIds = new Set();
    targetHistory.versions.forEach((version) => {
        (version?.signatures || []).forEach((signature) => {
            if (signature && typeof signature.signatureId === 'string') {
                knownIds.add(signature.signatureId);
            }
        });
    });
    if (knownIds.size === 0) {
        targetHistory.overrides.clear();
        signatureState.perSystem.set(system, targetHistory);
        return;
    }
    let removed = false;
    targetHistory.overrides.forEach((_, key) => {
        if (!knownIds.has(key)) {
            targetHistory.overrides.delete(key);
            removed = true;
        }
    });
    if (removed) {
        signatureState.perSystem.set(system, targetHistory);
    }
}

function getSignatureOverrideState(system, signatureId) {
    if (!system || !signatureId) {
        return SIGNATURE_OVERRIDE.AUTO;
    }
    const history = getSystemHistory(system);
    if (!history || !(history.overrides instanceof Map)) {
        return SIGNATURE_OVERRIDE.AUTO;
    }
    const state = history.overrides.get(signatureId);
    if (typeof state !== 'string' || !VALID_OVERRIDE_STATES.has(state)) {
        return SIGNATURE_OVERRIDE.AUTO;
    }
    return state;
}

function cycleSignatureOverrideState(system, signatureId) {
    if (!system || !signatureId) {
        return SIGNATURE_OVERRIDE.AUTO;
    }
    const history = getSystemHistory(system, { createIfMissing: true });
    if (!(history.overrides instanceof Map)) {
        history.overrides = new Map();
    }
    const current = getSignatureOverrideState(system, signatureId);
    let nextState;
    if (current === SIGNATURE_OVERRIDE.AUTO) {
        nextState = SIGNATURE_OVERRIDE.FORCE_ON;
    } else if (current === SIGNATURE_OVERRIDE.FORCE_ON) {
        nextState = SIGNATURE_OVERRIDE.FORCE_OFF;
    } else {
        nextState = SIGNATURE_OVERRIDE.AUTO;
    }
    if (nextState === SIGNATURE_OVERRIDE.AUTO) {
        history.overrides.delete(signatureId);
    } else {
        history.overrides.set(signatureId, nextState);
    }
    signatureState.perSystem.set(system, history);
    return nextState;
}

function applyOverrideToDetection(autoDetection, overrideState) {
    if (overrideState === SIGNATURE_OVERRIDE.FORCE_ON) {
        return true;
    }
    if (overrideState === SIGNATURE_OVERRIDE.FORCE_OFF) {
        return false;
    }
    return Boolean(autoDetection);
}

function resolveOverrideLabel(state) {
    switch (state) {
        case SIGNATURE_OVERRIDE.FORCE_ON:
            return 'On';
        case SIGNATURE_OVERRIDE.FORCE_OFF:
            return 'Off';
        default:
            return 'Auto';
    }
}

function resolveOverrideTooltip(state) {
    switch (state) {
        case SIGNATURE_OVERRIDE.FORCE_ON:
            return 'Actions forced on for this signature. Click to hide or revert.';
        case SIGNATURE_OVERRIDE.FORCE_OFF:
            return 'Actions hidden for this signature. Click to return to auto.';
        default:
            return 'Actions follow automatic detection. Click to force on.';
    }
}

function formatOverrideToggleMessage(signatureId, state) {
    const suffix = signatureId ? ` for ${signatureId}` : '';
    switch (state) {
        case SIGNATURE_OVERRIDE.FORCE_ON:
            return `Actions enabled${suffix}.`;
        case SIGNATURE_OVERRIDE.FORCE_OFF:
            return `Actions hidden${suffix}.`;
        default:
            return `Actions reverted to auto detection${suffix}.`;
    }
}

function toSignatureObject(value, metadata = {}) {
    const cleaned = (value || '').trim().toUpperCase();
    const match = cleaned.match(/^([A-Z0-9]{3})[-\s]?([A-Z0-9]{3})$/);
    if (!match) {
        return null;
    }
    const prefix = match[1];
    const suffix = match[2];
    const signature = {
        signatureId: `${prefix}-${suffix}`,
        prefix,
        suffix
    };
    if (metadata && typeof metadata === 'object') {
        Object.entries(metadata).forEach(([key, metaValue]) => {
            if (key === 'signatureId' || key === 'prefix') {
                return;
            }
            signature[key] = metaValue;
        });
    }
    return signature;
}

async function handleReadSignatures() {
    if (!signatureState.currentSystem) {
        showSignatureMessage('Select a system before reading signatures.', true);
        return;
    }

    try {
        const clipboardText = await navigator.clipboard.readText();
        const parsed = parseClipboardSignatures(clipboardText);
        const normalized = sanitizeSignatureList(parsed);
        if (normalized.length === 0) {
            showSignatureMessage('Clipboard did not contain recognizable signatures.', true);
            return;
        }
        const { index } = pushSystemVersion(
            signatureState.currentSystem,
            normalized,
            HISTORY_VERSION_SOURCE_CLIPBOARD
        );
        const version = applyHistoryIndex(signatureState.currentSystem, index);
        persistSignatures();
        const count = version && Array.isArray(version.signatures) ? version.signatures.length : 0;
        const navigationState = getHistoryNavigationState(signatureState.currentSystem);
        const revertHint = navigationState.hasBack ? ' Use Back to revert.' : '';
        showSignatureMessage(`Loaded ${describeSignatureCount(count)} from clipboard.${revertHint}`);
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
    const history = getSystemHistory(system);
    const activeVersion = history && history.currentIndex >= 0 ? history.versions[history.currentIndex] : null;
    const activeCount = activeVersion && Array.isArray(activeVersion.signatures)
        ? activeVersion.signatures.length
        : 0;
    if (!history || history.versions.length === 0 || activeCount === 0) {
        showSignatureMessage('No stored signatures to clear for this system.', true);
        return;
    }
    const { index } = pushSystemVersion(system, [], HISTORY_VERSION_SOURCE_CLEAR);
    applyHistoryIndex(system, index);
    persistSignatures();
    signatureState.signatures = [];
    showSignatureMessage('Signatures cleared. Use Back to restore a previous set.');
    runSignatureAnalysis();
}

function handleSignatureHistoryBack() {
    const system = signatureState.currentSystem;
    if (!system) {
        return;
    }
    const history = getSystemHistory(system);
    if (!history || history.currentIndex <= 0) {
        return;
    }
    const version = applyHistoryIndex(system, history.currentIndex - 1);
    persistSignatures();
    showSignatureMessage(formatHistoryActionMessage('Reverted', version));
    runSignatureAnalysis();
}

function handleSignatureHistoryForward() {
    const system = signatureState.currentSystem;
    if (!system) {
        return;
    }
    const history = getSystemHistory(system);
    if (!history || history.currentIndex >= history.versions.length - 1) {
        return;
    }
    const version = applyHistoryIndex(system, history.currentIndex + 1);
    persistSignatures();
    showSignatureMessage(formatHistoryActionMessage('Advanced', version));
    runSignatureAnalysis();
}

function handleToggleSignatureOverride(row) {
    const system = signatureState.currentSystem;
    if (!system || !row || !row.signatureId) {
        return;
    }
    const nextState = cycleSignatureOverrideState(system, row.signatureId);
    pruneOverridesForSystem(system);
    persistSignatures();
    showSignatureMessage(formatOverrideToggleMessage(row.signatureId, nextState));
    runSignatureAnalysis();
}

function parseClipboardSignatures(rawText) {
    if (!rawText) {
        return [];
    }

    const lines = rawText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const signatures = [];
    lines.forEach((line) => {
        const columns = line.split('\t').map((cell) => cell.trim());
        const candidate = columns[0] || line.split(/\s+/)[0];
        const metadata = buildSignatureMetadataFromColumns(columns);
        const signature = toSignatureObject(candidate, metadata);
        if (signature) {
            signatures.push(signature);
        }
    });
    return signatures;
}

function buildSignatureMetadataFromColumns(columns) {
    if (!Array.isArray(columns)) {
        return {};
    }
    const safeColumns = columns.map((cell) => (cell ?? '').toString());
    const group = safeColumns[1] || '';
    const type = safeColumns[2] || '';
    const name = safeColumns[3] || '';
    const signal = safeColumns[4] || '';
    const distance = safeColumns[5] || '';
    const normalizedTokens = [group, type, name]
        .map((value) => value.toLowerCase())
        .filter(Boolean);
    const isWormholeFromScan = normalizedTokens.some((token) => token.includes('wormhole'));

    return {
        group,
        type,
        name,
        signal,
        distance,
        rawColumns: safeColumns,
        isWormholeFromScan
    };
}

function setBookmarkData(bookmarks) {
    signatureState.bookmarksAll = Array.isArray(bookmarks) ? bookmarks : [];
    runSignatureAnalysis();
}

function setSignatureActiveSystem(systemName) {
    showSignatureMessage('');
    signatureState.currentSystem = systemName || null;
    if (signatureState.currentSystem) {
        const history = getSystemHistory(signatureState.currentSystem);
        if (history && history.versions.length > 0 && history.currentIndex >= 0) {
            applyHistoryIndex(signatureState.currentSystem, history.currentIndex);
        } else {
            signatureState.signatures = [];
        }
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
            bookmark: available.row,
            bookmarkKey: available.key
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
        rows.push(createSignatureRow({
            status: 'missing',
            signature
        }));
    });
    stale.forEach((row) => {
        rows.push(createSignatureRow({
            status: 'stale',
            bookmark: row,
            bookmarkKey: resolveBookmarkKey(row)
        }));
    });
    matches.forEach(({ signature, bookmark, bookmarkKey }) => {
        rows.push(createSignatureRow({
            status: 'matched',
            signature,
            bookmark,
            bookmarkKey
        }));
    });

    return { matches, missing, stale, bookmarkStatus, rows };
}

function createSignatureRow({ status, signature = null, bookmark = null, bookmarkKey = null }) {
    const signatureId = signature?.signatureId || '';
    const bookmarkLabel = bookmark?.Label || '';
    const autoWormhole = detectWormholeSignature(signature, bookmark);
    const system = signatureState.currentSystem;
    const overrideState = signatureId && system
        ? getSignatureOverrideState(system, signatureId)
        : SIGNATURE_OVERRIDE.AUTO;
    const effectiveWormhole = applyOverrideToDetection(autoWormhole, overrideState);
    return {
        status,
        signatureId,
        bookmarkLabel,
        signature,
        bookmark,
        bookmarkKey: bookmarkKey || null,
        isWormhole: effectiveWormhole,
        autoWormhole,
        overrideState,
        hasOverride: overrideState !== SIGNATURE_OVERRIDE.AUTO,
        showActions: effectiveWormhole
    };
}

function detectWormholeSignature(signature, bookmark) {
    if (isWormholeFromSignature(signature)) {
        return true;
    }
    if (bookmark && typeof bookmark.Label === 'string' && isWormholeBookmarkLabel(bookmark.Label)) {
        return true;
    }
    return false;
}

function isWormholeBookmarkLabel(label) {
    if (!label || typeof label !== 'string') {
        return false;
    }
    const trimmed = label.trim();
    return /^-{1,2}\s*\S/.test(trimmed);
}

function isWormholeFromSignature(signature) {
    if (!signature) {
        return false;
    }
    if (signature.isWormholeFromScan) {
        return true;
    }
    const tokens = [signature.type, signature.group, signature.name]
        .map((value) => (value ?? '').toString().toLowerCase())
        .filter(Boolean);
    return tokens.some((token) => token.includes('wormhole'));
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

    const navigationState = signatureState.currentSystem
        ? getHistoryNavigationState(signatureState.currentSystem)
        : { hasBack: false, hasForward: false };

    if (signatureDom.historyBackButton) {
        signatureDom.historyBackButton.disabled = !navigationState.hasBack;
    }
    if (signatureDom.historyForwardButton) {
        signatureDom.historyForwardButton.disabled = !navigationState.hasForward;
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
    ['Signature', 'Bookmark', 'Status', 'Actions'].forEach((label) => {
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
        if (row.isWormhole) {
            tr.classList.add('signature-wormhole');
        }
        if (row.hasOverride) {
            tr.classList.add('signature-override');
            if (row.overrideState === SIGNATURE_OVERRIDE.FORCE_ON) {
                tr.classList.add('signature-override-on');
            } else if (row.overrideState === SIGNATURE_OVERRIDE.FORCE_OFF) {
                tr.classList.add('signature-override-off');
            }
        }

        const signatureCell = document.createElement('td');
        signatureCell.classList.add('signature-id-cell');
        signatureCell.textContent = row.signatureId ? row.signatureId : '';

        const bookmarkCell = document.createElement('td');
        bookmarkCell.classList.add('bookmark-label-cell');
        bookmarkCell.textContent = row.bookmarkLabel ? row.bookmarkLabel : '';

        const statusCell = document.createElement('td');
        statusCell.textContent = STATUS_LABELS[row.status] || row.status;

        const actionsCell = document.createElement('td');
        actionsCell.classList.add('signature-actions-cell');
        if (row.signatureId) {
            const actionContainer = document.createElement('div');
            actionContainer.className = 'signature-row-actions';
            actionContainer.appendChild(createSignatureOverrideButton(row));
            if (row.showActions) {
                actionContainer.appendChild(createSignatureActionButton(
                    'IN BM',
                    'Generate inbound wormhole bookmark',
                    () => handleGenerateInBookmark(row)
                ));
                actionContainer.appendChild(createSignatureActionButton(
                    'OUT BM',
                    'Generate outbound wormhole bookmark',
                    () => handleGenerateOutBookmark(row)
                ));
            }
            actionsCell.appendChild(actionContainer);
        }

        tr.append(signatureCell, bookmarkCell, statusCell, actionsCell);
        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    signatureDom.tableContainer.innerHTML = '';
    signatureDom.tableContainer.appendChild(table);
}
function createSignatureActionButton(label, title, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.classList.add('signature-action-button');
    button.addEventListener('click', handler);
    return button;
}

function createSignatureOverrideButton(row) {
    const button = document.createElement('button');
    button.type = 'button';
    const state = row.overrideState || SIGNATURE_OVERRIDE.AUTO;
    button.textContent = resolveOverrideLabel(state);
    button.title = resolveOverrideTooltip(state);
    button.classList.add('signature-action-button', 'signature-override-button');
    button.dataset.state = state;
    button.addEventListener('click', () => handleToggleSignatureOverride(row));
    return button;
}


async function handleGenerateInBookmark(row) {
    if (!row || !row.signatureId) {
        showSignatureMessage('Select a wormhole signature row first.', true);
        return;
    }
    if (!row.isWormhole) {
        showSignatureMessage('Selected signature is not identified as a wormhole.', true);
        return;
    }
    try {
        const clipboardText = await readClipboardTextSafe();
        const showInfo = parseWormholeShowInfo(clipboardText);
        if (!showInfo || !showInfo.wormholeType) {
            showSignatureMessage('Clipboard data does not look like wormhole show info.', true);
            return;
        }

        await ensureSystemsData();

        const classCode = await resolveDestinationClassCode(showInfo);
        const sizeCode = resolveShipSizeCode(showInfo.sizeRaw);
        const connectionCode = resolveInboundConnectionCode(showInfo);
        const destinationName = inferDestinationSystemName(showInfo, row);
        const flags = collectStabilityFlags(showInfo);
        const signatureToken = resolveSignaturePrefix(row.signature, row.signatureId);
        const classSegment = buildClassSegment(classCode, connectionCode, sizeCode);
        const label = safeJoinTokens([`-${signatureToken}`, classSegment, destinationName, ...flags]);
        const copied = await writeTextToClipboard(label);
        showSignatureMessage(
            copied ? `Copied inbound bookmark label: ${label}` : `Generated inbound bookmark label: ${label}`
        );
    } catch (error) {
        console.error('Failed to generate inbound bookmark', error);
        showSignatureMessage('Unable to generate inbound bookmark. Ensure wormhole show info is copied.', true);
    }
}

async function handleGenerateOutBookmark(row) {
    if (!row || !row.signatureId) {
        showSignatureMessage('Select a wormhole signature row first.', true);
        return;
    }
    if (!row.isWormhole) {
        showSignatureMessage('Selected signature is not identified as a wormhole.', true);
        return;
    }
    if (!signatureState.currentSystem) {
        showSignatureMessage('Select the system where the signature was scanned.', true);
        return;
    }
    try {
        await ensureSystemsData();

        const homeSystemName = signatureState.currentSystem;
        const homeClass = (await resolveSystemClassCode(homeSystemName)) || '??';
        const sizeCode = resolveOutboundSizeCode(row);
        const flags = collectFlagsFromBookmarkLabel(extractBookmarkLabel(row));
        const connectionCode = resolveOutboundConnectionCode(row);
        const classSegment = buildClassSegment(homeClass, connectionCode, sizeCode);
        const label = safeJoinTokens(['--???', classSegment, homeSystemName, ...flags]);
        const copied = await writeTextToClipboard(label);
        showSignatureMessage(
            copied ? `Copied outbound bookmark label: ${label}` : `Generated outbound bookmark label: ${label}`
        );
    } catch (error) {
        console.error('Failed to generate outbound bookmark', error);
        showSignatureMessage('Unable to generate outbound bookmark.', true);
    }
}

function extractBookmarkLabel(row) {
    if (!row) {
        return '';
    }
    if (typeof row.bookmarkLabel === 'string' && row.bookmarkLabel.trim()) {
        return row.bookmarkLabel.trim();
    }
    const bookmarkLabel = row.bookmark && typeof row.bookmark.Label === 'string'
        ? row.bookmark.Label.trim()
        : '';
    return bookmarkLabel;
}

function resolveOutboundSizeCode(row) {
    const label = extractBookmarkLabel(row);
    const inferred = inferSizeCodeFromBookmarkLabel(label);
    return inferred || '?';
}

function resolveInboundConnectionCode(showInfo) {
    if (!showInfo) {
        return 'r';
    }
    const wormholeType = (showInfo.wormholeType || '').toUpperCase();
    if (wormholeType === 'K162') {
        return 'i';
    }
    if (showInfo.isStatic) {
        return 's';
    }
    return 'r';
}

function resolveOutboundConnectionCode(row) {
    const label = extractBookmarkLabel(row);
    const segment = extractClassSegmentFromLabel(label);
    const parsed = parseClassSegment(segment);
    if (parsed && parsed.connectionCode) {
        const code = parsed.connectionCode.toLowerCase();
        switch (code) {
            case 'i':
                return '?';
            case 's':
                return 'r';
            case 'r':
                return '?';
            case '?':
                return '?';
            default:
                return '?';
        }
    }
    return '?';
}

function inferSizeCodeFromBookmarkLabel(label) {
    if (!label) {
        return null;
    }
    const tokens = label.trim().split(/\s+/);
    if (tokens.length < 2) {
        return null;
    }
    const segment = tokens[1] ? tokens[1].trim().toUpperCase() : '';
    if (!segment) {
        return null;
    }
    if (segment.endsWith('XL')) {
        return 'XL';
    }
    const sizeMatch = segment.match(/(F|D|S|M|L)$/);
    if (sizeMatch && sizeMatch[1]) {
        return sizeMatch[1];
    }
    return null;
}

function collectFlagsFromBookmarkLabel(label) {
    if (!label) {
        return [];
    }
    const tokens = label.trim().split(/\s+/);
    const flags = [];
    tokens.forEach((token) => {
        const upper = token.toUpperCase();
        if ((upper === 'VEOL' || upper === 'EOL' || upper === 'CRIT') && !flags.includes(upper)) {
            flags.push(upper);
        }
    });
    return flags;
}

function extractClassSegmentFromLabel(label) {
    if (!label || typeof label !== 'string') {
        return null;
    }
    const tokens = label.trim().split(/\s+/);
    if (tokens.length < 2) {
        return null;
    }
    return tokens[1];
}

function parseClassSegment(segment) {
    if (!segment || typeof segment !== 'string') {
        return {
            classCode: null,
            connectionCode: null,
            sizeCode: null
        };
    }
    const trimmed = segment.trim();
    if (!trimmed) {
        return {
            classCode: null,
            connectionCode: null,
            sizeCode: null
        };
    }
    const sizeMatch = trimmed.match(/(XL|F|D|S|M|L)$/i);
    let sizeCode = null;
    let base = trimmed;
    if (sizeMatch && sizeMatch[1]) {
        sizeCode = sizeMatch[1].toUpperCase();
        base = trimmed.slice(0, trimmed.length - sizeMatch[1].length);
    }
    if (!base) {
        return {
            classCode: null,
            connectionCode: null,
            sizeCode
        };
    }
    const connectionMatch = base.match(/([A-Za-z])$/);
    let connectionCode = null;
    let classCode = base;
    if (connectionMatch && connectionMatch[1]) {
        connectionCode = connectionMatch[1].toLowerCase();
        classCode = base.slice(0, base.length - connectionMatch[1].length);
    }
    classCode = classCode ? classCode.toUpperCase() : null;
    return {
        classCode,
        connectionCode,
        sizeCode
    };
}

async function ensureSystemsData() {
    if (systemsDataCache) {
        return systemsDataCache;
    }
    if (!systemsDataPromise) {
        systemsDataPromise = loadSystemsData()
            .then((systems) => {
                systemsDataCache = systems || {};
                systemNameLookup = new Map();
                Object.entries(systemsDataCache).forEach(([name, info]) => {
                    if (!name) {
                        return;
                    }
                    systemNameLookup.set(name.toLowerCase(), info);
                });
                wormholeTypeCache = buildWormholeTypeMap(systemsDataCache);
                return systemsDataCache;
            })
            .catch((error) => {
                systemsDataPromise = null;
                throw error;
            });
    }
    return systemsDataPromise;
}

function buildWormholeTypeMap(systems) {
    const map = new Map();
    if (!systems) {
        return map;
    }
    Object.values(systems).forEach((info) => {
        if (!info || typeof info !== 'object') {
            return;
        }
        const statics = info.statics;
        if (!statics || typeof statics !== 'object') {
            return;
        }
        Object.entries(statics).forEach(([code, details]) => {
            if (!code) {
                return;
            }
            const normalizedCode = code.toUpperCase();
            if (map.has(normalizedCode)) {
                return;
            }
            const classCode = normalizeWormholeClassCode(details && details.class);
            if (!classCode) {
                return;
            }
            map.set(normalizedCode, { classCode });
        });
    });
    return map;
}

function normalizeWormholeClassCode(rawClass) {
    if (!rawClass && rawClass !== 0) {
        return null;
    }
    const value = rawClass.toString().trim();
    if (!value) {
        return null;
    }
    const upper = value.toUpperCase();
    if (/^C\d+(-\d+)?$/.test(upper)) {
        return upper;
    }
    if (upper === 'HS' || upper === 'LS' || upper === 'NS') {
        return upper;
    }
    if (upper === 'THERA' || upper === 'BARBICAN' || upper === 'CONFLUX' || upper === 'REDOUBT' || upper === 'SENTINEL' || upper === 'VIDETTE') {
        return upper;
    }
    return upper;
}

async function resolveDestinationClassCode(showInfo) {
    await ensureSystemsData();
    const wormholeType = (showInfo?.wormholeType || '').toUpperCase();
    if (wormholeType && wormholeType !== 'K162' && wormholeTypeCache?.has(wormholeType)) {
        const entry = wormholeTypeCache.get(wormholeType);
        if (entry?.classCode) {
            return entry.classCode;
        }
    }
    const fromDestination = parseDestinationClassFromText(showInfo?.destinationRaw);
    if (fromDestination) {
        return fromDestination;
    }
    return '??';
}

async function resolveSystemClassCode(systemName) {
    if (!systemName) {
        return null;
    }
    await ensureSystemsData();
    const info = lookupSystemInfo(systemName);
    return deriveSystemClassFromInfo(info);
}

function lookupSystemInfo(systemName) {
    if (!systemName || !systemNameLookup) {
        return null;
    }
    const lower = systemName.toLowerCase();
    if (systemNameLookup.has(lower)) {
        return systemNameLookup.get(lower);
    }
    return null;
}

function deriveSystemClassFromInfo(info) {
    if (!info || typeof info !== 'object') {
        return null;
    }
    if (info.wormholeClass) {
        return normalizeWormholeClassCode(info.wormholeClass);
    }
    if (typeof info.security_status === 'number') {
        return parseSecurityClass(info.security_status);
    }
    return null;
}

function parseSecurityClass(securityStatus) {
    if (typeof securityStatus !== 'number' || Number.isNaN(securityStatus)) {
        return null;
    }
    if (securityStatus >= 0.45) {
        return 'HS';
    }
    if (securityStatus >= 0.05) {
        return 'LS';
    }
    return 'NS';
}

function parseWormholeShowInfo(rawText) {
    if (!rawText) {
        return null;
    }
    const normalized = rawText.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
        return null;
    }
    const header = lines[0];
    const match = header.match(/Wormhole\s+([A-Z0-9-]+)(?:\s+([A-Za-z]))?/i);
    const wormholeType = match ? match[1].toUpperCase() : null;
    const staticIndicator = match && match[2] ? match[2].toLowerCase() : null;
    const info = {
        wormholeType,
        destinationRaw: '',
        sizeRaw: '',
        lifetimeRaw: '',
        massRaw: '',
        text: rawText,
        isStatic: staticIndicator === 's'
    };
    lines.forEach((line) => {
        const lower = line.toLowerCase();
        if (lower.startsWith('destination:')) {
            info.destinationRaw = line.slice('destination:'.length).trim();
        } else if (lower.startsWith('maximum ship size:')) {
            info.sizeRaw = line.slice('maximum ship size:'.length).trim();
        } else if (lower.startsWith('lifetime:')) {
            info.lifetimeRaw = line.slice('lifetime:'.length).trim();
        } else if (lower.startsWith('mass stability:')) {
            info.massRaw = line.slice('mass stability:'.length).trim();
        }
    });
    return info;
}

function resolveShipSizeCode(sizeRaw) {
    if (!sizeRaw) {
        return '?';
    }
    const normalized = sizeRaw.trim().toLowerCase();
    if (!normalized) {
        return '?';
    }
    if (normalized.includes('frig')) {
        return 'F';
    }
    if (normalized.includes('destroyer')) {
        return 'D';
    }
    if (normalized.includes('small')) {
        return 'S';
    }
    if (normalized.includes('medium')) {
        return 'M';
    }
    if (normalized.includes('capital') || normalized.includes('freighter') || normalized.includes('x-large') || normalized.includes('xlarge')) {
        return 'XL';
    }
    if (normalized.includes('large')) {
        return 'L';
    }
    return sizeRaw.trim();
}

function collectStabilityFlags(showInfo) {
    const flags = new Set();
    const lifetimeFlag = resolveLifetimeFlag(showInfo?.lifetimeRaw);
    if (lifetimeFlag) {
        flags.add(lifetimeFlag);
    }
    if (detectCriticalMass(showInfo?.massRaw)) {
        flags.add('CRIT');
    }
    return Array.from(flags);
}

function resolveLifetimeFlag(lifetimeRaw) {
    if (!lifetimeRaw) {
        return null;
    }
    const normalized = lifetimeRaw.toLowerCase();
    if (normalized.includes('less than 1 hour')) {
        return 'VEOL';
    }
    if (normalized.includes('end of its natural lifetime')) {
        return 'EOL';
    }
    return null;
}

function detectCriticalMass(massRaw) {
    if (!massRaw) {
        return false;
    }
    const normalized = massRaw.toLowerCase();
    return normalized.includes('less than 10%') || normalized.includes('critical');
}

function inferDestinationSystemName(showInfo, row) {
    // Inbound bookmarks intentionally hide the remote destination details.
    return '???';
}

function resolveSignaturePrefix(signature, signatureId) {
    if (signature?.prefix) {
        return signature.prefix.toUpperCase();
    }
    if (signatureId) {
        const prefix = signatureId.split('-')[0];
        if (prefix) {
            return prefix.toUpperCase();
        }
        return signatureId.toUpperCase();
    }
    return '???';
}

function normalizeClassCodeForLabel(code) {
    if (!code && code !== 0) {
        return '??';
    }
    const value = code.toString().trim();
    if (!value) {
        return '??';
    }
    const upper = value.toUpperCase();
    const rangeMatch = upper.match(/^C(\d)-(\d)$/);
    if (rangeMatch) {
        const start = Number(rangeMatch[1]);
        const end = Number(rangeMatch[2]);
        if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
            const digits = [];
            for (let current = start; current <= end; current += 1) {
                digits.push(String(current));
            }
            return `C${digits.join('')}`;
        }
    }
    return upper;
}

function buildClassSegment(classCode, sideCode, sizeCode) {
    const classPart = normalizeClassCodeForLabel(classCode);
    const sidePart = sideCode || '';
    const sizePart = sizeCode || '';
    return `${classPart}${sidePart}${sizePart}`;
}

function parseDestinationClassFromText(text) {
    if (!text) {
        return null;
    }
    const normalized = text.trim().toLowerCase();
    if (!normalized) {
        return null;
    }
    if (normalized.includes('high-security')) {
        return 'HS';
    }
    if (normalized.includes('low-security')) {
        return 'LS';
    }
    if (normalized.includes('null-security') || normalized.includes('null security') || normalized.includes('0.0')) {
        return 'NS';
    }
    const classRange = normalized.match(/class\s*(\d)(?:\s*[-to]+\s*(\d))?/);
    if (classRange) {
        const start = classRange[1];
        const end = classRange[2];
        if (end) {
            return `C${start}-${end}`;
        }
        return `C${start}`;
    }
    if (normalized.includes('thera')) {
        return 'THERA';
    }
    if (normalized.includes('barbican')) {
        return 'BARBICAN';
    }
    if (normalized.includes('conflux')) {
        return 'CONFLUX';
    }
    if (normalized.includes('redoubt')) {
        return 'REDOUBT';
    }
    if (normalized.includes('sentinel')) {
        return 'SENTINEL';
    }
    if (normalized.includes('vidette')) {
        return 'VIDETTE';
    }
    return null;
}

function safeJoinTokens(tokens) {
    return tokens
        .map((token) => (typeof token === 'string' ? token.trim() : token))
        .filter((token) => token && token.length > 0)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function readClipboardTextSafe() {
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
        throw new Error('Clipboard API unavailable');
    }
    return navigator.clipboard.readText();
}

async function writeTextToClipboard(value) {
    if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        return false;
    }
    try {
        await navigator.clipboard.writeText(value);
        return true;
    } catch (error) {
        console.warn('Failed to copy to clipboard', error);
        return false;
    }
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

function wireTutorialModal() {
    if (!signatureDom.tutorialButton || !signatureDom.tutorialModal) {
        return;
    }

    signatureDom.tutorialModal.style.display = 'none';
    signatureDom.tutorialModal.setAttribute('aria-hidden', 'true');

    signatureDom.tutorialButton.addEventListener('click', openTutorialModal);
    signatureDom.tutorialModal.addEventListener('click', (event) => {
        if (event.target === signatureDom.tutorialModal) {
            closeTutorialModal();
        }
    });

    if (signatureDom.tutorialClose) {
        signatureDom.tutorialClose.addEventListener('click', closeTutorialModal);
    }
    if (signatureDom.tutorialConfirm) {
        signatureDom.tutorialConfirm.addEventListener('click', closeTutorialModal);
    }
}

function openTutorialModal() {
    if (!signatureDom.tutorialModal) {
        return;
    }
    tutorialPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    signatureDom.tutorialModal.style.display = 'block';
    signatureDom.tutorialModal.setAttribute('aria-hidden', 'false');
    document.addEventListener('keydown', handleTutorialKeydown, true);
    setTimeout(() => {
        const focusTarget = signatureDom.tutorialClose || signatureDom.tutorialConfirm;
        if (focusTarget && typeof focusTarget.focus === 'function') {
            focusTarget.focus();
        }
    }, 0);
}

function closeTutorialModal() {
    if (!signatureDom.tutorialModal) {
        return;
    }
    signatureDom.tutorialModal.style.display = 'none';
    signatureDom.tutorialModal.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', handleTutorialKeydown, true);
    if (tutorialPreviousFocus && typeof tutorialPreviousFocus.focus === 'function') {
        tutorialPreviousFocus.focus();
    }
    tutorialPreviousFocus = null;
}

function handleTutorialKeydown(event) {
    if (!signatureDom.tutorialModal || signatureDom.tutorialModal.getAttribute('aria-hidden') === 'true') {
        return;
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        closeTutorialModal();
        return;
    }
    if (event.key !== 'Tab') {
        return;
    }

    const focusableSelectors = [
        'button',
        '[href]',
        'input',
        'select',
        'textarea',
        '[tabindex]:not([tabindex="-1"])'
    ];
    const focusableElements = Array.from(
        signatureDom.tutorialModal.querySelectorAll(focusableSelectors.join(','))
    ).filter((element) => {
        if (!(element instanceof HTMLElement)) {
            return false;
        }
        if (element.hasAttribute('disabled') || element.getAttribute('aria-hidden') === 'true') {
            return false;
        }
        if (Number(element.tabIndex) === -1) {
            return false;
        }
        const rects = element.getClientRects();
        return rects.length > 0 && rects[0].width > 0 && rects[0].height > 0;
    });

    if (focusableElements.length === 0) {
        event.preventDefault();
        return;
    }

    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
    } else if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
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
window.getSignatureActiveSystem = () => signatureState.currentSystem;


