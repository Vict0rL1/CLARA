/**
 * Contrato del enlace externo a «nuevo movimiento» (L1), para Atajos de iPhone y similares:
 *
 *   #/movimientos/nuevo?kind=expense&importe=12.50&comercio=Starbucks&source=shortcut
 *
 * - `importe`: unidades MAYORES, en el formato que dé Atajos («12.50», «12,50», «C$12.50»,
 *   «1.234,56», «12 USD»…). Se lee con `parseMoney`; si no se entiende, el importe queda vacío y se
 *   dice (nunca se adivina). Si la moneda escrita no es la del presupuesto, se rellena el número tal
 *   cual y se avisa: nunca se convierte.
 * - `amount`: unidades MENORES, solo para enlaces internos (V4). No cambia. Si vienen los dos,
 *   manda `importe`.
 * - `comercio`: rellena el comercio y sugiere categoría (regla > aprendizaje > diccionario).
 * - `source=shortcut`: el movimiento se guarda con ese origen (filtros y CSV).
 * Nada de esto guarda: solo rellena el formulario, que la persona revisa.
 */
import { categoriesForKind } from './categories'
import { markLabel, markMatchesCurrency, parseMoney, stripCurrencyMark } from './money'
import { dictionaryCategory, learnCategories, parseText, significantWords } from './parser'
import { matchCategoryRule, normalizeText } from './rules'
import type { AppData, CurrencyCode, Language } from './types'
import { LIMITS } from './validation'

const SYMBOL: Record<string, string> = { '€': 'EUR', '£': 'GBP', '¥': 'JPY' }

export type ShortcutAmount = { ok: true; minor: number; foreignCurrency?: string } | { ok: false }

/**
 * Lee el importe de un atajo con el mismo lector de marcas de moneda que el resto de la app
 * (`stripCurrencyMark`, QA-05). Aquí una moneda distinta NO es un error: el formulario se rellena
 * con el número y avisa (`foreignCurrency`), porque nada se guarda sin que la persona revise.
 */
export function parseShortcutAmount(text: string, currency: string, numberLocale: string): ShortcutAmount {
  const { text: amount, mark } = stripCurrencyMark(text.replace(/[\u00a0\u202f]/g, ' '))
  if (mark && 'unknown' in mark) return { ok: false }
  const parsed = parseMoney(amount, currency as CurrencyCode, numberLocale)
  if (!parsed.ok) return { ok: false }
  // Cualquier marca que no pueda ser la moneda del presupuesto se avisa (RT-01): «€» se nombra EUR.
  if (!mark || markMatchesCurrency(mark, currency as CurrencyCode)) return { ok: true, minor: parsed.minor }
  return { ok: true, minor: parsed.minor, foreignCurrency: 'symbol' in mark ? (SYMBOL[mark.symbol] ?? mark.symbol) : markLabel(mark) }
}

export interface MovementLink {
  kind?: string
  /** Importe en unidades menores, si el enlace trajo uno que se entendió. */
  amountMinor?: number
  /** Vino `importe` pero no se entendió: el campo queda vacío y se avisa. */
  amountUnreadable: boolean
  /** El importe venía en otra moneda (se rellena sin convertir y se avisa). */
  foreignCurrency?: string
  merchant?: string
  fromShortcut: boolean
}

export function readMovementLink(query: { get(name: string): string | null }, settings: { currency: string; numberLocale: string }): MovementLink {
  const link: MovementLink = { amountUnreadable: false, fromShortcut: query.get('source') === 'shortcut' }
  const kind = query.get('kind')
  if (kind) link.kind = kind
  const importe = query.get('importe')
  const amount = query.get('amount')
  if (importe !== null) {
    const parsed = parseShortcutAmount(importe, settings.currency, settings.numberLocale)
    if (parsed.ok) {
      link.amountMinor = parsed.minor
      if (parsed.foreignCurrency) link.foreignCurrency = parsed.foreignCurrency
    } else link.amountUnreadable = true
  } else if (amount && /^\d+$/.test(amount)) {
    link.amountMinor = Number(amount)
  }
  const merchant = query.get('comercio')?.replace(/\s+/g, ' ').trim()
  if (merchant) link.merchant = merchant.slice(0, LIMITS.nameMax)
  return link
}

/** Categoría para un comercio: regla de la persona > aprendido de sus movimientos > diccionario. */
export function suggestCategoryForMerchant(
  merchant: string,
  kind: 'expense' | 'income',
  data: Pick<AppData, 'transactions' | 'categoryRules' | 'categories'> & Partial<Pick<AppData, 'categoryPrefs'>>,
): string | undefined {
  const rule = matchCategoryRule(merchant, kind, data.categoryRules, data.categories, data.categoryPrefs)
  if (rule) return rule.categoryId
  const allowed = new Set(categoriesForKind(kind, data.categories, { prefs: data.categoryPrefs }))
  const norm = normalizeText(merchant)
  const learned = learnCategories(data)
  for (const w of significantWords(norm)) {
    const id = learned[w]
    if (id && allowed.has(id)) return id
  }
  return dictionaryCategory(norm, kind, allowed)
}

/** Texto copiado por un atajo más largo que esto no se lee (no es una entrada de gasto). */
export const MAX_CLIPBOARD_CHARS = 2000

/**
 * L3 · Paso por el portapapeles: el atajo copia, por ejemplo, «Starbucks 12.50» y la persona toca
 * «Pegar del atajo». Devuelve el texto a analizar solo si contiene al menos un importe; si no, `null`
 * (se dice y no se crea nada). Lo que se registre después pasa por la vista previa del asistente.
 */
export function clipboardEntryText(text: string, ctx: { today: string; currency: string; language: Language }): string | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > MAX_CLIPBOARD_CHARS) return null
  const entries = parseText(trimmed, { today: ctx.today, currency: ctx.currency, language: ctx.language, categories: [] })
  return entries.some((e) => e.amountMinor !== null) ? trimmed : null
}
