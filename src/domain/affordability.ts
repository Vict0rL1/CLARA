/**
 * "¿Me alcanza?": simula una compra SIN modificar ningún registro.
 *
 *   Disponible después = Disponible − Precio
 *   Diario después     = floor(Disponible después / D)  (0 si ≤ 0)
 *
 * Veredicto:
 *   - 'fits'          Disponible después ≥ la mitad del disponible actual y la
 *                     proyección a 30 días no cae bajo cero.
 *   - 'tight'         Disponible después ≥ 0 pero la compra usa más de la mitad,
 *                     o la proyección a 30 días cae bajo cero después de comprar.
 *   - 'onlyWithBuffer' Solo alcanza si usas tu colchón de seguridad (Clara 2.0 §10).
 *   - 'onlyWithGoals' Solo alcanza si usas el colchón y dinero apartado para metas.
 *   - 'doesNotFit'    Ni con el colchón ni con los apartados alcanza.
 * Sin colchón (0) los veredictos son los de siempre.
 */
import { computeBudget, type BudgetResult } from './budget'
import { floorDiv, mulDivFloor } from './money'
import { projectBalance, type ProjectionResult } from './projection'
import type { AppData, LocalDate } from './types'

export type AffordVerdict = 'fits' | 'tight' | 'onlyWithBuffer' | 'onlyWithGoals' | 'doesNotFit'

export interface AffordResult {
  priceMinor: number
  budget: BudgetResult
  verdict: AffordVerdict | null
  availableAfterMinor: number
  dailyAfterMinor: number | null
  weeklyAfterMinor: number | null
  projectionBefore: ProjectionResult
  projectionAfter: ProjectionResult
  /** La compra no deja el disponible en negativo, pero la proyección a 30 días sí cae bajo cero. */
  futureShortfallDate: LocalDate | null
  /** La proyección ya caía bajo cero ANTES de la compra (la compra no es la causa). */
  shortfallExistedBefore: boolean
}

export function simulatePurchase(
  data: AppData,
  today: LocalDate,
  priceMinor: number,
  options: { dailySpendMinor?: number } = {},
): AffordResult {
  if (!Number.isSafeInteger(priceMinor) || priceMinor <= 0) throw new Error('El precio debe ser un entero positivo')
  const budget = computeBudget(data, today)
  const availableAfterMinor = budget.availableMinor - priceMinor
  let dailyAfterMinor: number | null = null
  let weeklyAfterMinor: number | null = null
  if (budget.horizon && budget.weeklyDays) {
    dailyAfterMinor = availableAfterMinor > 0 ? floorDiv(availableAfterMinor, budget.horizon.days) : 0
    weeklyAfterMinor = availableAfterMinor > 0 ? mulDivFloor(availableAfterMinor, budget.weeklyDays, budget.horizon.days) : 0
  }

  let verdict: AffordVerdict | null = null
  if (budget.status === 'ok') {
    if (availableAfterMinor >= 0) {
      verdict = availableAfterMinor * 2 >= budget.availableMinor ? 'fits' : 'tight'
    } else if (budget.safetyBufferMinor > 0 && availableAfterMinor + budget.safetyBufferMinor >= 0) {
      verdict = 'onlyWithBuffer'
    } else if (availableAfterMinor + budget.safetyBufferMinor + budget.goalsReservedMinor >= 0) {
      verdict = 'onlyWithGoals'
    } else {
      verdict = 'doesNotFit'
    }
  }

  const dailySpendMinor = options.dailySpendMinor ?? 0
  const projectionBefore = projectBalance(data, today, { dailySpendMinor })
  const projectionAfter = projectBalance(data, today, { dailySpendMinor, extraOutflowTodayMinor: priceMinor })
  const futureShortfallDate =
    availableAfterMinor >= 0 && projectionAfter.firstNegativeDate ? projectionAfter.firstNegativeDate : null
  const shortfallExistedBefore = projectionBefore.firstNegativeDate !== null
  if (verdict === 'fits' && futureShortfallDate) verdict = 'tight'

  return {
    priceMinor,
    budget,
    verdict,
    availableAfterMinor,
    dailyAfterMinor,
    weeklyAfterMinor,
    projectionBefore,
    projectionAfter,
    futureShortfallDate,
    shortfallExistedBefore,
  }
}
