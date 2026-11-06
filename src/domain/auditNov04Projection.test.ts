/**
 * Auditoría independiente del 2026-11-04 sobre `f8d6da0` (F1 y F2), con el reloj en el 4-nov-2026 y datos sintéticos.
 *
 * F1 · totales brutos: 400 ingresos y 400 gastos programados diarios de 10¹² dejan cada saldo diario en 100 000 exactos,
 * pero la suma de TODOS los ingresos (o de todos los pagos) de los días exactos no cabe en un entero exacto;
 * `compareScenarios` y el «¿Cómo se calculó?» de Análisis sumaban con `sumMinor`, lanzaban y las pantallas caían en «No
 * se pudo abrir esta pantalla». Ahora cada total bruto es verificado: `null` = sin cifra (se dice), nunca se recorta,
 * redondea, pone a cero ni se descarta la proyección; los saldos, el mínimo, el saldo final y las fechas de faltante
 * siguen siendo exactos (el 27-nov con −1).
 *
 * F2 · cobertura por escenario: 400 ingresos variables diarios (mínimo 1, esperado y extra 10¹²): el mínimo es exacto los
 * 30 días (hasta el 3-dic) y el esperado y el extra solo 22 (hasta el 25-nov, sin cifra desde el 26-nov). Cada fila dice
 * la cobertura de SU proyección; con cero días exactos (ni el cierre de hoy cabe) nadie afirma «hasta hoy».
 */
import { describe, expect, it } from 'vitest'
import { simulatePurchase } from './affordability'
import { analysisItems } from './analysis'
import { compareScenarios, grossInflows, grossOutflows, projectBalance, type ProjectionDay } from './projection'
import { compare, evaluate } from './scenarios'
import { analyzeShortfall } from './shortfall'
import { validateAppData } from '../storage/backup'
import { account, baseData, bill, income, tx } from '../test/fixtures'
import type { AppData } from './types'

const TODAY = '2026-11-04'
const X = 1_000_000_000_000
const MAX = Number.MAX_SAFE_INTEGER
const anchor = (amountMinor: number, date: string) => ({ amountMinor, date, setAt: `${date}T12:00:00.000Z` })
const persisted = (d: AppData): AppData => JSON.parse(JSON.stringify(d)) as AppData

/** nov04-gross-income: 400 ingresos y 400 gastos diarios de 10¹² (neto 0 al día; saldo 100 000 exacto) más un ingreso variable (mínimo 0). */
const grossIncome = (): AppData => {
  const d = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(100000, '2026-11-03') })],
    schedules: [
      ...Array.from({ length: 400 }, (_, i) => income(TODAY, X, { id: `in${i}`, name: `Ingreso ${i}`, frequency: 'daily' })),
      ...Array.from({ length: 400 }, (_, i) => bill(TODAY, X, { id: `out${i}`, name: `Pago ${i}`, frequency: 'daily' })),
      income('2026-12-15', 1000, { id: 'var', name: 'Variable', frequency: 'monthly', range: { minMinor: 0, extraMinor: 2000 } }),
    ],
  })
  return { ...d, settings: { ...d.settings, fallbackHorizonDays: 7 } }
}
/** nov04-analysis-gross: lo mismo más una compra prevista de 100 001 el 27-nov → saldo −1 ese día. */
const analysisGross = (): AppData => ({ ...grossIncome(), transactions: [tx({ id: 'planned', kind: 'expense', status: 'planned', amountMinor: 100001, date: '2026-11-27', note: 'Compra prevista' })] })
/** nov04-scenario-dates: 400 ingresos variables diarios (mínimo 1, esperado y extra 10¹²). */
const scenarioDates = (): AppData => {
  const d = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(100000, '2026-11-03') })],
    schedules: Array.from({ length: 400 }, (_, i) => income(TODAY, X, { id: `v${i}`, name: `Variable ${i}`, frequency: 'daily', range: { minMinor: 1, extraMinor: X } })),
  })
  return { ...d, settings: { ...d.settings, fallbackHorizonDays: 7 } }
}
/**
 * Cero días exactos: 9 008 ingresos de 10¹² hoy (9,008 × 10¹⁵ > 2⁵³ − 1): ni el cierre de hoy cabe. Ingresos y no pagos:
 * 9 008 pagos de 10¹² pendientes hoy desbordan además la suma de pagos pendientes del disponible (`computeBudget`), un
 * límite aparte de esta auditoría que el informe deja anotado.
 */
const zeroDays = (): AppData => {
  const d = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(100000, '2026-11-03') })],
    schedules: Array.from({ length: 9008 }, (_, i) => income(TODAY, X, { id: `z${i}`, name: `Hoy ${i}` })),
  })
  return { ...d, settings: { ...d.settings, fallbackHorizonDays: 7 } }
}
const day = (events: number[], extraMinor = 0, dailySpendMinor = 0): ProjectionDay =>
  ({ date: TODAY, startMinor: 0, events: events.map((budgetEffectMinor) => ({ budgetEffectMinor })), eventsMinor: 0, dailySpendMinor, extraMinor, endMinor: 0 }) as unknown as ProjectionDay

describe('Auditoría 2026-11-04 · F1: totales brutos fuera del rango exacto con saldos diarios exactos', () => {
  it('la reproducción: los datos validan, cada día cierra en 100 000 exactos y compareScenarios no lanza; los ingresos brutos salen sin cifra (null) y lo demás exacto', () => {
    const d = grossIncome()
    expect(validateAppData(persisted(d)).ok).toBe(true)
    const p = projectBalance(d, TODAY)
    expect(p.outOfRangeFrom).toBeNull()
    expect(p.days).toHaveLength(30)
    expect(p.days.every((x) => x.endMinor === 100000)).toBe(true)
    expect(() => compareScenarios(d, TODAY)).not.toThrow()
    const rows = compareScenarios(d, TODAY)
    expect(rows.map((r) => r.scenario)).toEqual(['min', 'expected', 'extra'])
    for (const r of rows) {
      expect(r.incomeMinor).toBeNull()
      expect(r).toMatchObject({ endMinor: 100000, lowest: { minor: 100000 }, firstNegativeDate: null, outOfRangeFrom: null, lastExactDate: '2026-12-03', exactDays: 30 })
    }
    // Simétrico: los pagos brutos tampoco caben; ningún saldo diario deja de ser exacto.
    expect(grossInflows(p.days)).toBeNull()
    expect(grossOutflows(p.days)).toBeNull()
    for (const x of p.days) expect(Number.isSafeInteger(x.endMinor)).toBe(true)
  })

  it('Análisis no lanza con el faltante de −1 el 27-nov: la señal es exacta y el «porqué» dice ingresos y pagos sin cifra con el saldo de ese día', () => {
    const d = analysisGross()
    expect(validateAppData(persisted(d)).ok).toBe(true)
    expect(() => analysisItems(d, TODAY)).not.toThrow()
    const items = analysisItems(d, TODAY)
    const shortfall = items.find((i) => i.id === 'shortfall')
    expect(shortfall).toMatchObject({ severity: 'critical', params: { date: '2026-11-27', amount: -1 } })
    expect(shortfall!.because).toEqual([
      { id: 'startBalance', kind: 'money', value: 100000 },
      { id: 'inflowsUntil', kind: 'noFigure', value: '', op: '+' },
      { id: 'outflowsUntil', kind: 'noFigure', value: '', op: '−' },
      { id: 'balanceOn', kind: 'money', value: -1, op: '=' },
    ])
    // La proyección a 60 días es exacta de principio a fin: no hay señal de proyección incompleta.
    expect(items.some((i) => i.id === 'projectionOutOfRange')).toBe(false)
  })

  it('Plan ante faltante con los mismos datos: el faltante de −1 el 27-nov es exacto y las sumas brutas de pagos e ingresos hasta ese día van sin cifra', () => {
    // Horizonte de 24 días (hasta el 27-nov): con 30, cada uno de los 2 400 ingresos posteriores al faltante sería una
    // palanca «¿y si llegara el primer día negativo?» evaluada con una proyección entera (límite conocido, anotado).
    const a = analyzeShortfall(analysisGross(), TODAY, { days: 24 })
    expect(a.status).toBe('shortfall')
    if (a.status !== 'shortfall') return
    expect(a.firstNegativeDate).toBe('2026-11-27')
    expect(a.firstNegativeMinor).toBe(1)
    expect(a.contributorsTotalMinor).toBeNull()
    expect(a.incomesUntilFirstMinor).toBeNull()
    expect(a.projection.outOfRangeFrom).toBeNull()
    expect(a.contributors.length).toBe(24 * 400 + 1)
  })

  it('un presupuesto normal conserva sus cifras: ingresos y pagos brutos exactos, nunca null', () => {
    const d = baseData({ schedules: [income('2026-11-09', 60000, { id: 'i', range: { minMinor: 50000, extraMinor: 70000 } }), bill('2026-11-05', 50000, { id: 'b' })] })
    const [min, expected, extra] = compareScenarios(d, TODAY)
    expect([min!.incomeMinor, expected!.incomeMinor, extra!.incomeMinor]).toEqual([50000, 60000, 70000])
    expect(min).toMatchObject({ outOfRangeFrom: null, lastExactDate: '2026-12-03', exactDays: 30 })
    const a = analyzeShortfall({ ...d, accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(1000, '2026-11-03') })] }, TODAY)
    expect(a.status).toBe('shortfall')
    if (a.status === 'shortfall') expect([a.contributorsTotalMinor, a.incomesUntilFirstMinor]).toEqual([50000, 0])
  })

  it('la frontera exacta: una suma bruta de exactamente 2⁵³ − 1 cabe y una unidad más no; nunca se recorta ni se redondea', () => {
    const exact = [day(Array.from({ length: 9007 }, () => X)), day([199_254_740_991])]
    expect(grossInflows(exact)).toBe(MAX)
    expect(grossInflows([...exact, day([1])])).toBeNull()
    expect(grossOutflows(exact.map((d) => day(d.events.map((e) => -e.budgetEffectMinor))))).toBe(MAX)
    expect(grossOutflows([...exact.map((d) => day(d.events.map((e) => -e.budgetEffectMinor))), day([], -1)])).toBeNull()
    // El gasto diario estimado y las salidas simuladas cuentan como pagos, en positivo.
    expect(grossOutflows([day([-500], -200, 300)])).toBe(1000)
    expect(grossInflows([day([-500, 700], -200, 300)])).toBe(700)
  })
})

describe('Auditoría 2026-11-04 · F2: cobertura exacta por escenario', () => {
  it('la reproducción: mínimo exacto los 30 días (hasta el 3-dic); esperado y extra 22 (hasta el 25-nov, sin cifra desde el 26-nov); la cobertura es de cada fila', () => {
    const d = scenarioDates()
    expect(validateAppData(persisted(d)).ok).toBe(true)
    const [min, expected, extra] = compareScenarios(d, TODAY)
    expect(min).toMatchObject({ outOfRangeFrom: null, lastExactDate: '2026-12-03', exactDays: 30, firstNegativeDate: null, incomeMinor: 30 * 400 })
    expect(expected).toMatchObject({ outOfRangeFrom: '2026-11-26', lastExactDate: '2026-11-25', exactDays: 22, firstNegativeDate: null, incomeMinor: 22 * 400 * X })
    expect(extra).toMatchObject({ outOfRangeFrom: '2026-11-26', lastExactDate: '2026-11-25', exactDays: 22 })
    expect(expected!.endMinor).toBe(100000 + 22 * 400 * X)
    // La proyección elegida no cambia la cobertura de las demás: compareScenarios no depende del escenario de la pantalla.
    for (const scenario of ['min', 'expected', 'extra'] as const) {
      const own = projectBalance(d, TODAY, { scenario })
      expect(own.lastExactDate).toBe(scenario === 'min' ? '2026-12-03' : '2026-11-25')
      expect(compareScenarios(d, TODAY).map((c) => c.lastExactDate)).toEqual(['2026-12-03', '2026-11-25', '2026-11-25'])
    }
  })

  it('cero días exactos: ni el cierre de hoy cabe → sin «hasta el …» en ninguna pantalla (null), nunca «hoy» como día con cifra', () => {
    const d = zeroDays()
    expect(validateAppData(persisted(d)).ok).toBe(true)
    const p = projectBalance(d, TODAY)
    expect(p).toMatchObject({ outOfRangeFrom: TODAY, lastExactDate: null, exactDays: 0, days: [], firstNegativeDate: null })
    for (const c of compareScenarios(d, TODAY)) expect(c).toMatchObject({ outOfRangeFrom: TODAY, lastExactDate: null, exactDays: 0 })
    const partial = analysisItems(d, TODAY).find((i) => i.id === 'projectionOutOfRange')
    expect(partial).toMatchObject({ params: { date: TODAY, until: '', days: 0, horizon: 60 } })
    expect(partial!.because).toEqual([{ id: 'outOfRangeFrom', kind: 'date', value: TODAY }])
    expect(compare(d, TODAY, []).base).toMatchObject({ outOfRangeFrom: TODAY, lastExactDate: null })
    expect(evaluate(d, TODAY, [{ type: 'purchase', amountMinor: 1000, date: TODAY }])).toMatchObject({ outOfRangeFrom: TODAY, lastExactDate: null })
    expect(simulatePurchase(d, TODAY, 1000)).toMatchObject({ projectionOutOfRangeFrom: TODAY, projectionLastExactDate: null })
    const s = analyzeShortfall(d, TODAY)
    expect(s.status).toBe('none')
    expect(s.projection).toMatchObject({ outOfRangeFrom: TODAY, lastExactDate: null, exactDays: 0 })
  })

  it('con 22 días exactos la cobertura dice el 25-nov en todas las pantallas que proyectan', () => {
    const d = scenarioDates()
    expect(compare(d, TODAY, [], { scenario: 'expected' }).base).toMatchObject({ outOfRangeFrom: '2026-11-26', lastExactDate: '2026-11-25' })
    expect(analyzeShortfall(d, TODAY, { scenario: 'extra' }).projection).toMatchObject({ outOfRangeFrom: '2026-11-26', lastExactDate: '2026-11-25', exactDays: 22 })
    // «¿Me alcanza?» proyecta con el mínimo (prudente): exacto los 30 días.
    expect(simulatePurchase(d, TODAY, 1000)).toMatchObject({ projectionOutOfRangeFrom: null, projectionLastExactDate: '2026-12-03' })
    const partial = analysisItems(d, TODAY).find((i) => i.id === 'projectionOutOfRange')
    expect(partial).toBeUndefined()
  })

  it('un presupuesto normal: el último día exacto es el del horizonte y los días exactos son todos', () => {
    const d = baseData({ schedules: [income('2026-11-09', 60000, { id: 'i' }), bill('2026-11-05', 50000, { id: 'b' })] })
    expect(projectBalance(d, TODAY)).toMatchObject({ outOfRangeFrom: null, lastExactDate: '2026-12-03', exactDays: 30 })
    expect(projectBalance(d, TODAY, { days: 60 })).toMatchObject({ lastExactDate: '2027-01-02', exactDays: 60 })
    expect(evaluate(d, TODAY, [])).toMatchObject({ outOfRangeFrom: null, lastExactDate: '2026-12-03' })
    expect(simulatePurchase(d, TODAY, 1000)).toMatchObject({ projectionOutOfRangeFrom: null, projectionLastExactDate: '2026-12-03' })
  })
})
