/**
 * Datos de Clara en la app de iPhone: un archivo en Application Support, fuera del WebView (decisión 156).
 *
 * iOS puede borrar `localStorage` e IndexedDB del WebView cuando falta espacio; para datos financieros eso no vale.
 * Este repositorio habla con un almacén de textos nativo (`NativeTextStore`, que en la app es el plugin `ClaraStorage`)
 * y da las mismas garantías que los otros dos (`docs/STORAGE.md`):
 *  - Todo o nada: cada guardado sustituye el archivo completo de forma atómica (lo hace el lado nativo).
 *  - Sin sobrescrituras silenciosas: se guarda con la revisión que se leyó; si el archivo tiene otra, `conflict`.
 *  - Nunca se reemplazan datos por un estado vacío: un archivo ilegible se enseña como dañado, tal cual.
 *
 * Este archivo no sabe nada de Capacitor: recibe el almacén ya construido (`src/platform/native/` lo crea en la app y las
 * pruebas le pasan uno en memoria).
 */
import type { AppData } from '../domain/types'
import { SCHEMA_VERSION } from '../domain/types'
import { validateAppData } from './backup'
import type { DataRepository, LoadResult, SaveErrorCode, SaveResult } from './repository'

/** Motivo por el que el almacén nativo rechazó una operación. */
export type NativeStoreErrorCode = 'conflict' | 'noSpace' | 'unavailable' | 'unknown'

export class NativeStoreError extends Error {
  readonly code: NativeStoreErrorCode
  constructor(code: NativeStoreErrorCode, message: string = code) {
    super(message)
    this.name = 'NativeStoreError'
    this.code = code
  }
}

/**
 * Almacén de textos con nombre. Cada texto lleva una revisión (entero ≥ 1) que el propio almacén guarda junto a él,
 * en el mismo archivo, para que dato y revisión no puedan quedar desparejados.
 */
export interface NativeTextStore {
  read(name: string): Promise<{ text: string; revision: number } | null>
  /**
   * Sustituye el texto de forma atómica. `expectedRevision` es la revisión que leyó quien escribe (`null` = «no había
   * nada»); si lo guardado no coincide, rechaza con `NativeStoreError('conflict')` y no cambia nada.
   */
  write(name: string, text: string, revision: number, expectedRevision: number | null): Promise<void>
  remove(name: string): Promise<void>
}

/** Nombres dentro del almacén nativo (solo minúsculas, dígitos y guiones: los valida también el lado nativo). */
export const NATIVE_DATA = 'data'
export const NATIVE_MIGRATION = 'migration'
export const nativePreMigrationName = (schemaVersion: number = SCHEMA_VERSION) => `before-v${schemaVersion}`

/** Lo que queda escrito cuando los datos del WebView ya pasaron (o se decidió que no hay nada que pasar). */
export interface NativeMigrationRecord {
  from: 'webview'
  status: 'done' | 'cleared'
  at: string
  /** Bytes del texto migrado (solo informativo). */
  size?: number
}

/** El repositorio que había antes dentro del WebView (IndexedDB), para traer sus datos una sola vez. */
export type LegacySource = Pick<DataRepository, 'load' | 'clear'>

export interface NativeRepositoryOptions {
  /** Se llama como mucho una vez, solo si el almacén nativo está vacío y nunca se migró. */
  legacy?: () => Promise<LegacySource | null>
  now?: () => Date
}

/** La migración escribió el archivo pero al releerlo no era idéntico: no se sigue (el origen queda intacto). */
export class NativeMigrationMismatch extends Error {
  constructor() {
    super('Los datos migrados al almacenamiento nativo no coinciden al releerlos')
    this.name = 'NativeMigrationMismatch'
  }
}

function toSaveError(error: unknown): SaveErrorCode {
  const code = error instanceof NativeStoreError ? error.code : 'unknown'
  if (code === 'conflict') return 'conflict'
  if (code === 'noSpace') return 'quota'
  if (code === 'unavailable') return 'unavailable'
  return 'unknown'
}

export class NativeRepository implements DataRepository {
  readonly kind = 'local' as const
  readonly backend = 'native' as const
  /** Revisión del archivo tal como la leyó o escribió esta sesión (`null` = no había archivo; `undefined` = sin leer). */
  private baseline: number | null | undefined = undefined
  private readonly store: NativeTextStore
  private readonly options: NativeRepositoryOptions

  constructor(store: NativeTextStore, options: NativeRepositoryOptions = {}) {
    this.store = store
    this.options = options
  }

  private now(): Date {
    return this.options.now?.() ?? new Date()
  }

  async load(): Promise<LoadResult> {
    const stored = await this.store.read(NATIVE_DATA)
    if (stored === null) {
      this.baseline = null
      return this.migrateFromWebView()
    }
    this.baseline = stored.revision
    return this.decode(stored.text)
  }

  private async decode(raw: string): Promise<LoadResult> {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { status: 'corrupt', raw, issues: [{ path: 'file', code: 'invalidJson' }] }
    }
    const result = validateAppData(parsed)
    // Datos de una versión futura, dañados o con migración fallida: NO se sobrescriben.
    if (!result.ok) return { status: 'corrupt', raw, issues: result.issues }
    const version = (parsed as { schemaVersion?: unknown }).schemaVersion
    if (typeof version === 'number' && version < SCHEMA_VERSION) await this.preservePreMigration(raw, version)
    return { status: 'ok', data: result.data }
  }

  /** Copia exacta de lo anterior a una migración de esquema; una sola vez por versión, nunca pisa la que hubiera. */
  private async preservePreMigration(raw: string, fromVersion: number): Promise<void> {
    try {
      const name = nativePreMigrationName()
      if ((await this.store.read(name)) === null) await this.store.write(name, JSON.stringify({ fromVersion, raw }), 1, null)
    } catch {
      // Sin espacio o sin acceso: la migración sigue siendo en memoria y validada; se pierde solo esta copia extra.
    }
  }

  /**
   * Primer arranque en nativo: si el WebView tenía datos de Clara (una compilación anterior a este repositorio), se
   * copian al archivo nativo, se releen y se comparan. El origen no se borra. Si se corta a medias no queda marca, y
   * el siguiente arranque repite desde el principio (la escritura es atómica: o está entera o no está).
   */
  private async migrateFromWebView(): Promise<LoadResult> {
    if (!this.options.legacy) return { status: 'empty' }
    // Ya se migró, o la persona borró todo a propósito: lo que quede en el WebView no se vuelve a traer.
    if ((await this.store.read(NATIVE_MIGRATION)) !== null) return { status: 'empty' }
    let legacy: LegacySource | null
    let result: LoadResult
    try {
      legacy = await this.options.legacy()
      if (!legacy) return { status: 'empty' }
      result = await legacy.load()
    } catch {
      // El WebView no deja leer su almacenamiento: no hay nada que migrar ahora; se volverá a mirar al abrir.
      return { status: 'empty' }
    }
    // Datos dañados en el origen: se enseñan tal cual (la pantalla ofrece descargarlos) y no se copian.
    if (result.status !== 'ok') return result
    const text = JSON.stringify(result.data)
    await this.store.write(NATIVE_DATA, text, 1, null)
    const check = await this.store.read(NATIVE_DATA)
    if (check === null || check.text !== text || check.revision !== 1) {
      await this.store.remove(NATIVE_DATA).catch(() => {})
      throw new NativeMigrationMismatch()
    }
    this.baseline = 1
    const record: NativeMigrationRecord = { from: 'webview', status: 'done', at: this.now().toISOString(), size: text.length }
    await this.store.write(NATIVE_MIGRATION, JSON.stringify(record), 1, null)
    return { status: 'ok', data: result.data }
  }

  async save(data: AppData): Promise<SaveResult> {
    if (this.baseline === undefined) return { ok: false, error: 'unavailable' }
    const revision = (this.baseline ?? 0) + 1
    try {
      await this.store.write(NATIVE_DATA, JSON.stringify(data), revision, this.baseline)
      this.baseline = revision
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toSaveError(error) }
    }
  }

  async preMigrationCopy(): Promise<string | null> {
    return (await this.store.read(nativePreMigrationName()))?.text ?? null
  }

  /**
   * «Borrar todos los datos»: quita el archivo nativo y también lo que quedara en el WebView, y deja la marca para
   * que un resto del WebView nunca se vuelva a traer por una migración.
   */
  async clear(): Promise<void> {
    await this.store.remove(NATIVE_DATA)
    this.baseline = null
    const record: NativeMigrationRecord = { from: 'webview', status: 'cleared', at: this.now().toISOString() }
    const previous = await this.store.read(NATIVE_MIGRATION)
    await this.store.write(NATIVE_MIGRATION, JSON.stringify(record), (previous?.revision ?? 0) + 1, previous?.revision ?? null)
    try {
      await (await this.options.legacy?.())?.clear()
    } catch {
      // Lo que no se pudo borrar del WebView queda inerte: la marca impide volver a traerlo.
    }
  }

  /** Guarda una copia de datos dañados antes de reemplazarlos, por si hace falta recuperarlos. */
  preserveCorrupt(raw: string, now: Date): void {
    const name = `corrupt-${now.toISOString().replace(/[^0-9]/g, '')}`
    void this.store.write(name, raw, 1, null).catch(() => {
      // Si no cabe, no se puede hacer más; la interfaz ya ofreció descargarla.
    })
  }

  /** En la app hay una sola vista web: nadie más escribe, así que no hay avisos de otra pestaña. */
  subscribe(): () => void {
    return () => {}
  }
}
