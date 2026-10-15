/**
 * Ocurrencias de pagos e ingresos programados.
 *
 * - Diaria / semanal / quincenal (cada 2 semanas) / personalizada (cada N días): cada
 *   1 / 7 / 14 / N días desde `startDate`.
 * - Mensual / trimestral / anual: mismo día del mes que `startDate`, cada 1 / 3 / 12 meses.
 *   Si un mes no tiene ese día (29, 30 o 31) se usa el último día de ese mes, y el mes
 *   siguiente se vuelve al día original (31 ene → 28 feb → 31 mar → 30 abr).
 * - Anual: el 29 de febrero pasa al 28 en años no bisiestos.
 * - Dos veces al mes (Clara 2.0 §12): el día de `startDate` y `secondDay`, cada mes; un día que el
 *   mes no tiene pasa al último (15 y 31 → 15 y 28 feb). Los dos días distan ≥ 7, así que nunca
 *   caen en la misma fecha.
 */
import { addDays, addMonthsClamped, daysBetween, parseLocalDate } from './dates'
import type { Frequency, LocalDate, Schedule } from './types'

/** Tope de una ventana normal (hasta ~5 años de un pago diario). */
export const MAX_OCCURRENCES = 2000
/**
 * Tope del recorrido de vencidos desde el inicio de un programado (QA-06): ~55 años de un pago
 * diario. Si se alcanza, el resultado se marca como truncado y quien calcula lo dice; nunca se
 * presenta una cifra incompleta como si estuviera completa.
 */
export const OVERDUE_SCAN_LIMIT = 20_000

export interface OccurrenceScan {
  dates: LocalDate[]
  /** Se alcanzó `limit` antes de llegar a `to`: faltan ocurrencias. */
  truncated: boolean
}

export type RecurrenceRule = Pick<Schedule, 'frequency' | 'startDate'> & Partial<Pick<Schedule, 'endDate' | 'intervalDays' | 'secondDay'>>

/** Segundo día por defecto de un pago quincenal de calendario: 15 días después (o antes, si no cabe). */
export function defaultSecondDay(startDate: LocalDate): number {
  const day = parseLocalDate(startDate).day
  return day <= 16 ? day + 15 : day - 15
}

/** Días del mes [menor, mayor] de un pago dos veces al mes. */
function semimonthlyDays(rule: RecurrenceRule): [number, number] {
  const a = parseLocalDate(rule.startDate).day
  const b = rule.secondDay ?? defaultSecondDay(rule.startDate)
  return a < b ? [a, b] : [b, a]
}

function stepDays(frequency: Frequency, intervalDays: number | undefined): number | null {
  if (frequency === 'daily') return 1
  if (frequency === 'weekly') return 7
  if (frequency === 'biweekly') return 14
  // Personalizada sin intervalo válido: se trata como diaria (la validación lo exige ≥ 1).
  if (frequency === 'custom') return Math.max(1, Math.floor(intervalDays ?? 1))
  return null
}

function stepMonths(frequency: Frequency): number | null {
  if (frequency === 'monthly') return 1
  if (frequency === 'quarterly') return 3
  if (frequency === 'yearly') return 12
  return null
}

/** n-ésima ocurrencia (n = 0 es `startDate`). */
export function nthOccurrence(schedule: RecurrenceRule, n: number): LocalDate {
  const { frequency, startDate } = schedule
  if (frequency === 'once') return startDate
  if (frequency === 'semimonthly') {
    // n = 0 es `startDate`; si es el día mayor del mes, la siguiente es el menor del mes siguiente.
    const [low, high] = semimonthlyDays(schedule)
    const m = n + (parseLocalDate(startDate).day === low ? 0 : 1)
    return addMonthsClamped(startDate, Math.floor(m / 2), m % 2 === 0 ? low : high)
  }
  const days = stepDays(frequency, schedule.intervalDays)
  if (days !== null) return addDays(startDate, days * n)
  const months = stepMonths(frequency) ?? 1
  const preferredDay = parseLocalDate(startDate).day
  return addMonthsClamped(startDate, months * n, preferredDay)
}

/**
 * Fechas de ocurrencia entre `from` y `to` (ambas incluidas), respetando
 * `startDate` y `endDate`. No excluye omitidas ni pagadas: eso lo decide quien llama.
 */
export function occurrencesBetween(schedule: RecurrenceRule, from: LocalDate, to: LocalDate): LocalDate[] {
  return scanOccurrences(schedule, from, to).dates
}

/** Como `occurrencesBetween`, pero dice si el tope `limit` cortó el recorrido. */
export function scanOccurrences(schedule: RecurrenceRule, from: LocalDate, to: LocalDate, limit = MAX_OCCURRENCES): OccurrenceScan {
  if (to < from) return { dates: [], truncated: false }
  const end = schedule.endDate && schedule.endDate < to ? schedule.endDate : to
  if (end < schedule.startDate) return { dates: [], truncated: false }

  if (schedule.frequency === 'once') {
    return { dates: schedule.startDate >= from && schedule.startDate <= end ? [schedule.startDate] : [], truncated: false }
  }

  // Primera n candidata para no recorrer desde el principio en fechas lejanas.
  let n = 0
  if (from > schedule.startDate) {
    const days = stepDays(schedule.frequency, schedule.intervalDays)
    if (schedule.frequency === 'semimonthly') {
      const a = parseLocalDate(schedule.startDate)
      const b = parseLocalDate(from)
      n = Math.max(0, ((b.year - a.year) * 12 + (b.month - a.month)) * 2 - 2)
    } else if (days !== null) {
      n = Math.max(0, Math.floor(daysBetween(schedule.startDate, from) / days))
    } else {
      const months = stepMonths(schedule.frequency) ?? 1
      const a = parseLocalDate(schedule.startDate)
      const b = parseLocalDate(from)
      const diff = (b.year - a.year) * 12 + (b.month - a.month)
      n = Math.max(0, Math.floor(diff / months) - 1)
    }
  }

  const dates: LocalDate[] = []
  for (let i = 0; i < limit; i++, n++) {
    const date = nthOccurrence(schedule, n)
    if (date > end) return { dates, truncated: false }
    if (date >= from) dates.push(date)
  }
  // Se agotó el tope sin pasar de `end`: ¿quedaba alguna más?
  return { dates, truncated: nthOccurrence(schedule, n) <= end }
}

/** Primera ocurrencia en o después de `from`, o `null`. */
export function nextOccurrenceOnOrAfter(schedule: RecurrenceRule, from: LocalDate, lookaheadDays = 800): LocalDate | null {
  return occurrencesBetween(schedule, from, addDays(from, lookaheadDays))[0] ?? null
}
