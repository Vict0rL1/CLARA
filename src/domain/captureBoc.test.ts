import { describe, expect, it } from 'vitest'
import { baseData, deepFreeze } from '../test/fixtures'
import type { BocRate } from './boc'
import { bocRatesNeeded, importCaptures, registerProposal } from './captureImport'
import type { CaptureRecord } from './captureQueue'
import { savePeriodBudget } from './periodBudgets'
import { tripSummary } from './trips'
import type { AppData } from './types'

/*
 * Decisión 181: capturas con la tasa del Banco de Canadá, ya pedida fuera del dominio. Hoy 16-nov-2026 (Toronto).
 * Tasas reales guardadas (`__fixtures__/boc`): JPY 0.00891 del viernes 6-nov (vale para el sábado 7 y el domingo 8) y
 * 0.00894 del 10-nov. A mano (un solo redondeo, mitades hacia arriba):
 *   ¥1 200 × 0,00891 = 10,692 → 10,69 $        ¥1 200 × 0,00891 × 1,025 = 10,9593 → 10,96 $
 *   ¥1 200 × 0,00894 = 10,728 → 10,73 $
 */
const ctx = { today: '2026-11-16', now: '2026-11-16T17:00:00.000Z' }
const FRI: BocRate = { rate: '0.00891', rateDate: '2026-11-06' }
const TUE: BocRate = { rate: '0.00894', rateDate: '2026-11-10' }
const boc = new Map<string, BocRate>([
  ['JPY|2026-11-08', FRI],
  ['JPY|2026-11-10', TUE],
])

let n = 0
function record(rawAmount: string, currencyHint: string | undefined, createdAt = '2026-11-08T15:00:00Z', overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  n += 1
  return { captureId: `cap-boc${String(n).padStart(6, '0')}`, createdAt, origin: 'apple_pay', rawAmount, ...(currencyHint ? { currencyHint } : {}), merchant: `Tienda ${n}`, ...overrides }
}

function withTrip(data: AppData, rates: { currency: 'JPY'; rate: string; date: string }[] = []): AppData {
  const r = savePeriodBudget(
    data,
    { id: 'japon', name: 'Japón', template: 'trip', startDate: '2026-11-05', endDate: '2026-11-20', allocatedMinor: 50000, trip: { currencies: ['JPY'], localCurrency: 'JPY', rates, feeBps: 250 } },
    ctx,
  )
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.data
}

function imported(data: AppData, records: CaptureRecord[], rates?: Map<string, BocRate>) {
  const r = importCaptures(deepFreeze(data), records, ctx, rates ? { boc: rates } : {})
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r
}

describe('capturas con la tasa del Banco de Canadá', () => {
  it('qué tasas hacen falta: nuevas, en otra moneda con serie, sin tasa del viaje; una por (moneda, fecha)', () => {
    const data = baseData()
    const a = record('1200', 'JPY')
    const b = record('500', 'JPY')
    const c = record('1200', 'JPY', '2026-11-10T15:00:00Z')
    const usd = record('25.00', 'USD')
    const cad = record('12.50', 'CAD')
    const test = record('1200', 'JPY', undefined, { test: true })
    const dkk = record('100', 'DKK')
    expect(bocRatesNeeded(data, [a, b, c, usd, cad, test, dkk], ctx)).toEqual([
      { currency: 'JPY', date: '2026-11-08' },
      { currency: 'JPY', date: '2026-11-10' },
      { currency: 'USD', date: '2026-11-08' },
    ])
    // Con tasa escrita del viaje para el yen, no se pide; con presupuesto en otra moneda, nunca.
    expect(bocRatesNeeded(withTrip(data, [{ currency: 'JPY', rate: '0.0092', date: '2026-11-05' }]), [a], ctx)).toEqual([])
    expect(bocRatesNeeded(baseData({ settings: { ...data.settings, currency: 'USD' } }), [a], ctx)).toEqual([])
    // Ya leída: no.
    const once = imported(data, [a])
    expect(bocRatesNeeded(once.data, [a], ctx)).toEqual([])
  })

  it('con la tasa: gasto real «Por revisar» convertido con `rateSource: "boc"` y la fecha de la observación', () => {
    const sun = record('1200', 'JPY')
    const tue = record('1200', 'JPY', '2026-11-10T15:00:00Z')
    const r = imported(baseData(), [sun, tue], boc)
    expect(r.value.saved).toEqual([sun.captureId, tue.captureId])
    expect(r.data.transactions.find((t) => t.id === sun.captureId)).toMatchObject({
      date: '2026-11-08',
      amountMinor: 1069,
      currency: 'CAD',
      original: { currency: 'JPY', amountMinor: 1200, rate: '0.00891', rateDate: '2026-11-06', rateSource: 'boc' },
      review: { needed: true, reason: 'currency' },
    })
    expect(r.data.transactions.find((t) => t.id === tue.captureId)).toMatchObject({ amountMinor: 1073, original: { rateDate: '2026-11-10', rateSource: 'boc' } })
    expect(r.data.transactions.find((t) => t.id === sun.captureId)?.original?.feeBps).toBeUndefined()
  })

  it('sin la tasa (apagado, sin conexión o sin tasa publicada): propuesta como siempre, nunca se inventa', () => {
    const sun = record('1200', 'JPY')
    for (const rates of [undefined, new Map<string, BocRate>(), new Map([['JPY|2026-11-07', FRI]])]) {
      const r = imported(baseData(), [sun], rates)
      expect(r.value.proposed).toEqual([sun.captureId])
      expect(r.data.transactions.some((t) => t.id === sun.captureId)).toBe(false)
      expect(r.data.captures?.proposals[0]).toMatchObject({ reason: 'currency', amount: { kind: 'foreign', currency: 'JPY', minor: 1200 } })
    }
  })

  it('durante un viaje sin tasa del yen: la del banco con la comisión del viaje, y se asocia al viaje', () => {
    const sun = record('1200', 'JPY')
    const r = imported(withTrip(baseData()), [sun], boc)
    expect(r.data.transactions.find((t) => t.id === sun.captureId)).toMatchObject({
      amountMinor: 1096,
      original: { rate: '0.00891', rateDate: '2026-11-06', rateSource: 'boc', feeBps: 250 },
    })
    expect(r.data.periodBudgets.find((b) => b.id === 'japon')?.txIds).toEqual([sun.captureId])
    const s = tripSummary(r.data, r.data.periodBudgets.find((b) => b.id === 'japon')!, ctx.today)
    expect(s).toMatchObject({ bocConverted: 1, unconvertedProposals: 0 })
    expect(s.period.spentMinor).toBe(1096)
  })

  it('la tasa escrita del viaje va primero: con ella no se usa la del banco', () => {
    const sun = record('1200', 'JPY')
    const r = imported(withTrip(baseData(), [{ currency: 'JPY', rate: '0.0092', date: '2026-11-05' }]), [sun], boc)
    // ¥1 200 × 0,0092 × 1,025 = 11,316 → 11,32 $
    expect(r.data.transactions.find((t) => t.id === sun.captureId)).toMatchObject({ amountMinor: 1132, original: { rate: '0.0092', rateSource: 'manual' } })
  })

  it('con «Guardar automáticamente» apagado o con presupuesto en otra moneda: propuesta', () => {
    const sun = record('1200', 'JPY')
    const data = baseData()
    const off = imported({ ...data, settings: { ...data.settings, capture: { autoSave: false, cardAccounts: [] } } }, [sun], boc)
    expect(off.value.proposed).toEqual([sun.captureId])
    const usd = imported(baseData({ settings: { ...data.settings, currency: 'USD' } }), [record('1200', 'JPY')], boc)
    expect(usd.value.saved).toEqual([])
  })

  it('registrar una propuesta con la tasa del banco guarda `rateSource: "boc"`', () => {
    const sun = record('1200', 'JPY')
    const p = imported(baseData(), [sun])
    const r = registerProposal(p.data, sun.captureId, ctx, { ...FRI, rateSource: 'boc' })
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.value).toMatchObject({ amountMinor: 1069, original: { rate: '0.00891', rateDate: '2026-11-06', rateSource: 'boc' } })
    // Sin `rateSource`, sigue siendo una tasa escrita.
    const manual = registerProposal(p.data, sun.captureId, ctx, FRI)
    expect(manual.ok && manual.value.original?.rateSource).toBe('manual')
  })
})
