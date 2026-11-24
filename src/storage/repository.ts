/**
 * Interfaz de almacenamiento. La app solo habla con esta interfaz, así que en
 * la siguiente fase se puede añadir un repositorio con servidor (API + base de
 * datos) sin cambiar la lógica financiera ni las pantallas.
 */
import type { AppData } from '../domain/types'
import type { ImportIssue } from './backup'

export type LoadResult =
  | { status: 'empty' }
  | { status: 'ok'; data: AppData }
  | { status: 'corrupt'; raw: string; issues: ImportIssue[] }

/**
 * - quota: no queda espacio.
 * - unavailable: el navegador bloquea el almacenamiento.
 * - conflict: otra pestaña (u otra versión de la app) guardó cambios después de que esta
 *   pestaña leyera los datos. No se sobrescriben: la persona decide.
 */
export type SaveErrorCode = 'quota' | 'unavailable' | 'conflict' | 'unknown'
export type SaveResult = { ok: true } | { ok: false; error: SaveErrorCode }

export interface DataRepository {
  /** Descripción para la interfaz, por ejemplo "este navegador". */
  readonly kind: 'local' | 'memory'
  /** Dónde se guarda (para explicarlo en Ajustes). */
  /** `native` = archivo propio de la app de iPhone (`NativeRepository`, decisión 156). */
  readonly backend?: 'indexeddb' | 'localStorage' | 'memory' | 'native'
  load(): Promise<LoadResult>
  save(data: AppData): Promise<SaveResult>
  clear(): Promise<void>
  /**
   * Copia exacta de los datos de antes de la última migración de esquema (`{"fromVersion":…,"raw":"…"}`), si este
   * almacenamiento la guardó; `null` si no hay. Solo lectura (`docs/ROLLBACK.md`).
   */
  preMigrationCopy?(): Promise<string | null>
  /** Avisa si otra pestaña cambió los datos. Devuelve la función para dejar de escuchar. */
  subscribe(onExternalChange: () => void): () => void
}
