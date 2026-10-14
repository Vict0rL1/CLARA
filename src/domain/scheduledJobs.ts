/**
 * Programados v2 (§7.5): confirmación automática y pausa.
 *
 * - `autoConfirm` (apagado por defecto, decisión 10): al abrir la app o al cambiar el día, las
 *   ocurrencias vencidas o de hoy de ese programado se registran solas con su importe previsto,
 *   `source: 'scheduled'`. Solo las de los últimos `AUTO_CONFIRM_WINDOW_DAYS` días: activar la
 *   opción en un programado antiguo no registra meses de historia; lo anterior sigue como vencido.
 * - `paused`: el programado no genera ocurrencias (ni se reserva) mientras esté en pausa.
 * - Cobros o pagos parciales (QA-02): la confirmación automática registra solo lo que FALTA de la
 *   ocurrencia (`PlanItem.amountMinor`, la misma regla de remanente que usa el calendario), y si ya
 *   no falta nada la cierra sin crear un movimiento. Nunca vuelve a añadir el importe completo.
 */
import { addDays, isValidLocalDate } from './dates'
import { validateSchedule } from './validation'
import { closeOccurrence, markOccurrence, type OpContext, type OpResult } from './operations'
import { openItemsUntil, planItems, settlementIndex } from './planItems'
import type { AppData, LocalDate, Schedule, Transaction } from './types'

export const AUTO_CONFIRM_WINDOW_DAYS = 7

export interface AutoConfirmResult {
  confirmed: Transaction[]
}

/** Registra las ocurrencias debidas de los programados con confirmación automática. Idempotente. */
export function autoConfirmDue(data: AppData, ctx: OpContext): OpResult<AutoConfirmResult> {
  const auto = new Set(data.schedules.filter((s) => s.autoConfirm && !s.paused).map((s) => s.id))
  if (auto.size === 0) return { ok: true, data, value: { confirmed: [] }, unchanged: true }
  const since = addDays(ctx.today, -AUTO_CONFIRM_WINDOW_DAYS)
  const due = openItemsUntil(data, ctx.today, ctx.today).filter((i) => i.source === 'schedule' && auto.has(i.sourceId) && i.date >= since && i.date <= ctx.today)
  let next = data
  const confirmed: Transaction[] = []
  for (const item of due) {
    const schedule = next.schedules.find((s) => s.id === item.sourceId)!
    // `item.amountMinor` ya es lo que falta: importe previsto − parciales registrados (nunca negativo).
    const r =
      item.amountMinor > 0
        ? markOccurrence(next, { scheduleId: schedule.id, occurrenceDate: item.date, amountMinor: item.amountMinor, date: item.date, note: schedule.name, source: 'scheduled' }, ctx)
        : closeOccurrence(next, schedule.id, item.date, ctx)
    if (!r.ok) return r
    if (!r.unchanged) {
      next = r.data
      confirmed.push(r.value)
    }
  }
  if (confirmed.length === 0) return { ok: true, data, value: { confirmed: [] }, unchanged: true }
  return { ok: true, data: next, value: { confirmed } }
}

export function setSchedulePaused(data: AppData, id: string, paused: boolean, ctx: OpContext): OpResult<Schedule> {
  const schedule = data.schedules.find((s) => s.id === id)
  if (!schedule) return { ok: false, issues: [{ path: 'id', code: 'notFound' }] }
  if (!!schedule.paused === paused) return { ok: true, data, value: schedule, unchanged: true }
  const updated: Schedule = { ...schedule, paused, updatedAt: ctx.now }
  return { ok: true, data: { ...data, schedules: data.schedules.map((s) => (s.id === id ? updated : s)), updatedAt: ctx.now }, value: updated }
}

/**
 * Terminar un programado: no habrá ocurrencias después de `endDate`; las ya pagadas, omitidas y
 * sus movimientos se conservan tal cual. Nunca borra ni marca nada por sí mismo.
 */
export function endSchedule(data: AppData, id: string, endDate: LocalDate, ctx: OpContext): OpResult<Schedule> {
  const schedule = data.schedules.find((s) => s.id === id)
  if (!schedule) return { ok: false, issues: [{ path: 'id', code: 'notFound' }] }
  if (!isValidLocalDate(endDate)) return { ok: false, issues: [{ path: 'endDate', code: 'invalidDate' }] }
  if (endDate < schedule.startDate) return { ok: false, issues: [{ path: 'endDate', code: 'endBeforeStart' }] }
  if (schedule.endDate === endDate) return { ok: true, data, value: schedule, unchanged: true }
  const updated: Schedule = { ...schedule, endDate, updatedAt: ctx.now }
  const issues = validateSchedule(updated, { data })
  if (issues.length) return { ok: false, issues }
  return { ok: true, data: { ...data, schedules: data.schedules.map((s) => (s.id === id ? updated : s)), updatedAt: ctx.now }, value: updated }
}

export interface ScheduleSummary {
  schedule: Schedule
  /** Próximas fechas pendientes (hasta 3), sin las omitidas ni las ya pagadas. */
  next: LocalDate[]
  /** Ocurrencias ya liquidadas, la más reciente primero. */
  paid: { date: LocalDate; occurrenceDate: LocalDate; amountMinor: number; txId: string; partial: boolean }[]
  paidCount: number
  skippedCount: number
  /** Vencidas sin marcar a día de hoy. */
  overdue: LocalDate[]
}

/** Ficha de un programado para la hoja de detalle del calendario: historial y lo que viene. */
export function scheduleSummary(data: AppData, id: string, today: LocalDate, lookaheadDays = 400): ScheduleSummary | null {
  const schedule = data.schedules.find((s) => s.id === id)
  if (!schedule) return null
  const items = planItems(data, { today, from: today, to: addDays(today, lookaheadDays), includeOverdueBefore: true }).filter((i) => i.source === 'schedule' && i.sourceId === id)
  const open = items.filter((i) => i.state === 'pending' || i.state === 'overdue')
  const paid = data.transactions
    .filter((t) => t.scheduleId === id && t.status === 'realized' && t.occurrenceDate)
    .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : a.id < b.id ? -1 : 1))
    .map((t) => ({ date: t.date, occurrenceDate: t.occurrenceDate!, amountMinor: t.amountMinor, txId: t.id, partial: !!t.partialSettlement }))
  return {
    schedule,
    next: schedule.paused ? [] : open.map((i) => i.date).slice(0, 3),
    paid,
    paidCount: new Set(paid.map((p) => p.occurrenceDate)).size,
    skippedCount: schedule.skippedDates.length,
    overdue: open.filter((i) => i.state === 'overdue').map((i) => i.date),
  }
}

export interface OverstatedAutoConfirm {
  scheduleId: string
  occurrenceDate: LocalDate
  /** Movimiento de la confirmación automática que registró el importe completo. */
  finalTxId: string
  /** Parciales registrados antes para la misma ocurrencia. */
  partialTxIds: string[]
  /** Lo que se registró de más: la suma de los parciales. */
  excessMinor: number
}

/**
 * Detecta ocurrencias que la confirmación automática cerró con el importe COMPLETO del programado
 * aunque ya hubiera cobros o pagos parciales (el defecto QA-02, en datos anteriores a su corrección).
 * Solo detecta: no corrige ni borra nada. La persona decide desde la bandeja de pendientes.
 */
export function overstatedAutoConfirms(data: AppData): OverstatedAutoConfirm[] {
  const found: OverstatedAutoConfirm[] = []
  for (const [key, settlement] of settlementIndex(data.transactions)) {
    const final = settlement.final
    if (!final || settlement.partials.length === 0 || final.source !== 'scheduled') continue
    const schedule = data.schedules.find((s) => s.id === final.scheduleId)
    if (!schedule || final.amountMinor !== schedule.amountMinor) continue
    const partials = settlement.partials.filter((t) => t.date <= final.date)
    if (partials.length === 0) continue
    const [scheduleId, occurrenceDate] = key.split(':') as [string, LocalDate]
    found.push({ scheduleId, occurrenceDate, finalTxId: final.id, partialTxIds: partials.map((t) => t.id), excessMinor: partials.reduce((sum, t) => sum + t.amountMinor, 0) })
  }
  return found
}
