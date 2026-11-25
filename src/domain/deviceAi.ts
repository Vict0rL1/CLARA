/**
 * La IA del propio iPhone (Foundation Models, iOS 26 o posterior; Fase 5, decisión 189): una AYUDA opcional para
 * convertir texto desordenado (o el de un recibo) en propuestas del asistente. Nunca envía nada fuera, nunca guarda
 * sola y no decide importes por su cuenta. Aquí se comprueba TODO lo que devuelve; si algo no cuadra, manda el
 * analizador de siempre (`parser.ts`, `receipt.ts`).
 *
 * Reglas:
 * - Cada propuesta tiene que citar el trozo LITERAL del texto del que sale (`fragment`). Un trozo que no está en el
 *   texto es una invención: esa propuesta se descarta.
 * - El importe sale del analizador local leyendo ese trozo (con sus monedas: otra moneda queda escrita y bloquea la
 *   línea, como siempre). Solo si el analizador no encuentra ninguno se usa el de la IA, y solo escrito como decimal
 *   canónico («4.50»): esa propuesta lleva poca confianza y la etiqueta de la IA, para que la persona lo compruebe.
 * - Fecha, categoría y tipo de la IA solo si son válidos (fecha de hasta un año atrás y no futura; categoría activa del
 *   tipo). Las reglas y lo aprendido de la persona siempre ganan.
 * - Si la IA propone MENOS movimientos que el analizador de siempre, se usa el de siempre: la IA no puede hacer que se
 *   pierda una línea.
 */
import { addDays, isValidLocalDate } from './dates'
import { canonicalDecimalToMinor } from './captureQueue'
import { parseEntry, parseText, type ParseContext, type ParsedEntry } from './parser'
import { amountsInLine } from './receipt'
import { currencyDigits } from './money'
import { normalizeText } from './text'
import type { CurrencyCode, LocalDate } from './types'

/** Como mucho tantas propuestas por respuesta (el asistente analiza hasta 200 líneas, pero la IA va por tandas). */
export const DEVICE_AI_ENTRIES_MAX = 50
const FRAGMENT_MAX = 500
const DESCRIPTION_MAX = 120
const MERCHANT_MAX = 60

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined
  const s = v.replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : undefined
}

/** El trozo citado está tal cual en el texto (sin distinguir mayúsculas, acentos ni espacios). */
function quotes(source: string, fragment: string): number {
  return normalizeText(source).indexOf(normalizeText(fragment))
}

function validDate(v: unknown, today: LocalDate): LocalDate | undefined {
  return isValidLocalDate(v) && v <= today && v >= addDays(today, -366) ? v : undefined
}

/**
 * Las propuestas de la IA para `source`, comprobadas una a una; `null` si la respuesta no tiene la forma esperada o
 * ninguna propuesta cita el texto (entonces se usa el analizador de siempre).
 */
export function entriesFromDeviceAi(raw: unknown, source: string, ctx: ParseContext): ParsedEntry[] | null {
  const list = raw && typeof raw === 'object' ? (raw as { entries?: unknown }).entries : undefined
  if (!Array.isArray(list) || list.length === 0 || list.length > DEVICE_AI_ENTRIES_MAX) return null
  const found: { at: number; entry: ParsedEntry }[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const fragment = text(r.fragment, FRAGMENT_MAX)
    if (!fragment) continue
    const at = quotes(source, fragment)
    if (at < 0) continue
    const local = parseEntry(fragment, ctx)
    let amountMinor = local.amountMinor
    let confidence = Math.max(local.confidence, 0.5)
    if (amountMinor === null) {
      const fromAi = typeof r.amount === 'string' ? canonicalDecimalToMinor(r.amount.trim(), ctx.currency) : null
      if (fromAi !== null) {
        amountMinor = fromAi
        confidence = 0.3
      } else confidence = local.confidence
    }
    const kind = local.kind === 'transfer' ? 'transfer' : r.kind === 'income' || r.kind === 'expense' ? r.kind : local.kind
    const own = local.hints.includes('categoryRule') || local.hints.includes('categoryLearned')
    const allowed = new Set(ctx.categories.filter((c) => c.kind === kind).map((c) => c.id))
    const aiCategory = typeof r.category === 'string' && allowed.has(r.category) ? r.category : undefined
    const categoryId = own ? local.categoryId : (aiCategory ?? (local.categoryId && allowed.has(local.categoryId) ? local.categoryId : undefined))
    const date = local.hints.includes('dateDetected') ? local.date : (validDate(r.date, ctx.today) ?? local.date)
    const merchant = local.merchant ?? text(r.merchant, MERCHANT_MAX)
    const entry: ParsedEntry = {
      ...local,
      kind,
      amountMinor,
      description: text(r.description, DESCRIPTION_MAX) ?? local.description,
      ...(merchant ? { merchant } : {}),
      date,
      confidence: Math.round(Math.min(confidence, 0.85) * 100) / 100,
      suggestedBy: 'deviceAi',
    }
    if (categoryId) entry.categoryId = categoryId
    else delete entry.categoryId
    found.push({ at, entry })
  }
  if (found.length === 0) return null
  return found.sort((a, b) => a.at - b.at).map((f) => f.entry)
}

export type AssistantEntries = { entries: ParsedEntry[]; by: 'deviceAi' } | { entries: ParsedEntry[]; by: 'local'; reason: 'aiFailed' | 'aiFewer' }

/** Qué se enseña: lo de la IA si es válido y no propone menos movimientos que el analizador de siempre. */
export function chooseEntries(raw: unknown, source: string, ctx: ParseContext): AssistantEntries {
  const local = parseText(source, ctx)
  const ai = entriesFromDeviceAi(raw, source, ctx)
  if (!ai) return { entries: local, by: 'local', reason: 'aiFailed' }
  if (ai.length < local.length) return { entries: local, by: 'local', reason: 'aiFewer' }
  return { entries: ai, by: 'deviceAi' }
}

/**
 * Para un recibo que el lector de siempre no entendió del todo: el total que propone la IA, solo si cita la línea del
 * recibo donde está (`fragment`) y ese importe está de verdad en esa línea. Fecha y comercio, con las mismas reglas.
 */
export function receiptFromDeviceAi(raw: unknown, ocrText: string, ctx: ParseContext): { totalMinor: number; date?: LocalDate; merchant?: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const fragment = text(r.fragment, FRAGMENT_MAX)
  if (!fragment || typeof r.total !== 'string' || quotes(ocrText, fragment) < 0) return null
  const total = canonicalDecimalToMinor(r.total.trim(), ctx.currency)
  if (total === null || !amountsInLine(fragment, currencyDigits(ctx.currency as CurrencyCode)).includes(total)) return null
  const date = validDate(r.date, ctx.today)
  const merchant = text(r.merchant, MERCHANT_MAX)
  return { totalMinor: total, ...(date ? { date } : {}), ...(merchant ? { merchant } : {}) }
}
