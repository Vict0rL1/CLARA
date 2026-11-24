/**
 * Copias locales automáticas dentro de la app de iPhone (Fase 2, decisión 173): archivos propios de la app a través
 * del almacén nativo (`NativeTextStore`, el plugin `ClaraStorage`), no el IndexedDB del WebView, que iOS puede vaciar.
 * Mismas reglas que `LocalBackups` (cada 24 h si cambió, antes de reemplazar o borrar, se conservan 10).
 *
 * - Cada copia es un archivo `backup-<milisegundos>-<motivo>` con el JSON de la copia tal cual.
 * - Un índice (`local-backups`) guarda la lista con sus datos de resumen y el nombre de cada archivo.
 * - Al guardar se escribe primero el archivo y después el índice: si algo se corta, la lista nunca señala una copia que
 *   no existe (a lo sumo queda un archivo sin listar). Las podadas se quitan del índice antes que del disco.
 * - Un índice ilegible no se sobrescribe a ciegas: se lanza y la pantalla de copias dice que no puede leerlas.
 */
import { backupRecord, backupsToPrune, KEEP_BACKUPS, stripBackupJson, type BackupReason, type LocalBackupMeta, type LocalBackupStore } from './autoBackup'
import type { AppData } from '../domain/types'
import type { NativeTextStore } from './nativeRepository'

export const NATIVE_BACKUP_INDEX = 'local-backups'

interface IndexEntry extends LocalBackupMeta {
  file: string
}

const REASON_FILE: Record<BackupReason, string> = { auto: 'auto', manual: 'manual', beforeRestore: 'restore', beforeDelete: 'delete', beforeMigration: 'migration' }

const isEntry = (v: unknown): v is IndexEntry => {
  const e = v as Partial<IndexEntry> | null
  return !!e && typeof e === 'object' && typeof e.id === 'string' && typeof e.file === 'string' && /^backup-[a-z0-9-]{1,33}$/.test(e.file) && typeof e.createdAt === 'string'
}

export class NativeLocalBackups implements LocalBackupStore {
  private readonly store: NativeTextStore
  constructor(store: NativeTextStore) {
    this.store = store
  }

  private async index(): Promise<{ entries: IndexEntry[]; revision: number | null }> {
    const file = await this.store.read(NATIVE_BACKUP_INDEX)
    if (!file) return { entries: [], revision: null }
    let parsed: unknown
    try {
      parsed = JSON.parse(file.text)
    } catch {
      throw new Error('índice de copias locales ilegible')
    }
    if (!Array.isArray(parsed) || !parsed.every(isEntry)) throw new Error('índice de copias locales ilegible')
    return { entries: parsed, revision: file.revision }
  }

  private writeIndex(entries: IndexEntry[], revision: number | null): Promise<void> {
    return this.store.write(NATIVE_BACKUP_INDEX, JSON.stringify(entries), (revision ?? 0) + 1, revision)
  }

  async list(): Promise<LocalBackupMeta[]> {
    const { entries } = await this.index()
    return entries.map(({ file: _file, ...meta }) => meta).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async save(data: AppData, reason: BackupReason, now: Date, appVersion: string, keep = KEEP_BACKUPS): Promise<LocalBackupMeta> {
    const record = backupRecord(data, reason, now, appVersion)
    const { entries, revision } = await this.index()
    const file = `backup-${now.getTime()}-${REASON_FILE[reason]}`
    const existing = await this.store.read(file)
    await this.store.write(file, record.json, (existing?.revision ?? 0) + 1, existing?.revision ?? null)
    const meta = stripBackupJson(record)
    const next = [...entries.filter((e) => e.id !== record.id), { ...meta, file }]
    const pruned = new Set(backupsToPrune(next, keep))
    await this.writeIndex(
      next.filter((e) => !pruned.has(e.id)),
      revision,
    )
    for (const e of next) if (pruned.has(e.id)) await this.store.remove(e.file).catch(() => {})
    return meta
  }

  async read(id: string): Promise<string | null> {
    const { entries } = await this.index()
    const entry = entries.find((e) => e.id === id)
    if (!entry) return null
    return (await this.store.read(entry.file))?.text ?? null
  }

  async remove(id: string): Promise<void> {
    const { entries, revision } = await this.index()
    const entry = entries.find((e) => e.id === id)
    if (!entry) return
    await this.writeIndex(
      entries.filter((e) => e.id !== id),
      revision,
    )
    await this.store.remove(entry.file).catch(() => {})
  }
}
