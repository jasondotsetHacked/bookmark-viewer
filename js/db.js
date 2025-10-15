const dbPromise = idb.openDB('clipboardData', 2, {
    upgrade(db, oldVersion) {
        if (oldVersion < 1) {
            db.createObjectStore('data', { keyPath: 'id', autoIncrement: true });
        }
        if (oldVersion < 2) {
            db.createObjectStore('versions', { keyPath: 'timestamp' });
        }
    }
});

async function getDataFromDB(versionTimestamp = null) {
    const db = await dbPromise;
    if (versionTimestamp) {
        const version = await db.get('versions', versionTimestamp);
        return version ? version.data : [];
    } else {
        const versions = await db.getAll('versions');
        return versions.length > 0 ? versions[versions.length - 1].data : [];
    }
}

async function clearDatabase() {
    const db = await dbPromise;
    await db.clear('data');
    await db.clear('versions');
    const tableContainer = document.getElementById('tableContainer');
    const mapContainer = document.getElementById('mapContainer');
    tableContainer.innerHTML = '';
    mapContainer.innerHTML = '';
    document.getElementById('timestampDisplay').textContent = 'Data Timestamp: ';
    if (typeof window.updateBookmarkSignatureMatches === 'function') {
        window.updateBookmarkSignatureMatches(new Map());
    }
    if (typeof window.setSignatureBookmarkData === 'function') {
        window.setSignatureBookmarkData([]);
    }
    if (typeof window.setSignatureActiveSystem === 'function') {
        window.setSignatureActiveSystem(null, []);
    }
}

async function saveDataToDB(parsedData) {
    const db = await dbPromise;
    const timestamp = new Date().toISOString();
    await db.add('versions', { timestamp, data: parsedData });
}

window.dbPromise = dbPromise;
window.getDataFromDB = getDataFromDB;
window.clearDatabase = clearDatabase;
window.saveDataToDB = saveDataToDB;
