/**
 * Movimientos en otra moneda (Fase 3 nativa, decisión 175; ver `docs/FORMULAS.md` §45).
 *
 * Un movimiento sigue guardando su importe en la moneda del presupuesto (`amountMinor`): todas las fórmulas de Clara
 * siguen igual. Si se pagó en otra moneda, además guarda `original`: la moneda, el importe en ESA moneda, la tasa usada,
 * su fecha y de dónde salió (escrita a mano, del Banco de Canadá o ajustada al cargo real del banco), y la comisión de la
 * tarjeta si la hubo.
 *
 * - La tasa es «unidades de la moneda del presupuesto por 1 unidad de la otra» (JPY → CAD: «0.0092»). Se guarda como
 *   texto exacto: un decimal («1.3950») o una fracción de enteros («1371/1250»). Nunca un flotante.
 * - Importe = original × tasa × (1 + comisión), en aritmética entera (BigInt) y con UN solo redondeo, al céntimo más
 *   cercano (las mitades hacia arriba). Así el mismo `original` da siempre el mismo `amountMinor` y la validación lo
 *   comprueba.
 * - «Ajustar al cargo real»: cuando el banco dice cuánto se cobró de verdad, ese importe manda y la tasa pasa a ser la
 *   fracción exacta entre los dos importes (`rateFromAmounts`), sin comisión aparte (ya va dentro).
 * - Nunca se inventa una tasa: sin tasa, no hay importe (la captura queda como propuesta; el formulario no deja guardar).
 */
import { currencyDigits, isSupportedCurrency, MAX_AMOUNT_MINOR } from './money'
import type { CurrencyCode } from './types'

export interface RateFraction {
  num: bigint
  den: bigint
}

/** Decimales como mucho en una tasa escrita como decimal (el Banco de Canadá publica 4 o 6). */
export const RATE_MAX_DECIMALS = 12
/** Largo máximo del texto de una tasa (también fracciones). */
export const RATE_TEXT_MAX = 40
/** La tasa más alta aceptada: 1 unidad de la otra moneda = 1 000 000 de la del presupuesto. */
const RATE_MAX = 1_000_000n
/** Comisión de tarjeta, en puntos básicos (250 = 2,5 %). Hasta el 100 %. */
export const FEE_BPS_MAX = 10_000

const DECIMAL = /^(\d{1,15})(?:\.(\d{1,12}))?$/
const FRACTION = /^(\d{1,20})\/(\d{1,20})$/

const gcd = (a: bigint, b: bigint): bigint => {
  while (b) [a, b] = [b, a % b]
  return a
}

/** Lee una tasa («1.3950», «0.0092», «1371/1250»). `null` si no es un número positivo exacto o es desmesurada. */
export function parseRate(text: string): RateFraction | null {
  const t = text.trim()
  if (t.length === 0 || t.length > RATE_TEXT_MAX) return null
  let num: bigint
  let den: bigint
  const d = DECIMAL.exec(t)
  if (d) {
    const frac = d[2] ?? ''
    num = BigInt(d[1]! + frac)
    den = 10n ** BigInt(frac.length)
  } else {
    const f = FRACTION.exec(t)
    if (!f) return null
    num = BigInt(f[1]!)
    den = BigInt(f[2]!)
  }
  if (num <= 0n || den <= 0n || num > RATE_MAX * den) return null
  const g = gcd(num, den)
  return { num: num / g, den: den / g }
}

/** Texto canónico de una tasa: decimal si cabe exacto en 12 decimales; si no, fracción reducida. */
export function rateToText(rate: RateFraction): string {
  let den = rate.den
  let twos = 0
  let fives = 0
  while (den % 2n === 0n) {
    den /= 2n
    twos += 1
  }
  while (den % 5n === 0n) {
    den /= 5n
    fives += 1
  }
  const places = Math.max(twos, fives)
  if (den === 1n && places <= RATE_MAX_DECIMALS) {
    const scaled = (rate.num * 10n ** BigInt(places)) / rate.den
    if (places === 0) return scaled.toString()
    const s = scaled.toString().padStart(places + 1, '0')
    return `${s.slice(0, -places)}.${s.slice(-places)}`.replace(/\.?0+$/, '')
  }
  return `${rate.num}/${rate.den}`
}

/**
 * Importe en unidades menores de la moneda del presupuesto: `originalMinor` (unidades menores de `from`) × tasa ×
 * (10 000 + comisión) / 10 000, redondeado al entero más cercano (mitades hacia arriba). `null` si la tasa no se lee, una
 * moneda no está admitida, el resultado no es positivo o pasa del importe máximo.
 */
export function convertToBudget(originalMinor: number, from: string, to: string, rate: string, feeBps = 0): number | null {
  if (!Number.isSafeInteger(originalMinor) || originalMinor <= 0) return null
  if (!isSupportedCurrency(from) || !isSupportedCurrency(to)) return null
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > FEE_BPS_MAX) return null
  const r = parseRate(rate)
  if (!r) return null
  const shift = currencyDigits(to as CurrencyCode) - currencyDigits(from as CurrencyCode)
  let n = BigInt(originalMinor) * r.num * BigInt(10_000 + feeBps)
  let d = r.den * 10_000n
  if (shift >= 0) n *= 10n ** BigInt(shift)
  else d *= 10n ** BigInt(-shift)
  const rounded = (2n * n + d) / (2n * d)
  if (rounded <= 0n || rounded > BigInt(MAX_AMOUNT_MINOR)) return null
  return Number(rounded)
}

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
