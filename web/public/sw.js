const CACHE_NAME = "form-coach-offline-v1";
const REQUIRED_ASSETS = [
  ".",
  "index.html",
  ".vite/manifest.json",
  "models/pose_landmarker_full.task",
  "wasm/vision_wasm_internal.js",
  "wasm/vision_wasm_internal.wasm",
  "wasm/vision_wasm_nosimd_internal.js",
  "wasm/vision_wasm_nosimd_internal.wasm",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const scope = self.registration.scope;
    const manifestResponse = await fetch(new URL(".vite/manifest.json", scope));
    if (!manifestResponse.ok) {
      throw new Error(`Could not load the offline asset manifest (${manifestResponse.status}).`);
    }

    const manifest = await manifestResponse.json();
    const assets = new Set(REQUIRED_ASSETS.map((path) => new URL(path, scope).href));
    const pending = Object.values(manifest);
    while (pending.length) {
      const entry = pending.pop();
      if (!entry) continue;
      assets.add(new URL(entry.file, scope).href);
      for (const path of entry.css ?? []) assets.add(new URL(path, scope).href);
      for (const path of entry.assets ?? []) assets.add(new URL(path, scope).href);
      for (const key of [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]) {
        if (manifest[key]) pending.push(manifest[key]);
      }
    }

    await cache.addAll([...assets].map((url) => new Request(url, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith("form-coach-offline-") && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request, { ignoreVary: true });
    if (cached) return cached;

    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      if (event.request.mode === "navigate") {
        const offlinePage = await cache.match(
          new URL("index.html", self.registration.scope), { ignoreVary: true });
        if (offlinePage) return offlinePage;
      }
      throw error;
    }
  })());
});
