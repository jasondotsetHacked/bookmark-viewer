
export function extractSystems(label, sol) {
    const labelParts = label.split(' ');
    if (labelParts.length >= 3) {
        const systemFrom = sol.trim();
        const systemTo = labelParts[2].trim();
        return [systemFrom, systemTo !== '?' ? systemTo : null];
    }
    return [null, null];
}