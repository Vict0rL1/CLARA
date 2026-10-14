/**
 * Gastos planificados (anuales o poco frecuentes): tarjeta, formulario y pago.
 * Son metas `kind: 'expense'`; los cálculos viven en `domain/plannedExpenses.ts`.
 */
import { activeAccounts, isBudgetAccount } from '../../domain/balances'
import { useMemo, useState } from 'react'
import { addDays } from '../../domain/dates'
import { goalProgress } from '../../domain/goals'
import { newId } from '../../domain/ids'
import { deleteGoal, restoreGoal } from '../../domain/operations'
import { openItemsUntil } from '../../domain/planItems'
import { linkedSettlement, payPlannedExpense, plannedExpenseStatus, savePlannedExpense, settlePlannedExpenseFromCalendar, type PlannedExpenseState } from '../../domain/plannedExpenses'
import type { Goal, GoalFunding } from '../../domain/types'
import { LIMITS, type Issue } from '../../domain/validation'
import { useT } from '../../i18n'
import { useRun, useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { Alert, Badge, Card, Meter, PageHeader, Why, type Tone } from '../components/common'
import { Dialog } from '../components/Dialog'
import { MoneyField, Segmented, SelectField, TextField } from '../components/fields'
import { CategoryPicker } from '../components/CategoryPicker'
import { Icon, type IconName } from '../components/Icon'
import { useToast } from '../components/toastContext'
import { BalanceInclusionControl } from '../dialogs'
import { useFormat } from '../format'
import { accountOptions, fieldError, issueMessage, otherIssues, planItemName } from '../labels'
import { moneyErrorMessage, parseMoneyText } from '../moneyText'
import { href, useNavigateIfStillHere } from '../router'

const STATE: Record<PlannedExpenseState, { tone: Tone; icon: IconName }> = {
  paid: { tone: 'good', icon: 'check' },
  covered: { tone: 'good', icon: 'checkCircle' },
  overdue: { tone: 'critical', icon: 'alert' },
  underWeek: { tone: 'warning', icon: 'clock' },
  onTrack: { tone: 'info', icon: 'calendar' },
}

const REPEAT_OPTIONS = [0, 1, 3, 6, 12] as const

export function PlannedExpenseCard({ goal, onAllocate }: { goal: Goal; onAllocate: (mode: 'add' | 'release') => void }) {
  const { t, tn } = useT()
  const fmt = useFormat()
  const today = useToday()
  const [paying, setPaying] = useState(false)
  const data = useData()
  const run = useRun()
  const toast = useToast()
  // El pago vinculado ya se registró (p. ej. desde el calendario): se cierra con ese movimiento.
  const settledBy = linkedSettlement(data, goal)
  const s = plannedExpenseStatus(goal, today)
  const plan = goal.plan!
  const p = goalProgress(goal)
  const valueText = t('goals.progressText', { saved: fmt.money(p.savedMinor), target: fmt.money(p.targetMinor), pct: fmt.percent(p.fraction) })
  const paid = s.state === 'paid'
  return (
    <Card as="article" className="goal" labelledBy={`goal-${goal.id}`}>
      <div className="goal__head">
        <h3 className="card__title" id={`goal-${goal.id}`}>
          {goal.name}
        </h3>
        <a className="btn btn--ghost btn--small" href={href(`/plan/metas/editar/${goal.id}`)}>
          <Icon name="edit" size={16} />
          {t('common.edit')}
          <span className="sr-only">: {goal.name}</span>
        </a>
      </div>
      <p className="item__badges">
        <Badge tone={STATE[s.state].tone} icon={STATE[s.state].icon}>
          {t(`planned.state.${s.state}`)}
        </Badge>
        {plan.repeatEveryMonths ? <Badge icon="undo">{tn('planned.repeatBadge', plan.repeatEveryMonths)}</Badge> : <Badge>{t('planned.once')}</Badge>}
        {plan.link && <Badge icon="calendar">{t('planned.linkedBadge')}</Badge>}
        <Badge tone={goal.fundedFrom === 'budget' ? 'info' : 'neutral'}>{t(goal.fundedFrom === 'budget' ? 'goals.fundedBudgetShort' : 'goals.fundedExternalShort')}</Badge>
      </p>
      {!paid && goal.targetDate && (
        <p>
          {t('planned.due', { date: fmt.date(goal.targetDate) })}
          {s.daysLeft > 0 && <> · {tn('planned.daysLeft', s.daysLeft)}</>}
        </p>
      )}
      {!paid && (
        <>
          <Meter fraction={p.fraction} label={goal.name} valueText={valueText} />
          <dl className="plan-vs">
            <div>
              <dt>{t('planned.confirmed')}</dt>
              <dd data-testid="planned-confirmed">{fmt.money(p.savedMinor)}</dd>
            </div>
            <div>
              <dt>{t('planned.remaining')}</dt>
              <dd>{fmt.money(p.remainingMinor)}</dd>
            </div>
            {s.plan.status === 'ok' && (
              <div>
                <dt>{t('planned.suggested')}</dt>
                <dd>
                  {t('planned.suggestedValue', { week: fmt.money(s.plan.perWeekMinor ?? 0), month: fmt.money(s.plan.perMonthMinor ?? 0) })}
                </dd>
              </div>
            )}
          </dl>
          <Why short={t('planned.planVsConfirmedShort')}>{t('planned.planVsConfirmed')}</Why>
          {s.state === 'overdue' && (
            <Alert tone="critical" title={t('planned.overdueTitle', { date: fmt.date(goal.targetDate!) })}>
              {t('planned.overdueText', { amount: fmt.money(p.remainingMinor) })}
            </Alert>
          )}
          {s.state === 'underWeek' && <Alert tone="warning" title={t('planned.underWeekTitle')}>{t('planned.underWeekText', { amount: fmt.money(p.remainingMinor) })}</Alert>}
          <div className="button-row">
            {!p.complete && (
              <button type="button" className="btn btn--secondary btn--small" onClick={() => onAllocate('add')}>
                <Icon name="plus" size={16} />
                {t('planned.confirmContribution')}
                <span className="sr-only">: {goal.name}</span>
              </button>
            )}
            {p.savedMinor > 0 && (
              <button type="button" className="btn btn--ghost btn--small" onClick={() => onAllocate('release')}>
                {t('goals.release')}
                <span className="sr-only">: {goal.name}</span>
              </button>
            )}
            {settledBy ? (
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={async () => {
                  const { result, saved } = await run((d, c) => settlePlannedExpenseFromCalendar(d, goal.id, c))
                  toast({ message: result.ok && saved ? t('inbox.settledToast') : t('save.error.generic'), tone: result.ok && saved ? 'good' : 'critical' })
                }}
              >
                <Icon name="check" size={16} />
                {t('inbox.action.settle')}
                <span className="sr-only">: {goal.name}</span>
              </button>
            ) : (
              <button type="button" className="btn btn--primary btn--small" onClick={() => setPaying(true)}>
                <Icon name="check" size={16} />
                {t('planned.pay')}
                <span className="sr-only">: {goal.name}</span>
              </button>
            )}
          </div>
          {settledBy && (
            <Alert tone="warning" title={t('inbox.title.reserveForSettledBill', { name: goal.name })}>
              {t('inbox.why.reserveForSettledBill', { amount: fmt.money(p.savedMinor) })}
            </Alert>
          )}
        </>
      )}
      {paid && <p className="note">{t('planned.paidNote')}</p>}
      {plan.history.length > 0 && (
        <details className="explain">
          <summary>
            <Icon name="clock" size={16} />
            {tn('planned.history', plan.history.length)}
          </summary>
          <ul className="explain__body bullets">
            {[...plan.history].reverse().map((c) => (
              <li key={c.txId}>
                {t('planned.historyRow', { date: fmt.date(c.dueDate), paid: fmt.money(c.paidMinor), reserved: fmt.money(c.reservedMinor) })}
                {c.surplus !== 'none' && <> · {t(c.surplus === 'carry' ? 'planned.surplusCarried' : 'planned.surplusReleased')}</>}
                {' · '}
                <a href={href(`/movimientos/editar/${c.txId}`)}>{t('planned.seeMovement')}</a>
              </li>
            ))}
          </ul>
        </details>
      )}
      {paying && <PayPlannedDialog goal={goal} onClose={() => setPaying(false)} />}
    </Card>
  )
}

function PayPlannedDialog({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const plan = goal.plan!
  const saved = Math.max(0, goalProgress(goal).savedMinor)
  const linkedSchedule = plan.link ? data.schedules.find((s) => s.id === plan.link!.scheduleId) : undefined
  const [txId] = useState(newId)
  const [amountText, setAmountText] = useState(() => fmt.moneyInput(goal.targetMinor))
  const [date, setDate] = useState(today)
  const [accountId, setAccountId] = useState(() => linkedSchedule?.accountId ?? activeAccounts(data.accounts).find(isBudgetAccount)?.id ?? activeAccounts(data.accounts)[0]?.id ?? data.accounts[0]!.id)
  const [surplus, setSurplus] = useState<'release' | 'carry'>('release')
  const [alreadyInBalance, setAlreadyInBalance] = useState(false)
  const [issues, setIssues] = useState<Issue[]>([])
  const [amountError, setAmountError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const typed = parseMoneyText(amountText, fmt)
  const surplusMinor = typed.ok ? Math.max(0, saved - typed.minor) : 0
  const shortfallMinor = typed.ok ? Math.max(0, typed.minor - saved) : 0

  const submit = async () => {
    const parsed = parseMoneyText(amountText, fmt)
    setAmountError(moneyErrorMessage(t, parsed))
    if (!parsed.ok || busy) return
    setBusy(true)
    const { result, saved: ok } = await run((d, c) => payPlannedExpense(d, { goalId: goal.id, txId, amountMinor: parsed.minor, date, accountId, surplus, alreadyInBalance }, c))
    setBusy(false)
    if (!result.ok) {
      setIssues(result.issues)
      return
    }
    toast({ message: ok ? t('planned.paidToast', { name: goal.name, amount: fmt.money(parsed.minor) }) : t('save.error.generic'), tone: ok ? 'good' : 'critical' })
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('planned.payTitle', { name: goal.name })}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {t('planned.payConfirm')}
          </button>
        </>
      }
    >
      <p className="dialog__lead">{t('planned.payLead', { reserved: fmt.money(saved), target: fmt.money(goal.targetMinor) })}</p>
      <MoneyField label={t('planned.paidAmount')} value={amountText} onChange={setAmountText} error={amountError ?? fieldError(t, fmt, issues, 'amountMinor')} fmt={fmt} autoFocus />
      <TextField label={t('markPaid.dateExpense')} type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} required error={fieldError(t, fmt, issues, 'date')} />
      {data.accounts.length > 1 && (
        <SelectField label={t('fields.account')} value={accountId} onChange={(e) => setAccountId(e.target.value)} options={accountOptions(data.accounts, t, accountId)} />
      )}
      <BalanceInclusionControl accountId={accountId} date={date} checked={alreadyInBalance} onChange={setAlreadyInBalance} />
      {surplusMinor > 0 &&
        (plan.repeatEveryMonths ? (
          <Segmented
            legend={t('planned.surplusLegend', { amount: fmt.money(surplusMinor) })}
            name="surplus"
            value={surplus}
            onChange={setSurplus}
            options={[
              { value: 'release', label: t('planned.surplusRelease') },
              { value: 'carry', label: t('planned.surplusCarry') },
            ]}
            hint={t(surplus === 'carry' ? 'planned.surplusCarryHint' : 'planned.surplusReleaseHint')}
          />
        ) : (
          <p className="note">{t('planned.surplusOnce', { amount: fmt.money(surplusMinor) })}</p>
        ))}
      {shortfallMinor > 0 && (
        <Alert tone="warning" title={t('planned.shortfallTitle', { amount: fmt.money(shortfallMinor) })}>
          {t('planned.shortfallText')}
        </Alert>
      )}
      {plan.link && linkedSchedule && <p className="note">{t('planned.payLinked', { name: linkedSchedule.name, date: fmt.date(plan.link.occurrenceDate) })}</p>}
      <p className="note">{t(plan.repeatEveryMonths ? 'planned.payNextCycle' : 'planned.payOnce')}</p>
      {otherIssues(issues, ['amountMinor', 'date']).map((i, idx) => (
        <Alert key={idx} tone="critical" title={issueMessage(t, fmt, i)} role="alert" />
      ))}
    </Dialog>
  )
}

export function PlannedExpenseForm({ existing }: { existing: Goal | undefined }) {
  const leave = useNavigateIfStillHere()
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const [id] = useState(() => existing?.id ?? newId())
  const [allocationId] = useState(newId)
  const [name, setName] = useState(existing?.name ?? '')
  const [targetText, setTargetText] = useState(existing ? fmt.moneyInput(existing.targetMinor) : '')
  const [dueDate, setDueDate] = useState(existing?.targetDate ?? '')
  const [repeat, setRepeat] = useState(String(existing?.plan?.repeatEveryMonths ?? 0))
  const [categoryId, setCategoryId] = useState(existing?.plan?.categoryId ?? 'other_expense')
  const [fundedFrom, setFundedFrom] = useState<GoalFunding>(existing?.fundedFrom ?? 'budget')
  const [linkKey, setLinkKey] = useState(existing?.plan?.link ? `${existing.plan.link.scheduleId}|${existing.plan.link.occurrenceDate}` : '')
  const [initialText, setInitialText] = useState('')
  const [issues, setIssues] = useState<Issue[]>([])
  const [amountError, setAmountError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Ocurrencias abiertas de gastos programados que ninguna otra meta cubre.
  const occurrences = useMemo(() => {
    const taken = new Set(data.goals.filter((g) => g.id !== id && g.plan?.link && !g.plan.paidAt).map((g) => `${g.plan!.link!.scheduleId}|${g.plan!.link!.occurrenceDate}`))
    return openItemsUntil(data, today, addDays(today, 400))
      .filter((i) => i.source === 'schedule' && i.direction === 'expense' && i.date >= today)
      .map((i) => ({ key: `${i.sourceId}|${i.date}`, item: i }))
      .filter((o) => !taken.has(o.key) || o.key === linkKey)
      .slice(0, 60)
  }, [data, today, id, linkKey])
  const linked = occurrences.find((o) => o.key === linkKey)

  const submit = async () => {
    const parsed = parseMoneyText(targetText, fmt)
    setAmountError(moneyErrorMessage(t, parsed))
    const initial = !existing && initialText.trim() ? parseMoneyText(initialText, fmt) : null
    if (!parsed.ok || (initial && !initial.ok) || busy) return
    setBusy(true)
    const [scheduleId, occurrenceDate] = linkKey ? linkKey.split('|') : []
    const { result, saved } = await run((d, c) =>
      savePlannedExpense(
        d,
        {
          id,
          name,
          targetMinor: parsed.minor,
          dueDate: linked ? linked.item.date : dueDate,
          fundedFrom,
          repeatEveryMonths: Number(repeat) || undefined,
          categoryId,
          link: scheduleId && occurrenceDate ? { scheduleId, occurrenceDate } : undefined,
          initialReservedMinor: initial && initial.ok ? initial.minor : undefined,
          allocationId,
        },
        c,
      ),
    )
    setBusy(false)
    if (!result.ok) {
      setIssues(result.issues)
      return
    }
    toast({ message: saved ? t('goalForm.saved') : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
    leave('/plan/metas')
  }

  const remove = async () => {
    if (!existing) return
    const { result, saved } = await run((d, c) => deleteGoal(d, existing.id, c))
    if (!result.ok) return
    const removed = result.value
    toast({
      message: saved ? t('goalForm.deleted') : t('save.error.generic'),
      tone: saved ? 'good' : 'critical',
      action: { label: t('common.undo'), onClick: () => void run((d, c) => restoreGoal(d, removed, c)) },
    })
    leave('/plan/metas')
  }

  const unknown = otherIssues(issues, ['name', 'targetMinor', 'targetDate', 'initialReservedMinor'])
  return (
    <div className="stack">
      <PageHeader title={existing ? t('planned.editTitle') : t('planned.newTitle')} back={{ href: href('/plan/metas'), label: t('plan.goals') }} />
      <Why short={t('planned.introShort')}>{t('planned.intro')}</Why>
      <form
        className="form card"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <TextField label={t('fields.name')} value={name} maxLength={LIMITS.nameMax} onChange={(e) => setName(e.target.value)} placeholder={t('planned.namePlaceholder')} error={fieldError(t, fmt, issues, 'name')} required />
        <MoneyField label={t('planned.target')} value={targetText} onChange={setTargetText} error={amountError ?? fieldError(t, fmt, issues, 'targetMinor')} fmt={fmt} hint={t('planned.targetHint')} />
        {occurrences.length > 0 && (
          <SelectField
            label={t('planned.link')}
            value={linkKey}
            onChange={(e) => {
              setLinkKey(e.target.value)
              const o = occurrences.find((x) => x.key === e.target.value)
              if (o) {
                setDueDate(o.item.date)
                if (!targetText.trim()) setTargetText(fmt.moneyInput(o.item.amountMinor))
                if (!name.trim()) setName(planItemName(o.item, t))
              }
            }}
            options={[
              { value: '', label: t('planned.linkNone') },
              ...occurrences.map((o) => ({ value: o.key, label: t('movementForm.linkOption', { name: planItemName(o.item, t), date: fmt.date(o.item.date, { compact: true, today }), amount: fmt.money(o.item.amountMinor) }) })),
            ]}
            hint={t('planned.linkHint')}
            error={fieldError(t, fmt, issues, 'link')}
          />
        )}
        <TextField
          label={t('planned.dueDate')}
          type="date"
          value={linked ? linked.item.date : dueDate}
          disabled={!!linked}
          onChange={(e) => setDueDate(e.target.value)}
          hint={linked ? t('planned.dueFromLink') : undefined}
          error={fieldError(t, fmt, issues, 'targetDate')}
          required
        />
        <SelectField
          label={t('planned.repeat')}
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          options={REPEAT_OPTIONS.map((m) => ({ value: String(m), label: m === 0 ? t('planned.once') : tn('planned.repeatBadge', m) }))}
          hint={t('planned.repeatHint')}
        />
        <CategoryPicker label={t('fields.category')} kind="expense" data={data} value={categoryId} onChange={setCategoryId} allowNew />
        <Segmented
          legend={t('goalForm.funding')}
          name="pfunding"
          value={fundedFrom}
          onChange={setFundedFrom}
          options={[
            { value: 'budget', label: t('goals.fundedBudgetShort') },
            { value: 'external', label: t('goals.fundedExternalShort') },
          ]}
          hint={t(fundedFrom === 'budget' ? 'goalForm.fundingBudgetHint' : 'goalForm.fundingExternalHint')}
        />
        {!existing && (
          <MoneyField
            label={t('planned.initialReserved')}
            value={initialText}
            onChange={setInitialText}
            fmt={fmt}
            hint={t('planned.initialReservedHint')}
            error={fieldError(t, fmt, issues, 'initialReservedMinor')}
          />
        )}
        {existing && <p className="note">{t('goalForm.allocationsNote')}</p>}
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
          <a className="btn btn--secondary btn--large" href={href('/plan/metas')}>
            {t('common.cancel')}
          </a>
          {existing && (
            <button type="button" className="btn btn--danger-ghost" onClick={() => void remove()}>
              <Icon name="trash" />
              {t('common.delete')}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
