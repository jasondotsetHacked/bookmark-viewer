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

  let pinnedSystems = loadPinned();
  pinnedSystems.sort((a, b) => a.localeCompare(b));
  const distanceLabels = new Map();
  let currentOrigin = window.__bookmarkViewerSelectedSystem || null;
  let distanceToken = 0;

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
      handleAdd();
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
    const lookup = systemsByLower.get(trimmed.toLowerCase());
    if (lookup) {
      return {
        name: lookup.name,
        isKnown: true
      };
    }
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
      return;
    }
    pinnedSystems.push(name);
    pinnedSystems.sort((a, b) => a.localeCompare(b));
    savePinned();
    addInput.value = '';
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



