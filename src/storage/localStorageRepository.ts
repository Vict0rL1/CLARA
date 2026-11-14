/**
 * Guarda los datos en `localStorage` del navegador.
 *
 * Limitaciones (se explican al usuario):
 *  - Si se borran los datos del sitio o del navegador, se pierden.
 *  - No se sincroniza entre dispositivos ni navegadores.
 *  - El espacio es limitado (unos 5 MB por sitio).
 */
import type { AppData } from '../domain/types'
import { SCHEMA_VERSION } from '../domain/types'
import { validateAppData } from './backup'
import type { DataRepository, LoadResult, SaveResult } from './repository'

// Claves internas con el nombre anterior de la app («Margen»): no se cambian para que los
// datos ya guardados en el navegador se sigan encontrando.
export const STORAGE_KEY = 'margen.data.v1'
const CORRUPT_KEY_PREFIX = 'margen.data.corrupt.'
/** Copia exacta de los datos anteriores a una migración: `margen.data.before-v<versión nueva>`. */
export const PRE_MIGRATION_KEY_PREFIX = 'margen.data.before-v'

/**
 * Antes de guardar datos migrados por primera vez se conserva el texto original,
 * por si la migración tuviera un error. Solo se guarda una vez por versión.
 */
function preservePreMigration(storage: Storage, raw: string, fromVersion: number) {
  const key = `${PRE_MIGRATION_KEY_PREFIX}${SCHEMA_VERSION}`
  try {
    if (storage.getItem(key) === null) storage.setItem(key, JSON.stringify({ fromVersion, raw }))
  } catch {
    // Sin espacio: la migración sigue siendo en memoria y validada; se pierde solo esta copia extra.
  }
}

/**
 * Acceso para LEER. No se prueba escribiendo: con el almacenamiento lleno una escritura de
 * prueba falla, y eso no debe hacer creer a la app que no hay datos (se mostraría vacía).
 */
function getStorage(): Storage | null {
  try {
    const s = globalThis.localStorage
    s.getItem(STORAGE_KEY)
    return s
  } catch {
    return null
  }
}

export class LocalStorageRepository implements DataRepository {
  readonly kind = 'local' as const
  readonly backend = 'localStorage' as const
  /**
   * Texto guardado tal como lo leyó o escribió ESTA pestaña (`null` = no había datos;
   * `undefined` = todavía no se leyó). Si al guardar el almacenamiento tiene otra cosa,
   * alguien más lo cambió: no se sobrescribe sin que la persona lo decida.
   */
  private baseline: string | null | undefined = undefined

  async load(): Promise<LoadResult> {
    const storage = getStorage()
    if (!storage) throw new Error('localStorage no disponible')
    const raw = storage.getItem(STORAGE_KEY)
    this.baseline = raw
    if (raw === null) return { status: 'empty' }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { status: 'corrupt', raw, issues: [{ path: 'file', code: 'invalidJson' }] }
    }
    const result = validateAppData(parsed)
    // Datos de una versión futura, dañados o con migración fallida: NO se sobrescriben
    // (la interfaz ofrece descargarlos antes de cualquier decisión).
    if (!result.ok) return { status: 'corrupt', raw, issues: result.issues }
    const version = (parsed as { schemaVersion?: unknown }).schemaVersion
    if (typeof version === 'number' && version < SCHEMA_VERSION) preservePreMigration(storage, raw, version)
    return { status: 'ok', data: result.data }
  }

  async save(data: AppData): Promise<SaveResult> {
    const storage = getStorage()
    if (!storage) return { ok: false, error: 'unavailable' }
    try {
      if (this.baseline !== undefined && storage.getItem(STORAGE_KEY) !== this.baseline) return { ok: false, error: 'conflict' }
      const text = JSON.stringify(data)
      storage.setItem(STORAGE_KEY, text)
      this.baseline = text
      return { ok: true }
    } catch (error) {
      const name = (error as { name?: string } | null)?.name
      if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return { ok: false, error: 'quota' }
      if (name === 'SecurityError') return { ok: false, error: 'unavailable' }
      return { ok: false, error: 'unknown' }
    }
  }

  async clear(): Promise<void> {
    getStorage()?.removeItem(STORAGE_KEY)
    this.baseline = null
  }

  async preMigrationCopy(): Promise<string | null> {
    return getStorage()?.getItem(`${PRE_MIGRATION_KEY_PREFIX}${SCHEMA_VERSION}`) ?? null
  }

  /** Guarda una copia de datos dañados antes de reemplazarlos, por si hace falta recuperarlos. */
  preserveCorrupt(raw: string, now: Date): void {
    try {
      getStorage()?.setItem(`${CORRUPT_KEY_PREFIX}${now.toISOString()}`, raw)
    } catch {
      // Si no cabe, no se puede hacer más; la interfaz ya ofreció descargarla.
    }
  }

  subscribe(onExternalChange: () => void): () => void {
    const handler = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) onExternalChange()
    }
    globalThis.addEventListener?.('storage', handler)
    return () => globalThis.removeEventListener?.('storage', handler)
  }
}

/** Solo en memoria: se usa si el navegador bloquea el almacenamiento (y en pruebas). */
export class MemoryRepository implements DataRepository {
  readonly kind = 'memory' as const
  readonly backend = 'memory' as const
  private stored: string | null = null

  async load(): Promise<LoadResult> {
    if (this.stored === null) return { status: 'empty' }
    const result = validateAppData(JSON.parse(this.stored))
    return result.ok ? { status: 'ok', data: result.data } : { status: 'corrupt', raw: this.stored, issues: result.issues }
  }

  async save(data: AppData): Promise<SaveResult> {
    this.stored = JSON.stringify(data)
    return { ok: true }
  }

  async clear(): Promise<void> {
    this.stored = null
  }

  subscribe(): () => void {
    return () => {}
  }
}
