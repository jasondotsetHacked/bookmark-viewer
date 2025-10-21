const GRID_SIZE = 36;
const MIN_GRID_W = 8;
const MIN_GRID_H = 6;
const STORAGE_PREFIX = 'moduleLayout:v3:';
const VISIBILITY_STORAGE_KEY = `${STORAGE_PREFIX}visibility`;

const DEFAULT_LAYOUTS = {
    map: { x: 0, y: 0, w: 26, h: 18 },
    bookmarks: { x: 0, y: 18, w: 16, h: 14 },
    routes: { x: 16, y: 18, w: 8, h: 14 },
    signatures: { x: 26, y: 0, w: 8, h: 20 },
    intel: { x: 26, y: 20, w: 8, h: 6 },
    stats: { x: 26, y: 26, w: 8, h: 8 }
};

const layoutState = new Map();
const moduleVisibilityControls = new Map();
let containerBaseWidth = 0;
let containerBaseHeight = 0;
let activeInteraction = null;
const LOCK_STATE_KEY = `${STORAGE_PREFIX}lockState`;
let isLayoutLocked = false;
let lockToggleButton = null;
let moduleVisibilityState = new Map();
let modulePreferencesButton = null;
let modulePreferencesPanel = null;
let modulePreferencesInitialized = false;
let isModulePreferencesOpen = false;

const MAX_LAYOUT_ATTEMPTS = 8;
const MIN_MEASURE_WIDTH = GRID_SIZE * MIN_GRID_W;
const MIN_MEASURE_HEIGHT = GRID_SIZE * MIN_GRID_H;

function loadModuleVisibilityState() {
    try {
        const raw = localStorage.getItem(VISIBILITY_STORAGE_KEY);
        if (!raw) {
            return new Map();
        }
        const parsed = JSON.parse(raw);
        const map = new Map();
        Object.entries(parsed).forEach(([moduleId, value]) => {
            map.set(moduleId, value !== false);
        });
        return map;
    } catch (error) {
        console.warn('Failed to load module visibility state', error);
        return new Map();
    }
}

function persistModuleVisibilityState() {
    try {
        const payload = {};
        moduleVisibilityState.forEach((visible, moduleId) => {
            payload[moduleId] = visible !== false;
        });
        localStorage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
        console.warn('Failed to persist module visibility state', error);
    }
}

function isModuleCurrentlyVisible(moduleEl) {
    if (!moduleEl) {
        return false;
    }
    return moduleEl.dataset.visible !== 'false';
}

function applyModuleVisibility(moduleId, visible, options = {}) {
    if (!moduleId) {
        return;
    }
    const settings = {
        persist: true,
        updateControls: true,
        notify: true,
        skipLayoutUpdate: false,
        ...options
    };

    const resolvedVisible = visible !== false;
    moduleVisibilityState.set(moduleId, resolvedVisible);

    const moduleEl = document.querySelector(`.module[data-module-id="${moduleId}"]`);
    if (moduleEl) {
        moduleEl.dataset.visible = resolvedVisible ? 'true' : 'false';
        moduleEl.setAttribute('aria-hidden', resolvedVisible ? 'false' : 'true');
        moduleEl.classList.toggle('module-hidden', !resolvedVisible);
    }

    if (settings.updateControls) {
        const control = moduleVisibilityControls.get(moduleId);
        if (control) {
            control.checked = resolvedVisible;
        }
    }

    if (settings.persist) {
        persistModuleVisibilityState();
    }

    if (!settings.skipLayoutUpdate) {
        const container = document.getElementById('moduleGrid');
        if (container) {
            requestAnimationFrame(() => enforceBounds(container));
        }
    }

    if (settings.notify) {
        window.dispatchEvent(new CustomEvent('moduleVisibilityChanged', {
            detail: {
                moduleId,
                visible: resolvedVisible
            }
        }));
    }
}

function buildModulePreferencesPanel() {
    if (!modulePreferencesPanel) {
        return;
    }

    moduleVisibilityControls.clear();
    modulePreferencesPanel.innerHTML = '';

    const modules = Array.from(document.querySelectorAll('.module[data-module-id]'));

    if (!modules.length) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'module-preferences-empty';
        emptyMessage.textContent = 'No modules available.';
        modulePreferencesPanel.appendChild(emptyMessage);
        return;
    }

    const heading = document.createElement('h3');
    heading.textContent = 'Modules';
    modulePreferencesPanel.appendChild(heading);

    modules
        .sort((a, b) => {
            const labelA = (a.querySelector('.module-header h2')?.textContent || a.dataset.moduleId || '').trim();
            const labelB = (b.querySelector('.module-header h2')?.textContent || b.dataset.moduleId || '').trim();
            return labelA.localeCompare(labelB, undefined, { sensitivity: 'base' });
        })
        .forEach((moduleEl) => {
            const moduleId = moduleEl.dataset.moduleId || moduleEl.getAttribute('data-module-id');
            if (!moduleId) {
                return;
            }
            if (!moduleVisibilityState.has(moduleId)) {
                moduleVisibilityState.set(moduleId, true);
            }
            const checkboxId = `module-toggle-${moduleId}`;
            const container = document.createElement('label');
            container.className = 'module-preferences-item';
            container.setAttribute('for', checkboxId);

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = checkboxId;
            input.checked = isModuleCurrentlyVisible(moduleEl);
            input.dataset.moduleId = moduleId;
            input.addEventListener('change', () => applyModuleVisibility(moduleId, input.checked));

            const label = document.createElement('span');
            const labelText = moduleEl.querySelector('.module-header h2')?.textContent || moduleId;
            label.textContent = labelText.trim();

            container.appendChild(input);
            container.appendChild(label);
            modulePreferencesPanel.appendChild(container);
            moduleVisibilityControls.set(moduleId, input);
        });
}

function toggleModulePreferencesPanel(forceState = null) {
    if (!modulePreferencesButton || !modulePreferencesPanel) {
        return;
    }
    const nextState = forceState === null ? !isModulePreferencesOpen : Boolean(forceState);
    if (nextState) {
        buildModulePreferencesPanel();
    }

    isModulePreferencesOpen = nextState;
    modulePreferencesPanel.classList.toggle('open', nextState);
    modulePreferencesPanel.setAttribute('aria-hidden', nextState ? 'false' : 'true');
    modulePreferencesButton.setAttribute('aria-expanded', nextState ? 'true' : 'false');
}

function handlePreferencesDocumentClick(event) {
    if (!isModulePreferencesOpen) {
        return;
    }
    if (modulePreferencesPanel?.contains(event.target) || modulePreferencesButton?.contains(event.target)) {
        return;
    }
    toggleModulePreferencesPanel(false);
}

function handlePreferencesKeydown(event) {
    if (!isModulePreferencesOpen || event.key !== 'Escape') {
        return;
    }
    toggleModulePreferencesPanel(false);
    requestAnimationFrame(() => modulePreferencesButton?.focus());
}

function initModulePreferences() {
    moduleVisibilityState = loadModuleVisibilityState();

    const modules = Array.from(document.querySelectorAll('.module[data-module-id]'));
    let didUpdateState = false;
    modules.forEach((moduleEl) => {
        const moduleId = moduleEl.dataset.moduleId || moduleEl.getAttribute('data-module-id');
        if (!moduleId) {
            return;
        }
        if (!moduleVisibilityState.has(moduleId)) {
            moduleVisibilityState.set(moduleId, true);
            didUpdateState = true;
        }
        const storedVisible = moduleVisibilityState.get(moduleId) !== false;
        applyModuleVisibility(moduleId, storedVisible, {
            persist: false,
            updateControls: false,
            notify: false,
            skipLayoutUpdate: true
        });
    });

    modulePreferencesButton = document.getElementById('modulePreferencesButton') || modulePreferencesButton;
    modulePreferencesPanel = document.getElementById('modulePreferencesPanel') || modulePreferencesPanel;

    if (modulePreferencesButton && modulePreferencesPanel && !modulePreferencesInitialized) {
        modulePreferencesButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleModulePreferencesPanel();
        });
        modulePreferencesButton.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleModulePreferencesPanel(true);
            }
        });
        modulePreferencesPanel.addEventListener('click', (event) => event.stopPropagation());
        document.addEventListener('click', handlePreferencesDocumentClick);
        document.addEventListener('keydown', handlePreferencesKeydown);
    }

    if (modulePreferencesPanel) {
        buildModulePreferencesPanel();
    } else {
        moduleVisibilityControls.clear();
    }

    modulePreferencesInitialized = true;
    if (didUpdateState) {
        persistModuleVisibilityState();
    }
}

function initModuleGrid() {
    const container = document.getElementById('moduleGrid');
    if (!container) {
        return;
    }

    lockToggleButton = document.getElementById('layoutLockButton') || lockToggleButton;
    const initialLockState = loadLockState();
    setLayoutLocked(initialLockState, { persist: false });

    if (lockToggleButton) {
        lockToggleButton.addEventListener('click', onLockToggleButtonPressed);
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
        if (isLayoutLocked) return;
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
        if (isLayoutLocked) return;
        if (event.button !== 0) return;
        event.preventDefault();
        beginInteraction('resize', event, moduleEl, container, moduleId);
    });
}

function beginInteraction(type, event, moduleEl, container, moduleId) {
    if (isLayoutLocked) {
        return;
    }

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

    layoutState.forEach((layout, moduleId) => {
        const moduleEl = container.querySelector(`.module[data-module-id="${moduleId}"]`);
        if (moduleEl && !isModuleCurrentlyVisible(moduleEl)) {
            return;
        }
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
        const otherModuleEl = document.querySelector(`.module[data-module-id="${otherId}"]`);
        if (otherModuleEl && !isModuleCurrentlyVisible(otherModuleEl)) {
            continue;
        }
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

    const gridWidth = Math.max(Math.floor(containerBaseWidth / GRID_SIZE), MIN_GRID_W);
    const gridHeight = Math.max(Math.floor(containerBaseHeight / GRID_SIZE), MIN_GRID_H * 3);
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

function onLockToggleButtonPressed(event) {
    event.preventDefault();
    setLayoutLocked(!isLayoutLocked);
}

function setLayoutLocked(locked, { persist = true } = {}) {
    const nextState = Boolean(locked);
    const stateChanged = nextState !== isLayoutLocked;
    isLayoutLocked = nextState;

    updateLockUI();

    if (isLayoutLocked) {
        cancelActiveInteraction();
    }

    if (persist && stateChanged) {
        persistLockState(isLayoutLocked);
    }
}

function updateLockUI() {
    document.body.classList.toggle('layout-locked', isLayoutLocked);
    if (lockToggleButton) {
        lockToggleButton.dataset.locked = isLayoutLocked ? 'true' : 'false';
        lockToggleButton.textContent = isLayoutLocked ? 'Unlock Layout' : 'Lock Layout';
        lockToggleButton.setAttribute('aria-pressed', isLayoutLocked ? 'true' : 'false');
        lockToggleButton.setAttribute(
            'aria-label',
            isLayoutLocked ? 'Unlock the current layout' : 'Lock the current layout'
        );
    }
}

function loadLockState() {
    try {
        return localStorage.getItem(LOCK_STATE_KEY) === 'locked';
    } catch (error) {
        console.warn('Unable to read layout lock state', error);
        return false;
    }
}

function persistLockState(locked) {
    try {
        if (locked) {
            localStorage.setItem(LOCK_STATE_KEY, 'locked');
        } else {
            localStorage.removeItem(LOCK_STATE_KEY);
        }
    } catch (error) {
        console.warn('Unable to persist layout lock state', error);
    }
}

function cancelActiveInteraction() {
    if (!activeInteraction) {
        return;
    }

    const { moduleEl, container, moduleId, previousLayout } = activeInteraction;

    moduleEl.classList.remove('dragging');

    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUpOrCancel);
    window.removeEventListener('pointercancel', onPointerUpOrCancel);

    if (previousLayout) {
        layoutState.set(moduleId, previousLayout);
        applyLayout(moduleEl, previousLayout);
    }

    cleanupInteraction();

    if (container) {
        enforceBounds(container);
    }
}

function bootstrapModuleLayout() {
    initModulePreferences();
    initModuleGrid();
}

document.addEventListener('DOMContentLoaded', bootstrapModuleLayout);

export { initModuleGrid, applyModuleVisibility };

function calculateResponsiveDefaults(gridWidth, gridHeight) {
    const effectiveWidth = Math.max(gridWidth, MIN_GRID_W);
    const effectiveHeight = Math.max(gridHeight, MIN_GRID_H * 2);
    const largeBreakpoint = MIN_GRID_W * 3;
    const mediumBreakpoint = MIN_GRID_W * 2;

    if (effectiveWidth >= largeBreakpoint) {
        return buildLargeLayout(effectiveWidth, effectiveHeight);
    }

    if (effectiveWidth >= mediumBreakpoint) {
        return buildMediumLayout(effectiveWidth, effectiveHeight);
    }

    return buildSmallLayout(effectiveWidth, effectiveHeight);
}

function buildLargeLayout(widthUnits, heightUnits) {
    const maxSideWidth = Math.max(MIN_GRID_W, widthUnits - MIN_GRID_W);
    const sideWidth = clamp(Math.round(widthUnits * 0.26), MIN_GRID_W, maxSideWidth);
    const mainWidth = widthUnits - sideWidth;

    if (mainWidth < MIN_GRID_W) {
        return buildMediumLayout(widthUnits, heightUnits);
    }

    const mapHeight = clamp(
        Math.round(heightUnits * 0.55),
        MIN_GRID_H,
        Math.max(MIN_GRID_H, heightUnits - MIN_GRID_H)
    );
    const bookmarksHeight = Math.max(MIN_GRID_H, heightUnits - mapHeight);
    const signaturesHeight = clamp(
        Math.round(heightUnits * 0.4),
        MIN_GRID_H,
        Math.max(MIN_GRID_H, heightUnits - MIN_GRID_H)
    );
    const intelHeight = clamp(
        Math.round(heightUnits * 0.15),
        MIN_GRID_H,
        Math.max(MIN_GRID_H, heightUnits - signaturesHeight - MIN_GRID_H)
    );
    const statsHeight = Math.max(MIN_GRID_H, heightUnits - signaturesHeight - intelHeight);

    return {
        map: { x: 0, y: 0, w: mainWidth, h: mapHeight },
        bookmarks: { x: 0, y: mapHeight, w: mainWidth - 8, h: bookmarksHeight },
        routes: { x: mainWidth - 8, y: mapHeight, w: 8, h: bookmarksHeight },
        signatures: { x: mainWidth, y: 0, w: sideWidth, h: signaturesHeight },
        intel: { x: mainWidth, y: signaturesHeight, w: sideWidth, h: intelHeight },
        stats: { x: mainWidth, y: signaturesHeight + intelHeight, w: sideWidth, h: statsHeight }
    };
}

function buildMediumLayout(widthUnits, heightUnits) {
    const mapHeight = clamp(
        Math.round(heightUnits * 0.48),
        MIN_GRID_H,
        Math.max(MIN_GRID_H, heightUnits - MIN_GRID_H * 2)
    );
    const bookmarksHeight = clamp(
        Math.round(heightUnits * 0.28),
        MIN_GRID_H,
        Math.max(MIN_GRID_H, heightUnits - mapHeight - MIN_GRID_H)
    );

    const lowerY = mapHeight + bookmarksHeight;
    const bottomHeight = Math.max(MIN_GRID_H, heightUnits - lowerY);

    let leftWidth = Math.max(MIN_GRID_W, Math.floor(widthUnits / 2));
    let rightWidth = widthUnits - leftWidth;
    if (rightWidth < MIN_GRID_W) {
        rightWidth = MIN_GRID_W;
        leftWidth = Math.max(MIN_GRID_W, widthUnits - rightWidth);
    }

    const signaturesHeight = clamp(
        Math.round(bottomHeight * 0.6),
        MIN_GRID_H,
        bottomHeight
    );
    const intelHeight = clamp(
        Math.round(bottomHeight * 0.25),
        MIN_GRID_H,
        bottomHeight - signaturesHeight
    );
    const statsHeight = Math.max(MIN_GRID_H, bottomHeight - signaturesHeight - intelHeight);

    return {
        map: { x: 0, y: 0, w: widthUnits, h: mapHeight },
        bookmarks: { x: 0, y: mapHeight, w: leftWidth, h: bookmarksHeight },
        routes: { x: leftWidth, y: mapHeight, w: rightWidth, h: bookmarksHeight },
        signatures: { x: 0, y: lowerY, w: leftWidth, h: bottomHeight },
        intel: { x: leftWidth, y: lowerY, w: rightWidth, h: intelHeight },
        stats: { x: leftWidth, y: lowerY + intelHeight, w: rightWidth, h: statsHeight }
    };
}

function buildSmallLayout(widthUnits, heightUnits) {
    const mapHeight = clamp(
        Math.round(heightUnits * 0.5),
        MIN_GRID_H,
        Math.max(MIN_GRID_H, heightUnits - MIN_GRID_H * 3)
    );
    const bookmarksHeight = clamp(
        Math.round(heightUnits * 0.3),
        MIN_GRID_H,
        Math.max(MIN_GRID_H, heightUnits - mapHeight - MIN_GRID_H * 2)
    );
    const routesHeight = bookmarksHeight;

    const lowerStart = mapHeight + bookmarksHeight + routesHeight;
    const remainingHeight = Math.max(MIN_GRID_H * 2, heightUnits - lowerStart);
    const signaturesHeight = clamp(
        Math.round(remainingHeight * 0.4),
        MIN_GRID_H,
        Math.max(MIN_GRID_H, remainingHeight - MIN_GRID_H)
    );
    const intelHeight = clamp(
        Math.round(remainingHeight * 0.25),
        MIN_GRID_H,
        Math.max(MIN_GRID_H, remainingHeight - signaturesHeight - MIN_GRID_H)
    );
    const statsStart = lowerStart + signaturesHeight + intelHeight;
    const statsHeight = Math.max(MIN_GRID_H, heightUnits - statsStart);

    return {
        map: { x: 0, y: 0, w: widthUnits, h: mapHeight },
        bookmarks: { x: 0, y: mapHeight, w: widthUnits, h: bookmarksHeight },
        routes: { x: 0, y: mapHeight + bookmarksHeight, w: widthUnits, h: routesHeight },
        signatures: { x: 0, y: lowerStart, w: widthUnits, h: signaturesHeight },
        intel: { x: 0, y: lowerStart + signaturesHeight, w: widthUnits, h: intelHeight },
        stats: { x: 0, y: statsStart, w: widthUnits, h: statsHeight }
    };
}
