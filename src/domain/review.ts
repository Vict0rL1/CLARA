/**
 * Revisión única de propuestas de registro (etapa 2 del programa). Una propuesta viene de un
 * CSV del banco, de texto o voz del asistente o de la foto de un recibo; antes de guardarse,
 * todas pasan por las MISMAS comprobaciones: validación del formulario, posibles duplicados
 * (`duplicates.ts`), coincidencia con un pago programado abierto (misma regla que el formulario),
 * efecto sobre lo disponible (`txEffectOnBudgetPool`) y, si la categoría viene de una regla, cuál y
 * por qué. Aquí no se guarda nada: solo se calcula lo que la persona debe ver para decidir.
 *
 * Reintentos: cada propuesta lleva un id generado al abrir la vista previa, y `saveTransaction`
 * es idempotente por id, así que confirmar dos veces no duplica; una propuesta cuyo id ya está en
 * `transactions` se marca `alreadySaved` para que la interfaz lo diga en lugar de ocultarlo.
 */
import { txEffectOnBudgetPool } from './balances'
import { addDays } from './dates'
import { similarTransactions } from './duplicates'
import { openItemsUntil, type PlanItem } from './planItems'
import { explainRuleMatch, type RuleMatch } from './rules'
import type { AppData, LocalDate, Transaction } from './types'
import { validateTransaction, type Issue } from './validation'

export type ProposalSource = 'csv' | 'ai_text' | 'ai_voice' | 'ai_photo'

export interface Proposal {
  id: string
  source: ProposalSource
  kind: 'expense' | 'income'
  /** `null` cuando aún no hay importe (el asistente lo pide). */
  amountMinor: number | null
  date: LocalDate
  accountId: string
  categoryId?: string
  /** Texto con el que se buscan reglas y duplicados (descripción del banco o nota). */
  description?: string
  note?: string
  /**
   * Moneda escrita junto al importe (código o símbolo) cuando no es la del presupuesto. Bloquea la
   * propuesta: nunca se convierte ni se asume la del presupuesto (AS-01, igual que el CSV).
   */
  writtenCurrency?: string
}

export interface ProposalReview {
  id: string
  /** Sin errores de validación: se puede guardar tal cual. */
  ok: boolean
  issues: Issue[]
  alreadySaved: boolean
  duplicates: Transaction[]
  /** Pago o ingreso programado abierto que parece ser esta propuesta (la persona decide vincular). */
  scheduleMatch?: PlanItem
  /** Efecto sobre el saldo de las cuentas del presupuesto (0 si no hay importe válido). */
  effectMinor: number
  rule?: RuleMatch
}

export interface ReviewSummary {
  reviews: ProposalReview[]
  totalEffectMinor: number
  counts: { ok: number; issues: number; duplicates: number; scheduleMatches: number; alreadySaved: number }
}

/** Ventana de coincidencia con programados: la misma del formulario (14 días hacia delante, 45 atrás). */
export const SCHEDULE_MATCH_LOOKAHEAD_DAYS = 14
export const SCHEDULE_MATCH_LOOKBACK_DAYS = 45

const PLACEHOLDER_TS = '2000-01-01T00:00:00.000Z'

function scheduleCandidates(data: AppData, today: LocalDate): PlanItem[] {
  const since = addDays(today, -SCHEDULE_MATCH_LOOKBACK_DAYS)
  return openItemsUntil(data, today, addDays(today, SCHEDULE_MATCH_LOOKAHEAD_DAYS)).filter((i) => i.source === 'schedule' && i.date >= since)
}

/** Misma regla que la sugerencia del formulario: importe igual o misma categoría y fecha. */
export function matchSchedule(candidates: readonly PlanItem[], p: Pick<Proposal, 'kind' | 'amountMinor' | 'categoryId' | 'date'>): PlanItem | undefined {
  return candidates.find(
    (i) => i.direction === p.kind && ((p.amountMinor !== null && i.amountMinor === p.amountMinor) || (!!i.categoryId && i.categoryId === p.categoryId && i.date === p.date)),
  )
}

function reviewOne(data: AppData, p: Proposal, today: LocalDate, candidates: readonly PlanItem[]): ProposalReview {
  const issues: Issue[] = []
  const amountOk = p.amountMinor !== null && Number.isInteger(p.amountMinor) && p.amountMinor > 0
  const foreign = p.writtenCurrency && p.writtenCurrency !== data.settings.currency ? p.writtenCurrency : undefined
  if (foreign) issues.push({ path: 'amountMinor', code: 'writtenCurrency', params: { found: foreign, expected: data.settings.currency } })
  else if (p.amountMinor === null) issues.push({ path: 'amountMinor', code: 'required' })
  const draft: Transaction = {
    id: p.id,
    kind: p.kind,
    status: p.date > today ? 'planned' : 'realized',
    amountMinor: p.amountMinor ?? 1,
    currency: data.settings.currency,
    date: p.date,
    accountId: p.accountId,
    categoryId: p.categoryId,
    ...(p.note ? { note: p.note } : {}),
    createdAt: PLACEHOLDER_TS,
    updatedAt: PLACEHOLDER_TS,
  }
  for (const issue of validateTransaction(draft, { data, today })) {
    if (issue.path === 'amountMinor' && !amountOk) continue
    issues.push(issue)
  }
  if (data.accounts.find((a) => a.id === p.accountId)?.archived) issues.push({ path: 'accountId', code: 'accountArchived' })
  const alreadySaved = data.transactions.some((t) => t.id === p.id)
  const duplicates = amountOk ? similarTransactions(data, { id: p.id, kind: p.kind, accountId: p.accountId, amountMinor: p.amountMinor!, date: p.date, note: p.note }) : []
  const scheduleMatch = draft.status === 'realized' ? matchSchedule(candidates, p) : undefined
  const effectMinor = amountOk ? txEffectOnBudgetPool({ kind: p.kind, amountMinor: p.amountMinor!, accountId: p.accountId }, data.accounts) : 0
  const rule = explainRuleMatch(p.description ?? p.note, p.kind, data.categoryRules, data.categories, data.categoryPrefs)
  return {
    id: p.id,
    ok: issues.length === 0,
    issues,
    alreadySaved,
    duplicates,
    ...(scheduleMatch ? { scheduleMatch } : {}),
    effectMinor,
    ...(rule && rule.rule.categoryId === p.categoryId ? { rule } : {}),
  }
}

export function reviewProposal(data: AppData, p: Proposal, today: LocalDate): ProposalReview {
  return reviewOne(data, p, today, scheduleCandidates(data, today))
}

export function reviewProposals(data: AppData, proposals: readonly Proposal[], today: LocalDate): ReviewSummary {
  const candidates = scheduleCandidates(data, today)
  const reviews = proposals.map((p) => reviewOne(data, p, today, candidates))
  return {
    reviews,
    totalEffectMinor: reviews.reduce((sum, r) => sum + r.effectMinor, 0),
    counts: {
      ok: reviews.filter((r) => r.ok).length,
      issues: reviews.filter((r) => !r.ok).length,
      duplicates: reviews.filter((r) => r.duplicates.length > 0).length,
      scheduleMatches: reviews.filter((r) => !!r.scheduleMatch).length,
      alreadySaved: reviews.filter((r) => r.alreadySaved).length,
    },
  }
}
