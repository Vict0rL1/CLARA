import { describe, expect, it } from 'vitest'
import { ceilDiv, currencyMarksAround, currencyMarksIn, floorDiv, formatMoney, groupAmountInput, minorToDecimalString, minorToInputString, mulDivFloor, parseMoney, sumMinor, stripCurrencyMark, symbolMatchesCurrency } from './money'

const ok = (input: string, locale = 'es-MX', currency = 'CAD', opts = {}) => {
  const r = parseMoney(input, currency, locale, opts)
  if (!r.ok) throw new Error(`esperaba ok para "${input}", obtuve ${r.error}`)
  return r.minor
}
const err = (input: string, locale = 'es-MX', currency = 'CAD', opts = {}) => {
  const r = parseMoney(input, currency, locale, opts)
  if (r.ok) throw new Error(`esperaba error para "${input}", obtuve ${r.minor}`)
  return r.error
}

describe('parseMoney', () => {
  it('acepta punto o coma como decimal', () => {
    expect(ok('12.50')).toBe(1250)
    expect(ok('12,50')).toBe(1250)
    expect(ok('12,5')).toBe(1250)
    expect(ok('0,1')).toBe(10)
    expect(ok('.5')).toBe(50)
    expect(ok('7')).toBe(700)
  })

  it('reconoce separadores de miles', () => {
    expect(ok('1,234.56')).toBe(123456)
    expect(ok('1.234,56')).toBe(123456)
    expect(ok('1,234,567')).toBe(123456700)
    expect(ok('1 234,56', 'fr-CA')).toBe(123456)
  })

  it('usa el formato elegido cuando hay 3 dígitos tras un único separador', () => {
    expect(ok('1,234', 'es-MX')).toBe(123400)
    expect(ok('1.234', 'es-ES')).toBe(123400)
    expect(err('1.234', 'es-MX')).toBe('tooManyDecimals')
    expect(err('1,234', 'es-ES')).toBe('tooManyDecimals')
  })

  it('ignora símbolos y códigos de moneda', () => {
    expect(ok('$ 45')).toBe(4500)
    expect(ok('CA$12.00')).toBe(1200)
    expect(ok('CAD 3')).toBe(300)
  })

  it('rechaza entradas inválidas', () => {
    expect(err('')).toBe('empty')
    expect(err('   ')).toBe('empty')
    expect(err('abc')).toBe('invalid')
    expect(err('12.3.4,5')).toBe('invalid')
    expect(err('1,2,3.4.5')).toBe('invalid')
    expect(err('12.345')).toBe('tooManyDecimals')
    expect(err('0')).toBe('zero')
    expect(err('999999999999999')).toBe('tooLarge')
  })

  it('negativos solo cuando se permiten (saldos en sobregiro)', () => {
    expect(err('-5')).toBe('negativeNotAllowed')
    expect(ok('-5', 'es-MX', 'CAD', { allowNegative: true })).toBe(-500)
    expect(ok('−12,30', 'es-MX', 'CAD', { allowNegative: true })).toBe(-1230)
    expect(ok('0', 'es-MX', 'CAD', { allowZero: true })).toBe(0)
  })

  it('respeta monedas sin decimales (CLP)', () => {
    expect(ok('1.234', 'es-MX', 'CLP')).toBe(1234)
    expect(ok('5000', 'es-MX', 'CLP')).toBe(5000)
    expect(err('12,5', 'es-MX', 'CLP')).toBe('tooManyDecimals')
  })
})

describe('aritmética entera', () => {
  it('suma sin errores de punto flotante', () => {
    // 0.10 + 0.20 en flotante da 0.30000000000000004; en centavos es exacto.
    expect(sumMinor([10, 20])).toBe(30)
    expect(sumMinor(Array(1000).fill(1))).toBe(1000)
  })

  it('rechaza importes no enteros', () => {
    expect(() => sumMinor([10.5])).toThrow()
  })

  it('floorDiv y ceilDiv redondean correctamente, también con negativos', () => {
    expect(floorDiv(1000, 3)).toBe(333)
    expect(floorDiv(-1000, 3)).toBe(-334)
    expect(ceilDiv(1000, 3)).toBe(334)
    expect(ceilDiv(999, 3)).toBe(333)
    expect(mulDivFloor(1000, 7, 3)).toBe(2333)
    expect(() => floorDiv(1, 0)).toThrow()
  })
})

describe('formato', () => {
  it('convierte a decimal exacto', () => {
    expect(minorToDecimalString(5, 'CAD')).toBe('0.05')
    expect(minorToDecimalString(-5, 'CAD')).toBe('-0.05')
    expect(minorToDecimalString(123456, 'CAD')).toBe('1234.56')
    expect(minorToDecimalString(1234, 'CLP')).toBe('1234')
  })

  it('formatea según la configuración regional', () => {
    expect(formatMoney(123456, 'CAD', 'en-CA')).toBe('$1,234.56')
    expect(formatMoney(-500, 'CAD', 'en-CA')).toBe('-$5.00')
    expect(formatMoney(123456, 'CAD', 'es-ES').replace(/\s/g, ' ')).toBe('1234,56 $')
    expect(formatMoney(123456, 'CAD', 'es-MX')).toBe('$1,234.56')
    expect(formatMoney(1500, 'CAD', 'en-CA', { signDisplay: 'always' })).toBe('+$15.00')
    expect(formatMoney(1234, 'CLP', 'es-MX')).toBe('$1,234')
  })

  it('formatea cifras grandes sin perder precisión', () => {
    expect(formatMoney(999_999_999_999, 'CAD', 'en-CA')).toBe('$9,999,999,999.99')
  })

  it('prepara texto editable con el separador del usuario', () => {
    expect(minorToInputString(123456, 'CAD', 'es-ES')).toBe('1234,56')
    expect(minorToInputString(123456, 'CAD', 'es-MX')).toBe('1234.56')
  })
})

describe('groupAmountInput (E2): miles mientras se escribe', () => {
  it('agrupa por el formato elegido y conserva lo escrito tras el decimal', () => {
    expect(groupAmountInput('1234567', 'es-MX', 'CAD')).toEqual({ text: '1,234,567', caret: 9 })
    expect(groupAmountInput('1234.5', 'es-MX', 'CAD')).toEqual({ text: '1,234.5', caret: 7 })
    expect(groupAmountInput('1234,5', 'es-CO', 'USD')).toEqual({ text: '1.234,5', caret: 7 })
    expect(groupAmountInput('1.234.567', 'es-CO', 'COP').text).toBe('1.234.567')
    expect(groupAmountInput('1234', 'es-CL', 'CLP').text).toBe('1.234')
    expect(groupAmountInput('-1234', 'es-MX', 'CAD').text).toBe('-1,234')
    expect(groupAmountInput('12,5', 'es-MX', 'CAD').text).toBe('12.5')
  })

  it('al editar un número ya agrupado, los separadores de miles se recolocan', () => {
    // Insertar un dígito en medio: «1,2|34» + 5 → «1,25|34» → «12,5|34».
    expect(groupAmountInput('1,2534', 'es-MX', 'CAD', 4, '1,234')).toEqual({ text: '12,534', caret: 4 })
    // Borrar un dígito: «12,934» − 9 → «1,234» (no «12.34»).
    expect(groupAmountInput('12,34', 'es-MX', 'CAD', 3, '12,934').text).toBe('1,234')
    expect(groupAmountInput('1,2934.5', 'es-MX', 'CAD', 4, '1,234.5')).toEqual({ text: '12,934.5', caret: 4 })
  })

  it('nunca cambia el significado: textos inválidos, ambiguos o a medio escribir quedan igual', () => {
    expect(groupAmountInput('12.3.4', 'es-MX', 'CAD').text).toBe('12.3.4')
    expect(groupAmountInput('12.3.4', 'es-CO', 'COP').text).toBe('12.3.4')
    expect(groupAmountInput('1234.567', 'es-MX', 'CAD').text).toBe('1234.567')
    expect(groupAmountInput('1234,5', 'es-CO', 'COP').text).toBe('1234,5')
    expect(groupAmountInput('1,2345', 'es-MX', 'CAD').text).toBe('1,2345')
    expect(groupAmountInput('12,', 'es-MX', 'CAD').text).toBe('12,')
    expect(groupAmountInput('$ 45', 'es-MX', 'CAD').text).toBe('$ 45')
    expect(groupAmountInput('', 'es-MX', 'CAD')).toEqual({ text: '', caret: 0 })
    // Lo que se guarda es lo mismo que sin agrupar.
    for (const [raw, locale, cur] of [['1234567', 'es-MX', 'CAD'], ['85000', 'es-CO', 'COP'], ['1234,5', 'es-CO', 'USD']] as const) {
      const grouped = groupAmountInput(raw, locale, cur).text
      expect(parseMoney(grouped, cur, locale)).toEqual(parseMoney(raw, cur, locale))
    }
  })

  it('mantiene el cursor sobre el mismo dígito', () => {
    expect(groupAmountInput('1234', 'es-MX', 'CAD', 2)).toEqual({ text: '1,234', caret: 3 })
    expect(groupAmountInput('1234567', 'es-MX', 'CAD', 4)).toEqual({ text: '1,234,567', caret: 5 })
  })
})

describe('marcas de moneda junto al importe (QA-05)', () => {
  const parse = (text: string, currency = 'CAD', locale = 'en-CA') => parseMoney(text, currency, locale, { allowNegative: true })

  it('lee códigos, prefijos con dólar y símbolos sin tocar el número', () => {
    expect(stripCurrencyMark('USD 100.00')).toEqual({ text: '100.00', mark: { code: 'USD' } })
    expect(stripCurrencyMark('12,50 EUR')).toEqual({ text: '12,50', mark: { code: 'EUR' } })
    expect(stripCurrencyMark('CA$12.00')).toEqual({ text: '12.00', mark: { code: 'CAD' } })
    expect(stripCurrencyMark('R$ 10')).toEqual({ text: '10', mark: { code: 'BRL' } })
    expect(stripCurrencyMark('$ 45')).toEqual({ text: '45', mark: { symbol: '$' } })
    expect(stripCurrencyMark('12,50 €')).toEqual({ text: '12,50', mark: { symbol: '€' } })
    expect(stripCurrencyMark('-$12')).toEqual({ text: '-12', mark: { symbol: '$' } })
    expect(stripCurrencyMark('$-12')).toEqual({ text: '-12', mark: { symbol: '$' } })
    expect(stripCurrencyMark('ABC 12')).toEqual({ text: '12', mark: { unknown: 'ABC' } })
    expect(stripCurrencyMark('45')).toEqual({ text: '45', mark: null })
  })

  it('la moneda del presupuesto, escrita o con su símbolo, se acepta; el número no cambia', () => {
    expect(parse('CAD 3')).toEqual({ ok: true, minor: 300 })
    expect(parse('CA$12.00')).toEqual({ ok: true, minor: 1200 })
    expect(parse('$ 45')).toEqual({ ok: true, minor: 4500 })
    expect(parse('12,50 €', 'EUR', 'es-ES')).toEqual({ ok: true, minor: 1250 })
    expect(parse('¥100', 'JPY', 'ja-JP')).toEqual({ ok: true, minor: 100 })
    expect(parse('R$ 10', 'BRL', 'pt-BR')).toEqual({ ok: true, minor: 1000 })
    expect(parse('(USD 100.00)'.replace(/^\((.*)\)$/, '-$1'), 'USD', 'en-US')).toEqual({ ok: true, minor: -10000 })
  })

  it('otra moneda explícita se rechaza con la marca encontrada; nunca se convierte ni se asume', () => {
    expect(parse('USD 100.00')).toEqual({ ok: false, error: 'currencyMismatch', digits: 2, found: 'USD', expected: 'CAD' })
    expect(parse('100 usd')).toMatchObject({ ok: false, error: 'currencyMismatch', found: 'USD' })
    expect(parse('€12')).toMatchObject({ ok: false, error: 'currencyMismatch', found: '€' })
    expect(parse('12,50 €', 'CAD', 'es-ES')).toMatchObject({ ok: false, error: 'currencyMismatch', found: '€' })
    expect(parse('$ 45', 'EUR', 'es-ES')).toMatchObject({ ok: false, error: 'currencyMismatch', found: '$' })
    expect(parse('US$12.50')).toMatchObject({ ok: false, error: 'currencyMismatch', found: 'USD' })
    expect(parse('¥100')).toMatchObject({ ok: false, error: 'currencyMismatch', found: '¥' })
    expect(parse('1.234,56 EUR', 'CAD', 'es-ES')).toMatchObject({ ok: false, error: 'currencyMismatch', found: 'EUR' })
    expect(parse('100 JPY')).toMatchObject({ ok: false, error: 'currencyMismatch', found: 'JPY' })
  })

  it('un código que no es una moneda conocida tampoco se asume', () => {
    expect(parse('ABC 12')).toEqual({ ok: false, error: 'unknownCurrency', digits: 2, found: 'ABC', expected: 'CAD' })
    expect(parse('XY$ 12')).toMatchObject({ ok: false, error: 'unknownCurrency', found: 'XY$' })
  })

  it('«$» vale para las monedas que usan ese símbolo y para ninguna otra', () => {
    for (const c of ['CAD', 'USD', 'MXN', 'COP', 'CLP', 'ARS', 'AUD', 'BRL']) expect(symbolMatchesCurrency('$', c), c).toBe(true)
    for (const c of ['EUR', 'GBP', 'JPY', 'PEN', 'CHF']) expect(symbolMatchesCurrency('$', c), c).toBe(false)
    expect(symbolMatchesCurrency('¥', 'JPY') && symbolMatchesCurrency('¥', 'CNY')).toBe(true)
  })
})

describe('«JP¥» y «CN¥»: el yen y el yuan como los escribe un iPhone de otra región (Fase 2 nativa)', () => {
  it('delante del importe, el prefijo decide la moneda; el «¥» suelto sigue siendo de las dos', () => {
    expect(stripCurrencyMark('JP¥1,200')).toEqual({ text: '1,200', mark: { code: 'JPY' } })
    expect(stripCurrencyMark('CN¥88.00')).toEqual({ text: '88.00', mark: { code: 'CNY' } })
    expect(stripCurrencyMark('CN￥ 88')).toEqual({ text: '88', mark: { code: 'CNY' } })
    expect(stripCurrencyMark('¥1,200')).toEqual({ text: '1,200', mark: { symbol: '¥' } })
    // Otras letras delante del «¥» no se interpretan: no hay más prefijos de yen conocidos.
    expect(stripCurrencyMark('XX¥5').mark).not.toEqual({ code: 'JPY' })
  })

  it('con la moneda del presupuesto, «JP¥» se lee como yen y nunca como otra', () => {
    expect(parseMoney('JP¥1,200', 'JPY', 'en-CA')).toEqual({ ok: true, minor: 1200 })
    expect(parseMoney('CN¥88.30', 'CNY', 'en-CA')).toEqual({ ok: true, minor: 8830 })
    const yuanInYen = parseMoney('CN¥88', 'JPY', 'en-CA')
    expect(yuanInYen.ok).toBe(false)
  })

  it('en texto libre (asistente, recibos) cuenta igual, pegado al importe y suelto', () => {
    expect(currencyMarksAround('ramen JP¥1200', 9, 13).map((m) => m.mark)).toEqual([{ code: 'JPY' }])
    expect(currencyMarksIn('taxi CN¥45 aeropuerto').map((m) => m.mark)).toEqual([{ code: 'CNY' }])
    expect(currencyMarksIn('taxi ¥45').map((m) => m.mark)).toEqual([{ symbol: '¥' }])
  })
})
