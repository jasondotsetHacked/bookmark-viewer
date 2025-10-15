const CACHE_NAME = 'bookmark-mapper-cache-v4';
const urlsToCache = [
    '/bookmark-viewer/index.html',
    '/bookmark-viewer/css/styles.css',
    '/bookmark-viewer/js/db.js',
    '/bookmark-viewer/js/table.js',
    '/bookmark-viewer/js/clipboard.js',
    '/bookmark-viewer/js/loadSystemsData.js',
    '/bookmark-viewer/js/utils.js',
    '/bookmark-viewer/js/main.js',
    '/bookmark-viewer/js/map.js',
    '/bookmark-viewer/js/modules/map/buildSystemTag.js',
    '/bookmark-viewer/js/modules/map/dragHandlers.js',
    '/bookmark-viewer/js/modules/map/extractSystems.js',
    '/bookmark-viewer/data/systems.json',
    '/bookmark-viewer/assets/icons/icon-192x192.png',
    '/bookmark-viewer/assets/icons/icon-512x512.png',
    '/bookmark-viewer/assets/video/help.mp4'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
    );
});

self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (!cacheWhitelist.includes(cacheName)) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});