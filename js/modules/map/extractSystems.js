const FLAG_TOKENS = new Set(['VEOL', 'EOL', 'CRIT', 'HALF', 'STABLE']);
// Sort longest-first so substrings don't pre-empt longer flag names.
const FLAG_PATTERN = Array.from(FLAG_TOKENS)
    .sort((a, b) => b.length - a.length)
    .join('|');
// Matches trailing status markers like "| EOL" or "& CRIT" at the end of a label.
const TRAILING_FLAGS_REGEX = new RegExp(`(?:\\s*(?:[|&]\\s*)?(?:${FLAG_PATTERN})\\b)+$`, 'i');
const TRAILING_CONNECTOR_REGEX = /\s*[|&]\s*$/;

export function extractSystems(label, sol) {
    if (typeof label !== 'string') {
        return [null, null];
    }

    const labelParts = label.trim().split(/\s+/).filter(Boolean);
    if (labelParts.length < 3) {
        return [null, null];
    }

    const systemFromRaw = sol ?? '';
    const systemFrom = systemFromRaw.toString().trim();
    if (!systemFrom) {
        return [null, null];
    }

    const systemToParts = labelParts.slice(2);
    const systemToRaw = systemToParts.join(' ').trim();
    if (!systemToRaw) {
        return [systemFrom, null];
    }

    let cleanedTarget = systemToRaw.replace(TRAILING_FLAGS_REGEX, '').trim();
    if (TRAILING_CONNECTOR_REGEX.test(cleanedTarget)) {
        cleanedTarget = cleanedTarget.replace(TRAILING_CONNECTOR_REGEX, '').trim();
    }

    if (!cleanedTarget) {
        return [systemFrom, null];
    }

    return [systemFrom, cleanedTarget];
}
