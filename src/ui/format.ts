/**
 * Formato de cifras y fechas según Ajustes. Las fechas de calendario se
 * muestran en UTC (son fechas "puras"), y las marcas de tiempo en la zona
 * horaria del usuario.
 */
import { useMemo } from 'react'
import { daysBetween, localDateToDisplayDate, parseLocalDate } from '../domain/dates'
import { formatMoney, localeSeparators, minorToInputString, MASKED_DIGITS } from '../domain/money'
import type { LocalDate, Settings, Timestamp } from '../domain/types'
import { useData } from '../state/store'
import { usePrivacy } from './preferences'

export const DATE_LOCALE: Record<Settings['language'], string> = { es: 'es-MX', en: 'en-CA', pt: 'pt-BR', fr: 'fr-CA' }

export interface Formatter {
  currency: string
  numberLocale: string
  money: (minor: number, options?: { sign?: boolean }) => string
  /** Modo privado activo: los importes se muestran ocultos. */
  privacy: boolean
  moneyInput: (minor: number) => string
  decimalSeparator: string
  date: (date: LocalDate, options?: { weekday?: boolean; compact?: boolean; today?: LocalDate }) => string
  monthYear: (date: LocalDate) => string
  /** «Sept 2026»: mes abreviado con inicial mayúscula, para cabeceras de una línea. */
  monthYearShort: (date: LocalDate) => string
  weekdayShort: (date: LocalDate) => string
  timestamp: (ts: Timestamp) => string
  time: (ts: Timestamp) => string
  percent: (fraction: number) => string
  /** «USD y CAD», «USD and CAD»: una lista corta en el idioma de la interfaz. */
  list: (items: readonly string[]) => string
}

/**
 * Modo privado: `formatMoney` conserva el símbolo y la posición del locale y oculta todas las cifras
 * («$ -----»), también en etiquetas accesibles. Este texto sirve para comprobarlo en pruebas.
 */
export const MASKED_AMOUNT = MASKED_DIGITS

export function createFormatter(settings: Settings, options: { privacy?: boolean } = {}): Formatter {
  const lang = DATE_LOCALE[settings.language]
  const cache = new Map<string, Intl.DateTimeFormat>()
  const dtf = (key: string, options: Intl.DateTimeFormatOptions) => {
    let f = cache.get(key)
    if (!f) {
      f = new Intl.DateTimeFormat(lang, options)
      cache.set(key, f)
    }
    return f
  }
  const percentFormat = new Intl.NumberFormat(settings.numberLocale, { style: 'percent', maximumFractionDigits: 0 })
  const listFormat = new Intl.ListFormat(lang, { type: 'conjunction' })

  return {
    currency: settings.currency,
    numberLocale: settings.numberLocale,
    decimalSeparator: localeSeparators(settings.numberLocale).decimal,
    // Modo privado: solo cambia lo que se MUESTRA. Los campos de entrada (moneyInput) y las
    // exportaciones no usan esta función.
    money: (minor, opts) =>
      formatMoney(minor, settings.currency, settings.numberLocale, { signDisplay: opts?.sign ? 'exceptZero' : 'auto', privacy: !!options.privacy }),
    privacy: !!options.privacy,
    moneyInput: (minor) => minorToInputString(minor, settings.currency, settings.numberLocale),
    date: (date, options = {}) => {
      const d = localDateToDisplayDate(date)
      const sameYear = options.today ? parseLocalDate(options.today).year === parseLocalDate(date).year : false
      if (settings.dateStyle === 'iso') {
        const wd = options.weekday ? `${dtf('wd', { weekday: 'short', timeZone: 'UTC' }).format(d)} ` : ''
        return `${wd}${date}`
      }
      if (settings.dateStyle === 'short') {
        return dtf(`short-${options.weekday}`, {
          timeZone: 'UTC',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          ...(options.weekday ? { weekday: 'short' } : {}),
        }).format(d)
      }
      const omitYear = options.compact && sameYear
      return dtf(`medium-${options.weekday}-${omitYear}`, {
        timeZone: 'UTC',
        day: 'numeric',
        month: 'short',
        ...(omitYear ? {} : { year: 'numeric' }),
        ...(options.weekday ? { weekday: 'short' } : {}),
      }).format(d)
    },
    monthYear: (date) => dtf('monthYear', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(localDateToDisplayDate(date)),
    monthYearShort: (date) => {
      const text = dtf('monthYearShort', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(localDateToDisplayDate(date))
      return text.charAt(0).toLocaleUpperCase(lang) + text.slice(1)
    },
    weekdayShort: (date) => dtf('wdshort', { timeZone: 'UTC', weekday: 'short' }).format(localDateToDisplayDate(date)),
    timestamp: (ts) =>
      dtf('ts', { timeZone: settings.timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ts)),
    time: (ts) => dtf('time', { timeZone: settings.timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(ts)),
    percent: (fraction) => percentFormat.format(fraction),
    list: (items) => listFormat.format(items),
  }
}

export function useFormat(): Formatter {
  const { settings } = useData()
  const privacy = usePrivacy()
  return useMemo(() => createFormatter(settings, { privacy }), [settings, privacy])
}

/** "hoy", "mañana", "en 3 días", "hace 2 días". */
export function relativeDayKey(date: LocalDate, today: LocalDate): { key: 'today' | 'tomorrow' | 'yesterday' | 'inDays' | 'daysAgo'; days: number } {
  const diff = daysBetween(today, date)
  if (diff === 0) return { key: 'today', days: 0 }
  if (diff === 1) return { key: 'tomorrow', days: 1 }
  if (diff === -1) return { key: 'yesterday', days: 1 }
  return diff > 0 ? { key: 'inDays', days: diff } : { key: 'daysAgo', days: -diff }
}
