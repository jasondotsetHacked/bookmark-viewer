const INTEL_DATA_KEY = 'systemIntel:notes:v1';

const intelState = {
    notes: new Map(),
    currentSystem: null,
    saveTimer: null
};

const intelDom = {
    textarea: null,
    statusLabel: null
};

document.addEventListener('DOMContentLoaded', initSystemIntelModule);

function initSystemIntelModule() {
    intelDom.textarea = document.getElementById('intelTextarea');
    intelDom.statusLabel = document.getElementById('intelActiveSystem');

    if (!intelDom.textarea) {
        console.warn('System Intel module elements missing from DOM');
        return;
    }

    intelState.notes = loadIntelNotes();
    intelDom.textarea.addEventListener('input', handleIntelInput);

    updateIntelUI();
}

function loadIntelNotes() {
    try {
        const raw = localStorage.getItem(INTEL_DATA_KEY);
        if (!raw) {
            return new Map();
        }
        const parsed = JSON.parse(raw);
        const map = new Map();
        Object.entries(parsed).forEach(([system, note]) => {
            if (typeof note === 'string') {
                map.set(system, note);
            }
        });
        return map;
    } catch (error) {
        console.warn('Failed to load intel notes', error);
        return new Map();
    }
}

function persistIntelNotes() {
    try {
        const payload = {};
        intelState.notes.forEach((note, system) => {
            payload[system] = note;
        });
        localStorage.setItem(INTEL_DATA_KEY, JSON.stringify(payload));
    } catch (error) {
        console.warn('Failed to persist intel notes', error);
    }
}

function handleIntelInput(event) {
    if (!intelState.currentSystem) {
        event.target.value = '';
        return;
    }
    if (intelState.saveTimer) {
        clearTimeout(intelState.saveTimer);
    }
    const system = intelState.currentSystem;
    const value = event.target.value;
    intelState.saveTimer = setTimeout(() => {
        if (system) {
            intelState.notes.set(system, value);
            persistIntelNotes();
        }
        intelState.saveTimer = null;
    }, 400);
}

function setSystemIntelActiveSystem(systemName) {
    commitIntelDraft();
    intelState.currentSystem = systemName || null;
    updateIntelUI();
}

function updateIntelUI() {
    const system = intelState.currentSystem;

    if (intelDom.statusLabel) {
        intelDom.statusLabel.textContent = system ? `System: ${system}` : 'No system selected';
    }

    if (!intelDom.textarea) {
        return;
    }

    if (!system) {
        intelDom.textarea.value = '';
        intelDom.textarea.disabled = true;
        intelDom.textarea.style.display = 'none';
        return;
    }

    const note = intelState.notes.get(system) || '';
    intelDom.textarea.style.display = 'block';
    intelDom.textarea.disabled = false;
    intelDom.textarea.value = note;
}

function commitIntelDraft() {
    if (!intelState.currentSystem || !intelDom.textarea) {
        return;
    }
    if (intelState.saveTimer) {
        clearTimeout(intelState.saveTimer);
        intelState.saveTimer = null;
    }
    const value = intelDom.textarea.value;
    intelState.notes.set(intelState.currentSystem, value);
    persistIntelNotes();
}

window.setSystemIntelActiveSystem = setSystemIntelActiveSystem;
