import { displayMap, filterBookmarksBySystem } from './modules/map/displayMap.js';

console.log('main.js module is being executed');
window.mainJsLoaded = true;

console.log('Main script loaded');

document.getElementById('readClipboardButton').addEventListener('click', () => {
    console.log('Read Clipboard Button Clicked');
    readClipboardAndDisplayTable();
});

document.getElementById('clearDBButton').addEventListener('click', () => {
    console.log('Clear DB Button Clicked');
    clearDatabase();
});

document.getElementById('prevVersionButton').addEventListener('click', () => {
    console.log('Previous Version Button Clicked');
    navigateVersion('prev');
});

document.getElementById('nextVersionButton').addEventListener('click', () => {
    console.log('Next Version Button Clicked');
    navigateVersion('next');
});

document.getElementById('helpButton').addEventListener('click', () => {
    document.getElementById('helpModal').style.display = 'block';
});

document.getElementById('closeModal').addEventListener('click', () => {
    document.getElementById('helpModal').style.display = 'none';
});

document.getElementById('discordButton').addEventListener('click', () => {
    window.open('https://discord.gg/sAekUas5JN', '_blank');
});

window.addEventListener('click', (event) => {
    if (event.target === document.getElementById('helpModal')) {
        document.getElementById('helpModal').style.display = 'none';
    }
});

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded');
    loadDataAndDisplay();
});

async function loadDataAndDisplay() {
    const data = await getDataFromDB();
    displayTable(['Label', 'Type', 'Jumps', 'SOL', 'CON', 'REG', 'Date', 'Expiry', 'Creator'], data);
    displayMap(data);
}

window.filterBookmarksBySystem = filterBookmarksBySystem;