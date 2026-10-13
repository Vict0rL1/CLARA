/**
 * Revisión única de propuestas de registro (etapa 2 del programa). Una propuesta viene de un
 * CSV del banco, de texto o voz del asistente o de la foto de un recibo; antes de guardarse,
 * todas pasan por las MISMAS comprobaciones: validación del formulario, posibles duplicados
 * (`duplicates.ts`), coincidencia con un pago programado abierto (misma regla que el formulario),
 * efecto en el saldo de las cuentas (`txEffectOnBudgetPool`, solo lo realizado), lo disponible antes y
 * después (simulado sobre una copia con las mismas operaciones que al guardar) y, si la categoría
 * viene de una regla, cuál y por qué. Aquí no se guarda nada: solo se calcula lo que la persona debe
 * ver para decidir.
 *
 * Efecto en el saldo ≠ efecto en lo disponible: un pago vinculado a un programado ya reservado baja el
 * saldo pero libera su reserva (lo disponible no cambia), un movimiento con fecha futura no toca el
 * saldo de hoy y un ingreso futuro nunca suma a lo disponible. Por eso el «disponible» solo se muestra
 * cuando se ha calculado de verdad (`now`), nunca se deduce del importe.
 *
 * Reintentos: cada propuesta lleva un id generado al abrir la vista previa, y `saveTransaction`
 * es idempotente por id, así que confirmar dos veces no duplica; una propuesta cuyo id ya está en
 * `transactions` se marca `alreadySaved` para que la interfaz lo diga en lugar de ocultarlo.
 */
import { txEffectOnBudgetPool } from './balances'
import { computeBudget } from './budget'
import { addDays } from './dates'
import { similarTransactions } from './duplicates'
import { saveTransaction } from './operations'
import { openItemsUntil, type PlanItem } from './planItems'
import { explainRuleMatch, type RuleMatch } from './rules'
import type { AppData, LocalDate, Timestamp, Transaction } from './types'
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
  /** La persona marcó «Vincular» con el programado que coincide: se simula (y se guardará) como su pago. */
  linkToSchedule?: boolean
}

export interface ProposalReview {
  id: string
  kind: Proposal['kind']
  /** Sin errores de validación: se puede guardar tal cual. */
  ok: boolean
  issues: Issue[]
  alreadySaved: boolean
  duplicates: Transaction[]
  /** Pago o ingreso programado abierto que parece ser esta propuesta (la persona decide vincular). */
  scheduleMatch?: PlanItem
  /**
   * Efecto en el saldo de HOY de las cuentas del presupuesto: 0 si no hay importe válido, si la cuenta
   * no es del presupuesto o si la fecha es futura (queda como previsto). No es el efecto en lo disponible.
   */
  effectMinor: number
  /** Fecha futura: se guardará como previsto (un ingreso previsto nunca suma a lo disponible). */
  planned: boolean
  /**
   * Cambio EXACTO de lo disponible si solo se guardara esta propuesta con su vínculo (simulado sobre una
   * copia). Solo se calcula para propuestas vinculadas a un programado, donde difiere del saldo.
   */
  availableEffectMinor?: number
  rule?: RuleMatch
}

export interface ReviewSummary {
  reviews: ProposalReview[]
  /** Suma de los efectos en el saldo de hoy (`effectMinor`). */
  totalEffectMinor: number
  /**
   * Lo disponible antes y después de guardar todas las propuestas válidas, con sus vínculos, simulado
   * sobre una copia con `saveTransaction` y `computeBudget` (solo si se pasa `now`).
   */
  available?: { beforeMinor: number; afterMinor: number }
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

/** La transacción que se guardaría (para validar y simular): mismo borrador que el asistente y el CSV. */
function draftOf(data: AppData, p: Proposal, today: LocalDate, link: PlanItem | undefined): Transaction {
  return {
    id: p.id,
    kind: p.kind,
    status: p.date > today ? 'planned' : 'realized',
    amountMinor: p.amountMinor ?? 1,
    currency: data.settings.currency,
    date: p.date,
    accountId: p.accountId,
    categoryId: p.categoryId,
    ...(p.note ? { note: p.note } : {}),
    ...(link ? { scheduleId: link.sourceId, occurrenceDate: link.date } : {}),
    createdAt: PLACEHOLDER_TS,
    updatedAt: PLACEHOLDER_TS,
  }
}

/** Guarda la propuesta en una copia con la misma operación que al confirmar; `undefined` si no se guardaría. */
function simulateSave(data: AppData, draft: Transaction, today: LocalDate, now: Timestamp): AppData | undefined {
  const { createdAt: _c, updatedAt: _u, currency: _cur, ...rest } = draft
  const r = saveTransaction(data, rest, { today, now })
  return r.ok ? r.data : undefined
}

function reviewOne(data: AppData, p: Proposal, today: LocalDate, candidates: readonly PlanItem[], sim?: { now: Timestamp; beforeMinor: number }): ProposalReview {
  const issues: Issue[] = []
  const amountOk = p.amountMinor !== null && Number.isInteger(p.amountMinor) && p.amountMinor > 0
  const foreign = p.writtenCurrency && p.writtenCurrency !== data.settings.currency ? p.writtenCurrency : undefined
  if (foreign) issues.push({ path: 'amountMinor', code: 'writtenCurrency', params: { found: foreign, expected: data.settings.currency } })
  else if (p.amountMinor === null) issues.push({ path: 'amountMinor', code: 'required' })
  const planned = p.date > today
  const scheduleMatch = !planned ? matchSchedule(candidates, p) : undefined
  const link = p.linkToSchedule ? scheduleMatch : undefined
  const draft = draftOf(data, p, today, link)
  // Cero, negativo, con decimales o demasiado grande: los mismos errores que al guardar. Solo se
  // omiten cuando no hay importe (ya dice «falta») o la moneda escrita es otra (ya lo dice).
  for (const issue of validateTransaction(draft, { data, today })) {
    if (issue.path === 'amountMinor' && (p.amountMinor === null || foreign)) continue
    issues.push(issue)
  }
  if (data.accounts.find((a) => a.id === p.accountId)?.archived) issues.push({ path: 'accountId', code: 'accountArchived' })
  const ok = issues.length === 0
  const alreadySaved = data.transactions.some((t) => t.id === p.id)
  const duplicates = amountOk ? similarTransactions(data, { id: p.id, kind: p.kind, accountId: p.accountId, amountMinor: p.amountMinor!, date: p.date, note: p.note }) : []
  // Saldo de hoy: solo lo realizado. Un movimiento con fecha futura no lo cambia.
  const effectMinor = ok && amountOk && !planned ? txEffectOnBudgetPool({ kind: p.kind, amountMinor: p.amountMinor!, accountId: p.accountId }, data.accounts) : 0
  let availableEffectMinor: number | undefined
  if (sim && ok && link) {
    const after = simulateSave(data, draft, today, sim.now)
    if (after) availableEffectMinor = computeBudget(after, today).availableMinor - sim.beforeMinor
  }
  const rule = explainRuleMatch(p.description ?? p.note, p.kind, data.categoryRules, data.categories, data.categoryPrefs)
  return {
    id: p.id,
    kind: p.kind,
    ok,
    issues,
    alreadySaved,
    duplicates,
    ...(scheduleMatch ? { scheduleMatch } : {}),
    effectMinor,
    planned,
    ...(availableEffectMinor !== undefined ? { availableEffectMinor } : {}),
    ...(rule && rule.rule.categoryId === p.categoryId ? { rule } : {}),
  }
}

export interface ReviewOptions {
  /**
   * Instante con el que se simularía el guardado. Con él, la revisión calcula lo disponible antes y
   * después de verdad (y por propuesta vinculada); sin él, solo el efecto en el saldo.
   */
  now?: Timestamp
}

export function reviewProposal(data: AppData, p: Proposal, today: LocalDate, options: ReviewOptions = {}): ProposalReview {
  return reviewProposals(data, [p], today, options).reviews[0]!
}

export function reviewProposals(data: AppData, proposals: readonly Proposal[], today: LocalDate, options: ReviewOptions = {}): ReviewSummary {
  const candidates = scheduleCandidates(data, today)
  const beforeMinor = options.now ? computeBudget(data, today).availableMinor : 0
  const sim = options.now ? { now: options.now, beforeMinor } : undefined
  const reviews = proposals.map((p) => reviewOne(data, p, today, candidates, sim))
  let available: ReviewSummary['available']
  if (sim) {
    // Todas las propuestas válidas, en orden y con sus vínculos, igual que al confirmar.
    let next: AppData | undefined = data
    proposals.forEach((p, i) => {
      const r = reviews[i]!
      if (!next || !r.ok) return
      const link = p.linkToSchedule ? r.scheduleMatch : undefined
      next = simulateSave(next, draftOf(next, p, today, link), today, sim.now)
    })
    if (next) available = { beforeMinor, afterMinor: computeBudget(next, today).availableMinor }
  }
  return {
    reviews,
    totalEffectMinor: reviews.reduce((sum, r) => sum + r.effectMinor, 0),
    ...(available ? { available } : {}),
    counts: {
      ok: reviews.filter((r) => r.ok).length,
      issues: reviews.filter((r) => !r.ok).length,
      duplicates: reviews.filter((r) => r.duplicates.length > 0).length,
      scheduleMatches: reviews.filter((r) => !!r.scheduleMatch).length,
      alreadySaved: reviews.filter((r) => r.alreadySaved).length,
    },
  }
}
