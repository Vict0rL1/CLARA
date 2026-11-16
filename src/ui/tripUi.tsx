/**
 * Modo viaje en las pantallas de presupuestos por periodo (Fase 3, decisión 176). Va dentro de `PackBody` del paquete
 * `periods` (textos `period.trip.*`). Las cuentas están en `domain/trips.ts` y `domain/fx.ts`; aquí solo se muestran.
 *
 * - `TripFields`: en el formulario de un periodo «Viaje», monedas, moneda local actual, una tasa por moneda con su fecha
 *   (vacía = sin tasa: nunca se inventa) y la comisión de la tarjeta.
 * - `TripCard`: en el detalle, «Ahora estás en», lo gastado por moneda, el total, el gasto por día, lo que espera tasa y
 *   las tasas del viaje.
 */
import { useState } from 'react'
import { currencyName } from '../domain/formatters'
import { isSupportedCurrency, SUPPORTED_CURRENCIES } from '../domain/money'
import { setTripLocalCurrency, tripSummary } from '../domain/trips'
import type { CurrencyCode, LocalDate, PeriodBudget } from '../domain/types'
import { TRIP_CURRENCIES_MAX } from '../domain/validation'
import { useRun, useToday } from '../state/hooks'
import { useData } from '../state/store'
import { Toggle } from './components/base'
import { Alert, Explain } from './components/common'
import { SelectField, TextField } from './components/fields'
import { Icon } from './components/Icon'
import { usePackT } from './components/packTexts'
import { useToast } from './components/toastContext'
import { useFormat } from './format'
import { feeLabel, rateLabel, rateText } from './fxText'
import { tripFromDraft, type TripDraft } from './tripDraft'
import { href } from './router'

export function TripFields({ draft, setDraft, showErrors }: { draft: TripDraft; setDraft: (d: TripDraft) => void; showErrors: boolean }) {
  const { t } = usePackT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const [adding, setAdding] = useState('')
  const budget = data.settings.currency
  const check = tripFromDraft(draft, fmt.decimalSeparator, fmt.numberLocale)
  const example = rateText('0.0092', fmt.decimalSeparator)
  const choices = SUPPORTED_CURRENCIES.map((c) => c.code).filter((c) => c !== budget && !draft.currencies.includes(c))
  const add = (code: string) => {
    if (!isSupportedCurrency(code) || draft.currencies.length >= TRIP_CURRENCIES_MAX) return
    const currencies = [...draft.currencies, code as CurrencyCode]
    setDraft({ ...draft, currencies, local: draft.local || code, rates: { ...draft.rates, [code]: draft.rates[code] ?? { rate: '', date: today } } })
    setAdding('')
  }
  const remove = (code: CurrencyCode) => {
    const { [code]: _gone, ...rates } = draft.rates
    setDraft({ ...draft, currencies: draft.currencies.filter((c) => c !== code), local: draft.local === code ? '' : draft.local, rates })
  }
  const setRate = (code: string, patch: Partial<{ rate: string; date: LocalDate }>) => setDraft({ ...draft, rates: { ...draft.rates, [code]: { rate: '', date: today, ...draft.rates[code], ...patch } } })

  return (
    <div className="stack-sm" data-testid="trip-fields">
      <Toggle checked={draft.on} onChange={(on) => setDraft({ ...draft, on })} label={t('period.trip.toggle')} hint={t('period.trip.toggleHelp')} />
      {draft.on && (
        <fieldset className="stack-sm">
          <legend className="field__label">{t('period.trip.currencies')}</legend>
          {draft.currencies.length > 0 && (
            <ul className="chips" aria-label={t('period.trip.currencies')}>
              {draft.currencies.map((c) => (
                <li key={c}>
                  <button type="button" className="btn btn--secondary btn--small" onClick={() => remove(c)} aria-label={t('period.trip.removeCurrency', { currency: c })}>
                    {c}
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {draft.currencies.length < TRIP_CURRENCIES_MAX && (
            <SelectField
              label={t('period.trip.addCurrency')}
              value={adding}
              onChange={(e) => add(e.target.value)}
              error={showErrors && !check.ok && check.noCurrencies ? t('period.trip.noCurrencies') : null}
              options={[{ value: '', label: t('period.trip.addChoose') }, ...choices.map((c) => ({ value: c, label: `${c} · ${currencyName(c, fmt.numberLocale)}` }))]}
            />
          )}
          {draft.currencies.length > 0 && (
            <SelectField
              label={t('period.trip.local')}
              hint={t('period.trip.localHelp')}
              value={draft.currencies.includes(draft.local as CurrencyCode) ? draft.local : ''}
              onChange={(e) => setDraft({ ...draft, local: e.target.value })}
              options={[{ value: '', label: t('period.trip.localNone') }, ...draft.currencies.map((c) => ({ value: c, label: c }))]}
            />
          )}
          {draft.currencies.map((c) => (
            <div key={c} className="form-grid">
              <TextField
                label={t('period.trip.rate', { currency: c, budget })}
                hint={t('period.trip.rateHelp', { currency: c })}
                value={draft.rates[c]?.rate ?? ''}
                onChange={(e) => setRate(c, { rate: e.target.value })}
                inputMode="decimal"
                autoComplete="off"
                error={showErrors && !check.ok && check.badRates.includes(c) ? t('period.trip.rateError', { example }) : null}
              />
              <TextField label={t('period.trip.rateDate', { currency: c })} type="date" value={draft.rates[c]?.date ?? today} onChange={(e) => setRate(c, { date: e.target.value })} />
            </div>
          ))}
          <TextField
            label={t('period.trip.fee')}
            hint={t('period.trip.feeHelp')}
            value={draft.fee}
            onChange={(e) => setDraft({ ...draft, fee: e.target.value })}
            inputMode="decimal"
            autoComplete="off"
            error={showErrors && !check.ok && check.badFee ? t('period.trip.feeError') : null}
          />
        </fieldset>
      )}
    </div>
  )
}

export function TripCard({ budget }: { budget: PeriodBudget }) {
  const { t, tn } = usePackT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const trip = budget.trip
  if (!trip) return null
  const s = tripSummary(data, budget, today)
  const budgetCurrency = budget.currency

  const changeLocal = async (value: string) => {
    const currency = trip.currencies.includes(value as CurrencyCode) ? (value as CurrencyCode) : null
    const { result, saved } = await run((d, c) => setTripLocalCurrency(d, budget.id, currency, c))
    const ok = result.ok && saved
    toast({ message: ok ? (currency ? t('period.trip.nowSaved', { currency }) : t('period.trip.nowCleared')) : t('save.error.generic'), tone: ok ? 'good' : 'critical' })
  }

  return (
    <section className="card" aria-labelledby="trip-title" data-testid="trip-card">
      <h2 className="card__title" id="trip-title">
        {t('period.trip.title')}
      </h2>
      {!budget.archived && (
        <SelectField
          label={t('period.trip.now')}
          hint={t('period.trip.localHelp')}
          value={trip.localCurrency ?? ''}
          onChange={(e) => void changeLocal(e.target.value)}
          options={[{ value: '', label: t('period.trip.localNone') }, ...trip.currencies.map((c) => ({ value: c, label: `${c} · ${currencyName(c, fmt.numberLocale)}` }))]}
        />
      )}
      <h3 className="stat__label">{t('period.trip.byCurrency')}</h3>
      {s.byCurrency.length === 0 ? (
        <p className="note">{t('period.trip.empty')}</p>
      ) : (
        <ul className="item-list" data-testid="trip-currencies">
          {s.byCurrency.map((line) => (
            <li key={line.currency} className="item">
              <span className="item__main">
                <span className="item__title">{line.originalMinor === null ? `${line.currency} · ${t('period.trip.noFigure')}` : fmt.moneyIn(line.originalMinor, line.currency)}</span>
                <span className="item__meta">
                  {t('period.trip.col.count')}: {line.count}
                </span>
              </span>
              <span className="item__side">
                <span className="item__amount">{line.convertedMinor === null ? t('period.trip.noFigure') : fmt.money(line.convertedMinor)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="stat__value" data-testid="trip-total">
        {t('period.trip.total', { budget: budgetCurrency })}: {fmt.money(s.period.spentMinor)}
      </p>
      {s.spentPerDayMinor === null ? (
        <p className="note">{t('period.trip.notStarted')}</p>
      ) : (
        <p data-testid="trip-per-day">
          {t('period.trip.perDay', { amount: fmt.money(s.spentPerDayMinor) })} <span className="note">{tn('period.trip.perDayHow', s.daysElapsed, { total: fmt.money(s.period.spentMinor) })}</span>
        </p>
      )}
      {s.unconvertedProposals > 0 && (
        <Alert tone="warning" icon="alert" title={tn('period.trip.unconverted', s.unconvertedProposals)}>
          <a className="btn btn--secondary btn--small" href={href('/pendientes')}>
            {t('period.trip.openInbox')}
          </a>
        </Alert>
      )}
      {s.bocConverted > 0 && (
        <p className="note" data-testid="trip-boc">
          <Icon name="globe" size={16} /> {tn('period.trip.bocCount', s.bocConverted)}
        </p>
      )}
      <h3 className="stat__label">{t('period.trip.rates')}</h3>
      <ul className="stack-sm" data-testid="trip-rates">
        {trip.currencies.map((c) => {
          const r = trip.rates.find((x) => x.currency === c)
          return <li key={c}>{r ? t('period.trip.rateLine', { currency: c, rate: rateLabel(r.rate, fmt.numberLocale), budget: budgetCurrency, date: fmt.date(r.date, { compact: true, today }) }) : t('period.trip.rateMissing', { currency: c })}</li>
        })}
        {trip.feeBps ? <li>{t('period.trip.feeLine', { fee: feeLabel(trip.feeBps, fmt.numberLocale) })}</li> : null}
      </ul>
      <Explain>
        <p>{t('period.trip.how', { budget: budgetCurrency })}</p>
      </Explain>
    </section>
  )
}
