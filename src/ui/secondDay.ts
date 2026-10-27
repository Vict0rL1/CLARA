/** Segundo día de un pago «dos veces al mes» tal como lo escribe la persona (v13). */
import { isValidLocalDate } from '../domain/dates'
import { defaultSecondDay } from '../domain/recurrence'
import { isValidSecondDay } from '../domain/validation'

/**
 * Día que se guardará: el escrito o, si está vacío, el de por defecto (0 sin fecha). `anchorDate` es la fecha que
 * fija la serie (v14): al partir un tramo sin cambiar la regla sigue siendo la de siempre, no la fecha elegida.
 */
export function secondDayFrom(anchorDate: string, text: string): number {
  if (text.trim() !== '') return Number(text)
  return isValidLocalDate(anchorDate) ? defaultSecondDay(anchorDate) : 0
}

/** ¿El segundo día (escrito o por defecto) no es válido? Misma regla que la validación del dominio. */
export function secondDayError(anchorDate: string, text: string): boolean {
  return isValidLocalDate(anchorDate) && !isValidSecondDay(anchorDate, secondDayFrom(anchorDate, text))
}
