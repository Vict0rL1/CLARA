/**
 * Revisión propia (R6) sobre la auditoría del PR #15: los porcentajes de importes se calculan con división entera exacta
 * (`mulDivFloor`), nunca «importe × 100» en coma flotante (CLAUDE.md, FORMULAS §1). Datos sintéticos.
 */
import { describe, expect, it } from 'vitest'
import { MAX_AMOUNT_MINOR } from './money'
import { planProgress } from './plans'
import { categoryBreakdown } from './statistics'
import type { Plan } from './types'
import { baseData, tx } from '../test/fixtures'
describe('R6 (revisión propia) · porcentajes de importes: división entera exacta, nunca importe × 100 en coma flotante', () => {
  it('396 000 000 000 297 de 400 000 000 000 300 es el 99 % (la coma flotante decía 98)', () => {
    const big = (prefix: string, count: number, rest: number, categoryId: string) => [
      ...Array.from({ length: count }, (_, i) => tx({ id: `${prefix}${i}`, date: '2026-09-10', amountMinor: MAX_AMOUNT_MINOR, categoryId })),
      tx({ id: `${prefix}-rest`, date: '2026-09-10', amountMinor: rest, categoryId }),
    ]
    const d = baseData({ transactions: [...big('a', 396, 297, 'groceries'), ...big('b', 4, 3, 'utilities')] })
    const breakdown = categoryBreakdown(d, { start: '2026-09-01', end: '2026-09-30', period: null })
    expect(breakdown.total).toBe(400_000_000_000_300)
    expect(breakdown.categories.map((c) => [c.categoryId, c.percent])).toEqual([
      ['groceries', 99],
      ['utilities', 1],
    ])
    // El error que se evita: el producto ya no es un entero exacto y el cociente cae por debajo de 99.
    expect(Math.floor((396_000_000_000_297 * 100) / 400_000_000_000_300)).toBe(98)
  })

  it('el porcentaje de un límite usa la misma división: 396 000 000 000 297 gastado de un límite de 400 000 000 000 300 es el 99 %', () => {
    const d = baseData({
      transactions: [
        ...Array.from({ length: 396 }, (_, i) => tx({ id: `p${i}`, date: '2026-09-10', amountMinor: MAX_AMOUNT_MINOR, categoryId: 'groceries' })),
        tx({ id: 'p-rest', date: '2026-09-10', amountMinor: 297, categoryId: 'groceries' }),
      ],
    })
    const plan: Plan = {
      id: 'plan',
      kind: 'limit',
      name: 'Súper',
      categoryIds: ['groceries'],
      amountMinor: 400_000_000_000_300,
      currency: 'CAD',
      periodType: 'month',
      recurring: false,
      status: 'active',
      alertAt80: false,
      alertAt100: false,
      createdAt: '2026-09-01T12:00:00.000Z',
      updatedAt: '2026-09-01T12:00:00.000Z',
    }
    expect(planProgress(d, plan, '2026-09-28').percent).toBe(99)
  })
})
