/**
 * Revisión independiente de la pasada correctiva de la auditoría del 2026-11-04 (revisor de dominio): cada hallazgo
 * confirmado, con su reproducción y el comportamiento correcto. Datos sintéticos; X = 10¹² (el mayor importe suelto).
 *  - R1: el gasto diario estimado por los días hasta el faltante se multiplicaba sin verificar (una unidad de error).
 *  - R2: cada palanca del plan ante faltante decía la cobertura de la proyección base, no la suya.
 *  - R4: con el saldo real de hoy ya negativo, el resumen daba la cifra de un cierre de hoy que no se calculó (o «faltan −40»).
 *  - R5: el total de pagos vencidos de Análisis sumaba sin verificar y la pantalla no abría con miles de vencidos grandes.
 *  - R6–R8: duplicados (tramos del mismo programado acotados; decisiones repetidas; orden de las reconstruidas).
 */
import { describe, expect, it } from 'vitest'
import { analysisItems } from './analysis'
import { DUPLICATE_PAIRS_PER_GROUP, computeInbox, inboxView, scanDuplicates } from './inbox'
import { estimateDailySpend, flowHeadline, projectBalance } from './projection'
import { analyzeShortfall } from './shortfall'
import { validateAppData } from '../storage/backup'
import { account, baseData, bill, income, tx } from '../test/fixtures'
import type { AppData } from './types'

const TODAY = '2026-11-04'
const X = 1_000_000_000_000
const MAX = Number.MAX_SAFE_INTEGER
const anchor = (amountMinor: number, date = '2026-11-03') => ({ amountMinor, date, setAt: `${date}T12:00:00.000Z` })
const persisted = (d: AppData): AppData => JSON.parse(JSON.stringify(d)) as AppData
const withHorizon = (d: AppData): AppData => ({ ...d, settings: { ...d.settings, fallbackHorizonDays: 7 } })

describe('Revisión · plan ante faltante', () => {
  it('R1: gasto diario estimado × días que no cabe en un entero exacto → sin cifra (null), nunca un producto redondeado', () => {
    // 7 días de historial con 714 000 000 000 007 de gasto → 102 000 000 000 001 al día; 102 ingresos diarios de X.
    const D = 102_000_000_000_001
    const history = [...Array.from({ length: 714 }, (_, i) => tx({ id: `h${i}`, date: '2026-10-28', amountMinor: X, note: `h${i}` })), tx({ id: 'h-last', date: '2026-10-28', amountMinor: 7 * D - 714 * X, note: 'resto' })]
    const d = withHorizon(baseData({ accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(88) })], transactions: history, schedules: Array.from({ length: 102 }, (_, i) => income(TODAY, X, { id: `in${i}`, name: `Ingreso ${i}`, frequency: 'daily' })) }))
    expect(validateAppData(persisted(d)).ok).toBe(true)
    const est = estimateDailySpend(d, TODAY)
    expect(est).toMatchObject({ dailyMinor: D, sufficient: true })
    const a = analyzeShortfall(d, TODAY, { days: 90, dailySpendMinor: est.dailyMinor })
    expect(a.status).toBe('shortfall')
    if (a.status !== 'shortfall') return
    // D × 89 = 9 078 000 000 000 089 > 2⁵³ − 1: antes 9078000000000088 (una unidad menos).
    expect(BigInt(D) * 89n > BigInt(MAX)).toBe(true)
    expect(a.dailySpendTotalMinor).toBeNull()
    // Lo que sí cabe se dice exacto: un gasto diario pequeño da su producto.
    const small = analyzeShortfall(baseData({ accounts: [account({ id: 'main', anchor: anchor(1000) })], schedules: [bill('2026-11-06', 5000, { id: 'b' })] }), TODAY, { dailySpendMinor: 300 })
    expect(small.status === 'shortfall' && small.dailySpendTotalMinor).toBe(300 * 3)
  })

  it('R2: cada palanca lleva la cobertura de SU simulación (hasta el 4-nov), no la de la base (hasta el 3-dic)', () => {
    const d = withHorizon(
      baseData({
        accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(X) })],
        transactions: [tx({ id: 'buy', kind: 'expense', status: 'planned', amountMinor: X, date: TODAY, note: 'Compra prevista' })],
        schedules: [
          ...Array.from({ length: 9007 }, (_, i) => income('2026-11-05', X, { id: `in${i}`, name: `Ingreso ${i}` })),
          ...Array.from({ length: 4504 }, (_, i) => bill('2026-11-06', X, { id: `out${i}`, name: `Pago ${i}` })),
          ...Array.from({ length: 4504 }, (_, i) => bill('2026-11-07', X, { id: `outb${i}`, name: `Pago b ${i}` })),
        ],
      }),
    )
    expect(validateAppData(persisted(d)).ok).toBe(true)
    const a = analyzeShortfall(d, TODAY)
    expect(a.status).toBe('shortfall')
    if (a.status !== 'shortfall') return
    expect(a.projection).toMatchObject({ outOfRangeFrom: null, lastExactDate: '2026-12-03' })
    const reduce = a.levers.find((l) => l.lever.kind === 'reducePlanned')!
    expect(reduce.effect).toMatchObject({ firstNegativeDate: null, outOfRangeFrom: '2026-11-05', lastExactDate: '2026-11-04', resolves: false })
  }, 60_000)

  it('R4: el saldo real de hoy ya es negativo y hoy entra más de lo que sale → el faltante es el de hoy al empezar (1 000), no «−4 000»', () => {
    const d = baseData({ accounts: [account({ id: 'main', anchor: anchor(-1000) })], schedules: [income(TODAY, 5000, { id: 'i' })] })
    const a = analyzeShortfall(d, TODAY)
    expect(a.status).toBe('shortfall')
    if (a.status !== 'shortfall') return
    expect(a).toMatchObject({ firstNegativeDate: TODAY, firstNegativeMinor: 1000, shortfallAt: 'startOfDay' })
  })

  it('R4: cero días exactos con el saldo real negativo → el faltante es el saldo real (100 000), sin cifra de un cierre que no se calculó', () => {
    const d = withHorizon(baseData({ accounts: [account({ id: 'main', anchor: anchor(-100000) })], schedules: Array.from({ length: 9008 }, (_, i) => income(TODAY, X, { id: `z${i}`, name: `Hoy ${i}` })) }))
    expect(validateAppData(persisted(d)).ok).toBe(true)
    const p = projectBalance(d, TODAY)
    expect(p).toMatchObject({ exactDays: 0, lastExactDate: null, firstNegativeDate: TODAY })
    const a = analyzeShortfall(d, TODAY, { dailySpendMinor: 5000 })
    expect(a.status).toBe('shortfall')
    if (a.status !== 'shortfall') return
    expect(a).toMatchObject({ firstNegativeMinor: 100000, shortfallAt: 'startOfDay' })
  })

  it('R4: el caso de siempre (el cierre de ese día tiene cifra y es negativo) sigue siendo el cierre', () => {
    const d = baseData({ accounts: [account({ id: 'main', anchor: anchor(1000) })], schedules: [bill('2026-11-06', 5000, { id: 'b' })] })
    const a = analyzeShortfall(d, TODAY)
    expect(a.status === 'shortfall' && [a.firstNegativeDate, a.firstNegativeMinor, a.shortfallAt]).toEqual(['2026-11-06', 4000, 'endOfDay'])
  })
})

describe('Revisión · calendario', () => {
  it('R3: la línea de flujo sin ningún día exacto no afirma «sin saldo negativo hasta hoy»; con el saldo real negativo, lo dice con esa cifra', () => {
    const zero = (start: number) => withHorizon(baseData({ accounts: [account({ id: 'main', anchor: anchor(start) })], schedules: Array.from({ length: 9008 }, (_, i) => income(TODAY, X, { id: `z${i}`, name: `Hoy ${i}` })) }))
    expect(flowHeadline(projectBalance(zero(100000), TODAY, { days: 60 }))).toEqual({ kind: 'noExactDay' })
    expect(flowHeadline(projectBalance(zero(-100000), TODAY, { days: 60 }))).toEqual({ kind: 'shortfall', date: TODAY, amountMinor: -100000 })
    // El saldo real negativo y hoy entra más de lo que sale: la cifra es el saldo real, no un cierre positivo.
    expect(flowHeadline(projectBalance(baseData({ accounts: [account({ id: 'main', anchor: anchor(-1000) })], schedules: [income(TODAY, 5000, { id: 'i' })] }), TODAY))).toEqual({ kind: 'shortfall', date: TODAY, amountMinor: -1000 })
    // Los casos de siempre.
    expect(flowHeadline(projectBalance(baseData({ accounts: [account({ id: 'main', anchor: anchor(1000) })], schedules: [bill('2026-11-06', 5000, { id: 'b' })] }), TODAY))).toEqual({ kind: 'shortfall', date: '2026-11-06', amountMinor: -4000 })
    expect(flowHeadline(projectBalance(baseData({ accounts: [account({ id: 'main', anchor: anchor(100000) })] }), TODAY, { days: 60 }))).toEqual({ kind: 'noShortfall', until: '2027-01-02' })
  })
})

describe('Revisión · Análisis', () => {
  it('R5: 9 008 pagos vencidos de X (datos válidos) → Análisis no lanza; el aviso dice el recuento y el total sin cifra', () => {
    const d = withHorizon(baseData({ accounts: [account({ id: 'main', anchor: anchor(100000) })], schedules: Array.from({ length: 9008 }, (_, i) => bill('2026-11-03', X, { id: `o${i}`, name: `Vencido ${i}` })) }))
    expect(validateAppData(persisted(d)).ok).toBe(true)
    expect(() => analysisItems(d, TODAY)).not.toThrow()
    const overdue = analysisItems(d, TODAY).find((i) => i.id === 'overdueBills')!
    expect(overdue.params).toEqual({ count: 9008 })
    expect(overdue.because).toEqual([
      { id: 'overdueCount', kind: 'count', value: 9008 },
      { id: 'overdueTotal', kind: 'noFigure', value: '', op: '=' },
    ])
    // Con pocos vencidos, el total exacto de siempre.
    const few = analysisItems(baseData({ schedules: [bill('2026-11-01', 2500, { id: 'a' }), bill('2026-11-02', 1500, { id: 'b' })] }), TODAY).find((i) => i.id === 'overdueBills')!
    expect(few.params).toEqual({ count: 2, total: 4000 })
  })
})

describe('Revisión · duplicados', () => {
  it('R6: 3 000 cuotas parciales de la misma ocurrencia el mismo día, sin nota → ninguna pareja y trabajo lineal (antes 4 498 500 comparaciones)', () => {
    const d = baseData({ transactions: Array.from({ length: 3000 }, (_, i) => tx({ id: `q${String(i).padStart(4, '0')}`, date: TODAY, amountMinor: 1000, scheduleId: 'r', occurrenceDate: TODAY, partialSettlement: true })) })
    const scan = scanDuplicates(d, () => false)
    expect(scan).toEqual({ pairs: [], truncated: false, examined: 0 })
    // Alternando dos programados: solo cuentan las parejas que coinciden (las del otro programado), acotadas por el tope.
    const mixed = baseData({ transactions: Array.from({ length: 3000 }, (_, i) => tx({ id: `m${String(i).padStart(4, '0')}`, date: TODAY, amountMinor: 1000, scheduleId: i % 2 ? 'r' : 's', occurrenceDate: TODAY })) })
    const m = scanDuplicates(mixed, () => false)
    expect(m.pairs).toHaveLength(DUPLICATE_PAIRS_PER_GROUP)
    expect(m.truncated).toBe(true)
    expect(m.examined).toBe(DUPLICATE_PAIRS_PER_GROUP + 1)
  })

  const crowded = () => {
    const pair = [tx({ id: 'p1', date: TODAY, amountMinor: 425, note: 'Café' }), tx({ id: 'p2', date: TODAY, amountMinor: 425, note: 'Café' })]
    const alone = baseData({ transactions: pair })
    const item = computeInbox(alone, TODAY).find((i) => i.id === 'dup:p1:p2')!
    const earlier = Array.from({ length: 12 }, (_, i) => tx({ id: `e${String(i).padStart(2, '0')}`, date: '2026-10-27', amountMinor: 425, note: 'Café' }))
    return { data: { ...alone, transactions: [...earlier, ...pair] }, item }
  }
  const at = `${TODAY}T12:00:00.000Z`
  const dupIds = (items: { id: string }[]) => items.filter((i) => i.id.startsWith('dup:')).map((i) => i.id)

  it('R7: una decisión repetida se lee como la clasifica la vista (el último registro manda); nunca 51 activas en un grupo de tope 50', () => {
    const { data, item } = crowded()
    for (const [dismissed, expected] of [
      [[{ id: item.id, fingerprint: item.fingerprint, at }, { id: item.id, fingerprint: 'otra', at }], []],
      [[{ id: item.id, fingerprint: 'otra', at }, { id: item.id, fingerprint: item.fingerprint, at }], ['dup:p1:p2']],
    ] as const) {
      const view = inboxView(persisted({ ...data, inbox: { snoozed: [], dismissed: [...dismissed] } }), TODAY)
      expect(dupIds(view.dismissed)).toEqual(expected)
      expect(view.active.filter((i) => i.kind === 'duplicate').length).toBeLessThanOrEqual(DUPLICATE_PAIRS_PER_GROUP)
      expect(dupIds(view.active)).not.toContain('dup:p1:p2')
    }
    const snoozed = inboxView(persisted({ ...data, inbox: { dismissed: [], snoozed: [{ id: item.id, until: '2026-11-11', at }, { id: item.id, until: '2026-11-03', at }] } }), TODAY)
    expect(snoozed.snoozed).toEqual([])
    expect(snoozed.active.filter((i) => i.kind === 'duplicate')).toHaveLength(DUPLICATE_PAIRS_PER_GROUP)
  })

  it('R8: en «Descartados» las parejas reconstruidas van con las demás parejas, antes de los avisos de otro tipo', () => {
    const { data, item } = crowded()
    const withOther = { ...data, transactions: [...data.transactions, tx({ id: 'u1', date: TODAY, amountMinor: 999, categoryId: 'other_expense', note: 'Sin categoría' })] }
    const scanned = computeInbox(withOther, TODAY).find((i) => i.id === 'dup:e00:e01')!
    const uncategorized = computeInbox(withOther, TODAY).find((i) => i.id === 'cat:u1')!
    const view = inboxView(
      persisted({ ...withOther, inbox: { snoozed: [], dismissed: [{ id: uncategorized.id, fingerprint: uncategorized.fingerprint, at }, { id: item.id, fingerprint: item.fingerprint, at }, { id: scanned.id, fingerprint: scanned.fingerprint, at }] } }),
      TODAY,
    )
    expect(view.dismissed.map((i) => i.id)).toEqual(['dup:e00:e01', 'dup:p1:p2', 'cat:u1'])
  })
})
