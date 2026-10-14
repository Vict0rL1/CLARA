/**
 * Comparador de escenarios (ver docs/FORMULAS.md §21).
 *
 * Cada escenario se simula sobre una COPIA de los datos: los cambios nunca tocan
 * cuentas, pagos ni movimientos reales. Se reutilizan el motor de presupuesto
 * (`computeBudget`) y el de proyección (`projectBalance`) con el MISMO horizonte, el
 * mismo gasto diario estimado y el mismo escenario de ingresos para todas las
 * alternativas, así las comparaciones son coherentes.
 *
 *  - Compra (hoy o en otra fecha): un gasto PREVISTO simulado en esa fecha y cuenta
 *    (por defecto, la primera cuenta que cuenta para el presupuesto).
 *  - Ingreso hipotético: ingreso PREVISTO simulado; cambia la proyección, nunca el disponible.
 *  - Cambiar el importe de un gasto programado (subir un pago mensual o reducir un gasto).
 */
import { isBudgetAccount } from './balances'
import { computeBudget } from './budget'
import { projectBalance, type ProjectionOptions } from './projection'
import type { OpContext, OpResult } from './operations'
import type { AppData, IncomeScenario, LocalDate, SavedScenario, ScenarioChange, Transaction } from './types'
import { validateScenario, type Issue } from './validation'

export const MAX_COMPARED = 3
export const MAX_SAVED_SCENARIOS = 20
const SIM_PREFIX = 'sim-'

export interface ScenarioResult {
  endMinor: number
  lowest: { date: LocalDate; minor: number }
  firstNegativeDate: LocalDate | null
  /** Cuánto faltaría en el peor día (0 si nunca baja de cero). */
  shortfallMinor: number
  /** «Puedes gastar hasta tu próximo ingreso» en el escenario. */
  availableMinor: number
  /** Primer día en que el saldo proyectado queda por debajo de lo apartado para metas. */
  belowGoalsDate: LocalDate | null
  goalsReservedMinor: number
  /** Cambios que ya no se pueden aplicar (p. ej. el pago programado ya no existe). */
  invalidChanges: number[]
}

export interface CompareOptions {
  days?: number
  dailySpendMinor?: number
  scenario?: IncomeScenario
}

/** Copia de los datos con los cambios del escenario. Los datos reales no se modifican. */
export function applyChanges(data: AppData, changes: ScenarioChange[], today: LocalDate): { data: AppData; invalid: number[] } {
  const invalid: number[] = []
  const fallback = data.accounts.find(isBudgetAccount) ?? data.accounts.find((a) => !a.archived) ?? data.accounts[0]
  const simulated: Transaction[] = []
  let schedules = data.schedules
  changes.forEach((c, i) => {
    if (c.type === 'purchase') {
      const account = c.accountId ? data.accounts.find((a) => a.id === c.accountId) : fallback
      if (!account || c.date < today) return void invalid.push(i)
      simulated.push({
        id: `${SIM_PREFIX}${i}`,
        kind: 'expense',
        status: 'planned',
        amountMinor: c.amountMinor,
        currency: data.settings.currency,
        date: c.date,
        accountId: account.id,
        categoryId: 'other_expense',
        note: c.note,
        createdAt: data.updatedAt,
        updatedAt: data.updatedAt,
      })
    } else if (c.type === 'income') {
      // Ingreso hipotético: previsto simulado. Los ingresos previstos nunca suman al
      // disponible (§6); solo cambian la proyección.
      const account = c.accountId ? data.accounts.find((a) => a.id === c.accountId) : fallback
      if (!account || c.date < today) return void invalid.push(i)
      simulated.push({
        id: `${SIM_PREFIX}${i}`,
        kind: 'income',
        status: 'planned',
        amountMinor: c.amountMinor,
        currency: data.settings.currency,
        date: c.date,
        accountId: account.id,
        categoryId: 'other_income',
        note: c.note,
        createdAt: data.updatedAt,
        updatedAt: data.updatedAt,
      })
    } else {
      const s = schedules.find((x) => x.id === c.scheduleId)
      if (!s || s.kind !== 'expense') return void invalid.push(i)
      schedules = schedules.map((x) => (x.id === c.scheduleId ? { ...x, amountMinor: c.newAmountMinor } : x))
    }
  })
  return { data: { ...data, schedules, transactions: [...data.transactions, ...simulated] }, invalid }
}

export function evaluate(data: AppData, today: LocalDate, changes: ScenarioChange[], options: CompareOptions = {}): ScenarioResult {
  const { data: simulated, invalid } = applyChanges(data, changes, today)
  const projectionOptions: ProjectionOptions = { days: options.days ?? 30, dailySpendMinor: options.dailySpendMinor ?? 0, scenario: options.scenario ?? 'min' }
  const p = projectBalance(simulated, today, projectionOptions)
  const budget = computeBudget(simulated, today)
  return {
    endMinor: p.endMinor,
    lowest: p.lowest,
    firstNegativeDate: p.firstNegativeDate,
    shortfallMinor: Math.max(0, -p.lowest.minor),
    availableMinor: budget.availableMinor,
    belowGoalsDate: p.firstBelowGoalsDate,
    goalsReservedMinor: p.goalsReservedMinor,
    invalidChanges: invalid,
  }
}

/** Situación base + hasta 3 escenarios, con las mismas hipótesis. */
export function compare(data: AppData, today: LocalDate, scenarios: SavedScenario[], options: CompareOptions = {}) {
  return {
    base: evaluate(data, today, [], options),
    alternatives: scenarios.slice(0, MAX_COMPARED).map((sc) => ({ scenario: sc, result: evaluate(data, today, sc.changes, options), stale: isStale(sc, data) })),
  }
}

/**
 * Huella de los datos reales que influyen en la simulación (cuentas, movimientos,
 * programados, metas, presupuestos por periodo y horizonte). Si cambia, los resultados
 * guardados se recalcularon con datos nuevos y conviene revisarlos.
 */
export function financialFingerprint(data: AppData): string {
  const parts = [
    `h${data.settings.fallbackHorizonDays ?? ''}`,
    ...data.accounts.map((a) => `a${a.id}${a.includeInBudget}${a.anchor.amountMinor}${a.anchor.setAt}`),
    ...data.transactions.map((t) => `t${t.id}${t.updatedAt}`),
    ...data.schedules.map((s) => `s${s.id}${s.updatedAt}`),
    ...data.goals.map((g) => `g${g.id}${g.updatedAt}${g.allocations.length}`),
    ...data.periodBudgets.map((b) => `p${b.id}${b.updatedAt}`),
  ].sort()
  let hash = 0x811c9dc5
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      hash ^= part.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
  }
  return `${parts.length}-${hash.toString(16).padStart(8, '0')}`
}

export function isStale(sc: SavedScenario, data: AppData): boolean {
  return sc.baseFingerprint !== financialFingerprint(data)
}

/** ¿Ya hay un gasto previsto parecido (mismo importe, a ±3 días)? Evita crear duplicados. */
export function similarPlanned(data: AppData, change: Extract<ScenarioChange, { type: 'purchase' }>): Transaction | undefined {
  return data.transactions.find(
    (t) => t.status === 'planned' && t.kind === 'expense' && t.amountMinor === change.amountMinor && Math.abs(Date.parse(t.date) - Date.parse(change.date)) <= 3 * 86_400_000,
  )
}

/* ------------------------------------------------------------------ */
/* Operaciones: solo tocan `scenarios`, nunca datos financieros         */
/* ------------------------------------------------------------------ */

const fail = (issues: Issue[]): { ok: false; issues: Issue[] } => ({ ok: false, issues })

export type ScenarioDraft = Pick<SavedScenario, 'id' | 'name' | 'changes'>

export function saveScenario(data: AppData, draft: ScenarioDraft, ctx: OpContext): OpResult<SavedScenario> {
  const existing = data.scenarios.find((s) => s.id === draft.id)
  if (!existing && data.scenarios.length >= MAX_SAVED_SCENARIOS) return fail([{ path: 'id', code: 'tooMany', params: { max: MAX_SAVED_SCENARIOS } }])
  const scenario: SavedScenario = {
    id: draft.id,
    name: draft.name.trim(),
    changes: draft.changes,
    baseFingerprint: financialFingerprint(data),
    createdAt: existing?.createdAt ?? ctx.now,
    updatedAt: ctx.now,
  }
  const issues = validateScenario(scenario)
  draft.changes.forEach((c, i) => {
    if ((c.type === 'purchase' || c.type === 'income') && c.date < ctx.today) issues.push({ path: `changes[${i}].date`, code: 'dateInPast' })
    if ((c.type === 'purchase' || c.type === 'income') && c.accountId && !data.accounts.some((a) => a.id === c.accountId)) issues.push({ path: `changes[${i}].accountId`, code: 'unknownAccount' })
    if (c.type === 'scheduleAmount' && !data.schedules.some((s) => s.id === c.scheduleId && s.kind === 'expense')) issues.push({ path: `changes[${i}].scheduleId`, code: 'notFound' })
  })
  if (issues.length) return fail(issues)
  const scenarios = existing ? data.scenarios.map((s) => (s.id === scenario.id ? scenario : s)) : [...data.scenarios, scenario]
  return { ok: true, data: { ...data, scenarios, updatedAt: ctx.now }, value: scenario }
}

export function deleteScenario(data: AppData, id: string, ctx: OpContext): OpResult<SavedScenario> {
  const sc = data.scenarios.find((s) => s.id === id)
  if (!sc) return fail([{ path: 'id', code: 'notFound' }])
  return { ok: true, data: { ...data, scenarios: data.scenarios.filter((s) => s.id !== id), updatedAt: ctx.now }, value: sc }
}

export function restoreScenario(data: AppData, sc: SavedScenario, ctx: OpContext): OpResult<SavedScenario> {
  if (data.scenarios.some((s) => s.id === sc.id)) return { ok: true, data, value: sc, unchanged: true }
  return { ok: true, data: { ...data, scenarios: [...data.scenarios, sc], updatedAt: ctx.now }, value: sc }
}

/** La persona revisó los resultados con los datos actuales. */
export function markScenarioReviewed(data: AppData, id: string, ctx: OpContext): OpResult<SavedScenario> {
  const sc = data.scenarios.find((s) => s.id === id)
  if (!sc) return fail([{ path: 'id', code: 'notFound' }])
  const fingerprint = financialFingerprint(data)
  if (sc.baseFingerprint === fingerprint) return { ok: true, data, value: sc, unchanged: true }
  const updated = { ...sc, baseFingerprint: fingerprint, updatedAt: ctx.now }
  return { ok: true, data: { ...data, scenarios: data.scenarios.map((s) => (s.id === id ? updated : s)), updatedAt: ctx.now }, value: updated }
}
