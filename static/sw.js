const CACHE_NAME = 'ikms-pwa-v22';
const ASSETS = [
    '/',
    '/static/styles.css',
    '/static/script.js',
    '/static/manifest.json',
    '/static/icon-192x192.png',
    '/static/icon-512x512.png'
];

// Install event: cache basic assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                // We use addAll but catch errors so it doesn't fail the SW installation if an asset is missing
                return cache.addAll(ASSETS).catch(err => console.warn('SW cache addAll error', err));
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event: Network first, fallback to cache for HTML, Cache first for statics
self.addEventListener('fetch', (event) => {
    // Only intercept basic GET requests
    if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;
    
    // API calls bypass cache
    if (event.request.url.includes('/api/')) {
        return; 
    }

    event.respondWith(
        caches.match(event.request)
            .then((cachedResponse) => {
                // If we found it in the cache, and it's a static file, we can return it immediately
                if (cachedResponse && event.request.url.includes('/static/')) {
                    // Update cache in the background (Stale-While-Revalidate)
                    fetch(event.request).then(response => {
                        if (response.ok) {
                            caches.open(CACHE_NAME).then(cache => cache.put(event.request, response));
                        }
                    }).catch(() => {});
                    return cachedResponse;
                }
                
                // Otherwise fetch from network
                return fetch(event.request)
                    .then((response) => {
                        // Cache successful responses for future
                        if (response && response.status === 200 && response.type === 'basic') {
                            const responseToCache = response.clone();
                            caches.open(CACHE_NAME)
                                .then((cache) => {
                                    cache.put(event.request, responseToCache);
                                });
                        }
                        return response;
                    })
                    .catch(() => {
                        // If offline and request is for navigation, return cached root
                        if (event.request.mode === 'navigate') {
                            return caches.match('/');
                        }
                        return cachedResponse;
                    });
            })
    );
});
