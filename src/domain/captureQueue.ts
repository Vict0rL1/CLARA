/**
 * Cola de capturas automáticas (Fase 2 nativa, decisión 157). Una acción de Atajos («Registrar pago en Clara») se
 * ejecuta sin la web cargada, así que el lado nativo solo AÑADE una línea JSON por pago a `captures.jsonl` y Clara la
 * interpreta al abrirse. Aquí está la parte pura de esa lectura: qué es una línea válida y qué importe dice. Nada de
 * esto guarda, convierte ni adivina: lo que no se entiende queda para revisar.
 *
 * Contrato de una línea (lo escribe el Swift tal cual; el Swift no calcula dinero, solo transporta texto):
 *   { "captureId": "…", "createdAt": "2026-12-20T03:14:15Z", "origin": "apple_pay",
 *     "rawAmount": "1200" | "¥1,200", "currencyHint": "JPY", "merchant": "…", "card": "…", "rawText": "…" }
 * - Con `currencyHint` (el código ISO 4217 que dé el sistema, p. ej. `IntentCurrencyAmount.currencyCode`),
 *   `rawAmount` es un decimal canónico con punto («1200», «12.5»): lo que da `Decimal.description` en Swift.
 * - Sin `currencyHint`, `rawAmount` es el texto que dio Atajos («CA$12.50», «¥1,200», «12,50 €») y se lee con el mismo
 *   lector de monedas de toda la app (`stripCurrencyMark`, `parseMoney`).
 */
import { currencyDigits, isSupportedCurrency, markMatchesCurrency, MAX_AMOUNT_MINOR, parseMoney, stripCurrencyMark } from './money'
import type { CaptureAmountRecord, CaptureOrigin, CurrencyCode } from './types'
import { CAPTURE_ORIGINS, CAPTURE_TEXT_MAX, LIMITS } from './validation'

export type { CaptureOrigin }

export interface CaptureRecord {
  captureId: string
  /** Marca de tiempo ISO en UTC de cuando el sistema avisó del pago. */
  createdAt: string
  origin: CaptureOrigin
  rawAmount: string
  currencyHint?: string
  merchant?: string
  card?: string
  /** Texto original (solo SMS o alertas); se guarda hasta que la persona confirme el movimiento. */
  rawText?: string
  /** «Probar» de Ajustes: recorre el mismo camino que un pago real y siempre queda como propuesta. */
  test?: true
}

export const CAPTURE_LIMITS = { id: 64, amount: 64, card: 64, rawText: CAPTURE_TEXT_MAX } as const

export type CaptureLineIssue = 'json' | 'shape' | 'captureId' | 'createdAt' | 'origin' | 'rawAmount' | 'currencyHint' | 'text' | 'duplicateId'

export interface CaptureQueueRead {
  records: CaptureRecord[]
  /** Líneas que no se pudieron leer (número de línea desde 1): se enseñan, nunca se borran solas. */
  issues: { line: number; issue: CaptureLineIssue }[]
  /** La última línea no terminaba en salto de línea y no se pudo leer: se está escribiendo; se lee la próxima vez. */
  partialTail: boolean
}

const ID = /^[A-Za-z0-9_-]{8,64}$/
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/
const CANONICAL_DECIMAL = /^\d{1,15}(\.\d{1,9})?$/

const isText = (v: unknown, max: number) => v === undefined || (typeof v === 'string' && v.length <= max)

function validRecord(raw: unknown): { ok: true; record: CaptureRecord } | { ok: false; issue: CaptureLineIssue } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, issue: 'shape' }
  const r = raw as Record<string, unknown>
  if (typeof r.captureId !== 'string' || !ID.test(r.captureId)) return { ok: false, issue: 'captureId' }
  if (typeof r.createdAt !== 'string' || !ISO_UTC.test(r.createdAt) || Number.isNaN(Date.parse(r.createdAt))) return { ok: false, issue: 'createdAt' }
  if (typeof r.origin !== 'string' || !(CAPTURE_ORIGINS as readonly string[]).includes(r.origin)) return { ok: false, issue: 'origin' }
  if (typeof r.rawAmount !== 'string' || r.rawAmount.trim() === '' || r.rawAmount.length > CAPTURE_LIMITS.amount) return { ok: false, issue: 'rawAmount' }
  if (r.currencyHint !== undefined && (typeof r.currencyHint !== 'string' || !/^[A-Za-z]{3}$/.test(r.currencyHint))) return { ok: false, issue: 'currencyHint' }
  if (!isText(r.merchant, LIMITS.nameMax * 4) || !isText(r.card, CAPTURE_LIMITS.card) || !isText(r.rawText, CAPTURE_LIMITS.rawText)) return { ok: false, issue: 'text' }
  if (r.test !== undefined && r.test !== true) return { ok: false, issue: 'shape' }
  const record: CaptureRecord = { captureId: r.captureId, createdAt: r.createdAt, origin: r.origin as CaptureOrigin, rawAmount: r.rawAmount }
  if (typeof r.currencyHint === 'string') record.currencyHint = r.currencyHint.toUpperCase()
  const merchant = typeof r.merchant === 'string' ? r.merchant.replace(/\s+/g, ' ').trim() : ''
  if (merchant) record.merchant = merchant.slice(0, LIMITS.nameMax)
  const card = typeof r.card === 'string' ? r.card.replace(/\s+/g, ' ').trim() : ''
  if (card) record.card = card
  if (typeof r.rawText === 'string' && r.rawText.trim()) record.rawText = r.rawText
  if (r.test === true) record.test = true
  return { ok: true, record }
}

/** Lee el archivo de la cola. Una línea mala no impide leer las demás; un id repetido cuenta una sola vez (la primera). */
export function readCaptureQueue(text: string): CaptureQueueRead {
  const out: CaptureQueueRead = { records: [], issues: [], partialTail: false }
  const seen = new Set<string>()
  const lines = text.split('\n')
  lines.forEach((rawLine, index) => {
    const line = rawLine.replace(/\r$/, '').trim()
    if (!line) return
    const isTail = index === lines.length - 1
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      if (isTail) out.partialTail = true
      else out.issues.push({ line: index + 1, issue: 'json' })
      return
    }
    const checked = validRecord(parsed)
    if (!checked.ok) {
      out.issues.push({ line: index + 1, issue: checked.issue })
      return
    }
    if (seen.has(checked.record.captureId)) {
      out.issues.push({ line: index + 1, issue: 'duplicateId' })
      return
    }
    seen.add(checked.record.captureId)
    out.records.push(checked.record)
  })
  return out
}

/**
 * Qué importe dice una captura respecto a la moneda del presupuesto (`CaptureAmountRecord`, el mismo que se guarda en
 * una propuesta): en la moneda del presupuesto; en otra conocida, sin convertir (`minor` en unidades menores de ESA
 * moneda); «¥» sin más, que puede ser yen o yuan y nunca se adivina; o sin entender (moneda desconocida, dos monedas
 * que se contradicen, número raro).
 */
export type CaptureAmount = CaptureAmountRecord

/** Las monedas que comparten un símbolo suelto y que una captura nunca elige sola. */
export const AMBIGUOUS_SYMBOLS: Readonly<Record<string, readonly string[]>> = { '¥': ['JPY', 'CNY'], '￥': ['JPY', 'CNY'] }

/** Un decimal canónico («1200», «12.5») en unidades menores de `currency`, sin flotantes. `null` si no cabe o sobra precisión. */
export function canonicalDecimalToMinor(text: string, currency: string): number | null {
  if (!CANONICAL_DECIMAL.test(text) || !isSupportedCurrency(currency)) return null
  const digits = currencyDigits(currency as CurrencyCode)
  const [whole, fraction = ''] = text.split('.')
  // Ceros de más al final no cambian el importe («12.500» con 2 decimales); otra cifra sí: no se redondea.
  const significant = fraction.replace(/0+$/, '')
  if (significant.length > digits) return null
  const minor = BigInt(whole!) * 10n ** BigInt(digits) + BigInt((significant || '0').padEnd(digits, '0'))
  if (minor <= 0n || minor > BigInt(MAX_AMOUNT_MINOR)) return null
  return Number(minor)
}

export function readCaptureAmount(record: Pick<CaptureRecord, 'rawAmount' | 'currencyHint'>, settings: { currency: string; numberLocale: string }): CaptureAmount {
  const raw = record.rawAmount.trim()
  const hint = record.currencyHint?.toUpperCase()
  if (hint && isSupportedCurrency(hint) && CANONICAL_DECIMAL.test(raw)) {
    const minor = canonicalDecimalToMinor(raw, hint)
    if (minor === null) return { kind: 'unreadable', text: raw }
    return hint === settings.currency ? { kind: 'budget', minor } : { kind: 'foreign', currency: hint, minor }
  }
  if (hint && !isSupportedCurrency(hint)) return { kind: 'unreadable', text: raw }
  const { text: amount, mark } = stripCurrencyMark(raw.replace(/[  ]/g, ' '))
  if (mark && ('unknown' in mark || 'conflict' in mark)) return { kind: 'unreadable', text: raw }
  // Un «¥» suelto en un presupuesto que no es de yenes ni de yuanes: no se sabe cuál de los dos.
  if (mark && 'symbol' in mark && AMBIGUOUS_SYMBOLS[mark.symbol] && !markMatchesCurrency(mark, settings.currency as CurrencyCode)) {
    return { kind: 'ambiguous', candidates: [...AMBIGUOUS_SYMBOLS[mark.symbol]!], text: raw }
  }
  if (!mark || markMatchesCurrency(mark, settings.currency as CurrencyCode)) {
    const parsed = parseMoney(amount, settings.currency as CurrencyCode, settings.numberLocale)
    return parsed.ok ? { kind: 'budget', minor: parsed.minor } : { kind: 'unreadable', text: raw }
  }
  // Otra moneda escrita con su código («US$12.50», «12 EUR») o un símbolo que solo puede ser una.
  const code = 'code' in mark ? mark.code : 'name' in mark && mark.codes.length === 1 ? mark.codes[0]! : 'symbol' in mark ? SINGLE_SYMBOL[mark.symbol] : undefined
  if (!code || !isSupportedCurrency(code)) return { kind: 'unreadable', text: raw }
  const parsed = parseMoney(amount, code as CurrencyCode, settings.numberLocale)
  return parsed.ok ? { kind: 'foreign', currency: code, minor: parsed.minor } : { kind: 'unreadable', text: raw }
}

/** Símbolos que solo pueden ser una moneda. «$» no está: es de muchas. */
const SINGLE_SYMBOL: Readonly<Record<string, string>> = { '€': 'EUR', '£': 'GBP', '₩': 'KRW', '₹': 'INR', '₽': 'RUB', '₺': 'TRY', '₪': 'ILS', '₱': 'PHP', '฿': 'THB', '₫': 'VND' }
