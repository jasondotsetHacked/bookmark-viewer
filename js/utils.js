import { displayMap } from './modules/map/displayMap.js';

const options = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short'
};

function updateTimestampDisplay(timestamp) {
    const timestampDisplay = document.getElementById('timestampDisplay');
    const date = new Date(timestamp);
    const formattedTimestamp = date.toLocaleString('en-US', options);
    timestampDisplay.textContent = `Data Timestamp: ${formattedTimestamp}`;
}

async function loadDataAndDisplay(versionTimestamp = null) {
    const data = await getDataFromDB(versionTimestamp);
    if (data.length > 0) {
        const keys = ["Label", "Type", "Jumps", "SOL", "CON", "REG", "Date", "Expiry", "Creator"];
        displayTable(keys, data);
        displayMap(data);
        if (versionTimestamp) {
            updateTimestampDisplay(versionTimestamp);
        } else {
            const db = await dbPromise;
            const versions = await db.getAll('versions');
            if (versions.length > 0) {
                updateTimestampDisplay(versions[versions.length - 1].timestamp);
            }
        }
    }
}

async function navigateVersion(direction) {
    const db = await dbPromise;
    const versions = await db.getAll('versions');
    if (versions.length > 0) {
        const currentTimestamp = document.getElementById('timestampDisplay').textContent.split(': ')[1];
        let currentIndex = versions.findIndex(version => new Date(version.timestamp).toLocaleString('en-US', options) === currentTimestamp);
        if (direction === 'prev' && currentIndex > 0) {
            currentIndex--;
        } else if (direction === 'next' && currentIndex < versions.length - 1) {
            currentIndex++;
        }
        const newTimestamp = versions[currentIndex].timestamp;
        loadDataAndDisplay(newTimestamp);
    }
}

window.updateTimestampDisplay = updateTimestampDisplay;
window.loadDataAndDisplay = loadDataAndDisplay;
window.navigateVersion = navigateVersion;
