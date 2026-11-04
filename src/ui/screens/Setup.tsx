/**
 * Configuración inicial (se muestra cuando no hay datos guardados).
 * Todo lo que se pide es opcional salvo moneda y saldo; se puede explorar la demo.
 */
import { useRef, useState } from 'react'
import { currencyName } from '../../domain/formatters'
import { defaultSettingsV9 } from '../../domain/defaults'
import { computeBudget, type BudgetResult } from '../../domain/budget'
import { detectTimeZone, todayInTimeZone } from '../../domain/dates'
import { SUPPORTED_CURRENCIES } from '../../domain/money'
import { createInitialData, type SetupInput } from '../../domain/operations'
import type { AppData, BudgetPeriodType, Frequency, GoalFunding, Language, NumberLocale, Settings } from '../../domain/types'
import { BUDGET_PERIOD_TYPES } from '../../domain/validation'
import { defaultOnboardingCategoryIds, EXPENSE_CATEGORY_IDS, INCOME_CATEGORY_IDS, systemCategoryMeta } from '../../domain/categories'
import { newId } from '../../domain/ids'
import { saveCategoryV2 } from '../../domain/categoryOps'
import { categoryLabel } from '../labels'
import { periodLabel } from '../periodLabel'
import { FREQUENCIES, LANGUAGES, NUMBER_LOCALES, type Issue } from '../../domain/validation'
import { createDemoData } from '../../demo/demoData'
import { useT, type MessageKey } from '../../i18n'
import { getStore } from '../../state/store'
import { Alert, CalcRow, Card } from '../components/common'
import { MoneyField, Segmented, SelectField, TextField } from '../components/fields'
import { SecondDayField } from '../components/SecondDayField'
import { secondDayError, secondDayFrom } from '../secondDay'
import { moneyErrorMessage } from '../moneyText'
import { Icon } from '../components/Icon'
import { WelcomeRestore } from './setup/WelcomeRestore'
import { CategoryIcon } from '../components/CategoryIcon'
import { createFormatter } from '../format'
import { frequencyLabel, issueMessage } from '../labels'
import { parseMoney } from '../../domain/money'

interface BillRow {
  key: number
  name: string
  amount: string
  date: string
  frequency: Frequency
  /** Solo «dos veces al mes»: vacío = 15 días después (o antes) del primero. */
  secondDay: string
}

const STEPS = 6

function guessLocale(): NumberLocale {
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'es'
  if (lang.startsWith('es-ES')) return 'es-ES'
  if (lang.startsWith('fr')) return 'fr-CA'
  return 'es-MX'
}

export function Setup({ language, onLanguageChange }: { language: Language; onLanguageChange: (l: Language) => void }) {
  const { t, tn } = useT()
  const [timeZone] = useState(detectTimeZone)
  const [today] = useState(() => todayInTimeZone(timeZone))
  const billKey = useRef(0)
  const [step, setStep] = useState(0)
  const [currency, setCurrency] = useState('CAD')
  const [periodType, setPeriodType] = useState<BudgetPeriodType>('month')
  const [categoryIds, setCategoryIds] = useState<string[]>(defaultOnboardingCategoryIds)
  const [ownCategories, setOwnCategories] = useState<{ id: string; name: string; kind: 'expense' | 'income' }[]>([])
  const [ownName, setOwnName] = useState('')
  const [ownKind, setOwnKind] = useState<'expense' | 'income'>('expense')
  const [numberLocale, setNumberLocale] = useState<NumberLocale>(guessLocale)
  const [accountName, setAccountName] = useState('')
  const [balance, setBalance] = useState('')
  const [balanceDate, setBalanceDate] = useState(today)
  const [hasIncome, setHasIncome] = useState<'yes' | 'no'>('yes')
  const [incomeName, setIncomeName] = useState('')
  const [incomeAmount, setIncomeAmount] = useState('')
  const [incomeDate, setIncomeDate] = useState('')
  const [incomeFrequency, setIncomeFrequency] = useState<Frequency>('biweekly')
  const [incomeSecondDay, setIncomeSecondDay] = useState('')
  const [incomeVariable, setIncomeVariable] = useState<'fixed' | 'variable'>('fixed')
  const [horizon, setHorizon] = useState('14')
  const [bills, setBills] = useState<BillRow[]>([])
  const [reserve, setReserve] = useState('')
  const [reserveWhere, setReserveWhere] = useState<GoalFunding>('budget')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [issues, setIssues] = useState<Issue[]>([])
  const [busy, setBusy] = useState(false)

  const settings: Settings = { currency, numberLocale, dateStyle: 'medium', timeZone, language, fallbackHorizonDays: null, ...defaultSettingsV9({ periodType, onboardingDone: true }) }
  const fmt = createFormatter(settings)
  const money = (text: string, opts: { allowNegative?: boolean; allowZero?: boolean } = {}) => parseMoney(text, currency, numberLocale, opts)

  /**
   * UX-02: aviso del resumen sin fecha de ingreso. Describe el horizonte que `computeBudget` usó de
   * verdad (periodo de calendario o días elegidos), nunca un valor del formulario que no participó.
   */
  const provisionalIncomeNote = (b: BudgetResult): string | null => {
    if (hasIncome !== 'no' || !b.horizon) return null
    if (b.horizon.source === 'period' && b.period) {
      return t('setup.summary.provisionalPeriod', { label: periodLabel(t, fmt, b.period), date: fmt.date(b.period.end, { weekday: true }), days: tn('home.periodDays', b.period.daysLeft) })
    }
    if (b.horizon.source === 'fallback') return t('setup.summary.provisionalIncome', { days: b.horizon.days, date: fmt.date(b.horizon.endDate, { weekday: true }) })
    return null
  }

  /** Valida el paso actual y construye la entrada de configuración si todo está bien. */
  const buildInput = (upTo: number): { input: SetupInput | null; errs: Record<string, string> } => {
    const errs: Record<string, string> = {}
    const bal = money(balance, { allowNegative: true, allowZero: true })
    if (upTo >= 1 && (!EXPENSE_CATEGORY_IDS.some((id) => categoryIds.includes(id)) || !INCOME_CATEGORY_IDS.some((id) => categoryIds.includes(id)))) errs.categories = t('setup.categories.needOne')
    if (upTo >= 2) {
      if (!bal.ok) errs.balance = moneyErrorMessage(t, bal)!
      if (!balanceDate) errs.balanceDate = t('issue.invalidDate')
      else if (balanceDate > today) errs.balanceDate = t('issue.realizedInFuture')
    }
    let income: SetupInput['income'] = null
    if (upTo >= 3 && hasIncome === 'yes') {
      const amt = money(incomeAmount)
      if (!amt.ok) errs.incomeAmount = moneyErrorMessage(t, amt)!
      if (!incomeDate) errs.incomeDate = t('setup.income.dateRequired')
      const twice = incomeFrequency === 'semimonthly'
      if (twice && secondDayError(incomeDate, incomeSecondDay)) errs.incomeSecondDay = t('issue.semimonthlyDays')
      if (amt.ok && incomeDate) {
        income = { name: incomeName.trim() || t('setup.income.defaultName'), amountMinor: amt.minor, date: incomeDate, frequency: incomeFrequency, isEstimate: incomeVariable === 'variable', ...(twice ? { secondDay: secondDayFrom(incomeDate, incomeSecondDay) } : {}) }
      }
    }
    const billInputs: SetupInput['bills'] = []
    if (upTo >= 4) {
      bills.forEach((b) => {
        const amt = money(b.amount)
        if (!b.name.trim()) errs[`bill-${b.key}-name`] = t('issue.required')
        if (!amt.ok) errs[`bill-${b.key}-amount`] = moneyErrorMessage(t, amt)!
        if (!b.date) errs[`bill-${b.key}-date`] = t('issue.invalidDate')
        const twice = b.frequency === 'semimonthly'
        if (twice && secondDayError(b.date, b.secondDay)) errs[`bill-${b.key}-secondDay`] = t('issue.semimonthlyDays')
        if (b.name.trim() && amt.ok && b.date) billInputs.push({ name: b.name.trim(), amountMinor: amt.minor, date: b.date, frequency: b.frequency, ...(twice ? { secondDay: secondDayFrom(b.date, b.secondDay) } : {}) })
      })
    }
    let reserveInput: SetupInput['reserve'] = null
    if (upTo >= 5 && reserve.trim()) {
      const amt = money(reserve, { allowZero: true })
      if (!amt.ok) errs.reserve = moneyErrorMessage(t, amt)!
      else if (amt.minor > 0) reserveInput = { amountMinor: amt.minor, fundedFrom: reserveWhere, name: t('setup.reserve.defaultName') }
    }
    if (Object.keys(errs).length > 0 || (upTo >= 2 && !bal.ok)) return { input: null, errs }
    if (!bal.ok) return { input: null, errs }
    return {
      input: {
        currency,
        timeZone,
        numberLocale,
        language,
        accountName: accountName.trim() || t('setup.balance.defaultAccount'),
        balanceMinor: bal.minor,
        balanceDate,
        income,
        // UX-02: el horizonte en días solo existe con el periodo «hasta mi próximo ingreso»; con un periodo de
        // calendario no se muestra el selector y no se guarda un valor que la persona nunca eligió.
        fallbackHorizonDays: hasIncome === 'no' && periodType === 'untilIncome' ? Number(horizon) : null,
        bills: billInputs,
        reserve: reserveInput,
        categoryIds,
        periodType,
      },
      errs,
    }
  }

  type Preview = { data: AppData; budget: BudgetResult } | { issues: Issue[] }
  const [preview, setPreview] = useState<Preview | null>(null)

  /**
   * Avanza un paso. Con `toSummary` (desde «Pagos próximos») salta el paso opcional del
   * apartado y muestra ya el primer cálculo: lo avanzado se configura después.
   */
  const next = (toSummary = false) => {
    const upTo = toSummary ? 5 : step
    const { input, errs } = buildInput(upTo)
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    if (upTo === 5 && input) {
      const now = new Date().toISOString()
      const r = createInitialData(input, { today, now })
      // Categorías propias creadas en el onboarding: se añaden a los datos iniciales.
      let result: { ok: true; data: AppData } | { ok: false; issues: Issue[] } = r
      for (const own of ownCategories) {
        if (!result.ok) break
        const c = saveCategoryV2(result.data, { id: own.id, name: own.name, kind: own.kind }, { today, now })
        result = c.ok ? { ok: true, data: c.data } : { ok: false, issues: c.issues }
      }
      setPreview(result.ok ? { data: result.data, budget: computeBudget(result.data, today) } : { issues: result.issues })
    }
    setStep((s) => (toSummary ? 6 : s + 1))
    window.scrollTo({ top: 0 })
    requestAnimationFrame(() => document.getElementById('setup-step-title')?.focus())
  }

  const back = () => {
    setErrors({})
    setStep((s) => Math.max(0, s - 1))
    requestAnimationFrame(() => document.getElementById('setup-step-title')?.focus())
  }

  const finish = async () => {
    if (!preview || !('data' in preview) || busy) return
    setBusy(true)
    const ok = await getStore().commit(preview.data)
    setBusy(false)
    if (!ok) setIssues([{ path: '', code: 'notFound' }])
  }

  const startDemo = async () => {
    setBusy(true)
    await getStore().commit(createDemoData({ now: new Date(), timeZone, language }))
    setBusy(false)
  }

  const stepTitle = (key: MessageKey) => (
    <>
      <p className="setup__progress">{t('setup.progress', { step, total: STEPS })}</p>
      <h1 id="setup-step-title" tabIndex={-1}>
        {t(key)}
      </h1>
    </>
  )

  const nav = (nextLabel?: string, skipToSummary = false) => (
    <div className="form__actions">
      <button type="button" className="btn btn--secondary btn--large" onClick={back}>
        <Icon name="back" />
        {t('common.back')}
      </button>
      <button type="submit" className="btn btn--primary btn--large">
        {nextLabel ?? t('common.next')}
        <Icon name="chevronRight" />
      </button>
      {skipToSummary && (
        <button type="button" className="btn btn--ghost btn--large" onClick={() => next(true)}>
          {t('setup.skipToSummary')}
        </button>
      )}
    </div>
  )

  return (
    <main className="setup" id="main">
      <div className="setup__brand">
        <span className="brand__mark" aria-hidden="true">C</span>
        <span className="brand__name">Clara</span>
        <span className="badge badge--neutral">{t('shell.prototype')}</span>
      </div>

      {step === 0 && (
        <Card className="setup__card">
          <Segmented
            legend={t('setup.welcome.language')}
            name="lang"
            value={language}
            onChange={onLanguageChange}
            options={LANGUAGES.map((l) => ({ value: l, label: t(`settings.language.${l}` as MessageKey) }))}
          />
          <h1 id="setup-step-title" tabIndex={-1}>
            {t('setup.welcome.title')}
          </h1>
          <p className="lead">{t('setup.welcome.lead')}</p>
          <ul className="bullets">
            <li>{t('setup.welcome.q1')}</li>
            <li>{t('setup.welcome.q2')}</li>
            <li>{t('setup.welcome.q3')}</li>
            <li>{t('setup.welcome.q4')}</li>
          </ul>
          <Alert tone="info" icon="lock" title={t('setup.welcome.privacyTitle')}>
            {t('setup.welcome.privacyText')}
          </Alert>
          <div className="form__actions form__actions--stack">
            <button type="button" className="btn btn--primary btn--large" onClick={() => setStep(1)}>
              {t('setup.welcome.start')}
            </button>
            <button type="button" className="btn btn--secondary btn--large" onClick={() => void startDemo()} disabled={busy}>
              {t('setup.welcome.demo')}
            </button>
          </div>
          <p className="note">{t('setup.welcome.demoNote')}</p>
          <p className="note">{t('setup.welcome.guestNote')}</p>
          <WelcomeRestore fmt={fmt} timeZone={timeZone} />
        </Card>
      )}

      {step >= 1 && step <= 5 && (
        <Card className="setup__card">
          <form
            className="form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              next()
            }}
          >
            {step === 1 && (
              <>
                {stepTitle('setup.categories.title')}
                <p>{t('setup.categories.lead')}</p>
                {(['expense', 'income'] as const).map((k) => {
                  const ids = k === 'expense' ? EXPENSE_CATEGORY_IDS : INCOME_CATEGORY_IDS
                  const count = ids.filter((id) => categoryIds.includes(id)).length + ownCategories.filter((o) => o.kind === k).length
                  return (
                    <fieldset key={k} className="field">
                      <legend className="field__label">
                        {t(k === 'expense' ? 'setup.categories.expense' : 'setup.categories.income')} · {tn('setup.categories.selected', count)}
                      </legend>
                      {/* Fichas verticales: icono, nombre (sin partir palabras) y marca de elegida arriba a la derecha. */}
                      <div className="cat-tiles">
                        {ids.map((id) => {
                          const meta = systemCategoryMeta(id)!
                          const checked = categoryIds.includes(id)
                          return (
                            <label key={id} className="cat-option">
                              <input type="checkbox" className="cat-option__input" checked={checked} onChange={(e) => setCategoryIds((list) => (e.target.checked ? [...list, id] : list.filter((x) => x !== id)))} />
                              <CategoryIcon icon={meta.icon} color={meta.color} size="lg" />
                              <span className="cat-option__label">{categoryLabel(t, id)}</span>
                              <span className="cat-option__check" aria-hidden="true">
                                <Icon name="check" size={14} />
                              </span>
                            </label>
                          )
                        })}
                        {ownCategories
                          .filter((o) => o.kind === k)
                          .map((o) => (
                            <span key={o.id} className="cat-option cat-option--own">
                              <CategoryIcon icon="tag" size="lg" />
                              <span className="cat-option__label">{o.name}</span>
                              <button type="button" className="btn btn--ghost btn--icon cat-option__remove" onClick={() => setOwnCategories((list) => list.filter((x) => x.id !== o.id))} aria-label={t('setup.categories.ownRemove', { name: o.name })}>
                                <Icon name="x" size={16} />
                              </button>
                            </span>
                          ))}
                      </div>
                    </fieldset>
                  )
                })}
                <div className="field">
                  <TextField label={t('setup.categories.ownName')} value={ownName} maxLength={40} onChange={(e) => setOwnName(e.target.value)} />
                  <Segmented legend={t('categories.kind')} name="ownKind" value={ownKind} onChange={setOwnKind} options={[{ value: 'expense', label: t('categories.kindExpense') }, { value: 'income', label: t('categories.kindIncome') }]} />
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={!ownName.trim()}
                    onClick={() => {
                      const name = ownName.trim()
                      if (!name) return
                      setOwnCategories((list) => [...list, { id: `c_${newId()}`, name, kind: ownKind }])
                      setOwnName('')
                    }}
                  >
                    <Icon name="plus" />
                    {t('setup.categories.addOwn')}
                  </button>
                  {ownCategories.length > 0 && <p className="note">{ownCategories.map((o) => t('setup.categories.ownAdded', { name: o.name })).join(' ')}</p>}
                </div>
                {errors.categories && <Alert tone="critical" title={errors.categories} role="alert" />}
                {nav()}
              </>
            )}

            {step === 2 && (
              <>
                {stepTitle('setup.balance.title')}
                <SelectField label={t('setup.balance.currency')} value={currency} onChange={(e) => setCurrency(e.target.value)} options={SUPPORTED_CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${currencyName(c.code, language)}` }))} hint={t('setup.balance.currencyHint')} />
                <SelectField label={t('setup.period.label')} value={periodType} onChange={(e) => setPeriodType(e.target.value as BudgetPeriodType)} options={BUDGET_PERIOD_TYPES.map((p) => ({ value: p, label: t(`period.type.${p}` as MessageKey) }))} hint={t('setup.period.hint')} />
                {periodType === 'biweek' && <p className="field__hint">{t('period.biweekHint')}</p>}
                <SelectField
                  label={t('settings.format.number')}
                  value={numberLocale}
                  onChange={(e) => setNumberLocale(e.target.value as NumberLocale)}
                  options={NUMBER_LOCALES.map((l) => ({ value: l, label: `${createFormatter({ ...settings, numberLocale: l }).money(123456)} (${t(`settings.format.locale.${l}` as MessageKey)})` }))}
                />
                <TextField label={t('setup.balance.accountName')} value={accountName} maxLength={40} onChange={(e) => setAccountName(e.target.value)} placeholder={t('setup.balance.defaultAccount')} />
                <MoneyField label={t('setup.balance.amount')} hint={t('setup.balance.amountHint')} value={balance} onChange={setBalance} error={errors.balance} fmt={fmt} big autoFocus />
                <TextField label={t('setup.balance.date')} type="date" value={balanceDate} max={today} onChange={(e) => setBalanceDate(e.target.value)} error={errors.balanceDate} hint={t('setup.balance.dateHint')} />
                <p className="note">{t('setup.balance.timeZone', { zone: timeZone })}</p>
                {nav()}
              </>
            )}

            {step === 3 && (
              <>
                {stepTitle('setup.income.title')}
                <Segmented
                  legend={t('setup.income.question')}
                  name="hasIncome"
                  value={hasIncome}
                  onChange={setHasIncome}
                  options={[
                    { value: 'yes', label: t('setup.income.yes') },
                    { value: 'no', label: t('setup.income.no') },
                  ]}
                />
                {hasIncome === 'yes' ? (
                  <>
                    <TextField label={t('fields.name')} value={incomeName} maxLength={60} onChange={(e) => setIncomeName(e.target.value)} placeholder={t('setup.income.defaultName')} />
                    <MoneyField label={t('setup.income.amount')} value={incomeAmount} onChange={setIncomeAmount} error={errors.incomeAmount} fmt={fmt} />
                    <Segmented
                      legend={t('setup.income.variableLegend')}
                      name="variable"
                      value={incomeVariable}
                      onChange={setIncomeVariable}
                      options={[
                        { value: 'fixed', label: t('setup.income.fixed') },
                        { value: 'variable', label: t('setup.income.variable') },
                      ]}
                      hint={t('setup.income.variableHint')}
                    />
                    <TextField label={t('setup.income.date')} type="date" value={incomeDate} min={today} onChange={(e) => setIncomeDate(e.target.value)} error={errors.incomeDate} hint={incomeDate && incomeDate <= today ? t('setup.income.dateToday') : t('setup.income.dateHint')} />
                    <SelectField label={t('fields.frequency')} value={incomeFrequency} onChange={(e) => setIncomeFrequency(e.target.value as Frequency)} options={FREQUENCIES.map((f) => ({ value: f, label: frequencyLabel(t, f) }))} />
                    {incomeFrequency === 'semimonthly' && <SecondDayField startDate={incomeDate} value={incomeSecondDay} onChange={setIncomeSecondDay} error={errors.incomeSecondDay} name="income-second-day" />}
                  </>
                ) : periodType === 'untilIncome' ? (
                  <SelectField
                    label={t('setup.income.horizon')}
                    value={horizon}
                    onChange={(e) => setHorizon(e.target.value)}
                    options={['7', '14', '30'].map((d) => ({ value: d, label: t('horizon.option', { days: d }) }))}
                    hint={t('setup.income.horizonHint')}
                  />
                ) : (
                  // UX-02: con un periodo de calendario el reparto usa los días que quedan del periodo; el
                  // selector de días no aplica y no se muestra.
                  <p className="note" data-testid="setup-period-instead">
                    {t('setup.income.periodInstead', { period: t(`period.type.${periodType}` as MessageKey) })}
                  </p>
                )}
                {nav()}
              </>
            )}

            {step === 4 && (
              <>
                {stepTitle('setup.bills.title')}
                <p>{t('setup.bills.lead')}</p>
                {bills.length === 0 && <p className="note">{t('setup.bills.none')}</p>}
                {bills.map((b, idx) => (
                  <fieldset key={b.key} className="bill-row">
                    <legend>{t('setup.bills.rowLegend', { n: idx + 1 })}</legend>
                    <TextField label={t('fields.name')} value={b.name} maxLength={60} onChange={(e) => setBills((list) => list.map((x) => (x.key === b.key ? { ...x, name: e.target.value } : x)))} error={errors[`bill-${b.key}-name`]} placeholder={t('setup.bills.namePlaceholder')} />
                    <MoneyField label={t('fields.amount')} value={b.amount} onChange={(v) => setBills((list) => list.map((x) => (x.key === b.key ? { ...x, amount: v } : x)))} error={errors[`bill-${b.key}-amount`]} fmt={fmt} />
                    <TextField label={t('setup.bills.date')} type="date" value={b.date} onChange={(e) => setBills((list) => list.map((x) => (x.key === b.key ? { ...x, date: e.target.value } : x)))} error={errors[`bill-${b.key}-date`]} />
                    <SelectField label={t('fields.frequency')} value={b.frequency} onChange={(e) => setBills((list) => list.map((x) => (x.key === b.key ? { ...x, frequency: e.target.value as Frequency } : x)))} options={FREQUENCIES.map((f) => ({ value: f, label: frequencyLabel(t, f) }))} />
                    {b.frequency === 'semimonthly' && (
                      <SecondDayField startDate={b.date} value={b.secondDay} onChange={(v) => setBills((list) => list.map((x) => (x.key === b.key ? { ...x, secondDay: v } : x)))} error={errors[`bill-${b.key}-secondDay`]} name={`bill-${b.key}-second-day`} />
                    )}
                    <button type="button" className="btn btn--danger-ghost btn--small" onClick={() => setBills((list) => list.filter((x) => x.key !== b.key))}>
                      <Icon name="trash" size={16} />
                      {t('setup.bills.remove')}
                    </button>
                  </fieldset>
                ))}
                <button type="button" className="btn btn--secondary" onClick={() => setBills((list) => [...list, { key: ++billKey.current, name: '', amount: '', date: '', frequency: 'monthly', secondDay: '' }])}>
                  <Icon name="plus" />
                  {t('setup.bills.add')}
                </button>
                <p className="note">{t('setup.bills.monthEnd')}</p>
                {nav(undefined, true)}
              </>
            )}

            {step === 5 && (
              <>
                {stepTitle('setup.reserve.title')}
                <p>{t('setup.reserve.lead')}</p>
                <MoneyField label={t('setup.reserve.amount')} value={reserve} onChange={setReserve} error={errors.reserve} fmt={fmt} hint={t('setup.reserve.amountHint')} />
                <Segmented
                  legend={t('setup.reserve.where')}
                  name="reserveWhere"
                  value={reserveWhere}
                  onChange={setReserveWhere}
                  options={[
                    { value: 'budget', label: t('setup.reserve.inBudget') },
                    { value: 'external', label: t('setup.reserve.external') },
                  ]}
                  hint={t(reserveWhere === 'budget' ? 'setup.reserve.inBudgetHint' : 'setup.reserve.externalHint')}
                />
                {nav(t('setup.reserve.review'))}
              </>
            )}
          </form>
        </Card>
      )}

      {step === 6 && (
        <Card className="setup__card">
          {stepTitle('setup.summary.title')}
          {preview && 'budget' in preview ? (
            <>
              <p className="hero__label">{preview.budget.status === 'ok' ? t('home.availableLabel') : t('home.balanceLabel')}</p>
              <p className="hero__value">{fmt.money(preview.budget.status === 'ok' ? preview.budget.availableMinor : preview.budget.spendableMinor)}</p>
              {preview.budget.horizon && (
                <p className="hero__sub">
                  {preview.budget.period
                    ? t('home.period.untilEnd', { label: periodLabel(t, fmt, preview.budget.period), days: tn('home.periodDays', preview.budget.period.daysLeft) })
                    : `${t(preview.budget.horizon.source === 'income' ? 'home.untilIncome' : 'home.untilHorizon', { date: fmt.date(preview.budget.horizon.endDate, { weekday: true }) })} · ${tn('home.periodDays', preview.budget.horizon.days)}`}
                </p>
              )}
              <div className="calc">
                <CalcRow label={t('explain.balance')} value={fmt.money(preview.budget.spendableMinor)} />
                <CalcRow op="−" label={tn('explain.reserved', preview.budget.reservedItems.length)} value={fmt.money(preview.budget.reservedTotalMinor)} />
                <CalcRow op="−" label={t('explain.goals')} value={fmt.money(preview.budget.goalsReservedMinor)} />
                {preview.budget.safetyBufferMinor > 0 && <CalcRow op="−" label={t('explain.buffer')} value={fmt.money(preview.budget.safetyBufferMinor)} />}
                <CalcRow op="=" label={t('explain.available')} value={fmt.money(preview.budget.availableMinor)} strong />
                {preview.budget.dailyMinor !== null && <CalcRow label={t('home.daily')} value={fmt.money(preview.budget.dailyMinor)} />}
              </div>
              {preview.budget.availableMinor + preview.budget.safetyBufferMinor < 0 && <Alert tone="warning" title={t('home.negativeTitle', { amount: fmt.money(-(preview.budget.availableMinor + preview.budget.safetyBufferMinor)) })}>{t('home.negativeText')}</Alert>}
              {preview.budget.overdueIncomes.length > 0 && <Alert tone="warning" title={t('setup.summary.incomePast')} />}
              {(bills.length === 0 || provisionalIncomeNote(preview.budget)) && (
                <Alert tone="info" title={t('setup.summary.provisionalTitle')}>
                  <ul className="bullets">
                    {bills.length === 0 && <li>{t('setup.summary.provisionalBills')}</li>}
                    {provisionalIncomeNote(preview.budget) && <li data-testid="setup-provisional-income">{provisionalIncomeNote(preview.budget)}</li>}
                  </ul>
                </Alert>
              )}
              <p className="note">{t('setup.summary.note')}</p>
            </>
          ) : (
            <Alert tone="critical" title={t('common.fixErrors')}>
              {preview && 'issues' in preview && (
                <ul>
                  {preview.issues.map((i, idx) => (
                    <li key={idx}>{issueMessage(t, fmt, i)}</li>
                  ))}
                </ul>
              )}
            </Alert>
          )}
          {issues.length > 0 && <Alert tone="critical" title={t('save.error.generic')} role="alert" />}
          <div className="form__actions">
            <button type="button" className="btn btn--secondary btn--large" onClick={back}>
              <Icon name="back" />
              {t('common.back')}
            </button>
            <button type="button" className="btn btn--primary btn--large" onClick={() => void finish()} disabled={busy || !preview || !('data' in preview)}>
              <Icon name="check" />
              {t('setup.summary.finish')}
            </button>
          </div>
        </Card>
      )}
    </main>
  )
}
