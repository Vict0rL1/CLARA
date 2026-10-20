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
import type { AppData, HistoryChange, HistoryCollection, HistoryEntry, HistorySource, LocalDate, Settings } from './types'

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

function currentValue(data: AppData, collection: HistoryCollection, id: string): unknown {
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
 * Valor actual comparable con lo que registró un cambio. En ajustes solo cuentan las claves que la
 * entrada guardó: una entrada anterior a v13 no tiene `safeToSpend` y sigue pudiendo revertirse.
 */
function currentValueFor(data: AppData, c: HistoryChange): unknown {
  const current = currentValue(data, c.collection, c.id)
  if (c.collection !== 'settings' || !c.after || typeof c.after !== 'object') return current
  const all = current as Record<string, unknown>
  return Object.fromEntries(Object.keys(c.after).map((k) => [k, all[k] ?? null]))
}

/**
 * Un aplazamiento que la entrada dejó y que ya caducó puede haberse retirado solo (posponer otro aviso limpia los
 * caducados, `inbox.ts`): no es un cambio de la persona y no bloquea revertir (R5). Sin `today` no se aplica.
 */
function expiredSnoozeGone(data: AppData, c: HistoryChange, today: LocalDate | undefined): boolean {
  if (c.collection !== 'inboxSnoozed' || !today || !c.after || typeof c.after !== 'object') return false
  const until = (c.after as { until?: unknown }).until
  return typeof until === 'string' && until <= today && currentValue(data, c.collection, c.id) === null
}

/** Registros de la entrada que cambiaron después (impiden revertir sin pisar otros cambios). */
export function revertConflicts(data: AppData, entry: HistoryEntry, today?: LocalDate): HistoryChange[] {
  return entry.changes.filter((c) => !same(currentValueFor(data, c), c.after) && !expiredSnoozeGone(data, c, today))
}

/**
 * Estado candidato tras revertir la entrada (sin comprobar conflictos): cada registro vuelve a su valor anterior y,
 * R5, un aplazamiento devuelto por ESTA entrada que ya caducó no se resucita (la bandeja lo ignoraría y otro
 * aplazamiento lo limpiaría); los demás no se tocan. `today` solo hace falta para esa poda.
 */
function revertedState(data: AppData, entry: HistoryEntry, today?: LocalDate): AppData {
  let next = data
  for (const change of [...entry.changes].reverse()) next = setValue(next, change.collection, change.id, change.before)
  const touched = new Set(entry.changes.filter((c) => c.collection === 'inboxSnoozed').map((c) => c.id))
  if (touched.size > 0 && today) next = { ...next, inbox: { ...next.inbox, snoozed: next.inbox.snoozed.filter((s) => !touched.has(s.id) || s.until > today) } }
  return next
}

/** Un registro que seguiría apuntando a un programado que la reversión eliminaría (F-02). */
export interface RevertDependent {
  kind: 'template' | 'scenario' | 'goal' | 'snooze'
  id: string
  /** Nombre del registro (plantilla, escenario o meta); la fecha de la ocurrencia para un aplazamiento. */
  name: string
  scheduleId: string
}

/** Referencias de `data` a programados por id (las que la partición mueve y una reversión puede dejar colgadas). */
function scheduleReferences(data: AppData): RevertDependent[] {
  const out: RevertDependent[] = []
  for (const tpl of data.templates) {
    if (tpl.kind !== 'distribution') continue
    for (const l of tpl.lines) if (l.target.kind === 'payment') out.push({ kind: 'template', id: tpl.id, name: tpl.name, scheduleId: l.target.scheduleId })
  }
  for (const sc of data.scenarios) for (const c of sc.changes) if (c.type === 'scheduleAmount') out.push({ kind: 'scenario', id: sc.id, name: sc.name, scheduleId: c.scheduleId })
  for (const g of data.goals) if (g.plan?.link) out.push({ kind: 'goal', id: g.id, name: g.name, scheduleId: g.plan.link.scheduleId })
  for (const s of data.inbox.snoozed) {
    const m = /^due:schedule:(.+):(\d{4}-\d{2}-\d{2})$/.exec(s.id)
    if (m) out.push({ kind: 'snooze', id: s.id, name: m[2]!, scheduleId: m[1]! })
  }
  return out
}

/**
 * Auditoría de seguimiento (F-02): registros que, tras revertir, seguirían apuntando a un programado que la reversión
 * elimina (plantillas de distribución, escenarios, gastos planificados vinculados y aplazamientos). Pasa con una
 * entrada de partición grabada antes de v14 (solo instantáneas de programados) y con una plantilla o escenario creados
 * DESPUÉS de una partición corregida: las instantáneas de la entrada no los cubren. Solo cuentan las referencias que
 * hoy resuelven y dejarían de resolver (una línea que ya apuntaba a un programado borrado sigue siendo lo que era).
 * Vacío si la entrada no elimina ningún programado (ni se calcula el estado candidato).
 */
export function revertDependents(data: AppData, entry: HistoryEntry, today?: LocalDate): RevertDependent[] {
  if (!entry.changes.some((c) => c.collection === 'schedules' && c.before === null)) return []
  const next = revertedState(data, entry, today)
  const remaining = new Set(next.schedules.map((s) => s.id))
  const removed = new Set(data.schedules.filter((s) => !remaining.has(s.id)).map((s) => s.id))
  if (removed.size === 0) return []
  return scheduleReferences(next).filter((r) => removed.has(r.scheduleId))
}

export function canRevert(data: AppData, entry: HistoryEntry, today?: LocalDate): 'ok' | 'notRevertible' | 'alreadyReverted' | 'conflict' | 'dependents' {
  if (entry.source === 'replace' || entry.changes.length === 0) return 'notRevertible'
  // Una entrada SOLO de aplazamientos (grabada antes de R5) no se revierte: su reversión no dejaría rastro (no es un
  // cambio financiero) y la entrada volvería a ofrecerse como pendiente.
  if (entry.changes.every((c) => c.collection === 'inboxSnoozed')) return 'notRevertible'
  if (data.history.some((e) => e.revertOf === entry.id)) return 'alreadyReverted'
  if (revertConflicts(data, entry, today).length) return 'conflict'
  return revertDependents(data, entry, today).length ? 'dependents' : 'ok'
}

/**
 * Devuelve cada registro de la entrada a su valor anterior. Solo si nada cambió después; la
 * entrada que lo registra la añade quien guarda (`source: 'revert'`). Quien llama debe validar
 * los datos completos antes de guardar (p. ej. que no queden pagos liquidados dos veces).
 */
export function revertEntry(data: AppData, entryId: string, ctx: OpContext): OpResult<HistoryEntry> {
  const entry = data.history.find((e) => e.id === entryId)
  if (!entry) return { ok: false, issues: [{ path: 'history', code: 'notFound' }] }
  const status = canRevert(data, entry, ctx.today)
  if (status === 'notRevertible') return { ok: false, issues: [{ path: 'history', code: 'notRevertible' }] }
  if (status === 'alreadyReverted') return { ok: false, issues: [{ path: 'history', code: 'alreadyReverted' }] }
  if (status === 'conflict') return { ok: false, issues: [{ path: 'history', code: 'revertConflict', params: { count: revertConflicts(data, entry, ctx.today).length } }] }
  // F-02: nunca se elimina un programado al que otros registros seguirían apuntando; se dice cuántos y nada cambia.
  if (status === 'dependents') return { ok: false, issues: [{ path: 'history', code: 'revertDependents', params: { count: revertDependents(data, entry, ctx.today).length } }] }
  const next = revertedState(data, entry, ctx.today)
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
