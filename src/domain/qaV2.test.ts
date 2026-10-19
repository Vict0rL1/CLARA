/**
 * QA V2 (auditoría independiente del 2026-10-15 sobre 43b4d74): contratos de CUR-01, CUR-02, CUR-03 y
 * FIN-01, y el ancla de los días al partir un programado (SCH-01). Datos sintéticos. Los textos de recibo
 * son texto OCR SINTÉTICO: no prueban una cámara real ni un servicio de OCR.
 *
 * CUR-01 y CUR-02 son defectos ANTERIORES al candidato (también en `main` a23b135), destapados por la
 * cobertura ampliada; CUR-03 nace con la lectura de monedas en recibos de RT-01.
 */
import { describe, expect, it } from 'vitest'
import { previewImport, type ImportOptions } from './bankImport'
import { minimumPayment, monthlyInterest } from './cards'
import { heroFigures } from './heroFigures'
import { parseMoney, stripCurrencyMark, withCurrencyMark, withCurrencyMarks, MAX_AMOUNT_MINOR } from './money'
import { parseText, type ParseContext, type ParsedEntry } from './parser'
import { type ScheduleDraft } from './operations'
import { dayBalance, projectBalance } from './projection'
import { occurrencesBetween } from './recurrence'
import { parseReceiptText } from './receipt'
import { recurringCosts } from './recurringCosts'
import { periodStats, statsRange } from './statistics'
import { saveScheduleFrom, splitKeepsAnchor } from './scheduleFrom'
import { parseShortcutAmount, readMovementLink } from './shortcutLink'
import type { Language, Schedule } from './types'
import { account, baseData, bill, ctx, income, tx } from '../test/fixtures'

const LANGUAGES: readonly Language[] = ['es', 'en', 'pt', 'fr']
const parseCtx = (language: Language, currency = 'CAD'): ParseContext => ({
  today: '2026-09-28',
  currency,
  language,
  categories: [{ id: 'dining', kind: 'expense' }, { id: 'other_expense', kind: 'expense' }, { id: 'salary', kind: 'income' }],
})

/** Lo que el asistente escribe en el campo «Importe» (como `initialAmountText`) y cómo se lee después. */
function fieldOf(entry: ParsedEntry, currency = 'CAD') {
  const amount = entry.amountMinor === null ? '' : (entry.amountMinor / 100).toFixed(2)
  const field = entry.currencyConflict ? withCurrencyMarks(amount, entry.currencyConflict) : entry.foreignCurrency ? withCurrencyMark(amount, entry.foreignCurrency) : amount
  return { field, parsed: parseMoney(field, currency, 'en-CA') }
}
const one = (text: string, language: Language = 'en', currency = 'CAD') => {
  const [entry] = parseText(text, parseCtx(language, currency))
  return { entry: entry!, ...fieldOf(entry!, currency) }
}

describe('CUR-01 · un código explícito manda sobre un símbolo genérico en el asistente', () => {
  // [texto por idioma, importe, moneda que se conserva]
  const BY_LANGUAGE: Record<Language, readonly (readonly [string, number, string])[]> = {
    es: [['café USD $10', 1000, 'USD'], ['café $10 USD', 1000, 'USD'], ['café usd $ 10', 1000, 'USD'], ['café diez dólares USD', 1000, 'USD'], ['café USD diez dólares', 1000, 'USD']],
    en: [['coffee USD $10', 1000, 'USD'], ['coffee $10 USD', 1000, 'USD'], ['coffee USD $ 10.50', 1050, 'USD'], ['coffee ten dollars USD', 1000, 'USD'], ['coffee AUD $10', 1000, 'AUD']],
    pt: [['café USD $10', 1000, 'USD'], ['café 10$ USD', 1000, 'USD'], ['café dez dólares USD', 1000, 'USD']],
    fr: [['café USD $10', 1000, 'USD'], ['café 10 $ USD', 1000, 'USD'], ['café dix dollars USD', 1000, 'USD']],
  }

  for (const language of LANGUAGES) {
    it(`${language}: la línea conserva el código, lo quita de la descripción y el campo la bloquea`, () => {
      for (const [text, minor, code] of BY_LANGUAGE[language]) {
        const { entry, field, parsed } = one(text, language)
        expect(entry.amountMinor, text).toBe(minor)
        expect(entry.foreignCurrency, text).toBe(code)
        expect(entry.currencyConflict, text).toBeUndefined()
        expect(entry.description, text).not.toMatch(/usd|aud|\$/i)
        expect(parsed, `${text} → «${field}»`).toMatchObject({ ok: false, error: 'currencyMismatch', found: code, expected: 'CAD' })
      }
    })
  }

  it('un código incompatible con el símbolo es un conflicto: se conservan los dos y la línea no se registra', () => {
    for (const [text, pair] of [
      ['coffee EUR $10', ['EUR', '$']],
      ['coffee USD 10 CAD', ['USD', 'CAD']],
      ['coffee €10 CAD', ['€', 'CAD']],
      ['coffee 10 CAD paid in euros', ['CAD', 'EUR']],
    ] as const) {
      const { entry, field, parsed } = one(text)
      expect(entry.amountMinor, text).toBe(1000)
      expect(entry.foreignCurrency, text).toBeUndefined()
      expect(entry.currencyConflict, text).toEqual(pair)
      expect(parsed, `${text} → «${field}»`).toMatchObject({ ok: false, error: 'currencyConflict', found: pair[0], other: pair[1], expected: 'CAD' })
    }
  })

  it('controles de la misma moneda: CAD con «$» o escrito dos veces sigue siendo válido y no se convierte nada', () => {
    for (const language of LANGUAGES) {
      for (const text of ['coffee CAD $10', 'coffee $10 CAD', 'coffee $10', 'coffee 10', 'coffee 10 dollars', 'coffee CAD 10 CAD', 'coffee C$10 CAD']) {
        const { entry, parsed } = one(text, language)
        expect(entry.foreignCurrency, `${language}: ${text}`).toBeUndefined()
        expect(entry.currencyConflict, `${language}: ${text}`).toBeUndefined()
        expect(parsed, `${language}: ${text}`).toEqual({ ok: true, minor: 1000 })
      }
    }
    // En un presupuesto USD, «USD $10» es la moneda del presupuesto.
    expect(one('coffee USD $10', 'en', 'USD').parsed).toEqual({ ok: true, minor: 1000 })
  })

  it('un nombre o un símbolo a dos pasos del importe es texto corriente: «Cafe Euro $12» se registra en CAD (revisión propia, R4)', () => {
    for (const [text, minor, description] of [
      ['Cafe Euro $12', 1200, 'Cafe Euro'],
      ['Sushi Yen $25', 2500, 'Sushi Yen'],
      ['Peso $10', 1000, 'Peso'],
    ] as const) {
      const { entry, parsed } = one(text, 'en')
      expect(entry.amountMinor, text).toBe(minor)
      expect(entry.foreignCurrency, text).toBeUndefined()
      expect(entry.currencyConflict, text).toBeUndefined()
      expect(entry.description, text).toBe(description)
      expect(parsed, text).toEqual({ ok: true, minor })
    }
    // Un nombre PEGADO al importe sigue contando (RT-01): «$12 Euro Market» es «$» contra «euro», un conflicto que se
    // enseña (antes de QA V2 se registraba en EUR sin más, evidence/final-verify/review/r4-baseline-819eaa9.txt).
    expect(one('$12 Euro Market', 'en').entry.currencyConflict).toEqual(['$', 'EUR'])
    // Un código a dos pasos sigue contando (CUR-01), y un nombre pegado al importe también (RT-01).
    expect(one('coffee ten dollars USD', 'en').entry.foreignCurrency).toBe('USD')
    expect(one('coffee USD $10', 'en').entry.foreignCurrency).toBe('USD')
    expect(one('Cafe Euro 12', 'en').entry.foreignCurrency).toBe('EUR')
    // El lector de los campos de importe aplica la misma regla: «10 € EUR» sigue siendo EUR y «USD $10», USD.
    expect(parseMoney('10 € EUR', 'EUR', 'en-CA')).toEqual({ ok: true, minor: 1000 })
    expect(parseMoney('10 € EUR', 'CAD', 'en-CA')).toMatchObject({ ok: false, error: 'currencyMismatch', found: 'EUR' })
    expect(parseMoney('USD $10', 'CAD', 'en-CA')).toMatchObject({ ok: false, error: 'currencyMismatch', found: 'USD' })
  })

  it('varias entradas: solo se bloquea la que trae otra moneda', () => {
    const entries = parseText('coffee USD $10\ntea $4\nbagel 3 CAD', parseCtx('en'))
    expect(entries.map((e) => [e.amountMinor, e.foreignCurrency ?? null, e.currencyConflict ?? null])).toEqual([
      [1000, 'USD', null],
      [400, null, null],
      [300, null, null],
    ])
  })
})

describe('CUR-02 · el lector compartido reconcilia prefijo y sufijo; una contradicción nunca se acepta', () => {
  // Contradicciones: nunca la moneda del presupuesto, en ningún consumidor.
  const CONFLICTS: readonly (readonly [string, string, string])[] = [
    ['USD 10 CAD', 'USD', 'CAD'],
    ['EUR 10 CAD', 'EUR', 'CAD'],
    ['€10 CAD', '€', 'CAD'],
    ['GBP 10 CAD', 'GBP', 'CAD'],
    ['US$10 CAD', 'USD', 'CAD'],
    ['CAD 10 USD', 'CAD', 'USD'],
    ['-USD 10 CAD', 'USD', 'CAD'],
    ['USD $10 CAD', 'USD', 'CAD'],
    ['£10 USD', '£', 'USD'],
    ['$10 €', '$', '€'],
    ['EUR 10 kr', 'EUR', 'kr'],
    ['€10 pesos', '€', 'pesos'],
    ['RUB 10 CAD', 'RUB', 'CAD'],
  ]
  // Marcas repetidas o compatibles: el código concreto manda sobre el símbolo o el nombre genérico.
  const COMPATIBLE: readonly (readonly [string, string, number])[] = [
    ['CAD 10 CAD', 'CAD', 1000],
    ['$10 CAD', 'CAD', 1000],
    ['$ 10 CAD', 'CAD', 1000],
    ['CAD $10', 'CAD', 1000],
    ['CA$10 CAD', 'CAD', 1000],
    ['10 CAD $', 'CAD', 1000],
    ['-$10 CAD', 'CAD', -1000],
    ['$-10 CAD', 'CAD', -1000],
    ['−CAD 10.50 CAD', 'CAD', -1050],
    ['USD $10', 'USD', 1000],
    ['€10 EUR', 'EUR', 1000],
    ['EUR 1.234,56 €', 'EUR', 123456],
    ['MXN 10 pesos', 'MXN', 1000],
    ['SEK 10 kr', 'SEK', 1000],
    ['¥1000 JPY', 'JPY', 1000],
  ]

  it('stripCurrencyMark: una contradicción se marca como conflicto con las dos monedas (el número queda intacto)', () => {
    for (const [input, a, b] of CONFLICTS) {
      const r = stripCurrencyMark(input)
      expect(r.mark, input).toMatchObject({ conflict: [expect.anything(), expect.anything()] })
      const labels = r.mark && 'conflict' in r.mark ? r.mark.conflict.map((m) => ('code' in m ? m.code : 'symbol' in m ? m.symbol : 'name' in m ? m.name : 'unknown' in m ? m.unknown : '')) : []
      expect(labels, input).toEqual([a, b])
      expect(r.text.replace(/[-−]/, ''), input).toBe('10')
    }
  })

  it('parseMoney (campos de importe manuales): contradicción → currencyConflict en cualquier moneda de presupuesto', () => {
    for (const [input, a, b] of CONFLICTS) {
      for (const budget of ['CAD', 'USD', 'EUR']) {
        expect(parseMoney(input, budget, 'en-CA', { allowNegative: true }), `${input} (${budget})`).toEqual({ ok: false, error: 'currencyConflict', digits: 2, found: a, other: b, expected: budget })
      }
    }
  })

  it('parseMoney: marcas repetidas o compatibles valen como esa moneda, con su signo, separadores y decimales', () => {
    for (const [input, code, minor] of COMPATIBLE) {
      const locale = code === 'EUR' ? 'es-ES' : 'en-CA'
      expect(parseMoney(input, code, locale, { allowNegative: true }), input).toEqual({ ok: true, minor })
      // En otro presupuesto, la moneda escrita es la concreta (nunca el símbolo genérico).
      const other = code === 'CAD' ? 'USD' : 'CAD'
      expect(parseMoney(input, other, locale, { allowNegative: true }), `${input} (${other})`).toMatchObject({ ok: false, error: 'currencyMismatch', found: code })
    }
    // Precisión: los decimales de más siguen siendo un error, con o sin marcas.
    expect(parseMoney('CAD 10.999 CAD', 'CAD', 'en-CA')).toMatchObject({ ok: false, error: 'tooManyDecimals' })
    expect(parseMoney('JPY 10.5 ¥', 'JPY', 'en-CA')).toMatchObject({ ok: false, error: 'tooManyDecimals' })
    expect(parseMoney('CAD 10 CAD', 'CAD', 'en-CA')).toEqual({ ok: true, minor: 1000 })
  })

  it('la marca va y vuelve: lo que el asistente escribe con dos monedas se lee como el mismo conflicto', () => {
    for (const pair of [['USD', 'CAD'], ['€', 'CAD'], ['EUR', '$'], ['US$', 'CAD'], ['CAD', 'pesos'], ['kr', 'EUR'], ['pesos', 'kr'], ['RUB', '€'], ['XY$', 'CAD']] as const) {
      const text = withCurrencyMarks('10.00', pair)
      const r = parseMoney(text, 'CAD', 'en-CA')
      expect(r, `${pair.join(' + ')} → «${text}»`).toMatchObject({ ok: false, error: 'currencyConflict' })
      if (!r.ok) expect([r.found, r.other].sort(), text).toEqual([pair[0] === 'US$' ? 'USD' : pair[0], pair[1]].sort())
    }
    // Una moneda no admitida con su propio símbolo no es un conflicto: sigue siendo esa moneda.
    expect(parseMoney('RUB 10 ₽', 'CAD', 'en-CA')).toMatchObject({ ok: false, error: 'unknownCurrency', found: 'RUB' })
  })

  it('CSV: una fila con dos monedas distintas es un error visible (también «-USD 10 CAD») y nunca se importa', () => {
    const opts: ImportOptions = { accountId: 'main', mapping: { date: 0, description: 1, amount: 2 }, hasHeader: false, dateFormat: 'ymd', invertSign: false, locale: 'en-CA', today: '2026-09-28' }
    const preview = previewImport(
      [
        ['2026-09-20', 'Café', '-USD 10 CAD'],
        ['2026-09-21', 'Té', '€10 CAD'],
        ['2026-09-22', 'Pan', '-10 CAD'],
        ['2026-09-23', 'Leche', '$-4.50 CAD'],
        ['2026-09-24', 'Agua', 'CAD -2.00 CAD'],
      ],
      baseData({ accounts: [account({ id: 'main', name: 'Principal' })] }),
      opts,
    )
    expect(preview.rows.map((r) => [r.status, r.error ?? null, r.currency ?? null, r.otherCurrency ?? null, r.amountMinor ?? null])).toEqual([
      ['error', 'currencyConflict', 'USD', 'CAD', null],
      ['error', 'currencyConflict', '€', 'CAD', null],
      ['new', null, 'CAD', null, 1000],
      ['new', null, 'CAD', null, 450],
      ['new', null, 'CAD', null, 200],
    ])
  })

  it('atajos: una contradicción no se rellena (el importe queda vacío y se dice); una marca compatible sí', () => {
    for (const [input] of CONFLICTS) {
      expect(parseShortcutAmount(input, 'CAD', 'en-CA'), input).toEqual({ ok: false })
      expect(readMovementLink(new URLSearchParams({ importe: input }), { currency: 'CAD', numberLocale: 'en-CA' }), input).toMatchObject({ amountUnreadable: true })
    }
    expect(parseShortcutAmount('$10 CAD', 'CAD', 'en-CA')).toEqual({ ok: true, minor: 1000 })
    expect(parseShortcutAmount('USD $10', 'CAD', 'en-CA')).toEqual({ ok: true, minor: 1000, foreignCurrency: 'USD' })
    expect(parseShortcutAmount('€10 EUR', 'CAD', 'en-CA')).toEqual({ ok: true, minor: 1000, foreignCurrency: 'EUR' })
  })
})

describe('CUR-03 · la moneda impresa en el total o el pago de un recibo se conserva (texto OCR sintético)', () => {
  const receipt = (text: string, currency = 'CAD') => parseReceiptText(text, parseCtx('en', currency))

  it('códigos admitidos que son palabras («PEN») y monedas no admitidas («RUB») en la línea del total', () => {
    expect(receipt('SHOP\nTOTAL PEN 10.00')).toMatchObject({ totalMinor: 1000, foreignCurrency: 'PEN' })
    expect(receipt('SHOP\nTOTAL RUB 10.00')).toMatchObject({ totalMinor: 1000, foreignCurrency: 'RUB' })
    expect(receipt('SHOP\nTOTAL 10.00 PEN')).toMatchObject({ totalMinor: 1000, foreignCurrency: 'PEN' })
    expect(receipt('SHOP\nAMOUNT DUE TRY 10.00')).toMatchObject({ totalMinor: 1000, foreignCurrency: 'TRY' })
  })

  it('subtotal, impuestos y pago (efectivo, tarjeta, cambio) también dicen la moneda; un artículo no', () => {
    expect(receipt('SHOP\nSUBTOTAL PEN 9.00\nIGV 1.00\nTOTAL 10.00')).toMatchObject({ totalMinor: 1000, foreignCurrency: 'PEN' })
    expect(receipt('SHOP\nTOTAL 10.00\nEFECTIVO PEN 20.00\nVUELTO PEN 10.00')).toMatchObject({ totalMinor: 1000, foreignCurrency: 'PEN' })
    expect(receipt('SHOP\nTOTAL 10.00\nCASH USD 20.00')).toMatchObject({ totalMinor: 1000, foreignCurrency: 'USD' })
    expect(receipt('SHOP\nTOTAL 10.00\nVISA RUB 10.00')).toMatchObject({ foreignCurrency: 'RUB' })
    // Control: «PEN 2.99» es un bolígrafo.
    const pen = receipt('STAPLES\nPEN 2.99\nTOTAL 2.99')
    expect(pen.totalMinor).toBe(299)
    expect(pen.foreignCurrency).toBeUndefined()
    expect(pen.currencyConflict).toBeUndefined()
    expect(receipt('STAPLES\nPEN 2.99\nTOTAL PEN 2.99').foreignCurrency).toBe('PEN')
  })

  it('símbolos y la moneda del presupuesto: igual que antes', () => {
    expect(receipt('SHOP\nTOTAL 10.00 €').foreignCurrency).toBe('€')
    expect(receipt('SHOP\nTOTAL £10.00').foreignCurrency).toBe('£')
    expect(receipt('SHOP\nTOTAL USD 10.00').foreignCurrency).toBe('USD')
    for (const text of ['SHOP\nTOTAL CAD 10.00', 'SHOP\nTOTAL $10.00', 'SHOP\nTOTAL 10.00', 'SHOP\nTOTAL CAD $10.00']) {
      const r = receipt(text)
      expect(r.totalMinor, text).toBe(1000)
      expect(r.foreignCurrency, text).toBeUndefined()
      expect(r.currencyConflict, text).toBeUndefined()
    }
    // En un presupuesto en soles, «PEN» en el total es su propia moneda.
    expect(receipt('SHOP\nTOTAL PEN 10.00', 'PEN').foreignCurrency).toBeUndefined()
  })

  it('texto engañoso: un código sin importe o una palabra que contiene un código no es moneda', () => {
    for (const text of ['PEN SHOP\nTOTAL 10.00', 'SHOP\nTRY OUR APP\nTOTAL 10.00', 'SHOP\nBOB CASHIER\nTOTAL 10.00', 'SHOP\nTOTAL PENS 10.00', 'SHOP\nTOTAL ITEMS 3\nTOTAL 10.00']) {
      const r = receipt(text)
      expect(r.foreignCurrency, text).toBeUndefined()
      expect(r.currencyConflict, text).toBeUndefined()
    }
  })

  it('dos monedas distintas en el recibo: conflicto, nunca la del presupuesto', () => {
    expect(receipt('SHOP\nTOTAL USD 10.00\nCASH PEN 37.00')).toMatchObject({ totalMinor: 1000, currencyConflict: ['USD', 'PEN'] })
    expect(receipt('SHOP\nTOTAL CAD 10.00\nCASH €10.00')).toMatchObject({ currencyConflict: ['CAD', '€'] })
    // El código concreto acota al símbolo genérico.
    expect(receipt('SHOP\nTOTAL USD 10.00\nCASH $20.00')).toMatchObject({ foreignCurrency: 'USD' })
  })
})

describe('FIN-01 · el resumen de pagos recurrentes tiene un rango exacto explícito', () => {
  const MAX = Number.MAX_SAFE_INTEGER
  const daily = (i: number, amountMinor: number, extra: Partial<Schedule> = {}) => bill('2026-09-28', amountMinor, { id: `d${i}`, name: `Diario ${i}`, frequency: 'daily', ...extra })
  /** 24 diarios de 10^12 + uno diario y uno anual que llevan el total EXACTAMENTE al máximo exacto (2^53 − 1). */
  const atLimit = (): Schedule[] => {
    const rest = MAX - 24 * 365 * MAX_AMOUNT_MINOR
    const perDay = Math.floor(rest / 365)
    return [...Array.from({ length: 24 }, (_, i) => daily(i, MAX_AMOUNT_MINOR)), daily(24, perDay), bill('2027-03-01', rest - perDay * 365, { id: 'y', name: 'Anual', frequency: 'yearly' })]
  }

  it('importes normales y un solo programado con el importe máximo: total y promedio exactos', () => {
    const one = recurringCosts({ schedules: [daily(0, MAX_AMOUNT_MINOR)] }, ctx.today)
    expect(one).toMatchObject({ ok: true, totalMinor: 365 * MAX_AMOUNT_MINOR, monthlyMinor: Math.floor((365 * MAX_AMOUNT_MINOR) / 12) })
    expect(one.items[0]).toMatchObject({ occurrences: 365, totalMinor: 365 * MAX_AMOUNT_MINOR })
    expect(recurringCosts(baseData({ schedules: [bill('2026-10-05', 1000, { frequency: 'monthly' })] }), ctx.today)).toMatchObject({ ok: true, totalMinor: 12000, monthlyMinor: 1000 })
  })

  it('justo en el máximo exacto vale; un céntimo más ya no: sin total ni promedio, nunca recortado ni redondeado', () => {
    const at = recurringCosts({ schedules: atLimit() }, ctx.today)
    expect(at).toMatchObject({ ok: true, totalMinor: MAX })
    expect(at.ok && at.monthlyMinor).toBe(Math.floor(MAX / 12))
    const above = atLimit()
    above[25] = { ...above[25]!, amountMinor: above[25]!.amountMinor + 1 }
    const r = recurringCosts({ schedules: above }, ctx.today)
    expect(r).toMatchObject({ ok: false, reason: 'outOfRange', totalMinor: null, monthlyMinor: null })
    // La lista sigue ahí: qué programados y cuántas veces, para que la persona revise los importes.
    expect(r.items).toHaveLength(26)
  })

  it('el caso de la auditoría (25 diarios × 10^12) ya no lanza: se dice que está fuera de rango', () => {
    const schedules = Array.from({ length: 25 }, (_, i) => daily(i, MAX_AMOUNT_MINOR))
    const before = JSON.stringify(schedules)
    expect(() => recurringCosts({ schedules }, ctx.today)).not.toThrow()
    expect(recurringCosts({ schedules }, ctx.today)).toMatchObject({ ok: false, reason: 'outOfRange' })
    // Solo informa: los datos no cambian.
    expect(JSON.stringify(schedules)).toBe(before)
  })

  it('en pausa y fechas omitidas no cuentan: vuelven a dejar el total dentro del rango', () => {
    const schedules = Array.from({ length: 25 }, (_, i) => daily(i, MAX_AMOUNT_MINOR))
    schedules[0] = { ...schedules[0]!, paused: true }
    expect(recurringCosts({ schedules }, ctx.today)).toMatchObject({ ok: true, totalMinor: 24 * 365 * MAX_AMOUNT_MINOR, pausedCount: 1 })
    // Por encima por un céntimo; omitir una fecha del diario pequeño lo devuelve al rango.
    const above = atLimit()
    above[25] = { ...above[25]!, amountMinor: above[25]!.amountMinor + 1 }
    above[24] = { ...above[24]!, skippedDates: ['2026-10-01'] }
    const r = recurringCosts({ schedules: above }, ctx.today)
    expect(r).toMatchObject({ ok: true, totalMinor: MAX + 1 - above[24]!.amountMinor })
  })

  it('fin de mes y «dos veces al mes» con importes máximos: se cuentan igual y el total es exacto', () => {
    const r = recurringCosts(
      {
        schedules: [
          bill('2026-10-15', MAX_AMOUNT_MINOR, { id: 'twice', name: 'Dos veces', frequency: 'semimonthly', secondDay: 31 }),
          bill('2026-01-31', MAX_AMOUNT_MINOR, { id: 'eom', name: 'Fin de mes', frequency: 'monthly' }),
        ],
      },
      ctx.today,
    )
    expect(r).toMatchObject({ ok: true, totalMinor: (23 + 12) * MAX_AMOUNT_MINOR })
    expect(r.items.map((i) => [i.schedule.id, i.occurrences])).toEqual([
      ['twice', 23],
      ['eom', 12],
    ])
  })

  it('ingresos: el mismo contrato', () => {
    const incomes = Array.from({ length: 25 }, (_, i) => income('2026-09-28', MAX_AMOUNT_MINOR, { id: `i${i}`, name: `Ingreso ${i}`, frequency: 'daily' }))
    expect(recurringCosts({ schedules: incomes }, ctx.today, 'income')).toMatchObject({ ok: false, reason: 'outOfRange' })
    expect(recurringCosts({ schedules: incomes.slice(0, 2) }, ctx.today, 'income')).toMatchObject({ ok: true, totalMinor: 2 * 365 * MAX_AMOUNT_MINOR })
  })

  it('el mismo patrón en Inicio, Estadísticas y tarjetas: ningún «importe × k» sin comprobar antes de dividir', () => {
    // Inicio: con estos datos «disponible × 100» ya no era exacto y la pantalla fallaba.
    expect(heroFigures({ transactions: [] }, { period: null, spendableMinor: 1000, availableMinor: -774_999_999_900_000 }, ctx.today).availablePct).toBe(0)
    expect(heroFigures({ transactions: [] }, { period: null, spendableMinor: 9_000_000_000_000_000, availableMinor: 4_500_000_000_000_000 }, ctx.today).availablePct).toBe(50)
    // Con importes normales, la misma cifra que antes.
    expect(heroFigures({ transactions: [] }, { period: null, spendableMinor: 10000, availableMinor: 2599 }, ctx.today).availablePct).toBe(25)
    expect(heroFigures({ transactions: [] }, { period: null, spendableMinor: 10000, availableMinor: 12000 }, ctx.today).availablePct).toBe(100)
    // Estadísticas: un porcentaje que no cabe en un entero exacto no se da (como con base 0); la diferencia sí.
    const huge = baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 0, date: '2026-07-01', setAt: '2026-07-01T12:00:00.000Z' } })],
      transactions: [tx({ id: 'aug', date: '2026-08-10', amountMinor: 1 }), ...Array.from({ length: 91 }, (_, i) => tx({ id: `s${i}`, date: '2026-09-10', amountMinor: MAX_AMOUNT_MINOR }))],
    })
    const stats = periodStats(huge, 'month', statsRange('month', huge.settings, ctx.today))
    expect(stats.previousComparable).toBe(true)
    expect(stats.expenses).toEqual({ diffMinor: 91 * MAX_AMOUNT_MINOR - 1, percent: null })
    // Tarjetas: pago mínimo e interés exactos con una deuda enorme (antes lanzaban); con normales, igual que antes.
    expect(minimumPayment(5_000_000_000_000, { card: { minPaymentBps: 10000 } })).toBe(5_000_000_000_000)
    expect(monthlyInterest(5_000_000_000_000, 9999)).toBe(416_625_000_000)
    expect(minimumPayment(50000, {})).toBe(Math.max(1000, Math.ceil((50000 * 300) / 10000)))
    expect(monthlyInterest(10000, 1999)).toBe(Math.ceil((10000 * 1999) / 120000))
  })

  it('la proyección del calendario se detiene en el último día exacto; después no hay cifra (como más allá de 400 días)', () => {
    const data = baseData({ schedules: Array.from({ length: 25 }, (_, i) => daily(i, MAX_AMOUNT_MINOR)) })
    // Sin pedirlo, la proyección sigue sin aceptar una suma inexacta (las demás pantallas no cambian).
    expect(() => projectBalance(data, ctx.today, { days: 400 })).toThrow()
    const p = projectBalance(data, ctx.today, { days: 400, stopWhenOutOfRange: true })
    expect(p.outOfRangeFrom).not.toBeNull()
    const last = p.days[p.days.length - 1]!
    expect(Number.isSafeInteger(last.endMinor)).toBe(true)
    expect(p.days.length).toBeLessThan(400)
    expect(dayBalance(p, p.outOfRangeFrom!)).toEqual({ state: 'beyond', lastDate: last.date })
    // Con importes normales llega al final y no hay fecha fuera de rango.
    const normal = projectBalance(baseData({ schedules: [daily(0, 1000)] }), ctx.today, { days: 400, stopWhenOutOfRange: true })
    expect(normal.days).toHaveLength(400)
    expect(normal.outOfRangeFrom).toBeNull()
  })
})

describe('SCH-01 (QA V2) · partir un «dos veces al mes» conserva sus dos días: lo resuelve la fecha que fija la serie (PR #15, QA-01)', () => {
  const twice = (startDate: string, secondDay: number): Schedule => bill(startDate, 1000, { id: 'tw', frequency: 'semimonthly', secondDay })
  const amountOnly = (s: Schedule, startDate: string): ScheduleDraft => {
    const { createdAt: _c, updatedAt: _u, currency: _cur, skippedDates: _k, ...rest } = s
    return { ...rest, id: 'next', startDate, amountMinor: 1200 }
  }
  const splitFrom = (s: Schedule, from: string) => {
    const r = saveScheduleFrom(baseData({ schedules: [s] }), s.id, amountOnly(s, from), ctx)
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    return r.value.next
  }

  it('15 y 30 desde el 30, y 1 y 16 desde el 16: el tramo nuevo sigue con los mismos días sin tocar el segundo día', () => {
    const next = splitFrom(twice('2026-06-15', 30), '2026-09-30')
    expect(next).toMatchObject({ startDate: '2026-09-30', anchorDate: '2026-06-15', secondDay: 30 })
    expect(occurrencesBetween(next, '2026-09-30', '2026-11-30')).toEqual(['2026-09-30', '2026-10-15', '2026-10-30', '2026-11-15', '2026-11-30'])
    const implicit = splitFrom(twice('2026-06-01', 16), '2026-10-16')
    expect(implicit).toMatchObject({ startDate: '2026-10-16', anchorDate: '2026-06-01', secondDay: 16 })
    expect(occurrencesBetween(implicit, '2026-10-16', '2026-12-01')).toEqual(['2026-10-16', '2026-11-01', '2026-11-16', '2026-12-01'])
  })

  it('borde de fin de mes: 15 y 31 desde el 30-sep (el 31 movido) sigue siendo 15 y 31; cambiar la regla o la fecha sí reancla', () => {
    const s = twice('2026-06-15', 31)
    expect(occurrencesBetween(splitFrom(s, '2026-09-30'), '2026-09-30', '2026-12-31')).toEqual(['2026-09-30', '2026-10-15', '2026-10-31', '2026-11-15', '2026-11-30', '2026-12-15', '2026-12-31'])
    expect(splitKeepsAnchor(s, { frequency: 'semimonthly', secondDay: 31, startDate: '2026-09-30' })).toBe(true)
    // Otro segundo día, u otra fecha que no es de la serie: cambio explícito de la regla.
    expect(splitKeepsAnchor(s, { frequency: 'semimonthly', secondDay: 20, startDate: '2026-09-30' })).toBe(false)
    expect(splitKeepsAnchor(s, { frequency: 'semimonthly', secondDay: 31, startDate: '2026-10-05' })).toBe(false)
    expect(splitKeepsAnchor(s, { frequency: 'monthly', startDate: '2026-09-30' })).toBe(false)
  })
})
