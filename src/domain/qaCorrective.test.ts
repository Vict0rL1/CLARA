/**
 * Auditoría independiente 2026-10-19 (`43b4d74` frente a `54f9b69`), pasada correctiva: contratos de P1 (moneda no
 * admitida separada del importe por puntuación) y P2 (un artículo «PEN» con su impuesto en la misma línea no es una
 * moneda). Datos sintéticos. Los dos fallaban sobre `1e23b8e` (ver `docs/qa/corrective-pass-2026-10-20/`).
 */
import { describe, expect, it } from 'vitest'
import { parseMoney, stripCurrencyMark, withCurrencyMark, withCurrencyMarks } from './money'
import { parseText, type ParseContext, type ParsedEntry } from './parser'
import { parseReceiptText } from './receipt'
import { parseShortcutAmount } from './shortcutLink'
import type { Language } from './types'

const ctx = (language: Language = 'en', currency = 'CAD'): ParseContext => ({
  today: '2026-09-28',
  currency,
  language,
  categories: [{ id: 'dining', kind: 'expense' }, { id: 'other_expense', kind: 'expense' }, { id: 'salary', kind: 'income' }],
})
const one = (text: string, language: Language = 'en', currency = 'CAD') => parseText(text, ctx(language, currency))[0]!
const receipt = (text: string, language: Language = 'en', currency = 'CAD') => parseReceiptText(text, ctx(language, currency))
/** Lo que el asistente escribe en «Importe» y cómo lo vuelve a leer el campo (nunca la moneda del presupuesto). */
function field(entry: ParsedEntry, currency = 'CAD') {
  const amount = entry.amountMinor === null ? '' : (entry.amountMinor / 100).toFixed(2)
  const text = entry.currencyConflict ? withCurrencyMarks(amount, entry.currencyConflict) : entry.foreignCurrency ? withCurrencyMark(amount, entry.foreignCurrency) : amount
  return { text, parsed: parseMoney(text, currency, 'en-CA') }
}
const marks = (e: ParsedEntry) => [e.amountMinor, e.foreignCurrency ?? null, e.currencyConflict ?? null] as const
const written = (r: ReturnType<typeof receipt>) => [r.totalMinor, r.foreignCurrency ?? null, r.currencyConflict ?? null] as const

describe('P1 · una moneda no admitida separada del importe por puntuación se conserva y bloquea la línea', () => {
  it('asistente: «coffee (RUB) 10» y «coffee RUB: 10» son 10 RUB; el campo lo escribe y lo vuelve a leer como RUB', () => {
    for (const text of ['coffee (RUB) 10', 'coffee RUB: 10', 'coffee [RUB] 10', 'coffee RUB = 10', 'coffee 10, RUB', 'coffee 10 (RUB)']) {
      const e = one(text)
      expect(marks(e), text).toEqual([1000, 'RUB', null])
      const f = field(e)
      expect(f.text, text).toBe('10.00 RUB')
      expect(f.parsed, text).toMatchObject({ ok: false, error: 'unknownCurrency', found: 'RUB' })
    }
  })

  it('«coffee (RUB) $10»: el código y el símbolo se contradicen (el rublo no es «$»): conflicto, nunca 10 CAD', () => {
    const e = one('coffee (RUB) $10')
    expect(marks(e)).toEqual([1000, null, ['RUB', '$']])
    expect(field(e).parsed).toMatchObject({ ok: false, error: 'currencyConflict' })
  })

  it('recibo sintético: «TOTAL RUB: 10.00» y «TOTAL (RUB) 10.00» conservan RUB como el directo «TOTAL RUB 10.00»', () => {
    for (const line of ['TOTAL RUB: 10.00', 'TOTAL (RUB) 10.00', 'TOTAL: RUB 10.00', 'TOTAL RUB 10.00', 'TOTAL 10.00 (RUB)', 'MONTANT RUB: 10.00', 'IMPORTE (RUB) 10,00']) {
      expect(written(receipt(`SHOP\n${line}`)), line).toEqual([1000, 'RUB', null])
    }
  })

  it('un código admitido con la misma sintaxis sigue igual; la moneda del presupuesto con puntuación no bloquea', () => {
    expect(marks(one('coffee (USD) 10'))).toEqual([1000, 'USD', null])
    expect(marks(one('coffee USD: 10'))).toEqual([1000, 'USD', null])
    expect(marks(one('coffee (CAD) 10'))).toEqual([1000, null, null])
    expect(marks(one('coffee CAD: 10'))).toEqual([1000, null, null])
    expect(written(receipt('SHOP\nTOTAL USD: 10.00'))).toEqual([1000, 'USD', null])
    expect(written(receipt('SHOP\nTOTAL (CAD) 10.00'))).toEqual([1000, null, null])
  })

  it('acotado: un ISO no admitido lejos del importe o con otra palabra entre medias no es una moneda', () => {
    for (const text of ['AMD GPU 500', 'coffee (RUB) large 10', '(RUB) coffee 10', 'RUB rate 10', 'GST 10', 'IVA 10']) {
      expect(marks(one(text)), text).toEqual([text === 'AMD GPU 500' ? 50000 : 1000, null, null])
    }
    // En un recibo, en una línea de artículo ni la puntuación lo convierte en moneda.
    expect(written(receipt('SHOP\nPEN (RUB) 2.99\nTOTAL 2.99'))).toEqual([299, null, null])
  })

  it('lo de siempre no cambia: contradicciones, repeticiones compatibles, monedas admitidas e importes en palabras (es/en/pt/fr)', () => {
    expect(marks(one('coffee USD 10 CAD'))).toEqual([1000, null, ['USD', 'CAD']])
    expect(marks(one('coffee €10 CAD'))).toEqual([1000, null, ['€', 'CAD']])
    expect(marks(one('coffee CAD $10'))).toEqual([1000, null, null])
    expect(marks(one('coffee $10 CAD'))).toEqual([1000, null, null])
    expect(marks(one('coffee EUR 10'))).toEqual([1000, 'EUR', null])
    expect(marks(one('coffee 10 euros'))).toEqual([1000, 'EUR', null])
    for (const [text, language] of [['café (RUB) diez', 'es'], ['coffee RUB: ten', 'en'], ['café (RUB) dez', 'pt'], ['café RUB: dix', 'fr']] as const) {
      expect(marks(one(text, language)), text).toEqual([1000, 'RUB', null])
    }
    for (const [text, language] of [['café (EUR) diez', 'es'], ['coffee EUR: ten', 'en'], ['café (EUR) dez', 'pt'], ['café EUR: dix', 'fr']] as const) {
      expect(marks(one(text, language)), text).toEqual([1000, 'EUR', null])
    }
  })

  it('el mismo lector en el campo, la importación y los atajos: «(RUB) 10» y «RUB: 10» nunca son 10 CAD; «(10.00)» no cambia', () => {
    for (const text of ['(RUB) 10', 'RUB: 10', '10, RUB', '10 (RUB)', '[RUB] 10']) {
      expect(stripCurrencyMark(text), text).toEqual({ text: '10', mark: { unknown: 'RUB' } })
      expect(parseMoney(text, 'CAD', 'en-CA'), text).toMatchObject({ ok: false, error: 'unknownCurrency', found: 'RUB' })
    }
    expect(parseMoney('CAD: 10', 'CAD', 'en-CA')).toEqual({ ok: true, minor: 1000 })
    expect(parseMoney('(CAD) 10', 'CAD', 'en-CA')).toEqual({ ok: true, minor: 1000 })
    expect(parseMoney('RUB -10', 'CAD', 'en-CA', { allowNegative: true })).toMatchObject({ ok: false, error: 'unknownCurrency', found: 'RUB' })
    expect(stripCurrencyMark('RUB -10')).toEqual({ text: '-10', mark: { unknown: 'RUB' } })
    expect(parseShortcutAmount('(RUB) 10', 'CAD', 'en-CA')).toMatchObject({ ok: false })
    expect(parseShortcutAmount('USD: 10', 'CAD', 'en-CA')).toEqual({ ok: true, minor: 1000, foreignCurrency: 'USD' })
    expect(parseMoney('(10.00)', 'CAD', 'en-CA').ok).toBe(false)
  })
})

describe('P2 · un artículo «PEN» con su impuesto en la misma línea no es el sol peruano', () => {
  it('«SHOP / PEN 2.99 TAX 0.10 / TOTAL CAD 3.09» propone 3.09 sin conflicto', () => {
    expect(written(receipt('SHOP\nPEN 2.99 TAX 0.10\nTOTAL CAD 3.09'))).toEqual([309, null, null])
  })
  it('la variante sin el total escrito en CAD propone 3.09 sin moneda (también con «IVA» y «TPS»)', () => {
    expect(written(receipt('SHOP\nPEN 2.99 TAX 0.10\nTOTAL 3.09'))).toEqual([309, null, null])
    expect(written(receipt('TIENDA\nPEN 2.99 IVA 0.10\nTOTAL 3.09', 'es'))).toEqual([309, null, null])
    expect(written(receipt('SHOP\nPEN 2.99 TIP 0.10\nTOTAL 3.09'))).toEqual([309, null, null])
  })
  it('controles: la moneda junto al importe que etiqueta el total, el subtotal o el pago sigue contando', () => {
    expect(written(receipt('SHOP\nTOTAL PEN 10.00'))).toEqual([1000, 'PEN', null])
    expect(written(receipt('SHOP\nSUBTOTAL PEN 9.00\nIGV 1.00\nTOTAL 10.00'))).toEqual([1000, 'PEN', null])
    expect(written(receipt('SHOP\nTOTAL 10.00\nCASH USD 20.00'))).toEqual([1000, 'USD', null])
    expect(written(receipt('SHOP\nTOTAL 10.00\nVISA RUB 10.00'))).toEqual([1000, 'RUB', null])
    expect(written(receipt('SHOP\nTOTAL 10.00 PEN'))).toEqual([1000, 'PEN', null])
    expect(written(receipt('SHOP\nTAX PEN 0.10\nTOTAL 3.09'))).toEqual([309, 'PEN', null])
    // Dos monedas impresas: conflicto, nunca la del presupuesto.
    expect(written(receipt('SHOP\nTOTAL USD 10.00\nCASH PEN 37.00'))).toEqual([1000, null, ['USD', 'PEN']])
    expect(written(receipt('SHOP\nPEN 2.99 TAX 0.10\nTOTAL USD 3.09'))).toEqual([309, 'USD', null])
  })
  it('etiquetas en es/en/pt/fr, también con acento al principio de la palabra («À PAYER», «ESPÈCES»)', () => {
    expect(written(receipt('CAFÉ\nPEN 2.99 TAXE 0.10\nTOTAL À PAYER CAD 3.09', 'fr'))).toEqual([309, null, null])
    expect(written(receipt('CAFÉ\nÀ PAYER RUB 10.00', 'fr'))).toEqual([1000, 'RUB', null])
    expect(written(receipt('CAFÉ\nTOTAL 10.00\nESPÈCES USD 20.00', 'fr'))).toEqual([1000, 'USD', null])
    expect(written(receipt('LOJA\nTOTAL 10.00\nDÉBITO PEN 10.00', 'pt'))).toEqual([1000, 'PEN', null])
    expect(written(receipt('LOJA\nTOTAL 10.00\nTROCO PEN 1.00', 'pt'))).toEqual([1000, 'PEN', null])
    expect(written(receipt('TIENDA\nIMPORTE PEN 10,00', 'es'))).toEqual([1000, 'PEN', null])
    expect(written(receipt('TIENDA\nMONTO (RUB) 10,00', 'es'))).toEqual([1000, 'RUB', null])
  })
  it('controles de nombres de artículo y texto engañoso que ya existían', () => {
    for (const text of ['STAPLES\nPEN 2.99\nTOTAL 2.99', 'PEN SHOP\nTOTAL 10.00', 'SHOP\nTRY OUR APP\nTOTAL 10.00', 'SHOP\nBOB CASHIER\nTOTAL 10.00', 'SHOP\nTOTAL PENS 10.00', 'SHOP\nTOTAL ITEMS 3\nTOTAL 10.00']) {
      const r = receipt(text)
      expect(r.foreignCurrency, text).toBeUndefined()
      expect(r.currencyConflict, text).toBeUndefined()
    }
    expect(receipt('STAPLES\nPEN 2.99\nTOTAL PEN 2.99').foreignCurrency).toBe('PEN')
  })
})
