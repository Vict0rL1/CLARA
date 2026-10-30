/**
 * Revisión independiente en el navegador de la pasada QA27: con importes de auditoría (4 520 gastos de 999 999 999 999
 * en el último mes) la pantalla de Estadísticas caía en «No se pudo abrir esta pantalla» porque el saldo futuro a 90
 * días (`futureBalance`) proyectaba sin `stopWhenOutOfRange` y `projectBalance` lanzaba «Desbordamiento al sumar
 * importes» (defecto anterior a la pasada, reproducido en `21b4ed8`). Ahora la curva se omite y se dice por qué.
 * Datos sintéticos; fechas explícitas.
 */
import { describe, expect, it } from 'vitest'
import { analysisItems } from './analysis'
import { estimateDailySpend } from './projection'
import { futureBalance, periodStats, statsRange } from './statistics'
import { weeklyReview } from './weeklyReview'
import { account, baseData, tx } from '../test/fixtures'

describe('QA27 · revisión en navegador: el saldo futuro que no cabe en un entero exacto se omite, nunca rompe la pantalla', () => {
  const X = 999999999999
  const TODAY = '2026-10-22'
  const fixture = (count: number) =>
    baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 0, date: '2026-08-01', setAt: '2026-08-01T12:00:00.000Z' } })],
      transactions: Array.from({ length: count }, (_, i) => tx({ id: `e${i}`, date: '2026-10-10', amountMinor: X, kind: 'expense', status: 'realized', categoryId: 'groceries' })),
    })

  it('4 520 gastos de 999 999 999 999: el gasto diario estimado cabe, pero 91 días de proyección no; no se lanza nada y la razón es `outOfRange`', () => {
    const d = fixture(4520)
    const est = estimateDailySpend(d, TODAY, 30)
    // 4 519 999 999 995 480 entre los 12 días observados (del 10-oct a hoy): cabe; × 91 días ya no (> 2⁵³ − 1).
    expect(est).toMatchObject({ totalMinor: 4519999999995480, daysObserved: 12, sufficient: true })
    expect(() => futureBalance(d, TODAY)).not.toThrow()
    expect(futureBalance(d, TODAY)).toMatchObject({ enough: false, reason: 'outOfRange', points: [], marks: [] })
    // El resto de la pantalla no depende de la curva: totales y comparación exactos, Análisis y Revisión semanal en pie.
    expect(periodStats(d, 'month', statsRange('month', d.settings, TODAY)).expenses).toEqual({ diffMinor: 4519999999995480, percent: null })
    expect(() => analysisItems(d, TODAY)).not.toThrow()
    expect(() => weeklyReview(d, '2026-10-19', TODAY)).not.toThrow()
  })

  it('con la décima parte (452 gastos) la proyección cabe y la curva se dibuja con sus 91 puntos y 4 marcas', () => {
    const fb = futureBalance(fixture(452), TODAY)
    expect(fb).toMatchObject({ enough: true, reason: null })
    expect(fb.points).toHaveLength(91)
    expect(fb.marks.map((m) => m.date)).toEqual(['2026-10-22', '2026-11-21', '2026-12-21', '2027-01-20'])
    for (const p of fb.points) expect(Number.isSafeInteger(p.pessimisticMinor) && Number.isSafeInteger(p.optimisticMinor)).toBe(true)
  })
})
