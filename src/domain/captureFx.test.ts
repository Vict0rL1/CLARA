import { describe, expect, it } from 'vitest'
import { baseData, ctx, deepFreeze, EARLIER } from '../test/fixtures'
import { importCaptures, registerProposal } from './captureImport'
import type { CaptureRecord } from './captureQueue'
import { savePeriodBudget } from './periodBudgets'
import { setTripLocalCurrency, setTripRate, tripSummary } from './trips'
import type { AppData, CaptureProposal } from './types'

/*
 * Fase 3: capturas en otra moneda durante un viaje. Viaje «Asia» del 25-sep al 4-oct con yen y won a mano (0,0092 y
 * 0,00098, escritas el 25-sep), sin tasa para el yuan, moneda local yen y comisión de la tarjeta 2,5 %. Hoy 28-sep.
 *
 * A mano (un solo redondeo, mitades hacia arriba):
 *   ¥1 200 × 0,0092 × 1,025 = 11,316 → 11,32 $      ₩15 000 × 0,00098 × 1,025 = 15,0675 → 15,07 $
 *   ¥1 500 × 0,0092 × 1,025 = 14,145 → 14,15 $      ¥1 200 × 0,0095 × 1,025 = 11,685 → 11,69 $
 *   CN¥88,30 × 0,1923 × 1,025 = 17,40459… → 17,40 $
 */
function tripData(overrides: Partial<AppData> = {}): AppData {
  const r = savePeriodBudget(
    baseData(overrides),
    {
      id: 'asia',
      name: 'Asia',
      template: 'trip',
      startDate: '2026-09-25',
      endDate: '2026-10-04',
      allocatedMinor: 50000,
      trip: {
        currencies: ['JPY', 'KRW', 'CNY'],
        localCurrency: 'JPY',
        rates: [
          { currency: 'JPY', rate: '0.0092', date: '2026-09-25' },
          { currency: 'KRW', rate: '0.00098', date: '2026-09-25' },
        ],
        feeBps: 250,
      },
    },
    ctx,
  )
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.data
}

let n = 0
function record(rawAmount: string, currencyHint: string | undefined, overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  n += 1
  return { captureId: `cap-fx${String(n).padStart(6, '0')}`, createdAt: '2026-09-28T15:00:00Z', origin: 'apple_pay', rawAmount, ...(currencyHint ? { currencyHint } : {}), merchant: `Tienda ${n}`, ...overrides }
}

function imported(data: AppData, records: CaptureRecord[]) {
  const r = importCaptures(deepFreeze(data), records, ctx)
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r
}

describe('capturas en otra moneda durante un viaje', () => {
  it('con tasa del viaje: gasto real «Por revisar», convertido con ESA tasa y la comisión, y asociado al viaje', () => {
    const yen = record('1200', 'JPY')
    const won = record('15000', 'KRW')
    const r = imported(tripData(), [yen, won])
    expect(r.value.saved).toEqual([yen.captureId, won.captureId])
    const [a, b] = r.data.transactions
    expect(a).toMatchObject({
      amountMinor: 1132,
      currency: 'CAD',
      original: { currency: 'JPY', amountMinor: 1200, rate: '0.0092', rateDate: '2026-09-25', rateSource: 'manual', feeBps: 250 },
      review: { needed: true, reason: 'currency' },
    })
    expect(b).toMatchObject({ amountMinor: 1507, original: { currency: 'KRW', amountMinor: 15000, rate: '0.00098' } })
    expect(r.data.periodBudgets[0]!.txIds).toEqual([yen.captureId, won.captureId])
    const s = tripSummary(r.data, r.data.periodBudgets[0]!, '2026-09-28')
    expect(s.period.spentMinor).toBe(1132 + 1507)
    expect(s.byCurrency.map((l) => [l.currency, l.originalMinor, l.convertedMinor])).toEqual([
      ['JPY', 1200, 1132],
      ['KRW', 15000, 1507],
    ])
  })

  it('sin tasa para esa moneda, fuera del viaje o en una moneda que no es del viaje: propuesta, nunca una tasa inventada', () => {
    const yuan = record('88.30', 'CNY')
    const dollars = record('10.00', 'USD')
    const before = record('1200', 'JPY', { createdAt: '2026-09-24T15:00:00Z' })
    const r = imported(tripData(), [yuan, dollars, before])
    expect(r.value.saved).toEqual([])
    expect(r.data.transactions).toEqual([])
    expect(r.data.captures!.proposals.map((p) => [p.reason, p.amount])).toEqual([
      ['currency', { kind: 'foreign', currency: 'CNY', minor: 8830 }],
      ['currency', { kind: 'foreign', currency: 'USD', minor: 1000 }],
      ['currency', { kind: 'foreign', currency: 'JPY', minor: 1200 }],
    ])
    expect(tripSummary(r.data, r.data.periodBudgets[0]!, '2026-09-28')).toMatchObject({ unconvertedProposals: 2 })
  })

  it('un «¥» suelto: lo resuelve la moneda local del viaje (yen sin decimales, yuan con ellos); si no, queda sin resolver', () => {
    const yen = record('¥1,500', undefined)
    const r = imported(tripData(), [yen])
    expect(r.data.transactions[0]).toMatchObject({ amountMinor: 1415, original: { currency: 'JPY', amountMinor: 1500 } })

    const inChina = setTripLocalCurrency(tripData(), 'asia', 'CNY', ctx)
    if (!inChina.ok) throw new Error('local')
    const yuan = record('¥88.30', undefined)
    const p = imported(inChina.data, [yuan]).data.captures!.proposals[0]!
    // Yuan, pero sin tasa escrita: propuesta, ya leída como yuan.
    expect(p).toMatchObject({ reason: 'currency', amount: { kind: 'foreign', currency: 'CNY', minor: 8830 } })

    const inKorea = setTripLocalCurrency(tripData(), 'asia', 'KRW', ctx)
    if (!inKorea.ok) throw new Error('local')
    const unknown = imported(inKorea.data, [record('¥1,500', undefined)]).data.captures!.proposals[0]!
    expect(unknown.amount).toEqual({ kind: 'ambiguous', candidates: ['JPY', 'CNY'], text: '¥1,500' })
  })

  it('cambiar la tasa del viaje solo cambia lo que llega después', () => {
    const first = imported(tripData(), [record('1200', 'JPY')]).data
    const raised = setTripRate(first, 'asia', 'JPY', '0.0095', '2026-09-28', ctx)
    if (!raised.ok) throw new Error('rate')
    const after = imported(raised.data, [record('1200', 'JPY', { createdAt: '2026-09-28T15:30:00Z' })]).data
    expect(after.transactions.map((t) => [t.amountMinor, t.original?.rate, t.original?.rateDate])).toEqual([
      [1132, '0.0092', '2026-09-25'],
      [1169, '0.0095', '2026-09-28'],
    ])
  })

  it('«Guardar automáticamente» apagado, un posible duplicado o la prueba de Ajustes: propuestas como siempre', () => {
    const off = tripData()
    const offData = { ...off, settings: { ...off.settings, capture: { autoSave: false, cardAccounts: [] } } }
    expect(imported(offData, [record('1200', 'JPY')]).data.captures!.proposals[0]!.reason).toBe('auto_capture')
    // El mismo pago dos veces en un minuto: el segundo se parece al primero (11,32 $ los dos).
    const twice = imported(tripData(), [record('1200', 'JPY', { merchant: 'Lawson' }), record('1200', 'JPY', { merchant: 'Lawson', createdAt: '2026-09-28T15:01:00Z' })])
    expect(twice.value.saved).toHaveLength(1)
    expect(twice.data.captures!.proposals[0]).toMatchObject({ reason: 'duplicate', similarTxId: twice.value.saved[0] })
    const test = imported(tripData(), [record('1200', 'JPY', { test: true })])
    expect(test.data.transactions).toEqual([])
    expect(test.data.captures!.proposals[0]).toMatchObject({ test: true, reason: 'auto_capture' })
  })
})

describe('registrar una propuesta en otra moneda', () => {
  const proposal = (overrides: Partial<CaptureProposal>): CaptureProposal => ({
    captureId: 'cap-prop0001',
    capturedAt: '2026-09-28T15:00:00Z',
    origin: 'apple_pay',
    reason: 'currency',
    amount: { kind: 'foreign', currency: 'CNY', minor: 8830 },
    merchant: 'Tea house',
    accountId: 'main',
    date: '2026-09-28',
    categoryId: 'dining',
    receivedAt: EARLIER,
    ...overrides,
  })
  const withProposal = (p: CaptureProposal, d = tripData()): AppData => ({ ...d, captures: { processed: [{ id: p.captureId, at: EARLIER }], proposals: [p] } })

  it('con una tasa escrita: convierte, guarda el original y, si es moneda del viaje, lo asocia', () => {
    const r = registerProposal(withProposal(proposal({})), 'cap-prop0001', ctx, { rate: '0.19230', rateDate: '2026-09-28', feeBps: 250 })
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.value).toMatchObject({ amountMinor: 1740, original: { currency: 'CNY', amountMinor: 8830, rate: '0.1923', rateDate: '2026-09-28', rateSource: 'manual', feeBps: 250 } })
    expect(r.value).not.toHaveProperty('review')
    expect(r.data.periodBudgets[0]!.txIds).toEqual(['cap-prop0001'])
    expect(registerProposal(withProposal(proposal({})), 'cap-prop0001', ctx, { rate: '0,1923', rateDate: '2026-09-28' })).toMatchObject({ ok: false, issues: [{ path: 'rate' }] })
  })

  it('con lo que cobró el banco: ese importe manda y la tasa es la fracción exacta (cargo real)', () => {
    const usd = proposal({ amount: { kind: 'foreign', currency: 'USD', minor: 1000 } })
    const r = registerProposal(withProposal(usd), 'cap-prop0001', ctx, 1371)
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.value).toMatchObject({ amountMinor: 1371, original: { currency: 'USD', amountMinor: 1000, rate: '1.371', rateSource: 'card_actual', rateDate: '2026-09-28' } })
    // El dólar no es moneda del viaje: no se asocia.
    expect(r.data.periodBudgets[0]!.txIds).toEqual([])
  })

  it('un «¥» sin resolver o un importe sin entender: solo con el importe escrito y sin original', () => {
    const yenOrYuan = proposal({ amount: { kind: 'ambiguous', candidates: ['JPY', 'CNY'], text: '¥88.30' } })
    const inKorea = setTripLocalCurrency(tripData(), 'asia', 'KRW', ctx)
    if (!inKorea.ok) throw new Error('local')
    const d = withProposal(yenOrYuan, inKorea.data)
    expect(registerProposal(d, 'cap-prop0001', ctx, { rate: '0.1923', rateDate: '2026-09-28' })).toMatchObject({ ok: false, issues: [{ path: 'rate' }] })
    const r = registerProposal(d, 'cap-prop0001', ctx, 1700)
    expect(r.ok && r.value).toMatchObject({ amountMinor: 1700 })
    expect(r.ok && r.value).not.toHaveProperty('original')
    // Con la moneda local en yen, «¥88.30» no es un importe en yenes (no tienen decimales): no se registra con tasa.
    expect(registerProposal(withProposal(yenOrYuan), 'cap-prop0001', ctx, { rate: '0.0092', rateDate: '2026-09-28' })).toMatchObject({ ok: false, issues: [{ path: 'rate' }] })
    // Con la moneda local en yuan, sí se lee como yuan: 88,30 × 0,1923 = 16,98 $.
    const inChina = setTripLocalCurrency(tripData(), 'asia', 'CNY', ctx)
    if (!inChina.ok) throw new Error('local')
    const r2 = registerProposal(withProposal(yenOrYuan, inChina.data), 'cap-prop0001', ctx, { rate: '0.1923', rateDate: '2026-09-28' })
    expect(r2.ok && r2.value).toMatchObject({ amountMinor: 1698, original: { currency: 'CNY', amountMinor: 8830 } })
  })
})
