import { extractSystems } from './extractSystems.js';
import { buildSystemTag } from './buildSystemTag.js';
import { lockNodes, unlockNodes, dragStarted, dragged, dragEnded } from './dragHandlers.js';
import { getRowExpiry, clearCountdowns, TIMER_TAGS } from '../../bookmarkTimers.js';

const PLACEHOLDER_PATTERN = /^\?+$/;
const PLACEHOLDER_KEY_COLUMNS = ['Label', 'Type', 'SOL', 'CON', 'REG', 'Date', 'Expiry', 'Creator', 'Jumps'];
const PLACEHOLDER_FLAG_TOKENS = new Set(['VEOL', 'EOL', 'CRIT', 'HALF', 'STABLE']);

function buildPlaceholderKey(systemFrom, placeholder, row) {
  const parts = [systemFrom || '', placeholder || ''];
  PLACEHOLDER_KEY_COLUMNS.forEach((column) => {
    const raw = row && Object.prototype.hasOwnProperty.call(row, column) ? row[column] : '';
    let value = raw === undefined || raw === null ? '' : raw;
    if (typeof value !== 'string') {
      value = String(value);
    }
    parts.push(value.trim ? value.trim() : value);
  });
  return parts.join('|');
}

function stableHash(input) {
  if (!input) {
    return '0';
  }
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    const charCode = input.charCodeAt(index);
    hash = ((hash << 5) - hash) + charCode;
    hash |= 0; // Convert to 32-bit integer
  }
  const normalized = Math.abs(hash).toString(36);
  return normalized || '0';
}

function createPlaceholderIdentifier(systemFrom, placeholder, row, cache) {
  const cacheKey = buildPlaceholderKey(systemFrom, placeholder, row);
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const hash = stableHash(cacheKey);
  const suffix = (hash.length >= 6 ? hash.slice(0, 6) : hash.padEnd(6, '0')).toUpperCase();
  const id = `${systemFrom}::UNKNOWN::${suffix}`;
  const entry = {
    id,
    displayName: placeholder || '???',
    filterKey: systemFrom,
    isPlaceholder: true,
    originSystem: systemFrom,
    hash,
    cacheKey
  };
  cache.set(cacheKey, entry);
  return entry;
}

function buildConnectionKey(systemA, systemB) {
  const left = systemA || '';
  const right = systemB || '';
  return left <= right ? `${left}|${right}` : `${right}|${left}`;
}

function normalizeSystemKey(value) {
  if (!value && value !== 0) {
    return '';
  }
  return value.toString().trim().toUpperCase();
}

const WORMHOLE_CLASS_PREFIXES = [
  'HS',
  'LS',
  'NS',
  'C1',
  'C2',
  'C3',
  'C4',
  'C5',
  'C6',
  'C13',
  'THERA',
  'PV'
];

function extractWormholeClass(rawLabel) {
  if (!rawLabel || typeof rawLabel !== 'string') {
    return null;
  }
  const tokens = rawLabel.split(/\s+/);
  for (let index = 0; index < tokens.length; index += 1) {
    const normalizedToken = tokens[index].replace(/[^\w?]/g, '').toUpperCase();
    if (!normalizedToken) {
      continue;
    }
    const detailedClassMatch = normalizedToken.match(/^([A-Z]{1,2}\d{1,3})/);
    if (detailedClassMatch && detailedClassMatch[1]) {
      return detailedClassMatch[1];
    }
    for (let prefixIndex = 0; prefixIndex < WORMHOLE_CLASS_PREFIXES.length; prefixIndex += 1) {
      const prefix = WORMHOLE_CLASS_PREFIXES[prefixIndex];
      if (normalizedToken.startsWith(prefix)) {
        return prefix;
      }
    }
  }
  return null;
}

/**
 * Displays the map with the given data.
 * @param {Array<Object>} data The data to display on the map.
 * @param {Object} options Options for displaying the map.
 * @param {boolean} options.preserveSelection Whether to preserve the current system selection.
 */
export function displayMap(data, options = {}) {
  // Configuration constants for map layout
  const CHAIN_SPACING = 100; // Controls spacing between chains (overall system tightness)
  const SPIRAL_RADIUS = 50; // Controls tightness within individual chains
  console.log('displayMap called with data:', data);
  const mapContainer = document.getElementById('mapContainer');
  if (!mapContainer) {
    console.warn('displayMap: mapContainer not found');
    return;
  }

  clearCountdowns(TIMER_TAGS.MAP);

  const previousSelection = options?.preserveSelection
    ? (window.__bookmarkViewerSelectedSystem || null)
    : null;

  const previousRuntime = mapContainer.__mapRuntime || null;
  if (previousRuntime?.settleTimer) {
    clearTimeout(previousRuntime.settleTimer);
  }
  let previousPositions = new Map();
  let previousTransform = null;
  let previousPhysicsEnabled = false;

  if (previousRuntime) {
    try {
      const prevSimulation = previousRuntime.simulation;
      if (prevSimulation && typeof prevSimulation.stop === 'function') {
        prevSimulation.stop();
      }
      const prevNodes = typeof prevSimulation?.nodes === 'function'
        ? prevSimulation.nodes()
        : Array.isArray(previousRuntime.nodes)
          ? previousRuntime.nodes
          : [];
      previousPositions = new Map(
        prevNodes
          .filter((node) => node && typeof node.name === 'string')
          .map((node) => [node.name, {
            x: node.x,
            y: node.y,
            vx: node.vx,
            vy: node.vy,
            fx: node.fx,
            fy: node.fy
          }])
      );
      if (previousRuntime.currentTransform) {
        previousTransform = previousRuntime.currentTransform;
      }
      if (typeof previousRuntime.physicsEnabled === 'boolean') {
        previousPhysicsEnabled = previousRuntime.physicsEnabled;
      }
    } catch (error) {
      console.warn('displayMap: failed to capture previous runtime state', error);
      previousPositions = new Map();
      previousTransform = null;
    }
  }

  mapContainer.__mapRuntime = null;
  mapContainer.innerHTML = '';

  const controlBar = document.createElement('div');
  controlBar.className = 'map-control-bar';

  const searchControls = document.createElement('div');
  searchControls.className = 'map-search-controls';

  const searchToggle = document.createElement('button');
  searchToggle.type = 'button';
  searchToggle.className = 'map-search-toggle';
  searchToggle.setAttribute('aria-label', 'Search for a system');
  searchToggle.setAttribute('aria-expanded', 'false');
  searchToggle.title = 'Search systems';
  searchToggle.textContent = 'Search';

  const searchPanel = document.createElement('div');
  searchPanel.className = 'map-search-panel';
  searchPanel.hidden = true;

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'map-search-input';
  searchInput.placeholder = 'Jump to system...';
  searchInput.setAttribute('aria-label', 'System name');
  searchInput.autocomplete = 'off';
  searchInput.setAttribute('role', 'combobox');
  searchInput.setAttribute('aria-autocomplete', 'list');
  searchInput.setAttribute('aria-expanded', 'false');

  const searchSubmit = document.createElement('button');
  searchSubmit.type = 'button';
  searchSubmit.className = 'map-search-submit';
  searchSubmit.textContent = 'Go';

  const searchSuggestions = document.createElement('ul');
  searchSuggestions.className = 'map-search-suggestions';
  searchSuggestions.hidden = true;
  searchSuggestions.setAttribute('role', 'listbox');

  const searchMessage = document.createElement('div');
  searchMessage.className = 'map-search-message';
  searchMessage.setAttribute('role', 'status');
  searchMessage.setAttribute('aria-live', 'polite');

  searchPanel.append(searchInput, searchSubmit, searchSuggestions, searchMessage);
  searchControls.append(searchToggle, searchPanel);
  controlBar.appendChild(searchControls);

  const physicsToggle = document.createElement('label');
  physicsToggle.className = 'map-physics-toggle';
  physicsToggle.title = 'Toggle map physics';

  const physicsToggleInput = document.createElement('input');
  physicsToggleInput.type = 'checkbox';
  physicsToggleInput.className = 'map-physics-input';
  physicsToggleInput.setAttribute('aria-label', 'Toggle map physics simulation');
  physicsToggleInput.checked = previousPhysicsEnabled;

  const physicsToggleSlider = document.createElement('span');
  physicsToggleSlider.className = 'map-physics-slider';

  const physicsToggleText = document.createElement('span');
  physicsToggleText.className = 'map-physics-label';
  physicsToggleText.textContent = 'Physics';

  const physicsToggleStatus = document.createElement('span');
  physicsToggleStatus.className = 'map-physics-status';
  physicsToggleStatus.textContent = previousPhysicsEnabled ? 'On' : 'Off';

  physicsToggle.append(physicsToggleInput, physicsToggleSlider, physicsToggleText, physicsToggleStatus);
  controlBar.appendChild(physicsToggle);

  mapContainer.appendChild(controlBar);

  const stopControlBarEventPropagation = (event) => {
    event.stopPropagation();
  };
  ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend'].forEach((eventName) => {
    controlBar.addEventListener(eventName, stopControlBarEventPropagation);
  });

  const setPhysicsToggleVisualState = (enabled) => {
    physicsToggle.classList.toggle('is-active', enabled);
    physicsToggle.setAttribute('data-state', enabled ? 'on' : 'off');
    physicsToggleStatus.textContent = enabled ? 'On' : 'Off';
    physicsToggleInput.checked = enabled;
  };

  setPhysicsToggleVisualState(previousPhysicsEnabled);
  let desiredPhysicsEnabled = previousPhysicsEnabled;

  const searchContext = {
    controls: searchControls,
    toggle: searchToggle,
    panel: searchPanel,
    input: searchInput,
    submit: searchSubmit,
    suggestions: searchSuggestions,
    message: searchMessage
  };

  const suggestionIdPrefix = `map-search-suggestion-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
  searchSuggestions.id = `${suggestionIdPrefix}-list`;
  searchInput.setAttribute('aria-controls', searchSuggestions.id);

  const MAX_SUGGESTION_RESULTS = 8;
  const MIN_FUZZY_SCORE = 5;
  let suggestionEntries = [];
  let suggestionDataset = [];
  let highlightedSuggestionIndex = -1;
  let exactMatchIndex = new Map();

  searchToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleSearchPanel();
  });

  searchSubmit.addEventListener('click', (event) => {
    event.stopPropagation();
    handleSearchSubmit();
  });

  searchPanel.addEventListener('click', (event) => event.stopPropagation());

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSuggestionHighlight(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSuggestionHighlight(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (highlightedSuggestionIndex >= 0) {
        applySuggestion(highlightedSuggestionIndex);
      } else {
        handleSearchSubmit();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (highlightedSuggestionIndex >= 0) {
        clearSuggestions();
        hideSuggestions();
      } else {
        closeSearchPanel();
      }
    }
  });

  searchInput.addEventListener('input', (event) => {
    updateSuggestionResults(event.target.value || '');
  });

  searchInput.addEventListener('focus', () => {
    if (suggestionEntries.length) {
      showSuggestions();
    }
  });

  if (mapContainer.__mapResizeObserver) {
    mapContainer.__mapResizeObserver.disconnect();
    delete mapContainer.__mapResizeObserver;
  }
  if (mapContainer.__mapResizeCleanup) {
    mapContainer.__mapResizeCleanup();
    delete mapContainer.__mapResizeCleanup;
  }

  const systems = {};
  let connections = [];
  const statuses = {};
  const placeholderCache = new Map();
  const connectionCandidates = new Map();
  const systemExpiryIndex = new Map();

  const getStatusColor = (nodeOrName) => {
    let statusKey = null;
    if (typeof nodeOrName === 'string') {
      statusKey = nodeOrName;
    } else if (nodeOrName && typeof nodeOrName === 'object') {
      statusKey = nodeOrName.filterKey || nodeOrName.originSystem || nodeOrName.name;
    }
    const status = statusKey ? statuses[statusKey] : undefined;
    if (status === '@FRIENDLY') return '#00ff00';
    if (status === '@HOLD') return '#ffeb3b';
    if (status === '@DANGER') return '#ff0000';
    if (status === '@HOME') return '#00ff00';
    return '#d3d3d3';
  };

  if (!options.preserveSelection) {
    if (typeof window.setSignatureActiveSystem === 'function') {
      window.setSignatureActiveSystem(null);
    }
    if (typeof window.setSystemIntelActiveSystem === 'function') {
      window.setSystemIntelActiveSystem(null);
    }
    window.__bookmarkViewerSelectedSystem = null;
  }

  const classColors = {
    "HS": "#2FEFEF",
    "LS": "#EFEF00",
    "NS": "#D6469D",
    "C1": "#00AAFF",
    "C2": "#2FEFEF",
    "C3": "#79F258",
    "C4": "#FFF200",
    "C5": "#FF7F27",
    "C6": "#ED1C24",
    "THERA": "#FFFFFF",
    "C13": "#7F7F7F",
    "PV": "#FF9800"
  };

  const systemsWithBookmarks = new Set();

  data.forEach((row) => {
    const systemName = (row && row['SOL'] !== undefined && row['SOL'] !== null)
      ? row['SOL'].toString().trim()
      : '';
    const normalizedSystemKey = normalizeSystemKey(systemName);
    if (normalizedSystemKey) {
      systemsWithBookmarks.add(systemName);
      if (!systems[systemName]) {
        systems[systemName] = {
          name: systemName,
          displayName: systemName,
          filterKey: systemName,
          originSystem: systemName
        };
      }

      const expiryInfo = getRowExpiry(row);
      if (expiryInfo) {
        const existing = systemExpiryIndex.get(normalizedSystemKey) || {
          hasInfinite: false,
          earliest: null,
          raw: null
        };
        if (expiryInfo.type === 'infinite') {
          existing.hasInfinite = true;
          existing.earliest = null;
          existing.raw = expiryInfo.rawValue ?? row['Expiry'] ?? '∞';
        } else if (expiryInfo.type === 'timestamp' && !existing.hasInfinite) {
          if (existing.earliest === null || expiryInfo.timestamp < existing.earliest) {
            existing.earliest = expiryInfo.timestamp;
            existing.raw = expiryInfo.rawValue ?? row['Expiry'] ?? '';
          }
        } else if (!existing.raw && expiryInfo.rawValue) {
          existing.raw = expiryInfo.rawValue;
        }
        systemExpiryIndex.set(normalizedSystemKey, existing);
      }
    }

    const rawLabel = (row && row['Label'] !== undefined && row['Label'] !== null)
      ? row['Label'].toString()
      : '';
    if (!rawLabel) {
      return;
    }

    const labelTokens = rawLabel.trim().split(/\s+/).filter(Boolean);
    const normalizedLabelTokens = labelTokens.map((token) => token.toUpperCase());

    if (rawLabel.startsWith('-')) {
      const [systemFrom, systemToRaw] = extractSystems(rawLabel, row['SOL']);
      if (systemFrom && systemToRaw) {
        const wormholeClassFromLabel = extractWormholeClass(rawLabel);
        const targetInfo = (() => {
          const tokens = systemToRaw.split(/\s+/).filter(Boolean);
          const placeholderIndex = tokens.findIndex((token) => {
            const normalized = token.replace(/[^?]/g, '');
            return normalized && PLACEHOLDER_PATTERN.test(normalized);
          });
          const trailingTokens = placeholderIndex >= 0 ? tokens.slice(placeholderIndex + 1) : [];
          const trailingAreFlags = trailingTokens.every((token) => {
            const normalized = token.replace(/[^A-Za-z]/g, '').toUpperCase();
            return normalized && PLACEHOLDER_FLAG_TOKENS.has(normalized);
          });
          const isPlaceholderCandidate = placeholderIndex >= 0 && (trailingTokens.length === 0 || trailingAreFlags);

          if (isPlaceholderCandidate) {
            const baseTokens = tokens.slice(0, placeholderIndex + 1);
            const placeholderTokenRaw = tokens[placeholderIndex] || '???';
            const displayName = placeholderTokenRaw.replace(/[^?]/g, '') || '???';
            const placeholderKeyTokens = baseTokens
              .slice(0, -1)
              .concat(displayName);
            const placeholderKey = placeholderKeyTokens.join(' ') || '???';
            const resolvedClass =
              wormholeClassFromLabel ||
              extractWormholeClass(placeholderKey) ||
              null;
            const normalizedClass = resolvedClass ? resolvedClass.toUpperCase() : null;
            const cacheKey = buildPlaceholderKey(systemFrom, placeholderKey, row);
            const cached = placeholderCache.get(cacheKey);
            if (cached) {
              if (normalizedClass && cached.wormholeClass !== normalizedClass) {
                cached.wormholeClass = normalizedClass;
              }
              if (displayName && cached.displayName !== displayName) {
                cached.displayName = displayName;
              }
              return cached;
            }
            const hash = stableHash(cacheKey);
            const suffix = (hash.length >= 6 ? hash.slice(0, 6) : hash.padEnd(6, '0')).toUpperCase();
            const id = `${systemFrom}::UNKNOWN::${suffix}`;
            const entry = {
              id,
              displayName,
              filterKey: systemFrom,
              isPlaceholder: true,
              originSystem: systemFrom,
              wormholeClass: normalizedClass,
              hash,
              cacheKey
            };
            placeholderCache.set(cacheKey, entry);
            return entry;
          }

          const legacyMatch = systemToRaw.match(/^([A-Z0-9]{2})(.*?) (\?+)$/);
          if (PLACEHOLDER_PATTERN.test(systemToRaw) || legacyMatch) {
            const placeholderTokenRaw = legacyMatch ? legacyMatch[3] : systemToRaw;
            const displayName = placeholderTokenRaw.replace(/[^?]/g, '') || '???';
            const legacyPrefix = legacyMatch ? `${legacyMatch[1]}${legacyMatch[2]}`.trim() : '';
            const placeholderKey = legacyPrefix ? `${legacyPrefix} ${displayName}`.trim() : displayName;
            const placeholderClass = legacyMatch ? legacyMatch[1] : null;
            const resolvedClassRaw =
              wormholeClassFromLabel ||
              placeholderClass ||
              extractWormholeClass(placeholderKey) ||
              null;
            const normalizedClass = resolvedClassRaw ? resolvedClassRaw.toUpperCase() : null;
            const cacheKey = buildPlaceholderKey(systemFrom, placeholderKey, row);
            const cached = placeholderCache.get(cacheKey);
            if (cached) {
              if (normalizedClass && cached.wormholeClass !== normalizedClass) {
                cached.wormholeClass = normalizedClass;
              }
              if (displayName && cached.displayName !== displayName) {
                cached.displayName = displayName;
              }
              return cached;
            }
            const hash = stableHash(cacheKey);
            const suffix = (hash.length >= 6 ? hash.slice(0, 6) : hash.padEnd(6, '0')).toUpperCase();
            const id = `${systemFrom}::UNKNOWN::${suffix}`;
            const entry = {
              id,
              displayName,
              filterKey: systemFrom,
              isPlaceholder: true,
              originSystem: systemFrom,
              wormholeClass: normalizedClass,
              hash,
              cacheKey
            };
            placeholderCache.set(cacheKey, entry);
            return entry;
          }

          return {
            id: systemToRaw,
            displayName: systemToRaw,
            filterKey: systemToRaw,
            isPlaceholder: false,
            originSystem: systemToRaw
          };
        })();

        const systemTo = targetInfo.id;
        if (targetInfo.isPlaceholder && !targetInfo.wormholeClass && wormholeClassFromLabel) {
          targetInfo.wormholeClass = wormholeClassFromLabel.toUpperCase();
        }
        const isVEOL = normalizedLabelTokens.includes('VEOL');
        const isEOL = normalizedLabelTokens.includes('EOL');
        const isCRIT = normalizedLabelTokens.includes('CRIT');
        const candidateKey = buildConnectionKey(systemFrom, systemTo);
        let candidate = connectionCandidates.get(candidateKey);
        if (!candidate) {
          candidate = {
            directions: new Set(),
            isVEOL: false,
            isEOL: false,
            isCRIT: false,
            containsPlaceholder: false,
            firstDirection: null
          };
          connectionCandidates.set(candidateKey, candidate);
        }
        candidate.directions.add(`${systemFrom}|${systemTo}`);
        candidate.isVEOL = candidate.isVEOL || isVEOL;
        candidate.isEOL = candidate.isEOL || isEOL;
        candidate.isCRIT = candidate.isCRIT || isCRIT;
        candidate.containsPlaceholder = candidate.containsPlaceholder || Boolean(targetInfo.isPlaceholder);
        if (!candidate.firstDirection) {
          candidate.firstDirection = { source: systemFrom, target: systemTo };
        }

        const sourceEntry = systems[systemFrom] || { name: systemFrom };
        sourceEntry.label = rawLabel;
        sourceEntry.filterKey = systemFrom;
        sourceEntry.displayName = sourceEntry.displayName || systemFrom;
        sourceEntry.originSystem = sourceEntry.originSystem || systemFrom;
        systems[systemFrom] = sourceEntry;

        const targetEntry = systems[systemTo] || { name: systemTo };
        targetEntry.label = rawLabel;
        targetEntry.displayName = targetInfo.displayName || systemTo;
        targetEntry.filterKey = targetInfo.filterKey || systemTo;
        targetEntry.isPlaceholder = targetInfo.isPlaceholder || false;
        targetEntry.originSystem = targetInfo.originSystem || systemTo;
        if (targetEntry.isPlaceholder) {
          const classFromTarget = targetInfo.wormholeClass || wormholeClassFromLabel || targetEntry.wormholeClass || null;
          targetEntry.wormholeClass = classFromTarget ? classFromTarget.toUpperCase() : null;
        }
        systems[systemTo] = targetEntry;
      }
    } else if (rawLabel.startsWith('@')) {
      const system = (row['SOL'] || '').toString().trim();
      const status = rawLabel.split(' ')[0];
      if (system) {
        statuses[system] = status;
      }
    }
  });

  Object.values(systems).forEach((systemNode) => {
    const lookupKeys = systemNode.isPlaceholder
      ? [systemNode.name].filter(Boolean)
      : [systemNode.name, systemNode.filterKey, systemNode.originSystem].filter(Boolean);
    let resolved = null;
    for (let index = 0; index < lookupKeys.length; index += 1) {
      const candidateKey = normalizeSystemKey(lookupKeys[index]);
      if (!candidateKey) {
        continue;
      }
      const candidate = systemExpiryIndex.get(candidateKey);
      if (!candidate) {
        continue;
      }
      if (candidate.hasInfinite) {
        resolved = { type: 'infinite', timestamp: null, rawValue: candidate.raw };
        break;
      }
      if (candidate.earliest !== null) {
        if (!resolved || resolved.timestamp === null || candidate.earliest < resolved.timestamp) {
          resolved = {
            type: 'timestamp',
            timestamp: candidate.earliest,
            rawValue: candidate.raw
          };
        }
      } else if (!resolved) {
        resolved = { type: 'unknown', timestamp: null, rawValue: candidate.raw };
      }
    }
    systemNode.expiryInfo = resolved || { type: 'unknown', timestamp: null, rawValue: null };
  });

  connections = [];
  connectionCandidates.forEach((candidate, key) => {
    const hasBothDirections = candidate.directions.size >= 2;
    if (!hasBothDirections && !candidate.containsPlaceholder) {
      return;
    }
    const direction = candidate.firstDirection;
    let source;
    let target;
    if (direction) {
      source = direction.source;
      target = direction.target;
    } else {
      const [first, second] = key.split('|');
      source = first;
      target = second;
    }
    if (!source || !target) {
      return;
    }
    connections.push({
      source,
      target,
      isVEOL: candidate.isVEOL,
      isEOL: candidate.isEOL,
      isCRIT: candidate.isCRIT
    });
  });

  const connectedSystemNames = new Set();
  connections.forEach((connection) => {
    if (connection && connection.source) {
      connectedSystemNames.add(connection.source);
    }
    if (connection && connection.target) {
      connectedSystemNames.add(connection.target);
    }
  });

  const nodes = Object.values(systems).filter((node) => (
    systemsWithBookmarks.has(node.name) || connectedSystemNames.has(node.name)
  ));
  const links = connections.filter((connection) => (
    connectedSystemNames.has(connection.source) && connectedSystemNames.has(connection.target)
  ));

  suggestionDataset = buildSearchIndex(nodes);
  exactMatchIndex = buildExactMatchIndex(suggestionDataset);
  clearSuggestions();
  hideSuggestions();

  console.log('systems:', systems);
  console.log('connections:', links);
  console.log('statuses:', statuses);
  const hasPreviousLayout = previousPositions.size > 0;
  const nodesByName = new Map(nodes.map((node) => [node.name, node]));
  const adjacency = new Map();

  const addNeighbor = (from, to) => {
    if (!from || !to) {
      return;
    }
    let neighbors = adjacency.get(from);
    if (!neighbors) {
      neighbors = new Set();
      adjacency.set(from, neighbors);
    }
    neighbors.add(to);
  };

  links.forEach((link) => {
    addNeighbor(link.source, link.target);
    addNeighbor(link.target, link.source);
  });

  const containerRect = mapContainer.getBoundingClientRect();
  let width = Math.max(containerRect.width || 0, mapContainer.clientWidth, mapContainer.offsetWidth || 0);
  let height = Math.max(containerRect.height || 0, mapContainer.clientHeight, mapContainer.offsetHeight || 0);

  if (!width) {
    width = 800;
  }
  if (!height) {
    height = 600;
  }

  if (!hasPreviousLayout) {
    // Group nodes into chains
    const chains = [];
    const visited = new Set();

    nodes.forEach(node => {
      if (!visited.has(node.name)) {
        const chain = [];
        const stack = [node];
        while (stack.length > 0) {
          const current = stack.pop();
          if (!visited.has(current.name)) {
            visited.add(current.name);
            chain.push(current);
            links.forEach(link => {
              if (link.source === current.name && !visited.has(link.target)) {
                stack.push(systems[link.target]);
              } else if (link.target === current.name && !visited.has(link.source)) {
                stack.push(systems[link.source]);
              }
            });
          }
        }
        chains.push(chain);
      }
    });

    // Position chains further apart
    chains.forEach((chain, index) => {
      const angle = (index / chains.length) * 2 * Math.PI;
      const centerX = width / 2 + Math.cos(angle) * CHAIN_SPACING * index;
      const centerY = height / 2 + Math.sin(angle) * CHAIN_SPACING * index;
      chain.forEach((node, nodeIndex) => {
        node.x = centerX + Math.cos(angle + nodeIndex) * SPIRAL_RADIUS;
        node.y = centerY + Math.sin(angle + nodeIndex) * SPIRAL_RADIUS;
      });
    });
  }

  const randomOffset = () => (Math.random() - 0.5) * 40;

  nodes.forEach((node) => {
    const saved = previousPositions.get(node.name);
    if (saved) {
      node.x = saved.x;
      node.y = saved.y;
      node.vx = 0;
      node.vy = 0;
      const savedFx = Number.isFinite(saved.fx) ? saved.fx : saved.x;
      const savedFy = Number.isFinite(saved.fy) ? saved.fy : saved.y;
      node.fx = savedFx;
      node.fy = savedFy;
      return;
    }

    if (!hasPreviousLayout) {
      node.vx = 0;
      node.vy = 0;
      return;
    }

    const neighborNames = adjacency.get(node.name);
    if (neighborNames && neighborNames.size > 0) {
      const neighborPositions = Array.from(neighborNames)
        .map((neighbor) => {
          const position = previousPositions.get(neighbor);
          if (position) {
            return position;
          }
          const neighborNode = nodesByName.get(neighbor);
          return neighborNode ? { x: neighborNode.x, y: neighborNode.y } : null;
        })
        .filter(Boolean);

      if (neighborPositions.length > 0) {
        const avgX = neighborPositions.reduce((sum, pos) => sum + (Number.isFinite(pos.x) ? pos.x : width / 2), 0) / neighborPositions.length;
        const avgY = neighborPositions.reduce((sum, pos) => sum + (Number.isFinite(pos.y) ? pos.y : height / 2), 0) / neighborPositions.length;
        node.x = avgX + randomOffset();
        node.y = avgY + randomOffset();
        node.vx = 0;
        node.vy = 0;
        return;
      }
    }

    node.x = (width / 2) + randomOffset();
    node.y = (height / 2) + randomOffset();
    node.vx = 0;
    node.vy = 0;
  });

  console.log('mapContainer dimensions:', width, height);

  const svg = d3.select('#mapContainer').append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', [0, 0, width, height])
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .on('contextmenu', (event) => event.preventDefault()); // Prevent default right-click menu

  const g = svg.append('g');

  let currentTransform = previousTransform || d3.zoomIdentity;

  const runtimeState = {
    simulation: null,
    nodes,
    currentTransform,
    settleTimer: null,
    physicsEnabled: desiredPhysicsEnabled
  };

  const syncPhysicsSimulation = () => {
    const sim = runtimeState.simulation;
    if (!sim) {
      return;
    }

    if (runtimeState.physicsEnabled) {
      if (runtimeState.settleTimer) {
        clearTimeout(runtimeState.settleTimer);
        runtimeState.settleTimer = null;
      }
      unlockNodes(runtimeState.nodes);
      sim.alpha(0.65).alphaTarget(0.08).restart();
    } else {
      lockNodes(sim, runtimeState.nodes);
      runtimeState.settleTimer = null;
    }
  };

  physicsToggleInput.addEventListener('change', (event) => {
    desiredPhysicsEnabled = !!event.target.checked;
    runtimeState.physicsEnabled = desiredPhysicsEnabled;
    setPhysicsToggleVisualState(desiredPhysicsEnabled);
    syncPhysicsSimulation();
  });

  window.__bookmarkViewerSetPhysicsEnabled = (value) => {
    desiredPhysicsEnabled = !!value;
    runtimeState.physicsEnabled = desiredPhysicsEnabled;
    setPhysicsToggleVisualState(desiredPhysicsEnabled);
    syncPhysicsSimulation();
  };

  const zoom = d3.zoom()
    .scaleExtent([0.1, 10])
    .on('zoom', (event) => {
      currentTransform = event.transform;
      runtimeState.currentTransform = currentTransform;
      g.attr('transform', currentTransform);
    });

  const resetNodeStyles = () => {
    node
      .attr('fill', (d) => getStatusColor(d))
      .attr('stroke', (d) => getStatusColor(d));
  };

  function setSearchMessage(text = '', tone = 'info') {
    if (!searchContext.message) {
      return;
    }
    searchContext.message.textContent = text;
    searchContext.message.classList.toggle('map-search-message-error', tone === 'error');
  }

  function clearSuggestions() {
    highlightedSuggestionIndex = -1;
    suggestionEntries = [];
    if (searchContext.suggestions) {
      searchContext.suggestions.innerHTML = '';
    }
    if (searchContext.input) {
      searchContext.input.setAttribute('aria-activedescendant', '');
    }
  }

  function hideSuggestions() {
    if (!searchContext.suggestions) {
      return;
    }
    searchContext.suggestions.hidden = true;
    if (searchContext.input) {
      searchContext.input.setAttribute('aria-expanded', 'false');
    }
  }

  function showSuggestions() {
    if (!searchContext.suggestions || !suggestionEntries.length) {
      return;
    }
    searchContext.suggestions.hidden = false;
    if (searchContext.input) {
      searchContext.input.setAttribute('aria-expanded', 'true');
    }
  }

  function highlightSuggestion(index) {
    if (!searchContext.suggestions) {
      return;
    }
    const items = searchContext.suggestions.querySelectorAll('.map-search-suggestion');
    items.forEach((item) => item.classList.remove('is-active'));
    highlightedSuggestionIndex = index;
    if (index >= 0 && index < items.length) {
      const activeItem = items[index];
      activeItem.classList.add('is-active');
      if (searchContext.input) {
        searchContext.input.setAttribute('aria-activedescendant', activeItem.id || '');
      }
      activeItem.scrollIntoView({ block: 'nearest' });
    } else if (searchContext.input) {
      searchContext.input.setAttribute('aria-activedescendant', '');
    }
  }

  function moveSuggestionHighlight(delta) {
    if (!suggestionEntries.length) {
      return;
    }
    let nextIndex;
    if (highlightedSuggestionIndex < 0) {
      nextIndex = delta > 0 ? 0 : suggestionEntries.length - 1;
    } else {
      nextIndex = highlightedSuggestionIndex + delta;
      if (nextIndex < 0) {
        nextIndex = suggestionEntries.length - 1;
      } else if (nextIndex >= suggestionEntries.length) {
        nextIndex = 0;
      }
    }
    highlightSuggestion(nextIndex);
  }

  function applySuggestion(index) {
    const suggestion = suggestionEntries[index];
    if (!suggestion || !suggestion.node) {
      return;
    }
    if (searchContext.input) {
      searchContext.input.value = suggestion.primaryLabel;
    }
    hideSuggestions();
    clearSuggestions();
    handleSearchSubmit(suggestion.node);
  }

  function renderSuggestionList(results, query) {
    if (!searchContext.suggestions) {
      return;
    }
    searchContext.suggestions.innerHTML = '';
    highlightedSuggestionIndex = -1;
    suggestionEntries = results;

    if (!results.length) {
      hideSuggestions();
      if (searchContext.input) {
        searchContext.input.setAttribute('aria-activedescendant', '');
      }
      return;
    }

    const fragment = document.createDocumentFragment();
    results.forEach((result, index) => {
      const item = document.createElement('li');
      const optionId = `${suggestionIdPrefix}-${index}`;
      item.className = 'map-search-suggestion';
      item.id = optionId;
      item.setAttribute('role', 'option');
      item.setAttribute('data-index', index.toString());
      item.innerHTML = buildSuggestionMarkup(result, query);
      item.addEventListener('mouseenter', () => highlightSuggestion(index));
      item.addEventListener('mouseleave', () => {
        if (highlightedSuggestionIndex === index) {
          highlightSuggestion(-1);
        }
      });
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        applySuggestion(index);
      });
      fragment.appendChild(item);
    });
    searchContext.suggestions.appendChild(fragment);
    showSuggestions();
  }

  function updateSuggestionResults(rawQuery) {
    if (!searchContext.input) {
      return;
    }
    const query = rawQuery.trim();
    if (!query) {
      clearSuggestions();
      hideSuggestions();
      return;
    }
    if (!suggestionDataset.length) {
      clearSuggestions();
      hideSuggestions();
      return;
    }
    const results = runFuzzySearch(query, MAX_SUGGESTION_RESULTS);
    renderSuggestionList(results, query);
  }

  function buildSuggestionMarkup(result, query) {
    const primary = highlightMatch(result.displayLabel, query);
    const metadata = result.meta ? `<span class="map-search-suggestion-meta">${escapeHtml(result.meta)}</span>` : '';
    return `<span class="map-search-suggestion-label">${primary}</span>${metadata}`;
  }

  function highlightMatch(label, query) {
    if (!label) {
      return '';
    }
    const normalizedLabel = label.toLowerCase();
    const normalizedQuery = query.toLowerCase();
    const index = normalizedLabel.indexOf(normalizedQuery);
    if (index === -1 || !query) {
      return escapeHtml(label);
    }
    const before = escapeHtml(label.slice(0, index));
    const match = escapeHtml(label.slice(index, index + query.length));
    const after = escapeHtml(label.slice(index + query.length));
    return `${before}<span class="map-search-suggestion-highlight">${match}</span>${after}`;
  }

  function escapeHtml(value) {
    if (value === undefined || value === null) {
      return '';
    }
    return value
      .toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function runFuzzySearch(rawQuery, limit = MAX_SUGGESTION_RESULTS) {
    const query = rawQuery.trim().toLowerCase();
    if (!query) {
      return [];
    }
    const results = [];
    suggestionDataset.forEach((entry) => {
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestLabel = entry.primaryLabel;
      for (let index = 0; index < entry.normalizedLabels.length; index += 1) {
        const candidate = entry.normalizedLabels[index];
        const score = computeFuzzyScore(candidate, query);
        if (score > bestScore) {
          bestScore = score;
          bestLabel = entry.labels[index];
        }
      }
      if (bestScore >= MIN_FUZZY_SCORE) {
        const displayLabel = bestLabel || entry.primaryLabel;
        const metaParts = [];
        const pushMeta = (value) => {
          if (!value || typeof value !== 'string') {
            return;
          }
          const trimmed = value.trim();
          if (!trimmed) {
            return;
          }
          if (!metaParts.includes(trimmed)) {
            metaParts.push(trimmed);
          }
        };
        if (displayLabel !== entry.primaryLabel) {
          pushMeta(entry.primaryLabel);
        }
        if (Array.isArray(entry.metaParts)) {
          entry.metaParts.forEach(pushMeta);
        }
        results.push({
          node: entry.node,
          primaryLabel: entry.primaryLabel,
          displayLabel,
          meta: metaParts.join(' • '),
          score: bestScore
        });
      }
    });

    results.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.primaryLabel.localeCompare(b.primaryLabel);
    });

    if (limit > 0) {
      return results.slice(0, limit);
    }
    return results;
  }

  function buildSearchIndex(nodesList) {
    const entries = [];
    if (!Array.isArray(nodesList)) {
      return entries;
    }
    nodesList.forEach((node) => {
      if (!node || !node.name || node.isPlaceholder) {
        return;
      }
      const primaryLabel = (typeof node.displayName === 'string' && node.displayName.trim())
        ? node.displayName.trim()
        : node.name;
      const labelMap = new Map();
      const addLabel = (value) => {
        if (!value || typeof value !== 'string') {
          return;
        }
        const trimmed = value.trim();
        if (!trimmed) {
          return;
        }
        const normalized = trimmed.toLowerCase();
        if (!labelMap.has(normalized)) {
          labelMap.set(normalized, trimmed);
        }
      };
      addLabel(node.name);
      addLabel(node.displayName);
      addLabel(node.filterKey);
      addLabel(node.originSystem);
      addLabel(node.nickname);
      addLabel(node.id);

      const labels = Array.from(labelMap.values());
      const normalizedLabels = Array.from(labelMap.keys());

      const metaParts = [];
      if (typeof node.wormholeClass === 'string' && node.wormholeClass.trim()) {
        metaParts.push(node.wormholeClass.trim().toUpperCase());
      }
      const originLabel = node.originSystem || node.filterKey;
      if (originLabel && originLabel !== primaryLabel) {
        metaParts.push(originLabel);
      }
      entries.push({
        node,
        primaryLabel,
        labels,
        normalizedLabels,
        metaParts
      });
    });
    return entries;
  }

  function buildExactMatchIndex(entries) {
    const map = new Map();
    entries.forEach((entry) => {
      entry.normalizedLabels.forEach((label) => {
        if (!map.has(label)) {
          map.set(label, entry.node);
        }
      });
    });
    return map;
  }

  function computeFuzzyScore(candidate, query) {
    if (!candidate) {
      return Number.NEGATIVE_INFINITY;
    }
    if (candidate === query) {
      return 100;
    }
    let score = 0;
    if (candidate.startsWith(query)) {
      score += 60;
    }
    const index = candidate.indexOf(query);
    if (index >= 0) {
      score += 40 - (index * 1.5);
    }
    const distance = levenshteinDistance(query, candidate);
    const maxLen = Math.max(candidate.length, query.length) || 1;
    const similarity = 1 - (distance / maxLen);
    score += similarity * 35;
    score += sequentialMatchBonus(candidate, query);
    return score;
  }

  function sequentialMatchBonus(candidate, query) {
    if (!candidate || !query) {
      return 0;
    }
    let score = 0;
    let lastIndex = -1;
    for (let i = 0; i < query.length; i += 1) {
      const char = query[i];
      const nextIndex = candidate.indexOf(char, lastIndex + 1);
      if (nextIndex === -1) {
        score -= 3;
        continue;
      }
      score += 4;
      if (nextIndex === lastIndex + 1) {
        score += 2;
      }
      lastIndex = nextIndex;
    }
    return score;
  }

  function levenshteinDistance(a, b) {
    if (a === b) {
      return 0;
    }
    const lenA = a.length;
    const lenB = b.length;
    if (lenA === 0) {
      return lenB;
    }
    if (lenB === 0) {
      return lenA;
    }
    const previous = new Array(lenB + 1);
    const current = new Array(lenB + 1);
    for (let j = 0; j <= lenB; j += 1) {
      previous[j] = j;
    }
    for (let i = 1; i <= lenA; i += 1) {
      current[0] = i;
      const charA = a.charCodeAt(i - 1);
      for (let j = 1; j <= lenB; j += 1) {
        const charB = b.charCodeAt(j - 1);
        const cost = charA === charB ? 0 : 1;
        current[j] = Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + cost
        );
      }
      for (let j = 0; j <= lenB; j += 1) {
        previous[j] = current[j];
      }
    }
    return previous[lenB];
  }

  function openSearchPanel() {
    if (!searchContext.panel || !searchContext.toggle) {
      return;
    }
    if (!searchContext.panel.hidden) {
      return;
    }
    searchContext.panel.hidden = false;
    searchContext.toggle.setAttribute('aria-expanded', 'true');
    setSearchMessage();
    if (searchContext.input && searchContext.input.value.trim()) {
      updateSuggestionResults(searchContext.input.value);
    }
    requestAnimationFrame(() => {
      if (searchContext.input) {
        searchContext.input.focus();
        searchContext.input.select();
        if (suggestionEntries.length) {
          showSuggestions();
        }
      }
    });
  }

  function closeSearchPanel() {
    if (!searchContext.panel || !searchContext.toggle) {
      return;
    }
    if (searchContext.panel.hidden) {
      return;
    }
    searchContext.panel.hidden = true;
    searchContext.toggle.setAttribute('aria-expanded', 'false');
    setSearchMessage();
    clearSuggestions();
    hideSuggestions();
  }

  function toggleSearchPanel() {
    if (!searchContext.panel) {
      return;
    }
    if (searchContext.panel.hidden) {
      openSearchPanel();
    } else {
      closeSearchPanel();
    }
  }

  function findNodeByQuery(rawQuery) {
    if (!rawQuery) {
      return null;
    }
    const query = rawQuery.trim().toLowerCase();
    if (!query) {
      return null;
    }
    const directMatch = exactMatchIndex.get(query);
    if (directMatch) {
      return directMatch;
    }
    return nodes.find((nodeEntry) => {
      if (!nodeEntry) {
        return false;
      }
      const nameMatch = typeof nodeEntry.name === 'string' && nodeEntry.name.toLowerCase() === query;
      const displayMatch = typeof nodeEntry.displayName === 'string' && nodeEntry.displayName.toLowerCase() === query;
      return nameMatch || displayMatch;
    }) || null;
  }

  function applySystemSelection(target) {
    if (!target) {
      return false;
    }

    const targetNode = typeof target === 'string'
      ? findNodeByQuery(target)
      : target;

    if (!targetNode) {
      return false;
    }

    resetNodeStyles();
    updateCrosshair(targetNode, classColors);

    const selectionKey = targetNode.filterKey || targetNode.name;
    const keys = ['Label', 'Type', 'Jumps', 'SOL', 'CON', 'REG', 'Date', 'Expiry', 'Creator'];
    displayTable(keys, data, selectionKey);
    window.__bookmarkViewerSelectedSystem = selectionKey;
    syncPhysicsSimulation();

    if (typeof window.setSignatureActiveSystem === 'function') {
      window.setSignatureActiveSystem(selectionKey);
    }
    if (typeof window.setSystemIntelActiveSystem === 'function') {
      window.setSystemIntelActiveSystem(selectionKey);
    }

    if (typeof filterBookmarksBySystem === 'function') {
      filterBookmarksBySystem(selectionKey);
    }

    closeSearchPanel();

    return true;
  }

  window.__bookmarkViewerApplySystemSelection = applySystemSelection;

  function focusOnSystem(targetNode) {
    if (!targetNode) {
      return false;
    }
    if (!Number.isFinite(targetNode.x) || !Number.isFinite(targetNode.y)) {
      return false;
    }

    const desiredScale = 1.8;
    const minScale = 0.5;
    const maxScale = 4;
    const targetScale = Math.min(maxScale, Math.max(desiredScale, currentTransform.k || minScale));
    const translateX = (width / 2) - (targetNode.x * targetScale);
    const translateY = (height / 2) - (targetNode.y * targetScale);
    const transform = d3.zoomIdentity.translate(translateX, translateY).scale(targetScale);

    svg.transition()
      .duration(650)
      .ease(d3.easeCubicOut)
      .call(zoom.transform, transform);

    return true;
  }

  function handleSearchSubmit(preselectedNode = null) {
    if (!searchContext.input) {
      return;
    }
    const rawValue = searchContext.input.value || '';
    const query = rawValue.trim();
    let targetNode = preselectedNode;

    if (!targetNode) {
      if (!query) {
        setSearchMessage('Enter a system name.', 'error');
        return;
      }
      targetNode = findNodeByQuery(query);
      if (!targetNode && suggestionEntries.length) {
        const firstSuggestion = suggestionEntries[0];
        if (firstSuggestion && firstSuggestion.node) {
          targetNode = firstSuggestion.node;
          if (firstSuggestion.primaryLabel) {
            searchContext.input.value = firstSuggestion.primaryLabel;
          }
        }
      }
    } else if (!query) {
      const preferredLabel = preselectedNode.displayName || preselectedNode.name;
      if (preferredLabel) {
        searchContext.input.value = preferredLabel;
      }
    }

    if (!targetNode) {
      setSearchMessage('System not found', 'error');
      return;
    }

    clearSuggestions();
    hideSuggestions();

    const selectionApplied = applySystemSelection(targetNode);

    if (!selectionApplied) {
      setSearchMessage('System not found', 'error');
      return;
    }

    const focused = focusOnSystem(targetNode);

    if (!focused) {
      setSearchMessage('System found but still settling. Try again shortly.');
      return;
    }

    setSearchMessage();
  }

  svg.call(zoom);
  if (currentTransform) {
    g.attr('transform', currentTransform);
    svg.call(zoom.transform, currentTransform);
  }

  const zoomRect = g.append('rect')
    .attr('class', 'zoom-rect')
    .attr('width', width)
    .attr('height', height);

  zoomRect
    .on('mousedown', (event) => {
      if (event.button === 0) { // Left-click for panning
        svg.call(d3.drag()
          .on('start', () => {
            svg.on('mousemove', (event) => {
              const dx = event.movementX;
              const dy = event.movementY;
              const transform = d3.zoomTransform(svg.node());
              transform.x += dx;
              transform.y += dy;
              g.attr('transform', transform);
            });
          })
          .on('end', () => {
            svg.on('mousemove', null);
          }));
      }
    })
    .on('mouseup', (event) => {
      if (event.button === 0) {
        svg.on('mousemove', null); // Disable panning on mouseup
      }
    });

  const crosshairLayer = g.append('g')
    .attr('class', 'crosshair-layer');

  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id((d) => d.name).distance(100))
    .force('charge', d3.forceManyBody().strength(-10))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collide', d3.forceCollide(50))
    .on('tick', ticked);

  if (hasPreviousLayout) {
    simulation.alpha(0.35);
  }

  runtimeState.simulation = simulation;
  runtimeState.nodes = nodes;
  mapContainer.__mapRuntime = runtimeState;
  if (runtimeState.physicsEnabled) {
    syncPhysicsSimulation();
  } else {
    const settleDelay = 200;
    // Let the physics engine settle briefly so new systems space out, then freeze the layout.
    const settleTimer = setTimeout(() => {
      if (mapContainer.__mapRuntime !== runtimeState) {
        return;
      }
      if (!runtimeState.physicsEnabled) {
        lockNodes(simulation, nodes);
      }
      runtimeState.settleTimer = null;
    }, settleDelay);
    runtimeState.settleTimer = settleTimer;
  }

  const updateViewportSize = (nextWidth, nextHeight) => {
    if (!nextWidth || !nextHeight) {
      return false;
    }

    if (Math.abs(nextWidth - width) < 0.5 && Math.abs(nextHeight - height) < 0.5) {
      return false;
    }

    width = nextWidth;
    height = nextHeight;

    svg.attr('viewBox', [0, 0, width, height]);
    zoomRect
      .attr('width', width)
      .attr('height', height);

    const centerForce = simulation.force('center');
    if (centerForce) {
      centerForce.x(width / 2).y(height / 2);
    }

    simulation.alpha(0.3).restart();
    svg.call(zoom.transform, currentTransform);
    crosshairLayer.selectAll('.crosshair').remove();

    const activeSelection = window.__bookmarkViewerSelectedSystem;
    if (activeSelection) {
      const activeNode = findNodeByQuery(activeSelection);
      if (activeNode) {
        updateCrosshair(activeNode, classColors);
      }
    }

    return true;
  };

  if (typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target !== mapContainer) {
          continue;
        }

        updateViewportSize(entry.contentRect.width, entry.contentRect.height);
      }
    });

    resizeObserver.observe(mapContainer);
    mapContainer.__mapResizeObserver = resizeObserver;
  } else {
    const handleWindowResize = () => {
      const rect = mapContainer.getBoundingClientRect();
      updateViewportSize(rect.width || mapContainer.clientWidth, rect.height || mapContainer.clientHeight);
    };

    let resizeAttempts = 0;
    const maxAttempts = 10;
    const attemptViewportSync = () => {
      const rect = mapContainer.getBoundingClientRect();
      const didUpdate = updateViewportSize(rect.width || mapContainer.clientWidth, rect.height || mapContainer.clientHeight);
      if (!didUpdate && resizeAttempts < maxAttempts) {
        resizeAttempts += 1;
        requestAnimationFrame(attemptViewportSync);
      }
    };

    requestAnimationFrame(attemptViewportSync);
    window.addEventListener('resize', handleWindowResize);
    mapContainer.__mapResizeCleanup = () => {
      window.removeEventListener('resize', handleWindowResize);
    };
  }

  const link = g.append('g')
    .attr('class', 'links')
    .selectAll('line')
    .data(links)
    .enter().append('line')
    .attr('stroke-width', 5)
    .attr('stroke', (d) => {
      if (d.isVEOL && d.isCRIT) return 'url(#gradient-veol-crit)';
      if (d.isVEOL) return '#FF0000'; // Red for VEOL
      if (d.isEOL && d.isCRIT) return 'url(#gradient-eol-crit)';
      if (d.isEOL) return '#800080'; // Purple for EOL
      if (d.isCRIT) return '#FFA500'; // Orange for CRIT
      return '#00ff00'; // Green otherwise
    });

  const svgDefs = svg.append('defs');
  const gradient = svgDefs.append('linearGradient')
    .attr('id', 'gradient-eol-crit')
    .attr('x1', '0%')
    .attr('y1', '0%')
    .attr('x2', '100%')
    .attr('y2', '100%');
  gradient.append('stop')
    .attr('offset', '0%')
    .attr('stop-color', '#800080'); // Purple
  gradient.append('stop')
    .attr('offset', '100%')
    .attr('stop-color', '#FFA500'); // Orange

  const veolGradient = svgDefs.append('linearGradient')
    .attr('id', 'gradient-veol-crit')
    .attr('x1', '0%')
    .attr('y1', '0%')
    .attr('x2', '100%')
    .attr('y2', '100%');
  veolGradient.append('stop')
    .attr('offset', '0%')
    .attr('stop-color', '#FF0000'); // Red
  veolGradient.append('stop')
    .attr('offset', '100%')
    .attr('stop-color', '#FFA500'); // Orange

  const node = g.append('g')
    .attr('class', 'nodes')
    .selectAll('circle')
    .data(nodes)
    .enter().append('circle')
    .attr('r', 10)
    .attr('fill', (d) => getStatusColor(d))
    .attr('stroke', (d) => getStatusColor(d))
    .attr('stroke-width', 1.5)
    .call(d3.drag()
      .on('start', (event, d) => {
        if (event.sourceEvent.button === 0) { // Left-click for dragging nodes
          dragStarted(event, d, simulation);
        }
      })
      .on('drag', (event, d) => {
        if (event.sourceEvent.button === 0) { // Left-click for dragging nodes
          dragged(event, d);
          updateCrosshair(d, classColors);
        }
      })
      .on('end', (event, d) => {
        if (event.sourceEvent.button === 0) { // Left-click for dragging nodes
          dragEnded(event, d, simulation);
          syncPhysicsSimulation(); // Reapply physics state after dragging ends
        }
      }))
    .on('click', (event, d) => {
      if (event.button === 0) { // Left-click for selecting nodes
        applySystemSelection(d);
      }
    });

  // Add event listener to reset table filter when clicking off the table
  d3.select('#mapContainer').on('click', function (event) {
    if (event.target.tagName !== 'circle') {
      resetNodeStyles();

      // Remove existing crosshair
      crosshairLayer.selectAll('.crosshair').remove();

      const keys = ['Label', 'Type', 'Jumps', 'SOL', 'CON', 'REG', 'Date', 'Expiry', 'Creator']; // Define keys
      displayTable(keys, data); // Reset table filter
      syncPhysicsSimulation(); // Reapply physics mode after clearing selection
      if (typeof window.setSignatureActiveSystem === 'function') {
        window.setSignatureActiveSystem(null);
      }
      if (typeof window.setSystemIntelActiveSystem === 'function') {
        window.setSystemIntelActiveSystem(null);
      }
      window.__bookmarkViewerSelectedSystem = null;
      closeSearchPanel();
    }
  });

  const labels = g.append('g')
    .attr('class', 'labels')
    .selectAll('g')
    .data(nodes)
    .enter().append('g')
    .call(buildSystemTag);

  if (window.__bookmarkViewerNicknameListener) {
    window.removeEventListener('systemNicknameUpdated', window.__bookmarkViewerNicknameListener);
  }

  const nicknameListener = (event) => {
    if (!event || !event.detail) {
      return;
    }
    const { system, nickname } = event.detail;
    if (!system) {
      return;
    }
    const matchingLabels = labels.filter((d) => d.name === system);
    if (!matchingLabels.empty()) {
      updateNicknameLabel(matchingLabels, nickname || '');
    }
  };

  window.addEventListener('systemNicknameUpdated', nicknameListener);
  window.__bookmarkViewerNicknameListener = nicknameListener;

  if (previousSelection) {
    const preservedNode = findNodeByQuery(previousSelection);
    if (preservedNode) {
      applySystemSelection(preservedNode);
      focusOnSystem(preservedNode);
    }
  }

  function ticked() {
    link
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);

    node
      .attr('cx', (d) => d.x)
      .attr('cy', (d) => d.y);

    labels.attr('transform', (d) => `translate(${d.x},${d.y})`);

    // Update crosshair position if a system is selected
    if (window.__bookmarkViewerSelectedSystem) {
      const selectedNode = nodes.find(n => (n.filterKey || n.name) === window.__bookmarkViewerSelectedSystem);
      if (selectedNode) {
        updateCrosshair(selectedNode, classColors);
      }
    }
  }

  function updateCrosshair(d, classColors) {
    const systemInfo = systems[d.name] || (d.filterKey ? systems[d.filterKey] : null);
    let wormholeClass = null;
    if (d && d.wormholeClass) {
      wormholeClass = d.wormholeClass;
    } else if (systemInfo && systemInfo.wormholeClass) {
      wormholeClass = systemInfo.wormholeClass;
    }
    if (wormholeClass && typeof wormholeClass === 'string') {
      wormholeClass = wormholeClass.toUpperCase();
    }
    let classColor = wormholeClass ? classColors[wormholeClass] : null;
    if (!classColor) {
      const fallbackColor = getStatusColor(systemInfo || d);
      classColor = fallbackColor || '#00ff00';
    }

    const crosshairLines = crosshairLayer.selectAll('.crosshair');
    if (crosshairLines.size() === 2) {
      // Update existing crosshair positions
      const lines = crosshairLines.nodes();
      lines[0].setAttribute('y1', d.y);
      lines[0].setAttribute('y2', d.y);
      lines[1].setAttribute('x1', d.x);
      lines[1].setAttribute('x2', d.x);
      return;
    }

    // Remove any existing and create new
    crosshairLayer.selectAll('.crosshair').remove();

    crosshairLayer.append('line')
      .attr('class', 'crosshair')
      .attr('x1', -100000)
      .attr('y1', d.y)
      .attr('x2', 100000)
      .attr('y2', d.y)
      .attr('stroke', classColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '5,5');

    crosshairLayer.append('line')
      .attr('class', 'crosshair')
      .attr('x1', d.x)
      .attr('y1', -100000)
      .attr('x2', d.x)
      .attr('y2', 100000)
      .attr('stroke', classColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '5,5');
  }

  // Reapply physics mode on interaction
  svg.on('mousedown', () => syncPhysicsSimulation());
  svg.on('touchstart', () => syncPhysicsSimulation());
}

function updateNicknameLabel(labelSelection, nicknameValue) {
  labelSelection.each(function (d) {
    const g = d3.select(this);
    const baseLabel = d._baseLabel || d.name;
    const sanitizedNickname = nicknameValue ? nicknameValue.trim() : '';
    d.nickname = sanitizedNickname;
    const primaryText = sanitizedNickname ? `${baseLabel} (${sanitizedNickname})` : baseLabel;
    const textSelection = g.select('text.label-primary');
    const rectSelection = g.select('rect.label-rect-primary');

    if (textSelection.empty() || rectSelection.empty()) {
      return;
    }

    textSelection.text(primaryText);
    const bbox = textSelection.node().getBBox();
    rectSelection
      .attr('x', bbox.x - 4)
      .attr('y', bbox.y - 2)
      .attr('width', bbox.width + 8)
      .attr('height', bbox.height + 4);
  });
}

function filterBookmarksBySystem(systemName) {
    getDataFromDB().then(data => {
        const filteredData = data.filter(row => row['SOL'] === systemName);
        displayTable(['Label', 'Type', 'Jumps', 'SOL', 'CON', 'REG', 'Date', 'Expiry', 'Creator'], filteredData);
        if (typeof window.setSignatureActiveSystem === 'function') {
            window.setSignatureActiveSystem(systemName);
        }
        if (typeof window.setSystemIntelActiveSystem === 'function') {
            window.setSystemIntelActiveSystem(systemName);
        }
        window.__bookmarkViewerSelectedSystem = systemName || null;
    });
}

window.displayMap = displayMap;
export const statuses = {};
export { filterBookmarksBySystem }; // Export the function for use in dragHandlers.js
window.getMapSelectedSystem = () => window.__bookmarkViewerSelectedSystem || null;
