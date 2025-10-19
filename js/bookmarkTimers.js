const TIMER_INTERVAL_MS = 1000;
const DEFAULT_TIMER_OPTIONS = {
    style: 'default',
    infinitySymbol: '∞',
    expiredText: 'Expired',
    unknownText: '—',
    tag: null,
    showTitle: true,
    formatter: null,
    onExpire: null,
    onUpdate: null
};

const activeTimers = new Set();
let tickerHandle = null;

export const TIMER_TAGS = {
    TABLE: 'bookmark-table',
    MAP: 'map-nodes'
};

export function parseBookmarkExpiry(rawValue) {
    if (rawValue === undefined || rawValue === null) {
        return buildExpiryInfo('unknown', null, rawValue);
    }

    const trimmed = rawValue.toString().trim();
    if (!trimmed) {
        return buildExpiryInfo('unknown', null, rawValue);
    }

    const normalizedLower = trimmed.toLowerCase();
    const infinitePatterns = [
        /\bnever\b/,
        /\bno\s*(?:expiry|expiration)\b/,
        /\bdoes\s+not\s+expire\b/,
        /\bnon[-\s]?expiring\b/,
        /\bperma?n[ae]?nt\b/,
        /\bperm\b/,
        /\bperma\b/,
        /\bforever\b/,
        /\binfinite\b/,
        /\binfinity\b/
    ];

    const hasInfinitySymbol = trimmed.includes('∞');
    const matchesInfinity = hasInfinitySymbol || infinitePatterns.some((pattern) => pattern.test(normalizedLower));

    if (matchesInfinity) {
        return buildExpiryInfo('infinite', null, rawValue);
    }

    if (/^[-–—]+$/.test(trimmed)) {
        return buildExpiryInfo('infinite', null, rawValue);
    }

    const sanitized = trimmed
        .replace(/\b(utc|eve|et|expires?)/gi, '')
        .replace(/[.]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();

    let timestamp = Number.isFinite(Number(sanitized)) ? Number(sanitized) : NaN;

    if (Number.isNaN(timestamp)) {
        const isoMatch = sanitized.match(/^(\d{4})[-](\d{2})[-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (isoMatch) {
            const [, year, month, day, hour, minute, second] = isoMatch;
            const isoString = `${year}-${month}-${day}T${hour}:${minute}:${second || '00'}Z`;
            timestamp = Date.parse(isoString);
        } else {
            timestamp = Date.parse(sanitized);
        }
    }

    if (Number.isNaN(timestamp)) {
        return buildExpiryInfo('unknown', null, rawValue);
    }

    return buildExpiryInfo('timestamp', timestamp, rawValue);
}

export function getRowExpiry(row) {
    if (!row || typeof row !== 'object') {
        return buildExpiryInfo('unknown', null, null);
    }
    if (row.__bookmarkExpiryInfo) {
        return row.__bookmarkExpiryInfo;
    }
    const info = parseBookmarkExpiry(row['Expiry']);
    Object.defineProperty(row, '__bookmarkExpiryInfo', {
        value: info,
        writable: true,
        configurable: true,
        enumerable: false
    });
    return info;
}

export function formatDuration(remainingMs, style = 'default') {
    const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (style === 'compact') {
        if (days > 0) {
            return `${days}d ${hours}h`;
        }
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        }
        return `${seconds}s`;
    }

    if (days > 0) {
        const paddedHours = hours.toString().padStart(2, '0');
        const paddedMinutes = minutes.toString().padStart(2, '0');
        return `${days}d ${paddedHours}:${paddedMinutes}`;
    }

    const paddedHours = hours.toString().padStart(2, '0');
    const paddedMinutes = minutes.toString().padStart(2, '0');
    const paddedSeconds = seconds.toString().padStart(2, '0');

    if (hours > 0) {
        return `${paddedHours}:${paddedMinutes}:${paddedSeconds}`;
    }
    return `${paddedMinutes}:${paddedSeconds}`;
}

export function attachCountdown(element, expiryInfo, options = {}) {
    if (!element) {
        return null;
    }

    const mergedOptions = { ...DEFAULT_TIMER_OPTIONS, ...options };
    const info = expiryInfo || buildExpiryInfo('unknown', null, null);

    if (info.type === 'infinite') {
        element.textContent = mergedOptions.infinitySymbol;
        if (mergedOptions.showTitle) {
            element.title = 'Never expires';
        }
        if (typeof mergedOptions.onUpdate === 'function') {
            mergedOptions.onUpdate(element, {
                remaining: null,
                expired: false,
                info,
                options: mergedOptions
            });
        }
        return null;
    }

    if (info.type !== 'timestamp' || !Number.isFinite(info.timestamp)) {
        element.textContent = mergedOptions.unknownText;
        if (!mergedOptions.showTitle) {
            element.removeAttribute('title');
        } else if (info.rawValue) {
            element.title = info.rawValue;
        }
        if (typeof mergedOptions.onUpdate === 'function') {
            mergedOptions.onUpdate(element, {
                remaining: null,
                expired: false,
                info,
                options: mergedOptions
            });
        }
        return null;
    }

    const entry = {
        element,
        expiry: info.timestamp,
        options: mergedOptions,
        expiredNotified: false
    };

    activeTimers.add(entry);
    ensureTicker();
    updateTimerEntry(entry, Date.now());
    return () => removeTimerEntry(entry);
}

export function clearCountdowns(tag = null) {
    if (tag === null) {
        activeTimers.clear();
    } else {
        for (const entry of Array.from(activeTimers)) {
            if (entry.options.tag === tag) {
                activeTimers.delete(entry);
            }
        }
    }
    if (!activeTimers.size && tickerHandle) {
        clearInterval(tickerHandle);
        tickerHandle = null;
    }
}

function buildExpiryInfo(type, timestamp, rawValue) {
    return {
        type,
        timestamp,
        rawValue
    };
}

function ensureTicker() {
    if (tickerHandle !== null) {
        return;
    }
    tickerHandle = setInterval(() => runTimerTick(Date.now()), TIMER_INTERVAL_MS);
}

function runTimerTick(now) {
    for (const entry of Array.from(activeTimers)) {
        const { element } = entry;
        if (!element || !element.isConnected) {
            removeTimerEntry(entry);
            continue;
        }
        updateTimerEntry(entry, now);
    }
    if (!activeTimers.size && tickerHandle) {
        clearInterval(tickerHandle);
        tickerHandle = null;
    }
}

function updateTimerEntry(entry, now) {
    const { element, expiry, options } = entry;
    if (!element) {
        return;
    }

    const remaining = expiry - now;
    let textContent;

    if (remaining <= 0) {
        textContent = options.expiredText;
        if (!entry.expiredNotified && typeof options.onExpire === 'function') {
            entry.expiredNotified = true;
            options.onExpire(element, entry);
        }
    } else if (typeof options.formatter === 'function') {
        textContent = options.formatter(remaining, entry);
    } else {
        textContent = formatDuration(remaining, options.style);
    }

    element.textContent = textContent;
    if (options.showTitle) {
        element.title = new Date(expiry).toLocaleString();
    }
    if (typeof options.onUpdate === 'function') {
        options.onUpdate(element, {
            remaining: Math.max(0, remaining),
            expired: remaining <= 0,
            entry
        });
    }
}

function removeTimerEntry(entry) {
    activeTimers.delete(entry);
    if (!activeTimers.size && tickerHandle) {
        clearInterval(tickerHandle);
        tickerHandle = null;
    }
}
