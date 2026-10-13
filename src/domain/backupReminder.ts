/**
 * Recordatorio de copias de seguridad (ver docs/FORMULAS.md §15).
 *
 * Guardar en el navegador NO es una copia de seguridad: si se borran los datos del
 * sitio, se pierden. La app solo sabe que GENERÓ un archivo y pidió al navegador
 * descargarlo; no puede comprobar dónde se guardó. Por eso distingue:
 *  - exportación solicitada (`lastExportAt`), y
 *  - copia verificada (`lastVerifiedAt`): la persona eligió el archivo y la app
 *    comprobó que es válido y de este presupuesto.
 *
 * Estas operaciones no cambian `AppData.updatedAt`: registrar una copia no es un dato nuevo.
 */
import { addDays, isValidTimestamp, localDateInTimeZone } from './dates'
import type { OpContext, OpResult } from './operations'
import type { AppData, BackupReminder, LocalDate, Timestamp } from './types'

export const REMINDER_INTERVAL_DAYS: Record<Exclude<BackupReminder, 'off'>, number> = { weekly: 7, monthly: 30 }
export const SNOOZE_OPTIONS = [3, 7] as const

export interface BackupStatus {
  neverExported: boolean
  lastExportAt: Timestamp | null
  /** Hay cambios en los datos posteriores a la última exportación (o nunca se exportó). */
  hasUnbackedChanges: boolean
  lastVerifiedAt: Timestamp | null
  verifiedExportedAt: Timestamp | null
  /** La última exportación solicitada no se ha verificado todavía. */
  latestExportUnverified: boolean
  /** Fecha a partir de la cual se recuerda (null si está desactivado). */
  dueDate: LocalDate | null
  snoozedUntil: LocalDate | null
  /** Mostrar el recordatorio ahora. */
  due: boolean
}

export function backupStatus(data: AppData, today: LocalDate): BackupStatus {
  const b = data.backup
  const tz = data.settings.timeZone
  const hasUnbackedChanges = !b.lastExportDataAt || data.updatedAt > b.lastExportDataAt
  // El plazo cuenta desde la última exportación o, si nunca hubo, desde que se crearon los datos.
  const since = localDateInTimeZone(new Date(b.lastExportAt ?? data.createdAt), tz)
  const dueDate = b.reminder === 'off' ? null : addDays(since, REMINDER_INTERVAL_DAYS[b.reminder])
  const snoozed = !!b.snoozedUntil && today < b.snoozedUntil
  const due = !data.isDemo && dueDate !== null && hasUnbackedChanges && today >= dueDate && !snoozed
  return {
    neverExported: !b.lastExportAt,
    lastExportAt: b.lastExportAt ?? null,
    hasUnbackedChanges,
    lastVerifiedAt: b.lastVerifiedAt ?? null,
    verifiedExportedAt: b.verifiedExportedAt ?? null,
    latestExportUnverified: !!b.lastExportAt && (!b.verifiedExportedAt || b.verifiedExportedAt < b.lastExportAt),
    dueDate,
    snoozedUntil: b.snoozedUntil ?? null,
    due,
  }
}

/**
 * Registra una exportación SOLICITADA con éxito. Llamar solo después de generar el
 * archivo y pedir la descarga sin errores: una exportación fallida no se registra.
 */
export function recordExport(data: AppData, exportedAt: Timestamp): OpResult<undefined> {
  const { snoozedUntil: _cleared, ...rest } = data.backup
  return { ok: true, data: { ...data, backup: { ...rest, lastExportAt: exportedAt, lastExportDataAt: data.updatedAt } }, value: undefined }
}

/** Registra que la persona tiene un archivo de copia válido de ESTE presupuesto. */
export function recordVerification(
  data: AppData,
  file: { budgetId: string; exportedAt: Timestamp | null },
  ctx: OpContext,
): OpResult<undefined> {
  if (file.budgetId !== data.budgetId) return { ok: false, issues: [{ path: 'file', code: 'notABackupOfThisBudget' }] }
  // REC-02: nunca se guarda una fecha que no lo es (haría ilegibles los datos al recargar).
  if (file.exportedAt !== null && !isValidTimestamp(file.exportedAt)) return { ok: false, issues: [{ path: 'exportedAt', code: 'invalidTimestamp' }] }
  return {
    ok: true,
    data: {
      ...data,
      backup: { ...data.backup, lastVerifiedAt: ctx.now, ...(file.exportedAt ? { verifiedExportedAt: file.exportedAt } : {}) },
    },
    value: undefined,
  }
}

/** No volver a recordar hasta dentro de `days` días. */
export function snoozeBackupReminder(data: AppData, days: number, ctx: OpContext): OpResult<undefined> {
  if (!Number.isInteger(days) || days < 1 || days > 60) return { ok: false, issues: [{ path: 'days', code: 'invalidValue' }] }
  return { ok: true, data: { ...data, backup: { ...data.backup, snoozedUntil: addDays(ctx.today, days) } }, value: undefined }
}

export function setBackupReminder(data: AppData, reminder: BackupReminder): OpResult<undefined> {
  if (reminder !== 'weekly' && reminder !== 'monthly' && reminder !== 'off') return { ok: false, issues: [{ path: 'reminder', code: 'invalidValue' }] }
  if (data.backup.reminder === reminder) return { ok: true, data, value: undefined, unchanged: true }
  return { ok: true, data: { ...data, backup: { ...data.backup, reminder } }, value: undefined }
}
