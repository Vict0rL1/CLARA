/**
 * Revisión de particiones antiguas (auditoría de seguimiento, QA-01 histórico): los tramos que una versión anterior
 * dejó contando desde una fecha movida, con sus próximas fechas tal como están y como quedarían. Nada cambia sin
 * confirmar; antes de reparar se guarda una copia local y el cambio queda en el historial. El cálculo es
 * `domain/splitRepair.ts`; aquí solo se muestra y se llama a la operación.
 */
import { useMemo, useState } from 'react'
import { newId } from '../../../domain/ids'
import { dismissSplitRepair, driftedSplits, repairSplit, type DriftedSplit } from '../../../domain/splitRepair'
import { useT } from '../../../i18n'
import { useRun, useToday } from '../../../state/hooks'
import { getStore, useData } from '../../../state/store'
import { useExportBackup } from '../../backupActions'
import { Card } from '../../components/common'
import { ConfirmDialog } from '../../components/Dialog'
import { Icon } from '../../components/Icon'
import { useToast } from '../../components/toastContext'
import { useFormat } from '../../format'
import { keepCopyBeforeReplace, localBackups } from '../../useAutoBackup'

export function SplitRepairCard() {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const exportData = useExportBackup()
  const [confirm, setConfirm] = useState<DriftedSplit | null>(null)
  // Mientras se guarda, los botones no aceptan un segundo toque (revisión de seguridad O-4: el segundo intento ya no
  // encontraba la partición y avisaba de un error que no era tal).
  const [busy, setBusy] = useState(false)
  // QA27-04: sin copia local previa no se restaura. Si este navegador no guarda copias locales (sin IndexedDB) o la
  // copia falla, vale una copia DESCARGADA desde esta tarjeta de los datos tal como están ahora (`updatedAt`): si algo
  // cambia después, hay que descargarla de nuevo.
  const [exportedFor, setExportedFor] = useState<string | null>(null)
  const localCopies = localBackups() !== null
  const drifts = useMemo(() => driftedSplits(data, today), [data, today])
  if (drifts.length === 0) return null

  const dates = (list: string[]) => fmt.list(list.map((d) => fmt.date(d, { compact: true, today })))
  const exportFirst = async () => {
    if (busy) return
    const before = getStore().data?.updatedAt ?? null
    const ok = await exportData()
    if (ok && before !== null) setExportedFor(before)
  }
  const restore = async (d: DriftedSplit) => {
    setConfirm(null)
    if (busy) return
    setBusy(true)
    try {
      // Copia local de lo actual antes de tocar fechas (como al importar). Sin copia —no se pudo guardar, o este
      // navegador no guarda copias locales— solo se sigue si hay una copia descargada de ESTOS datos; si no, nada cambia.
      const current = getStore().data
      const copy = await keepCopyBeforeReplace(current)
      if (copy !== 'kept' && (current === null || exportedFor !== current.updatedAt)) {
        return toast({ message: t(copy === 'failed' ? 'localBackup.failed' : 'splitRepair.copyUnavailable'), tone: 'critical' })
      }
      // El id del tramo nuevo (si lo pagado obliga a partir) se genera aquí, como en cualquier formulario.
      const nextId = newId()
      const { result, saved } = await run((current, c) => repairSplit(current, d.scheduleId, c, nextId))
      toast(result.ok && saved ? { message: t('splitRepair.done'), tone: 'good' } : { message: t('save.error.generic'), tone: 'critical' })
    } finally {
      setBusy(false)
    }
  }
  const keep = async (d: DriftedSplit) => {
    if (busy) return
    setBusy(true)
    try {
      const { result, saved } = await run((current, c) => dismissSplitRepair(current, d.scheduleId, c))
      toast(result.ok && saved ? { message: t('splitRepair.kept'), tone: 'good' } : { message: t('save.error.generic'), tone: 'critical' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card labelledBy="split-repair-title">
      <div data-testid="split-repair">
        <h2 id="split-repair-title" className="card__title">
          {t('splitRepair.title')}
        </h2>
        <p>{t('splitRepair.intro')}</p>
        {!localCopies && (
          <p className="note note--icon" data-testid="split-repair-no-local-copy">
            {t('splitRepair.copyUnavailableNote')}
          </p>
        )}
        <ul className="item-list">
          {drifts.map((d) => (
            <li key={d.scheduleId} data-testid={`split-repair-${d.scheduleId}`}>
              <p className="item__title">{d.name}</p>
              <p className="note" data-testid="split-repair-current">
                {t('splitRepair.current', { date: fmt.date(d.startDate, { compact: true, today }), dates: dates(d.current) })}
              </p>
              <p className="note" data-testid="split-repair-proposed">
                {t('splitRepair.proposed', { date: fmt.date(d.anchor, { compact: true, today }), dates: dates(d.proposed) })}
              </p>
              <div className="button-row">
                <button type="button" className="btn btn--primary btn--small" disabled={busy} onClick={() => setConfirm(d)}>
                  <Icon name="calendar" size={16} />
                  {t('splitRepair.restore')}
                </button>
                <button type="button" className="btn btn--secondary btn--small" disabled={busy} onClick={() => void keep(d)}>
                  {t('splitRepair.keep')}
                </button>
                <button type="button" className="btn btn--ghost btn--small" onClick={() => void exportFirst()}>
                  <Icon name="download" size={16} />
                  {t('splitRepair.exportFirst')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <ConfirmDialog open={confirm !== null} title={t('splitRepair.confirmTitle', { name: confirm?.name ?? '' })} confirmLabel={t('splitRepair.restore')} onConfirm={() => confirm && void restore(confirm)} onCancel={() => setConfirm(null)}>
        <p>{confirm ? t(localCopies ? 'splitRepair.confirmText' : 'splitRepair.confirmTextNoLocalCopy', { dates: dates(confirm.proposed) }) : ''}</p>
      </ConfirmDialog>
    </Card>
  )
}
