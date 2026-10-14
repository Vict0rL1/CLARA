import { useMemo, useState } from 'react'
import { addDays, addMonthsClamped, endOfMonth, startOfMonth, weekday } from '../../domain/dates'
import { closeOccurrence, deleteTransaction, revertTransaction, setOccurrenceSkipped } from '../../domain/operations'
import { useRestoreFromTrash } from '../useDeleteTransaction'
import { nextPendingOccurrence } from '../../domain/repeat'
import { categoryVisual, categoryVisuals } from '../../domain/categories'
import { CategoryIcon } from '../components/CategoryIcon'
import { planItems, type PlanItem } from '../../domain/planItems'
import { useT, type MessageKey } from '../../i18n'
import { useRun, useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { Alert, Badge, Card, EmptyState, Why, type Tone } from '../components/common'
import { Icon } from '../components/Icon'
import { useToast } from '../components/toastContext'
import { MarkPaidDialog } from '../dialogs'
import { useFormat } from '../format'
import { frequencyLabel, planItemName } from '../labels'
import { href } from '../router'
import { ScheduleSheet } from './ScheduleSheet'

const STATE_TONE: Record<PlanItem['state'], Tone> = { pending: 'info', overdue: 'warning', paid: 'good', skipped: 'neutral' }

export function Calendar() {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const [month, setMonth] = useState(() => startOfMonth(today))
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [payItem, setPayItem] = useState<PlanItem | null>(null)
  const [sheetFor, setSheetFor] = useState<string | null>(null)
  const restore = useRestoreFromTrash()

  const monthEnd = endOfMonth(month)
  const monthItems = useMemo(() => planItems(data, { today, from: month, to: monthEnd }), [data, today, month, monthEnd])
  const visuals = useMemo(() => categoryVisuals(data), [data])
  const overdueAll = useMemo(
    () => planItems(data, { today, from: today, to: today, includeOverdueBefore: true }).filter((i) => i.state === 'overdue' && i.date < month),
    [data, today, month],
  )
  const listed = selectedDay ? monthItems.filter((i) => i.date === selectedDay) : monthItems

  // Cuadrícula que empieza en lunes.
  const offset = (weekday(month) + 6) % 7
  const gridStart = addDays(month, -offset)
  const cells: string[] = []
  for (let d = gridStart; d <= monthEnd || cells.length % 7 !== 0; d = addDays(d, 1)) cells.push(d)
  const weekdays = cells.slice(0, 7).map((d) => fmt.weekdayShort(d))

  const skip = async (item: PlanItem, skipped: boolean) => {
    const { saved } = await run((d, c) => setOccurrenceSkipped(d, item.sourceId, item.date, skipped, c))
    toast({
      message: saved ? t(skipped ? 'calendar.skipped' : 'calendar.unskipped', { name: planItemName(item, t) }) : t('save.error.generic'),
      tone: saved ? 'good' : 'critical',
      action: { label: t('common.undo'), onClick: () => void run((d, c) => setOccurrenceSkipped(d, item.sourceId, item.date, !skipped, c)) },
    })
  }

  // Cobro parcial: dar la previsión por terminada (el último parcial pasa a ser el final).
  const close = async (item: PlanItem) => {
    const previous = data.transactions.filter((x) => item.partialTxIds?.includes(x.id))
    const { result, saved } = await run((d, c) => closeOccurrence(d, item.sourceId, item.date, c))
    if (!result.ok) return
    toast({
      message: saved ? t('calendar.closed', { name: planItemName(item, t) }) : t('save.error.generic'),
      tone: saved ? 'good' : 'critical',
      action: {
        label: t('common.undo'),
        onClick: () => {
          const last = previous.find((x) => x.id === result.value.id)
          if (last) void run((d, c) => revertTransaction(d, last, c))
        },
      },
    })
  }

  // Desmarcar = enviar el movimiento que lo pagó a la papelera (la ocurrencia vuelve a reservarse).
  const unmark = async (item: PlanItem) => {
    if (!item.settledByTxId) return
    const txId = item.settledByTxId
    const { result, saved } = await run((d, c) => deleteTransaction(d, txId, c))
    if (!result.ok) return
    toast({
      message: saved ? t('calendar.unmarked', { name: planItemName(item, t) }) : t('save.error.generic'),
      tone: saved ? 'good' : 'critical',
      action: { label: t('common.undo'), onClick: () => void restore(txId) },
    })
  }

  const renderItem = (i: PlanItem) => {
    const name = planItemName(i, t)
    const stateLabel = i.state === 'paid' ? t(i.direction === 'income' ? 'state.received' : 'state.paid') : t(`state.${i.state}` as MessageKey)
    return (
      <li key={i.key} className="item item--stacked">
        <div className="item__row">
          <div className="item__main">
            <p className="item__title">{name}</p>
            <p className="item__meta">
              {fmt.date(i.date, { weekday: true, compact: true, today })}
              {i.date === today ? ` · ${t('relative.today')}` : ''}
              {' · '}
              {i.source === 'schedule' ? frequencyLabel(t, data.schedules.find((s) => s.id === i.sourceId)?.frequency ?? 'once') : t('calendar.plannedMovement')}
            </p>
            <p className="item__badges">
              <Badge tone={STATE_TONE[i.state]} icon={i.state === 'paid' ? 'check' : i.state === 'overdue' ? 'alert' : i.state === 'skipped' ? 'skip' : 'clock'}>
                {stateLabel}
              </Badge>
              <Badge icon={i.direction === 'income' ? 'arrowDown' : i.direction === 'transfer' ? 'transfer' : 'arrowUp'}>{t(`txKind.${i.direction}` as MessageKey)}</Badge>
              {i.isEstimate && <Badge>{t('state.estimate')}</Badge>}
            </p>
            {i.range && i.state !== 'paid' && (
              <p className="item__meta">{t('calendar.range', { min: fmt.money(i.range.minMinor), extra: fmt.money(i.range.extraMinor) })}</p>
            )}
            {!!i.receivedMinor && i.state !== 'paid' && (
              <p className="item__meta">{t('calendar.partialReceived', { received: fmt.money(i.receivedMinor), remaining: fmt.money(i.amountMinor) })}</p>
            )}
          </div>
          <p className="item__amount">{fmt.money(i.amountMinor)}</p>
        </div>
        <div className="item__actions">
          {(i.state === 'pending' || i.state === 'overdue') && (
            <button type="button" className="btn btn--small btn--primary" onClick={() => setPayItem(i)}>
              <Icon name="check" size={16} />
              {i.direction === 'income' ? t('calendar.markReceived') : t('calendar.markPaid')}
              <span className="sr-only">: {name}</span>
            </button>
          )}
          {i.source === 'schedule' && (i.state === 'pending' || i.state === 'overdue') && !!i.partialTxIds?.length && (
            <button type="button" className="btn btn--small btn--secondary" onClick={() => void close(i)}>
              <Icon name="check" size={16} />
              {t('calendar.closeRemaining')}
              <span className="sr-only">: {name}</span>
            </button>
          )}
          {i.source === 'schedule' && (i.state === 'pending' || i.state === 'overdue') && !i.partialTxIds?.length && (
            <button type="button" className="btn btn--small btn--secondary" onClick={() => void skip(i, true)}>
              <Icon name="skip" size={16} />
              {t('calendar.skip')}
              <span className="sr-only">: {name}</span>
            </button>
          )}
          {i.state === 'skipped' && (
            <button type="button" className="btn btn--small btn--secondary" onClick={() => void skip(i, false)}>
              {t('calendar.unskip')}
              <span className="sr-only">: {name}</span>
            </button>
          )}
          {i.state === 'paid' && i.settledByTxId && (
            <>
              <a className="btn btn--small btn--secondary" href={href(`/movimientos/editar/${i.settledByTxId}?returnTo=/plan/calendario`)}>
                {t('calendar.viewMovement')}
              </a>
              <button type="button" className="btn btn--small btn--ghost" onClick={() => void unmark(i)}>
                <Icon name="undo" size={16} />
                {t('calendar.unmark')}
                <span className="sr-only">: {name}</span>
              </button>
            </>
          )}
          {i.source === 'schedule' && (
            <button type="button" className="btn btn--small btn--ghost" aria-label={`${t('calendar.details')}: ${name}`} onClick={() => setSheetFor(i.sourceId)}>
              <Icon name="list" size={16} />
              {t('calendar.details')}
            </button>
          )}
          <a
            className="btn btn--small btn--ghost"
            href={href(i.source === 'schedule' ? `/plan/programado/editar/${i.sourceId}` : `/movimientos/editar/${i.sourceId}?returnTo=/plan/calendario`)}
          >
            <Icon name="edit" size={16} />
            {t('common.edit')}
            <span className="sr-only">: {name}</span>
          </a>
        </div>
      </li>
    )
  }

  return (
    <div className="stack">
      <div className="button-row">
        <a className="btn btn--primary" href={href('/plan/programado/nuevo')}>
          <Icon name="plus" />
          {t('calendar.new')}
        </a>
      </div>
      <Alert tone="neutral" icon="info" title={t('calendar.remindersNoteTitle')}>
        <Why short={t('calendar.remindersShort')}>{t('calendar.remindersNote')}</Why>
      </Alert>

      {overdueAll.length > 0 && (
        <Card labelledBy="overdue-title">
          <h2 id="overdue-title" className="card__title">
            <Icon name="alert" />
            {t('calendar.overdueEarlier')}
          </h2>
          <ul className="item-list">{overdueAll.map(renderItem)}</ul>
        </Card>
      )}

      <Card labelledBy="month-title">
        <div className="month-nav">
          <button type="button" className="btn btn--ghost btn--icon" onClick={() => { setMonth(addMonthsClamped(month, -1, 1)); setSelectedDay(null) }} aria-label={t('calendar.prevMonth')}>
            <Icon name="chevronLeft" />
          </button>
          <h2 id="month-title" className="month-nav__title" aria-live="polite">
            {fmt.monthYear(month)}
          </h2>
          <button type="button" className="btn btn--ghost btn--icon" onClick={() => { setMonth(addMonthsClamped(month, 1, 1)); setSelectedDay(null) }} aria-label={t('calendar.nextMonth')}>
            <Icon name="chevronRight" />
          </button>
        </div>
        {month !== startOfMonth(today) && (
          <button type="button" className="btn btn--ghost btn--small" onClick={() => { setMonth(startOfMonth(today)); setSelectedDay(null) }}>
            {t('calendar.backToToday')}
          </button>
        )}
        <table className="cal-grid" aria-labelledby="month-title">
          <thead>
            <tr>
              {weekdays.map((w, i) => (
                <th key={i} scope="col" className="cal-grid__weekday">
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: cells.length / 7 }, (_, row) => (
              <tr key={row}>
                {cells.slice(row * 7, row * 7 + 7).map((d) => {
                  const inMonth = d >= month && d <= monthEnd
                  const dayItems = inMonth ? monthItems.filter((i) => i.date === d) : []
                  const open = dayItems.filter((i) => i.state === 'pending' || i.state === 'overdue').length
                  const label = `${fmt.date(d, { weekday: true })}${dayItems.length ? ` · ${t('calendar.dayCount', { count: dayItems.length })}` : ''}`
                  return (
                    <td key={d} className="cal-grid__cell">
                      {inMonth && (
                        <button
                          type="button"
                          className={['cal-day', d === today ? 'is-today' : '', d === selectedDay ? 'is-selected' : '', dayItems.length ? 'has-items' : ''].join(' ')}
                          aria-pressed={d === selectedDay}
                          aria-label={label}
                          aria-current={d === today ? 'date' : undefined}
                          onClick={() => setSelectedDay(d === selectedDay ? null : d)}
                        >
                          <span className="cal-day__num">{Number(d.slice(8))}</span>
                          {dayItems.length > 0 && (
                            <span className={`cal-day__dot${open === 0 ? ' cal-day__dot--done' : ''}`} aria-hidden="true">
                              {dayItems.length}
                            </span>
                          )}
                        </button>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card labelledBy="agenda-title">
        <h2 id="agenda-title" className="card__title">
          {selectedDay ? t('calendar.dayTitle', { date: fmt.date(selectedDay, { weekday: true }) }) : t('calendar.monthTitle', { month: fmt.monthYear(month) })}
        </h2>
        {selectedDay && (
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setSelectedDay(null)}>
            {t('calendar.showMonth')}
          </button>
        )}
        {listed.length === 0 ? <EmptyState compact icon="calendar" title={t('calendar.empty')} /> : <ul className="item-list">{listed.map(renderItem)}</ul>}
      </Card>

      <Card labelledBy="schedules-title">
        <h2 id="schedules-title" className="card__title">
          {t('calendar.allSchedules')}
        </h2>
        {data.schedules.length === 0 ? (
          <EmptyState compact icon="calendar" title={t('calendar.noSchedules')} />
        ) : (
          <ul className="item-list">
            {data.schedules.map((s) => {
              const next = nextPendingOccurrence(data, s, today)
              return (
                <li key={s.id}>
                  <a className="item item--link" href={href(`/plan/programado/editar/${s.id}`)}>
                    <CategoryIcon icon={categoryVisual(visuals, s.categoryId).icon} color={categoryVisual(visuals, s.categoryId).color} />
                    <span className="item__main">
                      <span className="item__title">{s.name}</span>
                      <span className="item__meta">
                        {frequencyLabel(t, s.frequency)} · {next ? t('calendar.nextOn', { date: fmt.date(next, { compact: true, today }) }) : t('calendar.noNext')}
                      </span>
                    </span>
                    <span className="item__amount">
                      {s.amountIsEstimate ? '≈ ' : ''}
                      {fmt.money(s.amountMinor)}
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {payItem && <MarkPaidDialog key={payItem.key} item={payItem} onClose={() => setPayItem(null)} />}

      {sheetFor && <ScheduleSheet scheduleId={sheetFor} onClose={() => setSheetFor(null)} onPay={(item) => { setSheetFor(null); setPayItem(item) }} />}
    </div>
  )
}
