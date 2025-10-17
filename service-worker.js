const CACHE_NAME = 'bookmark-mapper-cache-v14';
const ASSET_PATHS = [
    '.',
    'index.html',
    'css/styles.css',
    'js/db.js',
    'js/table.js',
    'js/clipboard.js',
    'js/loadSystemsData.js',
    'js/utils.js',
    'js/main.js',
    'js/map.js',
    'js/modules/map/buildSystemTag.js',
    'js/modules/map/displayMap.js',
    'js/modules/map/dragHandlers.js',
    'js/modules/map/extractSystems.js',
    'data/systems.json',
    'assets/icons/icon-192x192.png',
    'assets/icons/icon-512x512.png',
    'assets/images/help.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                const urlsToCache = ASSET_PATHS.map(path => new URL(path, self.registration.scope).toString());
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
