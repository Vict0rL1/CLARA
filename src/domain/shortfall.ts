/**
 * Plan ante un faltante (ver docs/FORMULAS.md §29).
 *
 * Parte de la misma proyección que el comparador de escenarios (`projectBalance`, mismas
 * hipótesis) y responde:
 *   - ¿Cuándo baja el saldo de cero por primera vez y cuánto falta ese día y en el peor día?
 *   - ¿Qué salidas previstas llevan hasta ahí y qué ingresos se suponen?
 *   - ¿Qué palancas lo evitarían? Cada una se SIMULA sobre una copia.
 *
 * Reglas:
 *   - Los pagos programados (obligaciones) nunca se proponen como palanca ni se cambian.
 *   - Un ingreso hipotético o adelantado nunca se presenta como disponible: solo cambia la
 *     proyección y se marca como supuesto.
 *   - No se sugieren préstamos, tarjetas ni deuda nueva.
 *   - Simular nunca cambia movimientos realizados. Aplicar solo toca la planificación
 *     (movimientos PREVISTOS e importe estimado de ingresos programados), con confirmación,
 *     en una operación, y se puede deshacer desde el historial.
 */
import { addDays, daysBetween } from './dates'
import { ceilDiv, checkedSumMinor } from './money'
import { deleteTransaction, saveSchedule, saveTransaction, type OpContext, type OpResult } from './operations'
import type { PlanItem } from './planItems'
import { projectBalance, type ProjectionResult } from './projection'
import type { AppData, IncomeScenario, LocalDate, Transaction } from './types'
import type { Issue } from './validation'

export interface ShortfallOptions {
  days?: number
  dailySpendMinor?: number
  scenario?: IncomeScenario
}

export type ShortfallLever =
  /** Mover una compra PREVISTA a otra fecha. */
  | { kind: 'postponePlanned'; txId: string; fromDate: LocalDate; toDate: LocalDate }
  /** Reducir el importe de una compra PREVISTA. */
  | { kind: 'reducePlanned'; txId: string; fromMinor: number; toMinor: number }
  /** Supuesto: otro importe para un ingreso programado (solo los estimados se pueden aplicar). */
  | { kind: 'incomeAmount'; scheduleId: string; occurrenceDate: LocalDate; fromMinor: number; toMinor: number }
  /** Supuesto: el ingreso llega otro día. Solo simulación (la fecha no la decide la persona). */
  | { kind: 'incomeDate'; scheduleId: string; fromDate: LocalDate; toDate: LocalDate }
  /** Supuesto: gastar menos al día en gastos variables. Solo simulación (es una estimación). */
  | { kind: 'dailySpend'; fromMinor: number; toMinor: number }

export interface LeverEffect {
  firstNegativeDate: LocalDate | null
  shortfallMinor: number
  lowest: { date: LocalDate; minor: number }
  /** Solo con la proyección completa: sin cifra desde `outOfRangeFrom` no se afirma que lo evite. */
  resolves: boolean
  /** Desde ese día la proyección simulada no tiene cifra (fuera del rango exacto). */
  outOfRangeFrom: LocalDate | null
  /** Si sigue faltando: pagos programados (obligaciones) hasta el primer día negativo. */
  obligations: PlanItem[]
}

export interface Contributor {
  item: PlanItem
  amountMinor: number
  /** obligation = pago programado; planned = compra prevista (se puede mover o reducir). */
  role: 'obligation' | 'planned' | 'transfer'
  isEstimate: boolean
}

export type ShortfallAnalysis =
  /** Sin día negativo entre los días exactos; si `projection.outOfRangeFrom` no es `null`, solo hasta el día antes. */
  | { status: 'none'; projection: ProjectionResult }
  | {
      status: 'shortfall'
      projection: ProjectionResult
      firstNegativeDate: LocalDate
      /** Lo que falta al final del primer día negativo. */
      firstNegativeMinor: number
      /** Lo que falta en el peor día. */
      worst: { date: LocalDate; shortfallMinor: number }
      contributors: Contributor[]
      /**
       * Suma bruta de los pagos que llevan al primer día negativo y de los ingresos previstos hasta ese día (auditoría
       * del 2026-11-04, F1): `null` si no cabe en un entero exacto aunque cada saldo diario sí; la pantalla lo dice y
       * no suma por su cuenta.
       */
      contributorsTotalMinor: number | null
      incomesUntilFirstMinor: number | null
      /** Gasto variable estimado que se resta hasta el primer día negativo (incluido). */
      dailySpendTotalMinor: number
      incomes: PlanItem[]
      levers: { lever: ShortfallLever; applicable: boolean; effect: LeverEffect }[]
    }

const appliesToPlanning = (lever: ShortfallLever, data: AppData): boolean => {
  if (lever.kind === 'postponePlanned' || lever.kind === 'reducePlanned') return true
  if (lever.kind === 'incomeAmount') {
    const s = data.schedules.find((x) => x.id === lever.scheduleId)
    return !!s && s.amountIsEstimate && !s.range
  }
  return false
}

export function isApplicable(lever: ShortfallLever, data: AppData): boolean {
  return appliesToPlanning(lever, data)
}

/** Copia de los datos con las palancas aplicadas (para simular). Los datos reales no cambian. */
export function simulateLevers(data: AppData, levers: ShortfallLever[]): { data: AppData; dailySpendMinor?: number } {
  let transactions = data.transactions
  let schedules = data.schedules
  const extra: Transaction[] = []
  let dailySpendMinor: number | undefined
  levers.forEach((lever, i) => {
    switch (lever.kind) {
      case 'postponePlanned':
        transactions = transactions.map((t) => (t.id === lever.txId && t.status === 'planned' ? { ...t, date: lever.toDate } : t))
        break
      case 'reducePlanned':
        transactions = transactions.flatMap((t) => (t.id === lever.txId && t.status === 'planned' ? (lever.toMinor > 0 ? [{ ...t, amountMinor: lever.toMinor }] : []) : [t]))
        break
      case 'incomeAmount':
      case 'incomeDate': {
        // La ocurrencia se omite en la copia y se simula un ingreso PREVISTO con el supuesto.
        const s = schedules.find((x) => x.id === lever.scheduleId)
        if (!s) break
        const date = lever.kind === 'incomeDate' ? lever.fromDate : lever.occurrenceDate
        schedules = schedules.map((x) => (x.id === s.id ? { ...x, skippedDates: [...x.skippedDates, date] } : x))
        extra.push({
          id: `sim-shortfall-${i}`,
          kind: 'income',
          status: 'planned',
          amountMinor: lever.kind === 'incomeAmount' ? lever.toMinor : s.range ? s.range.minMinor : s.amountMinor,
          currency: s.currency,
          date: lever.kind === 'incomeDate' ? lever.toDate : lever.occurrenceDate,
          accountId: s.accountId,
          categoryId: s.categoryId ?? 'other_income',
          createdAt: data.updatedAt,
          updatedAt: data.updatedAt,
        })
        break
      }
      case 'dailySpend':
        dailySpendMinor = lever.toMinor
        break
    }
  })
  return { data: { ...data, transactions: [...transactions, ...extra], schedules }, dailySpendMinor }
}

export function evaluateLevers(data: AppData, today: LocalDate, levers: ShortfallLever[], options: ShortfallOptions = {}): LeverEffect {
  const sim = simulateLevers(data, levers)
  const p = projectBalance(sim.data, today, { days: options.days ?? 30, dailySpendMinor: sim.dailySpendMinor ?? options.dailySpendMinor ?? 0, scenario: options.scenario ?? 'min' })
  const first = p.firstNegativeDate
  const obligations = first ? p.days.filter((d) => d.date <= first).flatMap((d) => d.events.filter((e) => e.budgetEffectMinor < 0 && e.source === 'schedule')) : []
  return { firstNegativeDate: first, shortfallMinor: Math.max(0, -p.lowest.minor), lowest: p.lowest, resolves: first === null && p.outOfRangeFrom === null, outOfRangeFrom: p.outOfRangeFrom, obligations }
}

export function analyzeShortfall(data: AppData, today: LocalDate, options: ShortfallOptions = {}): ShortfallAnalysis {
  const days = options.days ?? 30
  const dailySpendMinor = options.dailySpendMinor ?? 0
  const projection = projectBalance(data, today, { days, dailySpendMinor, scenario: options.scenario ?? 'min' })
  const first = projection.firstNegativeDate
  if (!first) return { status: 'none', projection }
  const firstDay = projection.days.find((d) => d.date === first)
  const firstNegativeMinor = firstDay ? -firstDay.endMinor : -projection.startMinor
  const events = projection.days.filter((d) => d.date <= first).flatMap((d) => d.events)
  const contributors: Contributor[] = events
    .filter((i) => i.budgetEffectMinor < 0)
    .map((item) => ({
      item,
      amountMinor: -item.budgetEffectMinor,
      role: item.direction === 'transfer' ? 'transfer' : item.source === 'planned' ? 'planned' : 'obligation',
      isEstimate: item.isEstimate,
    }))
  const incomes = projection.days.flatMap((d) => d.events).filter((i) => i.budgetEffectMinor > 0)
  const worst = { date: projection.lowest.date, shortfallMinor: Math.max(0, -projection.lowest.minor) }

  // Palancas propuestas (cada una se evalúa sola; la persona puede combinarlas).
  const proposals: ShortfallLever[] = []
  const lastDay = addDays(today, days - 1)
  const nextIncomeAfter = (date: LocalDate) => incomes.find((i) => i.date > date && i.source === 'schedule')?.date
  for (const c of contributors) {
    if (c.role !== 'planned') continue
    const tx = data.transactions.find((t) => t.id === c.item.sourceId)
    if (!tx || tx.status !== 'planned') continue
    const later = nextIncomeAfter(worst.date) ?? nextIncomeAfter(first)
    if (later && later > tx.date) proposals.push({ kind: 'postponePlanned', txId: tx.id, fromDate: tx.date, toDate: later })
    proposals.push({ kind: 'reducePlanned', txId: tx.id, fromMinor: tx.amountMinor, toMinor: Math.max(0, tx.amountMinor - worst.shortfallMinor) })
  }
  for (const inc of incomes) {
    if (inc.source !== 'schedule') continue
    const s = data.schedules.find((x) => x.id === inc.sourceId)
    if (!s) continue
    // Supuesto de fecha: ¿y si llegara el primer día negativo?
    if (inc.date > first) proposals.push({ kind: 'incomeDate', scheduleId: s.id, fromDate: inc.date, toDate: first })
    // Supuesto de importe: con rango, el esperado; con importe estimado, el que la persona escriba.
    if (s.range && inc.amountMinor < s.amountMinor) proposals.push({ kind: 'incomeAmount', scheduleId: s.id, occurrenceDate: inc.date, fromMinor: inc.amountMinor, toMinor: s.amountMinor })
    else if (s.amountIsEstimate && !s.range) proposals.push({ kind: 'incomeAmount', scheduleId: s.id, occurrenceDate: inc.date, fromMinor: inc.amountMinor, toMinor: inc.amountMinor })
  }
  if (dailySpendMinor > 0) {
    // Cuánto menos al día haría falta hasta el peor día (redondeado hacia arriba).
    const spanDays = Math.max(1, daysBetween(today, worst.date) + 1)
    const cut = Math.min(dailySpendMinor, ceilDiv(worst.shortfallMinor, spanDays))
    proposals.push({ kind: 'dailySpend', fromMinor: dailySpendMinor, toMinor: dailySpendMinor - cut })
  }
  const unique = proposals.filter((p, i) => proposals.findIndex((q) => JSON.stringify(q) === JSON.stringify(p)) === i && (p.kind !== 'incomeDate' || p.fromDate <= lastDay))
  const levers = unique.map((lever) => ({ lever, applicable: appliesToPlanning(lever, data), effect: evaluateLevers(data, today, [lever], options) }))

  return {
    status: 'shortfall',
    projection,
    firstNegativeDate: first,
    firstNegativeMinor,
    worst,
    contributors,
    contributorsTotalMinor: checkedSumMinor(contributors.map((c) => c.amountMinor)),
    incomesUntilFirstMinor: checkedSumMinor(incomes.filter((i) => i.date <= first).map((i) => i.budgetEffectMinor)),
    dailySpendTotalMinor: dailySpendMinor * (daysBetween(today, first) + 1),
    incomes,
    levers,
  }
}

/* ------------------------------------------------------------------ */
/* Aplicar a la planificación                                          */
/* ------------------------------------------------------------------ */

/** Huella de lo que una palanca va a cambiar: si cambió desde la simulación, hay conflicto. */
export function leverBasis(data: AppData, lever: ShortfallLever): string | null {
  if (lever.kind === 'postponePlanned' || lever.kind === 'reducePlanned') {
    const tx = data.transactions.find((t) => t.id === lever.txId)
    return tx && tx.status === 'planned' ? `${tx.amountMinor}|${tx.date}|${tx.updatedAt}` : null
  }
  if (lever.kind === 'incomeAmount') {
    const s = data.schedules.find((x) => x.id === lever.scheduleId)
    return s ? `${s.amountMinor}|${s.updatedAt}` : null
  }
  return null
}

export interface PlannedChange {
  lever: ShortfallLever
  /** `leverBasis` cuando se mostró la propuesta. */
  basis: string | null
}

/**
 * Aplica a la planificación las palancas aplicables, todas o ninguna. Si algún registro
 * cambió desde que se mostró la propuesta (o ya no existe), no se aplica nada y se dice cuál.
 * Nunca toca movimientos realizados ni pagos programados de gasto.
 */
export function applyShortfallPlan(data: AppData, changes: PlannedChange[], ctx: OpContext): OpResult<number> {
  const issues: Issue[] = []
  changes.forEach((c, i) => {
    if (!appliesToPlanning(c.lever, data)) issues.push({ path: `changes[${i}]`, code: 'notRevertible' })
    else if (leverBasis(data, c.lever) === null) issues.push({ path: `changes[${i}]`, code: 'notFound' })
    else if (leverBasis(data, c.lever) !== c.basis) issues.push({ path: `changes[${i}]`, code: 'revertConflict', params: { count: 1 } })
  })
  if (changes.length === 0) issues.push({ path: 'changes', code: 'required' })
  if (issues.length) return { ok: false, issues }
  let next = data
  for (const [i, { lever }] of changes.entries()) {
    let r: OpResult<unknown>
    if (lever.kind === 'postponePlanned' || lever.kind === 'reducePlanned') {
      const tx = next.transactions.find((t) => t.id === lever.txId)!
      // Reducir a 0 = quitar la compra prevista: va a la papelera (recuperable y en el historial).
      if (lever.kind === 'reducePlanned' && lever.toMinor <= 0) {
        const removed = deleteTransaction(next, tx.id, ctx)
        if (!removed.ok) return { ok: false, issues: removed.issues.map((x) => ({ ...x, path: `changes[${i}].${x.path}` })) }
        next = removed.data
        continue
      }
      const { createdAt: _c, updatedAt: _u, currency: _cur, realizedAt: _r, ...draft } = tx
      r = saveTransaction(next, { ...draft, ...(lever.kind === 'postponePlanned' ? { date: lever.toDate } : { amountMinor: lever.toMinor }) }, ctx)
    } else if (lever.kind === 'incomeAmount') {
      const s = next.schedules.find((x) => x.id === lever.scheduleId)!
      const { createdAt: _c, updatedAt: _u, currency: _cur, ...draft } = s
      r = saveSchedule(next, { ...draft, amountMinor: lever.toMinor }, ctx)
    } else return { ok: false, issues: [{ path: `changes[${i}]`, code: 'notRevertible' }] }
    if (!r.ok) return { ok: false, issues: r.issues.map((x) => ({ ...x, path: `changes[${i}].${x.path}` })) }
    next = r.data
  }
  return { ok: true, data: next, value: changes.length }
}
