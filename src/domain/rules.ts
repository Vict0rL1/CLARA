/**
 * Reglas de categoría por descripción (ver docs/FORMULAS.md §10 e).
 *
 * Una regla solo PROPONE una categoría: al importar un CSV o al escribir la nota de
 * un movimiento nuevo. La persona siempre puede cambiarla. Nunca toca importes.
 */
import { categoriesForKind } from './categories'
import type { AppData, CategoryRule, CustomCategory, Transaction, TxKind } from './types'

export const RULE_PATTERN_MIN = 2
export const RULE_PATTERN_MAX = 40

/** Minúsculas, sin acentos y con espacios simples: "  CAFÉ  Central " → "cafe central". */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

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
  const matching = rules.filter((rule) => {
    if (rule.kind !== wanted || !usable.includes(rule.categoryId)) return false
    const pattern = normalizeText(rule.pattern)
    return pattern.length >= RULE_PATTERN_MIN && text.includes(pattern)
  })
  if (matching.length === 0) return undefined
  const sorted = [...matching].sort((a, b) => normalizeText(b.pattern).length - normalizeText(a.pattern).length || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
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
