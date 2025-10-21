import { loadSystemsData } from '../../loadSystemsData.js';

const ESI_ROUTE_BASE_URL = 'https://esi.evetech.net/route';
const COMPATIBILITY_DATE = '2025-09-30';
const DEFAULT_PREFERENCE = 'Shorter';
const VALID_PREFERENCES = new Set(['Shorter', 'Safer', 'LessSecure']);

const state = {
  systemsIndexPromise: null,
  systemsByName: new Map(),
  systemsByLower: new Map(),
  systemsById: new Map(),
  mapNodes: new Map(),
  mapNodesByLower: new Map(),
  graph: new Map()
};

function normalizeName(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return value.toString().trim().toLowerCase();
}

function sanitizePreference(value) {
  if (VALID_PREFERENCES.has(value)) {
    return value;
  }
  return DEFAULT_PREFERENCE;
}

async function ensureSystemsIndex() {
  if (!state.systemsIndexPromise) {
    state.systemsIndexPromise = loadSystemsData()
      .then((raw) => {
        const dataset = raw && typeof raw === 'object' ? raw : {};
        const byName = new Map();
        const byLower = new Map();
        const byId = new Map();

        Object.keys(dataset).forEach((key) => {
          const entry = dataset[key];
          if (!entry) {
            return;
          }
          const canonicalName = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : key;
          const hydrated = { ...entry, name: canonicalName };
          byName.set(canonicalName, hydrated);
          byLower.set(canonicalName.toLowerCase(), hydrated);
          if (typeof hydrated.id === 'number') {
            byId.set(hydrated.id, hydrated);
          }
        });

        state.systemsByName = byName;
        state.systemsByLower = byLower;
        state.systemsById = byId;
        return state;
      })
      .catch((error) => {
        console.error('routePlanner: failed to load systems data', error);
        state.systemsByName = new Map();
        state.systemsByLower = new Map();
        state.systemsById = new Map();
        return state;
      });
  }

  await state.systemsIndexPromise;
  return state;
}

export function warmRoutePlanner() {
  return ensureSystemsIndex();
}

export function updateRouteGraph({ nodes = [], links = [], systemRecords = {} } = {}) {
  const mapNodes = new Map();
  const mapNodesByLower = new Map();
  const graph = new Map();

  nodes.forEach((node) => {
    if (!node || !node.name) {
      return;
    }
    const canonicalName = node.name;
    const normalized = canonicalName.toLowerCase();
    const systemRecord = systemRecords[canonicalName] || null;
    const entry = {
      name: canonicalName,
      filterKey: node.filterKey || null,
      originSystem: node.originSystem || null,
      displayName: node.displayName || canonicalName,
      isPlaceholder: Boolean(node.isPlaceholder),
      wormholeClass: ((node.wormholeClass || systemRecord?.wormholeClass || '') || '')
        .toString()
        .trim()
        .toUpperCase() || null
    };

    mapNodes.set(canonicalName, entry);
    mapNodesByLower.set(normalized, canonicalName);

    if (entry.filterKey) {
      const filterLower = entry.filterKey.toLowerCase();
      if (!mapNodesByLower.has(filterLower)) {
        mapNodesByLower.set(filterLower, canonicalName);
      }
    }

    if (entry.originSystem) {
      const originLower = entry.originSystem.toLowerCase();
      if (!mapNodesByLower.has(originLower)) {
        mapNodesByLower.set(originLower, canonicalName);
      }
    }

    graph.set(canonicalName, new Set());
  });

  links.forEach((link) => {
    if (!link) {
      return;
    }
    const sourceName = typeof link.source === 'string' ? link.source : link.source?.name;
    const targetName = typeof link.target === 'string' ? link.target : link.target?.name;
    if (!sourceName || !targetName) {
      return;
    }

    if (!graph.has(sourceName)) {
      graph.set(sourceName, new Set());
    }
    if (!graph.has(targetName)) {
      graph.set(targetName, new Set());
    }

    graph.get(sourceName).add(targetName);
    graph.get(targetName).add(sourceName);
  });

  state.mapNodes = mapNodes;
  state.mapNodesByLower = mapNodesByLower;
  state.graph = graph;
}

function resolveOriginName(rawName) {
  const normalized = normalizeName(rawName);
  if (!normalized) {
    return null;
  }
  return state.mapNodesByLower.get(normalized) || null;
}

async function resolveDestinationName(rawName) {
  const normalized = normalizeName(rawName);
  if (!normalized) {
    return null;
  }
  if (state.mapNodesByLower.has(normalized)) {
    return state.mapNodesByLower.get(normalized);
  }
  await ensureSystemsIndex();
  if (state.systemsByLower.has(normalized)) {
    return state.systemsByLower.get(normalized).name;
  }
  return null;
}

function getMapNode(name) {
  return state.mapNodes.get(name) || null;
}

function classifySystem(name) {
  if (!name) {
    return 'unknown';
  }
  const mapNode = state.mapNodes.get(name);
  if (mapNode && mapNode.isPlaceholder) {
    return 'placeholder';
  }
  if (mapNode && mapNode.wormholeClass) {
    return 'wormhole';
  }

  const systemEntry = state.systemsByName.get(name);
  if (!systemEntry) {
    return 'unknown';
  }
  if (typeof systemEntry.wormholeClass === 'string' && systemEntry.wormholeClass.trim()) {
    return 'wormhole';
  }
  if (typeof systemEntry.id === 'number' && systemEntry.id >= 31000000) {
    return 'wormhole';
  }
  return 'kspace';
}

function reconstructPath(destination, parents) {
  const path = [];
  let current = destination || null;
  while (current) {
    path.unshift(current);
    current = parents.get(current) || null;
  }
  return path;
}

function findShortestPath(origin, destination) {
  if (origin === destination) {
    return [origin];
  }

  const graph = state.graph;
  if (!graph.has(origin) || !graph.has(destination)) {
    return null;
  }

  const queue = [origin];
  const parents = new Map([[origin, null]]);

  while (queue.length > 0) {
    const current = queue.shift();
    const neighbors = graph.get(current);
    if (!neighbors) {
      continue;
    }
    for (const neighbor of neighbors) {
      if (parents.has(neighbor)) {
        continue;
      }
      parents.set(neighbor, current);
      if (neighbor === destination) {
        return reconstructPath(destination, parents);
      }
      queue.push(neighbor);
    }
  }

  return null;
}

function findExitPaths(origin, limit = 10) {
  const graph = state.graph;
  const exits = [];

  if (!graph.has(origin)) {
    return exits;
  }

  const queue = [origin];
  const parents = new Map([[origin, null]]);

  while (queue.length > 0 && exits.length < limit) {
    const current = queue.shift();
    const neighbors = graph.get(current);
    if (!neighbors) {
      continue;
    }

    for (const neighbor of neighbors) {
      if (parents.has(neighbor)) {
        continue;
      }
      parents.set(neighbor, current);
      queue.push(neighbor);

      const classification = classifySystem(neighbor);
      if (classification === 'kspace') {
        const path = reconstructPath(neighbor, parents);
        exits.push({ exit: neighbor, path });
        if (exits.length >= limit) {
          break;
        }
      }
    }
  }

  return exits;
}

async function fetchEsiRoute(originId, destinationId, preference) {
  const routePreference = sanitizePreference(preference);
  const url = `${ESI_ROUTE_BASE_URL}/${originId}/${destinationId}`;
  const payload = {};
  if (routePreference && routePreference !== DEFAULT_PREFERENCE) {
    payload.preference = routePreference;
  }
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Compatibility-Date': COMPATIBILITY_DATE,
    'Accept-Language': 'en'
  };

  const requestOptions = {
    method: 'POST',
    headers,
    cache: 'no-store'
  };

  if (Object.keys(payload).length > 0) {
    requestOptions.body = JSON.stringify(payload);
  } else {
    requestOptions.body = JSON.stringify({});
  }

  const response = await fetch(url, requestOptions);

  if (!response.ok) {
    const fallback = await response.text().catch(() => '');
    throw new Error(`ESI route request failed: ${response.status} ${response.statusText} ${fallback}`);
  }

  const data = await response.json();
  if (Array.isArray(data)) {
    return data;
  }
  if (data && Array.isArray(data.route)) {
    return data.route;
  }

  throw new Error('ESI route response was not an array');
}

export async function planRoute({ origin, destination, preference } = {}) {
  if (!origin) {
    return {
      status: 'error',
      reason: 'origin_missing',
      message: 'Select an origin system on the map before planning a route.'
    };
  }

  if (!destination || !destination.toString().trim()) {
    return {
      status: 'error',
      reason: 'destination_missing',
      message: 'Enter a destination system to plan a route.'
    };
  }

  const routePreference = sanitizePreference(preference);
  await ensureSystemsIndex();

  const originName = resolveOriginName(origin);
  if (!originName) {
    return {
      status: 'error',
      reason: 'origin_not_on_map',
      message: 'The selected origin system is no longer part of the current map.'
    };
  }

  const destinationName = await resolveDestinationName(destination);
  if (!destinationName) {
    return {
      status: 'error',
      reason: 'destination_not_found',
      message: `Could not find "${destination}" in the known systems list.`
    };
  }

  const originNode = getMapNode(originName);
  const destinationNode = getMapNode(destinationName);
  const destinationOnMap = Boolean(destinationNode);

  if (originName === destinationName) {
    return {
      status: 'ok',
      mode: 'trivial',
      origin: originName,
      destination: destinationName,
      preference: routePreference,
      jSpacePath: [originName],
      kSpace: null,
      totalJumps: {
        wormhole: 0,
        kspace: 0,
        total: 0
      },
      message: 'Origin and destination are the same system.'
    };
  }

  if (destinationOnMap) {
    const mapPath = findShortestPath(originName, destinationName);
    if (Array.isArray(mapPath) && mapPath.length > 0) {
      return {
        status: 'ok',
        mode: 'map',
        origin: originName,
        destination: destinationName,
        preference: routePreference,
        jSpacePath: mapPath,
        kSpace: null,
        totalJumps: {
          wormhole: Math.max(0, mapPath.length - 1),
          kspace: 0,
          total: Math.max(0, mapPath.length - 1)
        },
        message: `Found a mapped route to ${destinationName}.`
      };
    }
  }

  const destinationClassification = classifySystem(destinationName);
  const originClassification = classifySystem(originName);

  if (destinationClassification === 'wormhole' && !destinationOnMap) {
    return {
      status: 'error',
      reason: 'destination_unmapped',
      message: `${destinationName} is a wormhole system that is not on your map yet.`
    };
  }

  if (originClassification === 'kspace' && destinationClassification === 'kspace') {
    const originInfo = state.systemsByName.get(originName);
    const destinationInfo = state.systemsByName.get(destinationName);
    if (!originInfo || !destinationInfo) {
      return {
        status: 'error',
        reason: 'kspace_lookup_failed',
        message: 'Unable to locate K-space system IDs for the selected route.'
      };
    }
    try {
      const esiRoute = await fetchEsiRoute(originInfo.id, destinationInfo.id, routePreference);
      const jumpCount = Math.max(0, esiRoute.length - 1);
      const kspaceSystems = esiRoute.map((id) => state.systemsById.get(id)?.name || id.toString());
      return {
        status: 'ok',
        mode: 'kspace',
        origin: originName,
        destination: destinationName,
        preference: routePreference,
        jSpacePath: [originName],
        kSpace: {
          systems: kspaceSystems,
          ids: esiRoute,
          jumpCount
        },
        totalJumps: {
          wormhole: 0,
          kspace: jumpCount,
          total: jumpCount
        },
        message: `Plotted a ${jumpCount}-jump K-space route to ${destinationName}.`
      };
    } catch (error) {
      console.error('routePlanner: ESI route failed for K-space origin', error);
      return {
        status: 'error',
        reason: 'esi_route_failed',
        message: 'ESI could not provide a stargate route between the selected systems.',
        details: error.message
      };
    }
  }

  if (originClassification !== 'wormhole') {
    return {
      status: 'error',
      reason: 'origin_not_wormhole',
      message: 'Hybrid routing requires the origin to be a wormhole mapped on your grid.'
    };
  }

  const exitCandidates = findExitPaths(originName, 10);
  if (!exitCandidates.length) {
    return {
      status: 'error',
      reason: 'no_exit_found',
      message: 'No mapped exits to K-space were found from the selected origin.'
    };
  }

  const destinationInfo = state.systemsByName.get(destinationName);
  if (!destinationInfo || typeof destinationInfo.id !== 'number') {
    return {
      status: 'error',
      reason: 'destination_id_missing',
      message: `Unable to look up the system ID for ${destinationName}.`
    };
  }

  let bestPlan = null;

  for (const candidate of exitCandidates) {
    const exitName = candidate.exit;
    const exitInfo = state.systemsByName.get(exitName);
    if (!exitInfo || typeof exitInfo.id !== 'number') {
      continue;
    }
    try {
      const esiRoute = await fetchEsiRoute(exitInfo.id, destinationInfo.id, routePreference);
      const wormholeHops = Math.max(0, candidate.path.length - 1);
      const kspaceJumps = Math.max(0, esiRoute.length - 1);
      const kspaceSystems = esiRoute.map((id) => state.systemsById.get(id)?.name || id.toString());
      const total = wormholeHops + kspaceJumps;

      const planCandidate = {
        status: 'ok',
        mode: 'hybrid',
        origin: originName,
        destination: destinationName,
        preference: routePreference,
        jSpacePath: candidate.path,
        exitSystem: exitName,
        kSpace: {
          systems: kspaceSystems,
          ids: esiRoute,
          jumpCount: kspaceJumps
        },
        totalJumps: {
          wormhole: wormholeHops,
          kspace: kspaceJumps,
          total
        },
        message: `Hybrid route via ${exitName} with ${wormholeHops} wormhole jumps and ${kspaceJumps} K-space jumps.`
      };

      if (!bestPlan) {
        bestPlan = planCandidate;
      } else if (planCandidate.totalJumps.total < bestPlan.totalJumps.total) {
        bestPlan = planCandidate;
      } else if (planCandidate.totalJumps.total === bestPlan.totalJumps.total &&
        planCandidate.totalJumps.wormhole < bestPlan.totalJumps.wormhole) {
        bestPlan = planCandidate;
      }
    } catch (error) {
      console.warn(`routePlanner: ESI route failed for exit ${exitName}`, error);
    }
  }

  if (bestPlan) {
    return bestPlan;
  }

  return {
    status: 'error',
    reason: 'esi_route_failed',
    message: 'No valid hybrid route could be computed via ESI. Try again later or pick another destination.'
  };
}

export async function getRouteSuggestions(query, limit = 10) {
  const normalized = normalizeName(query);
  if (!normalized || normalized.length < 2) {
    return [];
  }

  await ensureSystemsIndex();

  const seen = new Set();
  const matches = [];

  const pushMatch = (name, meta) => {
    if (!name || seen.has(name)) {
      return;
    }
    seen.add(name);
    const systemsEntry = state.systemsByName.get(name) || null;
    const mapEntry = state.mapNodes.get(name) || null;
    matches.push({
      name,
      isOnMap: Boolean(mapEntry),
      wormholeClass: mapEntry?.wormholeClass || systemsEntry?.wormholeClass || null,
      securityStatus: systemsEntry?.security_status ?? null,
      id: systemsEntry?.id ?? null,
      matchIndex: meta?.matchIndex ?? name.toLowerCase().indexOf(normalized),
      typeScore: meta?.typeScore ?? 0
    });
  };

  state.mapNodes.forEach((node, name) => {
    const lower = name.toLowerCase();
    const index = lower.indexOf(normalized);
    if (index !== -1) {
      pushMatch(name, { typeScore: 0, matchIndex: index });
    }
  });

  if (matches.length < limit) {
    state.systemsByName.forEach((entry, name) => {
      if (state.mapNodes.has(name)) {
        return;
      }
      const lower = name.toLowerCase();
      const index = lower.indexOf(normalized);
      if (index !== -1) {
        pushMatch(name, { typeScore: 1, matchIndex: index });
      }
    });
  }

  matches.sort((a, b) => {
    if (a.matchIndex !== b.matchIndex) {
      return a.matchIndex - b.matchIndex;
    }
    if (a.typeScore !== b.typeScore) {
      return a.typeScore - b.typeScore;
    }
    return a.name.localeCompare(b.name);
  });

  return matches.slice(0, limit).map((match) => ({
    name: match.name,
    isOnMap: match.isOnMap,
    wormholeClass: match.wormholeClass,
    securityStatus: match.securityStatus,
    id: match.id
  }));
}
