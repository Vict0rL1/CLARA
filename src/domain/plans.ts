/**
 * Planes de gasto (§7.5): límites para una o varias categorías en un periodo, con cierre
 * automático, recurrencia, resultado y alertas. Ver docs/FORMULAS.md §34.
 *
 *   Gastado del plan = Σ gastos − Σ devoluciones realizados, en las categorías del plan
 *                      (vacío = todas las de gasto), entre inicio y fin del ciclo (incluidos).
 *   Ritmo ideal al día d = límite × d / días del ciclo (solo para comparar; nunca limita nada).
 *
 * Un plan nunca mueve dinero ni cambia el disponible: solo compara y avisa. Las metas de
 * ahorro siguen siendo `Goal` (apartados virtuales).
 */
import { planItems, type PlanItem } from './planItems'
import { categoriesForKind } from './categories'
import { addDays, daysBetween, isValidLocalDate } from './dates'
import { newId } from './ids'
import { MAX_AMOUNT_MINOR, mulDivFloor, sumMinor } from './money'
import { getPeriod } from './periods'
import { categoryAllocations } from './splits'
import type { OpContext, OpResult } from './operations'
import type { AppData, BudgetPeriodType, LocalDate, Plan, PlanEarlyAlertLevel, PlanResult, PlanRollover, Settings, Transaction } from './types'
import { validatePlan, type Issue } from './validation'

export type PlanDraft = Pick<Plan, 'id' | 'name' | 'categoryIds' | 'amountMinor' | 'periodType' | 'recurring' | 'alertAt80' | 'alertAt100'> & { startDate?: LocalDate; endDate?: LocalDate; rollover?: PlanRollover; alertLevels?: PlanEarlyAlertLevel[] }

export interface PlanCycle {
  start: LocalDate
  end: LocalDate
}

function fail(issues: Issue[]): { ok: false; issues: Issue[] } {
  return { ok: false, issues }
}

function touch(data: AppData, now: string): AppData {
  return { ...data, updatedAt: now }
}

/** Ciclo que contiene `date` para un tipo de periodo (personalizado: fechas explícitas). */
export function cycleFor(periodType: BudgetPeriodType, settings: Settings, date: LocalDate, custom?: { startDate?: LocalDate; endDate?: LocalDate }): PlanCycle | null {
  if (periodType === 'custom') {
    if (!isValidLocalDate(custom?.startDate) || !isValidLocalDate(custom?.endDate) || custom.endDate < custom.startDate) return null
    return { start: custom.startDate, end: custom.endDate }
  }
  if (periodType === 'untilIncome') return null
  const period = getPeriod({ ...settings.budgetPeriod, type: periodType }, date)
  return period ? { start: period.start, end: period.end } : null
}

/** Ciclo en curso del plan: el guardado o, si falta (datos migrados), el que contiene `today`. */
export function planCycle(plan: Plan, settings: Settings, today: LocalDate): PlanCycle | null {
  if (isValidLocalDate(plan.startDate) && isValidLocalDate(plan.endDate) && plan.endDate >= plan.startDate) return { start: plan.startDate, end: plan.endDate }
  return cycleFor(plan.periodType, settings, today)
}

function planCategories(plan: Pick<Plan, 'categoryIds'>): Set<string> | null {
  if (plan.categoryIds.length > 0) return new Set(plan.categoryIds)
  return null // todas las categorías de gasto
}

function matchesPlan(tx: Transaction, categories: Set<string> | null): boolean {
  if (tx.status !== 'realized' || (tx.kind !== 'expense' && tx.kind !== 'refund')) return false
  if (!categories) return true
  return categoryAllocations(tx).some((l) => categories.has(l.categoryId))
}

/** Importe neto (gastos − devoluciones) que un movimiento aporta al plan. */
function planAmount(tx: Transaction, categories: Set<string> | null): number {
  const sign = tx.kind === 'refund' ? -1 : 1
  if (!categories) return sign * tx.amountMinor
  return sign * categoryAllocations(tx).filter((l) => categories.has(l.categoryId)).reduce((s, l) => s + l.amountMinor, 0)
}

/** Movimientos realizados del ciclo que cuentan para el plan, del más reciente al más antiguo. */
export function planTransactions(data: AppData, plan: Plan, cycle: PlanCycle): Transaction[] {
  const categories = planCategories(plan)
  return data.transactions
    .filter((tx) => tx.date >= cycle.start && tx.date <= cycle.end && matchesPlan(tx, categories))
    .sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)))
}

/** Gastado neto del plan hasta `upTo` (incluido); nunca negativo. */
export function planSpent(data: AppData, plan: Pick<Plan, 'categoryIds'>, cycle: PlanCycle, upTo: LocalDate = cycle.end): number {
  const categories = planCategories(plan)
  const total = data.transactions.filter((tx) => tx.date >= cycle.start && tx.date <= upTo && tx.date <= cycle.end && matchesPlan(tx, categories)).reduce((s, tx) => s + planAmount(tx, categories), 0)
  return Math.max(0, total)
}

export type PlanState = 'ok' | 'near' | 'over' | 'completed' | 'paused'

export interface PlanProgress {
  cycle: PlanCycle | null
  spentMinor: number
  limitMinor: number
  /** Positivo = queda margen; negativo = superado. */
  remainingMinor: number
  /** Solo para mostrar (0–∞). */
  fraction: number
  /** Porcentaje entero (0–∞). */
  percent: number
  state: PlanState
  daysTotal: number
  /** Días que quedan contando hoy (0 si el ciclo terminó). */
  daysLeft: number
  /** Gasto que correspondería hoy a ritmo constante. */
  idealToDateMinor: number
}

export function planProgress(data: AppData, plan: Plan, today: LocalDate): PlanProgress {
  const cycle = planCycle(plan, data.settings, today)
  const limit = plan.amountMinor
  if (!cycle) return { cycle: null, spentMinor: 0, limitMinor: limit, remainingMinor: limit, fraction: 0, percent: 0, state: plan.status === 'paused' ? 'paused' : 'ok', daysTotal: 0, daysLeft: 0, idealToDateMinor: 0 }
  const spent = plan.status === 'completed' && plan.result ? plan.result.spentMinor : planSpent(data, plan, cycle)
  const remaining = limit - spent
  const daysTotal = daysBetween(cycle.start, cycle.end) + 1
  const daysLeft = today > cycle.end ? 0 : today < cycle.start ? daysTotal : daysBetween(today, cycle.end) + 1
  const elapsed = Math.min(daysTotal, Math.max(0, today < cycle.start ? 0 : daysBetween(cycle.start, today) + 1))
  const state: PlanState = plan.status === 'completed' ? 'completed' : plan.status === 'paused' ? 'paused' : spent > limit ? 'over' : spent * 5 >= limit * 4 ? 'near' : 'ok'
  return {
    cycle,
    spentMinor: spent,
    limitMinor: limit,
    remainingMinor: remaining,
    fraction: limit > 0 ? spent / limit : 0,
    percent: limit > 0 ? mulDivFloor(spent, 100, limit) : 0,
    state,
    daysTotal,
    daysLeft,
    idealToDateMinor: daysTotal > 0 ? mulDivFloor(limit, elapsed, daysTotal) : 0,
  }
}

export interface PlanSeriesPoint {
  date: LocalDate
  /** Gastado acumulado hasta ese día (solo hasta hoy; después `null`). */
  cumulativeMinor: number | null
  /** Ritmo ideal acumulado. */
  idealMinor: number
}

/** Serie diaria del ciclo: acumulado real (hasta hoy) y ritmo ideal, para el gráfico del detalle. */
export function planDailySeries(data: AppData, plan: Plan, cycle: PlanCycle, today: LocalDate): PlanSeriesPoint[] {
  const categories = planCategories(plan)
  const byDay = new Map<LocalDate, number>()
  for (const tx of data.transactions) {
    if (tx.date < cycle.start || tx.date > cycle.end || !matchesPlan(tx, categories)) continue
    byDay.set(tx.date, (byDay.get(tx.date) ?? 0) + planAmount(tx, categories))
  }
  const days = daysBetween(cycle.start, cycle.end) + 1
  const out: PlanSeriesPoint[] = []
  let cumulative = 0
  for (let i = 0; i < days; i++) {
    const date = addDays(cycle.start, i)
    cumulative += byDay.get(date) ?? 0
    out.push({ date, cumulativeMinor: date <= today ? Math.max(0, cumulative) : null, idealMinor: mulDivFloor(plan.amountMinor, i + 1, days) })
  }
  return out
}

/**
 * Lo que este ciclo conserva del arrastre al editar (FIN-02). El importe escrito es el límite del
 * ciclo; el límite base es `importe − arrastre` y tiene que ser un importe positivo. Si la persona
 * pone un límite por debajo de lo arrastrado, el arrastre se quita y ese importe pasa a ser el
 * límite base (el formulario lo avisa antes de guardar). Un límite base por encima del máximo se
 * rechaza (`amountTooLarge`).
 */
export function carryAfterEdit(existing: Pick<Plan, 'amountMinor' | 'carriedMinor'> | undefined, amountMinor: number): { carriedMinor?: number; issue?: Issue } {
  const carried = existing?.carriedMinor
  if (carried === undefined) return {}
  if (!existing || amountMinor === existing.amountMinor) return { carriedMinor: carried }
  const base = amountMinor - carried
  if (base < 1) return {}
  if (base > MAX_AMOUNT_MINOR) return { carriedMinor: carried, issue: { path: 'amountMinor', code: 'amountTooLarge' } }
  return { carriedMinor: carried }
}

/** Límite base acotado a [1, máximo]: protege la renovación de datos guardados antes de FIN-02/03. */
function boundedBase(plan: Pick<Plan, 'amountMinor' | 'carriedMinor'>): number {
  return Math.min(MAX_AMOUNT_MINOR, Math.max(1, planBaseMinor(plan)))
}

function buildPlan(data: AppData, draft: PlanDraft, ctx: OpContext, existing?: Plan): Plan | Issue[] {
  const periodChanged = existing !== undefined && (existing.periodType !== draft.periodType || (draft.periodType === 'custom' && (existing.startDate !== draft.startDate || existing.endDate !== draft.endDate)))
  const custom = draft.periodType === 'custom' ? { startDate: draft.startDate, endDate: draft.endDate } : undefined
  const cycle = !existing || periodChanged ? cycleFor(draft.periodType, data.settings, ctx.today, custom) : { start: existing.startDate, end: existing.endDate }
  const carry = carryAfterEdit(existing, draft.amountMinor)
  const plan: Plan = {
    id: draft.id,
    kind: 'limit',
    name: draft.name.trim(),
    categoryIds: [...new Set(draft.categoryIds)],
    amountMinor: draft.amountMinor,
    currency: data.settings.currency,
    periodType: draft.periodType,
    ...(cycle?.start ? { startDate: cycle.start } : {}),
    ...(cycle?.end ? { endDate: cycle.end } : {}),
    recurring: draft.periodType === 'custom' ? false : draft.recurring,
    status: existing?.status ?? 'active',
    ...(existing?.previousPlanId ? { previousPlanId: existing.previousPlanId } : {}),
    alertAt80: draft.alertAt80,
    alertAt100: draft.alertAt100,
    // v13: sin `alertLevels` en el borrador se conservan los del límite; una lista vacía los quita.
    ...earlyLevels(draft.alertLevels ?? existing?.alertLevels),
    ...(existing?.result ? { result: existing.result } : {}),
    // v12: el arrastre se elige al crear o editar; lo que este ciclo ya recibió del anterior no cambia al editar.
    rollover: draft.rollover ?? existing?.rollover ?? 'none',
    ...(carry.carriedMinor !== undefined ? { carriedMinor: carry.carriedMinor } : {}),
    createdAt: existing?.createdAt ?? ctx.now,
    updatedAt: ctx.now,
  }
  const issues = validatePlan(plan, { data: { settings: data.settings, categories: data.categories } })
  if (carry.issue) issues.push(carry.issue)
  if (draft.periodType === 'custom' && !cycle) issues.push({ path: 'endDate', code: 'endBeforeStart' })
  return issues.length ? issues : plan
}

/** Crear o editar (idempotente por id). Editar no toca el estado ni el resultado. */
export function savePlan(data: AppData, draft: PlanDraft, ctx: OpContext): OpResult<Plan> {
  const existing = data.plans.find((p) => p.id === draft.id)
  const built = buildPlan(data, draft, ctx, existing)
  if (Array.isArray(built)) return fail(built)
  const plans = existing ? data.plans.map((p) => (p.id === built.id ? built : p)) : [...data.plans, built]
  return { ok: true, data: touch({ ...data, plans }, ctx.now), value: built }
}

export function setPlanStatus(data: AppData, id: string, status: 'active' | 'paused', ctx: OpContext): OpResult<Plan> {
  const plan = data.plans.find((p) => p.id === id)
  if (!plan) return fail([{ path: 'id', code: 'notFound' }])
  if (plan.status === 'completed') return fail([{ path: 'status', code: 'invalidValue' }])
  if (plan.status === status) return { ok: true, data, value: plan, unchanged: true }
  const next = { ...plan, status, updatedAt: ctx.now }
  return { ok: true, data: touch({ ...data, plans: data.plans.map((p) => (p.id === id ? next : p)) }, ctx.now), value: next }
}

export function deletePlan(data: AppData, id: string, ctx: OpContext): OpResult<Plan> {
  const plan = data.plans.find((p) => p.id === id)
  if (!plan) return fail([{ path: 'id', code: 'notFound' }])
  return { ok: true, data: touch({ ...data, plans: data.plans.filter((p) => p.id !== id) }, ctx.now), value: plan }
}

export function restorePlan(data: AppData, plan: Plan, ctx: OpContext): OpResult<Plan> {
  if (data.plans.some((p) => p.id === plan.id)) return { ok: true, data, value: plan, unchanged: true }
  const issues = validatePlan(plan, { data: { settings: data.settings, categories: data.categories } })
  if (issues.length) return fail(issues)
  return { ok: true, data: touch({ ...data, plans: [...data.plans, plan] }, ctx.now), value: plan }
}

function resultFor(data: AppData, plan: Plan, cycle: PlanCycle, now: string): PlanResult {
  const spent = planSpent(data, plan, cycle)
  return { spentMinor: spent, achieved: spent <= plan.amountMinor, deltaMinor: plan.amountMinor - spent, closedAt: now }
}

export interface ClosePlansResult {
  closed: Plan[]
  renewed: Plan[]
}

/**
 * Cierre automático (al abrir la app y al cambiar el día): los planes activos cuyo ciclo terminó
 * antes de hoy quedan `completed` con su resultado; los recurrentes crean el siguiente ciclo
 * (si hoy ya pasó varios ciclos, el nuevo es el que contiene hoy: no se inventan cierres
 * intermedios). Los planes migrados sin ciclo reciben el que contiene hoy. Los pausados no cambian.
 */
export function closeDuePlans(data: AppData, ctx: OpContext): OpResult<ClosePlansResult> {
  const closed: Plan[] = []
  const renewed: Plan[] = []
  let plans = data.plans
  let changed = false
  for (const plan of data.plans) {
    if (plan.status !== 'active') continue
    const stored = isValidLocalDate(plan.startDate) && isValidLocalDate(plan.endDate) && plan.endDate >= plan.startDate
    if (!stored) {
      const cycle = cycleFor(plan.periodType, data.settings, ctx.today)
      if (!cycle) continue
      const fixed = { ...plan, startDate: cycle.start, endDate: cycle.end, updatedAt: ctx.now }
      plans = plans.map((p) => (p.id === plan.id ? fixed : p))
      changed = true
      continue
    }
    if (plan.endDate! >= ctx.today) continue
    const cycle = { start: plan.startDate!, end: plan.endDate! }
    const done: Plan = { ...plan, status: 'completed', result: resultFor(data, plan, cycle, ctx.now), updatedAt: ctx.now }
    plans = plans.map((p) => (p.id === plan.id ? done : p))
    closed.push(done)
    changed = true
    if (plan.recurring) {
      const next = cycleFor(plan.periodType, data.settings, ctx.today)
      if (!next) continue
      // Arrastre (v12): el ciclo nuevo parte del límite base más lo que sobró (o menos lo excedido),
      // nunca por debajo de 0 ni por encima del máximo (FIN-03); el límite base siempre es válido (FIN-02).
      const carry = plan.rollover === 'carry'
      const base = boundedBase(plan)
      const carried = carry ? done.result!.deltaMinor : 0
      const nextAmount = carry ? Math.min(MAX_AMOUNT_MINOR, Math.max(0, base + carried)) : base
      const fresh: Plan = {
        ...plan,
        id: newId(),
        amountMinor: nextAmount,
        startDate: next.start,
        endDate: next.end,
        status: 'active',
        previousPlanId: plan.id,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      }
      delete fresh.result
      if (carry) fresh.carriedMinor = nextAmount - base
      else delete fresh.carriedMinor
      plans = [...plans, fresh]
      renewed.push(fresh)
    }
  }
  if (!changed) return { ok: true, data, value: { closed, renewed }, unchanged: true }
  return { ok: true, data: touch({ ...data, plans }, ctx.now), value: { closed, renewed } }
}

/** Límite base de un plan: lo elegido por la persona, sin el arrastre del ciclo anterior. */
export function planBaseMinor(plan: Pick<Plan, 'amountMinor' | 'carriedMinor'>): number {
  return plan.amountMinor - (plan.carriedMinor ?? 0)
}

export interface PlanUpcoming {
  items: PlanItem[]
  /** Σ de lo programado y aún no pagado del ciclo en las categorías del plan. */
  totalMinor: number
  /** Restante del límite una vez descontado lo programado (puede ser negativo). */
  remainingAfterMinor: number
}

/**
 * Lo que queda por pagar del ciclo según el calendario (pagos programados pendientes o vencidos en
 * las categorías del plan). Es compromiso previsto, no gasto: no cambia «gastado» ni el disponible.
 */
export function planUpcoming(data: AppData, plan: Plan, cycle: PlanCycle, today: LocalDate): PlanUpcoming {
  const categories = planCategories(plan)
  const to = cycle.end < today ? today : cycle.end
  const items = planItems(data, { today, from: cycle.start, to, includeOverdueBefore: true }).filter(
    (i) =>
      i.direction === 'expense' &&
      (i.state === 'pending' || i.state === 'overdue') &&
      i.date >= cycle.start &&
      i.date <= cycle.end &&
      (!categories || (!!i.categoryId && categories.has(i.categoryId))),
  )
  const totalMinor = sumMinor(items.map((i) => i.amountMinor))
  return { items, totalMinor, remainingAfterMinor: plan.amountMinor - planSpent(data, plan, cycle) - totalMinor }
}

export interface PlanComparison {
  previous: PlanCycle
  /** Día equivalente del ciclo anterior (mismo número de días transcurridos). */
  equivalentDate: LocalDate
  previousToDateMinor: number
  previousTotalMinor: number
  currentToDateMinor: number
  /** Positivo = este ciclo lleva más gastado que el anterior en el mismo punto. */
  deltaMinor: number
}

/**
 * Comparación con el ciclo anterior en el mismo punto (días transcurridos), para que «vas mejor o
 * peor» tenga base. `null` cuando no hay ciclo anterior o no hay ningún movimiento anterior al ciclo
 * actual en esas categorías (sin datos no hay comparación; nunca se asume 0).
 */
export function planComparison(data: AppData, plan: Plan, today: LocalDate): PlanComparison | null {
  const cycle = planCycle(plan, data.settings, today)
  if (!cycle) return null
  const length = daysBetween(cycle.start, cycle.end) + 1
  const previous =
    plan.periodType === 'custom'
      ? { start: addDays(cycle.start, -length), end: addDays(cycle.start, -1) }
      : cycleFor(plan.periodType, data.settings, addDays(cycle.start, -1))
  if (!previous || previous.end >= cycle.start) return null
  const categories = planCategories(plan)
  const hasEarlier = data.transactions.some((tx) => tx.date < cycle.start && matchesPlan(tx, categories))
  if (!hasEarlier) return null
  const elapsed = Math.max(1, Math.min(length, today < cycle.start ? 1 : daysBetween(cycle.start, today) + 1))
  const prevLength = daysBetween(previous.start, previous.end) + 1
  const equivalentDate = addDays(previous.start, Math.min(elapsed, prevLength) - 1)
  const currentToDateMinor = planSpent(data, plan, cycle, today < cycle.end ? today : cycle.end)
  const previousToDateMinor = planSpent(data, plan, previous, equivalentDate)
  return {
    previous,
    equivalentDate,
    previousToDateMinor,
    previousTotalMinor: planSpent(data, plan, previous),
    currentToDateMinor,
    deltaMinor: currentToDateMinor - previousToDateMinor,
  }
}

/** «Repetir»: nuevo plan activo con los mismos ajustes en el ciclo que contiene hoy. */
export function repeatPlan(data: AppData, id: string, ctx: OpContext, newPlanId: string = newId()): OpResult<Plan> {
  const plan = data.plans.find((p) => p.id === id)
  if (!plan) return fail([{ path: 'id', code: 'notFound' }])
  const existing = data.plans.find((p) => p.id === newPlanId)
  if (existing) return { ok: true, data, value: existing, unchanged: true }
  const custom = plan.periodType === 'custom' && isValidLocalDate(plan.startDate) && isValidLocalDate(plan.endDate)
    ? (() => {
        const len = daysBetween(plan.startDate!, plan.endDate!) + 1
        return { startDate: ctx.today, endDate: addDays(ctx.today, len - 1) }
      })()
    : undefined
  const cycle = cycleFor(plan.periodType, data.settings, ctx.today, custom)
  if (!cycle) return fail([{ path: 'periodType', code: 'invalidValue' }])
  const fresh: Plan = { ...plan, id: newPlanId, startDate: cycle.start, endDate: cycle.end, status: 'active', previousPlanId: plan.id, createdAt: ctx.now, updatedAt: ctx.now }
  delete fresh.result
  const issues = validatePlan(fresh, { data: { settings: data.settings, categories: data.categories } })
  if (issues.length) return fail(issues)
  return { ok: true, data: touch({ ...data, plans: [...data.plans, fresh] }, ctx.now), value: fresh }
}

export interface PlansSummary {
  active: number
  completed: number
  exceeded: number
  near: number
  /** Metas de ahorro (sin gastos planificados) y cuántas están completas. */
  goals: number
  goalsComplete: number
  /** Porcentaje entero de metas completas; `null` sin metas. */
  goalsPercent: number | null
}

/** Resumen para el aviso al abrir Planes (solo cuenta; no inventa causas). */
export function plansSummary(data: AppData, today: LocalDate): PlansSummary {
  let active = 0
  let completed = 0
  let exceeded = 0
  let near = 0
  for (const plan of data.plans) {
    if (plan.status === 'completed') {
      completed += 1
      continue
    }
    active += 1
    if (plan.status !== 'active') continue
    const p = planProgress(data, plan, today)
    if (p.state === 'over') exceeded += 1
    else if (p.state === 'near') near += 1
  }
  const goals = data.goals.filter((g) => g.kind !== 'expense')
  const goalsComplete = goals.filter((g) => g.allocations.reduce((s, a) => s + a.amountMinor, 0) >= g.targetMinor).length
  return { active, completed, exceeded, near, goals: goals.length, goalsComplete, goalsPercent: goals.length ? Math.floor((goalsComplete * 100) / goals.length) : null }
}

export type PlanAlertLevel = PlanEarlyAlertLevel | 80 | 100

export interface PlanAlert {
  plan: Plan
  level: PlanAlertLevel
  progress: PlanProgress
}

function earlyLevels(levels: readonly PlanEarlyAlertLevel[] | undefined): { alertLevels?: PlanEarlyAlertLevel[] } {
  return levels && levels.length > 0 ? { alertLevels: [...new Set(levels)].sort((a, b) => a - b) } : {}
}

/** Umbrales activados de un límite, de menor a mayor (50/75/90 opcionales, 80 y 100 como siempre). */
export function planAlertLevels(plan: Pick<Plan, 'alertAt80' | 'alertAt100' | 'alertLevels'>): PlanAlertLevel[] {
  const levels: PlanAlertLevel[] = [...(plan.alertLevels ?? [])]
  if (plan.alertAt80) levels.push(80)
  if (plan.alertAt100) levels.push(100)
  return [...new Set(levels)].sort((a, b) => a - b)
}

/**
 * Alertas que corresponden hoy: por límite, solo el umbral activado MÁS ALTO que ya se alcanzó (si
 * el gasto salta del 40 % al 95 % se avisa una vez, del 90 %). Comparación entera:
 * gastado × 100 ≥ límite × umbral. Quien avisa deduplica por umbral y ciclo.
 */
export function planAlerts(data: AppData, today: LocalDate): PlanAlert[] {
  const out: PlanAlert[] = []
  for (const plan of data.plans) {
    if (plan.status !== 'active') continue
    const levels = planAlertLevels(plan)
    if (levels.length === 0) continue
    const progress = planProgress(data, plan, today)
    if (!progress.cycle) continue
    const reached = levels.filter((l) => progress.spentMinor * 100 >= plan.amountMinor * l)
    const level = reached[reached.length - 1]
    if (level !== undefined) out.push({ plan, level, progress })
  }
  return out
}

/** Categorías de gasto válidas para un plan (activas; las archivadas se conservan si ya estaban). */
export function planCategoryOptions(data: Pick<AppData, 'categories' | 'categoryPrefs'>, keep: readonly string[] = []): string[] {
  const active = categoriesForKind('expense', data.categories, { prefs: data.categoryPrefs })
  return [...new Set([...active, ...keep])]
}
