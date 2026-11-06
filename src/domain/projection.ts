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
import { checkedSumMinor, floorDiv, sumMinor } from './money'
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
  /** Días pedidos (30 por defecto). Si `outOfRangeFrom` no es `null`, `days` cubre menos: solo los exactos. */
  horizonDays: number
  /**
   * Primer día cuyo saldo ya no es un entero exacto (QA V2, FIN-01): la proyección acaba el día antes y ese día y los
   * siguientes no tienen cifra. Nunca se lanza un error ni se inventa, recorta o redondea un saldo (auditoría del
   * 2026-11-02, prioridad 4: antes solo el calendario y Estadísticas lo pedían y Proyección, Análisis, Plan ante
   * faltante, Escenarios y «¿Me alcanza?» caían en «No se pudo abrir esta pantalla»). Quien proyecta lo dice y no
   * afirma nada sobre el horizonte completo (saldo al final, «sin faltante») cuando no es `null`.
   */
  outOfRangeFrom: LocalDate | null
  /**
   * Cobertura exacta de ESTA proyección (auditoría del 2026-11-04, F2): el último día con cifra exacta y cuántos días
   * la tienen. `lastExactDate` es `null` si ni el cierre de hoy cabe en un entero exacto (cero días exactos): entonces
   * no hay «hasta el …» que afirmar, y ninguna pantalla toma «hoy» como si fuera un día con cifra.
   */
  lastExactDate: LocalDate | null
  exactDays: number
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
  let outOfRangeFrom: LocalDate | null = null

  for (let d = 0; d < totalDays; d++) {
    const date = addDays(today, d)
    const events = byDate.get(date) ?? []
    const extraMinor = -(d === 0 ? extraToday : 0) - (extraByDate.get(date) ?? 0)
    const dayMinor = checkedSumMinor(events.map((e) => e.budgetEffectMinor))
    const endMinor = dayMinor === null ? null : checkedSumMinor([balance, dayMinor, -dailySpendMinor, extraMinor])
    if (dayMinor === null || endMinor === null) {
      outOfRangeFrom = date
      break
    }
    const eventsMinor = dayMinor
    const startOfDay = balance
    balance = endMinor
    days.push({ date, startMinor: startOfDay, events, eventsMinor, dailySpendMinor, extraMinor, endMinor: balance })
    if (balance < lowest.minor) lowest = { date, minor: balance }
    if (balance < 0 && firstNegativeDate === null) firstNegativeDate = date
    if (goalsReservedMinor > 0 && balance < goalsReservedMinor && firstBelowGoalsDate === null) firstBelowGoalsDate = date
  }

  return {
    today,
    horizonDays: totalDays,
    outOfRangeFrom,
    lastExactDate: days[days.length - 1]?.date ?? null,
    exactDays: days.length,
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

/**
 * Totales BRUTOS de los días exactos (auditoría del 2026-11-04, F1): cada ingreso y cada pago por separado. Que cada
 * saldo diario quepa en un entero exacto no garantiza que la suma de todos los ingresos (o de todos los pagos) quepa:
 * +10¹² y −10¹² cada día dejan el saldo en 100 000 y, aun así, 30 días de ingresos suman más de 2⁵³ − 1. Un total que
 * no cabe es `null` —sin cifra— y la pantalla lo dice; nunca se recorta, redondea, pone a cero ni se descarta la
 * proyección (los saldos y las fechas de faltante siguen siendo exactos). Antes `sumMinor` lanzaba y Proyección y
 * Análisis caían en «No se pudo abrir esta pantalla».
 */
export function grossInflows(days: readonly ProjectionDay[]): number | null {
  return checkedSumMinor(days.flatMap((d) => d.events).filter((e) => e.budgetEffectMinor > 0).map((e) => e.budgetEffectMinor))
}

/** Pagos previstos, gasto diario estimado y salidas simuladas de los días exactos, en positivo; `null` si no cabe. */
export function grossOutflows(days: readonly ProjectionDay[]): number | null {
  return checkedSumMinor([...days.flatMap((d) => d.events).filter((e) => e.budgetEffectMinor < 0).map((e) => -e.budgetEffectMinor), ...days.map((d) => d.dailySpendMinor - d.extraMinor)])
}

export interface ScenarioComparison {
  scenario: IncomeScenario
  /** Ingresos contados en los días exactos (parcial si `outOfRangeFrom` no es `null`); `null` si la suma bruta no cabe (F1). */
  incomeMinor: number | null
  /** Saldo al cierre del último día exacto: el del horizonte solo si `outOfRangeFrom` es `null`. */
  endMinor: number
  lowest: { date: LocalDate; minor: number }
  firstNegativeDate: LocalDate | null
  outOfRangeFrom: LocalDate | null
  /** Cobertura exacta de ESTE escenario (F2): el mínimo puede llegar al final del horizonte y el extra no; cada fila dice la suya. */
  lastExactDate: LocalDate | null
  exactDays: number
}

/**
 * Misma proyección con cada escenario de ingresos (mínimo, esperado, extra). Solo
 * cambian los ingresos futuros estimados; el saldo de partida es el real en los tres.
 */
export function compareScenarios(data: AppData, today: LocalDate, options: Omit<ProjectionOptions, 'scenario'> = {}): ScenarioComparison[] {
  return (['min', 'expected', 'extra'] as const).map((scenario) => {
    const p = projectBalance(data, today, { ...options, scenario })
    return {
      scenario,
      incomeMinor: grossInflows(p.days),
      endMinor: p.endMinor,
      lowest: p.lowest,
      firstNegativeDate: p.firstNegativeDate,
      outOfRangeFrom: p.outOfRangeFrom,
      lastExactDate: p.lastExactDate,
      exactDays: p.exactDays,
    }
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

/** Días que el calendario proyecta como máximo (desde hoy, incluido). Más allá no hay cifra por día. */
export const CALENDAR_PROJECTION_MAX_DAYS = 400

export type DayBalance =
  | { state: 'past' }
  | { state: 'projected'; endMinor: number }
  /** Desde `from` el saldo deja de ser un entero exacto (`outOfRangeFrom`): sin cifra, y se dice desde cuándo. */
  | { state: 'outOfRange'; from: LocalDate }
  /** Más allá de los días proyectados: `lastDate` es el último con cifra. */
  | { state: 'beyond'; lastDate: LocalDate }

/**
 * Saldo de un día del calendario: pasado (vive en Cuentas), proyectado (cierre de ese día), fuera del rango exacto
 * (QA V2, FIN-01) o más allá de la proyección. Nunca se toma el último día proyectado como si fuera el saldo de un
 * día posterior. La misma regla vale para la proyección base y para una simulación (revisión propia, R3).
 */
export function dayBalance(projection: Pick<ProjectionResult, 'today' | 'days' | 'outOfRangeFrom'>, date: LocalDate): DayBalance {
  if (date < projection.today) return { state: 'past' }
  const day = projection.days.find((d) => d.date === date)
  if (day) return { state: 'projected', endMinor: day.endMinor }
  if (projection.outOfRangeFrom && date >= projection.outOfRangeFrom) return { state: 'outOfRange', from: projection.outOfRangeFrom }
  return { state: 'beyond', lastDate: projection.days[projection.days.length - 1]?.date ?? projection.today }
}
