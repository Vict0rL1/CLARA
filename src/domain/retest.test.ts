/**
 * Regresiones de la nueva comprobación independiente de `main` a23b135 (2026-10-15): RT-01
 * (moneda escrita en todas sus formas), RT-02 (deshacer una sustitución ligado a su propia
 * revisión) y RT-03 (el reconocimiento de filas omitidas de un CSV es de esa vista previa).
 * Datos sintéticos; cada bloque fija el contrato y falla sobre a23b135.
 */
import { describe, expect, it } from 'vitest'
import { omissionSignature, previewImport, type ImportOptions } from './bankImport'
import { parseText, type ParseContext } from './parser'
import { parseReceiptText } from './receipt'
import { parseMoney, stripCurrencyMark, withCurrencyMark } from './money'
import { parseShortcutAmount } from './shortcutLink'
import type { Language } from './types'
import { account, baseData } from '../test/fixtures'

const LANGUAGES: readonly Language[] = ['es', 'en', 'pt', 'fr']
const ctx = (language: Language, currency = 'CAD'): ParseContext => ({
  today: '2026-09-28',
  currency,
  language,
  categories: [{ id: 'dining', kind: 'expense' }, { id: 'other_expense', kind: 'expense' }, { id: 'salary', kind: 'income' }],
})

/** Lo que el asistente pone en el campo «Importe» y lo que ese campo dice al validarlo. */
function fieldOf(text: string, language: Language, currency = 'CAD') {
  const [e] = parseText(text, ctx(language, currency))
  const amount = e!.amountMinor === null ? '' : (e!.amountMinor / 100).toFixed(2)
  const field = e!.foreignCurrency ? withCurrencyMark(amount, e!.foreignCurrency) : amount
  return { entry: e!, field, parsed: parseMoney(field, currency, 'en-CA') }
}

describe('RT-01 · ninguna moneda escrita distinta se convierte en la del presupuesto', () => {
  // [texto, importe en unidades menores de CAD, marca que se conserva]
  const FOREIGN: readonly (readonly [string, number, string])[] = [
    // Casos reproducidos por la comprobación independiente.
    ['coffee 10€', 1000, '€'],
    ['coffee GBP 10', 1000, 'GBP'],
    ['coffee JPY 10', 1000, 'JPY'],
    ['coffee JPY 1000', 100000, 'JPY'],
    ['coffee CHF 10', 1000, 'CHF'],
    ['coffee 10 €', 1000, '€'],
    ['coffee 10 £', 1000, '£'],
    ['coffee 10£', 1000, '£'],
    ['coffee EUR ten', 1000, 'EUR'],
    ['coffee ten USD', 1000, 'USD'],
    // El caso original de AS-01 sigue bloqueado.
    ['coffee USD 10', 1000, 'USD'],
    // Prefijo y sufijo, con y sin espacio, en mayúsculas y minúsculas.
    ['coffee GBP10', 1000, 'GBP'],
    ['coffee 10GBP', 1000, 'GBP'],
    ['coffee 10 gbp', 1000, 'GBP'],
    ['coffee gbp 10', 1000, 'GBP'],
    ['coffee €10', 1000, '€'],
    ['coffee £ 10.50', 1050, '£'],
    ['coffee ¥1000', 100000, '¥'],
    ['coffee 10 ₽', 1000, '₽'],
    ['coffee US$10', 1000, 'USD'],
    // Una moneda ISO real que la app no admite sigue siendo otra moneda.
    ['coffee RUB 10', 1000, 'RUB'],
    // Nombres de moneda e importes en palabras.
    ['coffee 10 euros', 1000, 'EUR'],
    ['coffee ten euros', 1000, 'EUR'],
    ['coffee 10 pesos', 1000, 'pesos'],
    ['coffee 2000 yen', 200000, 'JPY'],
    ['coffee 10 pounds sterling', 1000, 'GBP'],
  ]
  // Moneda escrita en la frase pero no pegada al importe: sin resolver, nunca la del presupuesto
  // (la descripción queda como se escribió).
  const FAR: readonly (readonly [string, number, string])[] = [
    ['coffee (USD) 10', 1000, 'USD'],
    ['paid in euros coffee 10', 1000, 'EUR'],
    ['one coffee EUR five', 100, 'EUR'],
  ]
  // Importes en palabras de cada idioma.
  const WORDS: Record<Language, readonly (readonly [string, number, string])[]> = {
    es: [['café diez euros', 1000, 'EUR'], ['café USD diez', 1000, 'USD'], ['café veinte GBP', 2000, 'GBP']],
    en: [['coffee twenty GBP', 2000, 'GBP'], ['coffee EUR twenty five', 2500, 'EUR']],
    pt: [['café dez euros', 1000, 'EUR'], ['café USD dez', 1000, 'USD']],
    fr: [['café dix euros', 1000, 'EUR'], ['café EUR dix', 1000, 'EUR']],
  }

  for (const language of LANGUAGES) {
    it(`${language}: el parser conserva la moneda, la quita de la descripción y el campo la bloquea`, () => {
      for (const [text, minor, mark] of [...FOREIGN, ...WORDS[language]]) {
        const { entry, field, parsed } = fieldOf(text, language)
        expect(entry.amountMinor, text).toBe(minor)
        expect(entry.foreignCurrency, text).toBe(mark)
        expect(entry.description.toLowerCase(), text).not.toContain(mark.toLowerCase())
        // Lo que se puede guardar nunca es un importe en CAD: el campo dice qué moneda se escribió.
        expect(parsed.ok, `${text} → «${field}»`).toBe(false)
        if (!parsed.ok) expect(parsed.found, text).toBe(mark)
      }
      for (const [text, minor, mark] of FAR) {
        const { entry, parsed } = fieldOf(text, language)
        expect(entry.amountMinor, text).toBe(minor)
        expect(entry.foreignCurrency, text).toBe(mark)
        expect(parsed, text).toMatchObject({ ok: false, found: mark })
      }
    })
  }

  it('controles de la misma moneda: CAD escrito de cualquier forma sigue siendo un importe válido', () => {
    for (const language of LANGUAGES) {
      for (const [text, minor] of [
        ['café 10', 1000],
        ['café $10', 1000],
        ['café 10 $', 1000],
        ['café 10 CAD', 1000],
        ['café CAD 10', 1000],
        ['café cad10', 1000],
        ['café C$ 10', 1000],
        ['café CA$10', 1000],
        ['café 10 dollars', 1000],
        ['coffee ten CAD', 1000],
        ['café 10 for two', 1000],
        // Palabras comunes que coinciden con un código no se leen como moneda en minúsculas.
        ['pen 3', 300],
        ['ron 12', 1200],
        // Abreviaturas que no son monedas (impuestos) tampoco, ni un ISO no admitido lejos del importe.
        ['GST 10', 1000],
        ['IVA 10', 1000],
        ['AMD GPU 10', 1000],
      ] as const) {
        const { entry, field, parsed } = fieldOf(text, language)
        expect(entry.foreignCurrency, `${language}: ${text}`).toBeUndefined()
        expect(parsed, `${language}: ${text} → «${field}»`).toEqual({ ok: true, minor })
      }
    }
  })

  it('en otro presupuesto la regla es la misma: su propia moneda vale y las demás se bloquean', () => {
    expect(fieldOf('café 10€', 'fr', 'EUR').entry.foreignCurrency).toBeUndefined()
    expect(fieldOf('café 10 euros', 'fr', 'EUR').entry.foreignCurrency).toBeUndefined()
    expect(fieldOf('café dix EUR', 'fr', 'EUR').entry.foreignCurrency).toBeUndefined()
    expect(fieldOf('café $10', 'fr', 'EUR').entry.foreignCurrency).toBe('$')
    expect(fieldOf('café 10 dollars', 'fr', 'EUR').entry.foreignCurrency).toBe('$')
    expect(fieldOf('tacos 100 pesos', 'es', 'MXN').entry.foreignCurrency).toBeUndefined()
    expect(fieldOf('tacos 100 pesos', 'es', 'USD').entry.foreignCurrency).toBe('pesos')
  })

  it('la marca va y vuelve por el campo: lo que el asistente escribe siempre se lee como la misma moneda', () => {
    for (const mark of ['USD', 'EUR', 'GBP', 'RUB', '€', '£', '¥', '₽', '$', 'pesos', 'XY$']) {
      const text = withCurrencyMark('10.00', mark)
      const back = stripCurrencyMark(text)
      expect(back.text, mark).toBe('10.00')
      const r = parseMoney(text, 'CAD', 'en-CA')
      if (mark === '$') expect(r).toEqual({ ok: true, minor: 1000 })
      else expect(r, mark).toMatchObject({ ok: false, found: mark })
    }
  })

  it('fotos de recibos: el total con otra moneda se marca; uno en la moneda del presupuesto no', () => {
    const r1 = parseReceiptText('CAFE DE PARIS\n2026-09-20\nTOTAL 12,50 €', ctx('fr'))
    expect(r1.totalMinor).toBe(1250)
    expect(r1.foreignCurrency).toBe('€')
    const r2 = parseReceiptText('PUB LONDON\nTOTAL GBP 18.20', ctx('en'))
    expect(r2.foreignCurrency).toBe('GBP')
    const r3 = parseReceiptText('TIM HORTONS\nTOTAL $4.50\nTPS 0.23', ctx('en'))
    expect(r3.foreignCurrency).toBeUndefined()
    // Un artículo «PEN» en un recibo en mayúsculas no es el sol peruano.
    const r4 = parseReceiptText('STAPLES\nPEN 2.99\nTOTAL 3.39', ctx('en'))
    expect(r4.foreignCurrency).toBeUndefined()
  })

  it('enlaces de atajos: cualquier moneda distinta llega como aviso, nunca como la del presupuesto', () => {
    expect(parseShortcutAmount('10 €', 'CAD', 'en-CA')).toEqual({ ok: true, minor: 1000, foreignCurrency: 'EUR' })
    expect(parseShortcutAmount('10 euros', 'CAD', 'en-CA')).toEqual({ ok: true, minor: 1000, foreignCurrency: 'EUR' })
    expect(parseShortcutAmount('$10', 'EUR', 'fr-FR')).toEqual({ ok: true, minor: 1000, foreignCurrency: '$' })
    expect(parseShortcutAmount('10 pesos', 'CAD', 'en-CA')).toEqual({ ok: true, minor: 1000, foreignCurrency: 'pesos' })
    expect(parseShortcutAmount('$10', 'CAD', 'en-CA')).toEqual({ ok: true, minor: 1000 })
  })
})

describe('RT-03 · reconocer las filas omitidas de un CSV vale solo para esa vista previa', () => {
  const opts = (hasHeader = true): ImportOptions => ({ accountId: 'bank', mapping: { date: 0, description: 1, amount: 2 }, hasHeader, dateFormat: 'ymd', invertSign: false, locale: 'en-CA', today: '2026-09-28', fileCurrency: 'CAD' })
  const data = baseData({ accounts: [account({ id: 'bank', name: 'Banco' })] })
  const table = (n: number, label = 'Fila') => [['Date', 'Description', 'Amount'], ...Array.from({ length: n }, (_, i) => ['2026-09-27', `${label} ${i + 1}`, '-1.00'])]

  it('cambia con otro archivo más grande y al leer la primera fila de otra forma; no existe si caben todas', () => {
    const a = omissionSignature(previewImport(table(5003), data, opts()))
    const b = omissionSignature(previewImport(table(6000), data, opts()))
    const noHeader = omissionSignature(previewImport(table(5003), data, opts(false)))
    expect(a).not.toBeNull()
    expect(new Set([a, b, noHeader]).size).toBe(3)
    expect(omissionSignature(previewImport(table(3), data, opts()))).toBeNull()
    expect(omissionSignature(previewImport(table(5000), data, opts()))).toBeNull()
  })

  it('con las mismas cuentas de filas la firma coincide: por eso la pantalla la une además al archivo elegido', () => {
    expect(omissionSignature(previewImport(table(5003, 'Otra'), data, opts()))).toBe(omissionSignature(previewImport(table(5003), data, opts())))
  })
})
