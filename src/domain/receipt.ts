/**
 * Recibos (§8): a partir del texto reconocido en una foto (OCR en el dispositivo) se extraen el
 * total (la cifra junto a «total»/«importe»/«amount due»; si no, la mayor), la fecha, el comercio
 * (primeras líneas en mayúsculas) y una categoría sugerida por el comercio. Solo propone: la
 * persona revisa y confirma en la vista previa del asistente. Sin texto no se inventa nada.
 */
import { isValidLocalDate, toLocalDate } from './dates'
import { parseEntry, type ParseContext } from './parser'
import { currencyDigits, currencyMarksAround, currencyMarksIn, markLabel, markMatchesCurrency, reconcileMarks, type TextMark } from './money'
import type { LocalDate } from './types'

export interface ReceiptResult {
  totalMinor: number | null
  date: LocalDate | null
  merchant: string | null
  categoryId: string | null
  /** 0–1: cuántas de las tres piezas (total, fecha, comercio) se encontraron y cómo. */
  confidence: number
  /** Importes vistos, de mayor a menor (para ofrecer alternativas). */
  amountsMinor: number[]
  /**
   * Moneda impresa que no es la del presupuesto («12,50 €», «GBP 18.20» en CAD): el total se
   * propone con ella escrita y la línea queda bloqueada hasta corregirla. Nunca se convierte (RT-01).
   */
  foreignCurrency?: string
  /** Dos monedas distintas impresas en el recibo («TOTAL USD 10.00» y «CASH PEN 37.00»): tampoco se elige una (QA V2). */
  currencyConflict?: readonly [string, string]
}

const TOTAL_WORDS = /\b(total|importe|monto|amount\s*due|amount|montant|a\s*pagar|to\s*pay|à\s*payer|valor|sum[a]?)\b/i
const NOT_TOTAL = /\b(sub\s*-?total|iva|tax|tip|propina|cambio|change|vuelto|descuento|discount|efectivo|cash|tarjeta|card|pts?|puntos|points)\b/i
/** Pago y cobro (además de los de `NOT_TOTAL`): en estas líneas, un código junto al importe es la moneda. */
const TENDER_WORDS = /\b(visa|mastercard|amex|d[eé]bito|debit|cr[eé]dito|credit|pago|paid|payment|tendered|troco|dinheiro|esp[eè]ces|monnaie|rendu|igv)\b/i
const AMOUNT = /(?<![\d,.])(\d{1,3}(?:[.,\s]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?![\d])/g

function toMinor(whole: string, frac: string | undefined, digits: number): number | null {
  const w = Number(whole.replace(/[.,\s]/g, ''))
  if (!Number.isSafeInteger(w)) return null
  const f = frac ?? ''
  if (digits === 0) return frac !== undefined ? null : w
  const fracNum = Number((f + '00').slice(0, digits))
  return w * 10 ** digits + fracNum
}

/** Importes de una línea en unidades menores (sin signo). Un número de 4+ cifras sin separador se lee entero. */
export function amountsInLine(line: string, digits: number): number[] {
  const out: number[] = []
  // Horas («12:30», «18:02:55») fuera: no son importes.
  const cleaned = line.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
  for (const m of cleaned.matchAll(AMOUNT)) {
    const whole = m[1]!
    const frac = m[2]
    // «12/10/2026» y horas «12:30» no son importes; ya no coinciden por el patrón, pero un año suelto sí: se descarta 1900–2099 sin decimales.
    if (frac === undefined && /^(19|20)\d{2}$/.test(whole)) continue
    const minor = toMinor(whole, frac, digits)
    if (minor !== null && minor > 0) out.push(minor)
  }
  return out
}

const DATE_PATTERNS: { re: RegExp; build: (m: RegExpMatchArray) => LocalDate | null }[] = [
  { re: /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/, build: (m) => safeDate(Number(m[1]), Number(m[2]), Number(m[3])) },
  { re: /\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b/, build: (m) => safeDate(Number(m[3]!.length === 2 ? `20${m[3]}` : m[3]), Number(m[2]), Number(m[1])) },
]

function safeDate(y: number, mo: number, d: number): LocalDate | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const date = toLocalDate(y, mo, d)
  return isValidLocalDate(date) ? date : null
}

export function dateInText(text: string, today: LocalDate): LocalDate | null {
  for (const { re, build } of DATE_PATTERNS) {
    const m = text.match(re)
    if (m) {
      const d = build(m)
      // Un recibo no es del futuro: una fecha posterior a hoy se ignora (OCR dudoso).
      if (d && d <= today) return d
    }
  }
  return null
}

/** Primera línea «de cabecera»: mayúsculas (o capitalizada), con letras, sin importes ni palabras de total. */
export function merchantInLines(lines: readonly string[]): string | null {
  for (const raw of lines.slice(0, 6)) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (line.length < 3 || line.length > 40) continue
    if (!/[A-Za-zÀ-ÿ]{3,}/.test(line)) continue
    if (AMOUNT.test(line) || TOTAL_WORDS.test(line) || /\b(tel|rfc|nit|cuit|ruc|fecha|date|ticket|folio|caja|cajero|iva)\b/i.test(line)) {
      AMOUNT.lastIndex = 0
      continue
    }
    AMOUNT.lastIndex = 0
    const letters = line.replace(/[^A-Za-zÀ-ÿ]/g, '')
    const upper = letters.replace(/[^A-ZÀ-Ý]/g, '').length
    if (upper / Math.max(1, letters.length) >= 0.6 || /^[A-ZÀ-Ý][a-zà-ÿ]+( [A-ZÀ-Ý][a-zà-ÿ]+)*$/.test(line)) {
      return line.replace(/[*#_=|]+/g, '').trim()
    }
  }
  return null
}

export function parseReceiptText(text: string, ctx: ParseContext): ReceiptResult {
  const digits = currencyDigits(ctx.currency)
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const amounts: number[] = []
  let total: number | null = null
  let totalScore = 0
  for (const line of lines) {
    const found = amountsInLine(line, digits)
    amounts.push(...found)
    if (found.length === 0) continue
    if (TOTAL_WORDS.test(line) && !NOT_TOTAL.test(line)) {
      const candidate = Math.max(...found)
      // Si hay varias líneas «total», gana la de mayor importe (el gran total suele ir al final y ser el mayor).
      const score = 2 + (/\b(gran|grand)\b/i.test(line) ? 1 : 0)
      if (score > totalScore || (score === totalScore && total !== null && candidate > total)) {
        total = candidate
        totalScore = score
      }
    }
  }
  const sorted = [...new Set(amounts)].sort((a, b) => b - a)
  if (total === null && sorted.length > 0) total = sorted[0]!
  // Todas las monedas impresas, en orden de lectura, unidas como en un importe (QA V2, CUR-03).
  const mark = reconcileMarks(lines.flatMap(receiptMarks).map((m) => m.mark))
  const written: Pick<ReceiptResult, 'foreignCurrency' | 'currencyConflict'> =
    !mark || markMatchesCurrency(mark, ctx.currency) ? {} : 'conflict' in mark ? { currencyConflict: [markLabel(mark.conflict[0]), markLabel(mark.conflict[1])] } : { foreignCurrency: markLabel(mark) }
  const date = dateInText(text, ctx.today)
  const merchant = merchantInLines(lines)
  const category = merchant ? parseEntry(merchant, ctx) : null
  const categoryId = category && category.hints.some((h) => h === 'categoryDictionary' || h === 'categoryLearned' || h === 'categoryRule') ? (category.categoryId ?? null) : null
  const confidence = (total !== null ? (totalScore > 0 ? 0.5 : 0.3) : 0) + (date ? 0.25 : 0) + (merchant ? 0.25 : 0)
  return { totalMinor: total, date, merchant, categoryId, confidence, amountsMinor: sorted, ...written }
}

/**
 * Monedas impresas en una línea del recibo: pegadas a un importe o un símbolo suelto. En una línea de
 * total, subtotal, impuestos, propina o pago, un código junto al importe es la moneda aunque sea una
 * palabra («TOTAL PEN 10.00») o una moneda que la app no admite («TOTAL RUB 10.00»): QA V2, CUR-03. En
 * una línea de artículo no («PEN 2.99» es un bolígrafo).
 */
function receiptMarks(line: string): TextMark[] {
  const money = TOTAL_WORDS.test(line) || NOT_TOTAL.test(line) || TENDER_WORDS.test(line)
  const options = { receipt: !money }
  const out = currencyMarksIn(line, options)
  for (const m of line.matchAll(AMOUNT)) out.push(...currencyMarksAround(line, m.index!, m.index! + m[0].length, options))
  return out.sort((a, b) => a.start - b.start)
}
