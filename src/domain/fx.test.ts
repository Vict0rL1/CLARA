import { describe, expect, it } from 'vitest'
import { baseData, ctx, tx } from '../test/fixtures'
import { convertToBudget, parseRate, rateFromAmounts, rateToText } from './fx'
import { saveTransaction, trashTransactions, restoreFromTrash } from './operations'
import { validateTransaction } from './validation'
import type { OriginalAmount } from './types'

/*
 * Cifras calculadas a mano. Tasa = CAD por 1 unidad de la otra moneda. JPY y KRW no tienen decimales; CAD, USD y CNY
 * tienen dos. Un solo redondeo, al céntimo más cercano, mitades hacia arriba.
 */
describe('tasas: texto exacto, nunca flotantes', () => {
  it('lee decimales y fracciones, y las reduce', () => {
    expect(parseRate('0.0092')).toEqual({ num: 23n, den: 2500n })
    expect(parseRate('1.3950')).toEqual({ num: 279n, den: 200n })
    expect(parseRate('1371/1250')).toEqual({ num: 1371n, den: 1250n })
    expect(parseRate(' 2 ')).toEqual({ num: 2n, den: 1n })
  })

  it('rechaza lo que no es un número positivo exacto', () => {
    for (const bad of ['', '0', '0.000', '-1', '1,25', '1e3', 'abc', '1/0', '0/5', '1.', '.5', '1 / 2', '2000000', '1'.repeat(41)]) expect(parseRate(bad), bad).toBeNull()
  })

  it('el texto canónico es decimal si es exacto y fracción si no', () => {
    expect(rateToText({ num: 1371n, den: 1250n })).toBe('1.0968')
    expect(rateToText({ num: 23n, den: 2500n })).toBe('0.0092')
    expect(rateToText({ num: 1n, den: 3n })).toBe('1/3')
    expect(rateToText({ num: 7n, den: 1n })).toBe('7')
  })
})

describe('convertToBudget', () => {
  it('yen, won, yuan y dólar a CAD', () => {
    // ¥1 200 × 0,0092 = 11,04 $
    expect(convertToBudget(1200, 'JPY', 'CAD', '0.0092')).toBe(1104)
    // ₩15 000 × 0,00098 = 14,70 $
    expect(convertToBudget(15000, 'KRW', 'CAD', '0.00098')).toBe(1470)
    // ¥88,30 (yuan) × 0,1923 = 16,98009 → 16,98 $
    expect(convertToBudget(8830, 'CNY', 'CAD', '0.1923')).toBe(1698)
    // 10,00 US$ × 1,3950 = 13,95 $
    expect(convertToBudget(1000, 'USD', 'CAD', '1.3950')).toBe(1395)
    // Las tres del encargo juntas: 11,04 + 14,70 + 16,98 = 42,72 $
    expect([convertToBudget(1200, 'JPY', 'CAD', '0.0092'), convertToBudget(15000, 'KRW', 'CAD', '0.00098'), convertToBudget(8830, 'CNY', 'CAD', '0.1923')].reduce((a, b) => a! + b!, 0)).toBe(4272)
  })

  it('un solo redondeo, al céntimo más cercano: las mitades suben, lo de menos baja', () => {
    // 0,02 US$ × 1,25 = 0,025 $ → 2,5 céntimos → 3
    expect(convertToBudget(2, 'USD', 'CAD', '1.25')).toBe(3)
    // 0,01 US$ × 1,25 = 0,0125 $ → 1,25 céntimos → 1
    expect(convertToBudget(1, 'USD', 'CAD', '1.25')).toBe(1)
    // 0,01 US$ × 1,35 = 1,35 céntimos → 1; × 1,36 → 1,36 → 1; × 1,5 → 1,5 → 2
    expect(convertToBudget(1, 'USD', 'CAD', '1.5')).toBe(2)
  })

  it('la comisión de la tarjeta va dentro del mismo redondeo', () => {
    // 11,04 $ × 1,025 = 11,316 → 11,32 $ (redondear antes daría lo mismo aquí; el caso siguiente no)
    expect(convertToBudget(1200, 'JPY', 'CAD', '0.0092', 250)).toBe(1132)
    // ¥135 × 0,0092 = 1,242 $; × 1,025 = 1,27305 → 1,27 $. Redondeando dos veces: 1,24 × 1,025 = 1,271 → 1,27 (igual);
    // ¥145: 1,334 → ×1,025 = 1,36735 → 1,37 $; dos redondeos: 1,33 × 1,025 = 1,36325 → 1,36 $ (distinto).
    expect(convertToBudget(145, 'JPY', 'CAD', '0.0092', 250)).toBe(137)
  })

  it('sin tasa, con importe 0, con una tasa que da menos de medio céntimo o con monedas desconocidas: no hay cifra', () => {
    expect(convertToBudget(1200, 'JPY', 'CAD', '')).toBeNull()
    expect(convertToBudget(0, 'JPY', 'CAD', '0.0092')).toBeNull()
    // ₩1 × 0,00098 = 0,098 céntimos → 0: no es un importe
    expect(convertToBudget(1, 'KRW', 'CAD', '0.00098')).toBeNull()
    expect(convertToBudget(100, 'XXX', 'CAD', '1')).toBeNull()
    expect(convertToBudget(100, 'USD', 'CAD', '1', -1)).toBeNull()
  })

  it('«ajustar al cargo real»: la tasa exacta entre los dos importes vuelve a dar el cargo justo', () => {
    // 10,00 US$ cobrados como 13,71 $ → 1,371
    expect(rateFromAmounts(1371, 'CAD', 1000, 'USD')).toBe('1.371')
    // ¥1 200 cobrados como 11,17 $ → 1117/120000 (no es un decimal exacto)
    const r = rateFromAmounts(1117, 'CAD', 1200, 'JPY')!
    expect(r).toBe('1117/120000')
    expect(convertToBudget(1200, 'JPY', 'CAD', r)).toBe(1117)
  })
})

describe('un movimiento con su importe original', () => {
  const original = (o: Partial<OriginalAmount> = {}): OriginalAmount => ({ currency: 'JPY', amountMinor: 1200, rate: '0.0092', rateDate: '2026-09-28', rateSource: 'manual', ...o })

  it('se valida que la cifra en CAD sea exactamente la conversión', () => {
    const data = baseData()
    expect(validateTransaction(tx({ amountMinor: 1104, original: original() }), { data })).toEqual([])
    expect(validateTransaction(tx({ amountMinor: 1105, original: original() }), { data }).map((i) => i.path)).toEqual(['original.rate'])
    expect(validateTransaction(tx({ amountMinor: 1132, original: original({ feeBps: 250 }) }), { data })).toEqual([])
  })

  it('rechaza la moneda del presupuesto, tasas malas, transferencias y comisiones fuera de rango', () => {
    const data = baseData()
    const paths = (o: Partial<OriginalAmount>, extra = {}) => validateTransaction(tx({ amountMinor: 1104, original: original(o), ...extra }), { data }).map((i) => i.path)
    expect(paths({ currency: 'CAD' })).toContain('original.currency')
    expect(paths({ rate: '0,0092' })).toContain('original.rate')
    expect(paths({ rateSource: 'guess' as never })).toContain('original.rateSource')
    expect(paths({ rateDate: '2026-02-30' })).toContain('original.rateDate')
    expect(paths({ feeBps: 10_001 })).toContain('original.feeBps')
    expect(paths({}, { kind: 'transfer', toAccountId: 'other', categoryId: undefined })).toContain('original')
  })

  it('guardar lo conserva al editar otra cosa, lo quita con null y viaja con el movimiento a la papelera', () => {
    const data = baseData()
    const draft = { id: 'yen-1', kind: 'expense' as const, status: 'realized' as const, amountMinor: 1104, date: '2026-09-28', accountId: 'main', categoryId: 'dining', original: original() }
    const saved = saveTransaction(data, draft, ctx)
    if (!saved.ok) throw new Error(JSON.stringify(saved.issues))
    expect(saved.value.original).toEqual(original())
    const { original: _o, ...noOriginal } = draft
    const recat = saveTransaction(saved.data, { ...noOriginal, categoryId: 'groceries' }, ctx)
    expect(recat.ok && recat.value.original).toEqual(original())
    const removed = saveTransaction(saved.data, { ...draft, original: null }, ctx)
    expect(removed.ok && removed.value).not.toHaveProperty('original')
    // Cambiar el importe en CAD sin cambiar la tasa no cuadra: no se guarda.
    expect(saveTransaction(saved.data, { ...noOriginal, amountMinor: 1200 }, ctx).ok).toBe(false)
    const trashed = trashTransactions(saved.data, ['yen-1'], ctx)
    if (!trashed.ok) throw new Error('trash')
    expect(trashed.data.trash[0]!.transaction.original).toEqual(original())
    const back = restoreFromTrash(trashed.data, 'yen-1', ctx)
    expect(back.ok && back.data.transactions[0]!.original).toEqual(original())
  })

  it('una devolución en otra moneda también lleva su conversión', () => {
    const data = baseData({ transactions: [tx({ id: 'yen-1', amountMinor: 1104, original: original() })] })
    const r = saveTransaction(
      data,
      { id: 'ref-1', kind: 'refund', status: 'realized', amountMinor: 552, date: '2026-09-28', accountId: 'main', categoryId: 'groceries', refundOfId: 'yen-1', original: original({ amountMinor: 600 }) },
      ctx,
    )
    // ¥600 × 0,0092 = 5,52 $
    expect(r.ok && r.value.amountMinor).toBe(552)
  })
})
