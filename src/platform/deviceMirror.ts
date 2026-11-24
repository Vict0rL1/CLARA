/**
 * Ajustes de este dispositivo dentro de la app de iPhone (Fase 2, decisión 173): el bloqueo con PIN, las preferencias
 * de presentación, el tema y lo que recuerda la interfaz viven en `localStorage` del WebView, que iOS puede vaciar.
 * Las pantallas los leen de forma síncrona al pintar (el bloqueo, antes que nada), así que `localStorage` sigue siendo
 * donde se leen; este módulo guarda una copia en un archivo propio de la app (`device`, por `ClaraStorage`):
 *
 * - Al abrir (antes de pintar): lo que falte en `localStorage` vuelve desde el archivo. Lo que sí está nunca se pisa:
 *   es más reciente que la copia.
 * - Al ir a segundo plano (`pause` de Capacitor, `visibilitychange` oculto) y justo después de cambiar el bloqueo, se
 *   copia el estado actual al archivo, solo si cambió.
 * - Al volver (`resume`, `visibilitychange` visible) se restaura antes que nada lo que falte: si iOS vació el WebView con
 *   la app suspendida, la siguiente copia no puede guardar ese vacío encima de lo bueno. Quitar algo a propósito no
 *   vuelve: antes de salir a segundo plano ya se copió sin ello (y el bloqueo, en el momento).
 *
 * Solo se carga dentro de la app (`repository.ts`, con `import()`). No guarda cifras ni datos financieros.
 */
import type { NativeTextStore } from '../storage/nativeRepository'

export const NATIVE_DEVICE = 'device'

/** Las claves de este dispositivo. El registro de errores y lo ya avisado no se copian. */
export const DEVICE_KEYS = ['clara.lock.v1', 'clara.ui.v1', 'clara.theme', 'clara.device.v1', 'clara.plan.tab', 'clara.movements.summary', 'clara.hint.view'] as const

type KeyStorage = Pick<Storage, 'getItem' | 'setItem'>

function current(storage: KeyStorage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of DEVICE_KEYS) {
    try {
      const value = storage.getItem(key)
      if (value !== null) out[key] = value
    } catch {
      // Sin acceso a esa clave: se deja fuera de la copia, nunca se borra de ella por eso.
    }
  }
  return out
}

/** Devuelve las claves que volvieron desde el archivo. Un archivo ilegible o sin acceso no restaura nada. */
export async function restoreDeviceKeys(store: NativeTextStore, storage: KeyStorage): Promise<string[]> {
  let saved: Record<string, unknown>
  try {
    const file = await store.read(NATIVE_DEVICE)
    if (!file) return []
    saved = JSON.parse(file.text) as Record<string, unknown>
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return []
  } catch {
    return []
  }
  const restored: string[] = []
  for (const key of DEVICE_KEYS) {
    const value = saved[key]
    if (typeof value !== 'string') continue
    try {
      if (storage.getItem(key) === null) {
        storage.setItem(key, value)
        restored.push(key)
      }
    } catch {
      // Sin espacio en el WebView: se sigue sin esa clave (la copia del archivo no se toca).
    }
  }
  return restored
}

export interface DeviceMirror {
  /** Copia lo de ahora al archivo si cambió desde la última vez. `false` si no se pudo. */
  save(): Promise<boolean>
  stop(): void
}

export function startDeviceMirror(store: NativeTextStore, storage: KeyStorage, target: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>): DeviceMirror {
  let last: string | null = null
  let revision: number | null | undefined
  let chain: Promise<boolean> = Promise.resolve(true)

  const write = async (): Promise<boolean> => {
    const text = JSON.stringify(current(storage))
    if (text === last) return true
    try {
      if (revision === undefined) revision = (await store.read(NATIVE_DEVICE))?.revision ?? null
      const next = (revision ?? 0) + 1
      await store.write(NATIVE_DEVICE, text, next, revision)
      revision = next
      last = text
      return true
    } catch {
      // Otra escritura o un conflicto: la próxima vez se relee la revisión.
      revision = undefined
      return false
    }
  }
  const restore = async (): Promise<boolean> => {
    await restoreDeviceKeys(store, storage)
    return true
  }
  // Una operación a la vez, en orden (restaurar al volver siempre antes de la copia siguiente).
  const save = () => (chain = chain.then(write, write))
  const onPause = () => void save()
  const onResume = () => void (chain = chain.then(restore, restore))
  const onVisible = () => {
    if (target.visibilityState === 'hidden') onPause()
    else onResume()
  }
  target.addEventListener('pause', onPause)
  target.addEventListener('resume', onResume)
  target.addEventListener('visibilitychange', onVisible)
  return {
    save,
    stop: () => {
      target.removeEventListener('pause', onPause)
      target.removeEventListener('resume', onResume)
      target.removeEventListener('visibilitychange', onVisible)
    },
  }
}
