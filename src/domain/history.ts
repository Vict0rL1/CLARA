/**
 * Historial local de cambios financieros (ver docs/STORAGE.md y docs/FORMULAS.md §26).
 *
 * Cada guardado compara el estado anterior con el nuevo y registra SOLO los registros
 * financieros que cambiaron, con su valor anterior y el nuevo. No hace falta tocar cada
 * operación: el historial sale de los datos, no de descripciones escritas a mano.
 *
 * - Es local y editable (viaja en las copias): no es un registro de auditoría inviolable.
 * - Revertir una entrada solo es posible si cada registro sigue exactamente como esa entrada
 *   lo dejó; si algo cambió después, se explica el conflicto y no se sobrescribe nada.
 * - Importar una copia o reiniciar la demo es un corte (`replace`): no se puede revertir ni
 *   reconstruir el estado anterior a ese punto.
 */
import { canChangeCurrency } from './currencyChange'
import { newId } from './ids'
import type { OpContext, OpResult } from './operations'
import type { AppData, HistoryChange, HistoryCollection, HistoryEntry, HistorySource, Settings } from './types'

/** Como mucho se conservan estas entradas; al superarlas sale la más antigua. */
export const HISTORY_MAX_ENTRIES = 1000

type ListCollection = Exclude<HistoryCollection, 'settings'>
const LISTS: readonly ListCollection[] = ['accounts', 'transactions', 'schedules', 'goals', 'trash', 'reconciliations', 'incomeDistributions', 'periodBudgets']
/** Ajustes que cambian cifras (el idioma o el formato de fecha no). */
const FINANCIAL_SETTINGS = ['currency', 'timeZone', 'fallbackHorizonDays'] as const
const SETTINGS_ID = 'settings'

type WithId = { id: string }

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

function financialSettings(s: Settings) {
  return Object.fromEntries(FINANCIAL_SETTINGS.map((k) => [k, s[k] ?? null]))
}

/** Registros financieros que cambiaron entre dos estados (en una pasada, por id). */
export function diffForHistory(prev: AppData, next: AppData): HistoryChange[] {
  const changes: HistoryChange[] = []
  for (const collection of LISTS) {
    const a = prev[collection] as WithId[]
    const b = next[collection] as WithId[]
    if (a === b) continue
    const before = new Map(a.map((x) => [x.id, x]))
    const seen = new Set<string>()
    for (const item of b) {
      seen.add(item.id)
      const old = before.get(item.id)
      if (old === item) continue
      if (!old) changes.push({ collection, id: item.id, before: null, after: item })
      else if (!same(old, item)) changes.push({ collection, id: item.id, before: old, after: item })
    }
    for (const [id, old] of before) if (!seen.has(id)) changes.push({ collection, id, before: old, after: null })
  }
  if (prev.settings !== next.settings) {
    const a = financialSettings(prev.settings)
    const b = financialSettings(next.settings)
    if (!same(a, b)) changes.push({ collection: 'settings', id: SETTINGS_ID, before: a, after: b })
  }
  return changes
}

export interface HistoryMeta {
  source?: HistorySource
  revertOf?: string
}

/**
 * Añade al nuevo estado la entrada que describe el cambio. Sin cambios financieros (y sin ser
 * un reemplazo) no se añade nada. Respeta el límite de entradas y mueve `historyStartedAt`
 * a la entrada más antigua conservada cuando se descartan las viejas.
 */
export function recordHistory(prev: AppData | null, next: AppData, now: string, meta: HistoryMeta = {}): AppData {
  const source = meta.source ?? 'app'
  if (!prev) return next
  const changes = source === 'replace' ? [] : diffForHistory(prev, next)
  if (changes.length === 0 && source !== 'replace') return next
  const entry: HistoryEntry = { id: newId(), at: now, source, changes, ...(meta.revertOf ? { revertOf: meta.revertOf } : {}) }
  // En un reemplazo el historial es el de los datos nuevos (p. ej. el de la copia importada).
  let history = [...next.history, entry]
  let historyStartedAt = next.historyStartedAt
  if (history.length > HISTORY_MAX_ENTRIES) {
    history = history.slice(history.length - HISTORY_MAX_ENTRIES)
    historyStartedAt = history[0]!.at
  }
  return { ...next, history, historyStartedAt }
}

/* ------------------------------------------------------------------ */
/* Revertir                                                            */
/* ------------------------------------------------------------------ */

function currentValue(data: AppData, collection: HistoryCollection, id: string): unknown {
  if (collection === 'settings') return financialSettings(data.settings)
  return (data[collection] as WithId[]).find((x) => x.id === id) ?? null
}

export function setValue(data: AppData, collection: HistoryCollection, id: string, value: unknown): AppData {
  if (collection === 'settings') return { ...data, settings: { ...data.settings, ...(value as Partial<Settings>) } }
  const list = data[collection] as WithId[]
  const index = list.findIndex((x) => x.id === id)
  let next: WithId[]
  if (value === null) next = list.filter((x) => x.id !== id)
  else if (index >= 0) next = list.map((x, i) => (i === index ? (value as WithId) : x))
  else next = [...list, value as WithId]
  return { ...data, [collection]: next }
}

/** Registros de la entrada que cambiaron después (impiden revertir sin pisar otros cambios). */
export function revertConflicts(data: AppData, entry: HistoryEntry): HistoryChange[] {
  return entry.changes.filter((c) => !same(currentValue(data, c.collection, c.id), c.after))
}

export function canRevert(data: AppData, entry: HistoryEntry): 'ok' | 'notRevertible' | 'alreadyReverted' | 'conflict' {
  if (entry.source === 'replace' || entry.changes.length === 0) return 'notRevertible'
  if (data.history.some((e) => e.revertOf === entry.id)) return 'alreadyReverted'
  return revertConflicts(data, entry).length ? 'conflict' : 'ok'
}

/**
 * Devuelve cada registro de la entrada a su valor anterior. Solo si nada cambió después; la
 * entrada que lo registra la añade quien guarda (`source: 'revert'`). Quien llama debe validar
 * los datos completos antes de guardar (p. ej. que no queden pagos liquidados dos veces).
 */
export function revertEntry(data: AppData, entryId: string, ctx: OpContext): OpResult<HistoryEntry> {
  const entry = data.history.find((e) => e.id === entryId)
  if (!entry) return { ok: false, issues: [{ path: 'history', code: 'notFound' }] }
  const status = canRevert(data, entry)
  if (status === 'notRevertible') return { ok: false, issues: [{ path: 'history', code: 'notRevertible' }] }
  if (status === 'alreadyReverted') return { ok: false, issues: [{ path: 'history', code: 'alreadyReverted' }] }
  if (status === 'conflict') return { ok: false, issues: [{ path: 'history', code: 'revertConflict', params: { count: revertConflicts(data, entry).length } }] }
  let next = data
  for (const change of [...entry.changes].reverse()) next = setValue(next, change.collection, change.id, change.before)
  // QA-01: deshacer un cambio de moneda es otro cambio de moneda: solo si no hay importes guardados.
  if (next.settings.currency !== data.settings.currency && !canChangeCurrency(data)) {
    return { ok: false, issues: [{ path: 'history', code: 'currencyMismatch', params: { expected: data.settings.currency } }] }
  }
  return { ok: true, data: { ...next, updatedAt: ctx.now }, value: entry }
}

/**
 * Estado ANTERIOR a una entrada, deshaciendo en orden inverso todas las posteriores (sin
 * comprobar conflictos: las entradas son consecutivas). `null` si hay un corte por medio.
 * Se usa para «¿Qué cambió?».
 */
export function stateBefore(data: AppData, entryIndex: number): AppData | null {
  const values: { collection: HistoryCollection; id: string; value: unknown }[] = []
  // En orden inverso: el último valor que queda para cada registro es el anterior a la
  // primera entrada deshecha.
  for (let i = data.history.length - 1; i >= entryIndex; i--) {
    const e = data.history[i]!
    if (e.source === 'replace') return null
    for (let j = e.changes.length - 1; j >= 0; j--) {
      const change = e.changes[j]!
      values.push({ collection: change.collection, id: change.id, value: change.before })
    }
  }
  return values.length ? setValues(data, values) : data
}

/**
 * Aplica muchos cambios de una vez: cada colección se reconstruye UNA vez (antes se copiaba la
 * lista entera por cada cambio: con 50.000 movimientos y 1.000 entradas tardaba segundos).
 * Si un registro aparece varias veces, gana el último valor de la lista.
 */
export function setValues(data: AppData, values: { collection: HistoryCollection; id: string; value: unknown }[]): AppData {
  const byCollection = new Map<HistoryCollection, Map<string, unknown>>()
  for (const v of values) {
    let m = byCollection.get(v.collection)
    if (!m) byCollection.set(v.collection, (m = new Map()))
    m.delete(v.id)
    m.set(v.id, v.value)
  }
  let next = data
  for (const [collection, m] of byCollection) {
    if (collection === 'settings') {
      for (const value of m.values()) next = setValue(next, 'settings', SETTINGS_ID, value)
      continue
    }
    const list = next[collection] as WithId[]
    const seen = new Set<string>()
    const out: WithId[] = []
    for (const item of list) {
      if (!m.has(item.id)) out.push(item)
      else {
        seen.add(item.id)
        const value = m.get(item.id)
        if (value !== null) out.push(value as WithId)
      }
    }
    for (const [id, value] of m) if (!seen.has(id) && value !== null) out.push(value as WithId)
    next = { ...next, [collection]: out }
  }
  return next
}

/** Aplica los cambios de una o varias entradas hacia delante (valor nuevo de cada registro). */
export function applyEntries(data: AppData, entries: HistoryEntry[]): AppData {
  return setValues(
    data,
    entries.flatMap((e) => e.changes.map((c) => ({ collection: c.collection, id: c.id, value: c.after }))),
  )
}

export function applyEntry(data: AppData, entry: HistoryEntry): AppData {
  return applyEntries(data, [entry])
}

export interface RecordHistoryItem {
  entryId: string
  at: string
  source: HistorySource
  kind: 'created' | 'updated' | 'deleted'
  /** Campos que cambiaron (sin `updatedAt`), para decir «cambió: importe, categoría». */
  fields: string[]
}

/**
 * Lo que el historial local guarda sobre UN registro, lo más reciente primero. Es honesto por
 * construcción: solo cubre desde que este dispositivo empezó a guardar historial (o desde el último
 * corte `replace`), y nunca inventa un «antes» que no se vio.
 */
export function historyOfRecord(data: Pick<AppData, 'history'>, collection: HistoryCollection, id: string): RecordHistoryItem[] {
  const out: RecordHistoryItem[] = []
  for (const entry of data.history) {
    for (const change of entry.changes) {
      if (change.collection !== collection || change.id !== id) continue
      const before = (change.before ?? null) as Record<string, unknown> | null
      const after = (change.after ?? null) as Record<string, unknown> | null
      const kind = before === null ? 'created' : after === null ? 'deleted' : 'updated'
      const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
      keys.delete('updatedAt')
      const fields = kind === 'updated' ? [...keys].filter((k) => !same(before?.[k], after?.[k])).sort() : []
      out.push({ entryId: entry.id, at: entry.at, source: entry.source, kind, fields })
    }
  }
  return out.sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
}
