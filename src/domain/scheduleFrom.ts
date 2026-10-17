/**
 * Cambiar un programado «desde una fecha» (Clara 2.0 §12, fase 3).
 *
 * Editar un programado cambia toda la serie, también las fechas vencidas sin marcar. Para que un cambio
 * valga solo de aquí en adelante (la renta sube en noviembre, el sueldo cambia de día), la serie se parte
 * en dos registros normales, sin campos nuevos:
 *
 * - el programado de siempre termina el día ANTES de la fecha elegida (`endDate`) y conserva su historia:
 *   pagos registrados, vencidas sin marcar y omitidas anteriores siguen igual y con su importe;
 * - uno nuevo (con el id que el formulario generó al abrirse) empieza en esa fecha con los valores nuevos y
 *   se lleva las omitidas posteriores.
 *
 * Nunca deja vínculos rotos: si ya hay un pago registrado (también parcial) en la fecha elegida o después,
 * se rechaza y se dice cuál. Lo que mira hacia delante pasa al nuevo solo si el nuevo tiene esa misma
 * ocurrencia (gastos planificados vinculados, aplazamientos de la bandeja) o siempre (plantillas de
 * distribución y escenarios guardados, que apuntan a «el próximo pago»); un gasto planificado vinculado a
 * una fecha que dejaría de existir se rechaza. Es una sola operación: todo o nada.
 */
import { addDays, isValidLocalDate, parseLocalDate } from './dates'
import { saveSchedule, touch, type OpContext, type OpResult, type ScheduleDraft } from './operations'
import { defaultSecondDay, occurrencesBetween } from './recurrence'
import { nextPendingOccurrence } from './repeat'
import type { AppData, Frequency, LocalDate, Schedule } from './types'
import type { Issue } from './validation'

const fail = (issues: Issue[]): { ok: false; issues: Issue[] } => ({ ok: false, issues })

/** Fecha de la última ocurrencia con un movimiento realizado vinculado (también cobros parciales). */
export function lastLinkedOccurrence(data: Pick<AppData, 'transactions'>, scheduleId: string): LocalDate | null {
  let last: LocalDate | null = null
  for (const t of data.transactions) {
    if (t.status === 'realized' && t.scheduleId === scheduleId && t.occurrenceDate && (!last || t.occurrenceDate > last)) last = t.occurrenceDate
  }
  return last
}

/**
 * Fecha que se propone para «desde»: la primera ocurrencia pendiente desde hoy (y después del último pago
 * registrado). `null` si no tiene sentido partir la serie: pago único, ninguna fecha posterior a la primera
 * o la serie ya terminó.
 */
export function defaultSplitDate(data: Pick<AppData, 'transactions'>, schedule: Schedule, today: LocalDate): LocalDate | null {
  if (schedule.frequency === 'once') return null
  const last = lastLinkedOccurrence(data, schedule.id)
  const from = last && last >= today ? addDays(last, 1) : today
  const date = nextPendingOccurrence(data, schedule, from)
  return date && date > schedule.startDate ? date : null
}

/** Qué día nominal de una serie de calendario representa una fecha, y si está movido al final de un mes corto. */
export interface OccurrenceAnchor {
  /** El día del mes que dice la serie (el de `startDate` o `secondDay`). */
  nominalDay: number
  which: 'first' | 'second'
  /** La fecha es el último día de un mes que no tiene `nominalDay` (31 → 30-sep, 31 → 28-feb). */
  clamped: boolean
}

const CALENDAR_FREQUENCIES: ReadonlySet<Frequency> = new Set<Frequency>(['monthly', 'quarterly', 'yearly', 'semimonthly'])
/** Cuánto se mira hacia delante para proponer una fecha que conserva el día (un ciclo bisiesto completo). */
const KEEP_LOOKAHEAD_DAYS = 1500

/**
 * Día nominal de `date` en una serie mensual, trimestral, anual o «dos veces al mes»; `null` si la fecha no es
 * una ocurrencia de la serie o la serie no va por días del mes (diaria, semanal…).
 */
export function occurrenceAnchor(schedule: Schedule, date: LocalDate): OccurrenceAnchor | null {
  if (!CALENDAR_FREQUENCIES.has(schedule.frequency) || !isValidLocalDate(date)) return null
  if (occurrencesBetween(schedule, date, date).length === 0) return null
  const day = parseLocalDate(date).day
  const first = parseLocalDate(schedule.startDate).day
  if (schedule.frequency !== 'semimonthly') return { nominalDay: first, which: 'first', clamped: day < first }
  const second = schedule.secondDay ?? defaultSecondDay(schedule.startDate)
  if (day === first) return { nominalDay: first, which: 'first', clamped: false }
  if (day === second) return { nominalDay: second, which: 'second', clamped: false }
  // Un día que este mes no tiene: el mayor de los dos, movido a su último día.
  return first > second ? { nominalDay: first, which: 'first', clamped: true } : { nominalDay: second, which: 'second', clamped: true }
}

/**
 * QA V2 (SCH-01): el segundo día del tramo nuevo al partir un «dos veces al mes» en `from`. El tramo nuevo empieza
 * en `from`, así que su primer día es el de `from`; el segundo tiene que ser el OTRO día nominal de la serie. Si
 * `from` cae en el segundo día (15 y 30, desde el 30), el segundo pasa a ser el primero (15): sin esto quedaban
 * 30 y 30 y no se podía guardar. También con el segundo día implícito (vacío = 15 días después), que si no
 * cambiaría solo (1 y 16, desde el 16, daría 16 y 31). `null` si no hay nada que reanclar.
 */
export function splitSecondDay(schedule: Schedule, from: LocalDate): number | null {
  if (schedule.frequency !== 'semimonthly') return null
  const anchor = occurrenceAnchor(schedule, from)
  if (!anchor) return null
  return anchor.which === 'first' ? (schedule.secondDay ?? defaultSecondDay(schedule.startDate)) : parseLocalDate(schedule.startDate).day
}

/**
 * Borde de fin de mes (QA V2, revisado aparte de SCH-01): partir la serie en una fecha MOVIDA (el 31 que cae el
 * 30-sep) hace que el tramo nuevo empiece ese día y, como el modelo toma el día de `startDate`, se repita el 30
 * también en los meses de 31 días. El modelo de recurrencia no cambia: se dice, con la siguiente fecha que sí
 * conserva el día nominal (`keepFrom`), y la persona decide. `null` si la fecha no está movida.
 */
export function splitAnchorDrift(schedule: Schedule, from: LocalDate): { nominalDay: number; day: number; keepFrom: LocalDate | null } | null {
  const anchor = occurrenceAnchor(schedule, from)
  if (!anchor?.clamped) return null
  const keepFrom = occurrencesBetween(schedule, addDays(from, 1), addDays(from, KEEP_LOOKAHEAD_DAYS)).find((d) => occurrenceAnchor(schedule, d)?.clamped === false) ?? null
  return { nominalDay: anchor.nominalDay, day: parseLocalDate(from).day, keepFrom }
}

export interface ScheduleSplit {
  /** El programado de siempre, ahora con `endDate` = día anterior a `next.startDate`. */
  ended: Schedule
  next: Schedule
}

function hasOccurrence(schedule: Schedule, date: LocalDate): boolean {
  return !schedule.skippedDates.includes(date) && occurrencesBetween(schedule, date, date).length > 0
}

export function saveScheduleFrom(data: AppData, scheduleId: string, draft: ScheduleDraft, ctx: OpContext): OpResult<ScheduleSplit> {
  const old = data.schedules.find((s) => s.id === scheduleId)
  if (!old) return fail([{ path: 'id', code: 'notFound' }])
  if (draft.id === old.id) return fail([{ path: 'id', code: 'notFound' }])
  // Guardar dos veces (el id del nuevo se genera al abrir el formulario): el nuevo ya existe y se actualiza.
  if (data.schedules.some((s) => s.id === draft.id)) {
    const r = saveSchedule(data, draft, ctx)
    return r.ok ? { ...r, value: { ended: old, next: r.value } } : r
  }
  if (old.frequency === 'once') return fail([{ path: 'startDate', code: 'splitNotRecurring' }])
  const from = draft.startDate
  if (!isValidLocalDate(from)) return fail([{ path: 'startDate', code: 'invalidDate' }])
  if (from <= old.startDate) return fail([{ path: 'startDate', code: 'splitNotAfterStart', params: { date: old.startDate } }])
  if (old.endDate && from > old.endDate) return fail([{ path: 'startDate', code: 'splitAfterEnd', params: { date: old.endDate } }])
  const settled = lastLinkedOccurrence(data, old.id)
  if (settled && settled >= from) return fail([{ path: 'startDate', code: 'splitSettledAfter', params: { date: settled } }])

  const ended: Schedule = { ...old, endDate: addDays(from, -1), skippedDates: old.skippedDates.filter((d) => d < from), updatedAt: ctx.now }
  const created = saveSchedule(
    { ...data, schedules: data.schedules.map((s) => (s.id === old.id ? ended : s)) },
    { ...draft, skippedDates: old.skippedDates.filter((d) => d >= from) },
    ctx,
  )
  if (!created.ok) return created
  const next = created.value

  // Gastos planificados abiertos vinculados a una fecha desde `from`: pasan al nuevo si sigue existiendo.
  let goals = created.data.goals
  for (const g of goals) {
    const link = g.plan?.link
    if (!link || link.scheduleId !== old.id || link.occurrenceDate < from || g.plan?.paidAt) continue
    if (!hasOccurrence(next, link.occurrenceDate)) return fail([{ path: 'startDate', code: 'splitLinkedGoal', params: { name: g.name, date: link.occurrenceDate } }])
  }
  goals = goals.map((g) => {
    const link = g.plan?.link
    if (!g.plan || !link || link.scheduleId !== old.id || link.occurrenceDate < from || g.plan.paidAt) return g
    return { ...g, plan: { ...g.plan, link: { ...link, scheduleId: next.id } }, updatedAt: ctx.now }
  })

  // Lo que apunta a «el próximo pago» de esta serie sigue a la serie.
  const templates = created.data.templates.map((tpl) =>
    tpl.kind === 'distribution' && tpl.lines.some((l) => l.target.kind === 'payment' && l.target.scheduleId === old.id)
      ? { ...tpl, lines: tpl.lines.map((l) => (l.target.kind === 'payment' && l.target.scheduleId === old.id ? { ...l, target: { kind: 'payment' as const, scheduleId: next.id } } : l)), updatedAt: ctx.now }
      : tpl,
  )
  const scenarios = created.data.scenarios.map((sc) =>
    sc.changes.some((c) => c.type === 'scheduleAmount' && c.scheduleId === old.id)
      ? { ...sc, changes: sc.changes.map((c) => (c.type === 'scheduleAmount' && c.scheduleId === old.id ? { ...c, scheduleId: next.id } : c)), updatedAt: ctx.now }
      : sc,
  )
  // Un vencido aplazado desde `from` que sigue existiendo en el nuevo conserva su aplazamiento.
  const prefix = `due:schedule:${old.id}:`
  const snoozed = created.data.inbox.snoozed.map((s) => {
    if (!s.id.startsWith(prefix)) return s
    const date = s.id.slice(prefix.length)
    return date >= from && hasOccurrence(next, date) ? { ...s, id: `due:schedule:${next.id}:${date}` } : s
  })

  return {
    ok: true,
    data: touch({ ...created.data, goals, templates, scenarios, inbox: { ...created.data.inbox, snoozed } }, ctx.now),
    value: { ended, next },
  }
}
