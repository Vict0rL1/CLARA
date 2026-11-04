/**
 * Sugerir el importe de un límite a partir de lo gastado (Clara 2.0 §11, fase 3). Determinista, sin IA.
 *
 * Para un tipo de periodo y unas categorías (ninguna = todo el gasto), se toman los últimos
 * `SUGGESTION_CYCLES` ciclos COMPLETOS anteriores al actual que empiezan cuando ya había datos (primer
 * movimiento o saldo de referencia más antiguo): un mes en el que todavía no se usaba Clara no cuenta como
 * «0 gastado». En cada uno, el gasto neto con la misma regla del límite (`planSpent`: gastos −
 * devoluciones, líneas de compras divididas, sin transferencias). La propuesta es la MEDIANA (no la media: un mes raro no la arrastra),
 * redondeada hacia arriba a una unidad entera de la moneda. Hacen falta al menos 2 ciclos.
 *
 * Solo propone: el formulario la muestra con sus cifras y la persona decide si la usa. Nunca se guarda sola.
 */
import { addDays } from './dates'
import { ceilDiv, currencyDigits } from './money'
import { cycleFor, planSpent, type PlanCycle } from './plans'
import type { AppData, BudgetPeriodType, LocalDate } from './types'

export const SUGGESTION_CYCLES = 3
export const SUGGESTION_MIN_CYCLES = 2

export interface PlanSuggestionCycle extends PlanCycle {
  spentMinor: number
}

export interface PlanSuggestion {
  /** Ciclos usados, del más antiguo al más reciente. */
  cycles: PlanSuggestionCycle[]
  /** Mediana de lo gastado (con dos ciclos, la media de ambos redondeada hacia arriba). */
  medianMinor: number
  /** Mediana redondeada hacia arriba a una unidad entera de la moneda. */
  amountMinor: number
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : ceilDiv(sorted[mid - 1]! + sorted[mid]!, 2)
}

/**
 * Desde cuándo hay datos: el primer movimiento realizado o la fecha del saldo de referencia más antiguo
 * (lo que llegue antes; quien empezó el 1-jun y gastó por primera vez el 3 tiene junio completo).
 * Sin ningún movimiento, `null`.
 */
function firstActivity(data: Pick<AppData, 'transactions' | 'accounts'>): LocalDate | null {
  let first: LocalDate | null = null
  for (const t of data.transactions) if (t.status === 'realized' && (!first || t.date < first)) first = t.date
  if (!first) return null
  for (const a of data.accounts) if (a.anchor.date < first) first = a.anchor.date
  return first
}

export function suggestPlanAmount(data: AppData, input: { categoryIds: readonly string[]; periodType: BudgetPeriodType }, today: LocalDate): PlanSuggestion | null {
  if (input.periodType === 'custom' || input.periodType === 'untilIncome') return null
  const since = firstActivity(data)
  const current = cycleFor(input.periodType, data.settings, today)
  if (!since || !current) return null
  const cycles: PlanSuggestionCycle[] = []
  let cycle = cycleFor(input.periodType, data.settings, addDays(current.start, -1))
  while (cycle && cycles.length < SUGGESTION_CYCLES && cycle.start >= since) {
    cycles.unshift({ ...cycle, spentMinor: planSpent(data, { categoryIds: [...input.categoryIds] }, cycle) })
    cycle = cycleFor(input.periodType, data.settings, addDays(cycle.start, -1))
  }
  if (cycles.length < SUGGESTION_MIN_CYCLES) return null
  const medianMinor = median(cycles.map((c) => c.spentMinor))
  if (medianMinor <= 0) return null
  const unit = 10 ** currencyDigits(data.settings.currency)
  return { cycles, medianMinor, amountMinor: ceilDiv(medianMinor, unit) * unit }
}
