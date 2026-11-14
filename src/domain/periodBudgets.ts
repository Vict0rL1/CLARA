/**
 * Presupuestos por periodo: semestre, viaje o periodo personalizado (ver docs/FORMULAS.md §19).
 *
 *   Gastado    = Σ gastos realizados asociados − Σ devoluciones realizadas asociadas
 *                (las devoluciones de un gasto asociado cuentan aunque no se asocien)
 *   Restante   = asignado − gastado  (negativo = excedido)
 *   Por día    = floor(restante / días que quedan, contando hoy y el último día)
 *   Por semana = floor(restante × min(7, días) / días)
 *
 * ASIGNAR no mueve, ingresa ni reserva dinero: es un límite para organizarse. Solo
 * «Reservar dinero» (una meta del presupuesto vinculada) descuenta del disponible, y
 * lo gastado en el periodo va consumiendo esa reserva (`reserves.ts`).
 */
import { computeBudget } from './budget'
import { addDays, daysBetween } from './dates'
import { newId } from './ids'
import { floorDiv, mulDivFloor, sumMinor } from './money'
import { allocateToGoal, saveGoal, type OpContext, type OpResult } from './operations'
import { periodTransactions } from './reserves'
import type { AppData, Goal, LocalDate, PeriodBudget, PeriodTemplate, Transaction, TripSettings } from './types'
import { validatePeriodBudget, type Issue } from './validation'

const fail = (issues: Issue[]): { ok: false; issues: Issue[] } => ({ ok: false, issues })
const touch = (data: AppData, now: string): AppData => ({ ...data, updatedAt: now })

export type PeriodStatus = 'upcoming' | 'active' | 'ended'

export interface PeriodSummaryResult {
  budget: PeriodBudget
  status: PeriodStatus
  /** Movimientos vivos asociados (incluye devoluciones de gastos asociados). */
  transactions: Transaction[]
  spentMinor: number
  /** Gastos PREVISTOS asociados (aún no gastados). */
  plannedMinor: number
  remainingMinor: number
  totalDays: number
  /** Días que quedan (contando hoy y el último día). 0 si terminó. */
  daysLeft: number
  perDayMinor: number | null
  perWeekMinor: number | null
  /** Asociados con fecha fuera del periodo (cuentan: la persona los asoció a propósito). */
  outsideRange: Transaction[]
  /** Asociados que también pertenecen a otro presupuesto. */
  shared: Transaction[]
  /** Asociados que están en la papelera (no cuentan). */
  trashedCount: number
}

export function periodStatus(budget: PeriodBudget, today: LocalDate): PeriodStatus {
  if (today < budget.startDate) return 'upcoming'
  if (today > budget.endDate) return 'ended'
  return 'active'
}

function signed(t: Transaction): number {
  return t.kind === 'refund' ? -t.amountMinor : t.amountMinor
}

export function summarizePeriod(data: AppData, budget: PeriodBudget, today: LocalDate): PeriodSummaryResult {
  const transactions = periodTransactions(data, budget)
  const realized = transactions.filter((t) => t.status === 'realized')
  const spentMinor = sumMinor(realized.map(signed))
  const plannedMinor = sumMinor(transactions.filter((t) => t.status === 'planned').map(signed))
  const remainingMinor = budget.allocatedMinor - spentMinor
  const status = periodStatus(budget, today)
  const totalDays = daysBetween(budget.startDate, budget.endDate) + 1
  const daysLeft = status === 'ended' ? 0 : status === 'upcoming' ? totalDays : daysBetween(today, budget.endDate) + 1
  let perDayMinor: number | null = null
  let perWeekMinor: number | null = null
  if (daysLeft > 0) {
    perDayMinor = remainingMinor > 0 ? floorDiv(remainingMinor, daysLeft) : 0
    perWeekMinor = remainingMinor > 0 ? mulDivFloor(remainingMinor, Math.min(7, daysLeft), daysLeft) : 0
  }
  const others = new Set(data.periodBudgets.filter((b) => b.id !== budget.id).flatMap((b) => b.txIds))
  const trashIds = new Set(data.trash.map((e) => e.id))
  return {
    budget,
    status,
    transactions,
    spentMinor,
    plannedMinor,
    remainingMinor,
    totalDays,
    daysLeft,
    perDayMinor,
    perWeekMinor,
    outsideRange: transactions.filter((t) => t.date < budget.startDate || t.date > budget.endDate),
    shared: transactions.filter((t) => others.has(t.id)),
    trashedCount: budget.txIds.filter((id) => trashIds.has(id)).length,
  }
}

/**
 * Total gastado en varios presupuestos SIN duplicar: cada movimiento cuenta una sola
 * vez aunque pertenezca a varios periodos solapados.
 */
export function consolidatedSpent(data: AppData, budgets: PeriodBudget[]): { spentMinor: number; sharedCount: number } {
  const seen = new Map<string, Transaction>()
  let sharedCount = 0
  for (const b of budgets) {
    for (const t of periodTransactions(data, b)) {
      if (seen.has(t.id)) sharedCount++
      else seen.set(t.id, t)
    }
  }
  const realized = [...seen.values()].filter((t) => t.status === 'realized')
  return { spentMinor: sumMinor(realized.map(signed)), sharedCount }
}

/** Gastos y devoluciones que se ofrecen para asociar: dentro de las fechas (o ya asociados). */
export function periodCandidates(data: AppData, budget: PeriodBudget): Transaction[] {
  const linked = new Set(budget.txIds)
  return data.transactions
    .filter((t) => (t.kind === 'expense' || t.kind === 'refund') && (linked.has(t.id) || (t.date >= budget.startDate && t.date <= budget.endDate)))
    .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1))
}

/** Plantillas: fechas sugeridas (la persona puede cambiarlas). */
export function templateDates(template: PeriodTemplate, today: LocalDate): { startDate: LocalDate; endDate: LocalDate } {
  if (template === 'semester') return { startDate: today, endDate: addDays(today, 7 * 17) } // ~4 meses
  if (template === 'trip') return { startDate: addDays(today, 7), endDate: addDays(today, 13) }
  return { startDate: today, endDate: addDays(today, 29) }
}

export type PeriodBudgetDraft = Pick<PeriodBudget, 'id' | 'name' | 'template' | 'startDate' | 'endDate' | 'allocatedMinor' | 'note' | 'ruleCategoryIds'> & {
  /** Modo viaje (solo «Viaje»). Ausente = se conserva el que tenía; `null` = se quita. */
  trip?: TripSettings | null
}

export function savePeriodBudget(data: AppData, draft: PeriodBudgetDraft, ctx: OpContext): OpResult<PeriodBudget> {
  const existing = data.periodBudgets.find((b) => b.id === draft.id)
  const budget: PeriodBudget = {
    id: draft.id,
    name: draft.name.trim(),
    template: draft.template,
    startDate: draft.startDate,
    endDate: draft.endDate,
    allocatedMinor: draft.allocatedMinor,
    currency: data.settings.currency,
    txIds: existing?.txIds ?? [],
    ...(existing?.goalId ? { goalId: existing.goalId } : {}),
    ...(draft.ruleCategoryIds?.length ? { ruleCategoryIds: [...new Set(draft.ruleCategoryIds)] } : {}),
    archived: existing?.archived ?? false,
    ...(draft.note?.trim() ? { note: draft.note.trim() } : {}),
    ...(draft.template === 'trip' && draft.trip !== null && (draft.trip ?? existing?.trip) ? { trip: (draft.trip ?? existing?.trip)! } : {}),
    createdAt: existing?.createdAt ?? ctx.now,
    updatedAt: ctx.now,
  }
  const issues = validatePeriodBudget(budget, { data })
  if (issues.length) return fail(issues)
  const periodBudgets = existing ? data.periodBudgets.map((b) => (b.id === budget.id ? budget : b)) : [...data.periodBudgets, budget]
  return { ok: true, data: touch({ ...data, periodBudgets }, ctx.now), value: budget }
}

/** Asocia o quita un gasto/devolución. Solo guarda el id: el movimiento no se copia ni cambia. */
export function setPeriodTransaction(data: AppData, budgetId: string, txId: string, linked: boolean, ctx: OpContext): OpResult<PeriodBudget> {
  const budget = data.periodBudgets.find((b) => b.id === budgetId)
  if (!budget) return fail([{ path: 'budgetId', code: 'notFound' }])
  const tx = data.transactions.find((t) => t.id === txId)
  if (linked) {
    if (!tx) return fail([{ path: 'txId', code: 'notFound' }])
    // Transferencias, ingresos y ajustes no son gasto del periodo.
    if (tx.kind !== 'expense' && tx.kind !== 'refund') return fail([{ path: 'txId', code: 'invalidValue' }])
  }
  const has = budget.txIds.includes(txId)
  if (has === linked) return { ok: true, data, value: budget, unchanged: true }
  const updated: PeriodBudget = { ...budget, txIds: linked ? [...budget.txIds, txId] : budget.txIds.filter((id) => id !== txId), updatedAt: ctx.now }
  return { ok: true, data: touch({ ...data, periodBudgets: data.periodBudgets.map((b) => (b.id === budgetId ? updated : b)) }, ctx.now), value: updated }
}

/**
 * Regla del periodo: ¿se propone asociar este gasto? Solo gastos y devoluciones dentro de
 * las fechas, de una categoría de la regla, en un periodo no archivado. Solo PROPONE.
 */
export function periodRuleMatches(budget: PeriodBudget, tx: Pick<Transaction, 'kind' | 'date' | 'categoryId' | 'original'>): boolean {
  if (budget.archived) return false
  if (tx.kind !== 'expense' && tx.kind !== 'refund') return false
  if (tx.date < budget.startDate || tx.date > budget.endDate) return false
  // Modo viaje (v16): un gasto en una moneda del viaje, dentro de sus fechas, también se propone.
  if (budget.trip && tx.original && budget.trip.currencies.includes(tx.original.currency)) return true
  if (!budget.ruleCategoryIds?.length) return false
  return !!tx.categoryId && budget.ruleCategoryIds.includes(tx.categoryId)
}

/** Presupuestos cuya regla propone asociar este gasto. */
export function periodsProposedFor(data: AppData, tx: Pick<Transaction, 'kind' | 'date' | 'categoryId' | 'original'>): string[] {
  return data.periodBudgets.filter((b) => periodRuleMatches(b, tx)).map((b) => b.id)
}

/**
 * Sugerencias: gastos y devoluciones DENTRO de las fechas que aún no están asociados.
 * Solo se proponen; nada se asocia sin la acción de la persona.
 */
export function periodSuggestions(data: AppData, budget: PeriodBudget, categoryId?: string): Transaction[] {
  const linked = new Set(budget.txIds)
  return periodCandidates(data, budget).filter(
    (t) => !linked.has(t.id) && t.date >= budget.startDate && t.date <= budget.endDate && (!categoryId || t.categoryId === categoryId),
  )
}

/** Asocia (o quita) varios movimientos en una sola operación, todo o nada. */
export function setPeriodTransactionsBulk(data: AppData, budgetId: string, txIds: string[], linked: boolean, ctx: OpContext): OpResult<string[]> {
  let next = data
  const changed: string[] = []
  for (const txId of txIds) {
    const r = setPeriodTransaction(next, budgetId, txId, linked, ctx)
    if (!r.ok) return r
    if (!r.unchanged) changed.push(txId)
    next = r.data
  }
  return changed.length ? { ok: true, data: next, value: changed } : { ok: true, data, value: [], unchanged: true }
}

/**
 * Deja un movimiento exactamente en los presupuestos indicados (formulario de movimiento).
 * Los presupuestos archivados no se tocan: conservan su historial.
 */
export function setTransactionPeriods(data: AppData, txId: string, budgetIds: string[], ctx: OpContext): OpResult<null> {
  let next = data
  let changed = false
  for (const b of data.periodBudgets) {
    if (b.archived) continue
    const r = setPeriodTransaction(next, b.id, txId, budgetIds.includes(b.id), ctx)
    if (!r.ok) return r
    if (!r.unchanged) changed = true
    next = r.data
  }
  return changed ? { ok: true, data: next, value: null } : { ok: true, data, value: null, unchanged: true }
}

export function setPeriodBudgetArchived(data: AppData, id: string, archived: boolean, ctx: OpContext): OpResult<PeriodBudget> {
  const budget = data.periodBudgets.find((b) => b.id === id)
  if (!budget) return fail([{ path: 'id', code: 'notFound' }])
  if (budget.archived === archived) return { ok: true, data, value: budget, unchanged: true }
  const updated = { ...budget, archived, updatedAt: ctx.now }
  return { ok: true, data: touch({ ...data, periodBudgets: data.periodBudgets.map((b) => (b.id === id ? updated : b)) }, ctx.now), value: updated }
}

/** Eliminar un presupuesto no toca sus movimientos ni la meta de reserva (si la hay). */
export function deletePeriodBudget(data: AppData, id: string, ctx: OpContext): OpResult<PeriodBudget> {
  const budget = data.periodBudgets.find((b) => b.id === id)
  if (!budget) return fail([{ path: 'id', code: 'notFound' }])
  return { ok: true, data: touch({ ...data, periodBudgets: data.periodBudgets.filter((b) => b.id !== id) }, ctx.now), value: budget }
}

export function restorePeriodBudget(data: AppData, budget: PeriodBudget, ctx: OpContext): OpResult<PeriodBudget> {
  if (data.periodBudgets.some((b) => b.id === budget.id)) return { ok: true, data, value: budget, unchanged: true }
  const goalId = budget.goalId && data.goals.some((g) => g.id === budget.goalId) ? budget.goalId : undefined
  const { goalId: _g, ...rest } = budget
  return { ok: true, data: touch({ ...data, periodBudgets: [...data.periodBudgets, goalId ? { ...rest, goalId } : rest] }, ctx.now), value: budget }
}

/**
 * Reserva dinero para el periodo usando las metas existentes: crea (o reutiliza) una meta
 * del presupuesto vinculada y aparta `amountMinor` con el mismo control de dinero libre.
 * Efecto: «Puedes gastar» baja en esa cantidad; lo gastado en el periodo la va liberando.
 */
export function reserveForPeriod(
  data: AppData,
  input: { budgetId: string; amountMinor: number; goalId?: string; allocationId?: string },
  ctx: OpContext,
): OpResult<Goal> {
  const budget = data.periodBudgets.find((b) => b.id === input.budgetId)
  if (!budget) return fail([{ path: 'budgetId', code: 'notFound' }])
  let next = data
  let goalId = budget.goalId
  if (!goalId) {
    goalId = input.goalId ?? newId()
    const created = saveGoal(next, { id: goalId, name: budget.name, kind: 'goal', targetMinor: budget.allocatedMinor, targetDate: budget.startDate, fundedFrom: 'budget' }, ctx)
    if (!created.ok) return created
    next = {
      ...created.data,
      periodBudgets: created.data.periodBudgets.map((b) => (b.id === budget.id ? { ...b, goalId, updatedAt: ctx.now } : b)),
    }
  }
  const allocated = allocateToGoal(next, { goalId, amountMinor: input.amountMinor, allocationId: input.allocationId, reason: 'contribution' }, ctx)
  if (!allocated.ok) return allocated
  return { ok: true, data: allocated.data, value: allocated.data.goals.find((g) => g.id === goalId)! }
}

/** Dinero realmente disponible hoy (no depende de lo asignado a presupuestos por periodo). */
export function availableNow(data: AppData, today: LocalDate): number {
  return computeBudget(data, today).availableMinor
}
