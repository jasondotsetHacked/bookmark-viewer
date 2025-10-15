import { filterBookmarksBySystem } from './displayMap.js';

export function lockNodes(simulation, nodes) {
    simulation.stop(); // Stop the simulation
    nodes.forEach(node => {
        node.fx = node.x;
        node.fy = node.y;
    });
}

export function dragStarted(event, d, simulation) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
    filterBookmarksBySystem(d.name); // Filter bookmarks when dragging starts
}

export function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
    filterBookmarksBySystem(d.name); // Filter bookmarks while dragging
}

export function dragEnded(event, d, simulation) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null; // Allow the node to be free after dragging ends
    d.fy = null; // Allow the node to be free after dragging ends
}

export function unlockNodes(nodes) {
    nodes.forEach(node => {
        node.fx = null;
        node.fy = null;
    });
}