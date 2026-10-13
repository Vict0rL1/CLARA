/**
 * Proyección de saldo (por defecto 30 días) de las cuentas del presupuesto.
 *
 * Suposiciones (se muestran en pantalla):
 *  - Punto de partida: saldo actual REAL de las cuentas del presupuesto.
 *  - Se suman ingresos y se restan pagos PREVISTOS en su fecha.
 *  - Los pagos vencidos sin marcar se restan hoy (postura prudente).
 *  - Los ingresos retrasados NO se suman (no se sabe cuándo llegarán).
 *  - Ingresos variables: se usa el escenario elegido (por defecto el mínimo); con
 *    cobros parciales solo se proyecta lo que falta por llegar.
 *  - Opcional: un gasto diario estimado que se resta cada día, incluido hoy.
 *  - Los apartados de metas no se restan del saldo (siguen en tu cuenta), pero se
 *    señala si el saldo proyectado cae por debajo de ellos.
 */
import { isBudgetAccount, spendableBalance } from './balances'
import { addDays, daysBetween } from './dates'
import { goalsReservedTotal } from './reserves'
import { floorDiv, sumMinor } from './money'
import { openItemsUntil, type PlanItem } from './planItems'
import type { AppData, IncomeScenario, LocalDate } from './types'

export interface ProjectionDay {
  date: LocalDate
  startMinor: number
  events: PlanItem[]
  eventsMinor: number
  dailySpendMinor: number
  extraMinor: number
  endMinor: number
}

export interface ProjectionOptions {
  days?: number
  /** Gasto diario estimado (≥ 0) que se resta cada día. */
  dailySpendMinor?: number
  /** Compra simulada que se resta hoy (para "¿Me alcanza?"). */
  extraOutflowTodayMinor?: number
  /**
   * Escenario de los ingresos variables. Por defecto el MÍNIMO (postura prudente).
   * Solo cambia la proyección: nunca los movimientos reales ni el disponible.
   */
  scenario?: IncomeScenario
  /** Simulaciones (etapa 3): salidas extra en fechas concretas; nunca se guardan. Fechas pasadas cuentan hoy. */
  extraOutflows?: { date: LocalDate; amountMinor: number }[]
}

export interface ProjectionResult {
  today: LocalDate
  startMinor: number
  goalsReservedMinor: number
  days: ProjectionDay[]
  lowest: { date: LocalDate; minor: number }
  firstNegativeDate: LocalDate | null
  firstBelowGoalsDate: LocalDate | null
  overdueOutflowsToday: PlanItem[]
  lateIncomesExcluded: PlanItem[]
  estimatedItems: PlanItem[]
  hasIncomeInRange: boolean
  dailySpendMinor: number
  scenario: IncomeScenario
  /** Ingresos con rango (variables) dentro de la proyección. */
  variableIncomes: PlanItem[]
  /** Saldo proyectado al final del último día. */
  endMinor: number
}

export function projectBalance(data: AppData, today: LocalDate, options: ProjectionOptions = {}): ProjectionResult {
  const totalDays = Math.max(1, options.days ?? 30)
  const dailySpendMinor = Math.max(0, options.dailySpendMinor ?? 0)
  const extraToday = Math.max(0, options.extraOutflowTodayMinor ?? 0)
  const scenario = options.scenario ?? 'min'
  const lastDay = addDays(today, totalDays - 1)
  const { totalMinor: startMinor } = spendableBalance(data)
  const goalsReservedMinor = goalsReservedTotal(data)

  const open = openItemsUntil(data, today, lastDay, scenario).filter((i) => i.budgetEffectMinor !== 0)
  const lateIncomesExcluded = open.filter((i) => i.state === 'overdue' && i.budgetEffectMinor > 0)
  const overdueOutflowsToday = open.filter((i) => i.state === 'overdue' && i.budgetEffectMinor < 0)
  const counted = open.filter((i) => !(i.state === 'overdue' && i.budgetEffectMinor > 0))

  const byDate = new Map<LocalDate, PlanItem[]>()
  for (const item of counted) {
    const date = item.date < today ? today : item.date
    const list = byDate.get(date) ?? []
    list.push(item)
    byDate.set(date, list)
  }

  const extraByDate = new Map<LocalDate, number>()
  for (const x of options.extraOutflows ?? []) {
    if (!(Number.isInteger(x.amountMinor) && x.amountMinor > 0)) continue
    const date = x.date < today ? today : x.date
    extraByDate.set(date, (extraByDate.get(date) ?? 0) + x.amountMinor)
  }
  const days: ProjectionDay[] = []
  let balance = startMinor
  let lowest = { date: today, minor: startMinor }
  let firstNegativeDate: LocalDate | null = startMinor < 0 ? today : null
  let firstBelowGoalsDate: LocalDate | null = goalsReservedMinor > 0 && startMinor < goalsReservedMinor ? today : null

  for (let d = 0; d < totalDays; d++) {
    const date = addDays(today, d)
    const events = byDate.get(date) ?? []
    const eventsMinor = sumMinor(events.map((e) => e.budgetEffectMinor))
    const extraMinor = -(d === 0 ? extraToday : 0) - (extraByDate.get(date) ?? 0)
    const startOfDay = balance
    balance = sumMinor([balance, eventsMinor, -dailySpendMinor, extraMinor])
    days.push({ date, startMinor: startOfDay, events, eventsMinor, dailySpendMinor, extraMinor, endMinor: balance })
    if (balance < lowest.minor) lowest = { date, minor: balance }
    if (balance < 0 && firstNegativeDate === null) firstNegativeDate = date
    if (goalsReservedMinor > 0 && balance < goalsReservedMinor && firstBelowGoalsDate === null) firstBelowGoalsDate = date
  }

  return {
    today,
    startMinor,
    goalsReservedMinor,
    days,
    lowest,
    firstNegativeDate,
    firstBelowGoalsDate,
    overdueOutflowsToday,
    lateIncomesExcluded,
    estimatedItems: counted.filter((i) => i.isEstimate),
    hasIncomeInRange: counted.some((i) => i.budgetEffectMinor > 0 && i.source === 'schedule'),
    dailySpendMinor,
    scenario,
    variableIncomes: counted.filter((i) => !!i.range),
    endMinor: balance,
  }
}

export interface ScenarioComparison {
  scenario: IncomeScenario
  incomeMinor: number
  endMinor: number
  lowest: { date: LocalDate; minor: number }
  firstNegativeDate: LocalDate | null
}

/**
 * Misma proyección con cada escenario de ingresos (mínimo, esperado, extra). Solo
 * cambian los ingresos futuros estimados; el saldo de partida es el real en los tres.
 */
export function compareScenarios(data: AppData, today: LocalDate, options: Omit<ProjectionOptions, 'scenario'> = {}): ScenarioComparison[] {
  return (['min', 'expected', 'extra'] as const).map((scenario) => {
    const p = projectBalance(data, today, { ...options, scenario })
    const incomeMinor = sumMinor(p.days.flatMap((d) => d.events).filter((e) => e.budgetEffectMinor > 0).map((e) => e.budgetEffectMinor))
    return { scenario, incomeMinor, endMinor: p.endMinor, lowest: p.lowest, firstNegativeDate: p.firstNegativeDate }
  })
}

export interface DailySpendEstimate {
  dailyMinor: number
  totalMinor: number
  daysObserved: number
  /** Menos de 7 días de historial: la estimación es poco fiable. */
  sufficient: boolean
}

/**
 * Gasto diario variable promedio de los últimos `lookbackDays` días (sin contar hoy):
 * gastos realizados en cuentas del presupuesto, menos devoluciones, SIN los pagos
 * programados (esos ya están en el plan). Las transferencias no son gasto.
 */
export function estimateDailySpend(data: AppData, today: LocalDate, lookbackDays = 30): DailySpendEstimate {
  const included = new Set(data.accounts.filter(isBudgetAccount).map((a) => a.id))
  const from = addDays(today, -lookbackDays)
  const relevant = data.transactions.filter(
    (tx) =>
      tx.status === 'realized' &&
      included.has(tx.accountId) &&
      !tx.scheduleId &&
      (tx.kind === 'expense' || tx.kind === 'refund'),
  )
  const earliest = relevant.reduce<LocalDate | null>((min, tx) => (min === null || tx.date < min ? tx.date : min), null)
  const windowStart = earliest && earliest > from ? earliest : from
  const daysObserved = earliest ? Math.max(0, daysBetween(windowStart, today)) : 0
  const inWindow = relevant.filter((tx) => tx.date >= windowStart && tx.date < today)
  const totalMinor = Math.max(0, sumMinor(inWindow.map((tx) => (tx.kind === 'expense' ? tx.amountMinor : -tx.amountMinor))))
  const dailyMinor = daysObserved > 0 ? floorDiv(totalMinor, daysObserved) : 0
  return { dailyMinor, totalMinor, daysObserved, sufficient: daysObserved >= 7 }
}
