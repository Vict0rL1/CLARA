/**
 * Centro de datos y recuperación (etapa 4): estado de lo que protege los datos (guardado local,
 * copia exportada y verificada, copias locales automáticas, copia previa a la migración, papelera e
 * historial) y el orden honesto en que se puede recuperar algo. Es cálculo puro: la pantalla le pasa
 * lo que solo el navegador sabe (motor de guardado, copias locales, claves, errores).
 */
import { backupStatus, type BackupStatus } from './backupReminder'
import { daysBetween, localDateInTimeZone } from './dates'
import type { AppData, LocalDate } from './types'

export type StorageBackend = 'indexeddb' | 'localStorage' | 'memory'
export type RecoveryState = 'ok' | 'info' | 'warn' | 'critical'
export type RecoveryRowId = 'saving' | 'export' | 'verified' | 'localCopies' | 'preMigration' | 'schema' | 'records' | 'trash' | 'history' | 'errors' | 'offline'
export type RecoveryStepId = 'export' | 'localCopies' | 'preMigration' | 'trash' | 'history'

export interface LocalCopySummary {
  count: number
  lastCreatedAt: string | null
}

export interface RecoveryInputs {
  data: AppData
  today: LocalDate
  backend: StorageBackend
  /** `null` cuando el navegador no ofrece copias locales (sin IndexedDB). */
  localCopies: LocalCopySummary | null
  /** Existe `margen.data.before-v<versión actual>` en este navegador. */
  preMigrationCopy: boolean
  errorCount: number
  offlineReady: boolean
}

export interface RecoveryRow {
  id: RecoveryRowId
  state: RecoveryState
  params: Record<string, string | number>
  href: string
}

export interface RecoveryStep {
  id: RecoveryStepId
  available: boolean
  params: Record<string, string | number>
  href: string
}

export interface RecoveryStatus {
  overall: RecoveryState
  rows: RecoveryRow[]
  /** Orden en que conviene intentar recuperar: de lo más completo a lo más parcial. */
  steps: RecoveryStep[]
  backup: BackupStatus
}

const RANK: Record<RecoveryState, number> = { ok: 0, info: 1, warn: 2, critical: 3 }
/** Una copia verificada hace más de este tiempo ya no da garantía de que la última exportación abra. */
export const VERIFIED_STALE_DAYS = 90

export function recoveryStatus(input: RecoveryInputs): RecoveryStatus {
  const { data, today } = input
  const backup = backupStatus(data, today)
  const rows: RecoveryRow[] = []
  const tz = data.settings.timeZone
  const dayOf = (iso: string) => localDateInTimeZone(new Date(iso), tz)

  rows.push({
    id: 'saving',
    state: input.backend === 'memory' ? 'critical' : 'ok',
    params: { backend: input.backend },
    href: '',
  })

  rows.push({
    id: 'export',
    state: data.isDemo ? 'info' : backup.neverExported ? 'critical' : backup.hasUnbackedChanges ? 'warn' : 'ok',
    params: { lastExport: backup.lastExportAt ?? '', unbacked: backup.hasUnbackedChanges ? 1 : 0, demo: data.isDemo ? 1 : 0 },
    href: '/ajustes/copia',
  })

  const verifiedAgo = backup.lastVerifiedAt ? daysBetween(dayOf(backup.lastVerifiedAt), today) : null
  rows.push({
    id: 'verified',
    state: data.isDemo ? 'info' : !backup.lastVerifiedAt ? 'warn' : backup.latestExportUnverified || (verifiedAgo !== null && verifiedAgo > VERIFIED_STALE_DAYS) ? 'info' : 'ok',
    params: { lastVerified: backup.lastVerifiedAt ?? '', latestUnverified: backup.latestExportUnverified ? 1 : 0, days: verifiedAgo ?? 0 },
    href: '/ajustes/copia',
  })

  rows.push({
    id: 'localCopies',
    state: input.localCopies === null ? 'warn' : input.localCopies.count === 0 ? 'info' : 'ok',
    params: { count: input.localCopies?.count ?? 0, last: input.localCopies?.lastCreatedAt ?? '', available: input.localCopies === null ? 0 : 1 },
    href: '/ajustes/copias-locales',
  })

  rows.push({
    id: 'preMigration',
    state: input.preMigrationCopy ? 'ok' : 'info',
    params: { version: data.schemaVersion, present: input.preMigrationCopy ? 1 : 0 },
    href: '',
  })

  rows.push({ id: 'schema', state: 'ok', params: { version: data.schemaVersion }, href: '/ajustes/acerca' })

  rows.push({
    id: 'records',
    state: 'ok',
    params: { transactions: data.transactions.length, accounts: data.accounts.length, schedules: data.schedules.length, goals: data.goals.length },
    href: '/movimientos',
  })

  rows.push({ id: 'trash', state: data.trash.length > 0 ? 'info' : 'ok', params: { count: data.trash.length }, href: '/movimientos/papelera' })

  rows.push({ id: 'history', state: 'ok', params: { count: data.history.length }, href: '/ajustes/historial' })

  rows.push({ id: 'errors', state: input.errorCount > 0 ? 'info' : 'ok', params: { count: input.errorCount }, href: '/ajustes/acerca' })

  rows.push({ id: 'offline', state: input.offlineReady ? 'ok' : 'info', params: { ready: input.offlineReady ? 1 : 0 }, href: '/ajustes/instalar' })

  const steps: RecoveryStep[] = [
    { id: 'export', available: !backup.neverExported, params: { lastExport: backup.lastExportAt ?? '' }, href: '/ajustes/copia' },
    { id: 'localCopies', available: (input.localCopies?.count ?? 0) > 0, params: { count: input.localCopies?.count ?? 0 }, href: '/ajustes/copias-locales' },
    { id: 'preMigration', available: input.preMigrationCopy, params: { version: data.schemaVersion }, href: '' },
    { id: 'trash', available: data.trash.length > 0, params: { count: data.trash.length }, href: '/movimientos/papelera' },
    { id: 'history', available: data.history.length > 0, params: { count: data.history.length }, href: '/ajustes/historial' },
  ]

  const overall = rows.reduce<RecoveryState>((worst, r) => (RANK[r.state] > RANK[worst] ? r.state : worst), 'ok')
  return { overall, rows, steps, backup }
}
