const INTEL_DATA_KEY = 'systemIntel:notes:v1';
const INTEL_NICKNAME_KEY = 'systemIntel:nicknames:v1';

let nicknamesLoaded = false;

const intelState = {
    notes: new Map(),
    nicknames: new Map(),
    currentSystem: null,
    noteSaveTimer: null,
    nicknameSaveTimer: null
};

const intelDom = {
    textarea: null,
    statusLabel: null,
    nicknameInput: null
};

document.addEventListener('DOMContentLoaded', initSystemIntelModule);
window.addEventListener('beforeunload', () => {
    commitIntelDraft();
    commitNicknameDraft();
});

function initSystemIntelModule() {
    intelDom.textarea = document.getElementById('intelTextarea');
    intelDom.statusLabel = document.getElementById('intelActiveSystem');
    intelDom.nicknameInput = document.getElementById('intelNicknameInput');

    if (!intelDom.textarea || !intelDom.statusLabel || !intelDom.nicknameInput) {
        console.warn('System Intel module elements missing from DOM');
        return;
    }

    intelState.notes = loadIntelNotes();
    intelState.nicknames = loadIntelNicknames();
    nicknamesLoaded = true;

    intelDom.textarea.addEventListener('input', handleIntelInput);
    intelDom.nicknameInput.addEventListener('input', handleNicknameInput);
    intelDom.nicknameInput.addEventListener('blur', commitNicknameDraft);

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

function loadIntelNicknames() {
    try {
        const raw = localStorage.getItem(INTEL_NICKNAME_KEY);
        if (!raw) {
            return new Map();
        }
        const parsed = JSON.parse(raw);
        const map = new Map();
        Object.entries(parsed).forEach(([system, nickname]) => {
            if (typeof nickname === 'string' && nickname.trim().length > 0) {
                map.set(system, nickname);
            }
        });
        return map;
    } catch (error) {
        console.warn('Failed to load intel nicknames', error);
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

function persistIntelNicknames() {
    try {
        const payload = {};
        intelState.nicknames.forEach((nickname, system) => {
            payload[system] = nickname;
        });
        localStorage.setItem(INTEL_NICKNAME_KEY, JSON.stringify(payload));
    } catch (error) {
        console.warn('Failed to persist intel nicknames', error);
    }
}

function handleIntelInput(event) {
    if (!intelState.currentSystem) {
        event.target.value = '';
        return;
    }
    if (intelState.noteSaveTimer) {
        clearTimeout(intelState.noteSaveTimer);
    }
    const system = intelState.currentSystem;
    const value = event.target.value;
    intelState.noteSaveTimer = setTimeout(() => {
        if (system) {
            intelState.notes.set(system, value);
            persistIntelNotes();
        }
        intelState.noteSaveTimer = null;
    }, 400);
}

function handleNicknameInput(event) {
    if (!intelState.currentSystem) {
        event.target.value = '';
        return;
    }
    if (intelState.nicknameSaveTimer) {
        clearTimeout(intelState.nicknameSaveTimer);
    }
    const system = intelState.currentSystem;
    const value = event.target.value;
    intelState.nicknameSaveTimer = setTimeout(() => {
        saveNickname(system, value);
        intelState.nicknameSaveTimer = null;
    }, 300);
}

function saveNickname(system, rawValue) {
    if (!system) {
        return;
    }
    const trimmed = rawValue.trim();
    const previous = intelState.nicknames.get(system) || '';
    const hadPreviousEntry = intelState.nicknames.has(system);

    if (trimmed) {
        intelState.nicknames.set(system, trimmed);
    } else {
        intelState.nicknames.delete(system);
    }

    const changed = trimmed !== previous || (!trimmed && hadPreviousEntry);

    if (!changed) {
        if (intelDom.nicknameInput && intelDom.nicknameInput.value !== trimmed) {
            intelDom.nicknameInput.value = trimmed;
        }
        return;
    }

    persistIntelNicknames();

    if (intelDom.nicknameInput && intelDom.nicknameInput.value !== trimmed) {
        intelDom.nicknameInput.value = trimmed;
    }

    updateIntelUI();
    dispatchNicknameUpdate(system, trimmed);
}

function setSystemIntelActiveSystem(systemName) {
    commitIntelDraft();
    commitNicknameDraft();
    intelState.currentSystem = systemName || null;
    updateIntelUI();
}

function updateIntelUI() {
    const system = intelState.currentSystem;
    const nickname = system ? getSystemNickname(system) : '';

    if (intelDom.statusLabel) {
        intelDom.statusLabel.textContent = system
            ? `System: ${system}${nickname ? ` (Nickname: "${nickname}")` : ''}`
            : 'No system selected';
    }

    if (intelDom.nicknameInput) {
        if (!system) {
            intelDom.nicknameInput.value = '';
            intelDom.nicknameInput.disabled = true;
            intelDom.nicknameInput.placeholder = 'Select a system to add a nickname';
        } else {
            intelDom.nicknameInput.disabled = false;
            intelDom.nicknameInput.value = nickname;
            intelDom.nicknameInput.placeholder = 'Set a nickname for this system...';
        }
    }

    if (!intelDom.textarea) {
        return;
    }

    if (!system) {
        if (intelState.noteSaveTimer) {
            clearTimeout(intelState.noteSaveTimer);
            intelState.noteSaveTimer = null;
        }
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
    if (intelState.noteSaveTimer) {
        clearTimeout(intelState.noteSaveTimer);
        intelState.noteSaveTimer = null;
    }
    const value = intelDom.textarea.value;
    intelState.notes.set(intelState.currentSystem, value);
    persistIntelNotes();
}

function commitNicknameDraft() {
    if (!intelState.currentSystem || !intelDom.nicknameInput) {
        return;
    }
    if (intelState.nicknameSaveTimer) {
        clearTimeout(intelState.nicknameSaveTimer);
        intelState.nicknameSaveTimer = null;
    }
    saveNickname(intelState.currentSystem, intelDom.nicknameInput.value);
}

function getSystemNickname(systemName) {
    if (!systemName) {
        return '';
    }
    if (!nicknamesLoaded) {
        intelState.nicknames = loadIntelNicknames();
        nicknamesLoaded = true;
    }
    return intelState.nicknames.get(systemName) || '';
}

function dispatchNicknameUpdate(system, nickname) {
    window.dispatchEvent(new CustomEvent('systemNicknameUpdated', {
        detail: {
            system,
            nickname: nickname || null
        }
    }));
}

window.setSystemIntelActiveSystem = setSystemIntelActiveSystem;
window.getSystemNickname = getSystemNickname;
