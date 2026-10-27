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
import { keepCopyBeforeReplace } from '../../useAutoBackup'

export function SplitRepairCard() {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const exportData = useExportBackup()
  const [confirm, setConfirm] = useState<DriftedSplit | null>(null)
  const drifts = useMemo(() => driftedSplits(data, today), [data, today])
  if (drifts.length === 0) return null

  const dates = (list: string[]) => fmt.list(list.map((d) => fmt.date(d, { compact: true, today })))
  const restore = async (d: DriftedSplit) => {
    setConfirm(null)
    // Copia local de lo actual antes de tocar fechas (como al importar); si no se puede guardar, no se repara.
    const copy = await keepCopyBeforeReplace(getStore().data)
    if (copy === 'failed') return toast({ message: t('localBackup.failed'), tone: 'critical' })
    // El id del tramo nuevo (si lo pagado obliga a partir) se genera aquí, como en cualquier formulario.
    const nextId = newId()
    const { result, saved } = await run((current, c) => repairSplit(current, d.scheduleId, c, nextId))
    toast(result.ok && saved ? { message: t('splitRepair.done'), tone: 'good' } : { message: t('save.error.generic'), tone: 'critical' })
  }
  const keep = async (d: DriftedSplit) => {
    const { result, saved } = await run((current, c) => dismissSplitRepair(current, d.scheduleId, c))
    toast(result.ok && saved ? { message: t('splitRepair.kept'), tone: 'good' } : { message: t('save.error.generic'), tone: 'critical' })
  }

  return (
    <Card labelledBy="split-repair-title">
      <div data-testid="split-repair">
        <h2 id="split-repair-title" className="card__title">
          {t('splitRepair.title')}
        </h2>
        <p>{t('splitRepair.intro')}</p>
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
                <button type="button" className="btn btn--primary btn--small" onClick={() => setConfirm(d)}>
                  <Icon name="calendar" size={16} />
                  {t('splitRepair.restore')}
                </button>
                <button type="button" className="btn btn--secondary btn--small" onClick={() => void keep(d)}>
                  {t('splitRepair.keep')}
                </button>
                <button type="button" className="btn btn--ghost btn--small" onClick={() => void exportData()}>
                  <Icon name="download" size={16} />
                  {t('splitRepair.exportFirst')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <ConfirmDialog open={confirm !== null} title={t('splitRepair.confirmTitle', { name: confirm?.name ?? '' })} confirmLabel={t('splitRepair.restore')} onConfirm={() => confirm && void restore(confirm)} onCancel={() => setConfirm(null)}>
        <p>{confirm ? t('splitRepair.confirmText', { dates: dates(confirm.proposed) }) : ''}</p>
      </ConfirmDialog>
    </Card>
  )
}
