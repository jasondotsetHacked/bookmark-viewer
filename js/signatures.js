import { loadSystemsData } from './loadSystemsData.js';
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

const BOOKMARK_FLAG_TOKENS = new Set(['EOL', 'CRIT', 'HALF', 'STABLE']);

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
    return {
        status,
        signatureId,
        bookmarkLabel,
        signature,
        bookmark,
        bookmarkKey: bookmarkKey || null,
        isWormhole: detectWormholeSignature(signature, bookmark)
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

        const signatureCell = document.createElement('td');
        signatureCell.textContent = row.signatureId ? row.signatureId : '';

        const bookmarkCell = document.createElement('td');
        bookmarkCell.textContent = row.bookmarkLabel ? row.bookmarkLabel : '';

        const statusCell = document.createElement('td');
        statusCell.textContent = STATUS_LABELS[row.status] || row.status;

        const actionsCell = document.createElement('td');
        actionsCell.classList.add('signature-actions-cell');
        if (row.isWormhole && row.signatureId) {
            const actionContainer = document.createElement('div');
            actionContainer.className = 'signature-row-actions';
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
        const wormholeType = (showInfo.wormholeType || '').toUpperCase();
        const sideCode = wormholeType === 'K162' ? 'i' : 'o';
        const sizeCode = resolveShipSizeCode(showInfo.sizeRaw);
        const destinationName = inferDestinationSystemName(showInfo, row);
        const flags = collectStabilityFlags(showInfo);
        const signatureToken = resolveSignaturePrefix(row.signature, row.signatureId);
        const classSegment = buildClassSegment(classCode, sideCode, sizeCode);
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
        const classSegment = buildClassSegment(homeClass, 'o', sizeCode);
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
        if ((upper === 'EOL' || upper === 'CRIT') && !flags.includes(upper)) {
            flags.push(upper);
        }
    });
    return flags;
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
    const match = header.match(/Wormhole\s+([A-Z0-9-]+)/i);
    const wormholeType = match ? match[1].toUpperCase() : null;
    const info = {
        wormholeType,
        destinationRaw: '',
        sizeRaw: '',
        lifetimeRaw: '',
        massRaw: '',
        text: rawText
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
    if (detectEndOfLife(showInfo?.lifetimeRaw)) {
        flags.add('EOL');
    }
    if (detectCriticalMass(showInfo?.massRaw)) {
        flags.add('CRIT');
    }
    return Array.from(flags);
}

function detectEndOfLife(lifetimeRaw) {
    if (!lifetimeRaw) {
        return false;
    }
    const normalized = lifetimeRaw.toLowerCase();
    return normalized.includes('less than 1 hour') || normalized.includes('end of its natural lifetime');
}

function detectCriticalMass(massRaw) {
    if (!massRaw) {
        return false;
    }
    const normalized = massRaw.toLowerCase();
    return normalized.includes('less than 10%') || normalized.includes('critical');
}

function inferDestinationSystemName(showInfo, row) {
    const fromBookmark = extractSystemNameFromBookmarkLabel(row?.bookmarkLabel || row?.bookmark?.Label);
    if (fromBookmark) {
        return fromBookmark;
    }
    const fromDestination = extractSystemNameFromDestinationText(showInfo?.destinationRaw);
    if (fromDestination) {
        return fromDestination;
    }
    return '???';
}

function extractSystemNameFromDestinationText(text) {
    if (!text) {
        return null;
    }
    const match = text.match(/(?:the\s+)?([A-Z][A-Za-z0-9-]{2,})\s+systems?/i);
    if (match) {
        const candidate = match[1];
        if (candidate.toUpperCase() !== 'WORMHOLE') {
            return candidate;
        }
    }
    const specialSystems = ['Thera', 'Barbican', 'Conflux', 'Redoubt', 'Sentinel', 'Vidette'];
    const upper = text.toUpperCase();
    for (let index = 0; index < specialSystems.length; index += 1) {
        const candidate = specialSystems[index];
        if (upper.includes(candidate.toUpperCase())) {
            return candidate;
        }
    }
    return null;
}

function extractSystemNameFromBookmarkLabel(label) {
    if (!label || typeof label !== 'string') {
        return null;
    }
    const tokens = label.trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 2) {
        return null;
    }
    for (let index = tokens.length - 1; index >= 0; index -= 1) {
        const token = tokens[index];
        const normalized = token.toUpperCase();
        if (BOOKMARK_FLAG_TOKENS.has(normalized)) {
            continue;
        }
        if (normalized === 'WORMHOLE') {
            continue;
        }
        if (/^--?/.test(token)) {
            continue;
        }
        if (/^(C\d+|HS|LS|NS)([IO][A-Z]*)?$/.test(normalized)) {
            continue;
        }
        return token;
    }
    return null;
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


