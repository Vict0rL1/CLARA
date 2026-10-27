/**
 * Pagos recurrentes · cuánto cuestan de verdad (Clara 2.0 §12, fase 3).
 *
 * Para cada programado recurrente se CUENTAN sus ocurrencias en los próximos 12 meses en el calendario
 * real (`occurrencesBetween`: fin de mes, «dos veces al mes», fecha de fin) y se multiplica por el
 * importe, en enteros. Nada de «semanal × 52 / 12»: así el total coincide con lo que verá la persona en
 * el calendario. El promedio mensual es ese total / 12, redondeado hacia abajo, y se dice.
 *
 * No incluye: pagos únicos (`once`), programados en pausa (no se reservan; se cuentan aparte) ni las
 * fechas omitidas. Solo informa: no reserva, no registra y no cambia nada. Con importes extremos el total
 * puede no caber en un entero exacto: se dice (`ok: false`) en vez de fallar o redondear (QA V2, FIN-01).
 */
import { addDays, addMonthsClamped, parseLocalDate } from './dates'
import { floorDiv, toSafeMinor } from './money'
import { occurrencesBetween } from './recurrence'
import type { AppData, LocalDate, Schedule, ScheduleKind } from './types'

export interface RecurringCost {
  schedule: Schedule
  /** Ocurrencias en la ventana (sin omitidas). */
  occurrences: number
  /** occurrences × importe, en unidades menores. */
  totalMinor: number
}

/** Como `RecurringCost` cuando el resumen no cabe en un entero exacto: `null` si este producto tampoco. */
export interface RecurringCount {
  schedule: Schedule
  occurrences: number
  totalMinor: number | null
}

interface RecurringBase {
  /** Primer y último día de la ventana (ambos incluidos): hoy y el día antes de la misma fecha dentro de 12 meses. */
  from: LocalDate
  to: LocalDate
  /** Alguno es un importe estimado («≈»): el total también lo es. */
  hasEstimates: boolean
  /** Programados recurrentes en pausa: no cuentan y se dice cuántos hay. */
  pausedCount: number
}

/**
 * Rango exacto (QA V2, FIN-01): cada producto y el total se calculan con BigInt. Si el total pasa de
 * 2^53 − 1 unidades menores ya no es un entero exacto: entonces `ok: false` y no hay total ni promedio
 * (ni recortado ni redondeado); la lista de programados y sus ocurrencias sigue ahí para revisarlos.
 */
export type RecurringSummary =
  | (RecurringBase & {
      ok: true
      /** De mayor a menor total; a igualdad, por nombre. Solo los que tienen alguna ocurrencia en la ventana. */
      items: RecurringCost[]
      totalMinor: number
      /** floor(total / 12). */
      monthlyMinor: number
    })
  | (RecurringBase & { ok: false; reason: 'outOfRange'; items: RecurringCount[]; totalMinor: null; monthlyMinor: null })

export const RECURRING_WINDOW_MONTHS = 12

export function recurringWindow(today: LocalDate): { from: LocalDate; to: LocalDate } {
  return { from: today, to: addDays(addMonthsClamped(today, RECURRING_WINDOW_MONTHS, parseLocalDate(today).day), -1) }
}

export function recurringCosts(data: Pick<AppData, 'schedules'>, today: LocalDate, kind: ScheduleKind = 'expense'): RecurringSummary {
  const { from, to } = recurringWindow(today)
  const counted: { schedule: Schedule; occurrences: number; product: bigint }[] = []
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
    counted.push({ schedule, occurrences, product: BigInt(occurrences) * BigInt(schedule.amountMinor) })
  }
  counted.sort((a, b) => (b.product > a.product ? 1 : b.product < a.product ? -1 : a.schedule.name.localeCompare(b.schedule.name)))
  const base = { from, to, hasEstimates: counted.some((i) => i.schedule.amountIsEstimate), pausedCount }
  const items = counted.map((i) => ({ schedule: i.schedule, occurrences: i.occurrences, totalMinor: toSafeMinor(i.product) }))
  const totalMinor = toSafeMinor(counted.reduce((sum, i) => sum + i.product, 0n))
  if (totalMinor === null || items.some((i) => i.totalMinor === null)) return { ...base, ok: false, reason: 'outOfRange', items, totalMinor: null, monthlyMinor: null }
  return { ...base, ok: true, items: items.map((i) => ({ ...i, totalMinor: i.totalMinor! })), totalMinor, monthlyMinor: floorDiv(totalMinor, RECURRING_WINDOW_MONTHS) }
}
