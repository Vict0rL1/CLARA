/** Segundo día de un pago «dos veces al mes» tal como lo escribe la persona (v13). */
import { isValidLocalDate } from '../domain/dates'
import { defaultSecondDay } from '../domain/recurrence'
import { splitSecondDay } from '../domain/scheduleFrom'
import type { Schedule } from '../domain/types'
import { isValidSecondDay } from '../domain/validation'

/** Día que se guardará: el escrito o, si está vacío, el de por defecto (0 sin fecha de inicio). */
export function secondDayFrom(startDate: string, text: string): number {
  if (text.trim() !== '') return Number(text)
  return isValidLocalDate(startDate) ? defaultSecondDay(startDate) : 0
}

/** ¿El segundo día (escrito o por defecto) no es válido? Misma regla que la validación del dominio. */
export function secondDayError(startDate: string, text: string): boolean {
  return isValidLocalDate(startDate) && !isValidSecondDay(startDate, secondDayFrom(startDate, text))
}

/** El campo «segundo día» de un programado que se edita (SCH-01). */
export interface SecondDayDraft {
  /** Lo que muestra el campo. */
  text: string
  /** Lo que tenía al abrir el formulario. */
  original: string
  /** Lo que puso la app al partir la serie; mientras la persona no lo cambie, se recalcula o se deshace. */
  auto: string | null
}

export function secondDayDraft(text: string): SecondDayDraft {
  return { text, original: text, auto: null }
}

/**
 * El segundo día al cambiar entre «a todas las fechas» y «desde una fecha», o al mover la fecha «desde»
 * (`splitSecondDay`): desde el SEGUNDO día de un «dos veces al mes» el otro pasa a ser el segundo (15 y 30
 * desde el 30 → empieza el 30 con segundo día 15), para que los días no cambien ni queden iguales. Volver a
 * «todas las fechas» devuelve el original. Lo que la persona escribió (o dejó vacío) se respeta y pasa por la
 * validación normal.
 */
export function secondDayForScope(draft: SecondDayDraft, schedule: Schedule | undefined, scope: 'all' | 'from', from: string): SecondDayDraft {
  if (draft.text !== (draft.auto ?? draft.original)) return { ...draft, auto: null }
  const day = scope === 'from' && schedule ? splitSecondDay(schedule, from) : null
  return day === null ? { text: draft.original, original: draft.original, auto: null } : { text: String(day), original: draft.original, auto: String(day) }
}
