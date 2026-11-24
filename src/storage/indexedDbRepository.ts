/**
 * Almacenamiento en IndexedDB (ver docs/STORAGE.md).
 *
 * Por qué: con `localStorage` (≈5 MB) un historial de 50.000 movimientos (14,8 MB) no se
 * puede guardar (medido: QuotaExceededError). IndexedDB admite mucho más y sus transacciones
 * son atómicas.
 *
 * Garantías:
 *  - Datos y número de revisión se escriben en UNA transacción: o todo o nada.
 *  - Antes de escribir se comprueba que nadie (otra pestaña u otra versión) guardó después
 *    de que esta pestaña leyera: si fue así, NO se sobrescribe (error `conflict`).
 *  - Las demás pestañas se enteran por `BroadcastChannel`.
 *  - Migración desde `localStorage`: se copia, se vuelve a leer y se compara; solo entonces
 *    se marca el origen. Es idempotente y se reanuda si se interrumpe; nunca importa dos veces.
 */
import type { AppData } from '../domain/types'
import { SCHEMA_VERSION } from '../domain/types'
import { validateAppData } from './backup'
import { PRE_MIGRATION_KEY_PREFIX, STORAGE_KEY } from './localStorageRepository'
import type { DataRepository, LoadResult, SaveResult } from './repository'

export const DB_NAME = 'clara'
const STORE = 'kv'
const DATA = 'data'
const META = 'meta'
const MIGRATION = 'migration'
/** Copia íntegra del texto que había en localStorage antes de pasar a IndexedDB. */
export const PRE_IDB_KEY = 'margen.data.pre-idb'
/**
 * Lo que queda en `margen.data.v1` tras migrar: una versión «futura» para que una pestaña
 * con la versión anterior de la app no sobrescriba nada (muestra «datos de una versión más
 * nueva» y su detección de conflictos rechaza guardar).
 */
export const MIGRATED_STUB = JSON.stringify({ schemaVersion: 9999, movedTo: 'indexeddb', note: 'Los datos de Clara están ahora en IndexedDB.' })
const CHANNEL = 'clara-data'

interface Meta {
  revision: number
  savedAt: string
}

export interface MigrationRecord {
  from: 'localStorage'
  /** 'written' = ya está en IndexedDB y verificado; 'done' = además se marcó el origen. */
  status: 'written' | 'done'
  at: string
  /** No se pudo guardar la copia del origen por falta de espacio: el original quedó intacto. */
  originKeptInPlace?: boolean
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new DOMException('Transacción cancelada', 'AbortError'))
  })
}

export function openDatabase(factory: IDBFactory = globalThis.indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!factory) return reject(new Error('IndexedDB no disponible'))
    const req = factory.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB bloqueada'))
  })
}

function localStore(): Storage | null {
  try {
    const s = globalThis.localStorage
    s.getItem(STORAGE_KEY)
    return s
  } catch {
    return null
  }
}

function errorCode(error: unknown): SaveResult {
  const name = (error as { name?: string } | null)?.name
  if (name === 'QuotaExceededError') return { ok: false, error: 'quota' }
  if (name === 'InvalidStateError' || name === 'SecurityError') return { ok: false, error: 'unavailable' }
  return { ok: false, error: 'unknown' }
}

export class IndexedDbRepository implements DataRepository {
  readonly kind = 'local' as const
  readonly backend = 'indexeddb' as const
  /** Revisión leída o escrita por ESTA pestaña (`null` = no había datos; `undefined` = sin leer). */
  private baseline: number | null | undefined = undefined
  private channel: BroadcastChannel | null = null
  private readonly db: IDBDatabase

  constructor(db: IDBDatabase) {
    this.db = db
  }

  private async get<T>(key: string): Promise<T | undefined> {
    const tx = this.db.transaction(STORE, 'readonly')
    return request(tx.objectStore(STORE).get(key)) as Promise<T | undefined>
  }

  async readMigration(): Promise<MigrationRecord | undefined> {
    return this.get<MigrationRecord>(MIGRATION)
  }

  async load(): Promise<LoadResult> {
    const tx = this.db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    const [raw, meta] = await Promise.all([request(store.get(DATA)) as Promise<unknown>, request(store.get(META)) as Promise<Meta | undefined>])
    if (raw === undefined) return this.migrateFromLocalStorage()
    await this.finishMigration()
    this.baseline = meta?.revision ?? null
    const result = validateAppData(raw)
    if (!result.ok) return { status: 'corrupt', raw: JSON.stringify(raw), issues: result.issues }
    const version = (raw as { schemaVersion?: unknown }).schemaVersion
    if (typeof version === 'number' && version < SCHEMA_VERSION) await this.preservePreMigration(raw, version)
    return { status: 'ok', data: result.data }
  }

  /** Primera apertura con IndexedDB: trae los datos de localStorage, si los hay. */
  private async migrateFromLocalStorage(): Promise<LoadResult> {
    const ls = localStore()
    const current = ls?.getItem(STORAGE_KEY) ?? null
    // Si el original ya se marcó (p. ej. el navegador borró IndexedDB), se recupera la copia previa.
    const source = current === MIGRATED_STUB ? (ls?.getItem(PRE_IDB_KEY) ?? null) : current
    if (source === null) {
      this.baseline = null
      return { status: 'empty' }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(source)
    } catch {
      return { status: 'corrupt', raw: source, issues: [{ path: 'file', code: 'invalidJson' }] }
    }
    const result = validateAppData(parsed)
    // Datos dañados o de una versión futura: no se migra ni se toca nada.
    if (!result.ok) return { status: 'corrupt', raw: source, issues: result.issues }
    const version = (parsed as { schemaVersion?: unknown }).schemaVersion
    // Se guarda TAL CUAL estaba (sin migrar de formato): la migración de formato se aplica al
    // leer, igual que antes, y su copia previa se conserva aparte.
    const now = new Date().toISOString()
    const revision = typeof (parsed as { revision?: unknown }).revision === 'number' ? (parsed as { revision: number }).revision : 0
    const tx = this.db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    store.put(parsed, DATA)
    store.put({ revision, savedAt: now } satisfies Meta, META)
    store.put({ from: 'localStorage', status: 'written', at: now } satisfies MigrationRecord, MIGRATION)
    await done(tx)
    // Verificación: lo escrito se vuelve a leer y debe ser idéntico al origen.
    const back = await this.get<unknown>(DATA)
    if (JSON.stringify(back) !== JSON.stringify(parsed)) throw new Error('La copia en IndexedDB no coincide con el origen')
    this.baseline = revision
    await this.finishMigration()
    if (typeof version === 'number' && version < SCHEMA_VERSION) await this.preservePreMigration(parsed, version)
    return { status: 'ok', data: result.data }
  }

  /** Paso final (reanudable): guardar la copia del origen y marcar el original. */
  private async finishMigration(): Promise<void> {
    const record = await this.get<MigrationRecord>(MIGRATION)
    if (!record || record.status === 'done') return
    const ls = localStore()
    let originKeptInPlace = false
    if (ls) {
      const current = ls.getItem(STORAGE_KEY)
      if (current !== null && current !== MIGRATED_STUB) {
        try {
          ls.setItem(PRE_IDB_KEY, current)
          ls.setItem(STORAGE_KEY, MIGRATED_STUB)
        } catch {
          // Sin espacio para la copia: el original se queda donde estaba (sigue siendo el origen).
          ls.removeItem(PRE_IDB_KEY)
          originKeptInPlace = true
        }
      }
    }
    const tx = this.db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ ...record, status: 'done', ...(originKeptInPlace ? { originKeptInPlace } : {}) } satisfies MigrationRecord, MIGRATION)
    await done(tx)
  }

  private async preservePreMigration(raw: unknown, fromVersion: number) {
    const key = `${PRE_MIGRATION_KEY_PREFIX}${SCHEMA_VERSION}`
    if ((await this.get(key)) !== undefined) return
    const tx = this.db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ fromVersion, raw: JSON.stringify(raw) }, key)
    await done(tx).catch(() => undefined)
  }

  async save(data: AppData): Promise<SaveResult> {
    try {
      const tx = this.db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const meta = (await request(store.get(META))) as Meta | undefined
      const stored = meta?.revision ?? null
      if (this.baseline !== undefined && stored !== this.baseline) {
        tx.abort()
        await done(tx).catch(() => undefined)
        return { ok: false, error: 'conflict' }
      }
      store.put(data, DATA)
      store.put({ revision: data.revision, savedAt: new Date().toISOString() } satisfies Meta, META)
      await done(tx)
      this.baseline = data.revision
      this.channel?.postMessage({ type: 'saved', revision: data.revision })
      return { ok: true }
    } catch (error) {
      return errorCode(error)
    }
  }

  async preMigrationCopy(): Promise<string | null> {
    const copy = await this.get<{ fromVersion: number; raw: string }>(`${PRE_MIGRATION_KEY_PREFIX}${SCHEMA_VERSION}`)
    return copy === undefined ? null : JSON.stringify(copy)
  }

  async clear(): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    store.delete(DATA)
    store.delete(META)
    await done(tx)
    // Sin esto, la copia del origen volvería a importarse al abrir.
    const ls = localStore()
    ls?.removeItem(STORAGE_KEY)
    ls?.removeItem(PRE_IDB_KEY)
    this.baseline = null
    this.channel?.postMessage({ type: 'cleared' })
  }

  subscribe(onExternalChange: () => void): () => void {
    if (typeof BroadcastChannel === 'undefined') return () => {}
    this.channel?.close()
    const channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = () => onExternalChange()
    this.channel = channel
    return () => {
      channel.close()
      if (this.channel === channel) this.channel = null
    }
  }

  /** Datos dañados: se guarda una copia aparte antes de empezar de nuevo. */
  preserveCorrupt(raw: string, now: Date): void {
    const tx = this.db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(raw, `corrupt.${now.toISOString()}`)
  }

  /** Copia del texto anterior a la migración (para descargarla o eliminarla desde Ajustes). */
  static readOriginCopy(): string | null {
    return localStore()?.getItem(PRE_IDB_KEY) ?? null
  }

  static deleteOriginCopy(): void {
    localStore()?.removeItem(PRE_IDB_KEY)
  }
}

/**
 * Elige el almacenamiento: IndexedDB si el navegador lo permite; si no (p. ej. algunas
 * ventanas privadas), `localStorage` como hasta ahora.
 */
export async function createRepository(): Promise<DataRepository> {
  const { LocalStorageRepository } = await import('./localStorageRepository')
  try {
    const db = await openDatabase()
    return new IndexedDbRepository(db)
  } catch {
    return new LocalStorageRepository()
  }
}
