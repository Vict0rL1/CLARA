/**
 * Pagos recurrentes · cuánto cuestan de verdad (Clara 2.0 §12, fase 3).
 *
 * Para cada programado recurrente se CUENTAN sus ocurrencias en los próximos 12 meses en el calendario
 * real (`occurrencesBetween`: fin de mes, «dos veces al mes», fecha de fin) y se multiplica por el
 * importe, en enteros. Nada de «semanal × 52 / 12»: así el total coincide con lo que verá la persona en
 * el calendario. El promedio mensual es ese total / 12, redondeado hacia abajo, y se dice.
 *
 * No incluye: pagos únicos (`once`), programados en pausa (no se reservan; se cuentan aparte) ni las
 * fechas omitidas. Solo informa: no reserva, no registra y no cambia nada.
 */
import { addDays, addMonthsClamped, parseLocalDate } from './dates'
import { floorDiv } from './money'
import { occurrencesBetween } from './recurrence'
import type { AppData, LocalDate, Schedule, ScheduleKind } from './types'

export interface RecurringCost {
  schedule: Schedule
  /** Ocurrencias en la ventana (sin omitidas). */
  occurrences: number
  /** occurrences × importe, en unidades menores. */
  totalMinor: number
}

export interface RecurringSummary {
  /** Primer y último día de la ventana (ambos incluidos): hoy y el día antes de la misma fecha dentro de 12 meses. */
  from: LocalDate
  to: LocalDate
  /** De mayor a menor total; a igualdad, por nombre. Solo los que tienen alguna ocurrencia en la ventana. */
  items: RecurringCost[]
  totalMinor: number
  /** floor(total / 12). */
  monthlyMinor: number
  /** Alguno es un importe estimado («≈»): el total también lo es. */
  hasEstimates: boolean
  /** Programados recurrentes en pausa: no cuentan y se dice cuántos hay. */
  pausedCount: number
}

export const RECURRING_WINDOW_MONTHS = 12

export function recurringWindow(today: LocalDate): { from: LocalDate; to: LocalDate } {
  return { from: today, to: addDays(addMonthsClamped(today, RECURRING_WINDOW_MONTHS, parseLocalDate(today).day), -1) }
}

export function recurringCosts(data: Pick<AppData, 'schedules'>, today: LocalDate, kind: ScheduleKind = 'expense'): RecurringSummary {
  const { from, to } = recurringWindow(today)
  const items: RecurringCost[] = []
  let pausedCount = 0
  for (const schedule of data.schedules) {
    if (schedule.kind !== kind || schedule.frequency === 'once') continue
    if (schedule.paused) {
      pausedCount += 1
      continue
    }
    const skipped = new Set(schedule.skippedDates)
    const occurrences = occurrencesBetween(schedule, from, to).filter((d) => !skipped.has(d)).length
    if (occurrences === 0) continue
    items.push({ schedule, occurrences, totalMinor: occurrences * schedule.amountMinor })
  }
  items.sort((a, b) => b.totalMinor - a.totalMinor || a.schedule.name.localeCompare(b.schedule.name))
  const totalMinor = items.reduce((sum, i) => sum + i.totalMinor, 0)
  return {
    from,
    to,
    items,
    totalMinor,
    monthlyMinor: floorDiv(totalMinor, RECURRING_WINDOW_MONTHS),
    hasEstimates: items.some((i) => i.schedule.amountIsEstimate),
    pausedCount,
  }
}
