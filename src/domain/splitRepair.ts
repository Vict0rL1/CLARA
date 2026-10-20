/**
 * Revisión de particiones antiguas (auditoría independiente de seguimiento, QA-01 histórico).
 *
 * Antes de v14, partir una serie «desde una fecha» cambiando solo el importe hacía que el tramo nuevo contara desde la
 * fecha elegida: un sueldo del 31 partido el 28-feb (el 31 movido) pasaba a cobrarse el 28. La migración 13 → 14 no
 * lo corrige (no adivina intenciones ni reescribe fechas): aquí se DETECTAN esas particiones y se propone, con
 * confirmación, devolverles la fecha que fijaba la serie de siempre (`anchorDate`). Declinar deja el 28 tal cual.
 *
 * Se señala un tramo B solo cuando todo esto se cumple (conservador: ante la duda, nada):
 * - B repite, no tiene `anchorDate` y sigue activo (sin fin o con fin desde hoy);
 * - hay un tramo A del mismo nombre y tipo, con la misma regla, que termina el día antes de que B empiece;
 * - B empieza en una fecha de la serie de A (una partición en una fecha ajena a la serie es un reanclaje explícito);
 * - con la fecha de siempre, las próximas ocurrencias de B serían OTRAS (si coinciden no hay nada que reparar).
 * La fecha de siempre se toma del primer tramo de la cadena (A pudo ser a su vez un tramo partido).
 */
import { addDays } from './dates'
import { anchorOf, occurrencesBetween } from './recurrence'
import { isSeriesDate, sameRule } from './scheduleFrom'
import { touch, type OpContext, type OpResult } from './operations'
import type { AppData, LocalDate, Schedule } from './types'

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
  /** Próximas ocurrencias tal como están y como quedarían (hasta `SPLIT_REPAIR_PREVIEW`, desde hoy). */
  current: LocalDate[]
  proposed: LocalDate[]
}

/** Id del descarte en la bandeja («Dejar como está»); la huella cambia si el tramo cambia de fechas. */
export const splitRepairDismissId = (scheduleId: string) => `int:split:${scheduleId}`
export const splitRepairFingerprint = (s: Pick<Schedule, 'startDate' | 'anchorDate'>, anchor: LocalDate) => `${s.startDate}|${s.anchorDate ?? ''}|${anchor}`

/** El tramo que termina el día antes de que `s` empiece, con su mismo nombre, tipo y regla. */
function predecessor(data: Pick<AppData, 'schedules'>, s: Schedule): Schedule | undefined {
  const dayBefore = addDays(s.startDate, -1)
  return data.schedules.find((a) => a.id !== s.id && a.endDate === dayBefore && a.name === s.name && a.kind === s.kind && a.frequency !== 'once' && sameRule(a, s))
}

/** La fecha que fija la serie en el primer tramo de la cadena (acotado: nunca entra en un bucle). */
function rootAnchor(data: Pick<AppData, 'schedules'>, first: Schedule): { anchor: LocalDate; ended: Schedule } | null {
  let ended = predecessor(data, first)
  if (!ended) return null
  const seen = new Set<string>([first.id, ended.id])
  let anchor = anchorOf(ended)
  for (let i = 0; i < 50; i++) {
    const prev = predecessor(data, ended)
    if (!prev || seen.has(prev.id) || !isSeriesDate(prev, ended.startDate)) break
    seen.add(prev.id)
    anchor = anchorOf(prev)
    ended = prev
  }
  return { anchor, ended: predecessor(data, first)! }
}

function preview(s: Schedule, today: LocalDate, anchorDate: LocalDate | undefined): LocalDate[] {
  const from = today > s.startDate ? today : s.startDate
  return occurrencesBetween({ ...s, anchorDate }, from, addDays(from, COMPARE_DAYS)).filter((d) => !s.skippedDates.includes(d))
}

/** Particiones antiguas cuyo tramo nuevo cuenta desde una fecha movida, sin las descartadas («Dejar como está»). */
export function driftedSplits(data: AppData, today: LocalDate): DriftedSplit[] {
  const out: DriftedSplit[] = []
  for (const s of data.schedules) {
    if (s.frequency === 'once' || s.anchorDate !== undefined) continue
    if (s.endDate && s.endDate < today) continue
    const root = rootAnchor(data, s)
    if (!root || root.anchor === s.startDate || !isSeriesDate(root.ended, s.startDate)) continue
    const current = preview(s, today, undefined)
    const proposed = preview(s, today, root.anchor)
    if (current.join() === proposed.join()) continue
    const dismissed = data.inbox.dismissed.some((d) => d.id === splitRepairDismissId(s.id) && d.fingerprint === splitRepairFingerprint(s, root.anchor))
    if (dismissed) continue
    out.push({ scheduleId: s.id, endedId: root.ended.id, name: s.name, anchor: root.anchor, startDate: s.startDate, current: current.slice(0, SPLIT_REPAIR_PREVIEW), proposed: proposed.slice(0, SPLIT_REPAIR_PREVIEW) })
  }
  return out
}

/**
 * Devuelve al tramo la fecha que fijaba la serie de siempre (`anchorDate`). Solo si hoy sigue siendo una partición
 * movida (se vuelve a comprobar); no toca importes, fin, omitidas ni ningún otro registro. Queda en el historial como
 * cualquier edición de un programado, así que se puede revertir.
 */
export function repairSplit(data: AppData, scheduleId: string, ctx: OpContext): OpResult<Schedule> {
  const drift = driftedSplits(data, ctx.today).find((d) => d.scheduleId === scheduleId)
  if (!drift) return { ok: false, issues: [{ path: 'id', code: 'notFound' }] }
  const repaired = data.schedules.map((s) => (s.id === scheduleId ? { ...s, anchorDate: drift.anchor, updatedAt: ctx.now } : s))
  return { ok: true, data: touch({ ...data, schedules: repaired }, ctx.now), value: repaired.find((s) => s.id === scheduleId)! }
}

/** «Dejar como está»: se recuerda en la bandeja (descarte con huella) y no cambia ninguna fecha. */
export function dismissSplitRepair(data: AppData, scheduleId: string, ctx: OpContext): OpResult<null> {
  const drift = driftedSplits(data, ctx.today).find((d) => d.scheduleId === scheduleId)
  if (!drift) return { ok: false, issues: [{ path: 'id', code: 'notFound' }] }
  const s = data.schedules.find((x) => x.id === scheduleId)!
  const id = splitRepairDismissId(scheduleId)
  const dismissed = [...data.inbox.dismissed.filter((d) => d.id !== id), { id, fingerprint: splitRepairFingerprint(s, drift.anchor), at: ctx.now }]
  return { ok: true, data: { ...data, inbox: { ...data.inbox, dismissed }, updatedAt: ctx.now }, value: null }
}
