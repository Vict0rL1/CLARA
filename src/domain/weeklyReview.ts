/**
 * Revisión semanal (ver docs/FORMULAS.md §20). Todo con reglas transparentes: sin IA.
 *
 * - Semana = lunes a domingo, en fechas de calendario de la zona horaria elegida.
 * - Semana en curso: se compara lunes…hoy con lunes…el mismo día de la semana anterior
 *   (periodos equivalentes). Semanas cerradas: 7 días contra 7 días.
 * - Ingresos = ingresos realizados. Gasto = gastos − devoluciones realizados.
 *   Transferencias y apartados para metas se muestran aparte: NO son gasto.
 *   Los ajustes de conciliación no son ingreso ni gasto.
 * - Sin registros NO significa sin gastos: se indica que pueden faltar datos.
 * - Si el valor anterior es 0 (o faltan datos), no se calcula porcentaje.
 */
import { txEffectOnBudgetPool } from './balances'
import { upcomingItems } from './budget'
import { addDays, daysBetween, localDateInTimeZone, minDate, weekday } from './dates'
import { goalProgress } from './goals'
import { periodSummary, type CategorySpending } from './insights'
import { checkedPercentChange, sumMinor } from './money'
import type { PlanItem } from './planItems'
import type { AppData, Goal, LocalDate } from './types'

/** Lunes de la semana de `date`. */
export function weekStartOf(date: LocalDate): LocalDate {
  return addDays(date, -((weekday(date) + 6) % 7))
}

export type DataCoverage = 'complete' | 'partial' | 'none'

export interface WeekTotals {
  from: LocalDate
  to: LocalDate
  incomeMinor: number
  /** Gastos − devoluciones. */
  spendingMinor: number
  balanceMinor: number
  /** Transferencias hacia cuentas fuera del presupuesto (p. ej. ahorro). No es gasto. */
  toSavingsMinor: number
  /** Transferencias entre cuentas propias (total). */
  transfersMinor: number
  /** Dinero apartado (neto) para metas con fecha en el periodo. No es gasto. */
  goalContributionsMinor: number
  realizedCount: number
  categories: CategorySpending[]
  coverage: DataCoverage
}

export interface WeekChange {
  diffMinor: number
  /** Porcentaje entero (floor); null si la base es 0 o faltan datos. */
  percent: number | null
}

export type ObservationId =
  | 'noRecords'
  | 'partialData'
  | 'upcomingPayments'
  | 'overdueBills'
  | 'spendingMore'
  | 'spendingLess'
  | 'spendingSame'
  | 'previousZero'
  | 'topCategory'
  | 'goalContributions'
  | 'toSavings'

export interface Observation {
  id: ObservationId
  params: Record<string, string | number>
}

export interface WeeklyReview {
  weekStart: LocalDate
  weekEnd: LocalDate
  isCurrent: boolean
  /** Último día incluido (hoy si la semana está en curso). */
  throughDate: LocalDate
  current: WeekTotals
  previous: WeekTotals
  spendingChange: WeekChange
  incomeChange: WeekChange
  /** Pagos previstos en los próximos 7 días (solo semana en curso). */
  upcoming: PlanItem[]
  goals: { goal: Goal; savedMinor: number; targetMinor: number; weekMinor: number; complete: boolean }[]
  observations: Observation[]
}

/** Desde cuándo hay registros fiables: el saldo de referencia más antiguo o el primer movimiento. */
export function trackedSince(data: AppData): LocalDate {
  const dates = [...data.accounts.map((a) => a.anchor.date), ...data.transactions.map((t) => t.date)]
  const created = localDateInTimeZone(new Date(data.createdAt), data.settings.timeZone)
  return dates.reduce((min, d) => (d < min ? d : min), created)
}

function totals(data: AppData, from: LocalDate, to: LocalDate, since: LocalDate): WeekTotals {
  const inRange = data.transactions.filter((t) => t.status === 'realized' && t.date >= from && t.date <= to)
  const summary = periodSummary(data, from, to)
  const transfers = inRange.filter((t) => t.kind === 'transfer')
  const toSavingsMinor = sumMinor(transfers.map((t) => Math.max(0, -txEffectOnBudgetPool(t, data.accounts))))
  const goalContributionsMinor = sumMinor(data.goals.flatMap((g) => g.allocations.filter((a) => a.date >= from && a.date <= to && a.reason !== 'payment').map((a) => a.amountMinor)))
  const coverage: DataCoverage = to < since ? 'none' : from < since ? 'partial' : 'complete'
  return {
    from,
    to,
    incomeMinor: summary.incomeMinor,
    spendingMinor: summary.netSpendingMinor,
    balanceMinor: summary.incomeMinor - summary.netSpendingMinor,
    toSavingsMinor,
    transfersMinor: sumMinor(transfers.map((t) => t.amountMinor)),
    goalContributionsMinor,
    realizedCount: inRange.length,
    categories: summary.categories.filter((c) => c.netMinor > 0).slice(0, 3),
    coverage,
  }
}

function change(current: number, previous: number, comparable: boolean): WeekChange {
  const diffMinor = current - previous
  // Nunca se divide entre cero ni se da un porcentaje con datos incompletos (ni uno que no cabe en un entero exacto).
  // Entero truncado hacia cero (F-R3): −9,99 % es −9, igual que +9,99 % es 9.
  const percent = comparable && previous > 0 ? checkedPercentChange(diffMinor, previous) : null
  return { diffMinor, percent }
}

export function weeklyReview(data: AppData, weekStart: LocalDate, today: LocalDate): WeeklyReview {
  const start = weekStartOf(weekStart)
  const end = addDays(start, 6)
  const isCurrent = today >= start && today <= end
  const throughDate = isCurrent ? today : end
  const length = daysBetween(start, throughDate)
  const prevStart = addDays(start, -7)
  const prevThrough = addDays(prevStart, length)
  const since = trackedSince(data)
  const current = totals(data, start, throughDate, since)
  const previous = totals(data, prevStart, prevThrough, since)
  const comparable = current.coverage === 'complete' && previous.coverage === 'complete' && previous.realizedCount > 0
  const spendingChange = change(current.spendingMinor, previous.spendingMinor, comparable)
  const incomeChange = change(current.incomeMinor, previous.incomeMinor, comparable)
  const upcoming = isCurrent ? upcomingItems(data, today, 7).filter((i) => i.budgetEffectMinor < 0 || i.direction === 'expense') : []
  const goals = data.goals
    .filter((g) => !g.plan?.paidAt)
    .map((g) => {
      const p = goalProgress(g)
      const weekMinor = sumMinor(g.allocations.filter((a) => a.date >= start && a.date <= throughDate && a.reason !== 'payment').map((a) => a.amountMinor))
      return { goal: g, savedMinor: p.savedMinor, targetMinor: p.targetMinor, weekMinor, complete: p.complete }
    })

  const observations: Observation[] = []
  if (current.coverage !== 'complete') observations.push({ id: 'partialData', params: { date: since } })
  if (current.realizedCount === 0 && current.coverage !== 'none') observations.push({ id: 'noRecords', params: {} })
  const pending = upcoming.filter((i) => i.state === 'pending')
  if (pending.length > 0) observations.push({ id: 'upcomingPayments', params: { count: pending.length, totalMinor: sumMinor(pending.map((i) => i.amountMinor)) } })
  const overdue = upcoming.filter((i) => i.state === 'overdue')
  if (overdue.length > 0) observations.push({ id: 'overdueBills', params: { count: overdue.length } })
  if (comparable && current.realizedCount > 0) {
    if (spendingChange.diffMinor > 0) observations.push({ id: 'spendingMore', params: { amountMinor: spendingChange.diffMinor } })
    else if (spendingChange.diffMinor < 0) observations.push({ id: 'spendingLess', params: { amountMinor: -spendingChange.diffMinor } })
    else observations.push({ id: 'spendingSame', params: {} })
  } else if (previous.coverage === 'complete' && previous.spendingMinor === 0 && current.spendingMinor > 0) {
    observations.push({ id: 'previousZero', params: {} })
  }
  const top = current.categories[0]
  if (top) observations.push({ id: 'topCategory', params: { categoryId: top.categoryId, amountMinor: top.netMinor } })
  if (current.goalContributionsMinor > 0) observations.push({ id: 'goalContributions', params: { amountMinor: current.goalContributionsMinor } })
  if (current.toSavingsMinor > 0) observations.push({ id: 'toSavings', params: { amountMinor: current.toSavingsMinor } })

  return { weekStart: start, weekEnd: end, isCurrent, throughDate: minDate(throughDate, end), current, previous, spendingChange, incomeChange, upcoming, goals, observations }
}
