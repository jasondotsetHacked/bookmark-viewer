import { planRoute } from './modules/map/routePlanner.js';
import { loadSystemsData } from './loadSystemsData.js';

const STORAGE_KEY = 'bookmarkViewerPinnedRoutes';

const moduleRoot = document.querySelector('[data-module-id="routes"]');
if (moduleRoot) {
  initializeRoutesModule().catch((error) => {
    console.error('routesModule: failed to initialize', error);
  });
}

async function initializeRoutesModule() {
  const addInput = moduleRoot.querySelector('#routesAddInput');
  const addButton = moduleRoot.querySelector('#routesAddButton');
  const suggestionsList = moduleRoot.querySelector('#routesSuggestions');
  const messageNode = moduleRoot.querySelector('#routesMessage');
  const listNode = moduleRoot.querySelector('#routesList');
  const emptyNode = moduleRoot.querySelector('#routesEmpty');

  const systemsDataset = await loadSystemsData().catch(() => ({}));
  const systemsByLower = new Map();
  if (systemsDataset && typeof systemsDataset === 'object') {
    Object.keys(systemsDataset).forEach((name) => {
      const entry = systemsDataset[name];
      const canonicalName = entry && entry.name ? entry.name : name;
      systemsByLower.set(canonicalName.toLowerCase(), {
        ...entry,
        name: canonicalName
      });
    });
  }

  // Fuzzy search functions
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

  // Suggestion management functions
  function clearSuggestions() {
    highlightedSuggestionIndex = -1;
    suggestionEntries = [];
    if (suggestionsList) {
      suggestionsList.innerHTML = '';
    }
  }

  function hideSuggestions() {
    if (!suggestionsList) {
      return;
    }
    suggestionsList.hidden = true;
  }

  function showSuggestions() {
    if (!suggestionsList || !suggestionEntries.length) {
      return;
    }
    suggestionsList.hidden = false;
  }

  function highlightSuggestion(index) {
    if (!suggestionsList) {
      return;
    }
    const items = suggestionsList.querySelectorAll('.routes-suggestion');
    items.forEach((item) => item.classList.remove('is-active'));
    highlightedSuggestionIndex = index;
    if (index >= 0 && index < items.length) {
      const activeItem = items[index];
      activeItem.classList.add('is-active');
      activeItem.scrollIntoView({ block: 'nearest' });
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
    if (!suggestion || !addInput) {
      return;
    }
    addInput.value = suggestion.name;
    hideSuggestions();
    clearSuggestions();
    addInput.focus();
  }

  function renderSuggestionList(results, query) {
    if (!suggestionsList) {
      return;
    }
    suggestionsList.innerHTML = '';
    highlightedSuggestionIndex = -1;
    suggestionEntries = results;

    if (!results.length) {
      hideSuggestions();
      return;
    }

    const fragment = document.createDocumentFragment();
    results.forEach((result, index) => {
      const item = document.createElement('li');
      item.className = 'routes-suggestion';
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
    suggestionsList.appendChild(fragment);
    showSuggestions();
  }

  function buildSuggestionMarkup(result, query) {
    const primary = highlightMatch(result.displayLabel, query);
    return `<span class="routes-suggestion-label">${primary}</span>`;
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
    return `${before}<span class="routes-suggestion-highlight">${match}</span>${after}`;
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

  function updateSuggestionResults(rawQuery) {
    if (!addInput) {
      return;
    }
    const query = rawQuery.trim();
    if (!query) {
      clearSuggestions();
      hideSuggestions();
      return;
    }
    if (!systemsByLower.size) {
      clearSuggestions();
      hideSuggestions();
      return;
    }
    const results = runFuzzySearch(query, MAX_SUGGESTION_RESULTS);
    renderSuggestionList(results, query);
  }

  function runFuzzySearch(rawQuery, limit = MAX_SUGGESTION_RESULTS) {
    const query = rawQuery.trim().toLowerCase();
    if (!query) {
      return [];
    }
    const results = [];
    for (const [key, entry] of systemsByLower) {
      const score = computeFuzzyScore(key, query);
      if (score >= 5) { // Minimum score to consider a match
        results.push({
          name: entry.name,
          displayLabel: entry.name,
          score: score
        });
      }
    }

    results.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.name.localeCompare(b.name);
    });

    if (limit > 0) {
      return results.slice(0, limit);
    }
    return results;
  }

  let pinnedSystems = loadPinned();
  pinnedSystems.sort((a, b) => a.localeCompare(b));
  const distanceLabels = new Map();
  let currentOrigin = window.__bookmarkViewerSelectedSystem || null;
  let distanceToken = 0;

  // Suggestions state
  const MAX_SUGGESTION_RESULTS = 8;
  let suggestionEntries = [];
  let highlightedSuggestionIndex = -1;

  renderPinnedList();
  refreshEmptyState();
  if (currentOrigin) {
    recalculateDistances(currentOrigin);
  } else {
    setAllDistanceDisplays('idle', 'Select origin');
  }

  addButton?.addEventListener('click', () => handleAdd());
  addInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (highlightedSuggestionIndex >= 0) {
        applySuggestion(highlightedSuggestionIndex);
      } else {
        handleAdd();
      }
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSuggestionHighlight(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSuggestionHighlight(-1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (highlightedSuggestionIndex >= 0) {
        clearSuggestions();
        hideSuggestions();
      } else {
        addInput.blur();
      }
    }
  });

  addInput?.addEventListener('input', (event) => {
    updateSuggestionResults(event.target.value || '');
  });

  addInput?.addEventListener('focus', () => {
    if (suggestionEntries.length) {
      showSuggestions();
    }
  });

  addInput?.addEventListener('blur', (event) => {
    // Delay hiding to allow clicks on suggestions
    setTimeout(() => {
      hideSuggestions();
    }, 150);
  });

  suggestionsList?.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });

  suggestionsList?.addEventListener('click', (event) => {
    const item = event.target.closest('.routes-suggestion');
    if (!item) {
      return;
    }
    const index = parseInt(item.getAttribute('data-index'), 10);
    if (!isNaN(index)) {
      applySuggestion(index);
    }
  });

  window.addEventListener('mapSelectedSystemChanged', (event) => {
    currentOrigin = event.detail || null;
    if (!pinnedSystems.length) {
      setRoutesMessage('Add systems to track their distance from your current origin.');
      setAllDistanceDisplays('idle', '--');
      return;
    }
    if (!currentOrigin) {
      setRoutesMessage('Select an origin system on the map to calculate distances.', 'info');
      setAllDistanceDisplays('idle', 'Select origin');
      return;
    }
    recalculateDistances(currentOrigin);
  });

  function loadPinned() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      const seen = new Set();
      return parsed
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => {
          if (!value) {
            return false;
          }
          const lower = value.toLowerCase();
          if (seen.has(lower)) {
            return false;
          }
          seen.add(lower);
          return true;
        });
    } catch (error) {
      console.warn('routesModule: failed to load pinned routes', error);
      return [];
    }
  }

  function savePinned() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pinnedSystems));
    } catch (error) {
      console.warn('routesModule: failed to save pinned routes', error);
    }
  }

  function resolveSystemName(inputValue) {
    if (!inputValue) {
      return null;
    }
    const trimmed = inputValue.toString().trim();
    if (!trimmed) {
      return null;
    }
    const lowerTrimmed = trimmed.toLowerCase();

    // First try exact match
    const exactLookup = systemsByLower.get(lowerTrimmed);
    if (exactLookup) {
      return {
        name: exactLookup.name,
        isKnown: true
      };
    }

    // If no exact match, try fuzzy search
    const query = lowerTrimmed;
    let bestMatch = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    const minFuzzyScore = 5; // Minimum score to consider a match

    for (const [key, entry] of systemsByLower) {
      const score = computeFuzzyScore(key, query);
      if (score > bestScore && score >= minFuzzyScore) {
        bestScore = score;
        bestMatch = entry;
      }
    }

    if (bestMatch) {
      return {
        name: bestMatch.name,
        isKnown: true
      };
    }

    // No match found
    return {
      name: trimmed,
      isKnown: false
    };
  }

  function handleAdd() {
    if (!addInput) {
      return;
    }
    const resolved = resolveSystemName(addInput.value);
    if (!resolved) {
      setRoutesMessage('Enter a system name to pin.', 'error');
      return;
    }
    const { name } = resolved;
    if (pinnedSystems.some((entry) => entry.toLowerCase() === name.toLowerCase())) {
      setRoutesMessage(`${name} is already pinned.`, 'error');
      addInput.value = '';
      clearSuggestions();
      hideSuggestions();
      return;
    }
    pinnedSystems.push(name);
    pinnedSystems.sort((a, b) => a.localeCompare(b));
    savePinned();
    addInput.value = '';
    clearSuggestions();
    hideSuggestions();
    setRoutesMessage(`Pinned ${name}.`, 'info');
    renderPinnedList();
    refreshEmptyState();
    if (currentOrigin) {
      recalculateDistances(currentOrigin);
    } else {
      setDistanceDisplay(name, 'idle', 'Select origin');
    }
  }

  function handleRemove(name) {
    pinnedSystems = pinnedSystems.filter((entry) => entry.toLowerCase() !== name.toLowerCase());
    savePinned();
    renderPinnedList();
    refreshEmptyState();
    if (currentOrigin) {
      recalculateDistances(currentOrigin);
    } else {
      setAllDistanceDisplays('idle', 'Select origin');
    }
  }

  function renderPinnedList() {
    if (!listNode) {
      return;
    }
    listNode.innerHTML = '';
    distanceLabels.clear();
    pinnedSystems.forEach((systemName) => {
      const item = document.createElement('li');
      item.className = 'routes-item';
      item.dataset.system = systemName;

      const mainButton = document.createElement('button');
      mainButton.type = 'button';
      mainButton.className = 'routes-item-main';
      mainButton.setAttribute('data-system-name', systemName);
      mainButton.addEventListener('click', (event) => {
        event.stopPropagation();
        if (typeof window.__bookmarkViewerRequestRoute === 'function') {
          window.__bookmarkViewerRequestRoute(systemName, {
            showPanel: true
          });
        }
      });

      const nameSpan = document.createElement('span');
      nameSpan.className = 'routes-item-name';
      nameSpan.textContent = systemName;

      const distanceSpan = document.createElement('span');
      distanceSpan.className = 'routes-item-distance';
      distanceSpan.dataset.state = 'idle';
      distanceSpan.textContent = '--';
      distanceLabels.set(systemName, distanceSpan);

      mainButton.append(nameSpan, distanceSpan);

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'routes-item-remove';
      removeButton.setAttribute('aria-label', `Remove ${systemName} from pinned routes`);
      removeButton.innerHTML = '&times;';
      removeButton.addEventListener('click', (event) => {
        event.stopPropagation();
        handleRemove(systemName);
      });

      item.append(mainButton, removeButton);
      listNode.appendChild(item);
    });
  }

  function refreshEmptyState() {
    if (!emptyNode) {
      return;
    }
    const hasPinned = pinnedSystems.length > 0;
    emptyNode.hidden = hasPinned;
    listNode?.classList.toggle('is-empty', !hasPinned);
    if (!hasPinned) {
      setRoutesMessage('No pinned routes yet. Add a system to get started.');
    } else if (!currentOrigin) {
      setRoutesMessage('Select a system on the map to calculate distances.', 'info');
    } else {
      setRoutesMessage('');
    }
  }

  function setRoutesMessage(text, tone = 'info') {
    if (!messageNode) {
      return;
    }
    messageNode.textContent = text || '';
    messageNode.classList.toggle('routes-message-error', tone === 'error');
  }

  function setDistanceDisplay(systemName, state, text) {
    const label = distanceLabels.get(systemName);
    if (!label) {
      return;
    }
    label.dataset.state = state;
    if (typeof text === 'string') {
      label.textContent = text;
    } else if (state === 'loading') {
      label.textContent = '';
    }
  }

  function setAllDistanceDisplays(state, text) {
    pinnedSystems.forEach((name) => setDistanceDisplay(name, state, text));
  }

  function formatJumpCount(value) {
    const numeric = Number.isFinite(value) ? value : 0;
    if (numeric === 0) {
      return 'In system';
    }
    if (numeric === 1) {
      return '1 jump';
    }
    return `${numeric} jumps`;
  }

  function recalculateDistances(origin) {
    if (!pinnedSystems.length) {
      return;
    }
    if (!origin) {
      setAllDistanceDisplays('idle', 'Select origin');
      return;
    }
    const token = ++distanceToken;
    let encounteredError = false;
    setRoutesMessage('Calculating distances...', 'info');
    setAllDistanceDisplays('loading', '');
    const computations = pinnedSystems.map(async (destinationName) => {
      try {
        const plan = await planRoute({
          origin,
          destination: destinationName
        });
        if (distanceToken !== token) {
          return;
        }
        if (plan && plan.status === 'ok') {
          const total = plan.totalJumps && typeof plan.totalJumps.total === 'number'
            ? plan.totalJumps.total
            : 0;
          setDistanceDisplay(destinationName, 'ready', formatJumpCount(total));
        } else if (plan && plan.message) {
          encounteredError = true;
          setDistanceDisplay(destinationName, 'error', 'No route');
        } else {
          encounteredError = true;
          setDistanceDisplay(destinationName, 'error', 'Error');
        }
      } catch (error) {
        if (distanceToken !== token) {
          return;
        }
        encounteredError = true;
        console.warn(`routesModule: failed to compute route to ${destinationName}`, error);
        setDistanceDisplay(destinationName, 'error', 'Error');
      }
    });
    Promise.allSettled(computations).then(() => {
      if (distanceToken === token) {
        if (encounteredError) {
          setRoutesMessage('Some routes could not be calculated.', 'error');
        } else {
          setRoutesMessage('');
        }
      }
    });
  }
}



