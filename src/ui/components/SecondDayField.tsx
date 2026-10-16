/**
 * Segundo día de un pago «dos veces al mes» (v13). Un solo campo para el formulario de programados,
 * la configuración inicial y «Repetir»: vacío = 15 días después (o antes) del primero, y la ayuda dice
 * siempre los dos días que se usarán.
 */
import { isValidLocalDate, parseLocalDate } from '../../domain/dates'
import { defaultSecondDay } from '../../domain/recurrence'
import { useT } from '../../i18n'
import { secondDayFrom } from '../secondDay'
import { TextField } from './fields'

export function SecondDayField({ startDate, value, onChange, error, name = 'second-day' }: { startDate: string; value: string; onChange: (v: string) => void; error?: string | null; name?: string }) {
  const { t } = useT()
  const first = isValidLocalDate(startDate) ? parseLocalDate(startDate).day : 0
  const second = secondDayFrom(startDate, value)
  const showHint = first > 0 && Number.isInteger(second) && second >= 1 && second <= 31
  return (
    <TextField
      label={t('scheduleForm.secondDay')}
      name={name}
      type="number"
      inputMode="numeric"
      min={1}
      max={31}
      value={value}
      placeholder={isValidLocalDate(startDate) ? String(defaultSecondDay(startDate)) : undefined}
      onChange={(e) => onChange(e.target.value)}
      hint={showHint ? t('scheduleForm.secondDayHint', { first: Math.min(first, second), second: Math.max(first, second) }) : undefined}
      error={error}
    />
  )
}
