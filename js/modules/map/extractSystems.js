
export function extractSystems(label, sol) {
    const labelParts = label.split(' ');
    if (labelParts.length >= 3) {
        const systemFrom = sol.trim();
        const systemToParts = labelParts.slice(2);
        const systemTo = systemToParts.join(' ').trim();
        return [systemFrom, systemTo || null];
    }
    return [null, null];
}