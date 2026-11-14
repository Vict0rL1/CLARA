/**
 * Copia automática local cada 24 h con la app abierta (al cargar, al volver a la pestaña y una vez
 * por hora), solo si los datos cambiaron y no es la demo. Nunca sustituye a exportar un archivo.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { nativeServices } from '../platform'
import { isAutoBackupDue, LocalBackups, type LocalBackupMeta, type LocalBackupStore } from '../storage/autoBackup'
import type { AppData } from '../domain/types'
import { useData } from '../state/store'
import { APP_VERSION } from './backupActions'

let backupsInstance: LocalBackups | null = null

let probe: Promise<boolean> | null = null
let probed: boolean | null = null
/**
 * ¿Este navegador puede guardar copias locales? `indexedDB` puede existir y aun así no abrir (algunas ventanas
 * privadas): se comprueba una vez abriendo la base y se recuerda (revisión de seguridad QA27, O-3).
 */
export function probeLocalCopies(): Promise<boolean> {
  probe ??= (async () => {
    const backups = localBackups()
    let ok = false
    if (backups) {
      try {
        await backups.list()
        ok = true
      } catch {
        ok = false
      }
    }
    probed = ok
    return ok
  })()
  return probe
}

/** Resultado de `probeLocalCopies` para la interfaz: `null` mientras se comprueba. Sin `indexedDB` es `false` desde el principio. */
export function useLocalCopiesAvailable(): boolean | null {
  const [state, setState] = useState<boolean | null>(() => (localBackups() === null ? false : probed))
  useEffect(() => {
    let alive = true
    void probeLocalCopies().then((ok) => {
      if (alive) setState(ok)
    })
    return () => {
      alive = false
    }
  }, [])
  return state
}
/** En la app de iPhone, archivos propios de la app (decisión 173); en el navegador, IndexedDB. */
export function localBackups(): LocalBackupStore | null {
  const native = nativeServices().localBackups
  if (native) return native
  if (typeof indexedDB === 'undefined') return null
  backupsInstance ??= new LocalBackups()
  return backupsInstance
}

/** Cambia cuando se guarda una copia local (para que las listas se refresquen). */
export const BACKUP_EVENT = 'clara:local-backup'

export function useAutoBackup() {
  const data = useData()
  const running = useRef(false)
  const updatedAt = data.updatedAt
  useEffect(() => {
    const backups = localBackups()
    if (!backups) return
    const check = async () => {
      if (running.current) return
      running.current = true
      try {
        const list = await backups.list()
        const last = list.find((b) => b.budgetId === data.budgetId) ?? null
        if (isAutoBackupDue(data, last, new Date())) {
          await backups.save(data, 'auto', new Date(), APP_VERSION)
          window.dispatchEvent(new Event(BACKUP_EVENT))
        }
      } catch {
        // Sin espacio o sin IndexedDB: no se avisa cada hora; la sección de copias lo muestra.
      } finally {
        running.current = false
      }
    }
    void check()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    const id = window.setInterval(() => void check(), 60 * 60 * 1000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(id)
    }
    // `updatedAt` basta para re-evaluar cuando cambian los datos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatedAt, data.budgetId])
}

/** Lista de copias locales, refrescada al guardar una nueva. */
export function useLocalBackupList(): { list: LocalBackupMeta[] | null; refresh: () => void; available: boolean } {
  const [list, setList] = useState<LocalBackupMeta[] | null>(null)
  const available = localBackups() !== null
  const refresh = useCallback(() => {
    const b = localBackups()
    if (!b) return
    b.list()
      .then(setList)
      .catch(() => setList([]))
  }, [])
  useEffect(() => {
    refresh()
    window.addEventListener(BACKUP_EVENT, refresh)
    return () => window.removeEventListener(BACKUP_EVENT, refresh)
  }, [refresh])
  return { list, refresh, available }
}


/**
 * Copia local «Antes de restaurar» de los datos actuales, antes de reemplazarlos (importar o
 * restaurar). Es el camino de recuperación cuando «Deshacer» ya no es seguro (REC-01).
 */
export async function keepCopyBeforeReplace(data: AppData | null): Promise<'kept' | 'unavailable' | 'failed'> {
  const backups = localBackups()
  if (!backups || !data) return 'unavailable'
  try {
    await backups.save(data, 'beforeRestore', new Date(), APP_VERSION)
    return 'kept'
  } catch {
    return 'failed'
  }
}
