/** Interpretación y mensajes de error del texto que se escribe en campos de dinero. */
import { parseMoney, type ParseMoneyOptions, type ParseMoneyResult } from '../domain/money'
import type { MessageKey, Translator } from '../i18n'
import type { Formatter } from './format'

export function parseMoneyText(text: string, fmt: Formatter, options?: ParseMoneyOptions): ParseMoneyResult {
  return parseMoney(text, fmt.currency, fmt.numberLocale, options)
}

export function moneyErrorMessage(t: Translator['t'], result: ParseMoneyResult): string | null {
  if (result.ok) return null
  return t(`money.error.${result.error}` as MessageKey, { digits: result.digits, found: result.found ?? '', other: result.other ?? '', expected: result.expected ?? '' })
}
