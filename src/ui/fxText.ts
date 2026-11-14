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
