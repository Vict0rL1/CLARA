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
import { newId } from './ids'
import type { AppData, HistoryChange, HistoryCollection, HistoryEntry, HistorySource, Settings } from './types'

/** Como mucho se conservan estas entradas; al superarlas sale la más antigua. */
export const HISTORY_MAX_ENTRIES = 1000

type ListCollection = Exclude<HistoryCollection, 'settings'>
// v14 (auditoría del PR #15, QA-05): también plantillas, escenarios y aplazamientos de la bandeja, que partir un
// programado reescribe; sin ellos, revertir la partición dejaba referencias al programado que desaparecía.
const LISTS: readonly ListCollection[] = ['accounts', 'transactions', 'schedules', 'goals', 'trash', 'reconciliations', 'incomeDistributions', 'periodBudgets', 'templates', 'scenarios', 'inboxSnoozed']
/** Ajustes que cambian cifras (el idioma o el formato de fecha no). */
// v13: `safeToSpend` lleva el colchón de seguridad, que cambia el disponible: sin registrarlo, «¿Qué cambió?» no lo vería.
const FINANCIAL_SETTINGS = ['currency', 'timeZone', 'fallbackHorizonDays', 'safeToSpend'] as const
const SETTINGS_ID = 'settings'

type WithId = { id: string }

/** La lista de una colección del historial (`inboxSnoozed` vive dentro de `inbox`). */
function listOf(data: AppData, collection: ListCollection): WithId[] {
  return collection === 'inboxSnoozed' ? data.inbox.snoozed : (data[collection] as WithId[])
}

function withList(data: AppData, collection: ListCollection, list: WithId[]): AppData {
  if (collection === 'inboxSnoozed') return { ...data, inbox: { ...data.inbox, snoozed: list as AppData['inbox']['snoozed'] } }
  return { ...data, [collection]: list }
}

/**
 * Igualdad de valores guardados, sin depender del orden de las claves (al recargar, el
 * almacenamiento reconstruye cada registro con sus claves en otro orden) y tratando una clave con
 * `undefined` como ausente, igual que al serializar. Antes se comparaba `JSON.stringify` y un
 * registro recién guardado parecía «cambiado después» tras recargar (no se podía revertir).
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((x, i) => sameValue(x, bb[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ka = Object.keys(ao).filter((k) => ao[k] !== undefined)
  const kb = Object.keys(bo).filter((k) => bo[k] !== undefined)
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && sameValue(ao[k], bo[k]))
}
const same = sameValue

function financialSettings(s: Settings) {
  return Object.fromEntries(FINANCIAL_SETTINGS.map((k) => [k, s[k] ?? null]))
}

/** Registros financieros que cambiaron entre dos estados (en una pasada, por id). */
export function diffForHistory(prev: AppData, next: AppData): HistoryChange[] {
  const changes: HistoryChange[] = []
  for (const collection of LISTS) {
    const a = listOf(prev, collection)
    const b = listOf(next, collection)
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
  // Revisión propia (R5): los aplazamientos de la bandeja solo acompañan a otros cambios (p. ej. los que renombra
  // partir un programado). Posponer o retirar un aviso no es un cambio financiero: no gasta entradas del historial.
  if (changes.length > 0 && changes.every((c) => c.collection === 'inboxSnoozed')) return []
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

export function currentValue(data: AppData, collection: HistoryCollection, id: string): unknown {
  if (collection === 'settings') return financialSettings(data.settings)
  return listOf(data, collection).find((x) => x.id === id) ?? null
}

export function setValue(data: AppData, collection: HistoryCollection, id: string, value: unknown): AppData {
  if (collection === 'settings') return { ...data, settings: { ...data.settings, ...(value as Partial<Settings>) } }
  const list = listOf(data, collection)
  const index = list.findIndex((x) => x.id === id)
  let next: WithId[]
  if (value === null) next = list.filter((x) => x.id !== id)
  else if (index >= 0) next = list.map((x, i) => (i === index ? (value as WithId) : x))
  else next = [...list, value as WithId]
  return withList(data, collection, next)
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
    const list = listOf(next, collection)
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
    next = withList(next, collection, out)
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
