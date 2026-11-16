/**
 * Cómo se ENSEÑA una tasa y una comisión (Fase 3). Solo presentación: los cálculos están en `domain/fx.ts` y nunca usan
 * lo que sale de aquí.
 */
import { rateForDisplay } from '../domain/fxAdjust'
import { bpsToInputString, localeSeparators } from '../domain/money'

/** «0.0092» → «0,0092» en francés; una fracción del cargo real → «≈ 0,009308». */
export function rateLabel(rate: string, locale: string): string {
  const shown = rateForDisplay(rate)
  if (!shown) return rate
  const text = shown.text.replace('.', localeSeparators(locale).decimal)
  return shown.exact ? text : `≈ ${text}`
}

/** 250 puntos básicos → «2.5» (sin el signo: el texto de cada idioma lo pone con su espacio). */
export function feeLabel(bps: number, locale: string): string {
  const { decimal } = localeSeparators(locale)
  const escaped = decimal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return bpsToInputString(bps, locale).replace(new RegExp(`${escaped}?0+$`), '')
}

/** Lo escrito en un campo de tasa, listo para `parseRate`: «0,0092» en francés → «0.0092»; sin espacios. En inglés una
 * coma no es un decimal: la tasa no se lee (nunca se adivina). */
export function rateInput(text: string, decimal: string): string {
  const t = text.replace(/[\s\u00a0\u202f]/g, '')
  return decimal === ',' ? t.replace(',', '.') : t
}

/** El texto editable de una tasa guardada: decimal con el separador del idioma, o la fracción tal cual. */
export function rateText(rate: string, decimal: string): string {
  return rate.includes('/') ? rate : rate.replace('.', decimal)
}
