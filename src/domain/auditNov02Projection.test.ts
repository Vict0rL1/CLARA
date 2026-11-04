/**
 * Auditoría independiente del 2026-11-02 sobre `420c700` (prioridad 4, límite documentado y reproducido): 400 gastos
 * programados diarios de 1 000 000 000 000 pasan la validación pero desbordan la proyección normal a 30 días, y
 * Proyección, Análisis, Plan ante faltante, Escenarios y «¿Me alcanza?» caían en «No se pudo abrir esta pantalla».
 * Con el reloj en el 2-nov-2026 hay 22 días exactos y `outOfRangeFrom` = 24-nov. Ahora la proyección nunca lanza: se
 * detiene en el último día exacto y lo dice, y cada consumidor declara lo que no puede afirmar (saldo al final,
 * «sin faltante», «lo evita»). Nada se redondea, recorta ni inventa; los presupuestos normales no cambian. Datos sintéticos.
 */
import { describe, expect, it } from 'vitest'
import { simulatePurchase } from './affordability'
import { analysisItems } from './analysis'
import { computeBudget } from './budget'
import { compareScenarios, projectBalance } from './projection'
import { compare, evaluate } from './scenarios'
import { analyzeShortfall, evaluateLevers } from './shortfall'
import { validateAppData } from '../storage/backup'
import { account, baseData, bill, income } from '../test/fixtures'

const TODAY = '2026-11-02'
const X = 1_000_000_000_000
const MAX = Number.MAX_SAFE_INTEGER

/**
 * 400 programados diarios de 10¹² desde hoy (gastos, como en la auditoría; o ingresos, para que el saldo se salga del
 * rango por arriba sin bajar nunca de cero); saldo de referencia `balance` el 1-nov.
 */
const fixture = (balance = 500000, count = 400, kind: 'expense' | 'income' = 'expense') => {
  const make = kind === 'expense' ? bill : income
  const d = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: balance, date: '2026-11-01', setAt: '2026-11-01T12:00:00.000Z' } })],
    schedules: Array.from({ length: count }, (_, i) => make('2026-11-02', X, { id: `d${i}`, name: `Diario ${i}`, frequency: 'daily' })),
  })
  return { ...d, settings: { ...d.settings, fallbackHorizonDays: 7 } }
}
/** La variante que nunca baja de cero: 400 ingresos diarios de 10¹² (el saldo se sale del rango exacto el 24-nov por arriba). */
const positive = () => fixture(500000, 400, 'income')

describe('Auditoría 2026-11-02 · P4: proyección fuera del rango exacto en todas las pantallas que proyectan', () => {
  it('la reproducción: los datos validan; la proyección a 30 días no lanza, tiene 22 días exactos y dice que desde el 24-nov no hay cifra', () => {
    const d = fixture()
    expect(validateAppData(JSON.parse(JSON.stringify(d))).ok).toBe(true)
    expect(() => projectBalance(d, TODAY)).not.toThrow()
    const p = projectBalance(d, TODAY)
    expect(p.days).toHaveLength(22)
    expect(p.outOfRangeFrom).toBe('2026-11-24')
    expect(p.horizonDays).toBe(30)
    // Cada día exacto lo es de verdad: nunca una cifra recortada.
    for (const day of p.days) expect(Number.isSafeInteger(day.endMinor) && Math.abs(day.endMinor) <= MAX).toBe(true)
    expect(p.days[21]!.endMinor).toBe(500000 - 22 * 400 * X)
    expect(p.endMinor).toBe(p.days[21]!.endMinor)
    // Día 1 ya negativo: el faltante encontrado es real aunque la proyección sea parcial.
    expect(p.firstNegativeDate).toBe(TODAY)
  })

  it('Análisis no lanza: conserva la señal de faltante (exacta) y añade la de proyección incompleta con sus dos fechas', () => {
    const d = fixture()
    expect(() => analysisItems(d, TODAY)).not.toThrow()
    const items = analysisItems(d, TODAY)
    expect(items.find((i) => i.id === 'shortfall')).toMatchObject({ severity: 'critical', params: { date: TODAY } })
    const partial = items.find((i) => i.id === 'projectionOutOfRange')
    expect(partial).toMatchObject({ severity: 'info', params: { date: '2026-11-24', until: '2026-11-23', days: 22, horizon: 60 } })
    expect(partial!.because).toEqual([
      { id: 'exactUntil', kind: 'date', value: '2026-11-23' },
      { id: 'outOfRangeFrom', kind: 'date', value: '2026-11-24' },
    ])
  })

  it('Plan ante faltante no lanza: con saldo bajo el faltante del día 1 es real; con saldo alto no afirma «sin faltante» y ninguna palanca «lo evita»', () => {
    const low = analyzeShortfall(fixture(), TODAY)
    expect(low.status).toBe('shortfall')
    expect(low.projection.outOfRangeFrom).toBe('2026-11-24')
    if (low.status === 'shortfall') {
      expect(low.firstNegativeDate).toBe(TODAY)
      for (const l of low.levers) expect(l.effect.resolves).toBe(false)
    }
    // Ingresos en vez de gastos: 22 días exactos sin bajar de cero, y después sin cifra. Nada afirma que no haya faltante.
    const high = analyzeShortfall(positive(), TODAY)
    expect(high.status).toBe('none')
    expect(high.projection.outOfRangeFrom).toBe('2026-11-24')
    expect(high.projection.days).toHaveLength(22)
    const effect = evaluateLevers(positive(), TODAY, [{ kind: 'dailySpend', fromMinor: 1000, toMinor: 0 }])
    expect(effect).toMatchObject({ firstNegativeDate: null, resolves: false, outOfRangeFrom: '2026-11-24' })
  })

  it('Escenarios no lanzan: la situación actual y cada alternativa llevan la fecha desde la que no hay cifra; el saldo al final es el del último día exacto', () => {
    const d = positive()
    expect(() => compare(d, TODAY, [])).not.toThrow()
    const base = compare(d, TODAY, []).base
    expect(base).toMatchObject({ outOfRangeFrom: '2026-11-24', firstNegativeDate: null, shortfallMinor: 0 })
    expect(base.endMinor).toBe(500000 + 22 * 400 * X)
    // Con los gastos de la auditoría (saldo bajo) el faltante del día 1 es real y también se dice desde cuándo no hay cifra.
    expect(compare(fixture(), TODAY, []).base).toMatchObject({ outOfRangeFrom: '2026-11-24', firstNegativeDate: TODAY })
    const alt = evaluate(d, TODAY, [{ type: 'purchase', amountMinor: 1000, date: TODAY }])
    expect(alt.outOfRangeFrom).toBe('2026-11-24')
    expect(alt.endMinor).toBe(base.endMinor - 1000)
    for (const c of compareScenarios(d, TODAY)) expect(c.outOfRangeFrom).toBe('2026-11-24')
  })

  it('«¿Me alcanza?» no lanza: el veredicto sale del disponible de hoy y la proyección declara desde cuándo no hay cifra', () => {
    const d = positive()
    expect(() => simulatePurchase(d, TODAY, 1000)).not.toThrow()
    const r = simulatePurchase(d, TODAY, 1000)
    expect(r.projectionOutOfRangeFrom).toBe('2026-11-24')
    expect(r.futureShortfallDate).toBeNull()
    expect(() => simulatePurchase(fixture(), TODAY, 1000)).not.toThrow()
    expect(simulatePurchase(fixture(), TODAY, 1000).projectionOutOfRangeFrom).toBe('2026-11-24')
    expect(r.projectionBefore.days).toHaveLength(22)
    expect(r.projectionAfter.days).toHaveLength(22)
    expect(computeBudget(d, TODAY).status).toBe('ok')
  })

  it('un presupuesto normal no cambia: 30 días completos, sin fecha fuera de rango, y «lo evita» sigue afirmándose con la proyección completa', () => {
    const d = baseData({ schedules: [income('2026-11-09', 60000, { id: 'i' }), bill('2026-11-05', 50000, { id: 'b' })] })
    const p = projectBalance(d, TODAY)
    expect(p.days).toHaveLength(30)
    expect(p.outOfRangeFrom).toBeNull()
    expect(p.horizonDays).toBe(30)
    expect(compare(d, TODAY, []).base.outOfRangeFrom).toBeNull()
    expect(simulatePurchase(d, TODAY, 1000).projectionOutOfRangeFrom).toBeNull()
    expect(analysisItems(d, TODAY).some((i) => i.id === 'projectionOutOfRange')).toBe(false)
    expect(evaluateLevers(d, TODAY, [{ kind: 'dailySpend', fromMinor: 1000, toMinor: 0 }])).toMatchObject({ resolves: true, outOfRangeFrom: null })
  })

  it('con la décima parte (40 programados) los 30 días caben y nada cambia de forma', () => {
    const p = projectBalance(fixture(500000, 40), TODAY)
    expect(p.days).toHaveLength(30)
    expect(p.outOfRangeFrom).toBeNull()
    expect(p.days[29]!.endMinor).toBe(500000 - 30 * 40 * X)
  })
})
