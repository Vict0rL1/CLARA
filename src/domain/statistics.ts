/**
 * Estadísticas (§7.6): comparación de periodos, desglose por categoría, series de varios periodos,
 * tendencia acumulada, top de comercios, promedio diario y saldo futuro a 90 días con banda.
 * Ver docs/FORMULAS.md §35. Todo son funciones puras sobre movimientos realizados; nunca cambian datos.
 */
import { addDays, daysBetween, weekday } from './dates'
import { periodSummary, type CategorySpending } from './insights'
import { checkedPercentChange, floorDiv, mulDivFloor, sumMinor } from './money'
import { getPeriod, type Period } from './periods'
import { estimateDailySpend, projectBalance } from './projection'
import { txMerchantKey } from './statsFilter'
import { trackedSince } from './weeklyReview'
import type { AppData, BudgetPeriodType, LocalDate, Settings, Transaction } from './types'

export type StatsPeriodType = Exclude<BudgetPeriodType, 'untilIncome'>
export const STATS_PERIOD_TYPES: StatsPeriodType[] = ['week', 'biweek', 'month', 'quarter', 'semester', 'year', 'custom']

export interface StatsRange {
  start: LocalDate
  end: LocalDate
  /** Para etiquetas: el periodo de calendario si lo hay. */
  period: Period | null
}

/** Periodo del tipo dado que contiene `anchor` (personalizado: fechas explícitas, por defecto los últimos 30 días). */
export function statsRange(type: StatsPeriodType, settings: Settings, anchor: LocalDate, custom?: { start: LocalDate; end: LocalDate }): StatsRange {
  if (type === 'custom') {
    const range = custom && custom.end >= custom.start ? custom : { start: addDays(anchor, -29), end: anchor }
    return { ...range, period: null }
  }
  const period = getPeriod({ ...settings.budgetPeriod, type }, anchor)
  if (!period) return { start: anchor, end: anchor, period: null }
  return { start: period.start, end: period.end, period }
}

/** Periodo anterior o siguiente del mismo tipo (misma duración si es personalizado). */
export function shiftRange(range: StatsRange, type: StatsPeriodType, settings: Settings, direction: -1 | 1): StatsRange {
  if (type === 'custom' || !range.period) {
    const len = daysBetween(range.start, range.end) + 1
    const start = addDays(range.start, direction * len)
    return { start, end: addDays(start, len - 1), period: null }
  }
  const anchor = direction < 0 ? addDays(range.start, -1) : addDays(range.end, 1)
  return statsRange(type, settings, anchor)
}

export interface Delta {
  diffMinor: number
  /** Porcentaje entero; `null` si la base es 0 o no hay datos comparables. */
  percent: number | null
}

function delta(current: number, previous: number, comparable: boolean): Delta {
  const diffMinor = current - previous
  // Entero truncado hacia cero (F-R3): −9,99 % se muestra como −9 %, igual que +9,99 % como 9 %.
  return { diffMinor, percent: comparable && previous > 0 ? checkedPercentChange(diffMinor, previous) : null }
}

export interface PeriodStats {
  range: StatsRange
  previous: StatsRange
  incomeMinor: number
  expensesMinor: number
  netMinor: number
  income: Delta
  expenses: Delta
  net: Delta
  /** El periodo anterior empieza antes de que haya registros: la comparación no es equivalente. */
  previousComparable: boolean
  transactionCount: number
}

export function periodStats(data: AppData, type: StatsPeriodType, range: StatsRange): PeriodStats {
  const previous = shiftRange(range, type, data.settings, -1)
  const current = periodSummary(data, range.start, range.end)
  const prev = periodSummary(data, previous.start, previous.end)
  const since = trackedSince(data)
  const comparable = previous.start >= since
  const net = current.incomeMinor - current.netSpendingMinor
  const prevNet = prev.incomeMinor - prev.netSpendingMinor
  return {
    range,
    previous,
    incomeMinor: current.incomeMinor,
    expensesMinor: current.netSpendingMinor,
    netMinor: net,
    income: delta(current.incomeMinor, prev.incomeMinor, comparable),
    expenses: delta(current.netSpendingMinor, prev.netSpendingMinor, comparable),
    // El neto puede ser negativo: el porcentaje solo tiene sentido con base positiva.
    net: delta(net, prevNet, comparable),
    previousComparable: comparable,
    transactionCount: data.transactions.filter((t) => t.status === 'realized' && t.date >= range.start && t.date <= range.end).length,
  }
}

export interface CategoryShare extends CategorySpending {
  /** Porcentaje entero del gasto neto positivo total. */
  percent: number
}

/** Gasto por categoría (solo netos positivos), ordenado de mayor a menor, con porcentaje. */
export function categoryBreakdown(data: AppData, range: StatsRange): { total: number; categories: CategoryShare[] } {
  const summary = periodSummary(data, range.start, range.end)
  const positive = summary.categories.filter((c) => c.netMinor > 0)
  const total = sumMinor(positive.map((c) => c.netMinor))
  return { total, categories: positive.map((c) => ({ ...c, percent: total > 0 ? mulDivFloor(c.netMinor, 100, total) : 0 })) }
}

export interface SeriesPoint {
  range: StatsRange
  incomeMinor: number
  expensesMinor: number
}

/** Los últimos `count` periodos (el actual al final). */
export function periodSeries(data: AppData, type: StatsPeriodType, range: StatsRange, count = 6): SeriesPoint[] {
  const out: SeriesPoint[] = []
  let current = range
  for (let i = 0; i < count; i++) {
    const s = periodSummary(data, current.start, current.end)
    out.unshift({ range: current, incomeMinor: s.incomeMinor, expensesMinor: s.netSpendingMinor })
    current = shiftRange(current, type, data.settings, -1)
  }
  return out
}

export interface TrendPoint {
  /** Día del periodo (1 = primero). */
  day: number
  date: LocalDate
  /** Gasto acumulado hasta ese día; `null` para días futuros del periodo actual. */
  currentMinor: number | null
  /** Acumulado del periodo anterior en el mismo día; `null` si ese periodo era más corto. */
  previousMinor: number | null
}

function dailyExpenses(data: AppData, start: LocalDate, end: LocalDate): Map<LocalDate, number> {
  const byDay = new Map<LocalDate, number>()
  for (const tx of data.transactions) {
    if (tx.status !== 'realized' || tx.date < start || tx.date > end) continue
    if (tx.kind === 'expense') byDay.set(tx.date, (byDay.get(tx.date) ?? 0) + tx.amountMinor)
    else if (tx.kind === 'refund') byDay.set(tx.date, (byDay.get(tx.date) ?? 0) - tx.amountMinor)
  }
  return byDay
}

/** Tendencia del gasto acumulado del periodo frente al anterior, día a día. */
export function cumulativeTrend(data: AppData, range: StatsRange, previous: StatsRange, today: LocalDate): TrendPoint[] {
  const cur = dailyExpenses(data, range.start, range.end)
  const prev = dailyExpenses(data, previous.start, previous.end)
  const days = daysBetween(range.start, range.end) + 1
  const prevDays = daysBetween(previous.start, previous.end) + 1
  const out: TrendPoint[] = []
  let c = 0
  let p = 0
  for (let i = 0; i < days; i++) {
    const date = addDays(range.start, i)
    c += cur.get(date) ?? 0
    const pDate = addDays(previous.start, i)
    if (i < prevDays) p += prev.get(pDate) ?? 0
    out.push({ day: i + 1, date, currentMinor: date <= today ? Math.max(0, c) : null, previousMinor: i < prevDays ? Math.max(0, p) : null })
  }
  return out
}

export interface TopEntry {
  /** Comercio o, si no hay, la nota; normalizado para agrupar. */
  key: string
  label: string
  amountMinor: number
  count: number
}

/** Los `limit` comercios o notas con más gasto neto en el periodo (variantes del mismo comercio juntas). Sin comercio ni nota no se cuenta. */
export function topMerchants(data: AppData, range: StatsRange, limit = 5): TopEntry[] {
  const groups = new Map<string, TopEntry>()
  for (const tx of data.transactions) {
    if (tx.status !== 'realized' || tx.date < range.start || tx.date > range.end || (tx.kind !== 'expense' && tx.kind !== 'refund')) continue
    // Fase 2: las variantes del mismo comercio («UBER *EATS 8XK2L», «Uber Eats») se agrupan; se muestra
    // la primera forma escrita. Sin palabras de comercio (p. ej. solo un código) se agrupa por el texto.
    const key = txMerchantKey(tx)
    if (!key) continue
    const label = (tx.merchant ?? tx.note ?? '').trim()
    const entry = groups.get(key) ?? { key, label, amountMinor: 0, count: 0 }
    entry.amountMinor += tx.kind === 'expense' ? tx.amountMinor : -tx.amountMinor
    entry.count += 1
    groups.set(key, entry)
  }
  return [...groups.values()]
    .filter((e) => e.amountMinor > 0)
    .sort((a, b) => b.amountMinor - a.amountMinor || a.label.localeCompare(b.label))
    .slice(0, limit)
}

export interface DailyAverage {
  /** Gasto neto / días transcurridos del periodo (hasta hoy, mínimo 1). */
  averageMinor: number
  daysCounted: number
  /** Día de la semana (0 = domingo … 6 = sábado) con más gasto; `null` sin gasto. */
  topWeekday: number | null
  topWeekdayMinor: number
}

export function dailyAverage(data: AppData, range: StatsRange, today: LocalDate): DailyAverage {
  const end = today < range.end ? today : range.end
  const days = end < range.start ? 0 : daysBetween(range.start, end) + 1
  const byDay = dailyExpenses(data, range.start, range.end)
  const total = Math.max(0, sumMinor([...byDay.values()]))
  const byWeekday = [0, 0, 0, 0, 0, 0, 0]
  for (const [date, minor] of byDay) byWeekday[weekday(date)]! += minor
  let top: number | null = null
  for (let i = 0; i < 7; i++) if (byWeekday[i]! > 0 && (top === null || byWeekday[i]! > byWeekday[top]!)) top = i
  return { averageMinor: days > 0 ? floorDiv(total, days) : 0, daysCounted: days, topWeekday: top, topWeekdayMinor: top === null ? 0 : byWeekday[top]! }
}

export interface FuturePoint {
  date: LocalDate
  /** Escenario base (gasto diario promedio e ingresos mínimos). */
  baseMinor: number
  /** Banda: optimista gasta un 25 % menos al día y usa los ingresos esperados; pesimista un 25 % más y mínimos. */
  optimisticMinor: number
  pessimisticMinor: number
}

export interface FutureBalance {
  enough: boolean
  /** Motivo si no hay datos suficientes. */
  reason: 'noHistory' | 'fewDays' | null
  daysObserved: number
  dailySpendMinor: number
  points: FuturePoint[]
  /** Puntos destacados: hoy, 30, 60 y 90 días. */
  marks: FuturePoint[]
}

export const FUTURE_DAYS = 90
const MIN_TRACKED_DAYS = 14

/**
 * Saldo futuro a 90 días con banda. Se oculta sin 14 días de historial o sin gasto observado
 * suficiente (§6 del prompt): nunca se dibuja una curva sin base.
 */
export function futureBalance(data: AppData, today: LocalDate): FutureBalance {
  const est = estimateDailySpend(data, today, 30)
  const tracked = daysBetween(trackedSince(data), today)
  const empty = (reason: FutureBalance['reason']) => ({ enough: false, reason, daysObserved: est.daysObserved, dailySpendMinor: est.dailyMinor, points: [], marks: [] })
  if (data.transactions.filter((t) => t.status === 'realized').length === 0) return empty('noHistory')
  if (tracked < MIN_TRACKED_DAYS || !est.sufficient) return empty('fewDays')
  // Un día más para que el punto 90 sea exactamente hoy + 90 (el día 0 es hoy, tras sus movimientos del día).
  const days = FUTURE_DAYS + 1
  const base = projectBalance(data, today, { days, dailySpendMinor: est.dailyMinor, scenario: 'min' })
  const optimistic = projectBalance(data, today, { days, dailySpendMinor: mulDivFloor(est.dailyMinor, 75, 100), scenario: 'expected' })
  const pessimistic = projectBalance(data, today, { days, dailySpendMinor: mulDivFloor(est.dailyMinor, 125, 100), scenario: 'min' })
  const points: FuturePoint[] = base.days.map((d, i) => ({ date: d.date, baseMinor: d.endMinor, optimisticMinor: optimistic.days[i]!.endMinor, pessimisticMinor: pessimistic.days[i]!.endMinor }))
  const marks = [0, 30, 60, 90].map((d) => points[Math.min(d, points.length - 1)]!)
  return { enough: true, reason: null, daysObserved: est.daysObserved, dailySpendMinor: est.dailyMinor, points, marks }
}

/** Movimientos del periodo de una categoría (para «tocar una categoría → historial filtrado»). */
export function categoryTransactions(data: AppData, range: StatsRange, categoryId: string): Transaction[] {
  return data.transactions.filter((t) => t.status === 'realized' && t.date >= range.start && t.date <= range.end && (t.categoryId === categoryId || t.splits?.some((l) => l.categoryId === categoryId)))
}
