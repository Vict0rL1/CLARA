/** Acciones de copia de seguridad compartidas por Inicio y Ajustes. */
import { recordExport, recordVerification, snoozeBackupReminder } from '../domain/backupReminder'
import { useT } from '../i18n'
import { useRun } from '../state/hooks'
import { getStore } from '../state/store'
import { MAX_BACKUP_BYTES, parseBackup, performExport, type ImportIssue } from '../storage/backup'
import { deliverFile } from './backupDelivery'
import { useToast } from './components/toastContext'
import { useFormat } from './format'

import { APP_VERSION } from './version'

export { APP_VERSION }

/** Pide al navegador descargar un archivo de texto. */
export function downloadText(filename: string, text: string, type = 'application/json') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Exporta y SOLO si el archivo se entregó registra la exportación: con la hoja de compartir del
 * sistema cuando el navegador puede compartir archivos (iPhone: «Guardar en Archivos»), si no con
 * la descarga de siempre (K1). Cerrar la hoja sin elegir destino no es exportar ni es un error.
 * El navegador no confirma dónde quedó el archivo: el texto lo dice así.
 */
export interface ExportOutcome {
  /** El archivo llegó a la persona (descarga pedida o compartido). */
  delivered: boolean
  /** Además se anotó en el registro de copias (si el almacén no pudo guardar, el archivo existe igual). */
  recorded: boolean
}

const NOT_DELIVERED: ExportOutcome = { delivered: false, recorded: false }

export function useExportBackup() {
  const { t } = useT()
  const run = useRun()
  const toast = useToast()
  return async (): Promise<ExportOutcome> => {
    const data = getStore().data
    if (!data) return NOT_DELIVERED
    let file: { filename: string; text: string } | null = null
    const result = performExport(data, new Date(), APP_VERSION, (filename, text) => {
      file = { filename, text }
    })
    if (!result.ok || !file) {
      toast({ message: t('backup.exportFailed'), tone: 'critical' })
      return NOT_DELIVERED
    }
    const { filename, text } = file as { filename: string; text: string }
    let delivery: Awaited<ReturnType<typeof deliverFile>>
    try {
      delivery = await deliverFile(filename, text, { nav: typeof navigator === 'undefined' ? undefined : navigator, download: downloadText })
    } catch {
      // La descarga no se pudo pedir (p. ej. el navegador la bloquea): no se registra nada.
      toast({ message: t('backup.exportFailed'), tone: 'critical' })
      return NOT_DELIVERED
    }
    if (delivery === 'cancelled') return NOT_DELIVERED
    const { saved } = await run((d) => recordExport(d, result.exportedAt))
    const done = delivery === 'shared' ? t('settings.backup.shared') : t('settings.backup.exported')
    // El archivo ya salió: si el registro no se pudo guardar se dice eso, no que la copia falló (revisión de seguridad QA27, O-1).
    toast(saved ? { message: done, tone: 'good' } : { message: t('settings.backup.exportedNotRecorded'), tone: 'info', durationMs: 12_000 })
    return { delivered: true, recorded: saved }
  }
}

export function useSnoozeBackup() {
  const { t } = useT()
  const fmt = useFormat()
  const run = useRun()
  const toast = useToast()
  return async (days: number) => {
    const { result, saved } = await run((d, c) => snoozeBackupReminder(d, days, c))
    if (!result.ok) return
    const until = result.data.backup.snoozedUntil
    toast({ message: saved && until ? t('home.backup.snoozed', { date: fmt.date(until) }) : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
  }
}

/** Comprueba un archivo de copia SIN importarlo y registra la verificación. */
export function useVerifyBackup() {
  const { t } = useT()
  const run = useRun()
  const toast = useToast()
  return async (file: File): Promise<{ ok: true } | { ok: false; issues: ImportIssue[] }> => {
    if (file.size > MAX_BACKUP_BYTES) return { ok: false, issues: [{ path: 'file', code: 'tooLarge' }] }
    const parsed = parseBackup(await file.text())
    if (!parsed.ok) return { ok: false, issues: parsed.issues }
    const { result, saved } = await run((d, c) => recordVerification(d, { budgetId: parsed.data.budgetId, exportedAt: parsed.exportedAt }, c))
    if (!result.ok) return { ok: false, issues: result.issues }
    toast({ message: saved ? t('backup.verifiedDone') : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
    return { ok: true }
  }
}
