/**
 * Estado del bloqueo: bloqueado al abrir si hay PIN configurado en este dispositivo y tras 60 s
 * con la app en segundo plano. Nada de esto cifra los datos (ver pin.ts).
 */
import { useCallback, useEffect, useState } from 'react'
import { nativeServices } from '../../platform'
import { readLockConfig, shouldRelock, writeLockConfig, type LockConfig } from './pin'

export interface LockState {
  config: LockConfig | null
  locked: boolean
  unlock: () => void
  /** Guarda (o quita) la configuración del dispositivo y actualiza el estado. */
  setConfig: (config: LockConfig | null) => boolean
}

let hiddenAt: number | null = null

export function useLock(): LockState {
  const [config, setConfigState] = useState<LockConfig | null>(() => readLockConfig())
  const [locked, setLocked] = useState<boolean>(() => readLockConfig() !== null)

  useEffect(() => {
    if (!config) return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now()
      } else if (shouldRelock(hiddenAt, Date.now())) {
        hiddenAt = null
        setLocked(true)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [config])

  const unlock = useCallback(() => setLocked(false), [])
  const setConfig = useCallback((next: LockConfig | null) => {
    const ok = writeLockConfig(next)
    if (ok) {
      setConfigState(next)
      if (!next) setLocked(false)
      // En la app de iPhone, la copia fuera del WebView se actualiza ya (quitar el PIN no debe volver tras un vaciado).
      void nativeServices().saveDeviceSettings?.()
    }
    return ok
  }, [])
  return { config, locked, unlock, setConfig }
}
