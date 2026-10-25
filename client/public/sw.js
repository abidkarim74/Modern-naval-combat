const CACHE_NAME = "naval-combat-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.add(OFFLINE_URL)));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(names => Promise.all(
    names.filter(name => name.startsWith("naval-combat-offline-") && name !== CACHE_NAME)
      .map(name => caches.delete(name)),
  )));
});

// Always load the current game from the network. Only failed page navigations
// use the small offline screen; game bundles, audio and API calls are untouched.
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate"
    || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(OFFLINE_URL) ?? Response.error();
  }));
});
