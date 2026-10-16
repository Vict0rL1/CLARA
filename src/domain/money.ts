/**
 * Dinero en unidades menores enteras (centavos). Nunca se usa punto flotante
 * para sumar, restar o dividir importes.
 */
import type { CurrencyCode, NumberLocale } from './types'

export type CurrencyGroup = 'americas' | 'europe' | 'asiaPacific' | 'middleEastAfrica'

export interface CurrencyInfo {
  code: CurrencyCode
  /** Decimales fijos (tomados de CLDR al añadir la moneda). No se leen de Intl en tiempo de ejecución para que los datos guardados no cambien de significado. */
  digits: number
  group: CurrencyGroup
}

/** ≥ 45 monedas agrupadas por región (§7.7). Los nombres se muestran con `Intl.DisplayNames`. */
export const SUPPORTED_CURRENCIES: readonly CurrencyInfo[] = [
  { code: 'CAD', digits: 2, group: 'americas' },
  { code: 'USD', digits: 2, group: 'americas' },
  { code: 'MXN', digits: 2, group: 'americas' },
  /* 0 decimales como CLDR («$ 25.000»): los pesos colombianos se guardan enteros (decisión 16). */
  { code: 'COP', digits: 0, group: 'americas' },
  { code: 'PEN', digits: 2, group: 'americas' },
  { code: 'ARS', digits: 2, group: 'americas' },
  { code: 'CLP', digits: 0, group: 'americas' },
  { code: 'BRL', digits: 2, group: 'americas' },
  { code: 'UYU', digits: 2, group: 'americas' },
  { code: 'PYG', digits: 0, group: 'americas' },
  { code: 'BOB', digits: 2, group: 'americas' },
  { code: 'GTQ', digits: 2, group: 'americas' },
  { code: 'HNL', digits: 2, group: 'americas' },
  { code: 'NIO', digits: 2, group: 'americas' },
  { code: 'CRC', digits: 2, group: 'americas' },
  { code: 'PAB', digits: 2, group: 'americas' },
  { code: 'DOP', digits: 2, group: 'americas' },
  { code: 'EUR', digits: 2, group: 'europe' },
  { code: 'GBP', digits: 2, group: 'europe' },
  { code: 'CHF', digits: 2, group: 'europe' },
  { code: 'SEK', digits: 2, group: 'europe' },
  { code: 'NOK', digits: 2, group: 'europe' },
  { code: 'DKK', digits: 2, group: 'europe' },
  { code: 'PLN', digits: 2, group: 'europe' },
  { code: 'CZK', digits: 2, group: 'europe' },
  { code: 'HUF', digits: 0, group: 'europe' },
  { code: 'RON', digits: 2, group: 'europe' },
  { code: 'BGN', digits: 2, group: 'europe' },
  { code: 'ISK', digits: 0, group: 'europe' },
  { code: 'TRY', digits: 2, group: 'europe' },
  { code: 'UAH', digits: 2, group: 'europe' },
  { code: 'JPY', digits: 0, group: 'asiaPacific' },
  { code: 'CNY', digits: 2, group: 'asiaPacific' },
  { code: 'KRW', digits: 0, group: 'asiaPacific' },
  { code: 'INR', digits: 2, group: 'asiaPacific' },
  { code: 'AUD', digits: 2, group: 'asiaPacific' },
  { code: 'NZD', digits: 2, group: 'asiaPacific' },
  { code: 'SGD', digits: 2, group: 'asiaPacific' },
  { code: 'HKD', digits: 2, group: 'asiaPacific' },
  { code: 'TWD', digits: 2, group: 'asiaPacific' },
  { code: 'THB', digits: 2, group: 'asiaPacific' },
  { code: 'PHP', digits: 2, group: 'asiaPacific' },
  { code: 'IDR', digits: 0, group: 'asiaPacific' },
  { code: 'MYR', digits: 2, group: 'asiaPacific' },
  { code: 'VND', digits: 0, group: 'asiaPacific' },
  { code: 'PKR', digits: 0, group: 'asiaPacific' },
  { code: 'AED', digits: 2, group: 'middleEastAfrica' },
  { code: 'SAR', digits: 2, group: 'middleEastAfrica' },
  { code: 'ILS', digits: 2, group: 'middleEastAfrica' },
  { code: 'EGP', digits: 2, group: 'middleEastAfrica' },
  { code: 'ZAR', digits: 2, group: 'middleEastAfrica' },
  { code: 'NGN', digits: 2, group: 'middleEastAfrica' },
  { code: 'KES', digits: 2, group: 'middleEastAfrica' },
  { code: 'MAD', digits: 2, group: 'middleEastAfrica' },
  { code: 'QAR', digits: 2, group: 'middleEastAfrica' },
  { code: 'KWD', digits: 3, group: 'middleEastAfrica' },
]

/** Límite por importe individual: 10^12 unidades menores (10 000 millones de CAD). */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000

export function isSupportedCurrency(code: string): boolean {
  return SUPPORTED_CURRENCIES.some((c) => c.code === code)
}

export function currencyDigits(code: CurrencyCode): number {
  const info = SUPPORTED_CURRENCIES.find((c) => c.code === code)
  if (!info) throw new Error(`Moneda no soportada: ${code}`)
  return info.digits
}

export function isMinorAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

/** Suma enteros verificando que el resultado siga siendo exacto. */
export function sumMinor(values: Iterable<number>): number {
  let total = 0
  for (const v of values) {
    if (!Number.isSafeInteger(v)) throw new Error(`Importe no entero: ${v}`)
    total += v
    if (!Number.isSafeInteger(total)) throw new Error('Desbordamiento al sumar importes')
  }
  return total
}

/** División entera redondeando hacia abajo (también con negativos). */
export function floorDiv(a: number, b: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || b === 0) {
    throw new Error('floorDiv requiere enteros y divisor distinto de cero')
  }
  const A = BigInt(a)
  const B = BigInt(b)
  let q = A / B
  if ((A % B !== 0n) && ((A < 0n) !== (B < 0n))) q -= 1n
  return Number(q)
}

/** División entera redondeando hacia arriba (para cuotas de ahorro: así sí se llega a la meta). */
export function ceilDiv(a: number, b: number): number {
  return -floorDiv(-a, b)
}

/** Parte proporcional: floor(a * num / den) sin perder precisión. */
export function mulDivFloor(a: number, num: number, den: number): number {
  if (den === 0) throw new Error('Divisor cero')
  const A = BigInt(a) * BigInt(num)
  const B = BigInt(den)
  let q = A / B
  if ((A % B !== 0n) && ((A < 0n) !== (B < 0n))) q -= 1n
  return Number(q)
}

/** Convierte unidades menores a texto decimal exacto: 123456 → "1234.56". */
export function minorToDecimalString(minor: number, currency: CurrencyCode): string {
  const digits = currencyDigits(currency)
  const negative = minor < 0
  const abs = String(Math.abs(minor))
  if (digits === 0) return (negative ? '-' : '') + abs
  const padded = abs.padStart(digits + 1, '0')
  const intPart = padded.slice(0, padded.length - digits)
  const frac = padded.slice(padded.length - digits)
  return `${negative ? '-' : ''}${intPart}.${frac}`
}

const formatterCache = new Map<string, Intl.NumberFormat>()

function getFormatter(locale: string, currency: string, signDisplay: 'auto' | 'always' | 'exceptZero', compact: boolean) {
  const key = `${locale}|${currency}|${signDisplay}|${compact ? 'c' : ''}`
  let f = formatterCache.get(key)
  if (!f) {
    const digits = currencyDigits(currency)
    f = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      ...(compact ? { notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 } : { minimumFractionDigits: digits, maximumFractionDigits: digits }),
      signDisplay,
    })
    formatterCache.set(key, f)
  }
  return f
}

/** Lo que sustituye a las cifras en modo privado (el símbolo de la moneda se conserva). */
export const MASKED_DIGITS = '-----'

export interface FormatMoneyOptions {
  /** 'always' muestra "+" en positivos (útil para movimientos). */
  signDisplay?: 'auto' | 'always' | 'exceptZero'
  /** Modo privado: `$ -----` con el símbolo real de la moneda y en la posición del locale. */
  privacy?: boolean
  /** Notación compacta para espacios pequeños (`$1.3 M`). Solo para mostrar, nunca para calcular. */
  compact?: boolean
}

/**
 * Formatea sin pasar por flotantes: Intl recibe el texto decimal exacto. Es EL formateador de
 * dinero de toda la interfaz (§2 del master prompt): nada muestra importes por otra vía.
 */
export function formatMoney(
  minor: number,
  currency: CurrencyCode,
  locale: NumberLocale | string,
  options: FormatMoneyOptions = {},
): string {
  const formatter = getFormatter(locale, currency, options.signDisplay ?? 'auto', !!options.compact)
  const decimal = minorToDecimalString(minor, currency)
  if (options.privacy) {
    // Se conservan símbolo y literales del locale; las partes numéricas se reemplazan una vez.
    let masked = false
    return formatter
      .formatToParts(decimal as Intl.StringNumericLiteral)
      .map((part) => {
        if (part.type === 'currency' || part.type === 'literal' || part.type === 'minusSign' || part.type === 'plusSign') return part.value
        if (masked) return ''
        masked = true
        return MASKED_DIGITS
      })
      .join('')
  }
  return formatter.format(decimal as Intl.StringNumericLiteral)
}

/** Símbolo de la moneda en el locale (p. ej. «$», «€», «R$»). */
export function currencySymbol(currency: CurrencyCode, locale: NumberLocale | string): string {
  return getFormatter(locale, currency, 'auto', false)
    .formatToParts('0' as Intl.StringNumericLiteral)
    .find((p) => p.type === 'currency')?.value ?? currency
}

/** Separadores del formato elegido (por ejemplo es-ES usa "," para decimales). */
export function localeSeparators(locale: string): { decimal: string; group: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6)
  const decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.'
  const group = parts.find((p) => p.type === 'group')?.value ?? ','
  return { decimal, group }
}

/** Texto para un campo de edición (sin símbolo de moneda ni separador de miles). */
export function minorToInputString(minor: number, currency: CurrencyCode, locale: string): string {
  const { decimal } = localeSeparators(locale)
  return minorToDecimalString(minor, currency).replace('.', decimal)
}

/** "1,234,567" es válido; "12,3,4" no: tras el primer grupo, todos deben tener 3 dígitos. */
function validGrouping(value: string, sep: string): boolean {
  if (!value.includes(sep)) return true
  const groups = value.split(sep)
  const [first, ...rest] = groups
  return !!first && first.length >= 1 && first.length <= 3 && rest.every((g) => g.length === 3)
}

export type ParseMoneyError = 'empty' | 'invalid' | 'tooManyDecimals' | 'negativeNotAllowed' | 'tooLarge' | 'zero' | 'currencyMismatch' | 'unknownCurrency'

/** En `currencyMismatch` y `unknownCurrency`, `found` es la marca escrita y `expected` la moneda del presupuesto. */
export type ParseMoneyResult = { ok: true; minor: number } | { ok: false; error: ParseMoneyError; digits: number; found?: string; expected?: string }

/* ------------------------------------------------------------------ */
/* Marcas de moneda escritas junto al importe (QA-05)                   */
/* ------------------------------------------------------------------ */

/**
 * Lo que la persona (o un CSV) escribió junto al número: un código («USD 100», «12 EUR»), un
 * prefijo con dólar («CA$», «US$», «R$»), un símbolo suelto («€12», «12,50 €», «$ 45») o el nombre
 * de una moneda que puede ser varias («10 pesos»: `name` tal como se escribió y las monedas posibles).
 * `unknown` es un texto que parece un código pero no es una moneda admitida.
 */
export type CurrencyMark = { code: string } | { symbol: string } | { unknown: string } | { name: string; codes: readonly string[] }

/** Prefijos con dólar → moneda. */
const DOLLAR_PREFIX: Record<string, string> = { C: 'CAD', CA: 'CAD', CAN: 'CAD', US: 'USD', U: 'USD', MX: 'MXN', MEX: 'MXN', R: 'BRL', COL: 'COP', CO: 'COP', AU: 'AUD', NZ: 'NZD', AR: 'ARS', CL: 'CLP', UY: 'UYU', HK: 'HKD', SG: 'SGD', NT: 'TWD' }

function dollarMark(letters: string): CurrencyMark {
  const key = letters.toUpperCase()
  if (!key) return { symbol: '$' }
  return DOLLAR_PREFIX[key] ? { code: DOLLAR_PREFIX[key]! } : { unknown: `${key}$` }
}

/**
 * Códigos ISO 4217 vigentes. Solo sirven para RECONOCER una moneda escrita en un texto libre: una
 * moneda real que la app no admite («RUB 10») sigue siendo otra moneda, nunca la del presupuesto (RT-01).
 */
const ISO_4217 = new Set(
  ('AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP ' +
    'CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY ' +
    'KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK ' +
    'NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT ' +
    'TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWG').split(' '),
)

/**
 * Códigos admitidos que también son palabras corrientes en es/en/pt/fr («pen», «ron», «try», «mad»,
 * «ils», «bob»): en minúsculas no se leen como moneda en un texto libre; en MAYÚSCULAS sí, salvo en
 * un recibo, que va todo en mayúsculas («PEN 2.99» es un bolígrafo).
 */
const CODE_WORDS = new Set(['PEN', 'RON', 'TRY', 'MAD', 'ILS', 'BOB'])

const PESOS = ['MXN', 'COP', 'CLP', 'ARS', 'UYU', 'DOP', 'PHP'] as const
const RUPEES = ['INR', 'PKR', 'IDR'] as const

/**
 * Nombres de moneda (minúsculas, sin acentos) → la marca que representan. Solo nombres que no son
 * palabras corrientes: ni «libra»/«pound» sueltos (peso), ni «real», ni «franc» sueltos. `far` = se
 * reconoce también lejos del importe («paid in euros»); el resto, solo pegado a él.
 */
const CURRENCY_NAMES: ReadonlyMap<string, { mark: CurrencyMark; far: boolean }> = (() => {
  const map = new Map<string, { mark: CurrencyMark; far: boolean }>()
  const add = (words: string, mark: (word: string) => CurrencyMark, far: boolean) => {
    for (const w of words.split(',')) map.set(w, { mark: mark(w), far })
  }
  add('euro', () => ({ code: 'EUR' }), false)
  add('euros', () => ({ code: 'EUR' }), true)
  add('dollar,dolar', () => ({ symbol: '$' }), false)
  add('dollars,dolares', () => ({ symbol: '$' }), true)
  add('peso', (w) => ({ name: w, codes: PESOS }), false)
  add('pesos', (w) => ({ name: w, codes: PESOS }), true)
  add('yen,iene,yuan', (w) => ({ code: w === 'yuan' ? 'CNY' : 'JPY' }), false)
  add('yenes,ienes,yuanes', (w) => ({ code: w === 'yuanes' ? 'CNY' : 'JPY' }), true)
  add('reais', () => ({ code: 'BRL' }), true)
  add('rupee,rupia,roupie', (w) => ({ name: w, codes: RUPEES }), false)
  add('rupees,rupias,roupies', (w) => ({ name: w, codes: RUPEES }), true)
  add('libra esterlina,libras esterlinas,pound sterling,pounds sterling,livre sterling,livres sterling', () => ({ code: 'GBP' }), true)
  add('franco suizo,francos suizos,franco suico,francos suicos,swiss franc,swiss francs,franc suisse,francs suisses', () => ({ code: 'CHF' }), true)
  return map
})()

/**
 * Signos locales escritos con letras, tal cual (distinguen mayúsculas: «Ft» es el forinto y «ft» son
 * pies). Solo cuentan pegados al importe («10 kr», «1000 Ft», «Rp 1000»).
 */
const LOCAL_SIGNS: ReadonlyMap<string, CurrencyMark> = (() => {
  const map = new Map<string, CurrencyMark>()
  for (const w of ['kr', 'Kr', 'KR']) map.set(w, { name: 'kr', codes: ['SEK', 'NOK', 'DKK', 'ISK'] })
  for (const w of ['Rs', 'RS']) map.set(w, { name: 'Rs', codes: ['INR', 'PKR'] })
  const codes: Record<string, string> = { zł: 'PLN', Zł: 'PLN', Kč: 'CZK', Ft: 'HUF', lei: 'RON', Lei: 'RON', лв: 'BGN', TL: 'TRY', Bs: 'BOB', Rp: 'IDR', RM: 'MYR' }
  for (const [w, code] of Object.entries(codes)) map.set(w, { code })
  return map
})()

function nameKey(words: string): string {
  return words
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/** ¿Esa marca puede ser la moneda del presupuesto? Un código desconocido nunca lo es. */
export function markMatchesCurrency(mark: CurrencyMark, currency: CurrencyCode): boolean {
  if ('code' in mark) return mark.code === currency
  if ('symbol' in mark) return symbolMatchesCurrency(mark.symbol, currency)
  if ('name' in mark) return mark.codes.includes(currency)
  return false
}

/** Cómo se nombra la marca en un aviso: el código, el símbolo o el nombre tal como se escribió. */
export function markLabel(mark: CurrencyMark): string {
  return 'code' in mark ? mark.code : 'symbol' in mark ? mark.symbol : 'name' in mark ? mark.name : mark.unknown
}

/**
 * El texto de un campo «Importe» con la moneda escrita, de modo que `stripCurrencyMark` lea la
 * misma marca: códigos y nombres detrás («10.00 USD», «10.00 pesos»), símbolos delante («€10.00»).
 */
export function withCurrencyMark(amount: string, label: string): string {
  return /^(?:[A-Za-z]{0,3}\$|\p{Sc})$/u.test(label) ? `${label}${amount}` : `${amount} ${label}`
}

/** Opciones para leer marcas en un texto libre. */
export interface TextMarkOptions {
  /** Texto de un recibo (todo en mayúsculas): los códigos que son palabras y los ISO no admitidos no cuentan. */
  receipt?: boolean
}

/** Una marca de moneda encontrada en un texto libre y dónde está. */
export interface TextMark {
  mark: CurrencyMark
  start: number
  end: number
}

function codeMark(raw: string, options: TextMarkOptions): CurrencyMark | null {
  const code = raw.toUpperCase()
  const upper = raw === code
  if (isSupportedCurrency(code)) return CODE_WORDS.has(code) && (!upper || options.receipt) ? null : { code }
  return upper && !options.receipt && ISO_4217.has(code) ? { unknown: code } : null
}

function nameMark(words: string): { mark: CurrencyMark; far: boolean } | undefined {
  const local = LOCAL_SIGNS.get(words.trim())
  return CURRENCY_NAMES.get(nameKey(words)) ?? (local ? { mark: local, far: false } : undefined)
}

/**
 * Marcas de moneda pegadas (solo espacios entre medias) al importe que ocupa `[start, end)` de un
 * texto libre: delante («GBP 10», «US$10», «€ 10», «EUR ten») y detrás («10€», «10 gbp»,
 * «ten euros», «10 pounds sterling»). Mismas definiciones que `stripCurrencyMark` (RT-01).
 */
export function currencyMarksAround(text: string, start: number, end: number, options: TextMarkOptions = {}): TextMark[] {
  const out: TextMark[] = []
  const before = text.slice(0, start)
  const dollar = /(?<![\p{L}\p{N}])([A-Za-z]{1,3})\$\s*$/u.exec(before)
  const symbol = /(\p{Sc})\s*$/u.exec(before)
  const code = /(?<![\p{L}\p{N}])([A-Za-z]{3})\s*$/u.exec(before)
  const codeBefore = code ? codeMark(code[1]!, options) : null
  if (dollar) out.push({ mark: dollarMark(dollar[1]!), start: dollar.index, end: start })
  else if (symbol) out.push({ mark: { symbol: symbol[1]! }, start: symbol.index, end: start })
  else if (codeBefore) out.push({ mark: codeBefore, start: code!.index, end: start })
  else {
    const two = /(?<![\p{L}\p{N}])(\p{L}+\s+\p{L}+)\s*$/u.exec(before)
    const one = /(?<![\p{L}\p{N}])(\p{L}+)\s*$/u.exec(before)
    const found = (two && nameMark(two[1]!) ? two : null) ?? (one && nameMark(one[1]!) ? one : null)
    if (found) out.push({ mark: nameMark(found[1]!)!.mark, start: found.index, end: start })
  }
  const after = text.slice(end)
  const symbolAfter = /^\s*(\p{Sc})/u.exec(after)
  const codeAfter = /^\s*([A-Za-z]{3})(?![\p{L}\p{N}])/u.exec(after)
  const codeAfterMark = codeAfter ? codeMark(codeAfter[1]!, options) : null
  if (symbolAfter) out.push({ mark: { symbol: symbolAfter[1]! }, start: end, end: end + symbolAfter[0].length })
  else if (codeAfterMark) out.push({ mark: codeAfterMark, start: end, end: end + codeAfter![0].length })
  else {
    const two = /^\s*(\p{L}+\s+\p{L}+)(?![\p{L}\p{N}])/u.exec(after)
    const one = /^\s*(\p{L}+)(?![\p{L}\p{N}])/u.exec(after)
    const found = (two && nameMark(two[1]!) ? two : null) ?? (one && nameMark(one[1]!) ? one : null)
    if (found) out.push({ mark: nameMark(found[1]!)!.mark, start: end, end: end + found[0].length })
  }
  return out
}

/**
 * Marcas explícitas en cualquier parte de un texto libre, lejos del importe: símbolos, códigos
 * admitidos escritos en MAYÚSCULAS («coffee (USD) 10») y nombres en plural («paid in euros»). Lejos
 * del importe no cuentan los ISO no admitidos («AMD GPU 500» no es el dram). En un recibo solo los
 * símbolos (sus líneas van en mayúsculas y abrevian artículos).
 */
export function currencyMarksIn(text: string, options: TextMarkOptions = {}): TextMark[] {
  const out: TextMark[] = []
  for (const m of text.matchAll(/(?<![\p{L}\p{N}])([A-Za-z]{1,3})\$|\p{Sc}/gu)) {
    out.push({ mark: m[1] !== undefined ? dollarMark(m[1]) : { symbol: m[0] }, start: m.index!, end: m.index! + m[0].length })
  }
  if (options.receipt) return out.sort((a, b) => a.start - b.start)
  for (const m of text.matchAll(/(?<![\p{L}\p{N}])([A-Za-z]{3})(?![\p{L}\p{N}])/gu)) {
    const mark = m[1] === m[1]!.toUpperCase() ? codeMark(m[1]!, options) : null
    if (mark && 'code' in mark) out.push({ mark, start: m.index!, end: m.index! + 3 })
  }
  // Cada palabra, sola y junto a la siguiente («pounds sterling»): ninguna queda sin mirar.
  const words = [...text.matchAll(/(?<![\p{L}\p{N}])\p{L}+/gu)]
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    const next = words[i + 1]
    const pairEnd = next && /^\s+$/.test(text.slice(word.index! + word[0].length, next.index!)) ? next.index! + next[0].length : null
    const two = pairEnd === null ? undefined : nameMark(text.slice(word.index!, pairEnd))
    const found = two ?? nameMark(word[0])
    if (!found?.far) continue
    out.push({ mark: found.mark, start: word.index!, end: two ? pairEnd! : word.index! + word[0].length })
    if (two) i++
  }
  return out.sort((a, b) => a.start - b.start)
}

/**
 * Separa la marca de moneda del número: `text` queda listo para `parseScaled` (con su signo) y
 * `mark` dice qué moneda se escribió, si alguna. Nunca convierte ni decide: solo lee.
 */
export function stripCurrencyMark(input: string): { text: string; mark: CurrencyMark | null } {
  let s = input.trim().replace(/[   ]/g, ' ')
  let sign = ''
  if (/^[-−+]/.test(s)) {
    sign = s[0]!
    s = s.slice(1).trim()
  }
  let mark: CurrencyMark | null = null
  const setCode = (raw: string) => {
    const code = raw.toUpperCase()
    mark = isSupportedCurrency(code) ? { code } : { unknown: code }
  }
  // Nombre al final: «10 euros», «10.00 pesos», «10 pounds sterling» (RT-01).
  const named = /^(.*\d.*?)\s+(\p{L}+(?:\s+\p{L}+)?)$/u.exec(s)
  const name = named ? nameMark(named[2]!) : undefined
  // Código al final: «12 USD», «1.234,56 EUR» (una palabra entera: «dollars» no es «ARS»).
  const suffix = name ? null : /^(.*\d.*?)\s*(?<![A-Za-z])([A-Za-z]{3})$/.exec(s)
  if (name) {
    mark = name.mark
    s = named![1]!.trim()
  } else if (suffix) {
    setCode(suffix[2]!)
    s = suffix[1]!.trim()
  }
  // Prefijos: «CAD 12», «CA$12», «US$ 12», «$12», «€12». Un signo puede ir detrás («$-12»).
  const code = /^([A-Za-z]{3})\s*(?=[-−+]?[\d.,])/.exec(s)
  const dollar = /^([A-Za-z]{0,3})\$\s*/.exec(s)
  const symbol = /^(\p{Sc})\s*/u.exec(s)
  if (code) {
    if (!mark) setCode(code[1]!)
    s = s.slice(code[0].length)
  } else if (dollar) {
    const letters = dollar[1]!.toUpperCase()
    if (letters) mark ??= DOLLAR_PREFIX[letters] ? { code: DOLLAR_PREFIX[letters]! } : { unknown: `${letters}$` }
    else mark ??= { symbol: '$' }
    s = s.slice(dollar[0].length)
  } else if (symbol) {
    mark ??= { symbol: symbol[1]! }
    s = s.slice(symbol[0].length)
  } else {
    // Símbolo al final: «12,50 €», «45 $», «10 ₽».
    const trailing = /^(.*\d.*?)\s*(\p{Sc})$/u.exec(s)
    if (trailing) {
      mark ??= { symbol: trailing[2]! }
      s = trailing[1]!.trim()
    }
  }
  if (!sign && /^[-−+]/.test(s)) {
    sign = s[0]!
    s = s.slice(1).trim()
  }
  return { text: sign + s, mark }
}

/**
 * ¿Puede ese símbolo suelto ser el de la moneda del presupuesto? «$» vale para CAD, USD, MXN,
 * COP…; «€» solo para EUR; «¥» para JPY y CNY. Un símbolo que no puede ser el de la moneda es
 * una moneda distinta (QA-05): nunca se asume la del presupuesto.
 */
export function symbolMatchesCurrency(symbol: string, currency: CurrencyCode): boolean {
  return currencySymbol(currency, 'en').includes(symbol)
}

export interface ParseMoneyOptions {
  allowNegative?: boolean
  allowZero?: boolean
}

/**
 * Interpreta lo que escribe una persona: "12,50", "12.50", "1,234.56", "1.234,56", "$ 45".
 *
 * Reglas para decidir cuál es el separador decimal:
 * 1. Si aparecen "," y ".", el último que aparece es el decimal.
 * 2. Si aparece un solo tipo varias veces, es separador de miles ("1,234,567").
 * 3. Si aparece una sola vez seguido de exactamente 3 dígitos, se usa el formato
 *    elegido en Ajustes (o, si la moneda no tiene decimales, se toma como miles).
 * 4. En cualquier otro caso es el separador decimal ("12,5" = 12.50).
 */
export function parseMoney(
  input: string,
  currency: CurrencyCode,
  locale: string,
  options: ParseMoneyOptions = {},
): ParseMoneyResult {
  const digits = currencyDigits(currency)
  const { text, mark } = stripCurrencyMark(input)
  // QA-05: una moneda escrita que no es la del presupuesto se rechaza; nunca se convierte ni se asume.
  if (mark && !markMatchesCurrency(mark, currency)) {
    return { ok: false, error: 'unknown' in mark ? 'unknownCurrency' : 'currencyMismatch', digits, found: markLabel(mark), expected: currency }
  }
  return parseScaled(text, digits, locale, options)
}

/**
 * Porcentaje con hasta 2 decimales en puntos básicos: "19,99" → 1999.
 * Mismas reglas de separadores que los importes.
 */
export function parsePercentBps(input: string, locale: string): ParseMoneyResult {
  const r = parseScaled(input.replace('%', ''), 2, locale, { allowZero: true })
  if (r.ok && r.minor > 10000) return { ok: false, error: 'tooLarge', digits: 2 }
  return r
}

/** Texto editable de un porcentaje en puntos básicos: 1999 → "19.99". */
export function bpsToInputString(bps: number, locale: string): string {
  const { decimal } = localeSeparators(locale)
  const s = String(bps).padStart(3, '0')
  return `${s.slice(0, -2)}${decimal}${s.slice(-2)}`
}

function parseScaled(input: string, digits: number, locale: string, options: ParseMoneyOptions): ParseMoneyResult {
  const fail = (error: ParseMoneyError): ParseMoneyResult => ({ ok: false, error, digits })

  // Las marcas de moneda las separa `stripCurrencyMark` (quien llama decide si son válidas).
  let s = input.trim().replace(/[\s  '’]/g, '')
  if (s === '') return fail('empty')

  let negative = false
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = true
    s = s.slice(1)
  }
  if (s === '') return fail('invalid')
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return fail('invalid')
  if (negative && !options.allowNegative) return fail('negativeNotAllowed')

  const { decimal: localeDecimal } = localeSeparators(locale)
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  let decimalSep: '.' | ',' | null = null

  if (lastDot >= 0 && lastComma >= 0) {
    decimalSep = lastDot > lastComma ? '.' : ','
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ','
    const count = s.split(sep).length - 1
    if (count > 1) {
      decimalSep = null
    } else {
      const after = s.length - s.indexOf(sep) - 1
      if (after === 3) {
        decimalSep = digits > 0 && localeDecimal === sep ? sep : null
      } else {
        decimalSep = sep
      }
    }
  }

  let intPart: string
  let fracPart = ''
  if (decimalSep) {
    const idx = s.lastIndexOf(decimalSep)
    intPart = s.slice(0, idx)
    fracPart = s.slice(idx + 1)
    if (/[.,]/.test(fracPart)) return fail('invalid')
    const groupSep = decimalSep === '.' ? ',' : '.'
    if (intPart.includes(decimalSep)) return fail('invalid')
    if (!validGrouping(intPart, groupSep)) return fail('invalid')
    intPart = intPart.split(groupSep).join('')
  } else {
    const groupSep = s.includes('.') ? '.' : ','
    if (s.includes('.') && s.includes(',')) return fail('invalid')
    if (!validGrouping(s, groupSep)) return fail('invalid')
    intPart = s.split(groupSep).join('')
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return fail('invalid')
  if (intPart === '' && fracPart === '') return fail('invalid')
  if (fracPart.length > digits) return fail('tooManyDecimals')

  const normalized = (intPart === '' ? '0' : intPart) + fracPart.padEnd(digits, '0')
  const big = BigInt(normalized)
  if (big > BigInt(MAX_AMOUNT_MINOR)) return fail('tooLarge')
  const minor = Number(big) * (negative ? -1 : 1)
  if (minor === 0 && !options.allowZero) return fail('zero')
  return { ok: true, minor: minor === 0 ? 0 : minor }
}

/**
 * Agrupa los miles de lo que se escribe en un campo de importe (E2), con el formato elegido en
 * Ajustes: "1234567" → "1,234,567" (es-MX) o "1.234.567" (es-CO). Nunca cambia lo que el texto
 * significa:
 * - Un texto con otros caracteres (símbolos, letras), o que termina en separador (se está
 *   escribiendo), se devuelve tal cual.
 * - Si el texto anterior del campo (`previous`) ya tenía separadores de miles del formato, se está
 *   editando un número agrupado: esos separadores se quitan y se vuelve a agrupar.
 * - Si no, solo se agrupa un texto que `parseMoney` acepta, y solo si el resultado vale lo mismo.
 *   Un texto inválido («12.3.4», demasiados decimales) se deja como está para que se vea el error.
 * `caret` es la posición del cursor en el texto nuevo que corresponde a `caret` en el escrito.
 */
export function groupAmountInput(input: string, locale: string, currency: CurrencyCode, caret: number = input.length, previous?: string): { text: string; caret: number } {
  const same = { text: input, caret }
  const { decimal, group } = localeSeparators(locale)
  const m = /^(-?)([0-9.,\s\u00a0]*)$/.exec(input)
  if (!m || /[.,\s\u00a0]$/.test(input)) return same
  const sign = m[1] ?? ''
  const body = (m[2] ?? '').replace(/[\s\u00a0]/g, '')
  if (!/\d/.test(body)) return same
  const opts = { allowNegative: true, allowZero: true }
  const digits = currencyDigits(currency)
  let intDigits: string
  let fracDigits: string | null
  if (previous !== undefined && previous.includes(group)) {
    // Editando un número ya agrupado: los separadores de miles no cuentan.
    const stripped = body.split(group).join('')
    if (stripped.split(decimal).length > 2 || /[.,]/.test(stripped.replace(decimal, ''))) return same
    const at = stripped.indexOf(decimal)
    intDigits = at >= 0 ? stripped.slice(0, at) : stripped
    fracDigits = at >= 0 ? stripped.slice(at + 1) : null
  } else {
    const parsed = parseMoney(sign + body, currency, locale, opts)
    if (!parsed.ok) return same
    // Mismo criterio que parseMoney para saber qué separador es el decimal.
    const lastDot = body.lastIndexOf('.')
    const lastComma = body.lastIndexOf(',')
    const hasBoth = lastDot >= 0 && lastComma >= 0
    const at = hasBoth ? Math.max(lastDot, lastComma) : lastDot >= 0 ? lastDot : lastComma
    let isDecimal = at >= 0
    if (at >= 0 && !hasBoth) {
      const sep = body[at]!
      const count = body.split(sep).length - 1
      const after = body.length - at - 1
      isDecimal = !(count > 1 || after > 3 || (after === 3 && (sep === group || digits === 0)))
    }
    intDigits = (isDecimal ? body.slice(0, at) : body).replace(/[.,]/g, '')
    fracDigits = isDecimal ? body.slice(at + 1) : null
  }
  if (fracDigits !== null && (digits === 0 || fracDigits.length > digits)) return same
  const cleanInt = intDigits.replace(/^0+(?=\d)/, '')
  const text = sign + cleanInt.replace(/\B(?=(\d{3})+(?!\d))/g, group) + (fracDigits === null ? '' : decimal + fracDigits)
  // Comprobación final: el texto nuevo es válido y, si el anterior también lo era, vale lo mismo.
  const after = parseMoney(text, currency, locale, opts)
  if (!after.ok) return same
  if (previous === undefined || !previous.includes(group)) {
    const before = parseMoney(sign + body, currency, locale, opts)
    if (!before.ok || before.minor !== after.minor) return same
  }
  const significantBefore = input.slice(0, caret).replace(/[^0-9]/g, '').length
  let pos = sign.length
  let seen = 0
  while (pos < text.length && seen < significantBefore) {
    if (/\d/.test(text[pos]!)) seen++
    pos++
  }
  return { text, caret: Math.min(text.length, pos) }
}
