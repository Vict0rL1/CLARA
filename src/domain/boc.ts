/**
 * Tasas del Banco de Canadá (Valet) — lo puro: qué se pide, cómo se lee la respuesta y qué tasa se usa (Fase 3,
 * decisión 181; comprobado contra la API real el 2026-11-16, ver `docs/BOC-VALET.md` y `docs/FORMULAS.md` §47).
 *
 * - Solo con presupuesto en CAD: las series diarias son «FX<moneda>CAD», dólares canadienses por 1 unidad de la otra
 *   moneda, que es justo la tasa de Clara (`fx.ts`: unidades del presupuesto por 1 unidad de la otra).
 * - Se pide UNA serie y dos fechas (`start_date`, `end_date`): nada de la persona (ni importe, ni comercio, ni cuenta).
 * - La tasa es el texto tal cual lo publica el banco («0.008940», «1.3737»): se lee con `parseRate`, nunca como número.
 * - La que se usa es la de la última observación con fecha ≤ la del gasto (los fines de semana y festivos no hay), y
 *   como mucho `BOC_LOOKBACK_DAYS` días antes: una serie que dejó de publicarse (VND desde 2019) no da una tasa vieja.
 * - Sin observación en ese margen, sin conexión, una respuesta que no se entiende o una serie que no existe: no hay
 *   tasa. Nunca se inventa una.
 *
 * La petición, la caché y el interruptor están fuera del dominio (`state/bocRates.ts`).
 */
import { addDays, isValidLocalDate } from './dates'
import { convertToBudget, parseRate, rateToText } from './fx'
import { isSupportedCurrency } from './money'
import type { CurrencyCode, LocalDate, OriginalAmount } from './types'

/** Origen que la CSP de la versión compilada abre en `connect-src` (`vite.config.ts`). Nada más. */
export const BOC_ORIGIN = 'https://www.bankofcanada.ca'
export const BOC_VALET_BASE = `${BOC_ORIGIN}/valet`

/**
 * Monedas de Clara con serie diaria en el grupo `FX_RATES_DAILY` (leído el 2026-11-16: 27 series; FXRUBCAD no está
 * aquí porque Clara no admite el rublo). Que esté en la lista no garantiza que se siga publicando: lo decide la fecha
 * de la última observación (`BOC_LOOKBACK_DAYS`).
 */
export const BOC_CURRENCIES: readonly CurrencyCode[] = [
  'AUD', 'BRL', 'CHF', 'CNY', 'EUR', 'GBP', 'HKD', 'IDR', 'INR', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PEN', 'PLN',
  'SAR', 'SEK', 'SGD', 'THB', 'TRY', 'TWD', 'USD', 'VND', 'ZAR',
] as CurrencyCode[]

/**
 * Días hacia atrás desde la fecha del gasto en los que se busca la última tasa publicada. El hueco más largo visto en
 * días hábiles es de 4 días sin tasa (del 25 al 28 de diciembre de 2025); 10 cubre cualquier puente de festivos y deja
 * fuera una serie que ya no se publica.
 */
export const BOC_LOOKBACK_DAYS = 10

/** Una tasa publicada: texto exacto canónico (`rateToText`) y el día al que corresponde. */
export interface BocRate {
  rate: string
  rateDate: LocalDate
}

/** La serie de una moneda si el presupuesto es en CAD y el banco la publica; si no, `null` (no se pide nada). */
export function bocSeries(budgetCurrency: string, currency: string): string | null {
  if (budgetCurrency !== 'CAD' || currency === 'CAD' || !isSupportedCurrency(currency)) return null
  return BOC_CURRENCIES.includes(currency as CurrencyCode) ? `FX${currency}CAD` : null
}

/** Fechas que se piden para un gasto del día `date`: de `date − BOC_LOOKBACK_DAYS` a `date` (el banco exige inicio < fin). */
export function bocWindow(date: LocalDate): { start: LocalDate; end: LocalDate } {
  return { start: addDays(date, -BOC_LOOKBACK_DAYS), end: date }
}

/** La dirección exacta de las observaciones de una serie entre dos fechas (formato JSON). Sin nada más. */
export function bocObservationsUrl(series: string, date: LocalDate): string {
  const { start, end } = bocWindow(date)
  return `${BOC_VALET_BASE}/observations/${encodeURIComponent(series)}/json?start_date=${start}&end_date=${end}`
}

/** Una tasa como la publica el banco: decimal con punto, sin signo ni exponente. */
const PUBLISHED_RATE = /^\d{1,15}(?:\.\d{1,12})?$/

export type BocParse = { ok: true; observations: BocRate[] } | { ok: false; error: 'notFound' | 'malformed' }

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Lee la respuesta JSON de `/observations/<serie>/json`. Exige `seriesDetail.<serie>` y `observations` como lista; cada
 * observación con fecha válida (`d`) y valor de texto (`<serie>.v`). Una sin valor de esa serie se salta; un valor que
 * no es un decimal exacto positivo hace que TODA la respuesta se rechace (no se elige entre datos dudosos). La
 * respuesta de una serie que no existe (`{"message": "Series … not found."}`, HTTP 404) es `notFound`.
 */
export function parseBocObservations(json: unknown, series: string): BocParse {
  if (!isObject(json)) return { ok: false, error: 'malformed' }
  if (!('observations' in json) && typeof json.message === 'string' && /not found/i.test(json.message)) return { ok: false, error: 'notFound' }
  const detail = json.seriesDetail
  if (!isObject(detail) || !isObject(detail[series]) || !Array.isArray(json.observations)) return { ok: false, error: 'malformed' }
  const out: BocRate[] = []
  for (const o of json.observations) {
    if (!isObject(o) || !isValidLocalDate(o.d)) return { ok: false, error: 'malformed' }
    const cell = o[series]
    if (cell === undefined) continue
    if (!isObject(cell) || typeof cell.v !== 'string' || !PUBLISHED_RATE.test(cell.v)) return { ok: false, error: 'malformed' }
    const parsed = parseRate(cell.v)
    if (!parsed) return { ok: false, error: 'malformed' }
    out.push({ rate: rateToText(parsed), rateDate: o.d })
  }
  return { ok: true, observations: out }
}

/**
 * La tasa para un gasto del día `date`: la observación de fecha más reciente ≤ `date` y ≥ `date − BOC_LOOKBACK_DAYS`.
 * No depende del orden de la lista. `null` si no hay ninguna en ese margen.
 */
export function pickBocRate(observations: readonly BocRate[], date: LocalDate): BocRate | null {
  const { start } = bocWindow(date)
  let best: BocRate | null = null
  for (const o of observations) {
    if (o.rateDate > date || o.rateDate < start) continue
    if (!best || o.rateDate > best.rateDate) best = o
  }
  return best
}

/**
 * ¿Ya no puede cambiar la tasa elegida para `date`? Si es la del mismo día, sí (el banco publica una por día hábil). Si
 * es de antes (o no hay), solo cuando `date` quedó al menos dos días atrás: hoy o ayer la del día aún puede publicarse
 * (hacia las 16:30 de Ottawa, y el día de la persona puede ir por delante). Solo lo definitivo se guarda en la caché.
 */
export function bocResultFinal(date: LocalDate, picked: BocRate | null, today: LocalDate): boolean {
  if (picked && picked.rateDate === date) return true
  return date <= addDays(today, -2)
}

/**
 * `original` y el importe en CAD de un gasto en otra moneda con la tasa del banco (y la comisión de la tarjeta del viaje
 * si la hay): mismo cálculo que una tasa escrita (`convertToBudget`, un solo redondeo), con `rateSource: 'boc'` y la
 * fecha de la observación. `null` si no sale un importe (presupuesto que no es CAD, menos de medio céntimo…).
 */
export function bocConversion(
  foreign: { currency: CurrencyCode; minor: number },
  budgetCurrency: CurrencyCode,
  rate: BocRate,
  feeBps = 0,
): { amountMinor: number; original: OriginalAmount } | null {
  if (!bocSeries(budgetCurrency, foreign.currency)) return null
  const amountMinor = convertToBudget(foreign.minor, foreign.currency, budgetCurrency, rate.rate, feeBps)
  if (amountMinor === null) return null
  return {
    amountMinor,
    original: { currency: foreign.currency, amountMinor: foreign.minor, rate: rate.rate, rateDate: rate.rateDate, rateSource: 'boc', ...(feeBps > 0 ? { feeBps } : {}) },
  }
}

/** Clave de una tasa ya pedida (para pasarla a la importación de capturas, que es síncrona). */
export const bocKey = (currency: string, date: LocalDate) => `${currency}|${date}`
