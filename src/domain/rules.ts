/**
 * Reglas de categoría por descripción (ver docs/FORMULAS.md §10 e).
 *
 * Una regla solo PROPONE una categoría: al importar un CSV o al escribir la nota de
 * un movimiento nuevo. La persona siempre puede cambiarla. Nunca toca importes.
 */
import { categoriesForKind } from './categories'
import { merchantKey, merchantLabel } from './merchants'
import { normalizeText } from './text'
import type { AppData, CategoryRule, CustomCategory, Transaction, TxKind } from './types'

export const RULE_PATTERN_MIN = 2
export const RULE_PATTERN_MAX = 40

export { normalizeText } from './text'

/**
 * Regla que se aplica a una descripción. Si varias coinciden, gana el texto más
 * largo (el más específico: «uber eats» antes que «uber»); si empatan, la más antigua.
 * Se ignoran las reglas cuya categoría está archivada o ya no existe.
 */
export function matchCategoryRule(
  description: string | undefined,
  kind: 'expense' | 'income' | 'refund' | 'transfer',
  rules: readonly CategoryRule[],
  custom: readonly CustomCategory[] = [],
  prefs?: AppData['categoryPrefs'],
): CategoryRule | undefined {
  return explainRuleMatch(description, kind, rules, custom, prefs)?.rule
}

/**
 * Resolutor ÚNICO de reglas (explicación, revisión y asistente): de las reglas candidatas cuyo patrón
 * normalizado (≥ `RULE_PATTERN_MIN` caracteres) aparece en el texto ya normalizado, devuelve las que
 * coinciden ordenadas de ganadora a perdedora: patrón más largo primero; a igual longitud, la más
 * antigua (`createdAt`); sin fecha, se respeta el orden de la lista. Quien llama filtra antes el tipo
 * y las categorías utilizables.
 */
export function rankRuleMatches<R extends { pattern: string; createdAt?: string }>(normalizedText: string, candidates: readonly R[]): R[] {
  if (!normalizedText) return []
  const textKey = merchantKey(normalizedText)
  return candidates
    .map((rule, index) => ({ rule, index, pattern: normalizeText(rule.pattern) }))
    .filter((m) => m.pattern.length >= RULE_PATTERN_MIN && matches(normalizedText, textKey, m.pattern))
    .sort((a, b) => b.pattern.length - a.pattern.length || olderFirst(a.rule.createdAt, b.rule.createdAt) || a.index - b.index)
    .map((m) => m.rule)
}

/**
 * Clara 2.0 fase 2: una regla coincide si su texto está en la descripción tal cual (lo de siempre) o si
 * la clave de comercio del patrón está en la de la descripción («uber eats» ↔ «UBER *EATS 8XK2L»). Es un
 * superconjunto: nada que coincidía antes deja de coincidir.
 */
function matches(normalizedText: string, textKey: string, normalizedPattern: string): boolean {
  if (normalizedText.includes(normalizedPattern)) return true
  const patternKey = patternKeyOf(normalizedPattern)
  return patternKey.length >= RULE_PATTERN_MIN && textKey.includes(patternKey)
}

/** Igual que la decisión de `rankRuleMatches` para una sola regla (p. ej. «regla sin uso» en la bandeja). */
export function ruleMatchesText(normalizedText: string, pattern: string): boolean {
  const norm = normalizeText(pattern)
  return norm.length >= RULE_PATTERN_MIN && !!normalizedText && matches(normalizedText, merchantKey(normalizedText), norm)
}

const patternKeys = new Map<string, string>()
/** Clave de comercio de un patrón, en caché (una importación compara miles de filas con las mismas reglas). */
function patternKeyOf(normalizedPattern: string): string {
  let key = patternKeys.get(normalizedPattern)
  if (key === undefined) {
    if (patternKeys.size > 1000) patternKeys.clear()
    key = merchantKey(normalizedPattern)
    patternKeys.set(normalizedPattern, key)
  }
  return key
}

function olderFirst(a: string | undefined, b: string | undefined): number {
  if (!a || !b || a === b) return 0
  return a < b ? -1 : 1
}

/** Por qué ganó una regla: era la única que coincidía, la de patrón más largo, o la más antigua a igual longitud. */
export type RuleMatchReason = 'only' | 'longest' | 'oldest'

export interface RuleMatch {
  rule: CategoryRule
  reason: RuleMatchReason
  /** Las demás reglas que también coincidían (perdieron). */
  competitors: CategoryRule[]
}

/**
 * Misma decisión que `matchCategoryRule`, pero explicada: qué reglas coincidían y por qué ganó la
 * elegida. Regla fija: gana el patrón más largo (más específico); a igual longitud, la más antigua.
 */
export function explainRuleMatch(
  description: string | undefined,
  kind: 'expense' | 'income' | 'refund' | 'transfer',
  rules: readonly CategoryRule[],
  custom: readonly CustomCategory[] = [],
  prefs?: AppData['categoryPrefs'],
): RuleMatch | undefined {
  if (!description || kind === 'transfer') return undefined
  const wanted = kind === 'income' ? 'income' : 'expense'
  const text = normalizeText(description)
  if (!text) return undefined
  const usable = categoriesForKind(wanted, custom, { prefs })
  const sorted = rankRuleMatches(
    text,
    rules.filter((rule) => rule.kind === wanted && usable.includes(rule.categoryId)),
  )
  if (sorted.length === 0) return undefined
  const [best, ...competitors] = sorted as [CategoryRule, ...CategoryRule[]]
  const reason: RuleMatchReason =
    competitors.length === 0 ? 'only' : normalizeText(best.pattern).length > normalizeText(competitors[0]!.pattern).length ? 'longest' : 'oldest'
  return { rule: best, reason, competitors }
}

export interface RuleConflict {
  winner: CategoryRule
  loser: CategoryRule
  /** `longer`: el patrón del ganador contiene al del perdedor; `older`: patrones iguales, gana la más antigua. */
  reason: 'longer' | 'older'
}

/**
 * Reglas del mismo tipo con categorías distintas cuyos patrones se solapan (uno contiene al otro):
 * cuando una descripción contiene al más largo, coinciden las dos y la regla fija decide. Se enseña
 * en Ajustes › Reglas para que nadie se sorprenda; no se corrige sola.
 */
export function ruleConflicts(rules: readonly CategoryRule[]): RuleConflict[] {
  const out: RuleConflict[] = []
  for (const a of rules) {
    for (const b of rules) {
      if (a.id === b.id || a.kind !== b.kind || a.categoryId === b.categoryId) continue
      const pa = normalizeText(a.pattern)
      const pb = normalizeText(b.pattern)
      if (pa.length < RULE_PATTERN_MIN || pb.length < RULE_PATTERN_MIN) continue
      if (pa === pb) {
        if (a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id)) out.push({ winner: a, loser: b, reason: 'older' })
      } else if (pa.includes(pb)) {
        out.push({ winner: a, loser: b, reason: 'longer' })
      }
    }
  }
  return out.sort((x, y) => x.winner.pattern.localeCompare(y.winner.pattern) || x.loser.pattern.localeCompare(y.loser.pattern))
}

export interface RulePreview {
  /** Movimientos (del tipo de la regla) cuya nota o comercio contiene el patrón. */
  total: number
  /** De ellos, los que hoy tienen otra categoría (la regla NO los cambia: solo propone en registros nuevos). */
  withOtherCategory: number
  /** Los más recientes, para reconocerlos. */
  sample: Transaction[]
}

/** Qué movimientos ya registrados coinciden con un patrón: para probar una regla antes de guardarla. */
export function previewRule(data: Pick<AppData, 'transactions'>, pattern: string, kind: CategoryRule['kind'], categoryId: string, sampleSize = 5): RulePreview {
  const p = normalizeText(pattern)
  if (p.length < RULE_PATTERN_MIN) return { total: 0, withOtherCategory: 0, sample: [] }
  const kinds: TxKind[] = kind === 'income' ? ['income'] : ['expense', 'refund']
  const matches = data.transactions
    .filter((t) => kinds.includes(t.kind) && (normalizeText(t.note ?? '').includes(p) || normalizeText(t.merchant ?? '').includes(p)))
    .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : a.id < b.id ? -1 : 1))
  return { total: matches.length, withOtherCategory: matches.filter((t) => t.categoryId !== categoryId).length, sample: matches.slice(0, sampleSize) }
}

/** Regla que se PROPONE recordar tras corregir una categoría (Clara 2.0 §7). Nunca se guarda sola. */
export interface RuleSuggestion {
  pattern: string
  kind: 'expense' | 'income'
  categoryId: string
}

/**
 * Tras CORREGIR la categoría de un movimiento con descripción, ¿se puede ofrecer recordarla como regla?
 *
 * - Corrección = la categoría final es distinta de la que se proponía (`previousCategoryId`: la de la
 *   regla que se aplicó al escribir, o la que tenía el movimiento antes de editarlo).
 * - Texto usable: la descripción con espacios simples y sin prefijo de procesador ni códigos de referencia
 *   (`merchantLabel`), de `RULE_PATTERN_MIN` a `RULE_PATTERN_MAX` caracteres normalizados y con al menos
 *   una letra (un número suelto no es un comercio).
 * - Nunca con transferencias, ajustes ni compras divididas (una regla nunca pisa una división).
 * - La categoría final debe poder usarse (activa) y no debe existir ya una regla con ese mismo texto y tipo.
 * - La regla nueva tiene que GANAR para ese texto (patrón más largo); si no, ofrecerla sería engañoso.
 *
 * Solo devuelve la propuesta; guardarla es una operación aparte (`saveCategoryRule`) que la persona confirma.
 */
export function suggestRuleFromCorrection(
  data: Pick<AppData, 'categoryRules' | 'categories' | 'categoryPrefs'>,
  input: { note?: string; kind: TxKind; categoryId?: string; previousCategoryId?: string; hasSplits?: boolean },
): RuleSuggestion | null {
  if (input.kind !== 'expense' && input.kind !== 'income' && input.kind !== 'refund') return null
  if (input.hasSplits || !input.categoryId || !input.previousCategoryId || input.categoryId === input.previousCategoryId) return null
  // Fase 2: sin prefijo del procesador ni códigos de referencia («UBER *EATS 8XK2L» → «UBER EATS»),
  // que cambian en cada compra; si no queda nada, el texto tal cual.
  const raw = (input.note ?? '').replace(/\s+/g, ' ').trim()
  const pattern = merchantLabel(raw) || raw
  const norm = normalizeText(pattern)
  if (norm.length < RULE_PATTERN_MIN || pattern.length > RULE_PATTERN_MAX || !/\p{L}/u.test(norm)) return null
  const kind = input.kind === 'income' ? 'income' : 'expense'
  if (!categoriesForKind(kind, data.categories, { prefs: data.categoryPrefs }).includes(input.categoryId)) return null
  if (data.categoryRules.some((r) => r.kind === kind && normalizeText(r.pattern) === norm)) return null
  const candidate = { pattern, kind, categoryId: input.categoryId } as const
  const usable = categoriesForKind(kind, data.categories, { prefs: data.categoryPrefs })
  const ranked = rankRuleMatches(norm, [candidate, ...data.categoryRules.filter((r) => r.kind === kind && usable.includes(r.categoryId))])
  return ranked[0] === candidate ? { ...candidate } : null
}

/**
 * Varias correcciones a la vez (revisión del asistente): una propuesta por texto y tipo. Si dos líneas
 * corrigen el mismo texto a categorías distintas, no se propone ninguna de las dos (sería adivinar).
 * Solo propone; guardarlas es `saveCategoryRules`, que la persona confirma.
 */
export function suggestRulesFromCorrections(
  data: Pick<AppData, 'categoryRules' | 'categories' | 'categoryPrefs'>,
  inputs: readonly Parameters<typeof suggestRuleFromCorrection>[1][],
): RuleSuggestion[] {
  const byKey = new Map<string, RuleSuggestion | null>()
  for (const input of inputs) {
    const s = suggestRuleFromCorrection(data, input)
    if (!s) continue
    const key = `${s.kind}:${normalizeText(s.pattern)}`
    const prev = byKey.get(key)
    if (prev === undefined) byKey.set(key, s)
    else if (prev && prev.categoryId !== s.categoryId) byKey.set(key, null)
  }
  return [...byKey.values()].filter((s): s is RuleSuggestion => s !== null)
}
