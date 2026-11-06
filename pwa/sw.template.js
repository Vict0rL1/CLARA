/*
 * Service worker de Clara (generado en cada `npm run build`).
 * - Guarda en caché la app completa de ESTA versión para usarla sin conexión.
 * - Sirve siempre desde la caché de su versión (coherencia entre HTML y archivos).
 * - Una versión nueva se instala en segundo plano y la app muestra «Actualizar».
 * - Nunca guarda datos financieros: esos viven en IndexedDB (localStorage solo como respaldo).
 */
const VERSION = '__VERSION__'
// Prefijo con el nombre anterior («Margen») para limpiar también las cachés ya instaladas.
const CACHE = `margen-${VERSION}`
const PRECACHE = __PRECACHE__

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k.startsWith('margen-') && k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // La app usa rutas con # (hash), así que toda navegación es la página principal.
  const key = request.mode === 'navigate' ? '/' : request
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // Cada URL de la caché es un archivo fijo de ESTA versión: no depende de cabeceras como
      // `Origin`. Sin `ignoreVary`, una respuesta con `Vary: Origin` no coincide cuando el navegador
      // añade `Origin` a un import() (Chromium 153) y, sin conexión, la pantalla no abriría.
      // Un paquete de texto (`/assets/*.json`, con huella de contenido en el nombre) pedido con una marca de reintento
      // (`?retry=n`) es el mismo archivo: se sirve el precacheado, también sin conexión (auditoría del 2026-11-04, B11).
      const pack = url.pathname.startsWith('/assets/') && url.pathname.endsWith('.json')
      const hit = await cache.match(key, { ignoreVary: true, ignoreSearch: pack })
      if (hit) return hit
      const response = await fetch(request)
      // Una dirección marcada no se guarda: el archivo sin marca ya está (o estará) en la caché de esta versión.
      if (response.ok && request.mode !== 'navigate' && !(pack && url.search)) cache.put(request, response.clone())
      return response
    }),
  )
})
