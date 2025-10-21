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
  graph: new Map(),
  edgeMetadata: new Map()
};

const MAX_KSPACE_CANDIDATES = 12;

const esiRouteCache = new Map();

const SIGNATURE_TOKEN_REGEX = /^[A-Z0-9]{3}$/;

function normalizeSignatureToken(value) {
  if (!value && value !== 0) {
    return null;
  }
  const normalized = value.toString().trim().toUpperCase();
  if (!SIGNATURE_TOKEN_REGEX.test(normalized)) {
    return null;
  }
  return normalized;
}

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
  const edgeMetadata = new Map();

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

    const directionList = Array.isArray(link.directions) ? link.directions : [];
    directionList.forEach((direction) => {
      if (!direction) {
        return;
      }
      const dirSource = typeof direction.source === 'string' ? direction.source : direction.source?.name;
      const dirTarget = typeof direction.target === 'string' ? direction.target : direction.target?.name;
      if (!dirSource || !dirTarget) {
        return;
      }
      const key = `${dirSource}|${dirTarget}`;
      const existing = edgeMetadata.get(key) || {
        source: dirSource,
        target: dirTarget,
        sourceSignature: null,
        targetSignature: null,
        rawLabel: null
      };
      const candidateSource = normalizeSignatureToken(direction.sourceSignature);
      const candidateTarget = normalizeSignatureToken(direction.targetSignature);
      if (!existing.sourceSignature && candidateSource) {
        existing.sourceSignature = candidateSource;
      }
      if (!existing.targetSignature && candidateTarget) {
        existing.targetSignature = candidateTarget;
      }
      if (!existing.rawLabel && typeof direction.rawLabel === 'string' && direction.rawLabel.trim()) {
        existing.rawLabel = direction.rawLabel;
      }
      edgeMetadata.set(key, existing);
    });
  });

  state.mapNodes = mapNodes;
  state.mapNodesByLower = mapNodesByLower;
  state.graph = graph;
  state.edgeMetadata = edgeMetadata;
}

function resolveSystemName(rawName) {
  const normalized = normalizeName(rawName);
  if (!normalized) {
    return null;
  }
  if (state.mapNodesByLower.has(normalized)) {
    return state.mapNodesByLower.get(normalized);
  }
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

function getDirectionMetadata(source, target) {
  if (!source || !target) {
    return null;
  }
  const forwardKey = `${source}|${target}`;
  return state.edgeMetadata.get(forwardKey) || null;
}

function buildWormholeSegments(path) {
  if (!Array.isArray(path) || path.length < 2) {
    return [];
  }
  const segments = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    const from = path[index];
    const to = path[index + 1];
    const forward = getDirectionMetadata(from, to);
    const reverse = getDirectionMetadata(to, from);
    const sourceSignature = normalizeSignatureToken(
      forward?.sourceSignature ||
      reverse?.targetSignature ||
      forward?.targetSignature ||
      null
    );
    const targetSignature = normalizeSignatureToken(
      reverse?.sourceSignature ||
      forward?.targetSignature ||
      reverse?.targetSignature ||
      null
    );
    segments.push({
      from,
      to,
      sourceSignature,
      targetSignature,
      rawLabel: forward?.rawLabel || reverse?.rawLabel || null,
      reverseRawLabel: reverse?.rawLabel || null
    });
  }
  return segments;
}

function findPathsToClassification(start, classification, limit = 10, options = {}) {
  const results = [];
  if (!start || !classification) {
    return results;
  }

  const includeStart = options.includeStart === true;
  const graph = state.graph;

  if (!graph.has(start)) {
    if (includeStart && classifySystem(start) === classification) {
      results.push({ node: start, path: [start] });
    }
    return results;
  }

  const queue = [start];
  const parents = new Map([[start, null]]);
  const seen = new Set([start]);

  if (includeStart && classifySystem(start) === classification) {
    results.push({ node: start, path: [start] });
  }

  while (queue.length > 0 && results.length < limit) {
    const current = queue.shift();
    const neighbors = graph.get(current);
    if (!neighbors) {
      continue;
    }

    for (const neighbor of neighbors) {
      if (seen.has(neighbor)) {
        continue;
      }
      seen.add(neighbor);
      parents.set(neighbor, current);

      if (classifySystem(neighbor) === classification) {
        const path = reconstructPath(neighbor, parents);
        results.push({ node: neighbor, path });
        if (results.length >= limit) {
          break;
        }
      }

      queue.push(neighbor);
    }
  }

  return results;
}

function mapRouteIdsToNames(routeIds) {
  if (!Array.isArray(routeIds)) {
    return [];
  }
  return routeIds.map((id) => state.systemsById.get(id)?.name || id.toString());
}

async function getCachedEsiRoute(originId, destinationId, preference) {
  if (typeof originId !== 'number' || typeof destinationId !== 'number') {
    throw new Error('ESI route lookup requires numeric system IDs.');
  }
  const sanitized = sanitizePreference(preference);
  const key = `${originId}|${destinationId}|${sanitized}`;
  if (esiRouteCache.has(key)) {
    return esiRouteCache.get(key);
  }
  const route = await fetchEsiRoute(originId, destinationId, sanitized);
  esiRouteCache.set(key, route);
  return route;
}

function aggregateKSpaceSegments(segments) {
  if (!Array.isArray(segments) || !segments.length) {
    return null;
  }

  const systems = [];
  const ids = [];
  let jumpCount = 0;

  segments.forEach((segment) => {
    if (!segment) {
      return;
    }
    const routeSystems = Array.isArray(segment.systems) ? segment.systems : [];
    routeSystems.forEach((system) => {
      const cleaned = typeof system === 'string' ? system : (system?.toString?.() || '');
      if (!cleaned) {
        return;
      }
      if (!systems.length || systems[systems.length - 1] !== cleaned) {
        systems.push(cleaned);
      }
    });

    const routeIds = Array.isArray(segment.ids) ? segment.ids : [];
    routeIds.forEach((value) => {
      if (!ids.length || ids[ids.length - 1] !== value) {
        ids.push(value);
      }
    });

    if (Number.isFinite(segment.jumpCount)) {
      jumpCount += segment.jumpCount;
    }
  });

  return {
    systems,
    ids,
    jumpCount,
    segments: segments.map((segment) => ({ ...segment }))
  };
}

function combinePathSegments(segments) {
  const combined = [];
  segments.forEach((segment) => {
    if (!Array.isArray(segment) || !segment.length) {
      return;
    }
    segment.forEach((entry, index) => {
      const value = typeof entry === 'string' ? entry : (entry?.toString?.() || '');
      if (!value) {
        return;
      }
      if (!combined.length) {
        combined.push(value);
        return;
      }
      if (combined[combined.length - 1] === value && index === 0) {
        return;
      }
      if (combined[combined.length - 1] !== value) {
        combined.push(value);
      }
    });
  });
  return combined;
}

function reverseWormholeSegments(segments) {
  if (!Array.isArray(segments) || !segments.length) {
    return [];
  }
  return segments.slice().reverse().map((segment) => ({
    from: segment.to,
    to: segment.from,
    sourceSignature: segment.targetSignature || null,
    targetSignature: segment.sourceSignature || null,
    rawLabel: segment.reverseRawLabel || segment.rawLabel || null,
    reverseRawLabel: segment.rawLabel || null
  }));
}

function aggregateSingleKSpaceRoute(routeIds) {
  if (!Array.isArray(routeIds) || !routeIds.length) {
    return null;
  }
  const jumpCount = Math.max(0, routeIds.length - 1);
  const segment = {
    systems: mapRouteIdsToNames(routeIds),
    ids: routeIds,
    jumpCount
  };
  return aggregateKSpaceSegments([segment]) || {
    systems: segment.systems,
    ids: segment.ids,
    jumpCount: segment.jumpCount,
    segments: [segment]
  };
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
  if (!origin || !origin.toString().trim()) {
    return {
      status: 'error',
      reason: 'origin_missing',
      message: 'Enter an origin system to plan a route.'
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

  const originName = resolveSystemName(origin);
  if (!originName) {
    return {
      status: 'error',
      reason: 'origin_not_found',
      message: `Could not find "${origin}" in the known systems list.`
    };
  }

  const destinationName = resolveSystemName(destination) || null;
  if (!destinationName) {
    return {
      status: 'error',
      reason: 'destination_not_found',
      message: `Could not find "${destination}" in the known systems list.`
    };
  }

  const originNode = getMapNode(originName);
  const destinationNode = getMapNode(destinationName);
  const originOnMap = Boolean(originNode);
  const destinationOnMap = Boolean(destinationNode);

  const originClassification = classifySystem(originName);
  const destinationClassification = classifySystem(destinationName);

  if (originName === destinationName) {
    return {
      status: 'ok',
      mode: 'trivial',
      origin: originName,
      destination: destinationName,
      preference: routePreference,
      originType: originClassification,
      destinationType: destinationClassification,
      jSpacePath: [originName],
      wormholeSegments: [],
      kSpace: null,
      bridge: null,
      totalJumps: {
        wormhole: 0,
        kspace: 0,
        total: 0
      },
      message: 'Origin and destination are the same system.'
    };
  }

  const onMapRoute = originOnMap && destinationOnMap ? findShortestPath(originName, destinationName) : null;
  if (Array.isArray(onMapRoute) && onMapRoute.length > 0) {
    const wormholeSegments = buildWormholeSegments(onMapRoute);
    const wormholeJumpCount = Math.max(0, onMapRoute.length - 1);
    return {
      status: 'ok',
      mode: 'map',
      origin: originName,
      destination: destinationName,
      preference: routePreference,
  originType: originClassification,
  destinationType: destinationClassification,
      jSpacePath: onMapRoute,
      wormholeSegments,
      kSpace: null,
      bridge: null,
      totalJumps: {
        wormhole: wormholeJumpCount,
        kspace: 0,
        total: wormholeJumpCount
      },
      message: `Found a mapped route to ${destinationName}.`
    };
  }

  const originInfo = state.systemsByName.get(originName) || null;
  const destinationInfo = state.systemsByName.get(destinationName) || null;

  const bestPlanCandidates = [];

  const pushPlan = (candidate) => {
    if (!candidate) {
      return;
    }
    bestPlanCandidates.push(candidate);
  };

  // Direct K-space routing using ESI when both endpoints are in known space
  if (originClassification === 'kspace' && destinationClassification === 'kspace' && originInfo && destinationInfo) {
    try {
      const esiRoute = await getCachedEsiRoute(originInfo.id, destinationInfo.id, routePreference);
      const aggregatedKSpace = aggregateSingleKSpaceRoute(esiRoute);
      const jumpCount = aggregatedKSpace?.jumpCount ?? Math.max(0, esiRoute.length - 1);
      pushPlan({
        status: 'ok',
        mode: 'kspace',
        origin: originName,
        destination: destinationName,
        preference: routePreference,
        originType: originClassification,
        destinationType: destinationClassification,
        jSpacePath: [originName],
        wormholeSegments: [],
        kSpace: aggregatedKSpace,
        bridge: {
          fromSystem: originName,
          toSystem: destinationName
        },
        totalJumps: {
          wormhole: 0,
          kspace: jumpCount,
          total: jumpCount
        },
        message: `Plotted a ${jumpCount}-jump K-space route to ${destinationName}.`
      });
    } catch (error) {
      console.warn('routePlanner: ESI route failed for direct K-space path', error);
    }
  }

  const originExitCandidates = originClassification === 'wormhole'
    ? findPathsToClassification(originName, 'kspace', MAX_KSPACE_CANDIDATES)
        .filter((candidate) => Array.isArray(candidate.path) && candidate.path.length >= 2)
    : [];

  const destinationEntryCandidates = destinationClassification === 'wormhole'
    ? findPathsToClassification(destinationName, 'kspace', MAX_KSPACE_CANDIDATES)
        .filter((candidate) => Array.isArray(candidate.path) && candidate.path.length >= 2)
    : [];

  // Wormhole origin to K-space destination
  if (originExitCandidates.length && destinationClassification === 'kspace' && destinationInfo && typeof destinationInfo.id === 'number') {
    for (const candidate of originExitCandidates) {
      const exitName = candidate.node;
      const exitInfo = state.systemsByName.get(exitName) || null;
      if (!exitInfo || typeof exitInfo.id !== 'number') {
        continue;
      }
      try {
        const esiRoute = await getCachedEsiRoute(exitInfo.id, destinationInfo.id, routePreference);
        const aggregatedKSpace = aggregateSingleKSpaceRoute(esiRoute);
        if (!aggregatedKSpace) {
          continue;
        }
        const wormholeSegments = buildWormholeSegments(candidate.path);
        const wormholeJumps = Math.max(0, candidate.path.length - 1);
        const kspaceJumps = aggregatedKSpace.jumpCount ?? Math.max(0, esiRoute.length - 1);
        pushPlan({
          status: 'ok',
          mode: 'hybrid',
          origin: originName,
          destination: destinationName,
          preference: routePreference,
          originType: originClassification,
          destinationType: destinationClassification,
          jSpacePath: candidate.path,
          wormholeSegments,
          kSpace: aggregatedKSpace,
          bridge: {
            fromSystem: exitName,
            toSystem: destinationName
          },
          totalJumps: {
            wormhole: wormholeJumps,
            kspace: kspaceJumps,
            total: wormholeJumps + kspaceJumps
          },
          message: `Hybrid route via ${exitName} with ${wormholeJumps} wormhole jumps and ${kspaceJumps} K-space jumps.`
        });
      } catch (error) {
        console.warn(`routePlanner: ESI route failed from ${exitName} to ${destinationName}`, error);
      }
    }
  }

  // K-space origin to wormhole destination
  if (destinationEntryCandidates.length && originClassification === 'kspace' && originInfo && typeof originInfo.id === 'number') {
    for (const candidate of destinationEntryCandidates) {
      const entryName = candidate.node;
      const entryInfo = state.systemsByName.get(entryName) || null;
      if (!entryInfo || typeof entryInfo.id !== 'number') {
        continue;
      }
      try {
        const esiRoute = await getCachedEsiRoute(originInfo.id, entryInfo.id, routePreference);
        const aggregatedKSpace = aggregateSingleKSpaceRoute(esiRoute);
        if (!aggregatedKSpace) {
          continue;
        }
        const wormholePath = [...candidate.path].reverse();
        const wormholeSegments = buildWormholeSegments(wormholePath);
        const wormholeJumps = Math.max(0, wormholePath.length - 1);
        const kspaceJumps = aggregatedKSpace.jumpCount ?? Math.max(0, esiRoute.length - 1);
        pushPlan({
          status: 'ok',
          mode: 'hybrid',
          origin: originName,
          destination: destinationName,
          preference: routePreference,
          originType: originClassification,
          destinationType: destinationClassification,
          jSpacePath: wormholePath,
          wormholeSegments,
          kSpace: aggregatedKSpace,
          bridge: {
            fromSystem: originName,
            toSystem: entryName
          },
          totalJumps: {
            wormhole: wormholeJumps,
            kspace: kspaceJumps,
            total: wormholeJumps + kspaceJumps
          },
          message: `Hybrid route entering J-space through ${entryName} with ${wormholeJumps} wormhole jumps and ${kspaceJumps} K-space jumps.`
        });
      } catch (error) {
        console.warn(`routePlanner: ESI route failed from ${originName} to ${entryName}`, error);
      }
    }
  }

  // Wormhole origin to wormhole destination via K-space bridge
  if (originExitCandidates.length && destinationEntryCandidates.length) {
    for (const originCandidate of originExitCandidates) {
      const exitName = originCandidate.node;
      const exitInfo = state.systemsByName.get(exitName) || null;
      if (!exitInfo || typeof exitInfo.id !== 'number') {
        continue;
      }
      for (const destinationCandidate of destinationEntryCandidates) {
        const entryName = destinationCandidate.node;
        const entryInfo = state.systemsByName.get(entryName) || null;
        if (!entryInfo || typeof entryInfo.id !== 'number') {
          continue;
        }
        try {
          const esiRoute = await getCachedEsiRoute(exitInfo.id, entryInfo.id, routePreference);
          const aggregatedKSpace = aggregateSingleKSpaceRoute(esiRoute);
          if (!aggregatedKSpace) {
            continue;
          }
          const originPath = originCandidate.path;
          const destinationPath = destinationCandidate.path;
          const reversedDestinationPath = [...destinationPath].reverse();
          const jSpacePath = combinePathSegments([originPath, reversedDestinationPath]);
          const originSegments = buildWormholeSegments(originPath);
          const destinationSegments = reverseWormholeSegments(buildWormholeSegments(destinationPath));
          const wormholeSegments = originSegments.concat(destinationSegments);
          const wormholeJumps = Math.max(0, originPath.length - 1) + Math.max(0, destinationPath.length - 1);
          const kspaceJumps = aggregatedKSpace.jumpCount ?? Math.max(0, esiRoute.length - 1);
          pushPlan({
            status: 'ok',
            mode: 'hybrid',
            origin: originName,
            destination: destinationName,
            preference: routePreference,
            originType: originClassification,
            destinationType: destinationClassification,
            jSpacePath,
            wormholeSegments,
            kSpace: aggregatedKSpace,
            bridge: {
              fromSystem: exitName,
              toSystem: entryName
            },
            totalJumps: {
              wormhole: wormholeJumps,
              kspace: kspaceJumps,
              total: wormholeJumps + kspaceJumps
            },
            message: `Hybrid route via ${exitName} and ${entryName} with ${wormholeJumps} wormhole jumps and ${kspaceJumps} K-space jumps.`
          });
        } catch (error) {
          console.warn(`routePlanner: ESI route failed between ${exitName} and ${entryName}`, error);
        }
      }
    }
  }

  if (bestPlanCandidates.length === 0) {
    return {
      status: 'error',
      reason: 'route_not_found',
      message: 'Unable to compute a route between the selected systems.'
    };
  }

  bestPlanCandidates.sort((a, b) => {
    const totalDiff = (a.totalJumps?.total ?? Infinity) - (b.totalJumps?.total ?? Infinity);
    if (totalDiff !== 0) {
      return totalDiff;
    }
    const wormholeDiff = (a.totalJumps?.wormhole ?? Infinity) - (b.totalJumps?.wormhole ?? Infinity);
    if (wormholeDiff !== 0) {
      return wormholeDiff;
    }
    const kspaceDiff = (a.totalJumps?.kspace ?? Infinity) - (b.totalJumps?.kspace ?? Infinity);
    if (kspaceDiff !== 0) {
      return kspaceDiff;
    }
    return 0;
  });

  return bestPlanCandidates[0];
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
