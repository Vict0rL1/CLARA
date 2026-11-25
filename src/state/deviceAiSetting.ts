/**
 * «Usar la IA de este iPhone» (Fase 5, decisión 189): apagado por defecto y de ESTE dispositivo (`clara.deviceAi.v1`),
 * como el interruptor de las tasas del banco. No son datos: no viaja en las copias ni entra en el historial, y no
 * cambia ninguna cifra. En la app de iPhone se copia con el resto de los ajustes del dispositivo
 * (`platform/deviceMirror.ts`). Solo se ofrece si la IA está disponible en el iPhone; aunque esté encendido, sin IA
 * disponible el asistente usa el analizador de siempre.
 */
import { useSyncExternalStore } from 'react'

export const DEVICE_AI_SETTING_KEY = 'clara.deviceAi.v1'

type KeyStorage = Pick<Storage, 'getItem' | 'setItem'>

const storageOrNull = (): KeyStorage | null => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

const listeners = new Set<() => void>()

/** ¿Está encendido en este dispositivo? Sin almacenamiento o con algo ilegible: apagado. */
export function deviceAiEnabled(storage: KeyStorage | null = storageOrNull()): boolean {
  try {
    const raw = storage?.getItem(DEVICE_AI_SETTING_KEY)
    return !!raw && (JSON.parse(raw) as { enabled?: unknown }).enabled === true
  } catch {
    return false
  }
}

/** Enciende o apaga. Devuelve si se pudo guardar (si no, sigue como estaba). */
export function setDeviceAiEnabled(enabled: boolean, storage: KeyStorage | null = storageOrNull()): boolean {
  try {
    if (!storage) return false
    storage.setItem(DEVICE_AI_SETTING_KEY, JSON.stringify({ enabled }))
  } catch {
    return false
  }
  listeners.forEach((l) => l())
  return true
}

export function subscribeDeviceAi(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === DEVICE_AI_SETTING_KEY || e.key === null) listener()
  }
  globalThis.addEventListener?.('storage', onStorage)
  return () => {
    listeners.delete(listener)
    globalThis.removeEventListener?.('storage', onStorage)
  }
}

export function useDeviceAiEnabled(): boolean {
  return useSyncExternalStore(subscribeDeviceAi, () => deviceAiEnabled(), () => false)
}
