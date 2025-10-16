const GRID_SIZE = 36;
const MIN_GRID_W = 8;
const MIN_GRID_H = 6;
const STORAGE_PREFIX = 'moduleLayout:v3:';

const DEFAULT_LAYOUTS = {
    map: { x: 0, y: 0, w: 26, h: 18 },
    bookmarks: { x: 0, y: 18, w: 24, h: 14 },
    signatures: { x: 26, y: 0, w: 8, h: 26 },
    intel: { x: 26, y: 26, w: 8, h: 8 }
};

const layoutState = new Map();
let containerBaseWidth = 0;
let containerBaseHeight = 0;
let activeInteraction = null;

const MAX_LAYOUT_ATTEMPTS = 8;
const MIN_MEASURE_WIDTH = GRID_SIZE * MIN_GRID_W;
const MIN_MEASURE_HEIGHT = GRID_SIZE * MIN_GRID_H;

function initModuleGrid() {
    const container = document.getElementById('moduleGrid');
    if (!container) {
        return;
    }

    const overlay = document.getElementById('appLoader');
    document.body.classList.add('layout-loading');
    overlay?.classList.remove('loader-hidden');

    const modules = Array.from(container.querySelectorAll('.module'));
    let layoutApplied = false;
    let attempts = 0;

    const attemptLayout = () => {
        if (layoutApplied) {
            return;
        }

        const measurement = measureContainer(container);
        if (!measurement) {
            attempts += 1;
            if (attempts < MAX_LAYOUT_ATTEMPTS) {
                requestAnimationFrame(attemptLayout);
                return;
            }
        }

        const finalMeasurement = measurement || getFallbackMeasurement(container);
        applyInitialLayout(container, modules, finalMeasurement);
        enforceBounds(container);
        layoutApplied = true;
        window.addEventListener('resize', () => enforceBounds(container));
        finalizeLayoutLoader(overlay);
    };

    requestAnimationFrame(attemptLayout);
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
    const right = rect.left + rect.width;

    const widthPx = Math.max(containerBaseWidth, right + GRID_SIZE);
    container.style.width = `${widthPx}px`;
    container.style.minWidth = `${widthPx}px`;
    container.style.height = `${containerBaseHeight}px`;
    container.style.minHeight = `${containerBaseHeight}px`;
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

    const widthPx = Math.max(containerBaseWidth, maxRight + GRID_SIZE);
    const heightPx = Math.max(containerBaseHeight, maxBottom + GRID_SIZE);
    container.style.width = `${widthPx}px`;
    container.style.minWidth = `${widthPx}px`;
    container.style.height = `${heightPx}px`;
    container.style.minHeight = `${heightPx}px`;
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
    const measurement = measureContainer(container) || getFallbackMeasurement(container);
    containerBaseWidth = measurement.width;
    containerBaseHeight = measurement.height;

    container.style.width = `${containerBaseWidth}px`;
    container.style.minWidth = `${containerBaseWidth}px`;
    container.style.height = `${containerBaseHeight}px`;
    container.style.minHeight = `${containerBaseHeight}px`;

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

function getDefaultLayout(moduleId, moduleEl, fallbackIndex, responsiveDefaults = null) {
    if (responsiveDefaults && responsiveDefaults[moduleId]) {
        return { ...responsiveDefaults[moduleId] };
    }

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

function measureContainer(container) {
    const space = computeAvailableViewportSpace(container);
    if (space.width < MIN_MEASURE_WIDTH || space.height < MIN_MEASURE_HEIGHT) {
        return null;
    }
    return space;
}

function getFallbackMeasurement(container) {
    return computeAvailableViewportSpace(container) || {
        width: MIN_MEASURE_WIDTH,
        height: MIN_MEASURE_HEIGHT
    };
}

function computeAvailableViewportSpace(container) {
    if (!container) {
        return null;
    }

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 960;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 720;

    const headerEl = document.querySelector('.app-header');
    const headerHeight = headerEl ? Math.ceil(headerEl.getBoundingClientRect().height) : 0;

    const mainEl = container.closest('main');
    const mainStyles = mainEl ? window.getComputedStyle(mainEl) : null;

    const mainPaddingTop = mainStyles ? parseFloat(mainStyles.paddingTop) || 0 : 0;
    const mainPaddingBottom = mainStyles ? parseFloat(mainStyles.paddingBottom) || 0 : 0;
    const mainPaddingLeft = mainStyles ? parseFloat(mainStyles.paddingLeft) || 0 : 0;
    const mainPaddingRight = mainStyles ? parseFloat(mainStyles.paddingRight) || 0 : 0;

    const containerStyles = window.getComputedStyle(container);
    const containerPaddingTop = parseFloat(containerStyles.paddingTop) || 0;
    const containerPaddingBottom = parseFloat(containerStyles.paddingBottom) || 0;
    const containerPaddingLeft = parseFloat(containerStyles.paddingLeft) || 0;
    const containerPaddingRight = parseFloat(containerStyles.paddingRight) || 0;

    const availableWidth =
        viewportWidth - mainPaddingLeft - mainPaddingRight - containerPaddingLeft - containerPaddingRight;
    const availableHeight =
        viewportHeight - headerHeight - mainPaddingTop - mainPaddingBottom - containerPaddingTop - containerPaddingBottom;

    return {
        width: Math.max(availableWidth, MIN_MEASURE_WIDTH),
        height: Math.max(availableHeight, MIN_MEASURE_HEIGHT)
    };
}

function applyInitialLayout(container, modules, measurement) {
    containerBaseWidth = measurement.width;
    containerBaseHeight = measurement.height;

    container.style.width = `${containerBaseWidth}px`;
    container.style.minWidth = `${containerBaseWidth}px`;
    container.style.height = `${containerBaseHeight}px`;
    container.style.minHeight = `${containerBaseHeight}px`;

    const gridWidth = Math.max(Math.floor(containerBaseWidth / GRID_SIZE), MIN_GRID_W * 3);
    const gridHeight = Math.max(Math.floor(containerBaseHeight / GRID_SIZE), MIN_GRID_H * 4);
    const responsiveDefaults = calculateResponsiveDefaults(gridWidth, gridHeight);

    let fallbackIndex = 0;

    modules.forEach((moduleEl, index) => {
        const moduleId = moduleEl.dataset.moduleId || moduleEl.getAttribute('data-module-id') || `module-${index}`;
        moduleEl.dataset.moduleId = moduleId;

        const storedLayout = loadLayout(moduleId);
        const initialLayout = storedLayout || getDefaultLayout(moduleId, moduleEl, fallbackIndex++, responsiveDefaults);
        layoutState.set(moduleId, initialLayout);
        applyLayout(moduleEl, initialLayout);

        if (!moduleEl.dataset.layoutBound) {
            installMoveHandle(moduleEl, container, moduleId);
            installResizeHandle(moduleEl, container, moduleId);
            moduleEl.dataset.layoutBound = 'true';
        }
    });
}

function finalizeLayoutLoader(overlay) {
    document.body.classList.remove('layout-loading');
    if (!overlay) {
        return;
    }
    requestAnimationFrame(() => {
        overlay.classList.add('loader-hidden');
        setTimeout(() => {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        }, 450);
    });
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

function calculateResponsiveDefaults(gridWidth, gridHeight) {
    const effectiveWidth = gridWidth;
    const effectiveHeight = gridHeight;

    const sideWidth = clamp(
        Math.round(effectiveWidth * 0.24),
        MIN_GRID_W,
        effectiveWidth - MIN_GRID_W
    );
    const mainWidth = effectiveWidth - sideWidth;

    const mapHeight = clamp(
        Math.round(effectiveHeight * 0.6),
        MIN_GRID_H,
        effectiveHeight - MIN_GRID_H
    );
    const bookmarksHeight = effectiveHeight - mapHeight;

    const intelHeight = clamp(
        Math.round(effectiveHeight * 0.24),
        MIN_GRID_H,
        effectiveHeight - MIN_GRID_H
    );
    const signaturesHeight = effectiveHeight - intelHeight;

    return {
        map: {
            x: 0,
            y: 0,
            w: mainWidth,
            h: mapHeight
        },
        bookmarks: {
            x: 0,
            y: mapHeight,
            w: mainWidth,
            h: bookmarksHeight
        },
        signatures: {
            x: mainWidth,
            y: 0,
            w: sideWidth,
            h: signaturesHeight
        },
        intel: {
            x: mainWidth,
            y: signaturesHeight,
            w: sideWidth,
            h: intelHeight
        }
    };
}
