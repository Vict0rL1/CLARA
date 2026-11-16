/**
 * Presupuestos por periodo (semestre, viaje o personalizado). Los cálculos viven en
 * `domain/periodBudgets.ts`; aquí solo se muestran y se llaman operaciones.
 *
 * Los textos van en el paquete diferido `periods` (fuera del JS inicial): cada pantalla tiene su cabecera fuera
 * (diccionario principal) y el cuerpo dentro de `PackBody`, que lee el traductor con `usePackT()`.
 */
import { useMemo, useState } from 'react'
import { computeBudget } from '../../domain/budget'
import { categoriesForKind } from '../../domain/categories'
import { newId } from '../../domain/ids'
import {
  consolidatedSpent,
  deletePeriodBudget,
  periodCandidates,
  periodSuggestions,
  reserveForPeriod,
  restorePeriodBudget,
  savePeriodBudget,
  setPeriodBudgetArchived,
  setPeriodTransaction,
  setPeriodTransactionsBulk,
  summarizePeriod,
  templateDates,
  type PeriodStatus,
} from '../../domain/periodBudgets'
import { goalReserveLines } from '../../domain/reserves'
import type { PeriodBudget, PeriodTemplate } from '../../domain/types'
import { LIMITS, type Issue } from '../../domain/validation'
import { useT } from '../../i18n'
import { useRun, useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { Alert, Badge, CalcRow, Card, EmptyState, Explain, Meter, PageHeader, Why, type Tone } from '../components/common'
import { Dialog } from '../components/Dialog'
import { CheckboxField, MoneyField, Segmented, TextField } from '../components/fields'
import { Icon, type IconName } from '../components/Icon'
import { PackBody } from '../components/PackBody'
import { usePackT } from '../components/packTexts'
import { useToast } from '../components/toastContext'
import { tripDraftFrom, tripFromDraft, type TripDraft } from '../tripDraft'
import { TripCard, TripFields } from '../tripUi'
import { useFormat } from '../format'
import { categoryLabel, fieldError, issueMessage, otherIssues, transactionTitle } from '../labels'
import { moneyErrorMessage, parseMoneyText } from '../moneyText'
import { href, type Route, useNavigateIfStillHere } from '../router'
import { CategoryPicker } from '../components/CategoryPicker'

const STATUS: Record<PeriodStatus, { tone: Tone; icon: IconName }> = {
  upcoming: { tone: 'info', icon: 'clock' },
  active: { tone: 'good', icon: 'checkCircle' },
  ended: { tone: 'neutral', icon: 'check' },
}

const TEMPLATES: PeriodTemplate[] = ['semester', 'trip', 'custom']

function StatusBadge({ budget, status }: { budget: PeriodBudget; status: PeriodStatus }) {
  const { t } = usePackT()
  if (budget.archived) return <Badge icon="lock">{t('period.archived')}</Badge>
  return (
    <Badge tone={STATUS[status].tone} icon={STATUS[status].icon}>
      {t(`period.status.${status}`)}
    </Badge>
  )
}

/** Pestaña «Periodos» del Plan (la cabecera es la del Plan). */
export function PeriodBudgets() {
  return (
    <PackBody name="periods">
      <PeriodList />
    </PackBody>
  )
}

function PeriodList() {
  const { t, tn } = usePackT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const active = data.periodBudgets.filter((b) => !b.archived)
  const archived = data.periodBudgets.filter((b) => b.archived)
  const consolidated = useMemo(() => consolidatedSpent(data, active), [data, active])

  const row = (b: PeriodBudget) => {
    const s = summarizePeriod(data, b, today)
    const fraction = b.allocatedMinor > 0 ? s.spentMinor / b.allocatedMinor : 0
    return (
      <li key={b.id}>
        <a className="item item--link item--stacked" href={href(`/plan/periodos/${b.id}`)}>
          <span className="item__main">
            <span className="item__title">{b.name}</span>
            <span className="item__meta">
              {fmt.date(b.startDate, { compact: true, today })} – {fmt.date(b.endDate, { compact: true, today })} · {t(`period.template.${b.template}`)}
            </span>
            <span className="item__badges">
              <StatusBadge budget={b} status={s.status} />
              {s.remainingMinor < 0 && (
                <Badge tone="critical" icon="alert">
                  {t('period.over')}
                </Badge>
              )}
            </span>
            <Meter fraction={fraction} label={b.name} valueText={t('period.spentOf', { spent: fmt.money(s.spentMinor), allocated: fmt.money(b.allocatedMinor) })} />
            <span className="item__meta">{t('period.spentOf', { spent: fmt.money(s.spentMinor), allocated: fmt.money(b.allocatedMinor) })}</span>
          </span>
        </a>
      </li>
    )
  }

  return (
    <div className="stack">
      <div className="button-row">
        <a className="btn btn--primary" href={href('/plan/periodos/nuevo')}>
          <Icon name="plus" />
          {t('period.new')}
        </a>
      </div>
      <Alert tone="info" icon="info" title={t('period.notMoneyTitle')}>
        <Why short={t('period.notMoneyShort')}>{t('period.notMoneyText')}</Why>
      </Alert>
      {active.length === 0 && archived.length === 0 ? (
        <EmptyState icon="wallet" title={t('period.empty')} text={t('period.emptyText')} action={<a className="btn btn--primary" href={href('/plan/periodos/nuevo')}>{t('period.new')}</a>} />
      ) : (
        <>
          {active.length > 1 && (
            <Card>
              <p className="stat__label">{t('period.consolidated')}</p>
              <p className="stat__value" data-testid="period-consolidated">
                {fmt.money(consolidated.spentMinor)}
              </p>
              <p className="note">{consolidated.sharedCount > 0 ? tn('period.consolidatedShared', consolidated.sharedCount) : t('period.consolidatedHint')}</p>
            </Card>
          )}
          {active.length > 0 && <ul className="item-list">{active.map(row)}</ul>}
          {archived.length > 0 && (
            <details className="explain">
              <summary>
                <Icon name="lock" size={16} />
                {tn('period.archivedList', archived.length)}
              </summary>
              <ul className="item-list explain__body">{archived.map(row)}</ul>
            </details>
          )}
        </>
      )}
    </div>
  )
}

export function PeriodBudgetForm({ route }: { route: Route }) {
  const { t } = useT()
  const data = useData()
  const editId = route.segments[2] === 'editar' ? route.segments[3] : undefined
  const existing = editId ? data.periodBudgets.find((b) => b.id === editId) : undefined
  if (editId && !existing) {
    return <PageHeader title={t('period.notFound')} back={{ href: href('/plan/periodos'), label: t('plan.periods') }} />
  }
  const back = existing ? `/plan/periodos/${existing.id}` : '/plan/periodos'
  return (
    <div className="stack">
      <PageHeader title={existing ? t('period.editTitle') : t('period.newTitle')} back={{ href: href(back), label: t('common.back') }} />
      <PackBody name="periods">
        <PeriodForm existing={existing} back={back} />
      </PackBody>
    </div>
  )
}

function PeriodForm({ existing, back }: { existing: PeriodBudget | undefined; back: string }) {
  const leave = useNavigateIfStillHere()
  const { t } = usePackT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const [id] = useState(() => existing?.id ?? newId())
  const [template, setTemplate] = useState<PeriodTemplate>(existing?.template ?? 'semester')
  const initialDates = existing ?? templateDates('semester', today)
  const [name, setName] = useState(existing?.name ?? '')
  const [startDate, setStartDate] = useState(initialDates.startDate)
  const [endDate, setEndDate] = useState(initialDates.endDate)
  const [allocatedText, setAllocatedText] = useState(existing ? fmt.moneyInput(existing.allocatedMinor) : '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [ruleCategoryIds, setRuleCategoryIds] = useState<string[]>(existing?.ruleCategoryIds ?? [])
  // Fase 3: modo viaje (solo con la plantilla «Viaje»).
  const [tripDraft, setTripDraft] = useState<TripDraft>(() => tripDraftFrom(existing?.trip, fmt.decimalSeparator, fmt.numberLocale))
  const [tripTried, setTripTried] = useState(false)
  const [issues, setIssues] = useState<Issue[]>([])
  const [amountError, setAmountError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const chooseTemplate = (tpl: PeriodTemplate) => {
    setTemplate(tpl)
    if (!existing) {
      const d = templateDates(tpl, today)
      setStartDate(d.startDate)
      setEndDate(d.endDate)
    }
  }

  const submit = async () => {
    const parsed = parseMoneyText(allocatedText, fmt)
    setAmountError(moneyErrorMessage(t, parsed))
    const trip = template === 'trip' ? tripFromDraft(tripDraft, fmt.decimalSeparator, fmt.numberLocale) : ({ ok: true, trip: null } as const)
    setTripTried(true)
    if (!parsed.ok || !trip.ok || busy) return
    setBusy(true)
    const { result, saved } = await run((d, c) => savePeriodBudget(d, { id, name, template, startDate, endDate, allocatedMinor: parsed.minor, note, ruleCategoryIds, trip: trip.trip }, c))
    setBusy(false)
    if (!result.ok) {
      setIssues(result.issues)
      return
    }
    toast({ message: saved ? t('period.saved') : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
    leave(`/plan/periodos/${id}`)
  }

  const unknown = otherIssues(issues, ['name', 'startDate', 'endDate', 'allocatedMinor', 'note'])
  return (
    <>
      <form
        className="form card"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Segmented
          legend={t('period.templateLegend')}
          name="template"
          value={template}
          onChange={chooseTemplate}
          options={TEMPLATES.map((x) => ({ value: x, label: t(`period.template.${x}`) }))}
          hint={t(`period.templateHint.${template}`)}
        />
        <TextField label={t('fields.name')} value={name} maxLength={LIMITS.nameMax} onChange={(e) => setName(e.target.value)} placeholder={t(`period.namePlaceholder.${template}`)} error={fieldError(t, fmt, issues, 'name')} required />
        <div className="form-grid">
          <TextField label={t('period.start')} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} error={fieldError(t, fmt, issues, 'startDate')} required />
          <TextField label={t('period.end')} type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} error={fieldError(t, fmt, issues, 'endDate')} required />
        </div>
        <MoneyField label={t('period.allocated')} value={allocatedText} onChange={setAllocatedText} error={amountError ?? fieldError(t, fmt, issues, 'allocatedMinor')} fmt={fmt} hint={t('period.allocatedHint')} />
        <TextField label={t('fields.noteOptional')} value={note} maxLength={LIMITS.noteMax} onChange={(e) => setNote(e.target.value)} error={fieldError(t, fmt, issues, 'note')} />
        {template === 'trip' && <TripFields draft={tripDraft} setDraft={setTripDraft} showErrors={tripTried} />}
        <details className="explain" open={ruleCategoryIds.length > 0}>
          <summary>
            <Icon name="sliders" size={16} />
            {t('period.ruleTitle')}
          </summary>
          <fieldset className="explain__body stack-sm">
            <legend className="sr-only">{t('period.ruleTitle')}</legend>
            <p className="field__hint">{t('period.ruleHint')}</p>
            {categoriesForKind('expense', data.categories, { prefs: data.categoryPrefs }).map((c) => (
              <CheckboxField
                key={c}
                checked={ruleCategoryIds.includes(c)}
                onChange={(v) => setRuleCategoryIds((ids) => (v ? [...ids, c] : ids.filter((x) => x !== c)))}
                label={categoryLabel(t, c)}
              />
            ))}
          </fieldset>
        </details>
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
          <a className="btn btn--secondary btn--large" href={href(back)}>
            {t('common.cancel')}
          </a>
        </div>
      </form>
    </>
  )
}

export function PeriodBudgetDetail({ route }: { route: Route }) {
  const { t } = useT()
  const data = useData()
  const budget = data.periodBudgets.find((b) => b.id === route.segments[2])
  if (!budget) {
    return (
      <div className="stack">
        <PageHeader title={t('period.notFound')} back={{ href: href('/plan/periodos'), label: t('plan.periods') }} />
      </div>
    )
  }
  return (
    <div className="stack">
      <PageHeader title={budget.name} back={{ href: href('/plan/periodos'), label: t('plan.periods') }}>
        <a className="btn btn--secondary" href={href(`/plan/periodos/editar/${budget.id}`)}>
          <Icon name="edit" />
          {t('common.edit')}
        </a>
      </PageHeader>
      <PackBody name="periods">
        <PeriodDetail budget={budget} />
      </PackBody>
    </div>
  )
}

function PeriodDetail({ budget }: { budget: PeriodBudget }) {
  const leave = useNavigateIfStillHere()
  const { t, tn } = usePackT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const [reserving, setReserving] = useState(false)
  const [suggestCategory, setSuggestCategory] = useState('')
  const [showAll, setShowAll] = useState(false)
  const summary = useMemo(() => summarizePeriod(data, budget, today), [data, budget, today])
  const candidates = useMemo(() => periodCandidates(data, budget), [data, budget])
  const reserve = budget.goalId ? goalReserveLines(data).find((l) => l.goal.id === budget.goalId) : undefined
  const availableMinor = useMemo(() => computeBudget(data, today).availableMinor, [data, today])

  const linked = new Set(budget.txIds)
  const outside = new Set(summary.outsideRange.map((x) => x.id))
  const shared = new Set(summary.shared.map((x) => x.id))
  const shown = showAll ? candidates : candidates.slice(0, 40)

  const suggestions = periodSuggestions(data, budget, suggestCategory || undefined)
  const suggestionCategories = [...new Set(periodSuggestions(data, budget).map((x) => x.categoryId).filter((c): c is string => !!c))]

  const linkSuggestions = async () => {
    const ids = suggestions.map((x) => x.id)
    const { result, saved } = await run((d, c) => setPeriodTransactionsBulk(d, budget.id, ids, true, c))
    if (!result.ok) return
    const changed = result.value
    toast({
      message: saved ? tn('period.suggestLinked', changed.length) : t('save.error.generic'),
      tone: saved ? 'good' : 'critical',
      action: { label: t('common.undo'), onClick: () => void run((d, c) => setPeriodTransactionsBulk(d, budget.id, changed, false, c)) },
    })
  }

  const toggle = async (txId: string, value: boolean) => {
    const { result, saved } = await run((d, c) => setPeriodTransaction(d, budget.id, txId, value, c))
    if (!result.ok || !saved) toast({ message: t('save.error.generic'), tone: 'critical' })
  }

  const archive = async (value: boolean) => {
    const { saved } = await run((d, c) => setPeriodBudgetArchived(d, budget.id, value, c))
    toast({ message: saved ? t(value ? 'period.archivedToast' : 'period.unarchivedToast') : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
  }

  const remove = async () => {
    const { result, saved } = await run((d, c) => deletePeriodBudget(d, budget.id, c))
    if (!result.ok) return
    const removed = result.value
    toast({
      message: saved ? t('period.deleted') : t('save.error.generic'),
      tone: saved ? 'good' : 'critical',
      action: { label: t('common.undo'), onClick: () => void run((d, c) => restorePeriodBudget(d, removed, c)) },
    })
    leave('/plan/periodos')
  }

  return (
    <>
      <p className="item__badges">
        <StatusBadge budget={budget} status={summary.status} />
        <Badge>{t(`period.template.${budget.template}`)}</Badge>
        {budget.ruleCategoryIds?.length ? <Badge icon="sliders">{t('period.ruleBadge', { categories: budget.ruleCategoryIds.map((c) => categoryLabel(t, c)).join(', ') })}</Badge> : null}
      </p>
      <p>
        {fmt.date(budget.startDate)} – {fmt.date(budget.endDate)} · {tn('period.totalDays', summary.totalDays)}
      </p>

      <Card labelledBy="period-summary">
        <h2 id="period-summary" className="card__title">
          {t('period.summary')}
        </h2>
        <div className="stats">
          <div className="stat">
            <p className="stat__label">{t('period.allocated')}</p>
            <p className="stat__value">{fmt.money(budget.allocatedMinor)}</p>
          </div>
          <div className="stat">
            <p className="stat__label">{t('period.spent')}</p>
            <p className="stat__value" data-testid="period-spent">
              {fmt.money(summary.spentMinor)}
            </p>
          </div>
          <div className="stat">
            <p className="stat__label">{summary.remainingMinor < 0 ? t('period.overBy') : t('period.remaining')}</p>
            <p className="stat__value" data-testid="period-remaining">
              {fmt.money(Math.abs(summary.remainingMinor))}
            </p>
          </div>
        </div>
        {summary.remainingMinor < 0 && (
          <Alert tone="critical" title={t('period.overTitle', { amount: fmt.money(-summary.remainingMinor) })}>
            {t('period.overText')}
          </Alert>
        )}
        {summary.perDayMinor !== null && summary.remainingMinor > 0 && (
          <p>{t(summary.status === 'upcoming' ? 'period.paceUpcoming' : 'period.pace', { day: fmt.money(summary.perDayMinor), week: fmt.money(summary.perWeekMinor ?? 0), days: summary.daysLeft })}</p>
        )}
        {summary.status === 'ended' && <p className="note">{t('period.endedNote')}</p>}
        {summary.plannedMinor > 0 && <p className="note">{t('period.plannedNote', { amount: fmt.money(summary.plannedMinor) })}</p>}
        <Explain>
          <div className="calc">
            <CalcRow label={t('period.allocated')} value={fmt.money(budget.allocatedMinor)} />
            <CalcRow op="−" label={t('period.explainSpent')} value={fmt.money(summary.spentMinor)} />
            <CalcRow op="=" label={t('period.remaining')} value={fmt.money(summary.remainingMinor)} strong />
          </div>
          <ul className="bullets">
            <li>{t('period.explainRefunds')}</li>
            <li>{t('period.explainPace')}</li>
            <li>{t('period.explainOutside')}</li>
            <li>{t('period.explainShared')}</li>
            <li>{t('period.explainTrash')}</li>
          </ul>
        </Explain>
      </Card>

      {budget.template === 'trip' && budget.trip && <TripCard budget={budget} />}

      <Card labelledBy="period-money">
        <h2 id="period-money" className="card__title">
          {t('period.moneyTitle')}
        </h2>
        <p>{t('period.availableToday', { amount: fmt.money(availableMinor) })}</p>
        <Why short={t('period.notMoneyShort')}>{t('period.notMoneyText')}</Why>
        {reserve ? (
          <p data-testid="period-reserve">{t('period.reserveLine', { amount: fmt.money(reserve.amountMinor), consumed: fmt.money(reserve.consumedMinor) })}</p>
        ) : (
          <p className="note">{t('period.noReserve')}</p>
        )}
        <div className="button-row">
          {!budget.archived && summary.status !== 'ended' && (
            <button type="button" className="btn btn--secondary" onClick={() => setReserving(true)}>
              <Icon name="lock" />
              {t('period.reserve')}
            </button>
          )}
          {reserve && (
            <a className="btn btn--ghost" href={href('/plan/metas')}>
              {t('period.seeReserveGoal')}
            </a>
          )}
        </div>
      </Card>

      {(summary.outsideRange.length > 0 || summary.shared.length > 0 || summary.trashedCount > 0) && (
        <Alert tone="info" title={t('period.noticesTitle')}>
          <ul>
            {summary.outsideRange.length > 0 && <li>{tn('period.outsideCount', summary.outsideRange.length)}</li>}
            {summary.shared.length > 0 && <li>{tn('period.sharedCount', summary.shared.length)}</li>}
            {summary.trashedCount > 0 && <li>{tn('period.trashedCount', summary.trashedCount)}</li>}
          </ul>
        </Alert>
      )}

      <section className="stack-sm" aria-labelledby="period-movements">
        <h2 id="period-movements" className="section-title">
          {t('period.movements')}
        </h2>
        <Why short={t('period.movementsShort')}>{t('period.movementsHint')}</Why>
        {!budget.archived && (suggestions.length > 0 || suggestCategory) && (
          <div className="card stack-sm" data-testid="period-suggestions">
            <p>{tn('period.suggestText', suggestions.length)}</p>
            {suggestionCategories.length > 1 && (
              <CategoryPicker label={t('period.suggestCategory')} kind="expense" data={data} value={suggestCategory} onChange={setSuggestCategory} only={suggestionCategories} placeholder={t('filters.allCategories')} includeArchived />
            )}
            {suggestions.length > 0 && (
              <button type="button" className="btn btn--secondary" onClick={() => void linkSuggestions()}>
                <Icon name="check" />
                {tn('period.suggestAction', suggestions.length)}
              </button>
            )}
            <p className="field__hint">{t('period.suggestHint')}</p>
          </div>
        )}
        <a className="btn btn--secondary" href={href(`/movimientos/nuevo?kind=expense&periodo=${budget.id}&returnTo=/plan/periodos/${budget.id}`)}>
          <Icon name="plus" />
          {t('period.addExpense')}
        </a>
        {candidates.length === 0 ? (
          <p className="note">{t('period.noCandidates')}</p>
        ) : (
          <fieldset className="stack-sm">
            <legend className="sr-only">{t('period.movements')}</legend>
            {shown.map((x) => (
              <div className="check" key={x.id}>
                <input id={`pt-${x.id}`} type="checkbox" checked={linked.has(x.id)} disabled={budget.archived} onChange={(e) => void toggle(x.id, e.target.checked)} />
                <div>
                  <label htmlFor={`pt-${x.id}`}>
                    {transactionTitle(x, data.accounts, t)} · {fmt.date(x.date, { compact: true, today })} · {x.kind === 'refund' ? '+' : '−'}
                    {fmt.money(x.amountMinor)}
                  </label>
                  <p className="item__badges">
                    {x.status === 'planned' && <Badge tone="info" icon="clock">{t('status.planned')}</Badge>}
                    {x.kind === 'refund' && <Badge icon="refund">{t('txKind.refund')}</Badge>}
                    {outside.has(x.id) && <Badge tone="warning" icon="alert">{t('period.outsideBadge')}</Badge>}
                    {shared.has(x.id) && <Badge icon="info">{t('period.sharedBadge')}</Badge>}
                  </p>
                </div>
              </div>
            ))}
            {candidates.length > shown.length && (
              <button type="button" className="btn btn--ghost" onClick={() => setShowAll(true)}>
                {t('movements.showMore', { count: candidates.length - shown.length })}
              </button>
            )}
          </fieldset>
        )}
      </section>

      <div className="form__actions">
        <button type="button" className="btn btn--secondary" onClick={() => void archive(!budget.archived)}>
          <Icon name="lock" />
          {t(budget.archived ? 'period.unarchive' : 'period.archive')}
        </button>
        <button type="button" className="btn btn--danger-ghost" onClick={() => void remove()}>
          <Icon name="trash" />
          {t('common.delete')}
        </button>
      </div>
      <p className="note">{t('period.deleteNote')}</p>
      {reserving && <ReserveDialog budget={budget} available={availableMinor} onClose={() => setReserving(false)} />}
    </>
  )
}

function ReserveDialog({ budget, available, onClose }: { budget: PeriodBudget; available: number; onClose: () => void }) {
  const { t } = usePackT()
  const fmt = useFormat()
  const run = useRun()
  const toast = useToast()
  const [goalId] = useState(newId)
  const [allocationId] = useState(newId)
  const [amountText, setAmountText] = useState('')
  const [issues, setIssues] = useState<Issue[]>([])
  const [amountError, setAmountError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const typed = parseMoneyText(amountText, fmt)

  const submit = async () => {
    const parsed = parseMoneyText(amountText, fmt)
    setAmountError(moneyErrorMessage(t, parsed))
    if (!parsed.ok || busy) return
    setBusy(true)
    const { result, saved } = await run((d, c) => reserveForPeriod(d, { budgetId: budget.id, amountMinor: parsed.minor, goalId, allocationId }, c))
    setBusy(false)
    if (!result.ok) {
      setIssues(result.issues)
      return
    }
    toast({ message: saved ? t('period.reservedToast', { amount: fmt.money(parsed.minor) }) : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('period.reserveTitle', { name: budget.name })}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {t('period.reserve')}
          </button>
        </>
      }
    >
      <Why short={t('period.reserveShort')}>{t('period.reserveExplain')}</Why>
      <MoneyField label={t('fields.amount')} value={amountText} onChange={setAmountText} fmt={fmt} autoFocus error={amountError ?? fieldError(t, fmt, issues, 'amountMinor')} hint={t('goals.maxAddBudget', { amount: fmt.money(Math.max(0, available)) })} />
      {typed.ok && <p>{t('period.reserveEffect', { before: fmt.money(available), after: fmt.money(available - typed.minor) })}</p>}
      {otherIssues(issues, ['amountMinor']).map((i, idx) => (
        <Alert key={idx} tone="critical" title={issueMessage(t, fmt, i)} role="alert" />
      ))}
    </Dialog>
  )
}
