import { useMemo, useState } from 'react'
import { addDays } from '../../domain/dates'
import { planItems, type PlanItem } from '../../domain/planItems'
import { endSchedule, scheduleSummary, setSchedulePaused } from '../../domain/scheduledJobs'
import { useT } from '../../i18n'
import { useRun, useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { BottomSheet } from '../components/base'
import { Alert, Badge } from '../components/common'
import { ConfirmDialog } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { useToast } from '../components/toastContext'
import { useFormat } from '../format'
import { accountName, frequencyLabel } from '../labels'
import { href } from '../router'

/**
 * Hoja de detalle de un pago o ingreso programado (etapa 2): qué es, cuándo toca, qué se pagó,
 * y las acciones con su alcance claro: marcar la próxima ocurrencia, pausar o reanudar, terminar
 * (nada después de hoy; lo pagado se conserva) y editar la serie. Nunca marca nada sola.
 */
export function ScheduleSheet({ scheduleId, onClose, onPay }: { scheduleId: string; onClose: () => void; onPay: (item: PlanItem) => void }) {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const [ending, setEnding] = useState(false)
  const summary = useMemo(() => scheduleSummary(data, scheduleId, today), [data, scheduleId, today])
  const nextOpen = useMemo(
    () => planItems(data, { today, from: today, to: addDays(today, 400), includeOverdueBefore: true }).find((i) => i.source === 'schedule' && i.sourceId === scheduleId && (i.state === 'pending' || i.state === 'overdue')),
    [data, today, scheduleId],
  )
  if (!summary) return null
  const s = summary.schedule
  const isIncome = s.kind === 'income'

  const togglePause = async () => {
    const { saved } = await run((d, c) => setSchedulePaused(d, s.id, !s.paused, c))
    toast({ message: saved ? t(s.paused ? 'scheduled.resumedToast' : 'scheduled.pausedToast') : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
  }
  const end = async () => {
    const { result, saved } = await run((d, c) => endSchedule(d, s.id, today, c))
    setEnding(false)
    toast({ message: result.ok && saved ? t('schedule.ended') : t('save.error.generic'), tone: result.ok && saved ? 'good' : 'critical' })
    if (result.ok && saved) onClose()
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={s.name}
      footer={
        <>
          <a className="btn btn--secondary" href={href(`/plan/programado/editar/${s.id}`)}>
            <Icon name="edit" size={16} />
            {t('schedule.editSeries')}
          </a>
          {nextOpen && !s.paused && (
            <button type="button" className="btn btn--primary" onClick={() => onPay(nextOpen)}>
              <Icon name="check" size={16} />
              {isIncome ? t('calendar.markReceived') : t('calendar.markPaid')}
            </button>
          )}
        </>
      }
    >
      <div className="stack-sm sched-sheet" data-testid="schedule-sheet">
        <p className="sched-sheet__amount">
          {fmt.money(s.amountMinor)} {s.amountIsEstimate && <Badge>{t('state.estimate')}</Badge>}
          {s.paused && <Badge tone="neutral">{t('calendar.pausedBadge')}</Badge>}
        </p>
        <p className="item__meta">
          {frequencyLabel(t, s.frequency)} · {accountName(data.accounts, s.accountId, t)} · {s.reminderDaysBefore > 0 ? t('schedule.reminder', { days: s.reminderDaysBefore }) : t('schedule.reminderNone')}
        </p>
        {summary.overdue.length > 0 && <Alert tone="warning" icon="alert" title={t('schedule.sheetOverdue', { count: summary.overdue.length })} />}
        <section aria-labelledby="sched-next">
          <h3 id="sched-next" className="sched-sheet__title">
            {t('schedule.sheetNext')}
          </h3>
          {summary.next.length === 0 ? (
            <p className="note">{t('calendar.noNext')}</p>
          ) : (
            <ul className="bullets" data-testid="schedule-next">
              {summary.next.map((d) => (
                <li key={d}>{fmt.date(d, { weekday: true, compact: true, today })}</li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="sched-history">
          <h3 id="sched-history" className="sched-sheet__title">
            {t('schedule.sheetHistory')} · {t('schedule.sheetCounts', { count: summary.paidCount, skipped: summary.skippedCount })}
          </h3>
          {summary.paid.length === 0 ? (
            <p className="note">{t('schedule.sheetNoHistory')}</p>
          ) : (
            <ul className="plain-list sched-sheet__paid" data-testid="schedule-paid">
              {summary.paid.slice(0, 6).map((p) => (
                <li key={p.txId}>
                  <a href={href(`/movimientos/editar/${p.txId}?returnTo=/plan/calendario`)}>
                    {fmt.date(p.date, { compact: true, today })} · {fmt.money(p.amountMinor)}
                    {p.partial ? ` · ${t('schedule.sheetPartial')}` : ''}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <p className="note">{t('schedule.scopeNote')}</p>
        <div className="button-row">
          <button type="button" className="btn btn--small btn--secondary" onClick={() => void togglePause()}>
            <Icon name={s.paused ? 'repeat' : 'clock'} size={16} />
            {s.paused ? t('schedule.resume') : t('schedule.pause')}
          </button>
          {!(s.endDate && s.endDate <= today) && (
            <button type="button" className="btn btn--small btn--danger-ghost" onClick={() => setEnding(true)}>
              <Icon name="x" size={16} />
              {t('schedule.end')}
            </button>
          )}
        </div>
      </div>
      {ending && (
        <ConfirmDialog open title={t('schedule.endTitle', { name: s.name })} confirmLabel={t('schedule.end')} onConfirm={() => void end()} onCancel={() => setEnding(false)} destructive>
          <p>{t('schedule.endText')}</p>
        </ConfirmDialog>
      )}
    </BottomSheet>
  )
}
