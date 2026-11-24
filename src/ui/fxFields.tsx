/**
 * «Pagado en otra moneda» en el formulario de movimientos (Fase 3, decisión 178). Se carga aparte (`lazy` en
 * `MovementForm`) con sus textos en el paquete diferido `fx`: el JS inicial no crece.
 *
 * Dos maneras, siempre exactas (`domain/fxAdjust.ts`):
 * - «Con una tasa»: la escrita (o la del viaje en curso, que se propone) con su fecha y la comisión de la tarjeta. El
 *   importe en la moneda del presupuesto se calcula con un solo redondeo y se enseña la cuenta.
 * - «Con lo que cobró el banco» (ajustar al cargo real): esa cifra manda y la tasa sale de las dos.
 *
 * Nunca se inventa una tasa: sin tasa no hay importe y el formulario no guarda. Orden (decisión 181): la tasa del viaje
 * (se propone), si no la del Banco de Canadá (botón «Usar la tasa del Banco de Canadá», solo con Ajustes › Tasas del
 * Banco de Canadá encendido y presupuesto en CAD: la pide para la fecha del gasto y la pone en el campo con el aviso
 * «Tasa indicativa del Banco de Canadá del <fecha>»; si se cambia a mano, deja de serlo), y siempre «Con lo que cobró
 * el banco». Sin conexión o sin tasa publicada se dice y el campo queda como estaba.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { bocSeries, bocWindow, type BocRate } from '../domain/boc'
import { parseRate, rateToText } from '../domain/fx'
import { currencyName } from '../domain/formatters'
import { foreignFromInput, type ForeignResult } from '../domain/fxAdjust'
import { bpsToInputString, isSupportedCurrency, minorToInputString, parseMoney, parsePercentBps, SUPPORTED_CURRENCIES } from '../domain/money'
import { activeTrip, tripRate } from '../domain/trips'
import type { CurrencyCode, LocalDate, OriginalAmount } from '../domain/types'
import { isValidLocalDate } from '../domain/dates'
import { useT } from '../i18n'
import { packTranslator, usePack, type PackTranslate } from '../i18n/packs'
import { lookupBocRate, useBocEnabled } from '../state/bocRates'
import { useToday } from '../state/hooks'
import { useData } from '../state/store'
import { Toggle } from './components/base'
import { Icon } from './components/Icon'
import { MoneyField, Segmented, SelectField, TextField } from './components/fields'
import { PackLangScope } from './components/PackLangScope'
import { PackNotice } from './components/PackNotice'
import { useFormat, type Formatter } from './format'
import { feeLabel, rateInput, rateLabel, rateText } from './fxText'
import { moneyErrorMessage } from './moneyText'

/** Lo que el formulario necesita saber: si la sección está encendida y, si lo está, el resultado. */
export type ForeignState = { active: false } | { active: true; result: ForeignResult | { ok: false; error: 'input' } }

type Mode = 'rate' | 'actual'

/** La tasa del Banco de Canadá en el formulario: pedida y puesta en el campo, o por qué no hay. */
type BocState = { status: 'idle' | 'loading' | 'none' | 'offline' | 'error' } | { status: 'ok'; rate: BocRate }

/** Misma tasa aunque se escriba distinto («0,008910» y «0.00891»). */
const sameRate = (a: string, b: string) => {
  const x = parseRate(a)
  const y = parseRate(b)
  return !!x && !!y && rateToText(x) === rateToText(y)
}

export function ForeignAmount(props: {
  kind: 'expense' | 'income' | 'refund'
  date: LocalDate
  existing?: OriginalAmount
  amountText: string
  setAmountText: (text: string) => void
  /** Sube cada vez que se intenta guardar: desde entonces se enseñan los errores. */
  submitted: number
  onChange: (state: ForeignState) => void
}) {
  const pack = usePack('fx')
  if (pack.status === 'failed') return <PackNotice state={pack} />
  if (pack.status !== 'ready') return null
  return (
    <PackLangScope fallback={pack.fallback}>
      <ForeignBody {...props} texts={pack.texts} packLanguage={pack.language} />
    </PackLangScope>
  )
}

function ForeignBody({
  date,
  existing,
  amountText,
  setAmountText,
  submitted,
  onChange,
  texts,
  packLanguage,
}: Parameters<typeof ForeignAmount>[0] & { texts: Record<string, string>; packLanguage: Parameters<typeof packTranslator>[1] }) {
  const base = useT()
  const { t } = useMemo(() => packTranslator(texts, packLanguage, base), [texts, packLanguage, base])
  const fmt = useFormat()
  const data = useData()
  const budget = data.settings.currency
  const trip = activeTrip(data, date)
  const tripSettings = trip?.trip
  const firstCurrency = existing?.currency ?? tripSettings?.localCurrency ?? tripSettings?.currencies[0] ?? ''
  const prefill = (currency: string) => tripRate(tripSettings, currency)

  const [on, setOn] = useState(!!existing)
  const [currency, setCurrency] = useState<string>(firstCurrency)
  const [originalText, setOriginalText] = useState(() => (existing ? minorToInputString(existing.amountMinor, existing.currency, fmt.numberLocale) : ''))
  const [mode, setMode] = useState<Mode>(existing?.rateSource === 'card_actual' ? 'actual' : 'rate')
  const [rateValue, setRateValue] = useState(() =>
    existing && existing.rateSource !== 'card_actual'
      ? rateText(existing.rate, fmt.decimalSeparator)
      : rateText(prefill(firstCurrency)?.rate ?? '', fmt.decimalSeparator),
  )
  const [rateDate, setRateDate] = useState(() =>
    existing && existing.rateSource !== 'card_actual' ? existing.rateDate : (prefill(firstCurrency)?.date ?? date),
  )
  const [feeText, setFeeText] = useState(() => {
    const bps = existing ? (existing.feeBps ?? 0) : (tripSettings?.feeBps ?? 0)
    return bps > 0 ? bpsToInputString(bps, fmt.numberLocale) : ''
  })

  const bocOn = useBocEnabled()
  const today = useToday()
  // `for`: moneda y fecha para las que se pidió; con otra elegida, lo que pasó ya no se enseña.
  const [boc, setBoc] = useState<BocState & { for: string }>(() =>
    existing?.rateSource === 'boc'
      ? { status: 'ok', rate: { rate: existing.rate, rateDate: existing.rateDate }, for: `${existing.currency}|${date}` }
      : { status: 'idle', for: '' },
  )
  const bocKeyNow = `${currency}|${date}`
  // La última moneda y fecha elegidas: una petición que termina tarde (ya con otras) no pisa nada.
  const latestKey = useRef(bocKeyNow)
  useEffect(() => {
    latestKey.current = bocKeyNow
  }, [bocKeyNow])

  const chooseCurrency = (next: string) => {
    setCurrency(next)
    const r = prefill(next)
    setRateValue(rateText(r?.rate ?? '', fmt.decimalSeparator))
    setRateDate(r?.date ?? date)
    setBoc({ status: 'idle', for: '' })
  }

  const code = isSupportedCurrency(currency) && currency !== budget ? (currency as CurrencyCode) : null
  const foreignFmt: Formatter = { ...fmt, currency: code ?? fmt.currency }
  const locale = fmt.numberLocale
  const decimal = fmt.decimalSeparator
  // La tasa del campo es la del banco mientras sea la misma tasa y la misma fecha que llegaron.
  const bocShown: BocState = boc.status === 'ok' || boc.for === bocKeyNow ? boc : { status: 'idle' }
  const fromBoc = boc.status === 'ok' && sameRate(rateInput(rateValue, decimal), boc.rate.rate) && rateDate === boc.rate.rateDate
  // El botón solo sin tasa del viaje para esa moneda (va primero) y con una serie del banco.
  const bocOffer = bocOn && mode === 'rate' && !!code && !prefill(code)
  const bocSupported = !!code && bocSeries(budget, code) !== null

  const requestBoc = async () => {
    if (!code) return
    const key = bocKeyNow
    setBoc({ status: 'loading', for: key })
    const r = await lookupBocRate(budget, code, date, today)
    if (latestKey.current !== key) return
    if (r.status === 'ok') {
      setRateValue(rateText(r.rate.rate, decimal))
      setRateDate(r.rate.rateDate)
      setBoc({ status: 'ok', rate: r.rate, for: key })
    } else setBoc({ status: r.status === 'unsupported' ? 'none' : r.status, for: key })
  }
  // Todo se lee del texto escrito: el estado solo cambia cuando cambia lo escrito (así `onChange` no se repite).
  const parsed = useMemo(() => {
    const original = code ? parseMoney(originalText, code, locale) : null
    const fee = parsePercentBps(feeText.trim() === '' ? '0' : feeText, locale)
    const actual = parseMoney(amountText, budget, locale)
    const dateOk = isValidLocalDate(rateDate)
    let state: ForeignState = { active: false }
    if (on) {
      const bad: ForeignState = { active: true, result: { ok: false, error: 'input' } }
      if (!code || !original?.ok) state = bad
      else if (mode === 'rate') {
        state =
          !fee.ok || !dateOk
            ? bad
            : {
                active: true,
                result: foreignFromInput(
                  {
                    mode: 'rate',
                    currency: code,
                    originalMinor: original.minor,
                    rate: rateInput(rateValue, decimal),
                    rateDate,
                    feeBps: fee.minor,
                    rateSource: fromBoc ? 'boc' : 'manual',
                  },
                  budget,
                ),
              }
      } else {
        state = !actual.ok
          ? bad
          : {
              active: true,
              result: foreignFromInput({ mode: 'actual', currency: code, originalMinor: original.minor, budgetMinor: actual.minor, date }, budget),
            }
      }
    }
    return { original, fee, actual, dateOk, state }
  }, [on, code, originalText, mode, feeText, rateDate, rateValue, amountText, date, budget, locale, decimal, fromBoc])
  const { original, fee, actual, dateOk, state } = parsed

  useEffect(() => onChange(state), [state, onChange])
  // Con una tasa, el importe del movimiento es el calculado (los avisos y la división del formulario lo usan).
  const computed = state.active && state.result.ok && mode === 'rate' ? state.result.amountMinor : null
  useEffect(() => {
    if (computed !== null) setAmountText(fmt.moneyInput(computed))
  }, [computed, fmt, setAmountText])

  const show = submitted > 0
  const example = rateText('0.0092', fmt.decimalSeparator)
  const err = state.active && !state.result.ok ? state.result.error : null
  const currencies = [...new Set([...(tripSettings?.currencies ?? []), ...SUPPORTED_CURRENCIES.map((c) => c.code)])].filter((c) => c !== budget)

  return (
    <div className="stack-sm" data-testid="foreign-amount">
      <Toggle checked={on} onChange={setOn} label={t('fx.toggle')} hint={t('fx.toggleHelp', { budget })} />
      {on && (
        <>
          <SelectField
            label={t('fx.currency')}
            value={currency}
            onChange={(e) => chooseCurrency(e.target.value)}
            error={show && !code ? t('fx.error.currency') : null}
            options={[
              { value: '', label: t('fx.currencyChoose') },
              ...currencies.map((c) => ({ value: c, label: `${c} · ${currencyName(c, fmt.numberLocale)}` })),
            ]}
          />
          {code && (
            <MoneyField
              label={t('fx.amount', { currency: code })}
              value={originalText}
              onChange={setOriginalText}
              error={show && original && !original.ok ? moneyErrorMessage(base.t, original) : null}
              fmt={foreignFmt}
              big
              name="foreign-amount"
            />
          )}
          <Segmented<Mode>
            legend={t('fx.modeLabel', { budget })}
            name="foreign-mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'rate', label: t('fx.mode.rate') },
              { value: 'actual', label: t('fx.mode.actual') },
            ]}
          />
          {bocOffer && (
            <BocRow
              t={t}
              state={bocShown}
              supported={bocSupported}
              currency={code}
              from={fmt.date(bocWindow(date).start)}
              date={fmt.date(date)}
              onUse={() => void requestBoc()}
            />
          )}
          {mode === 'rate' ? (
            <RateFields
              t={t}
              budget={budget}
              currency={code ?? '—'}
              rateValue={rateValue}
              setRateValue={setRateValue}
              rateDate={rateDate}
              setRateDate={setRateDate}
              feeText={feeText}
              setFeeText={setFeeText}
              example={example}
              rateError={
                show && (err === 'rate' || err === 'noAmount') ? (err === 'rate' ? t('fx.error.rate', { example }) : t('fx.error.noAmount', { budget })) : null
              }
              dateError={show && !dateOk ? t('fx.error.date') : null}
              feeError={show && !fee.ok ? t('fx.error.fee') : null}
              fromTrip={
                fromBoc
                  ? t('fx.boc.notice', { date: fmt.date(rateDate) })
                  : trip && code && prefill(code) && rateInput(rateValue, fmt.decimalSeparator) === prefill(code)!.rate
                    ? t('fx.rateFromTrip', { trip: trip.name, date: fmt.date(prefill(code)!.date) })
                    : undefined
              }
            />
          ) : (
            <MoneyField
              label={t('fx.actual', { budget })}
              hint={t('fx.actualHelp')}
              value={amountText}
              onChange={setAmountText}
              error={show && !actual.ok ? moneyErrorMessage(base.t, actual) : show && err === 'rate' ? t('fx.error.rate', { example }) : null}
              fmt={fmt}
              name="foreign-actual"
            />
          )}
          {state.active && state.result.ok && (
            <p className="note" data-testid="foreign-result" aria-live="polite">
              {mode === 'rate'
                ? t(state.result.original.feeBps ? 'fx.resultFee' : 'fx.result', {
                    original: fmt.moneyIn(state.result.original.amountMinor, state.result.original.currency),
                    rate: rateLabel(state.result.original.rate, fmt.numberLocale),
                    fee: feeLabel(state.result.original.feeBps ?? 0, fmt.numberLocale),
                    amount: fmt.money(state.result.amountMinor),
                  })
                : t('fx.resultActual', {
                    rate: rateLabel(state.result.original.rate, fmt.numberLocale),
                    budget,
                    currency: state.result.original.currency,
                  })}{' '}
              {mode === 'rate' && t('fx.rounding')}
            </p>
          )}
        </>
      )}
    </div>
  )
}

/** «Usar la tasa del Banco de Canadá» y lo que pasó al pedirla (con texto, nunca solo color). */
function BocRow(p: { t: PackTranslate; state: BocState; supported: boolean; currency: string; from: string; date: string; onUse: () => void }) {
  if (!p.supported) return <p className="field__hint" data-testid="boc-unsupported">{p.t('fx.boc.unsupported', { currency: p.currency })}</p>
  const s = p.state.status
  const message =
    s === 'loading'
      ? p.t('fx.boc.loading')
      : s === 'none'
        ? p.t('fx.boc.none', { currency: p.currency, from: p.from, date: p.date })
        : s === 'offline'
          ? p.t('fx.boc.offline')
          : s === 'error'
            ? p.t('fx.boc.error')
            : null
  return (
    <div className="stack-sm" data-testid="boc-row">
      <div className="button-row">
        <button type="button" className="btn btn--secondary btn--small" onClick={p.onUse} disabled={s === 'loading'} aria-busy={s === 'loading'}>
          <Icon name="globe" size={16} />
          {p.t('fx.boc.use')}
        </button>
      </div>
      <p className={s === 'none' || s === 'offline' || s === 'error' ? 'field__error' : 'field__hint'} role="status" data-testid="boc-status">
        {message && (s === 'none' || s === 'offline' || s === 'error') && <Icon name="alert" size={16} />}
        {message}
      </p>
    </div>
  )
}

function RateFields(p: {
  t: PackTranslate
  budget: string
  currency: string
  rateValue: string
  setRateValue: (v: string) => void
  rateDate: string
  setRateDate: (v: string) => void
  feeText: string
  setFeeText: (v: string) => void
  example: string
  rateError: string | null
  dateError: string | null
  feeError: string | null
  fromTrip?: string
}) {
  return (
    <>
      <TextField
        label={p.t('fx.rate', { budget: p.budget, currency: p.currency })}
        hint={p.fromTrip ?? p.t('fx.rateHelp', { example: p.example })}
        value={p.rateValue}
        onChange={(e) => p.setRateValue(e.target.value)}
        inputMode="decimal"
        autoComplete="off"
        name="foreign-rate"
        error={p.rateError}
      />
      <TextField
        label={p.t('fx.rateDate')}
        type="date"
        value={p.rateDate}
        onChange={(e) => p.setRateDate(e.target.value)}
        name="foreign-rate-date"
        error={p.dateError}
      />
      <TextField
        label={p.t('fx.fee')}
        hint={p.t('fx.feeHelp')}
        value={p.feeText}
        onChange={(e) => p.setFeeText(e.target.value)}
        inputMode="decimal"
        autoComplete="off"
        name="foreign-fee"
        error={p.feeError}
      />
    </>
  )
}
