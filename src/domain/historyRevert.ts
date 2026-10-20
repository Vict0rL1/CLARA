/**
 * Revertir una entrada del historial (v8): conflictos (algo cambió después), dependientes (F-02: nada seguiría
 * apuntando a un programado que desaparece), aplazamientos caducados (R5) y el estado anterior a una entrada para
 * «¿Qué cambió?». Separado de `history.ts` porque solo lo usan pantallas que se cargan aparte (Historial, Plan ante
 * faltante, ¿Qué cambió?): así no cuenta en el presupuesto de tamaño del JS inicial (`npm run size`).
 */
import { canChangeCurrency } from './currencyChange'
import { currentValue, sameValue, setValue, setValues } from './history'
import type { OpContext, OpResult } from './operations'
import type { AppData, HistoryChange, HistoryCollection, HistoryEntry, LocalDate } from './types'

const same = sameValue

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
