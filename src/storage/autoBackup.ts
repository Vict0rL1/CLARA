/**
 * Copias automáticas locales (§7.7 · Copias y restauración). Se guardan en una base IndexedDB
 * aparte (`clara-backups`), nunca en los datos de la app ni en localStorage (tamaño). Reglas:
 *  - una copia automática cada 24 h con la app abierta, solo si los datos cambiaron;
 *  - además antes de operaciones críticas (restaurar, borrar todo, cambio de formato);
 *  - se conservan las últimas 10 (las de «antes de…» cuentan igual);
 *  - una copia local NO protege frente a perder el dispositivo o borrar el navegador: el texto
 *    de la interfaz lo dice y el recordatorio de exportar sigue existiendo.
 */
import type { AppData, Timestamp } from '../domain/types'
import { createBackup } from './backup'

export const BACKUPS_DB = 'clara-backups'
const STORE = 'backups'
export const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000
export const KEEP_BACKUPS = 10

export type BackupReason = 'auto' | 'manual' | 'beforeRestore' | 'beforeDelete' | 'beforeMigration'

export interface LocalBackupMeta {
  id: string
  createdAt: Timestamp
  reason: BackupReason
  /** Tamaño del JSON en bytes. */
  size: number
  budgetId: string
  isDemo: boolean
  /** `updatedAt` de los datos copiados: sirve para no repetir una copia idéntica. */
  dataUpdatedAt: Timestamp
  counts: { accounts: number; transactions: number; categories: number; goals: number; schedules: number }
}

export interface LocalBackupRecord extends LocalBackupMeta {
  json: string
}

/**
 * Dónde viven las copias locales: IndexedDB del navegador (`LocalBackups`) o, en la app de iPhone, archivos propios de
 * la app (`NativeLocalBackups`, fuera del WebView que iOS puede vaciar). Mismas reglas en los dos.
 */
export interface LocalBackupStore {
  list(): Promise<LocalBackupMeta[]>
  save(data: AppData, reason: BackupReason, now: Date, appVersion: string, keep?: number): Promise<LocalBackupMeta>
  read(id: string): Promise<string | null>
  remove(id: string): Promise<void>
}

/** La copia y sus datos de resumen (igual en los dos almacenes). */
export function backupRecord(data: AppData, reason: BackupReason, now: Date, appVersion: string): LocalBackupRecord {
  const json = JSON.stringify(createBackup(data, now, appVersion))
  return {
    id: `${now.toISOString()}-${reason}`,
    createdAt: now.toISOString(),
    reason,
    size: new TextEncoder().encode(json).length,
    budgetId: data.budgetId,
    isDemo: data.isDemo,
    dataUpdatedAt: data.updatedAt,
    counts: { accounts: data.accounts.length, transactions: data.transactions.length, categories: data.categories.length, goals: data.goals.length, schedules: data.schedules.length },
    json,
  }
}

/** ¿Toca una copia automática? Nunca antes de 24 h desde la última ni si los datos no cambiaron. */
export function isAutoBackupDue(data: Pick<AppData, 'updatedAt' | 'isDemo'>, last: Pick<LocalBackupMeta, 'createdAt' | 'dataUpdatedAt'> | null, now: Date): boolean {
  if (data.isDemo) return false
  if (!last) return true
  if (last.dataUpdatedAt === data.updatedAt) return false
  return now.getTime() - Date.parse(last.createdAt) >= AUTO_BACKUP_INTERVAL_MS
}

/** Ids a borrar para conservar solo las `keep` más recientes. */
export function backupsToPrune(list: readonly Pick<LocalBackupMeta, 'id' | 'createdAt'>[], keep = KEEP_BACKUPS): string[] {
  return [...list]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(keep)
    .map((b) => b.id)
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

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!factory) return reject(new Error('IndexedDB no disponible'))
    const req = factory.open(BACKUPS_DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('IndexedDB bloqueada'))
  })
}

export const stripBackupJson = ({ json: _json, ...meta }: LocalBackupRecord): LocalBackupMeta => meta
const strip = stripBackupJson

export class LocalBackups implements LocalBackupStore {
  private readonly factory: IDBFactory
  constructor(factory: IDBFactory = globalThis.indexedDB) {
    this.factory = factory
  }

  async list(): Promise<LocalBackupMeta[]> {
    const db = await open(this.factory)
    try {
      const all = (await request(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())) as LocalBackupRecord[]
      return all.map(strip).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    } finally {
      db.close()
    }
  }

  /** Guarda una copia y poda las antiguas en la misma transacción. */
  async save(data: AppData, reason: BackupReason, now: Date, appVersion: string, keep = KEEP_BACKUPS): Promise<LocalBackupMeta> {
    const record = backupRecord(data, reason, now, appVersion)
    const db = await open(this.factory)
    try {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      store.put(record)
      const existing = (await request(store.getAll())) as LocalBackupRecord[]
      for (const id of backupsToPrune(existing, keep)) store.delete(id)
      await done(tx)
      return strip(record)
    } finally {
      db.close()
    }
  }

  async read(id: string): Promise<string | null> {
    const db = await open(this.factory)
    try {
      const rec = (await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(id))) as LocalBackupRecord | undefined
      return rec?.json ?? null
    } finally {
      db.close()
    }
  }

  async remove(id: string): Promise<void> {
    const db = await open(this.factory)
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(id)
      await done(tx)
    } finally {
      db.close()
    }
  }
}
