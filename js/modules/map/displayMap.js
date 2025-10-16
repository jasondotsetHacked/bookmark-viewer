import { extractSystems } from './extractSystems.js';
import { buildSystemTag } from './buildSystemTag.js';
import { lockNodes, unlockNodes, dragStarted, dragged, dragEnded } from './dragHandlers.js';

/**
 * Displays the map with the given data.
 * @param {Array<Object>} data The data to display on the map.
 */
export function displayMap(data) {
  console.log('displayMap called with data:', data);
  const mapContainer = document.getElementById('mapContainer');
  mapContainer.innerHTML = '';

  const systems = {};
  const connections = [];
  const statuses = {};

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
    if (row['Label'].startsWith('-')) {
      const [systemFrom, systemTo] = extractSystems(row['Label'], row['SOL']);
      if (systemFrom && systemTo) {
        const isEOL = row['Label'].includes('EOL');
        const isCRIT = row['Label'].includes('CRIT');
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
        systems[systemFrom] = { name: systemFrom, label: row['Label'] };
        systems[systemTo] = { name: systemTo, label: row['Label'] };
      }
    } else if (row['Label'].startsWith('@')) {
      const system = row['SOL'].trim();
      const status = row['Label'].split(' ')[0];
      statuses[system] = status;
    }
  });

  console.log('systems:', systems);
  console.log('connections:', connections);
  console.log('statuses:', statuses);

  const nodes = Object.values(systems);
  const links = connections;
  const width = mapContainer.clientWidth;
  const height = mapContainer.clientHeight;

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

  console.log('mapContainer dimensions:', width, height);

  const svg = d3.select('#mapContainer').append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', [0, 0, width, height])
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .on('contextmenu', (event) => event.preventDefault()); // Prevent default right-click menu

  const zoom = d3.zoom()
    .scaleExtent([0.1, 10])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoom);

  const g = svg.append('g');

  g.append('rect')
    .attr('class', 'zoom-rect')
    .attr('width', width)
    .attr('height', height)
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

  function selectSystem(d) {
    d3.selectAll('.nodes circle').attr('fill', (d) => {
      const status = statuses[d.name];
      if (status === '@FRIENDLY') return '#00ff00';
      if (status === '@HOLD') return '#ffeb3b';
      if (status === '@DANGER') return '#ff0000';
      if (status === '@HOME') return '#00ff00'; // Green for HOME
      return '#d3d3d3'; // Default light gray
    });

    const systemInfo = systems[d.name];
    const wormholeClass = systemInfo ? systemInfo.wormholeClass : null;
    const classColor = wormholeClass ? classColors[wormholeClass.toUpperCase()] : '#00ff00';

    // Remove existing crosshair
    d3.selectAll('.crosshair').remove();

    // Add crosshair
    g.append('line')
      .attr('class', 'crosshair')
      .attr('x1', -width)
      .attr('y1', d.y)
      .attr('x2', width * 2)
      .attr('y2', d.y)
      .attr('stroke', classColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '5,5')
      .lower();

    g.append('line')
      .attr('class', 'crosshair')
      .attr('x1', d.x)
      .attr('y1', -height)
      .attr('x2', d.x)
      .attr('y2', height * 2)
      .attr('stroke', classColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '5,5')
      .lower();

    console.log(`Node ${d.name} clicked`);
    const keys = ['Label', 'Type', 'Jumps', 'SOL', 'CON', 'REG', 'Date', 'Expiry', 'Creator']; // Define keys
    displayTable(keys, data, d.name); // Filter table by selected system
    lockNodes(simulation, nodes); // Lock all nodes in place
  }

  const node = g.append('g')
    .attr('class', 'nodes')
    .selectAll('circle')
    .data(nodes)
    .enter().append('circle')
    .attr('r', 10)
    .attr('fill', (d) => {
      const status = statuses[d.name];
      if (status === '@FRIENDLY') return '#00ff00';
      if (status === '@HOLD') return '#ffeb3b';
      if (status === '@DANGER') return '#ff0000';
      if (status === '@HOME') return '#00ff00'; // Green for HOME
      return '#d3d3d3'; // Default light gray
    })
    .attr('stroke', (d) => {
      const status = statuses[d.name];
      if (status === '@FRIENDLY') return '#00ff00';
      if (status === '@HOLD') return '#ffeb3b';
      if (status === '@DANGER') return '#ff0000';
      if (status === '@HOME') return '#00ff00'; // Green for HOME
      return '#d3d3d3'; // Default light gray
    })
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
        d3.selectAll('.nodes circle').attr('fill', (d) => {
          const status = statuses[d.name];
          if (status === '@FRIENDLY') return '#00ff00';
          if (status === '@HOLD') return '#ffeb3b';
          if (status === '@DANGER') return '#ff0000';
          if (status === '@HOME') return '#00ff00'; // Green for HOME
          return '#d3d3d3'; // Default light gray
        });

        const systemInfo = systems[d.name];
        const wormholeClass = systemInfo ? systemInfo.wormholeClass : null;
        const classColor = wormholeClass ? classColors[wormholeClass.toUpperCase()] : '#00ff00';

        // Remove existing crosshair
        d3.selectAll('.crosshair').remove();

        // Add crosshair
        g.append('line')
          .attr('class', 'crosshair')
          .attr('x1', -width)
          .attr('y1', d.y)
          .attr('x2', width * 2)
          .attr('y2', d.y)
          .attr('stroke', classColor)
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '5,5')
          .lower();

        g.append('line')
          .attr('class', 'crosshair')
          .attr('x1', d.x)
          .attr('y1', -height)
          .attr('x2', d.x)
          .attr('y2', height * 2)
          .attr('stroke', classColor)
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '5,5')
          .lower();

        console.log(`Node ${d.name} clicked`);
        const keys = ['Label', 'Type', 'Jumps', 'SOL', 'CON', 'REG', 'Date', 'Expiry', 'Creator']; // Define keys
        displayTable(keys, data, d.name); // Filter table by selected system
        lockNodes(simulation, nodes); // Lock all nodes in place
        if (typeof window.setSignatureActiveSystem === 'function') {
          window.setSignatureActiveSystem(d.name);
        }
        if (typeof window.setSystemIntelActiveSystem === 'function') {
          window.setSystemIntelActiveSystem(d.name);
        }
      }
    });

  // Add event listener to reset table filter when clicking off the table
  d3.select('#mapContainer').on('click', function (event) {
    if (event.target.tagName !== 'circle') {
      d3.selectAll('.nodes circle').attr('fill', (d) => {
        const status = statuses[d.name];
        if (status === '@FRIENDLY') return '#00ff00';
        if (status === '@HOLD') return '#ffeb3b';
        if (status === '@DANGER') return '#ff0000';
        if (status === '@HOME') return '#00ff00'; // Green for HOME
        return '#d3d3d3'; // Default light gray
      });

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
    const systemInfo = systems[d.name];
    const wormholeClass = systemInfo ? systemInfo.wormholeClass : null;
    const classColor = wormholeClass ? classColors[wormholeClass.toUpperCase()] : '#00ff00';

    d3.selectAll('.crosshair').remove();

    g.append('line')
      .attr('class', 'crosshair')
      .attr('x1', -width)
      .attr('y1', d.y)
      .attr('x2', width * 2)
      .attr('y2', d.y)
      .attr('stroke', classColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '5,5')
      .lower();

    g.append('line')
      .attr('class', 'crosshair')
      .attr('x1', d.x)
      .attr('y1', -height)
      .attr('x2', d.x)
      .attr('y2', height * 2)
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
