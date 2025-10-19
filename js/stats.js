import { extractSystems } from './modules/map/extractSystems.js';

const FLAG_TOKENS = new Set(['VEOL', 'EOL', 'CRIT', 'HALF', 'STABLE']);
const MAX_LEADERBOARD_ENTRIES = 10;

const statsState = {
    initialized: false,
    pendingData: null,
    dom: {
        totalBookmarks: null,
        totalSystems: null,
        totalConnections: null,
        leaderboardList: null,
        leaderboardEmpty: null
    }
};

document.addEventListener('DOMContentLoaded', initBookmarkStats);

function initBookmarkStats() {
    statsState.dom.totalBookmarks = document.getElementById('statsTotalBookmarks');
    statsState.dom.totalSystems = document.getElementById('statsTotalSystems');
    statsState.dom.totalConnections = document.getElementById('statsTotalConnections');
    statsState.dom.leaderboardList = document.getElementById('statsLeaderboard');
    statsState.dom.leaderboardEmpty = document.getElementById('statsLeaderboardEmpty');

    if (!statsState.dom.totalBookmarks || !statsState.dom.totalSystems || !statsState.dom.totalConnections) {
        return;
    }

    statsState.initialized = true;
    if (Array.isArray(statsState.pendingData)) {
        renderStats(statsState.pendingData);
        statsState.pendingData = null;
    }
}

function updateBookmarkStats(data) {
    const dataset = Array.isArray(data) ? data : [];
    if (!statsState.initialized) {
        statsState.pendingData = dataset;
        return;
    }
    renderStats(dataset);
}

function renderStats(data) {
    const safeData = Array.isArray(data) ? data : [];

    if (statsState.dom.totalBookmarks) {
        statsState.dom.totalBookmarks.textContent = safeData.length.toString();
    }

    if (statsState.dom.totalSystems) {
        const systems = new Set();
        safeData.forEach((row) => {
            const rawSystem = row?.SOL;
            if (!rawSystem) {
                return;
            }
            const normalized = rawSystem.toString().trim();
            if (normalized) {
                systems.add(normalized.toUpperCase());
            }
        });
        statsState.dom.totalSystems.textContent = systems.size.toString();
    }

    const connectionsSummary = computeConnectionSummary(safeData);
    if (statsState.dom.totalConnections) {
        statsState.dom.totalConnections.textContent = connectionsSummary.totalConnections.toString();
    }
    renderLeaderboard(connectionsSummary.leaderboard);
}

function renderLeaderboard(entries) {
    const listEl = statsState.dom.leaderboardList;
    const emptyEl = statsState.dom.leaderboardEmpty;
    if (!listEl) {
        return;
    }

    listEl.innerHTML = '';
    if (!entries.length) {
        if (listEl) {
            listEl.style.display = 'none';
        }
        if (emptyEl) {
            emptyEl.style.display = 'block';
        }
        return;
    }

    listEl.style.display = 'block';
    if (emptyEl) {
        emptyEl.style.display = 'none';
    }

    entries.slice(0, MAX_LEADERBOARD_ENTRIES).forEach((entry) => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'stats-leaderboard-name';
        name.textContent = entry.creator;

        const count = document.createElement('span');
        count.className = 'stats-leaderboard-count';
        count.textContent = entry.count.toString();

        li.appendChild(name);
        li.appendChild(count);
        listEl.appendChild(li);
    });
}

function computeConnectionSummary(data) {
    const candidates = new Map();

    data.forEach((row) => {
        const rawLabel = (row?.Label || '').toString();
        if (!rawLabel.startsWith('-')) {
            return;
        }
        const solValue = (row?.SOL || '').toString();
        if (!solValue.trim()) {
            return;
        }

        const [systemFromRaw, systemToRaw] = extractSystems(rawLabel, solValue);
        const normalizedFrom = normalizeSystemName(systemFromRaw);
        const normalizedTo = normalizeTarget(systemToRaw);

        if (!normalizedFrom || !normalizedTo) {
            return;
        }

        const directionKey = `${normalizedFrom}|${normalizedTo}`;
        const candidateKey = buildConnectionKey(normalizedFrom, normalizedTo);
        let candidate = candidates.get(candidateKey);
        if (!candidate) {
            candidate = {
                key: candidateKey,
                directions: new Map(),
                hasPlaceholder: containsPlaceholder(normalizedFrom) || containsPlaceholder(normalizedTo)
            };
            candidates.set(candidateKey, candidate);
        }
        if (containsPlaceholder(normalizedFrom) || containsPlaceholder(normalizedTo)) {
            candidate.hasPlaceholder = true;
        }
        let directionRows = candidate.directions.get(directionKey);
        if (!directionRows) {
            directionRows = [];
            candidate.directions.set(directionKey, directionRows);
        }
        directionRows.push(row);
    });

    let totalConnections = 0;
    const leaderboardCounts = new Map();

    candidates.forEach((candidate) => {
        const directionGraph = new Map();
        candidate.directions.forEach((_rows, pairKey) => {
            const [from, to] = pairKey.split('|');
            let toSet = directionGraph.get(from);
            if (!toSet) {
                toSet = new Set();
                directionGraph.set(from, toSet);
            }
            toSet.add(to);
        });

        let hasOppositePair = false;
        directionGraph.forEach((targets, from) => {
            targets.forEach((to) => {
                const reverseTargets = directionGraph.get(to);
                if (reverseTargets && reverseTargets.has(from)) {
                    hasOppositePair = true;
                }
            });
        });

        if (!hasOppositePair && !candidate.hasPlaceholder) {
            return;
        }

        totalConnections += 1;
        const creators = new Set();
        candidate.directions.forEach((rows) => {
            rows.forEach((row) => {
                const creatorRaw = (row?.Creator || '').toString().trim();
                const creator = creatorRaw || 'Unknown';
                creators.add(creator);
            });
        });
        creators.forEach((creator) => {
            leaderboardCounts.set(creator, (leaderboardCounts.get(creator) || 0) + 1);
        });
    });

    const leaderboard = Array.from(leaderboardCounts.entries())
        .sort((a, b) => {
            if (b[1] !== a[1]) {
                return b[1] - a[1];
            }
            return a[0].localeCompare(b[0]);
        })
        .map(([creator, count]) => ({ creator, count }));

    return {
        totalConnections,
        leaderboard
    };
}

function normalizeSystemName(value) {
    if (!value) {
        return '';
    }
    return value.toString().trim().toUpperCase();
}

function normalizeTarget(value) {
    if (!value) {
        return '';
    }
    const tokens = value.toString().split(/\s+/).filter(Boolean);
    const cleaned = tokens
        .map((token) => token.replace(/[^A-Za-z0-9?\-]/g, '').toUpperCase())
        .filter((token) => token && !FLAG_TOKENS.has(token));
    return cleaned.join(' ');
}

function buildConnectionKey(systemA, systemB) {
    const left = systemA || '';
    const right = systemB || '';
    return left <= right ? `${left}|${right}` : `${right}|${left}`;
}

function containsPlaceholder(value) {
    return typeof value === 'string' && value.includes('?');
}

window.updateBookmarkStats = updateBookmarkStats;
