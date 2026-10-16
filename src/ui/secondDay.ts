/** Segundo día de un pago «dos veces al mes» tal como lo escribe la persona (v13). */
import { isValidLocalDate } from '../domain/dates'
import { defaultSecondDay } from '../domain/recurrence'
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
