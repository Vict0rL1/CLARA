import { describe, expect, it } from 'vitest'
import { validateAppData } from '../storage/backup'
import { baseData, ctx, EARLIER, tx } from '../test/fixtures'
import { savePeriodBudget, periodsProposedFor, setPeriodTransaction, type PeriodBudgetDraft } from './periodBudgets'
import { activeTrip, resolveAmbiguous, setTripLocalCurrency, setTripRate, tripRate, tripSummary } from './trips'
import type { AppData, CaptureProposal, OriginalAmount, TripSettings } from './types'
import { validatePeriodBudget } from './validation'

function ok<T>(r: { ok: true; data: AppData; value: T } | { ok: false; issues: unknown[] }) {
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r
}

const settings: TripSettings = {
  currencies: ['JPY', 'KRW', 'CNY'],
  localCurrency: 'JPY',
  rates: [
    { currency: 'JPY', rate: '0.0092', date: '2026-09-25' },
    { currency: 'KRW', rate: '0.00098', date: '2026-09-25' },
    { currency: 'CNY', rate: '0.1923', date: '2026-09-25' },
  ],
  feeBps: 250,
}
/** Del 25-sep al 4-oct (10 días), 500,00 $ asignados. «Hoy» en las pruebas es el 28-sep: 4 días transcurridos y 7 por delante. */
const draft: PeriodBudgetDraft = { id: 'asia', name: 'Asia', template: 'trip', startDate: '2026-09-25', endDate: '2026-10-04', allocatedMinor: 50000, trip: settings }

const original = (currency: OriginalAmount['currency'], amountMinor: number, rate: string): OriginalAmount => ({ currency, amountMinor, rate, rateDate: '2026-09-25', rateSource: 'manual' })

/*
 * A mano (tasa = CAD por 1 unidad):
 *   ¥1 200 × 0,0092 = 11,04 $     ₩15 000 × 0,00098 = 14,70 $     CN¥88,30 × 0,1923 = 16,98009 → 16,98 $
 *   devolución de ¥600 × 0,0092 = 5,52 $ (resta en yenes y en CAD)   almuerzo en CAD 20,00 $
 *   Gastado = 20,00 + (11,04 − 5,52) + 14,70 + 16,98 = 57,20 $
 *   Por día hasta hoy = 57,20 / 4 = 14,30 $     Queda = 500,00 − 57,20 = 442,80 $; por día = 442,80 / 7 = 63,257… → 63,25 $
 */
function tripData(): AppData {
  let d = baseData({
    transactions: [
      tx({ id: 'ramen', date: '2026-09-25', amountMinor: 1104, categoryId: 'dining', original: original('JPY', 1200, '0.0092') }),
      tx({ id: 'ramen-back', date: '2026-09-26', kind: 'refund', amountMinor: 552, categoryId: 'dining', refundOfId: 'ramen', original: original('JPY', 600, '0.0092') }),
      tx({ id: 'bibimbap', date: '2026-09-26', amountMinor: 1470, categoryId: 'dining', original: original('KRW', 15000, '0.00098') }),
      tx({ id: 'tea', date: '2026-09-27', amountMinor: 1698, categoryId: 'dining', original: original('CNY', 8830, '0.1923') }),
      tx({ id: 'lunch', date: '2026-09-27', amountMinor: 2000, categoryId: 'dining' }),
      tx({ id: 'train', date: '2026-10-01', status: 'planned', amountMinor: 5000, categoryId: 'transport', realizedAt: undefined }),
    ],
  })
  d = ok(savePeriodBudget(d, draft, ctx)).data
  for (const id of ['ramen', 'bibimbap', 'tea', 'lunch', 'train']) d = ok(setPeriodTransaction(d, 'asia', id, true, ctx)).data
  return d
}

describe('viaje: lo que se guarda', () => {
  it('se guarda con el periodo, se conserva al editar el periodo y se quita con null', () => {
    const d = tripData()
    expect(d.periodBudgets[0]!.trip).toEqual(settings)
    const { trip: _t, ...noTrip } = draft
    const renamed = ok(savePeriodBudget(d, { ...noTrip, name: 'Asia 2026' }, ctx))
    expect(renamed.value.trip).toEqual(settings)
    expect(ok(savePeriodBudget(d, { ...draft, trip: null }, ctx)).value).not.toHaveProperty('trip')
    // Un periodo que no es «Viaje» nunca lleva modo viaje.
    expect(ok(savePeriodBudget(d, { ...draft, template: 'custom' }, ctx)).value).not.toHaveProperty('trip')
  })

  it('valida monedas, moneda local, tasas y comisión', () => {
    const d = tripData()
    const budget = d.periodBudgets[0]!
    const paths = (trip: Partial<TripSettings>, template: PeriodBudgetDraft['template'] = 'trip') =>
      validatePeriodBudget({ ...budget, template, trip: { ...settings, ...trip } }, { data: d }).map((i) => i.path)
    expect(paths({})).toEqual([])
    expect(paths({}, 'semester')).toEqual(['trip'])
    expect(paths({ currencies: [] })).toContain('trip.currencies')
    expect(paths({ currencies: ['JPY', 'CAD'], rates: [] })).toContain('trip.currencies')
    expect(paths({ currencies: ['JPY', 'JPY'], rates: [] })).toContain('trip.currencies')
    expect(paths({ currencies: ['JPY', 'XXX'], rates: [] })).toContain('trip.currencies')
    expect(paths({ localCurrency: 'USD' })).toContain('trip.localCurrency')
    expect(paths({ rates: [{ currency: 'USD', rate: '1.39', date: '2026-09-25' }] })).toContain('trip.rates[0].currency')
    expect(paths({ rates: [{ currency: 'JPY', rate: '0,0092', date: '2026-09-25' }] })).toContain('trip.rates[0].rate')
    expect(paths({ rates: [{ currency: 'JPY', rate: '0.0092', date: '2026-09-31' }] })).toContain('trip.rates[0].date')
    expect(paths({ rates: [settings.rates[0]!, settings.rates[0]!] })).toContain('trip.rates[1].currency')
    expect(paths({ feeBps: 10_001 })).toContain('trip.feeBps')
    expect(paths({ feeBps: 2.5 })).toContain('trip.feeBps')
  })

  it('una copia lo restaura igual y no acepta claves desconocidas como si fueran datos', () => {
    const d = tripData()
    const restored = validateAppData(JSON.parse(JSON.stringify(d)))
    expect(restored.ok && restored.data.periodBudgets[0]!.trip).toEqual(settings)
    const extra = JSON.parse(JSON.stringify(d))
    extra.periodBudgets[0].trip.extra = 'x'
    extra.periodBudgets[0].trip.rates[0].extra = 'y'
    const cleaned = validateAppData(extra)
    expect(cleaned.ok && cleaned.data.periodBudgets[0]!.trip).toEqual(settings)
    const bad = JSON.parse(JSON.stringify(d))
    bad.periodBudgets[0].trip.rates[0].rate = 0.0092
    expect(validateAppData(bad).ok).toBe(false)
  })
})

describe('viaje en curso, moneda local y «¥»', () => {
  it('manda el viaje en curso que empezó más tarde; los archivados, los que no son viaje y los que no tienen monedas no cuentan', () => {
    let d = tripData()
    expect(activeTrip(d, '2026-09-24')).toBeUndefined()
    expect(activeTrip(d, '2026-09-25')?.id).toBe('asia')
    expect(activeTrip(d, '2026-10-04')?.id).toBe('asia')
    expect(activeTrip(d, '2026-10-05')).toBeUndefined()
    d = ok(savePeriodBudget(d, { ...draft, id: 'seoul', name: 'Seúl', startDate: '2026-09-27', endDate: '2026-09-30' }, ctx)).data
    d = ok(savePeriodBudget(d, { ...draft, id: 'plain', name: 'Sin modo viaje', startDate: '2026-09-28', endDate: '2026-09-30', trip: null }, ctx)).data
    d = ok(savePeriodBudget(d, { ...draft, id: 'sem', name: 'Semestre', template: 'semester', startDate: '2026-09-28', endDate: '2026-12-20', trip: undefined }, ctx)).data
    expect(activeTrip(d, '2026-09-26')?.id).toBe('asia')
    expect(activeTrip(d, '2026-09-28')?.id).toBe('seoul')
    d = { ...d, periodBudgets: d.periodBudgets.map((b) => (b.id === 'seoul' ? { ...b, archived: true } : b)) }
    expect(activeTrip(d, '2026-09-28')?.id).toBe('asia')
  })

  it('«¥» solo se resuelve con la moneda local actual, y solo si es yen o yuan', () => {
    const yen = ['JPY', 'CNY'] as const
    expect(resolveAmbiguous(settings, yen)).toBe('JPY')
    expect(resolveAmbiguous({ ...settings, localCurrency: 'CNY' }, yen)).toBe('CNY')
    expect(resolveAmbiguous({ ...settings, localCurrency: 'KRW' }, yen)).toBeUndefined()
    const { localCurrency: _l, ...none } = settings
    expect(resolveAmbiguous(none, yen)).toBeUndefined()
    expect(resolveAmbiguous(undefined, yen)).toBeUndefined()
  })

  it('cambiar la moneda local o la tasa solo cambia el viaje: lo ya registrado conserva su tasa y su importe', () => {
    let d = tripData()
    d = ok(setTripLocalCurrency(d, 'asia', 'CNY', ctx)).data
    expect(d.periodBudgets[0]!.trip!.localCurrency).toBe('CNY')
    expect(ok(setTripLocalCurrency(d, 'asia', null, ctx)).value.trip).not.toHaveProperty('localCurrency')
    expect(setTripLocalCurrency(d, 'asia', 'USD', ctx).ok).toBe(false)
    // La tasa del yen sube a 0,0095 el 28-sep; el ramen del 25 sigue a 0,0092 = 11,04 $.
    d = ok(setTripRate(d, 'asia', 'JPY', '0.00950', '2026-09-28', ctx)).data
    expect(tripRate(d.periodBudgets[0]!.trip, 'JPY')).toEqual({ currency: 'JPY', rate: '0.0095', date: '2026-09-28' })
    expect(d.transactions.find((t) => t.id === 'ramen')).toMatchObject({ amountMinor: 1104, original: { rate: '0.0092' } })
    expect(setTripRate(d, 'asia', 'JPY', '0,0095', '2026-09-28', ctx).ok).toBe(false)
    expect(setTripRate(d, 'asia', 'USD', '1.39', '2026-09-28', ctx).ok).toBe(false)
    expect(tripRate(ok(setTripRate(d, 'asia', 'KRW', null, '2026-09-28', ctx)).value.trip, 'KRW')).toBeUndefined()
    expect(setTripRate(d, 'nope', 'JPY', '1', '2026-09-28', ctx).ok).toBe(false)
  })

  it('el formulario propone asociar al viaje lo que se pagó en una de sus monedas dentro de las fechas', () => {
    const d = tripData()
    const base = { kind: 'expense' as const, date: '2026-09-28', categoryId: 'shopping' }
    expect(periodsProposedFor(d, { ...base, original: original('KRW', 5000, '0.00098') })).toEqual(['asia'])
    expect(periodsProposedFor(d, base)).toEqual([])
    expect(periodsProposedFor(d, { ...base, original: original('USD', 500, '1.39') })).toEqual([])
    expect(periodsProposedFor(d, { ...base, date: '2026-10-05', original: original('KRW', 5000, '0.00098') })).toEqual([])
  })
})

describe('vista del viaje', () => {
  it('gastado por moneda, total en CAD, por día y lo que queda (cifras a mano)', () => {
    const s = tripSummary(tripData(), tripData().periodBudgets[0]!, '2026-09-28')
    expect(s.byCurrency).toEqual([
      { currency: 'CAD', count: 1, originalMinor: 2000, convertedMinor: 2000 },
      { currency: 'JPY', count: 2, originalMinor: 600, convertedMinor: 552 },
      { currency: 'KRW', count: 1, originalMinor: 15000, convertedMinor: 1470 },
      { currency: 'CNY', count: 1, originalMinor: 8830, convertedMinor: 1698 },
    ])
    expect(s.period.spentMinor).toBe(5720)
    // Lo previsto (el tren) no es gasto todavía.
    expect(s.period.plannedMinor).toBe(5000)
    expect(s.daysElapsed).toBe(4)
    expect(s.spentPerDayMinor).toBe(1430)
    expect(s.period.remainingMinor).toBe(44280)
    expect(s.period.daysLeft).toBe(7)
    expect(s.period.perDayMinor).toBe(6325)
    expect(s.unconvertedProposals).toBe(0)
  })

  it('las tres monedas del encargo juntas: ¥ + ₩ + CN¥ = 42,72 $', () => {
    let d = tripData()
    d = ok(setPeriodTransaction(d, 'asia', 'lunch', false, ctx)).data
    d = { ...d, transactions: d.transactions.filter((t) => t.id !== 'ramen-back') }
    expect(tripSummary(d, d.periodBudgets[0]!, '2026-09-28').period.spentMinor).toBe(4272)
  })

  it('antes de empezar no hay gasto por día; al terminar se divide entre todos los días', () => {
    const d = tripData()
    const budget = d.periodBudgets[0]!
    expect(tripSummary(d, budget, '2026-09-20').spentPerDayMinor).toBeNull()
    // 57,20 / 10 = 5,72 $
    expect(tripSummary(d, budget, '2026-10-20')).toMatchObject({ daysElapsed: 10, spentPerDayMinor: 572 })
  })

  it('lo que está en la papelera no cuenta y lo que espera tasa se dice aparte, sin sumarlo', () => {
    let d = tripData()
    d = { ...d, transactions: d.transactions.filter((t) => t.id !== 'tea'), trash: [{ id: 'tea', transaction: d.transactions.find((t) => t.id === 'tea')!, deletedAt: EARLIER, unlinkedRefundIds: [] }] }
    const proposal: CaptureProposal = {
      captureId: 'cap-krw00001',
      capturedAt: '2026-09-27T03:00:00Z',
      origin: 'apple_pay',
      reason: 'currency',
      amount: { kind: 'foreign', currency: 'KRW', minor: 9000 },
      accountId: 'main',
      date: '2026-09-26',
      receivedAt: '2026-09-27T03:01:00.000Z',
    }
    d = { ...d, captures: { processed: [{ id: proposal.captureId, at: EARLIER }], proposals: [proposal, { ...proposal, captureId: 'cap-test0001', test: true }] } }
    const s = tripSummary(d, d.periodBudgets[0]!, '2026-09-28')
    expect(s.byCurrency.map((l) => l.currency)).toEqual(['CAD', 'JPY', 'KRW'])
    expect(s.period.spentMinor).toBe(5720 - 1698)
    expect(s.period.trashedCount).toBe(1)
    expect(s.unconvertedProposals).toBe(1)
  })

  it('una suma de importes originales que no cabe en un entero exacto no se redondea: no hay cifra', () => {
    let d = tripData()
    const huge = 2 ** 52
    d = {
      ...d,
      transactions: [
        ...d.transactions,
        tx({ id: 'big-1', date: '2026-09-27', amountMinor: 100, categoryId: 'shopping', original: original('KRW', huge, '0.00098') }),
        tx({ id: 'big-2', date: '2026-09-27', amountMinor: 100, categoryId: 'shopping', original: original('KRW', huge, '0.00098') }),
      ],
    }
    d = ok(setPeriodTransaction(d, 'asia', 'big-1', true, ctx)).data
    d = ok(setPeriodTransaction(d, 'asia', 'big-2', true, ctx)).data
    const krw = tripSummary(d, d.periodBudgets[0]!, '2026-09-28').byCurrency.find((l) => l.currency === 'KRW')!
    expect(krw).toMatchObject({ count: 3, originalMinor: null, convertedMinor: 1670 })
  })
})
