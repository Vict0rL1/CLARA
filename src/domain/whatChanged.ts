/**
 * «¿Qué cambió?»: por qué el disponible de hoy es distinto del de un momento anterior
 * (ver docs/FORMULAS.md §27).
 *
 * Método (exacto por construcción, sin inventar causas):
 *   1. Estado anterior S0 = estado actual deshaciendo las entradas del historial posteriores
 *      al punto elegido (`stateBefore`). Si hay un corte (`replace`) por medio, no se compara.
 *   2. Se rehacen las entradas una a una (S1 … Sn) y se calcula el disponible de cada estado
 *      con la MISMA fecha anterior t0. La diferencia de cada paso se atribuye a esa entrada.
 *   3. Paso del tiempo: disponible(Sn, hoy) − disponible(Sn, t0). Con los mismos datos, solo
 *      cambian los pagos que entran en el periodo y el horizonte.
 *   4. Sin explicar: disponible(datos actuales, hoy) − disponible(Sn, hoy). Debe ser 0; si no
 *      lo es (p. ej. un cambio guardado fuera del historial), se muestra tal cual.
 *
 *   Diferencia total = Σ pasos + tiempo + sin explicar   (siempre, al céntimo)
 */
import { computeBudget, type BudgetResult } from './budget'
import { addDays, localDateInTimeZone } from './dates'
import { applyEntries } from './history'
import { stateBefore } from './historyRevert'
import type { PlanItem } from './planItems'
import type { AppData, HistoryEntry, LocalDate, Timestamp, Transaction } from './types'
import { sumMinor } from './money'

/** Como mucho se calculan estos pasos; si hay más entradas, se agrupan las consecutivas de la misma clase. */
export const WHAT_CHANGED_MAX_STEPS = 40

export type ChangeCategory =
  | 'expenses'
  | 'income'
  | 'refunds'
  | 'transfers'
  | 'payments'
  | 'reserves'
  | 'commitments'
  | 'adjustments'
  | 'accounts'
  | 'edits'
  | 'settings'
  | 'mixed'

export const CHANGE_CATEGORIES: readonly ChangeCategory[] = ['income', 'expenses', 'refunds', 'payments', 'transfers', 'reserves', 'commitments', 'adjustments', 'accounts', 'edits', 'settings', 'mixed']

export type ComparePoint = { kind: 'date'; date: LocalDate } | { kind: 'index'; index: number }

export interface ChangeStep {
  category: ChangeCategory
  entries: HistoryEntry[]
  deltaMinor: number
  dailyDeltaMinor: number | null
}

export interface TimeEffect {
  deltaMinor: number
  /** Pagos reservados hoy que no lo estaban en la fecha anterior (entraron en el periodo). */
  entered: PlanItem[]
  /** Pagos reservados entonces que hoy ya no lo están. */
  left: PlanItem[]
  /** Parte del efecto del tiempo no explicada por esas listas (p. ej. cobertura por metas). */
  otherMinor: number
  dailyDeltaMinor: number | null
}

export type WhatChangedResult =
  | {
      status: 'ok'
      fromDate: LocalDate
      /** Instante desde el que se cuentan los cambios (`null` = inicio del día `fromDate`). */
      fromAt: Timestamp | null
      toDate: LocalDate
      from: BudgetResult
      to: BudgetResult
      totalMinor: number
      steps: ChangeStep[]
      byCategory: { category: ChangeCategory; deltaMinor: number; entries: number }[]
      time: TimeEffect
      unexplainedMinor: number
      daily: { fromMinor: number; toMinor: number; changesMinor: number; timeMinor: number; unexplainedMinor: number } | null
      /** Entradas sin efecto en el disponible (p. ej. una edición de nota). */
      neutralEntries: number
    }
  | { status: 'beforeHistory'; earliestDate: LocalDate; historyStartedAt: Timestamp }
  | { status: 'cut'; cutAt: Timestamp }
  | { status: 'future' }

const isTrashRestore = (entry: HistoryEntry, id: string) => entry.changes.some((c) => c.collection === 'trash' && c.id === id && c.after === null)

/** Clase de una entrada según el registro principal que cambió. */
export function classifyEntry(entry: HistoryEntry): ChangeCategory {
  if (entry.source === 'revert') return 'edits'
  const txChanges = entry.changes.filter((c) => c.collection === 'transactions')
  const created = txChanges.find((c) => c.before === null && !isTrashRestore(entry, c.id))
  if (created) {
    const tx = created.after as Transaction
    if (tx.kind === 'adjustment') return 'adjustments'
    if (tx.scheduleId && tx.kind !== 'income') return 'payments'
    if (tx.kind === 'income') return 'income'
    if (tx.kind === 'refund') return 'refunds'
    if (tx.kind === 'transfer') return 'transfers'
    return 'expenses'
  }
  if (txChanges.length > 0) return 'edits'
  const collections = new Set(entry.changes.map((c) => c.collection))
  if (collections.has('reconciliations')) return 'adjustments'
  if (collections.has('goals') || collections.has('incomeDistributions') || collections.has('periodBudgets')) return 'reserves'
  if (collections.has('schedules')) return 'commitments'
  if (collections.has('accounts')) return 'accounts'
  if (collections.has('settings')) return 'settings'
  return 'edits'
}

/** Índice de la primera entrada que queda después del punto elegido. */
export function resolveComparePoint(
  data: AppData,
  point: ComparePoint,
): { status: 'ok'; index: number; fromDate: LocalDate; fromAt: Timestamp | null } | Exclude<WhatChangedResult, { status: 'ok' }> {
  const tz = data.settings.timeZone
  const dateOf = (at: Timestamp) => localDateInTimeZone(new Date(at), tz)
  let index: number
  let fromDate: LocalDate
  let fromAt: Timestamp | null = null
  if (point.kind === 'index') {
    index = Math.max(0, Math.min(point.index, data.history.length))
    fromAt = index === 0 ? data.historyStartedAt : data.history[index - 1]!.at
    fromDate = dateOf(fromAt)
  } else {
    fromDate = point.date
    // Lo registrado antes de que empezara el historial ese mismo día no se puede deshacer.
    const startDate = dateOf(data.historyStartedAt)
    if (fromDate <= startDate) return { status: 'beforeHistory', earliestDate: addDays(startDate, 1), historyStartedAt: data.historyStartedAt }
    index = data.history.findIndex((e) => dateOf(e.at) >= fromDate)
    if (index < 0) index = data.history.length
  }
  for (let i = data.history.length - 1; i >= index; i--) {
    if (data.history[i]!.source === 'replace') return { status: 'cut', cutAt: data.history[i]!.at }
  }
  return { status: 'ok', index, fromDate, fromAt }
}

/** Agrupa entradas consecutivas de la misma clase cuando hay demasiadas (el total no cambia). */
function groupEntries(entries: HistoryEntry[]): { category: ChangeCategory; entries: HistoryEntry[] }[] {
  let groups = entries.map((e) => ({ category: classifyEntry(e), entries: [e] }))
  if (groups.length <= WHAT_CHANGED_MAX_STEPS) return groups
  const merged: typeof groups = []
  for (const g of groups) {
    const last = merged[merged.length - 1]
    if (last && last.category === g.category) last.entries.push(...g.entries)
    else merged.push({ ...g, entries: [...g.entries] })
  }
  groups = merged
  if (groups.length <= WHAT_CHANGED_MAX_STEPS) return groups
  const size = Math.ceil(groups.length / WHAT_CHANGED_MAX_STEPS)
  const chunks: typeof groups = []
  for (let i = 0; i < groups.length; i += size) {
    const part = groups.slice(i, i + size)
    const categories = new Set(part.map((g) => g.category))
    chunks.push({ category: categories.size === 1 ? part[0]!.category : 'mixed', entries: part.flatMap((g) => g.entries) })
  }
  return chunks
}

const reservedKey = (b: BudgetResult) => new Map(b.reservedItems.map((i) => [i.key, i]))
const reservedAmount = (b: BudgetResult, i: PlanItem) => -i.budgetEffectMinor - (b.coveredByGoals.get(i.key) ?? 0)

function dailyDiff(a: BudgetResult, b: BudgetResult): number | null {
  return a.dailyMinor === null || b.dailyMinor === null ? null : b.dailyMinor - a.dailyMinor
}

/** Avance del cálculo: pasos ya rehechos de un total conocido desde el principio. */
export interface WhatChangedProgress {
  done: number
  total: number
}

/**
 * El mismo cálculo, paso a paso: cede el control después de cada `computeBudget` para que la
 * pantalla pueda repartirlo en trozos sin bloquearse. El resultado es idéntico a `whatChanged`.
 */
export function* whatChangedSteps(data: AppData, today: LocalDate, point: ComparePoint): Generator<WhatChangedProgress, WhatChangedResult, void> {
  const resolved = resolveComparePoint(data, point)
  if (resolved.status !== 'ok') return resolved
  const { index, fromDate, fromAt } = resolved
  if (fromDate > today) return { status: 'future' }
  const start = stateBefore(data, index)
  if (!start) return { status: 'cut', cutAt: data.history[index]?.at ?? data.historyStartedAt }

  const groups = groupEntries(data.history.slice(index))
  // Un cálculo del disponible por paso, más el inicial, el de hoy rehecho y el actual.
  const total = groups.length + 3
  const from = computeBudget(start, fromDate)
  yield { done: 1, total }
  const steps: ChangeStep[] = []
  let state = start
  let prev = from
  let neutralEntries = 0
  for (const group of groups) {
    state = applyEntries(state, group.entries)
    const next = computeBudget(state, fromDate)
    const deltaMinor = next.availableMinor - prev.availableMinor
    if (deltaMinor === 0 && group.entries.length === 1) neutralEntries++
    steps.push({ category: group.category, entries: group.entries, deltaMinor, dailyDeltaMinor: dailyDiff(prev, next) })
    prev = next
    yield { done: steps.length + 1, total }
  }

  // Paso del tiempo: mismos datos, distinta fecha.
  const replayedToday = computeBudget(state, today)
  yield { done: total - 1, total }
  const timeDelta = replayedToday.availableMinor - prev.availableMinor
  const before = reservedKey(prev)
  const after = reservedKey(replayedToday)
  const entered = replayedToday.reservedItems.filter((i) => !before.has(i.key))
  const left = prev.reservedItems.filter((i) => !after.has(i.key))
  const listed = sumMinor(left.map((i) => reservedAmount(prev, i))) - sumMinor(entered.map((i) => reservedAmount(replayedToday, i)))
  const time: TimeEffect = { deltaMinor: timeDelta, entered, left, otherMinor: timeDelta - listed, dailyDeltaMinor: dailyDiff(prev, replayedToday) }

  const to = computeBudget(data, today)
  const unexplainedMinor = to.availableMinor - replayedToday.availableMinor

  const byCategory = CHANGE_CATEGORIES.map((category) => {
    const own = steps.filter((s) => s.category === category)
    return { category, deltaMinor: sumMinor(own.map((s) => s.deltaMinor)), entries: sumMinor(own.map((s) => s.entries.length)) }
  }).filter((c) => c.entries > 0)

  const daily =
    from.dailyMinor !== null && to.dailyMinor !== null && prev.dailyMinor !== null && replayedToday.dailyMinor !== null
      ? {
          fromMinor: from.dailyMinor,
          toMinor: to.dailyMinor,
          changesMinor: prev.dailyMinor - from.dailyMinor,
          timeMinor: replayedToday.dailyMinor - prev.dailyMinor,
          unexplainedMinor: to.dailyMinor - replayedToday.dailyMinor,
        }
      : null

  return {
    status: 'ok',
    fromDate,
    fromAt,
    toDate: today,
    from,
    to,
    totalMinor: to.availableMinor - from.availableMinor,
    steps,
    byCategory,
    time,
    unexplainedMinor,
    daily,
    neutralEntries,
  }
}

export function whatChanged(data: AppData, today: LocalDate, point: ComparePoint): WhatChangedResult {
  const run = whatChangedSteps(data, today, point)
  for (;;) {
    const step = run.next()
    if (step.done) return step.value
  }
}
