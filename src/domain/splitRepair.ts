/**
 * Revisión de particiones antiguas (auditoría independiente de seguimiento, QA-01 histórico).
 *
 * Antes de v14, partir una serie «desde una fecha» cambiando solo el importe hacía que el tramo nuevo contara desde la
 * fecha elegida: un sueldo del 31 partido el 28-feb (el 31 movido) pasaba a cobrarse el 28. La migración 13 → 14 no
 * lo corrige (no adivina intenciones ni reescribe fechas): aquí se DETECTAN esas particiones y se propone, con
 * confirmación, devolverles la fecha que fijaba la serie de siempre (`anchorDate`). Declinar deja el 28 tal cual.
 *
 * Se señala un tramo B solo cuando todo esto se cumple (conservador: ante la duda, nada):
 * - B repite y sigue activo (sin fin o con fin desde hoy), y no tiene `anchorDate` o lo HEREDÓ tal cual del tramo
 *   anterior (revisión financiera F-R2: partir en v14 un tramo que aún contaba desde la fecha movida conserva esa fecha
 *   movida como `anchorDate`; la cadena sigue siendo la misma partición antigua y se sigue revisando);
 * - hay un tramo A del mismo nombre y tipo, con la misma regla, que termina el día antes de que B empiece;
 * - B empieza en una fecha de la serie de A (una partición en una fecha ajena a la serie es un reanclaje explícito);
 * - con la fecha de siempre, las próximas ocurrencias de B serían OTRAS (si coinciden no hay nada que reparar).
 * La fecha de siempre se toma del primer tramo de la cadena (A pudo ser a su vez un tramo partido): se sube por los
 * tramos que heredaron su fecha (sin `anchorDate`, o con la del anterior) y se para en el primero que la fijó él mismo.
 * «Dejar como está» en un tramo vale también para los que después hereden su fecha.
 *
 * Reparar nunca vuelve a contar lo ya pagado (revisión financiera independiente del pase de 2026-10-27, F-R1): las
 * fechas de siempre se aplican desde el día siguiente a la última ocurrencia con pago registrado (también parcial),
 * llevada a su fecha de siempre (el 28-mar pagado «es» el 31-mar); lo anterior se queda tal cual, con sus pagos. Si
 * lo pagado cae en fechas que la serie de siempre no tiene, B termina ahí y un tramo nuevo (con `anchorDate`) sigue
 * desde ese día, como al partir «desde una fecha»; si no (nada pagado, o pagado en fechas que coinciden), basta con
 * poner `anchorDate` en B. Una fecha omitida o un vínculo (gasto planificado, aplazamiento) pasa a la fecha de
 * siempre de su mismo periodo: la k-ésima ocurrencia pendiente sigue siendo la k-ésima. Lo vencido sin pago
 * registrado también pasa a su fecha de siempre (una fecha movida que pasó sin cobrarse no es «ingreso retrasado»:
 * es el 31 que aún no llega).
 */
import { addDays } from './dates'
import { isValidId } from './ids'
import { anchorOf, occurrencesBetween } from './recurrence'
import { isSeriesDate, lastLinkedOccurrence, sameRule } from './scheduleFrom'
import { touch, type OpContext, type OpResult } from './operations'
import type { AppData, LocalDate, Schedule } from './types'
import type { Issue } from './validation'

/** Cuántas ocurrencias se muestran para comparar (desde hoy). */
export const SPLIT_REPAIR_PREVIEW = 3
/** Ventana en la que se comparan ocurrencias actuales y propuestas (días desde hoy). */
const COMPARE_DAYS = 400

export interface DriftedSplit {
  /** Tramo que cuenta desde la fecha movida (el que se repara). */
  scheduleId: string
  /** Tramo de siempre que termina el día antes. */
  endedId: string
  name: string
  /** Fecha que fijaba la serie de siempre. */
  anchor: LocalDate
  /** Desde cuándo cuenta hoy el tramo nuevo. */
  startDate: LocalDate
  /** Desde qué día se aplican las fechas de siempre: el siguiente a la última ocurrencia pagada (llevada a su fecha de siempre) o el inicio del tramo. Lo anterior no cambia. */
  from: LocalDate
  /** Próximas ocurrencias tal como están y como quedarían (hasta `SPLIT_REPAIR_PREVIEW`, desde hoy). */
  current: LocalDate[]
  proposed: LocalDate[]
}

/** Id del descarte en la bandeja («Dejar como está»); la huella cambia si el tramo cambia de fechas. */
export const splitRepairDismissId = (scheduleId: string) => `int:split:${scheduleId}`
export const splitRepairFingerprint = (s: Pick<Schedule, 'startDate' | 'anchorDate'>, anchor: LocalDate) => `${s.startDate}|${s.anchorDate ?? ''}|${anchor}`

const fail = (issues: Issue[]): { ok: false; issues: Issue[] } => ({ ok: false, issues })
const later = (a: LocalDate, b: LocalDate): LocalDate => (a > b ? a : b)

/** El tramo que termina el día antes de que `s` empiece, con su mismo nombre, tipo y regla. */
function predecessor(data: Pick<AppData, 'schedules'>, s: Schedule): Schedule | undefined {
  const dayBefore = addDays(s.startDate, -1)
  return data.schedules.find((a) => a.id !== s.id && a.endDate === dayBefore && a.name === s.name && a.kind === s.kind && a.frequency !== 'once' && sameRule(a, s))
}

/** ¿`s` heredó tal cual la fecha que fijaba el tramo anterior `prev` (o no fija ninguna)? Si la fijó él mismo, la cadena termina. */
const inheritsAnchor = (s: Schedule, prev: Schedule) => s.anchorDate === undefined || s.anchorDate === anchorOf(prev)

/** La fecha que fija la serie en el primer tramo de la cadena (acotado: nunca entra en un bucle), y los tramos que la heredaron por el camino. */
function rootAnchor(data: Pick<AppData, 'schedules'>, first: Schedule): { anchor: LocalDate; ended: Schedule; inherited: Schedule[] } | null {
  let ended = predecessor(data, first)
  if (!ended || !inheritsAnchor(first, ended)) return null
  const seen = new Set<string>([first.id, ended.id])
  const inherited: Schedule[] = []
  let anchor = anchorOf(ended)
  for (let i = 0; i < 50; i++) {
    const prev = predecessor(data, ended)
    if (!prev || seen.has(prev.id) || !isSeriesDate(prev, ended.startDate) || !inheritsAnchor(ended, prev)) break
    seen.add(prev.id)
    inherited.push(ended)
    anchor = anchorOf(prev)
    ended = prev
  }
  return { anchor, ended: predecessor(data, first)!, inherited }
}

/** La ocurrencia de la serie de siempre que corresponde a `date`: la primera desde ese día (el 28-mar movido «es» el 31-mar; una fecha movida nunca es posterior a la de siempre de su periodo). */
function usualDateFor(s: Schedule, anchor: LocalDate, date: LocalDate): LocalDate {
  return occurrencesBetween({ ...s, anchorDate: anchor, endDate: undefined }, date, addDays(date, COMPARE_DAYS))[0] ?? date
}

/** Día desde el que se aplican las fechas de siempre: el siguiente a la última ocurrencia pagada (también en parte) llevada a su fecha de siempre; si nada se pagó, el inicio del tramo. */
function repairBoundary(data: Pick<AppData, 'transactions'>, s: Schedule, anchor: LocalDate): LocalDate {
  const settled = lastLinkedOccurrence(data, s.id)
  if (!settled || settled < s.startDate) return s.startDate
  return addDays(usualDateFor(s, anchor, settled), 1)
}

interface RepairPlan {
  from: LocalDate
  /** Próximas ocurrencias (desde hoy, sin las omitidas) tal como están y como quedarían. */
  current: LocalDate[]
  proposed: LocalDate[]
  /** La fecha de siempre del mismo periodo que una fecha movida desde `from` (o la misma fecha si no es una ocurrencia). */
  remap: (date: LocalDate) => LocalDate
}

/**
 * Qué cambiaría: desde `from`, la k-ésima ocurrencia tal como está pasa a ser la k-ésima con la fecha de siempre (misma
 * regla, así que van a la par periodo a periodo). `extra` amplía la ventana a las fechas vinculadas que haya que llevar.
 */
function repairPlan(s: Schedule, anchor: LocalDate, from: LocalDate, today: LocalDate, extra: LocalDate[] = []): RepairPlan {
  const showFrom = later(from, today)
  const until = extra.reduce(later, addDays(showFrom, COMPARE_DAYS))
  const current = occurrencesBetween(s, from, until)
  const proposed = occurrencesBetween({ ...s, anchorDate: anchor }, from, until)
  const pairs = new Map(current.map((d, i) => [d, proposed[i]]))
  const remap = (date: LocalDate) => pairs.get(date) ?? date
  const skipped = new Set(s.skippedDates)
  const skippedAfter = new Set(s.skippedDates.map(remap))
  return {
    from,
    current: current.filter((d) => d >= showFrom && !skipped.has(d)),
    proposed: proposed.filter((d) => d >= showFrom && !skippedAfter.has(d)),
    remap,
  }
}

/** Particiones antiguas cuyo tramo nuevo cuenta desde una fecha movida, sin las descartadas («Dejar como está»). */
export function driftedSplits(data: AppData, today: LocalDate): DriftedSplit[] {
  const out: DriftedSplit[] = []
  const dismissedFor = (s: Schedule, anchor: LocalDate) => data.inbox.dismissed.some((d) => d.id === splitRepairDismissId(s.id) && d.fingerprint === splitRepairFingerprint(s, anchor))
  for (const s of data.schedules) {
    if (s.frequency === 'once') continue
    if (s.endDate && s.endDate < today) continue
    const root = rootAnchor(data, s)
    if (!root || root.anchor === anchorOf(s) || !isSeriesDate(root.ended, s.startDate)) continue
    const from = repairBoundary(data, s, root.anchor)
    const { current, proposed } = repairPlan(s, root.anchor, from, today)
    if (current.join() === proposed.join()) continue
    if (dismissedFor(s, root.anchor) || root.inherited.some((w) => dismissedFor(w, root.anchor))) continue
    out.push({ scheduleId: s.id, endedId: root.ended.id, name: s.name, anchor: root.anchor, startDate: s.startDate, from, current: current.slice(0, SPLIT_REPAIR_PREVIEW), proposed: proposed.slice(0, SPLIT_REPAIR_PREVIEW) })
  }
  return out
}

const duePrefix = (scheduleId: string) => `due:schedule:${scheduleId}:`

/**
 * Devuelve al tramo la fecha que fijaba la serie de siempre desde `from` (`DriftedSplit.from`). Solo si hoy sigue siendo
 * una partición movida (se vuelve a comprobar); no toca importes ni fin. Lo pagado se queda en su fecha: si esas fechas
 * no son de la serie de siempre, el tramo termina el día antes de `from` y uno nuevo (`nextId`, generado por quien
 * llama) sigue con `anchorDate`, y lo que mira hacia delante (plantillas, escenarios, gastos planificados vinculados,
 * aplazamientos) pasa al nuevo; si coinciden, basta con poner `anchorDate`. Fechas omitidas y vínculos van a la fecha de
 * siempre de su periodo. Queda en el historial como cualquier edición de un programado, así que se puede revertir.
 */
export function repairSplit(data: AppData, scheduleId: string, ctx: OpContext, nextId: string): OpResult<Schedule> {
  const drift = driftedSplits(data, ctx.today).find((d) => d.scheduleId === scheduleId)
  if (!drift) return fail([{ path: 'id', code: 'notFound' }])
  const s = data.schedules.find((x) => x.id === scheduleId)!
  const { from, anchor } = drift
  const linkedDates = [
    ...s.skippedDates,
    ...data.goals.flatMap((g) => (g.plan?.link?.scheduleId === s.id ? [g.plan.link.occurrenceDate] : [])),
    ...data.inbox.snoozed.flatMap((z) => (z.id.startsWith(duePrefix(s.id)) ? [z.id.slice(duePrefix(s.id).length)] : [])),
  ].filter((d) => d >= from)
  const { remap } = repairPlan(s, anchor, from, ctx.today, linkedDates)

  // Lo pagado queda en su fecha: si coincide con la serie de siempre (nada pagado, o pagado el 28-feb que es también
  // de la serie del 31), el tramo entero puede llevar `anchorDate`; si no, se parte el día antes de `from`.
  const keptAsIs = occurrencesBetween(s, s.startDate, addDays(from, -1))
  const keptUsual = occurrencesBetween({ ...s, anchorDate: anchor }, s.startDate, addDays(from, -1))
  const inPlace = keptAsIs.join() === keptUsual.join()
  if (!inPlace) {
    if (!isValidId(nextId)) return fail([{ path: 'id', code: 'invalidId' }])
    if (data.schedules.some((x) => x.id === nextId)) return fail([{ path: 'id', code: 'duplicateId' }])
  }
  const target = inPlace ? s.id : nextId
  const moved = (date: LocalDate) => date >= from

  // Un gasto planificado vinculado a una fecha que no tendría equivalente no se deja colgado: se rechaza y se dice cuál.
  for (const g of data.goals) {
    const link = g.plan?.link
    if (!link || link.scheduleId !== s.id || !moved(link.occurrenceDate) || g.plan?.paidAt) continue
    const to = remap(link.occurrenceDate)
    const exists = !s.skippedDates.map(remap).includes(to) && occurrencesBetween({ ...s, anchorDate: anchor }, to, to).length > 0
    if (!exists) return fail([{ path: 'startDate', code: 'splitLinkedGoal', params: { name: g.name, date: link.occurrenceDate } }])
  }

  const repaired: Schedule = inPlace
    ? { ...s, anchorDate: anchor, skippedDates: s.skippedDates.map(remap), updatedAt: ctx.now }
    : { ...s, id: nextId, startDate: from, anchorDate: anchor, skippedDates: s.skippedDates.filter(moved).map(remap), createdAt: ctx.now, updatedAt: ctx.now }
  const ended: Schedule = { ...s, endDate: addDays(from, -1), skippedDates: s.skippedDates.filter((d) => !moved(d)), updatedAt: ctx.now }
  const schedules = inPlace ? data.schedules.map((x) => (x.id === s.id ? repaired : x)) : [...data.schedules.map((x) => (x.id === s.id ? ended : x)), repaired]

  const goals = data.goals.map((g) => {
    const link = g.plan?.link
    if (!g.plan || !link || link.scheduleId !== s.id || !moved(link.occurrenceDate) || g.plan.paidAt) return g
    return { ...g, plan: { ...g.plan, link: { scheduleId: target, occurrenceDate: remap(link.occurrenceDate) } }, updatedAt: ctx.now }
  })
  const templates = inPlace
    ? data.templates
    : data.templates.map((tpl) =>
        tpl.kind === 'distribution' && tpl.lines.some((l) => l.target.kind === 'payment' && l.target.scheduleId === s.id)
          ? { ...tpl, lines: tpl.lines.map((l) => (l.target.kind === 'payment' && l.target.scheduleId === s.id ? { ...l, target: { kind: 'payment' as const, scheduleId: target } } : l)), updatedAt: ctx.now }
          : tpl,
      )
  const scenarios = inPlace
    ? data.scenarios
    : data.scenarios.map((sc) =>
        sc.changes.some((c) => c.type === 'scheduleAmount' && c.scheduleId === s.id)
          ? { ...sc, changes: sc.changes.map((c) => (c.type === 'scheduleAmount' && c.scheduleId === s.id ? { ...c, scheduleId: target } : c)), updatedAt: ctx.now }
          : sc,
      )
  const prefix = duePrefix(s.id)
  // Un aplazamiento sigue a su ocurrencia si esta tiene fecha de siempre; si no, se queda donde está (inerte).
  const snoozed = data.inbox.snoozed.map((z) => {
    if (!z.id.startsWith(prefix)) return z
    const date = z.id.slice(prefix.length)
    return moved(date) && remap(date) !== date ? { ...z, id: `${duePrefix(target)}${remap(date)}` } : z
  })

  return { ok: true, data: touch({ ...data, schedules, goals, templates, scenarios, inbox: { ...data.inbox, snoozed } }, ctx.now), value: repaired }
}

/** «Dejar como está»: se recuerda en la bandeja (descarte con huella) y no cambia ninguna fecha. */
export function dismissSplitRepair(data: AppData, scheduleId: string, ctx: OpContext): OpResult<null> {
  const drift = driftedSplits(data, ctx.today).find((d) => d.scheduleId === scheduleId)
  if (!drift) return fail([{ path: 'id', code: 'notFound' }])
  const s = data.schedules.find((x) => x.id === scheduleId)!
  const id = splitRepairDismissId(scheduleId)
  const dismissed = [...data.inbox.dismissed.filter((d) => d.id !== id), { id, fingerprint: splitRepairFingerprint(s, drift.anchor), at: ctx.now }]
  return { ok: true, data: { ...data, inbox: { ...data.inbox, dismissed }, updatedAt: ctx.now }, value: null }
}
