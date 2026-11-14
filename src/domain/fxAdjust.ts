/**
 * Lo de `fx.ts` que solo usan pantallas diferidas y la importación de capturas: la tasa del cargo real y cómo se muestra
 * una tasa. Va aparte para que el JS inicial (donde la validación necesita `fx.ts`) no crezca.
 */
import { convertToBudget, gcd, parseRate, RATE_TEXT_MAX, rateToText } from './fx'
import { currencyDigits, isSupportedCurrency } from './money'
import type { CurrencyCode, OriginalAmount } from './types'

/**
 * «Ajustar al cargo real»: la tasa exacta que convierte `originalMinor` de `from` en `budgetMinor` de `to` (fracción
 * reducida o decimal si es exacto). Con ella, `convertToBudget(originalMinor, from, to, tasa)` da `budgetMinor` justo.
 */
export function rateFromAmounts(budgetMinor: number, to: string, originalMinor: number, from: string): string | null {
  if (!Number.isSafeInteger(budgetMinor) || budgetMinor <= 0 || !Number.isSafeInteger(originalMinor) || originalMinor <= 0) return null
  if (!isSupportedCurrency(from) || !isSupportedCurrency(to)) return null
  const shift = currencyDigits(to as CurrencyCode) - currencyDigits(from as CurrencyCode)
  let num = BigInt(budgetMinor)
  let den = BigInt(originalMinor)
  if (shift >= 0) den *= 10n ** BigInt(shift)
  else num *= 10n ** BigInt(-shift)
  const g = gcd(num, den)
  const text = rateToText({ num: num / g, den: den / g })
  return text.length <= RATE_TEXT_MAX && parseRate(text) ? text : null
}

/**
 * Para MOSTRAR una tasa: su decimal exacto si tiene `decimals` decimales o menos; si no (una fracción del cargo real),
 * redondeada a `decimals` decimales (mitades hacia arriba) y marcada como aproximada. Nunca se usa para calcular.
 */
export function rateForDisplay(rate: string, decimals = 6): { text: string; exact: boolean } | null {
  const r = parseRate(rate)
  if (!r) return null
  const exactText = rateToText(r)
  if (!exactText.includes('/') && (exactText.split('.')[1]?.length ?? 0) <= decimals) return { text: exactText, exact: true }
  const scale = 10n ** BigInt(decimals)
  const scaled = (2n * r.num * scale + r.den) / (2n * r.den)
  const s = scaled.toString().padStart(decimals + 1, '0')
  return { text: `${s.slice(0, -decimals)}.${s.slice(-decimals)}`.replace(/\.?0+$/, ''), exact: false }
}

/** Lo que escribió la persona en «Pagado en otra moneda» (ya leído a números y texto exacto). */
export type ForeignInput =
  /** Con una tasa (escrita o la del viaje), su fecha y la comisión de la tarjeta. */
  | { mode: 'rate'; currency: CurrencyCode; originalMinor: number; rate: string; rateDate: string; feeBps: number }
  /** Con lo que cobró el banco en la moneda del presupuesto: esa cifra manda y la tasa sale de las dos. */
  | { mode: 'actual'; currency: CurrencyCode; originalMinor: number; budgetMinor: number; date: string }

export type ForeignResult = { ok: true; amountMinor: number; original: OriginalAmount } | { ok: false; error: 'rate' | 'noAmount' }

/**
 * Convierte lo escrito en el importe del movimiento y su `original`. `noAmount`: con esa tasa el resultado no es un
 * importe (menos de medio céntimo o más del máximo); `rate`: la tasa no se lee o la del cargo real no cabe en el texto.
 */
export function foreignFromInput(input: ForeignInput, budgetCurrency: CurrencyCode): ForeignResult {
  if (input.mode === 'rate') {
    const parsed = parseRate(input.rate)
    if (!parsed) return { ok: false, error: 'rate' }
    const rate = rateToText(parsed)
    const amountMinor = convertToBudget(input.originalMinor, input.currency, budgetCurrency, rate, input.feeBps)
    if (amountMinor === null) return { ok: false, error: 'noAmount' }
    return {
      ok: true,
      amountMinor,
      original: {
        currency: input.currency,
        amountMinor: input.originalMinor,
        rate,
        rateDate: input.rateDate,
        rateSource: 'manual',
        ...(input.feeBps > 0 ? { feeBps: input.feeBps } : {}),
      },
    }
  }
  const rate = rateFromAmounts(input.budgetMinor, budgetCurrency, input.originalMinor, input.currency)
  if (!rate) return { ok: false, error: 'rate' }
  return {
    ok: true,
    amountMinor: input.budgetMinor,
    original: { currency: input.currency, amountMinor: input.originalMinor, rate, rateDate: input.date, rateSource: 'card_actual' },
  }
}
