import { describe, expect, it } from 'vitest'
import { goalMilestone, goalMilestones } from './goalMilestones'
import type { GoalAllocation } from './types'
import { ctx, goal } from '../test/fixtures'

/** Hoy = 2026-09-28. Objetivo 1 000. */
const alloc = (id: string, date: string, amountMinor: number): GoalAllocation => ({ id, date, amountMinor, createdAt: `${date}T12:00:00.000Z`, reason: 'contribution' })
const laptop = (...allocations: GoalAllocation[]) => goal({ id: 'g', name: 'Laptop', targetMinor: 100000, allocations })

describe('hitos de las metas', () => {
  it('nivel más alto alcanzado, en enteros (25 % exacto cuenta; un céntimo menos, no)', () => {
    expect(goalMilestone(laptop(alloc('a', '2026-09-01', 24999)))).toBeNull()
    expect(goalMilestone(laptop(alloc('a', '2026-09-01', 25000)))).toBe(25)
    expect(goalMilestone(laptop(alloc('a', '2026-09-01', 80000)))).toBe(75)
    expect(goalMilestone(laptop(alloc('a', '2026-09-01', 120000)))).toBe(100)
    // Gastos planificados: tienen su propio ciclo, sin hitos.
    expect(goalMilestone({ ...laptop(alloc('a', '2026-09-01', 50000)), kind: 'expense' })).toBeNull()
  })

  it('es una noticia de 7 días desde el apartado que cruzó el nivel; una meta que ya estaba ahí no avisa', () => {
    const recent = laptop(alloc('a', '2026-08-01', 30000), alloc('b', '2026-09-25', 25000))
    expect(goalMilestones({ goals: [recent] }, ctx.today).map((m) => [m.level, m.reachedOn, m.savedMinor])).toEqual([[50, '2026-09-25', 55000]])
    // Mismo estado visto 7 días después del aporte: ya no es noticia.
    expect(goalMilestones({ goals: [recent] }, '2026-10-02')).toEqual([])
    // Ya estaba al 55 % desde agosto: nada.
    expect(goalMilestones({ goals: [laptop(alloc('a', '2026-08-01', 55000))] }, ctx.today)).toEqual([])
  })

  it('un salto del 10 % al 80 % es un solo aviso (75 %); liberar y volver a apartar cuenta la última vez que se cruzó', () => {
    const jump = laptop(alloc('a', '2026-08-01', 10000), alloc('b', '2026-09-27', 70000))
    expect(goalMilestones({ goals: [jump] }, ctx.today).map((m) => m.level)).toEqual([75])
    const again = laptop(alloc('a', '2026-08-01', 50000), alloc('r', '2026-08-15', -20000), alloc('b', '2026-09-26', 20000))
    expect(goalMilestones({ goals: [again] }, ctx.today).map((m) => [m.level, m.reachedOn])).toEqual([[50, '2026-09-26']])
  })
})
