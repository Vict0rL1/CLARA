/**
 * Planes (§7.5): límites de gasto por categorías y periodo, junto a las metas de ahorro.
 * La pantalla solo muestra y llama a `domain/plans.ts`; nunca calcula dinero.
 */
import { useMemo, useState } from 'react'
import { CategoryIcon } from '../components/CategoryIcon'
import { resolveCategories } from '../../domain/categories'
import { goalPlan, goalProgress } from '../../domain/goals'
import { newId } from '../../domain/ids'
import { updateSettings } from '../../domain/operations'
import { cycleFor, deletePlan, planBaseMinor, planCategoryOptions, planComparison, planDailySeries, planProgress, plansSummary, planTransactions, planUpcoming, repeatPlan, restorePlan, savePlan, setPlanStatus, type PlanProgress, type PlanSeriesPoint } from '../../domain/plans'
import type { BudgetPeriodType, Goal } from '../../domain/types'
import { BUDGET_PERIOD_TYPES, LIMITS, type Issue } from '../../domain/validation'
import { useT, type MessageKey } from '../../i18n'
import { useRun, useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { CategoryPicker } from '../components/CategoryPicker'
import { BottomSheet, ListRow, PrimaryButton, ProgressBar, SecondaryButton, TextButton, Toggle, type ProgressState } from '../components/base'
import { Alert, Badge, Card, EmptyState, PageHeader, Why } from '../components/common'
import { ConfirmDialog } from '../components/Dialog'
import { MoneyField, Segmented, SelectField, TextField } from '../components/fields'
import { Icon } from '../components/Icon'
import { useToast } from '../components/toastContext'
import { useFormat, type Formatter } from '../format'
import { categoryLabel, fieldError, issueMessage, otherIssues, planItemName, planTitle, transactionTitle } from '../labels'
import { parseMoneyText, moneyErrorMessage } from '../moneyText'
import { href, useNavigateIfStillHere, withQuery, type Route } from '../router'

const PLAN_PERIODS = BUDGET_PERIOD_TYPES.filter((p) => p !== 'untilIncome')
const TOUR_ID = 'plans'

function stateFor(p: PlanProgress): ProgressState {
  if (p.state === 'completed') return 'complete'
  if (p.state === 'over') return 'exceeded'
  if (p.state === 'near') return 'warning'
  return 'ok'
}

function cycleText(fmt: Formatter, p: PlanProgress, today: string): string {
  if (!p.cycle) return ''
  return `${fmt.date(p.cycle.start, { compact: true, today })} – ${fmt.date(p.cycle.end, { compact: true, today })}`
}

/* ------------------------------------------------------------------ */
/* Lista                                                               */
/* ------------------------------------------------------------------ */

export function Plans({ route }: { route: Route }) {
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const view = route.query.get('vista') === 'completados' ? 'completed' : 'active'
  const [sheet, setSheet] = useState(false)
  const categories = useMemo(() => new Map(resolveCategories(data).map((c) => [c.id, c])), [data])
  const summary = useMemo(() => plansSummary(data, today), [data, today])
  const plans = useMemo(
    () =>
      data.plans
        .filter((p) => (view === 'completed' ? p.status === 'completed' : p.status !== 'completed'))
        .map((p) => ({ plan: p, progress: planProgress(data, p, today) }))
        .sort((a, b) => (view === 'completed' ? (b.plan.result?.closedAt ?? '').localeCompare(a.plan.result?.closedAt ?? '') : b.progress.fraction - a.progress.fraction)),
    [data, today, view],
  )
  const goals = useMemo(() => data.goals.filter((g) => g.kind !== 'expense').filter((g) => (goalProgress(g).complete ? view === 'completed' : view === 'active')), [data, view])
  const tourSeen = (data.settings.toursSeen ?? []).includes(TOUR_ID)
  const endTour = () => void run((d, c) => updateSettings(d, { toursSeen: [...(d.settings.toursSeen ?? []).filter((x) => x !== TOUR_ID), TOUR_ID] }, c))

  const news: string[] = []
  if (summary.exceeded > 0) news.push(tn('plans.summary.exceeded', summary.exceeded))
  if (summary.near > 0) news.push(tn('plans.summary.near', summary.near))
  if (summary.goalsPercent !== null && summary.goals > 0) news.push(t('plans.summary.goals', { pct: summary.goalsPercent, done: summary.goalsComplete, total: summary.goals }))

  // Introducción de 3 pantallas la primera vez que se abre Planes (no en la demo); una reserva
  // creada en la configuración inicial ya no la esconde (B5).
  if (!tourSeen && !data.isDemo) return <PlansOnboarding onDone={endTour} />

  return (
    <div className="stack plans">
      {news.length > 0 && (
        <Alert tone={summary.exceeded > 0 ? 'warning' : 'info'} icon={summary.exceeded > 0 ? 'alert' : 'info'} title={t('plans.summary.title')} role="status">
          <ul className="bullets" data-testid="plans-summary">
            {news.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Alert>
      )}
      <div className="plans__toolbar">
        <Segmented
          legend={t('plans.view')}
          name="plans-view"
          value={view}
          onChange={(v) => {
            window.location.hash = href(withQuery('/plan/planes', v === 'completed' ? { vista: 'completados' } : {}))
          }}
          options={[
            { value: 'active', label: t('plans.view.active') },
            { value: 'completed', label: t('plans.view.completed') },
          ]}
        />
        {/* Botón en la página, no flotante: nunca tapa una tarjeta (B2/B3). */}
        <button type="button" className="btn btn--primary" onClick={() => setSheet(true)}>
          <Icon name="plus" size={18} />
          {t('plans.new')}
        </button>
      </div>
      {plans.length === 0 && goals.length === 0 ? (
        <EmptyState icon="target" title={t(view === 'completed' ? 'plans.empty.completed' : 'plans.empty.title')} text={view === 'active' ? t('plans.empty.text') : undefined} action={view === 'active' ? <PrimaryButton onClick={() => setSheet(true)}>{t('plans.empty.cta')}</PrimaryButton> : undefined} />
      ) : (
        <ul className="plan-cards" data-testid="plan-list">
          {plans.map(({ plan, progress }) => {
            const title = planTitle(t, plan)
            const first = plan.categoryIds[0] ? categories.get(plan.categoryIds[0]) : undefined
            const stateText =
              progress.state === 'completed' && plan.result
                ? plan.result.achieved
                    ? t('plans.result.withinShort', { amount: fmt.money(plan.result.deltaMinor) })
                    : t('plans.exceededBy', { amount: fmt.money(-plan.result.deltaMinor) })
                : progress.state === 'paused'
                  ? t('plans.paused')
                  : progress.state === 'over'
                    ? t('plans.exceededBy', { amount: fmt.money(-progress.remainingMinor) })
                    : t('plans.left', { amount: fmt.money(progress.remainingMinor) })
            return (
              <li key={plan.id}>
                <a className="plan-card card" href={href(`/plan/planes/${plan.id}`)} data-testid={`plan-${plan.id}`}>
                  <div className="plan-card__head">
                    <CategoryIcon icon={plan.categoryIds.length === 1 && first ? first.icon : 'wallet'} color={first?.color ?? 'blue'} />
                    <span className="plan-card__title">
                      <strong>{title}</strong>
                      <span className="item__meta">
                        {t('plans.kind.limit')} · {t(`period.type.${plan.periodType}` as MessageKey)}
                        {progress.cycle ? ` · ${cycleText(fmt, progress, today)}` : ''}
                      </span>
                    </span>
                    {plan.recurring && <Badge icon="repeat">{t('plans.recurringShort')}</Badge>}
                  </div>
                  <ProgressBar fraction={Math.min(1, progress.fraction)} state={stateFor(progress)} label={title} valueText={`${fmt.money(progress.spentMinor)} / ${fmt.money(progress.limitMinor)} · ${progress.percent} %`} stateText={stateText} />
                </a>
              </li>
            )
          })}
          {goals.map((g) => (
            <li key={g.id}>
              <GoalCard goal={g} />
            </li>
          ))}
        </ul>
      )}
      <Why short={t('plans.noteShort')}>{t('plans.note')}</Why>
      <BottomSheet open={sheet} onClose={() => setSheet(false)} title={t('plans.create.title')}>
        <div className="stack-sm" data-testid="plan-create-sheet">
          <a className="list-row list-row--link" href={href('/plan/planes/nuevo')} onClick={() => setSheet(false)}>
            <CategoryIcon icon="wallet" color="amber" className="list-row__icon" />
            <span className="list-row__main">
              <span className="list-row__title">{t('plans.create.limit')}</span>
              <span className="list-row__subtitle">{t('plans.create.limitText')}</span>
            </span>
            <Icon name="chevronRight" size={18} />
          </a>
          <a className="list-row list-row--link" href={href('/plan/metas/nueva?returnTo=/plan/planes')} onClick={() => setSheet(false)}>
            <CategoryIcon icon="target" color="emerald" className="list-row__icon" />
            <span className="list-row__main">
              <span className="list-row__title">{t('plans.create.goal')}</span>
              <span className="list-row__subtitle">{t('plans.create.goalText')}</span>
            </span>
            <Icon name="chevronRight" size={18} />
          </a>
        </div>
      </BottomSheet>
    </div>
  )
}

function GoalCard({ goal }: { goal: Goal }) {
  const { t, tn } = useT()
  const fmt = useFormat()
  const today = useToday()
  const p = goalProgress(goal)
  const plan = goalPlan(goal, today)
  const daysLeft = goal.targetDate && goal.targetDate >= today ? Math.max(0, Math.round((Date.parse(goal.targetDate) - Date.parse(today)) / 86_400_000)) : null
  const daily = daysLeft !== null && daysLeft > 0 && !p.complete ? Math.ceil(p.remainingMinor / daysLeft) : null
  const stateText = p.complete ? t('plans.goal.done') : daily !== null ? `${t('plans.goal.daily', { amount: fmt.money(daily) })} · ${tn('plans.goal.daysLeft', daysLeft ?? 0)}` : t('plans.goal.toGo', { amount: fmt.money(p.remainingMinor) })
  return (
    <a className="plan-card card" href={href(`/plan/metas/editar/${goal.id}?returnTo=/plan/planes`)} data-testid={`goal-card-${goal.id}`}>
      <div className="plan-card__head">
        <CategoryIcon icon={goal.icon ?? 'target'} color={goal.color ?? 'emerald'} />
        <span className="plan-card__title">
          <strong>{goal.name}</strong>
          <span className="item__meta">
            {t('plans.kind.goal')}
            {goal.targetDate ? ` · ${t('goals.byDate', { date: fmt.date(goal.targetDate, { compact: true, today }) })}` : ''}
            {plan.status === 'ok' && plan.perMonthMinor !== null ? ` · ${t('goals.perMonth', { amount: fmt.money(plan.perMonthMinor) })}` : ''}
          </span>
        </span>
        {goal.contribution && <Badge icon="repeat">{t(`plans.contribution.${goal.contribution.frequency}` as MessageKey, { amount: fmt.money(goal.contribution.amountMinor) })}</Badge>}
      </div>
      <ProgressBar fraction={Math.min(1, p.fraction)} state={p.complete ? 'complete' : 'ok'} label={goal.name} valueText={`${fmt.money(p.savedMinor)} / ${fmt.money(p.targetMinor)} · ${Math.floor(p.fraction * 100)} %`} stateText={stateText} />
    </a>
  )
}

/* ------------------------------------------------------------------ */
/* Onboarding de planes (3 pantallas)                                  */
/* ------------------------------------------------------------------ */

function PlansOnboarding({ onDone }: { onDone: () => void }) {
  const { t } = useT()
  const [step, setStep] = useState(0)
  const steps = [
    { icon: 'wallet' as const, title: t('plans.onboarding.1.title'), text: t('plans.onboarding.1.text') },
    { icon: 'chart' as const, title: t('plans.onboarding.2.title'), text: t('plans.onboarding.2.text') },
    { icon: 'bell' as const, title: t('plans.onboarding.3.title'), text: t('plans.onboarding.3.text') },
  ]
  const current = steps[step]!
  return (
    <div className="stack plans-onboarding" data-testid="plans-onboarding">
      <Card as="section" className="plans-onboarding__card" labelledBy="plans-onb-title">
        <span className="plans-onboarding__icon" aria-hidden="true">
          <Icon name={current.icon} size={32} />
        </span>
        <h2 id="plans-onb-title" className="card__title">
          {current.title}
        </h2>
        <p>{current.text}</p>
        <ol className="dots" aria-label={t('plans.onboarding.progress', { step: step + 1, total: steps.length })}>
          {steps.map((s, i) => (
            <li key={s.title} className={`dots__dot${i === step ? ' is-active' : ''}`} aria-current={i === step ? 'step' : undefined} />
          ))}
        </ol>
        <div className="button-row">
          {step < steps.length - 1 ? (
            <>
              <PrimaryButton onClick={() => setStep(step + 1)}>{t('common.next')}</PrimaryButton>
              <TextButton onClick={onDone}>{t('tour.skip')}</TextButton>
            </>
          ) : (
            <PrimaryButton onClick={onDone}>{t('plans.onboarding.start')}</PrimaryButton>
          )}
        </div>
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Formulario de límite                                                */
/* ------------------------------------------------------------------ */

export function PlanForm({ route }: { route: Route }) {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const leave = useNavigateIfStillHere()
  const editId = route.segments[1] === 'planes' && route.segments[2] === 'editar' ? route.segments[3] : undefined
  const existing = editId ? data.plans.find((p) => p.id === editId) : undefined
  const returnTo = existing ? `/plan/planes/${existing.id}` : '/plan/planes'
  const [id] = useState(() => existing?.id ?? newId())
  const [name, setName] = useState(existing?.name ?? '')
  const [amountText, setAmountText] = useState(existing ? fmt.moneyInput(existing.amountMinor) : '')
  const [categoryIds, setCategoryIds] = useState<string[]>(existing?.categoryIds ?? [])
  const defaultPeriod: BudgetPeriodType = data.settings.budgetPeriod.type === 'untilIncome' ? 'month' : data.settings.budgetPeriod.type
  const [periodType, setPeriodType] = useState<BudgetPeriodType>(existing?.periodType ?? defaultPeriod)
  const [startDate, setStartDate] = useState(existing?.periodType === 'custom' ? (existing.startDate ?? '') : '')
  const [endDate, setEndDate] = useState(existing?.periodType === 'custom' ? (existing.endDate ?? '') : '')
  const [recurring, setRecurring] = useState(existing?.recurring ?? true)
  const [rollover, setRollover] = useState(existing?.rollover === 'carry')
  const [alertAt80, setAlert80] = useState(existing?.alertAt80 ?? true)
  const [alertAt100, setAlert100] = useState(existing?.alertAt100 ?? true)
  const [issues, setIssues] = useState<Issue[]>([])
  const [amountError, setAmountError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Categorías libres para este límite (las de otros límites activos no se ofrecen).
  const allowedCategories = useMemo(() => planCategoryOptions(data, existing?.categoryIds ?? []), [data, existing])
  const preview = periodType === 'custom' ? (startDate && endDate && endDate >= startDate ? { start: startDate, end: endDate } : null) : cycleFor(periodType, data.settings, today)

  if (editId && !existing) {
    return (
      <div className="stack">
        <PageHeader title={t('plans.notFound')} back={{ href: href('/plan/planes'), label: t('plan.plans') }} />
      </div>
    )
  }

  const submit = async () => {
    const parsed = parseMoneyText(amountText, fmt)
    setAmountError(moneyErrorMessage(t, parsed))
    if (!parsed.ok || busy) return
    setBusy(true)
    const { result, saved } = await run((d, c) =>
      savePlan(d, { id, name, categoryIds, amountMinor: parsed.minor, periodType, ...(periodType === 'custom' ? { startDate: startDate || undefined, endDate: endDate || undefined } : {}), recurring, rollover: periodType !== 'custom' && recurring && rollover ? 'carry' : 'none', alertAt80, alertAt100 }, c),
    )
    setBusy(false)
    if (!result.ok) {
      setIssues(result.issues)
      return
    }
    toast({ message: saved ? t('plans.saved') : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
    leave(`/plan/planes/${result.value.id}`)
  }

  const unknown = otherIssues(issues, ['name', 'amountMinor', 'categoryIds', 'startDate', 'endDate', 'periodType'])
  return (
    <div className="stack">
      <PageHeader title={existing ? t('plans.form.editTitle') : t('plans.form.newTitle')} back={{ href: href(returnTo), label: t('common.back') }} />
      <form
        className="form card"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <MoneyField big label={t('plans.form.amount')} hint={t('plans.form.amountHint')} value={amountText} onChange={setAmountText} error={amountError ?? fieldError(t, fmt, issues, 'amountMinor')} fmt={fmt} />
        <TextField label={t('plans.form.name')} hint={t('plans.form.nameHint')} value={name} maxLength={LIMITS.nameMax} onChange={(e) => setName(e.target.value)} error={fieldError(t, fmt, issues, 'name')} />
        <CategoryPicker
          multiple
          label={t('plans.form.categories')}
          kind="expense"
          data={data}
          value={categoryIds}
          onChange={setCategoryIds}
          only={allowedCategories}
          placeholder={t('plans.form.categoriesAll')}
          hint={categoryIds.length === 0 ? t('plans.form.categoriesAll') : t('plans.form.categoriesHint', { count: categoryIds.length })}
          error={fieldError(t, fmt, issues, 'categoryIds')}
          testId="plan-categories"
        />
        <SelectField
          label={t('plans.form.period')}
          value={periodType}
          onChange={(e) => setPeriodType(e.target.value as BudgetPeriodType)}
          options={PLAN_PERIODS.map((p) => ({ value: p, label: t(`period.type.${p}` as MessageKey) }))}
          hint={preview ? t('plans.form.periodPreview', { from: fmt.date(preview.start, { compact: true, today }), to: fmt.date(preview.end, { compact: true, today }) }) : undefined}
          error={fieldError(t, fmt, issues, 'periodType')}
        />
        {periodType === 'custom' && (
          <div className="form__row">
            <TextField label={t('settings.period.customStart')} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} error={fieldError(t, fmt, issues, 'startDate')} required />
            <TextField label={t('settings.period.customEnd')} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} error={fieldError(t, fmt, issues, 'endDate')} required />
          </div>
        )}
        {periodType !== 'custom' && <Toggle checked={recurring} onChange={setRecurring} label={t('plans.form.recurring')} hint={t('plans.form.recurringHint')} />}
        {periodType !== 'custom' && recurring && <Toggle checked={rollover} onChange={setRollover} label={t('plans.rollover.label')} hint={t('plans.rollover.hint')} />}
        <Toggle checked={alertAt80} onChange={setAlert80} label={t('plans.form.alert80')} />
        <Toggle checked={alertAt100} onChange={setAlert100} label={t('plans.form.alert100')} hint={!data.settings.notifications.planAlerts ? t('plans.form.alertsOff') : undefined} />
        {unknown.length > 0 && (
          <Alert tone="critical" title={t('common.fixErrors')} role="alert">
            <ul>
              {unknown.map((i, idx) => (
                <li key={idx}>{issueMessage(t, fmt, i)}</li>
              ))}
            </ul>
          </Alert>
        )}
        <div className="form__actions">
          <button type="submit" className="btn btn--primary btn--large" disabled={busy}>
            <Icon name="check" />
            {busy ? t('common.saving') : t('common.save')}
          </button>
          <a className="btn btn--secondary btn--large" href={href(returnTo)}>
            {t('common.cancel')}
          </a>
        </div>
      </form>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Detalle                                                             */
/* ------------------------------------------------------------------ */

export function PlanDetail({ route }: { route: Route }) {
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const leave = useNavigateIfStillHere()
  const plan = data.plans.find((p) => p.id === route.segments[2])
  const [confirmDelete, setConfirmDelete] = useState(false)
  const progress = useMemo(() => (plan ? planProgress(data, plan, today) : null), [data, plan, today])
  const txs = useMemo(() => (plan && progress?.cycle ? planTransactions(data, plan, progress.cycle) : []), [data, plan, progress])
  const series = useMemo(() => (plan && progress?.cycle ? planDailySeries(data, plan, progress.cycle, today) : []), [data, plan, progress, today])
  // Etapa 3: compromisos programados del ciclo (no son gasto) y comparación con el ciclo anterior en el mismo punto.
  const upcoming = useMemo(() => (plan && progress?.cycle && plan.status === 'active' ? planUpcoming(data, plan, progress.cycle, today) : null), [data, plan, progress, today])
  const comparison = useMemo(() => (plan && progress?.cycle && plan.status === 'active' ? planComparison(data, plan, today) : null), [data, plan, progress, today])

  if (!plan || !progress) {
    return (
      <div className="stack">
        <PageHeader title={t('plans.notFound')} back={{ href: href('/plan/planes'), label: t('plan.plans') }} />
      </div>
    )
  }
  const title = planTitle(t, plan)

  const togglePause = async () => {
    const next = plan.status === 'paused' ? 'active' : 'paused'
    const { result, saved } = await run((d, c) => setPlanStatus(d, plan.id, next, c))
    if (!result.ok) return
    toast({ message: saved ? t(next === 'paused' ? 'plans.pausedToast' : 'plans.resumedToast') : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
  }
  const remove = async () => {
    setConfirmDelete(false)
    const { result, saved } = await run((d, c) => deletePlan(d, plan.id, c))
    if (!result.ok) return
    const removed = result.value
    toast({ message: saved ? t('plans.deleted') : t('save.error.generic'), tone: saved ? 'good' : 'critical', action: { label: t('common.undo'), onClick: () => void run((d, c) => restorePlan(d, removed, c)) } })
    leave('/plan/planes')
  }
  const repeat = async () => {
    const { result, saved } = await run((d, c) => repeatPlan(d, plan.id, c))
    if (!result.ok) return
    toast({ message: saved ? t('plans.repeated') : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
    leave(`/plan/planes/${result.value.id}`)
  }

  return (
    <div className="stack plan-detail">
      <PageHeader title={title} back={{ href: href(withQuery('/plan/planes', plan.status === 'completed' ? { vista: 'completados' } : {})), label: t('plan.plans') }} />
      <Card labelledBy="plan-progress-title">
        <p className="item__badges">
          <Badge icon="wallet">{t(`period.type.${plan.periodType}` as MessageKey)}</Badge>
          {plan.recurring && <Badge icon="repeat">{t('plans.recurringShort')}</Badge>}
          {plan.status === 'paused' && <Badge tone="warning" icon="clock">{t('plans.paused')}</Badge>}
          {plan.status === 'completed' && <Badge tone="neutral" icon="check">{t('plans.view.completed')}</Badge>}
        </p>
        <h2 id="plan-progress-title" className="card__title">
          {progress.cycle ? cycleText(fmt, progress, today) : t('plans.noCycle')}
        </h2>
        <p className="stat__value" data-testid="plan-spent">
          {fmt.money(progress.spentMinor)} <span className="muted">/ {fmt.money(progress.limitMinor)}</span>
        </p>
        {plan.carriedMinor !== undefined && plan.carriedMinor !== 0 && (
          <p className="item__meta" data-testid="plan-limit-breakdown">
            {t('plans.limitBreakdown', { base: fmt.money(planBaseMinor(plan)), carried: fmt.money(plan.carriedMinor, { sign: true }), limit: fmt.money(plan.amountMinor) })}
          </p>
        )}
        <ProgressBar
          fraction={Math.min(1, progress.fraction)}
          state={stateFor(progress)}
          label={title}
          valueText={`${progress.percent} %`}
          stateText={progress.state === 'over' ? t('plans.exceededBy', { amount: fmt.money(-progress.remainingMinor) }) : progress.state === 'completed' ? t('plans.view.completed') : t('plans.left', { amount: fmt.money(progress.remainingMinor) })}
        />
        {plan.status === 'active' && progress.cycle && (
          <p className="item__meta" data-testid="plan-pace">
            {tn('plans.daysLeft', progress.daysLeft)} · {t('plans.idealPace', { amount: fmt.money(progress.idealToDateMinor) })}
          </p>
        )}
        <p className="item__meta">{plan.categoryIds.length === 0 ? t('plans.allCategories') : plan.categoryIds.map((cid) => categoryLabel(t, cid)).join(', ')}</p>
        {plan.status === 'active' && progress.cycle && (
          <p className="item__meta" data-testid="plan-compare">
            {comparison
              ? `${t('plans.compare', { date: fmt.date(comparison.equivalentDate, { compact: true, today }), previous: fmt.money(comparison.previousToDateMinor), current: fmt.money(comparison.currentToDateMinor), delta: fmt.money(comparison.deltaMinor, { sign: true }) })} ${t('plans.compareTotal', { total: fmt.money(comparison.previousTotalMinor) })}`
              : t('plans.compareNone')}
          </p>
        )}
        <p className="note">{t('plans.allocationNote')}</p>
      </Card>

      {upcoming && (
        <Card labelledBy="plan-upcoming-title">
          <h2 id="plan-upcoming-title" className="section-title">
            {t('plans.upcomingTitle')}
          </h2>
          {upcoming.items.length === 0 ? (
            <p className="note">{t('plans.upcomingNone')}</p>
          ) : (
            <>
              <ul className="item-list" data-testid="plan-upcoming">
                {upcoming.items.map((i) => (
                  <li key={i.key}>
                    <ListRow title={planItemName(i, t)} subtitle={`${fmt.date(i.date, { compact: true, today })} · ${t(i.state === 'overdue' ? 'state.overdue' : 'state.pending')}`} value={fmt.money(i.amountMinor)} />
                  </li>
                ))}
              </ul>
              <p className="item__meta" data-testid="plan-upcoming-total">
                {t('plans.upcomingTotal', { total: fmt.money(upcoming.totalMinor), remaining: fmt.money(upcoming.remainingAfterMinor) })}
              </p>
            </>
          )}
        </Card>
      )}

      {plan.status === 'completed' && plan.result && (
        <Alert tone={plan.result.achieved ? 'good' : 'warning'} icon={plan.result.achieved ? 'checkCircle' : 'alert'} title={plan.result.achieved ? t('plans.result.within') : t('plans.result.exceeded')} actions={<SecondaryButton onClick={() => void repeat()}>{t('plans.repeat')}</SecondaryButton>}>
          <span data-testid="plan-result">{plan.result.achieved ? t('plans.result.withinText', { amount: fmt.money(plan.result.deltaMinor) }) : t('plans.result.exceededText', { amount: fmt.money(-plan.result.deltaMinor) })}</span>
        </Alert>
      )}

      {series.length > 0 && <PaceChart series={series} limitMinor={plan.amountMinor} fmt={fmt} today={today} />}

      <section className="stack-sm" aria-labelledby="plan-tx-title">
        <h2 id="plan-tx-title" className="section-title">
          {t('plans.transactions')} ({txs.length})
        </h2>
        {txs.length === 0 ? (
          <p className="note">{t('plans.transactionsEmpty')}</p>
        ) : (
          <ul className="item-list" data-testid="plan-transactions">
            {txs.slice(0, 50).map((tx) => (
              <li key={tx.id}>
                <ListRow
                  title={transactionTitle(tx, data.accounts, t)}
                  subtitle={`${fmt.date(tx.date, { compact: true, today })} · ${categoryLabel(t, tx.categoryId)}`}
                  value={fmt.money(tx.kind === 'refund' ? tx.amountMinor : -tx.amountMinor, { sign: true })}
                  valueTone={tx.kind === 'refund' ? 'income' : 'expense'}
                  href={href(withQuery(`/movimientos/editar/${tx.id}`, { returnTo: `/plan/planes/${plan.id}` }))}
                  chevron
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="button-row">
        {plan.status !== 'completed' && (
          <a className="btn btn--secondary" href={href(`/plan/planes/editar/${plan.id}`)}>
            <Icon name="edit" size={16} />
            {t('common.edit')}
          </a>
        )}
        {plan.status !== 'completed' && (
          <SecondaryButton onClick={() => void togglePause()}>
            <Icon name={plan.status === 'paused' ? 'skip' : 'clock'} size={16} />
            {plan.status === 'paused' ? t('plans.resume') : t('plans.pause')}
          </SecondaryButton>
        )}
        <button type="button" className="btn btn--danger-ghost" onClick={() => setConfirmDelete(true)}>
          <Icon name="trash" size={16} />
          {t('common.delete')}
        </button>
      </div>
      <Why short={t('plans.noteShort')}>{t('plans.note')}</Why>
      <ConfirmDialog open={confirmDelete} title={t('plans.deleteTitle', { name: title })} confirmLabel={t('common.delete')} onConfirm={() => void remove()} onCancel={() => setConfirmDelete(false)} destructive>
        {t('plans.deleteText')}
      </ConfirmDialog>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Gráfico: acumulado real vs. ritmo ideal                              */
/* ------------------------------------------------------------------ */

function PaceChart({ series, limitMinor, fmt, today }: { series: PlanSeriesPoint[]; limitMinor: number; fmt: Formatter; today: string }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const W = 320
  const H = 140
  const pad = { l: 8, r: 8, t: 10, b: 18 }
  const max = Math.max(limitMinor, ...series.map((p) => p.cumulativeMinor ?? 0)) || 1
  const x = (i: number) => pad.l + (series.length === 1 ? 0 : (i * (W - pad.l - pad.r)) / (series.length - 1))
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max)
  const ideal = series.map((p, i) => `${x(i).toFixed(1)},${y(p.idealMinor).toFixed(1)}`).join(' ')
  const real = series.filter((p) => p.cumulativeMinor !== null).map((p, i) => `${x(i).toFixed(1)},${y(p.cumulativeMinor!).toFixed(1)}`).join(' ')
  const limitY = y(limitMinor)
  const last = [...series].reverse().find((p) => p.cumulativeMinor !== null)
  return (
    <Card labelledBy="plan-chart-title">
      <h2 id="plan-chart-title" className="section-title">
        {t('plans.chart.title')}
      </h2>
      <svg className="pace-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('plans.chart.aria', { real: fmt.money(last?.cumulativeMinor ?? 0), ideal: fmt.money(last?.idealMinor ?? 0) })}>
        <line x1={pad.l} x2={W - pad.r} y1={limitY} y2={limitY} className="pace-chart__limit" />
        <polyline points={ideal} className="pace-chart__ideal" fill="none" />
        {real && <polyline points={real} className="pace-chart__real" fill="none" />}
      </svg>
      <ul className="legend" aria-hidden="true">
        <li>
          <span className="legend__swatch legend__swatch--real" /> {t('plans.chart.real')}
        </li>
        <li>
          <span className="legend__swatch legend__swatch--ideal" /> {t('plans.chart.ideal')}
        </li>
        <li>
          <span className="legend__swatch legend__swatch--limit" /> {t('plans.chart.limit')}
        </li>
      </ul>
      <button type="button" className="btn btn--ghost btn--small" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? t('plans.chart.hideTable') : t('plans.chart.showTable')}
      </button>
      {open && (
        <table className="data-table">
          <caption className="sr-only">{t('plans.chart.title')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('fields.date')}</th>
              <th scope="col">{t('plans.chart.real')}</th>
              <th scope="col">{t('plans.chart.ideal')}</th>
            </tr>
          </thead>
          <tbody>
            {series
              .filter((p) => p.cumulativeMinor !== null)
              .map((p) => (
                <tr key={p.date}>
                  <td>{fmt.date(p.date, { compact: true, today })}</td>
                  <td>{fmt.money(p.cumulativeMinor ?? 0)}</td>
                  <td>{fmt.money(p.idealMinor)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}
