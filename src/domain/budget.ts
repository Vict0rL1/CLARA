/**
 * Disponible hasta el próximo ingreso (ver docs/FORMULAS.md).
 *
 *   Saldo actual (S)      = Σ saldos de las cuentas del presupuesto (saldo de referencia + movimientos realizados posteriores)
 *   Pagos reservados (P)  = Σ pagos pendientes o vencidos con fecha ≤ día del próximo ingreso
 *   Apartados (A)         = Σ dinero apartado en metas que se descuentan del presupuesto
 *   Disponible            = S − P − A
 *   Días del periodo (D)  = días desde hoy (incluido) hasta el día del ingreso (EXCLUIDO)
 *   Diario                = floor(Disponible / D)          (0 si Disponible ≤ 0)
 *   Semanal               = floor(Disponible × min(7, D) / D)
 *
 * Los ingresos futuros NUNCA se suman al disponible. El día del ingreso queda
 * fuera del periodo, pero los pagos de ese mismo día sí se reservan, porque el
 * dinero puede llegar después de que se cobre el pago.
 */
import { isBudgetAccount, oldestAnchor, spendableBalance, type AccountBalance } from './balances'
import { addDays, daysBetween, localDateInTimeZone } from './dates'
import { goalReserveLines, scheduleCoverage } from './reserves'
import { floorDiv, mulDivFloor, sumMinor } from './money'
import { openItemsDetailed, openItemsUntil, planItems, type PlanItem } from './planItems'
import { getPeriod, periodBalance, type Period, type PeriodBalance } from './periods'
import type { AppData, Goal, LocalDate, Timestamp } from './types'

export const STALE_BALANCE_DAYS = 3
export const HORIZON_OPTIONS = [7, 14, 30] as const

export interface Horizon {
  /** Día del próximo ingreso (o fin del horizonte elegido). NO se cuenta como día del periodo. */
  endDate: LocalDate
  days: number
  /** `period`: periodo de calendario (§6.1); `endDate` es el último día INCLUIDO y `days` los que quedan contando hoy. */
  source: 'income' | 'fallback' | 'period'
  income?: PlanItem
}

export type BudgetStatus = 'ok' | 'needsHorizon' | 'noAccounts'

export interface BudgetResult {
  status: BudgetStatus
  today: LocalDate
  spendableMinor: number
  accountBalances: AccountBalance[]
  horizon: Horizon | null
  reservedItems: PlanItem[]
  reservedTotalMinor: number
  goalReservations: { goal: Goal; amountMinor: number; consumedMinor: number }[]
  /** Parte de cada pago reservado ya cubierta por un gasto planificado (clave = PlanItem.key). */
  coveredByGoals: Map<string, number>
  goalsReservedMinor: number
  availableMinor: number
  dailyMinor: number | null
  weeklyMinor: number | null
  weeklyDays: number | null
  /** Ingresos cuya fecha ya pasó y no se marcaron como recibidos (no se cuentan). */
  overdueIncomes: PlanItem[]
  /** Ingresos esperados hoy que aún no se marcaron como recibidos (no se cuentan). */
  incomeDueToday: PlanItem[]
  overdueBills: PlanItem[]
  /** Saldo de referencia más antiguo de las cuentas del presupuesto. */
  balanceSetAt: Timestamp | null
  balanceDate: LocalDate | null
  /** Días desde que se registró el saldo más antiguo. */
  balanceAgeDays: number | null
  isBalanceStale: boolean
  /** Los apartados superan lo que queda después de reservar pagos. */
  goalsExceedMoney: boolean
  /** Periodo de calendario activo (null con «hasta mi próximo ingreso»). */
  period: Period | null
  /** Saldo del periodo (arrastre, ingresos y gastos del periodo); null sin periodo de calendario. */
  periodBalance: PeriodBalance | null
  /** Base del disponible: saldo real (con arrastre) o el menor entre el neto del periodo y el saldo real (sin arrastre). */
  baseMinor: number
  /**
   * Programados cuyos vencidos no se pudieron revisar enteros (QA-06). Si hay alguno, lo reservado
   * puede estar incompleto: no se sugiere nada por día ni por semana e Inicio lo dice.
   */
  incompleteScheduleIds: string[]
}

/** Ingresos programados abiertos (pendientes o vencidos) hasta `to`. Solo estos definen el periodo. */
export function scheduledIncomeItems(data: AppData, today: LocalDate, to: LocalDate): PlanItem[] {
  return openItemsUntil(data, today, to).filter((i) => i.source === 'schedule' && i.direction === 'income')
}

export function findHorizon(data: AppData, today: LocalDate): { horizon: Horizon | null; overdueIncomes: PlanItem[]; incomeDueToday: PlanItem[] } {
  const incomes = scheduledIncomeItems(data, today, addDays(today, 400))
  const overdueIncomes = incomes.filter((i) => i.state === 'overdue')
  const incomeDueToday = incomes.filter((i) => i.state === 'pending' && i.date === today)
  const next = incomes.find((i) => i.state === 'pending' && i.date > today)
  if (next) {
    return { horizon: { endDate: next.date, days: daysBetween(today, next.date), source: 'income', income: next }, overdueIncomes, incomeDueToday }
  }
  const fallback = data.settings.fallbackHorizonDays
  if (fallback && fallback > 0) {
    return { horizon: { endDate: addDays(today, fallback), days: fallback, source: 'fallback' }, overdueIncomes, incomeDueToday }
  }
  return { horizon: null, overdueIncomes, incomeDueToday }
}

export function computeBudget(data: AppData, today: LocalDate): BudgetResult {
  const { totalMinor: spendableMinor, accounts: accountBalances } = spendableBalance(data)
  const found = findHorizon(data, today)
  const { overdueIncomes, incomeDueToday } = found
  // Periodo de calendario (§6): sustituye al horizonte «hasta el próximo ingreso».
  const periodSettings = data.settings.budgetPeriod
  const period = periodSettings && periodSettings.type !== 'untilIncome' ? getPeriod(periodSettings, today) : null
  const horizon: Horizon | null = period ? { endDate: period.end, days: period.daysLeft, source: 'period' } : found.horizon
  const pBalance = period ? periodBalance(data, period, data.settings.carryOverBalance !== false) : null
  // QA-03: sin arrastre la base nunca supera el saldo real (ver `periodBalance.spendableBaseMinor`).
  const baseMinor = pBalance ? pBalance.spendableBaseMinor : spendableMinor

  // Sin horizonte se reservan, como mínimo, los pagos de los próximos 30 días.
  const reserveUntil = horizon ? horizon.endDate : addDays(today, 30)
  const { items: open, truncatedScheduleIds: incompleteScheduleIds } = openItemsDetailed(data, today, reserveUntil)
  const reservedItems = open.filter((i) => i.budgetEffectMinor < 0)
  // Metas: reserva efectiva (lo gastado en un periodo vinculado ya la consumió).
  const lines = goalReserveLines(data)
  const goalReservations = lines.filter((l) => l.amountMinor > 0).map((l) => ({ goal: l.goal, amountMinor: l.amountMinor, consumedMinor: l.consumedMinor }))
  const goalsReservedMinor = sumMinor(lines.map((l) => l.amountMinor))
  // Un pago previsto cubierto por un gasto planificado se descuenta una sola vez.
  const coveredByGoals = scheduleCoverage(lines, reservedItems)
  const reservedTotalMinor = sumMinor(reservedItems.map((i) => -i.budgetEffectMinor - (coveredByGoals.get(i.key) ?? 0)))
  const overdueBills = reservedItems.filter((i) => i.state === 'overdue')

  const availableMinor = baseMinor - reservedTotalMinor - goalsReservedMinor

  let dailyMinor: number | null = null
  let weeklyMinor: number | null = null
  let weeklyDays: number | null = null
  // Con reservas incompletas no se sugiere un importe por día: sería gastar sobre una cifra no revisada.
  if (horizon && horizon.days > 0 && incompleteScheduleIds.length === 0) {
    weeklyDays = Math.min(7, horizon.days)
    dailyMinor = availableMinor > 0 ? floorDiv(availableMinor, horizon.days) : 0
    weeklyMinor = availableMinor > 0 ? mulDivFloor(availableMinor, weeklyDays, horizon.days) : 0
  }

  const anchor = oldestAnchor(data)
  const balanceDate = anchor ? localDateInTimeZone(new Date(anchor.setAt), data.settings.timeZone) : null
  const balanceAgeDays = balanceDate ? Math.max(0, daysBetween(balanceDate, today)) : null

  let status: BudgetStatus = 'ok'
  if (!data.accounts.some(isBudgetAccount)) status = 'noAccounts'
  else if (!horizon) status = 'needsHorizon'

  return {
    status,
    today,
    spendableMinor,
    accountBalances,
    horizon,
    reservedItems,
    reservedTotalMinor,
    coveredByGoals,
    goalReservations,
    goalsReservedMinor,
    availableMinor,
    dailyMinor,
    weeklyMinor,
    weeklyDays,
    overdueIncomes,
    incomeDueToday,
    overdueBills,
    balanceSetAt: anchor?.setAt ?? null,
    balanceDate,
    balanceAgeDays,
    isBalanceStale: balanceAgeDays !== null && balanceAgeDays >= STALE_BALANCE_DAYS,
    goalsExceedMoney: goalsReservedMinor > 0 && baseMinor - reservedTotalMinor < goalsReservedMinor,
    period,
    periodBalance: pBalance,
    baseMinor,
    incompleteScheduleIds,
  }
}

/** Próximos elementos del plan (para la tarjeta "Próximos pagos"). */
export function upcomingItems(data: AppData, today: LocalDate, days = 14): PlanItem[] {
  return planItems(data, { today, from: today, to: addDays(today, days), includeOverdueBefore: true }).filter(
    (i) => i.state === 'pending' || i.state === 'overdue',
  )
}
