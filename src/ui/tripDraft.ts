/** Lo escrito en la sección «Modo viaje» del formulario de un periodo y su lectura a `TripSettings` (ver `tripUi.tsx`). */
import { parseRate, rateToText } from '../domain/fx'
import { bpsToInputString, parsePercentBps } from '../domain/money'
import type { CurrencyCode, LocalDate, TripSettings } from '../domain/types'
import { rateInput, rateText } from './fxText'

/** Lo escrito en la sección «Modo viaje» del formulario (texto, no un registro). */
export interface TripDraft {
  on: boolean
  currencies: CurrencyCode[]
  local: string
  rates: Record<string, { rate: string; date: LocalDate }>
  fee: string
}

export function tripDraftFrom(trip: TripSettings | undefined, decimal: string, locale: string): TripDraft {
  return {
    on: !!trip,
    currencies: trip?.currencies ?? [],
    local: trip?.localCurrency ?? '',
    rates: Object.fromEntries((trip?.rates ?? []).map((r) => [r.currency, { rate: rateText(r.rate, decimal), date: r.date }])),
    fee: trip?.feeBps ? bpsToInputString(trip.feeBps, locale) : '',
  }
}

export type TripDraftCheck = { ok: true; trip: TripSettings | null } | { ok: false; noCurrencies: boolean; badRates: string[]; badFee: boolean }

/** De lo escrito a `TripSettings` (o `null`: apagado). Una tasa vacía es «sin tasa»; una que no se lee es un error. */
export function tripFromDraft(draft: TripDraft, decimal: string, locale: string): TripDraftCheck {
  if (!draft.on) return { ok: true, trip: null }
  const badRates: string[] = []
  const rates: TripSettings['rates'] = []
  for (const currency of draft.currencies) {
    const typed = draft.rates[currency]
    if (!typed || typed.rate.trim() === '') continue
    const parsed = parseRate(rateInput(typed.rate, decimal))
    if (!parsed) badRates.push(currency)
    else rates.push({ currency, rate: rateToText(parsed), date: typed.date })
  }
  const fee = parsePercentBps(draft.fee.trim() === '' ? '0' : draft.fee, locale)
  const noCurrencies = draft.currencies.length === 0
  if (noCurrencies || badRates.length > 0 || !fee.ok) return { ok: false, noCurrencies, badRates, badFee: !fee.ok }
  const local = draft.currencies.includes(draft.local as CurrencyCode) ? (draft.local as CurrencyCode) : undefined
  return { ok: true, trip: { currencies: draft.currencies, ...(local ? { localCurrency: local } : {}), rates, ...(fee.minor > 0 ? { feeBps: fee.minor } : {}) } }
}

