import { extractSystems } from './extractSystems.js';
import { buildSystemTag } from './buildSystemTag.js';
import { lockNodes, unlockNodes, dragStarted, dragged, dragEnded } from './dragHandlers.js';

const PLACEHOLDER_PATTERN = /^\?+$/;
const PLACEHOLDER_KEY_COLUMNS = ['Label', 'Type', 'SOL', 'CON', 'REG', 'Date', 'Expiry', 'Creator', 'Jumps'];

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

/**
 * Displays the map with the given data.
 * @param {Array<Object>} data The data to display on the map.
 */
export function displayMap(data) {
  console.log('displayMap called with data:', data);
  const mapContainer = document.getElementById('mapContainer');
  if (!mapContainer) {
    console.warn('displayMap: mapContainer not found');
    return;
  }

  const previousRuntime = mapContainer.__mapRuntime || null;
  let previousPositions = new Map();
  let previousTransform = null;

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
    } catch (error) {
      console.warn('displayMap: failed to capture previous runtime state', error);
      previousPositions = new Map();
      previousTransform = null;
    }
  }

  mapContainer.__mapRuntime = null;
  mapContainer.innerHTML = '';

  const searchControls = document.createElement('div');
  searchControls.className = 'map-search-controls';

  const searchToggle = document.createElement('button');
  searchToggle.type = 'button';
  searchToggle.className = 'map-search-toggle';
  searchToggle.setAttribute('aria-label', 'Search for a system');
  searchToggle.setAttribute('aria-expanded', 'false');
  searchToggle.title = 'Search systems';
  searchToggle.innerHTML = `
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <circle cx="11" cy="11" r="8" stroke="currentColor" fill="none" stroke-width="2"/>
      <path d="m21 21-4.35-4.35" stroke="currentColor" stroke-width="2"/>
    </svg>
  `;

  const searchPanel = document.createElement('div');
  searchPanel.className = 'map-search-panel';
  searchPanel.hidden = true;

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'map-search-input';
  searchInput.placeholder = 'Jump to system...';
  searchInput.setAttribute('aria-label', 'System name');
  searchInput.autocomplete = 'off';

  const searchSubmit = document.createElement('button');
  searchSubmit.type = 'button';
  searchSubmit.className = 'map-search-submit';
  searchSubmit.textContent = 'Go';

  const searchMessage = document.createElement('div');
  searchMessage.className = 'map-search-message';
  searchMessage.setAttribute('role', 'status');
  searchMessage.setAttribute('aria-live', 'polite');

  searchPanel.append(searchInput, searchSubmit, searchMessage);
  searchControls.append(searchToggle, searchPanel);
  mapContainer.appendChild(searchControls);

  const searchContext = {
    controls: searchControls,
    toggle: searchToggle,
    panel: searchPanel,
    input: searchInput,
    submit: searchSubmit,
    message: searchMessage
  };

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
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSearchSubmit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeSearchPanel();
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
  const connections = [];
  const statuses = {};
  const placeholderCache = new Map();

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

  if (typeof window.setSignatureActiveSystem === 'function') {
    window.setSignatureActiveSystem(null);
  }
  if (typeof window.setSystemIntelActiveSystem === 'function') {
    window.setSystemIntelActiveSystem(null);
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
    "C13": "#7F7F7F"
  };

  data.forEach((row) => {
    const rawLabel = (row && row['Label'] !== undefined && row['Label'] !== null)
      ? row['Label'].toString()
      : '';
    if (!rawLabel) {
      return;
    }

    if (rawLabel.startsWith('-')) {
      const [systemFrom, systemToRaw] = extractSystems(rawLabel, row['SOL']);
      if (systemFrom && systemToRaw) {
        const targetInfo = PLACEHOLDER_PATTERN.test(systemToRaw)
          ? createPlaceholderIdentifier(systemFrom, systemToRaw, row, placeholderCache)
          : {
            id: systemToRaw,
            displayName: systemToRaw,
            filterKey: systemToRaw,
            isPlaceholder: false,
            originSystem: systemToRaw
          };

        const systemTo = targetInfo.id;
        const isEOL = rawLabel.includes('EOL');
        const isCRIT = rawLabel.includes('CRIT');
        const existingConnection = connections.find((conn) =>
          (conn.source === systemFrom && conn.target === systemTo) ||
          (conn.source === systemTo && conn.target === systemFrom)
        );

        if (existingConnection) {
          existingConnection.isEOL = existingConnection.isEOL || isEOL;
          existingConnection.isCRIT = existingConnection.isCRIT || isCRIT;
        } else {
          connections.push({ source: systemFrom, target: systemTo, isEOL, isCRIT });
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

  console.log('systems:', systems);
  console.log('connections:', connections);
  console.log('statuses:', statuses);

  const nodes = Object.values(systems);
  const links = connections;
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
    const chainSpacing = 200;
    chains.forEach((chain, index) => {
      const angle = (index / chains.length) * 2 * Math.PI;
      const centerX = width / 2 + Math.cos(angle) * chainSpacing * index;
      const centerY = height / 2 + Math.sin(angle) * chainSpacing * index;
      chain.forEach((node, nodeIndex) => {
        node.x = centerX + Math.cos(angle + nodeIndex) * 50;
        node.y = centerY + Math.sin(angle + nodeIndex) * 50;
      });
    });
  }

  const randomOffset = () => (Math.random() - 0.5) * 40;

  nodes.forEach((node) => {
    const saved = previousPositions.get(node.name);
    if (saved) {
      node.x = saved.x;
      node.y = saved.y;
      node.vx = saved.vx;
      node.vy = saved.vy;
      node.fx = saved.fx;
      node.fy = saved.fy;
      return;
    }

    if (!hasPreviousLayout) {
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
        return;
      }
    }

    node.x = (width / 2) + randomOffset();
    node.y = (height / 2) + randomOffset();
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
    currentTransform
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
    requestAnimationFrame(() => {
      if (searchContext.input) {
        searchContext.input.focus();
        searchContext.input.select();
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
    lockNodes(simulation, nodes);

    if (typeof window.setSignatureActiveSystem === 'function') {
      window.setSignatureActiveSystem(selectionKey);
    }
    if (typeof window.setSystemIntelActiveSystem === 'function') {
      window.setSystemIntelActiveSystem(selectionKey);
    }

    closeSearchPanel();

    return true;
  }

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

  function handleSearchSubmit() {
    if (!searchContext.input) {
      return;
    }
    const query = searchContext.input.value.trim();
    if (!query) {
      setSearchMessage('Enter a system name.', 'error');
      return;
    }

    const targetNode = findNodeByQuery(query);

    if (!targetNode) {
      setSearchMessage('System not found', 'error');
      return;
    }

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

  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id((d) => d.name).distance(100))
    .force('charge', d3.forceManyBody().strength(-50))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collide', d3.forceCollide(50))
    .on('tick', ticked);

  if (hasPreviousLayout) {
    simulation.alpha(0.35);
  }

  runtimeState.simulation = simulation;
  runtimeState.nodes = nodes;
  mapContainer.__mapRuntime = runtimeState;

  if (hasPreviousLayout) {
    lockNodes(simulation, nodes);
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
    g.selectAll('.crosshair').remove();

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
          lockNodes(simulation, nodes); // Lock nodes after dragging ends
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
      d3.selectAll('.crosshair').remove();

      const keys = ['Label', 'Type', 'Jumps', 'SOL', 'CON', 'REG', 'Date', 'Expiry', 'Creator']; // Define keys
      displayTable(keys, data); // Reset table filter
      lockNodes(simulation, nodes); // Lock all nodes in place
      if (typeof window.setSignatureActiveSystem === 'function') {
        window.setSignatureActiveSystem(null);
      }
      if (typeof window.setSystemIntelActiveSystem === 'function') {
        window.setSystemIntelActiveSystem(null);
      }
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
  }

  function updateCrosshair(d, classColors) {
    const systemInfo = systems[d.name] || (d.filterKey ? systems[d.filterKey] : null);
    const wormholeClass = systemInfo ? systemInfo.wormholeClass : null;
    const classColor = wormholeClass ? classColors[wormholeClass.toUpperCase()] : '#00ff00';

    d3.selectAll('.crosshair').remove();

    g.append('line')
      .attr('class', 'crosshair')
      .attr('x1', -100000)
      .attr('y1', d.y)
      .attr('x2', 100000)
      .attr('y2', d.y)
      .attr('stroke', classColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '5,5')
      .lower();

    g.append('line')
      .attr('class', 'crosshair')
      .attr('x1', d.x)
      .attr('y1', -100000)
      .attr('x2', d.x)
      .attr('y2', 100000)
      .attr('stroke', classColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '5,5')
      .lower();
  }

  // Lock nodes on any interaction
  svg.on('mousedown', () => lockNodes(simulation, nodes));
  svg.on('touchstart', () => lockNodes(simulation, nodes));
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
    });
}

window.displayMap = displayMap;
export const statuses = {};
export { filterBookmarksBySystem }; // Export the function for use in dragHandlers.js
