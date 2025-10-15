const GRID_SIZE = 36;
const MIN_GRID_W = 8;
const MIN_GRID_H = 6;
const STORAGE_PREFIX = 'moduleLayout:v2:';

const DEFAULT_LAYOUTS = {
    map: { x: 0, y: 0, w: 18, h: 16 },
    bookmarks: { x: 18, y: 0, w: 18, h: 18 },
    signatures: { x: 0, y: 16, w: 14, h: 18 }
};

const layoutState = new Map();
let containerBaseWidth = 0;
let containerBaseHeight = 0;
let activeInteraction = null;

function initModuleGrid() {
    const container = document.getElementById('moduleGrid');
    if (!container) {
        return;
    }

    containerBaseWidth = container.clientWidth || 960;
    containerBaseHeight = container.clientHeight || 480;

    const modules = Array.from(container.querySelectorAll('.module'));
    let fallbackIndex = 0;

    modules.forEach((moduleEl, index) => {
        const moduleId = moduleEl.getAttribute('data-module-id') || `module-${index}`;
        moduleEl.dataset.moduleId = moduleId;

        const storedLayout = loadLayout(moduleId);
        const initialLayout = storedLayout || getDefaultLayout(moduleId, moduleEl, fallbackIndex++);
        layoutState.set(moduleId, initialLayout);
        applyLayout(moduleEl, initialLayout);

        installMoveHandle(moduleEl, container, moduleId);
        installResizeHandle(moduleEl, container, moduleId);
    });

    updateContainerExtents(container);
    window.addEventListener('resize', () => enforceBounds(container));
}

function installMoveHandle(moduleEl, container, moduleId) {
    const handle = moduleEl.querySelector('.module-header');
    if (!handle) return;

    handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (event.target.closest('button') || event.target.closest('a')) return;
        event.preventDefault();
        beginInteraction('move', event, moduleEl, container, moduleId);
    });
}

function installResizeHandle(moduleEl, container, moduleId) {
    const handle = moduleEl.querySelector('.module-resize-handle');
    if (!handle) return;

    handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        beginInteraction('resize', event, moduleEl, container, moduleId);
    });
}

function beginInteraction(type, event, moduleEl, container, moduleId) {
    if (activeInteraction) {
        return;
    }

    const target = event.target;
    target.setPointerCapture(event.pointerId);
    moduleEl.classList.add('dragging');

    const rect = getModuleRect(moduleEl);
    const previousLayout = { ...layoutState.get(moduleId) };

    activeInteraction = {
        type,
        pointerId: event.pointerId,
        moduleEl,
        container,
        moduleId,
        startX: event.clientX,
        startY: event.clientY,
        originRect: rect,
        previousLayout
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUpOrCancel);
    window.addEventListener('pointercancel', onPointerUpOrCancel);
}

function onPointerMove(event) {
    if (!activeInteraction || event.pointerId !== activeInteraction.pointerId) {
        return;
    }

    const { type, moduleEl, container, startX, startY, originRect } = activeInteraction;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    if (type === 'move') {
        const nextLeft = Math.max(0, originRect.left + deltaX);
        const nextTop = Math.max(0, originRect.top + deltaY);
        moduleEl.style.left = `${nextLeft}px`;
        moduleEl.style.top = `${nextTop}px`;
    } else if (type === 'resize') {
        const minWidthPx = MIN_GRID_W * GRID_SIZE;
        const minHeightPx = MIN_GRID_H * GRID_SIZE;
        const nextWidth = Math.max(minWidthPx, originRect.width + deltaX);
        const nextHeight = Math.max(minHeightPx, originRect.height + deltaY);
        moduleEl.style.width = `${nextWidth}px`;
        moduleEl.style.height = `${nextHeight}px`;
    }

    ensureContainerForPreview(container, moduleEl);
}

function onPointerUpOrCancel(event) {
    if (!activeInteraction || event.pointerId !== activeInteraction.pointerId) {
        return;
    }

    const { moduleEl, container, moduleId, previousLayout } = activeInteraction;
    moduleEl.classList.remove('dragging');

    const snappedLayout = snapToGrid(moduleEl);
    const hasCollision = detectCollision(moduleId, snappedLayout);

    if (hasCollision) {
        applyLayout(moduleEl, previousLayout);
        layoutState.set(moduleId, previousLayout);
    } else {
        layoutState.set(moduleId, snappedLayout);
        applyLayout(moduleEl, snappedLayout);
        saveLayout(moduleId, snappedLayout);
    }

    updateContainerExtents(container);
    cleanupInteraction();

    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUpOrCancel);
    window.removeEventListener('pointercancel', onPointerUpOrCancel);
}

function cleanupInteraction() {
    activeInteraction = null;
}

function getModuleRect(moduleEl) {
    return {
        left: parseFloat(moduleEl.style.left) || 0,
        top: parseFloat(moduleEl.style.top) || 0,
        width: moduleEl.offsetWidth,
        height: moduleEl.offsetHeight
    };
}

function snapToGrid(moduleEl) {
    const rect = getModuleRect(moduleEl);
    const snappedLeft = Math.max(0, roundToGrid(rect.left));
    const snappedTop = Math.max(0, roundToGrid(rect.top));

    const rawWidthUnits = rect.width / GRID_SIZE;
    const rawHeightUnits = rect.height / GRID_SIZE;
    const snappedWidthUnits = Math.max(MIN_GRID_W, Math.round(rawWidthUnits));
    const snappedHeightUnits = Math.max(MIN_GRID_H, Math.round(rawHeightUnits));

    return {
        x: snappedLeft / GRID_SIZE,
        y: snappedTop / GRID_SIZE,
        w: snappedWidthUnits,
        h: snappedHeightUnits
    };
}

function applyLayout(moduleEl, layout) {
    moduleEl.style.left = `${layout.x * GRID_SIZE}px`;
    moduleEl.style.top = `${layout.y * GRID_SIZE}px`;
    moduleEl.style.width = `${layout.w * GRID_SIZE}px`;
    moduleEl.style.height = `${layout.h * GRID_SIZE}px`;
}

function ensureContainerForPreview(container, moduleEl) {
    const rect = getModuleRect(moduleEl);
    const bottom = rect.top + rect.height;
    const right = rect.left + rect.width;

    if (bottom + GRID_SIZE > containerBaseHeight) {
        container.style.height = `${bottom + GRID_SIZE}px`;
    }

    if (right + GRID_SIZE > containerBaseWidth) {
        container.style.minWidth = `${right + GRID_SIZE}px`;
    }
}

function updateContainerExtents(container) {
    let maxBottom = containerBaseHeight;
    let maxRight = containerBaseWidth;

    layoutState.forEach((layout) => {
        const bottom = (layout.y + layout.h) * GRID_SIZE;
        const right = (layout.x + layout.w) * GRID_SIZE;
        if (bottom > maxBottom) maxBottom = bottom;
        if (right > maxRight) maxRight = right;
    });

    container.style.height = `${maxBottom + GRID_SIZE}px`;
    container.style.minWidth = `${Math.max(containerBaseWidth, maxRight + GRID_SIZE)}px`;
}

function detectCollision(moduleId, layout) {
    for (const [otherId, otherLayout] of layoutState.entries()) {
        if (otherId === moduleId) continue;
        const overlaps =
            layout.x < otherLayout.x + otherLayout.w &&
            layout.x + layout.w > otherLayout.x &&
            layout.y < otherLayout.y + otherLayout.h &&
            layout.y + layout.h > otherLayout.y;
        if (overlaps) {
            return true;
        }
    }
    return false;
}

function enforceBounds(container) {
    containerBaseWidth = container.clientWidth || containerBaseWidth;
    containerBaseHeight = Math.max(containerBaseHeight, container.clientHeight || containerBaseHeight);

    layoutState.forEach((layout, moduleId) => {
        const moduleEl = container.querySelector(`.module[data-module-id="${moduleId}"]`);
        if (!moduleEl) return;

        const maxLeftUnits = Math.max(0, Math.floor((containerBaseWidth - layout.w * GRID_SIZE) / GRID_SIZE));
        const clampedX = clamp(layout.x, 0, maxLeftUnits);
        const clampedY = Math.max(0, layout.y);

        const adjustedLayout = { ...layout, x: clampedX, y: clampedY };
        layoutState.set(moduleId, adjustedLayout);
        applyLayout(moduleEl, adjustedLayout);
    });

    updateContainerExtents(container);
}

function getDefaultLayout(moduleId, moduleEl, fallbackIndex) {
    if (DEFAULT_LAYOUTS[moduleId]) {
        return { ...DEFAULT_LAYOUTS[moduleId] };
    }

    const baseW = Math.max(MIN_GRID_W, (parseInt(moduleEl.dataset.gridW, 10) || MIN_GRID_W) * 2);
    const baseH = Math.max(MIN_GRID_H, (parseInt(moduleEl.dataset.gridH, 10) || MIN_GRID_H) * 2);
    const column = fallbackIndex % 2;
    const row = Math.floor(fallbackIndex / 2);
    const gap = 2;

    return {
        x: column * (baseW + gap),
        y: row * (baseH + gap),
        w: baseW,
        h: baseH
    };
}

function loadLayout(moduleId) {
    try {
        const raw = localStorage.getItem(`${STORAGE_PREFIX}${moduleId}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (
            typeof parsed.x === 'number' &&
            typeof parsed.y === 'number' &&
            typeof parsed.w === 'number' &&
            typeof parsed.h === 'number'
        ) {
            return parsed;
        }
        return null;
    } catch (error) {
        console.warn(`Failed to parse layout for ${moduleId}`, error);
        return null;
    }
}

function saveLayout(moduleId, layout) {
    try {
        localStorage.setItem(`${STORAGE_PREFIX}${moduleId}`, JSON.stringify(layout));
    } catch (error) {
        console.warn(`Failed to persist layout for ${moduleId}`, error);
    }
}

function roundToGrid(value) {
    return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function clamp(value, min, max) {
    if (Number.isNaN(value)) return min;
    return Math.min(Math.max(value, min), max);
}

document.addEventListener('DOMContentLoaded', initModuleGrid);

export { initModuleGrid };
