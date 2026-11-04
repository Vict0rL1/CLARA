/**
 * Cifras del héroe de Inicio (ronda 2, D2): ingresos y gastos realizados del periodo en curso y
 * el porcentaje disponible.
 *
 *   ingresos / gastos = `periodSummary` del periodo (lo mismo que Estadísticas: transferencias y
 *                       ajustes fuera, devoluciones netas, solo realizados).
 *   saldo al empezar  = saldo del presupuesto hoy − (ingresos − gastos) del periodo ya transcurrido.
 *   % disponible      = disponible ÷ (saldo al empezar + ingresos del periodo), acotado 0–100;
 *                       0 si la base no es positiva.
 *
 * Sin periodo de calendario («hasta mi próximo ingreso») se usa el mes natural, el mismo que
 * abre Estadísticas por defecto.
 */
import type { BudgetResult } from './budget'
import { endOfMonth, startOfMonth } from './dates'
import { periodSummary } from './insights'
import { mulDivFloor } from './money'
import type { AppData, LocalDate } from './types'

export interface HeroFigures {
  start: LocalDate
  end: LocalDate
  /** true si el rango es el periodo de presupuesto configurado; false si es el mes natural. */
  isBudgetPeriod: boolean
  incomeMinor: number
  expensesMinor: number
  /** Saldo del presupuesto al empezar el periodo (reconstruido). */
  startBalanceMinor: number
  /** Base del porcentaje: saldo al empezar + ingresos del periodo. */
  baseMinor: number
  /** 0–100, entero. */
  availablePct: number
}

export function heroFigures(data: Pick<AppData, 'transactions'>, budget: Pick<BudgetResult, 'period' | 'spendableMinor' | 'availableMinor'>, today: LocalDate): HeroFigures {
  const start = budget.period ? budget.period.start : startOfMonth(today)
  const end = budget.period ? budget.period.end : endOfMonth(today)
  const s = periodSummary(data, start, end)
  const startBalanceMinor = budget.spendableMinor - (s.incomeMinor - s.netSpendingMinor)
  const baseMinor = startBalanceMinor + s.incomeMinor
  // Entre 0 y 100 sin multiplicar antes de dividir: con importes extremos «disponible × 100» ya no es exacto (QA V2, FIN-01).
  const availablePct = baseMinor <= 0 || budget.availableMinor <= 0 ? 0 : budget.availableMinor >= baseMinor ? 100 : mulDivFloor(budget.availableMinor, 100, baseMinor)
  return { start, end, isBudgetPeriod: !!budget.period, incomeMinor: s.incomeMinor, expensesMinor: s.netSpendingMinor, startBalanceMinor, baseMinor, availablePct }
}
