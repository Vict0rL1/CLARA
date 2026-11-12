/**
 * Registro del service worker (solo en la versión compilada y en contexto seguro:
 * https o localhost). Avisa cuando hay una versión nueva lista para instalar.
 *
 * Nunca se recarga sola: solo la pestaña donde la persona pulsó «Actualizar» se recarga.
 * Si la versión nueva se activó desde OTRA pestaña, aquí solo se avisa (puede haber un
 * formulario a medias) y se pide recargar cuando convenga.
 */
import { useSyncExternalStore } from 'react'
import { isNativeIOS } from '../platform'

type PwaState = {
  offlineReady: boolean
  update: (() => void) | null
  /** Otra pestaña activó una versión nueva: esta sigue con la anterior hasta recargar. */
  reloadNeeded: boolean
}

// En la app de iPhone los archivos van dentro de la app: abre sin conexión sin service worker (WKWebView no lo ofrece).
let state: PwaState = { offlineReady: isNativeIOS(), update: null, reloadNeeded: false }
const listeners = new Set<() => void>()

function set(next: Partial<PwaState>) {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

export function usePwaState(): PwaState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** Estado actual (para pruebas). */
export function getPwaState(): PwaState {
  return state
}

export function registerServiceWorker() {
  // En la app de iPhone no hay service worker ni aviso «Actualizar ahora»: los archivos van dentro de la app y una
  // versión nueva llega al reinstalarla desde Xcode.
  if (isNativeIOS()) return
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return
  const start = () => void connect(navigator.serviceWorker, () => window.location.reload())
  // Si la página terminó de cargar antes de llegar aquí, «load» ya no llegará.
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
}

/**
 * Conecta la página con su service worker. «Uso sin conexión: activo» sale de lo que de verdad
 * permite abrir sin red: una página ya controlada o un service worker activo. No depende de que
 * `register()` responda: sin conexión puede fallar al buscar una versión nueva.
 */
export async function connect(container: ServiceWorkerContainer, reload: () => void) {
  // ¿Esta pestaña ya estaba controlada por una versión anterior? En la primera visita
  // la activación (clients.claim) también dispara «controllerchange» y no es una versión nueva.
  const hadController = !!container.controller
  if (hadController) set({ offlineReady: true })
  container.ready.then(
    (registration) => {
      if (registration.active) set({ offlineReady: true })
    },
    () => {},
  )
  try {
    const registration = await container.register('/sw.js')
    let requested = false
    const offer = (worker: ServiceWorker) =>
      set({
        update: () => {
          requested = true
          worker.postMessage('skipWaiting')
        },
      })
    /** Sigue a una versión que se está instalando hasta que quede lista (o falle). */
    const track = (worker: ServiceWorker | null) => {
      if (!worker) return
      const check = () => {
        if (worker.state !== 'installed') return
        if (container.controller) offer(worker)
        else set({ offlineReady: true })
      }
      worker.addEventListener('statechange', check)
      check()
    }
    if (registration.waiting && container.controller) offer(registration.waiting)
    // La comprobación de versión empieza al navegar: puede estar instalándose ya.
    track(registration.installing)
    registration.addEventListener('updatefound', () => track(registration.installing))
    if (registration.active) set({ offlineReady: true })
    let reloading = false
    container.addEventListener('controllerchange', () => {
      if (reloading) return
      if (requested) {
        reloading = true
        reload()
      } else if (hadController || state.update) {
        set({ update: null, reloadNeeded: true })
      }
    })
  } catch {
    // Sin service worker la app sigue funcionando; solo no estará disponible sin conexión.
  }
}
