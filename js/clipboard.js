async function readClipboardAndDisplayTable() {
    const header = "Label, Type, Jumps, SOL, CON, REG, Date, Expiry, Creator";
    displayErrorMessage(''); // Clear any previous error message
    try {
        const data = await navigator.clipboard.readText();
        const keys = header.split(',').map(key => key.trim());
        const lines = data.split('\n').filter(line => line.trim() !== '');
        const parsedData = lines.map(line => {
            const values = line.split('\t');
            const obj = {};
            keys.forEach((key, index) => {
                obj[key] = values[index] ? values[index].trim() : null;
            });
            return obj;
        }).filter(row => {
            return !row['Label'].startsWith('/') && row['Type']; // Exclude bookmarks that start with "/" and those with empty "Type"
        });

        if (parsedData.length === 0) {
            throw new Error('Clipboard data is not in the proper bookmark format.');
        }

        const db = await dbPromise;
        const timestamp = new Date().toISOString();
        await db.add('versions', { timestamp, data: parsedData });

        const preservedSelectionCandidates = [
            window.__bookmarkViewerSelectedSystem,
            typeof window.getMapSelectedSystem === 'function' ? window.getMapSelectedSystem() : null,
            typeof window.getCurrentTableFilter === 'function' ? window.getCurrentTableFilter() : null
        ];
        const preservedSelection = preservedSelectionCandidates.find((candidate) => {
            return typeof candidate === 'string' && candidate.trim().length > 0;
        }) || null;
        const normalizedSelection = preservedSelection ? preservedSelection.trim() : null;
        const matchingSelectionRow = normalizedSelection
            ? parsedData.find((row) => {
                if (!row || row['SOL'] === undefined || row['SOL'] === null) {
                    return false;
                }
                const systemName = row['SOL'].toString().trim();
                return systemName.toLowerCase() === normalizedSelection.toLowerCase();
            })
            : null;
        const selectionToRestore = matchingSelectionRow
            ? matchingSelectionRow['SOL'].toString().trim()
            : null;

        window.__bookmarkViewerSelectedSystem = selectionToRestore || null;

        displayTable(keys, parsedData, selectionToRestore);
        displayMap(parsedData, { preserveSelection: Boolean(selectionToRestore) });

        updateTimestampDisplay(timestamp);
        displayErrorMessage(''); // Clear any previous error message
    } catch (error) {
        console.error('Error reading clipboard data:', error);
        displayErrorMessage('Failed to read clipboard data. Ensure you have copied a table in the correct format.');
    }
}

function displayErrorMessage(message) {
    const errorContainer = document.getElementById('errorContainer');
    errorContainer.textContent = message;
    if (message) {
        errorContainer.classList.add('visible');
        setTimeout(() => {
            errorContainer.textContent = '';
            errorContainer.classList.remove('visible');
        }, 7000);
    } else {
        errorContainer.classList.remove('visible');
    }
}

window.readClipboardAndDisplayTable = readClipboardAndDisplayTable;
