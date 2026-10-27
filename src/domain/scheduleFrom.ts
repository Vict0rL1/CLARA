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
 *
 * v14 (auditoría del PR #15, QA-01): el tramo nuevo conserva la fecha que fija la serie (`anchorDate`) cuando no
 * cambia la regla, así sus ocurrencias son exactamente las de siempre desde la fecha elegida; `startDate` es solo
 * el límite desde el que cuenta.
 */
import { addDays, isValidLocalDate } from './dates'
import { saveSchedule, touch, type OpContext, type OpResult, type ScheduleDraft } from './operations'
import { anchorOf, defaultSecondDay, occurrencesBetween } from './recurrence'
import { nextPendingOccurrence } from './repeat'
import type { AppData, LocalDate, Schedule } from './types'
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

/** La regla de repetición tal como la manda el formulario (frecuencia, intervalo y segundo día) con la fecha elegida. */
export type RuleDraft = Pick<Schedule, 'frequency' | 'startDate'> & Partial<Pick<Schedule, 'intervalDays' | 'secondDay'>>

/** ¿El borrador repite con la misma regla que el programado (frecuencia, intervalo y segundo día; la fecha no cuenta)? */
export function sameRule(old: Schedule, rule: RuleDraft): boolean {
  if (rule.frequency !== old.frequency) return false
  if (old.frequency === 'custom' && (rule.intervalDays ?? null) !== (old.intervalDays ?? null)) return false
  if (old.frequency === 'semimonthly') {
    const fallback = defaultSecondDay(anchorOf(old))
    if ((rule.secondDay ?? fallback) !== (old.secondDay ?? fallback)) return false
  }
  return true
}

/** ¿`date` es una fecha de la serie (contando las omitidas y sin mirar la fecha de fin)? */
export function isSeriesDate(schedule: Schedule, date: LocalDate): boolean {
  return isValidLocalDate(date) && occurrencesBetween({ ...schedule, endDate: undefined }, date, date).length > 0
}

/**
 * Auditoría del PR #15 (QA-01): al partir «desde una fecha» SIN cambiar la regla (misma frecuencia, intervalo y
 * segundo día) en una fecha de la serie, el tramo nuevo conserva la fecha que fija la serie (`anchorDate` = la de
 * siempre): sus ocurrencias desde la fecha elegida son exactamente las que ya había (el 31 sigue siendo el 31
 * aunque la fecha elegida sea un 28-feb movido; 1 y 20 siguen siendo 1 y 20; una serie semanal conserva su día).
 * Cambiar la regla, o elegir una fecha que no es de la serie, reancla la serie en esa fecha: es un cambio
 * explícito y el formulario lo dice.
 */
export function splitKeepsAnchor(old: Schedule, rule: RuleDraft): boolean {
  return old.frequency !== 'once' && sameRule(old, rule) && isSeriesDate(old, rule.startDate)
}

/** La fecha que fija el tramo nuevo: la de siempre si se conservan las fechas; si no, la elegida. */
export function splitAnchor(old: Schedule, rule: RuleDraft): LocalDate {
  return splitKeepsAnchor(old, rule) ? anchorOf(old) : rule.startDate
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
    // Revisión propia (R1): también al reintentar el tramo conserva la fecha que fija la serie; guardar el
    // borrador tal cual la perdía y la serie nueva volvía a contarse desde la fecha elegida.
    const anchor = splitAnchor(old, draft)
    const r = saveSchedule(data, { ...draft, anchorDate: anchor !== draft.startDate ? anchor : undefined }, ctx)
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
  // QA-01 (auditoría del PR #15): sin cambiar la regla, el tramo nuevo conserva la fecha que fija la serie.
  const anchor = splitAnchor(old, draft)
  const created = saveSchedule(
    { ...data, schedules: data.schedules.map((s) => (s.id === old.id ? ended : s)) },
    { ...draft, skippedDates: old.skippedDates.filter((d) => d >= from), anchorDate: anchor !== from ? anchor : undefined },
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
