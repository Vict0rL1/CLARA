/**
 * Diálogos de acciones frecuentes: marcar pagado/recibido, actualizar saldo,
 * apartar dinero para una meta y elegir horizonte.
 */
import { useMemo, useState } from 'react'
import { accountBalance, activeAccounts, isBudgetAccount } from '../domain/balances'
import { HORIZON_OPTIONS } from '../domain/budget'
import { goalProgress } from '../domain/goals'
import { newId } from '../domain/ids'
import {
  allocateToGoal,
  maxBudgetAllocation,
  defaultPaymentDate,
  markOccurrence,
  realizePlanned,
  removeTransactions,
  revertTransaction,
  updateAccountBalance,
  updateSettings,
} from '../domain/operations'
import { openItemsUntil, type PlanItem } from '../domain/planItems'
import type { Goal, Transaction } from '../domain/types'
import type { Issue } from '../domain/validation'
import { useT } from '../i18n'
import { useRun, useToday } from '../state/hooks'
import { useData } from '../state/store'
import { CheckboxField, MoneyField, Segmented, SelectField, TextField } from './components/fields'
import { parseMoneyText, moneyErrorMessage } from './moneyText'
import { Dialog } from './components/Dialog'
import { Alert } from './components/common'
import { useToast } from './components/toastContext'
import { useFormat } from './format'
import { accountOptions, fieldError, issueMessage, otherIssues, planItemName } from './labels'
import { href } from './router'

function IssueList({ issues }: { issues: Issue[] }) {
  const { t } = useT()
  const fmt = useFormat()
  if (issues.length === 0) return null
  return (
    <Alert tone="critical" title={t('common.fixErrors')} role="alert">
      <ul>
        {issues.map((i, idx) => (
          <li key={idx}>{issueMessage(t, fmt, i)}</li>
        ))}
      </ul>
    </Alert>
  )
}

/** Aviso sobre si un movimiento con esa fecha ya está incluido en el saldo registrado. */
export function BalanceInclusionControl({
  accountId,
  date,
  checked,
  onChange,
}: {
  accountId: string
  date: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const account = data.accounts.find((a) => a.id === accountId)
  if (!account || !date) return null
  const anchor = account.anchor
  if (date < anchor.date) {
    return (
      <p className="note">
        {t('balanceInclusion.before', { date: fmt.date(anchor.date), account: account.name })}
      </p>
    )
  }
  if (date === anchor.date) {
    return (
      <CheckboxField
        checked={checked}
        onChange={onChange}
        label={t('balanceInclusion.checkbox', { date: fmt.date(anchor.date), time: fmt.time(anchor.setAt) })}
        hint={t('balanceInclusion.hint')}
      />
    )
  }
  return null
}

export function MarkPaidDialog({ item, onClose }: { item: PlanItem; onClose: () => void }) {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const [amountText, setAmountText] = useState(() => fmt.moneyInput(item.amountMinor))
  const [date, setDate] = useState(() => defaultPaymentDate(item.date, today))
  const [accountId, setAccountId] = useState(item.accountId)
  const [alreadyInBalance, setAlreadyInBalance] = useState(false)
  const [txId] = useState(newId)
  const [issues, setIssues] = useState<Issue[]>([])
  const [amountError, setAmountError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Ingreso parcial: por defecto se da por terminada (postura prudente); la persona elige.
  const [partial, setPartial] = useState<'close' | 'expect'>('close')
  const isIncome = item.budgetEffectMinor > 0 || item.direction === 'income'
  const name = planItemName(item, t)
  const typed = parseMoneyText(amountText, fmt)
  const isPartial = item.source === 'schedule' && isIncome && typed.ok && typed.minor < item.amountMinor

  const submit = async () => {
    const parsed = parseMoneyText(amountText, fmt)
    setAmountError(moneyErrorMessage(t, parsed))
    if (!parsed.ok || busy) return
    setBusy(true)
    const previous = item.source === 'planned' ? data.transactions.find((x) => x.id === item.sourceId) : undefined
    const { result, saved } =
      item.source === 'schedule'
        ? await run((d, c) =>
            markOccurrence(
              d,
              {
                scheduleId: item.sourceId,
                occurrenceDate: item.date,
                amountMinor: parsed.minor,
                date,
                accountId,
                alreadyInBalance,
                txId,
                expectRemainder: isPartial && partial === 'expect',
              },
              c,
            ),
          )
        : await run((d, c) => realizePlanned(d, item.sourceId, { date, amountMinor: parsed.minor, alreadyInBalance }, c))
    setBusy(false)
    if (!result.ok) {
      setIssues(result.issues)
      return
    }
    const created = result.value as Transaction
    toast({
      message: saved ? t(isIncome ? 'markPaid.doneIncome' : 'markPaid.doneExpense', { name }) : t('save.error.generic'),
      tone: saved ? 'good' : 'critical',
      action: {
        label: t('common.undo'),
        onClick: () => {
          // Deshacer una creación la descarta del todo (no pasa por la papelera).
          if (item.source === 'schedule') void run((d, c) => removeTransactions(d, [created.id], c))
          else if (previous) void run((d, c) => revertTransaction(d, previous, c))
        },
      },
    })
    onClose()
  }

  const accounts = accountOptions(data.accounts, t, item.sourceId ? data.schedules.find((s) => s.id === item.sourceId)?.accountId : undefined)
  return (
    <Dialog
      open
      onClose={onClose}
      title={t(isIncome ? 'markPaid.titleIncome' : 'markPaid.titleExpense')}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {t(isIncome ? 'markPaid.confirmIncome' : 'markPaid.confirmExpense')}
          </button>
        </>
      }
    >
      <p className="dialog__lead">
        <strong>{name}</strong> · {t('markPaid.expected', { amount: fmt.money(item.amountMinor), date: fmt.date(item.date) })}
      </p>
      {!!item.receivedMinor && item.state !== 'paid' && <p className="note">{t('markPaid.alreadyReceived', { amount: fmt.money(item.receivedMinor) })}</p>}
      <MoneyField label={t('markPaid.realAmount')} value={amountText} onChange={setAmountText} error={amountError ?? fieldError(t, fmt, issues, 'amountMinor')} fmt={fmt} />
      {isPartial && typed.ok && (
        <Segmented
          legend={t('markPaid.partialLegend')}
          name="partial"
          value={partial}
          onChange={setPartial}
          options={[
            { value: 'close', label: t('markPaid.partialClose') },
            { value: 'expect', label: t('markPaid.partialExpect', { amount: fmt.money(item.amountMinor - typed.minor) }) },
          ]}
          hint={t('markPaid.partialHint')}
        />
      )}
      <TextField
        label={t(isIncome ? 'markPaid.dateIncome' : 'markPaid.dateExpense')}
        type="date"
        value={date}
        max={today}
        onChange={(e) => setDate(e.target.value)}
        required
        error={fieldError(t, fmt, issues, 'date')}
      />
      {item.source === 'schedule' && accounts.length > 1 && (
        <SelectField label={t('fields.account')} value={accountId} onChange={(e) => setAccountId(e.target.value)} options={accounts} />
      )}
      <BalanceInclusionControl accountId={accountId} date={date} checked={alreadyInBalance} onChange={setAlreadyInBalance} />
      <p className="note">{t('markPaid.noDouble')}</p>
      <IssueList issues={otherIssues(issues, ['amountMinor', 'date'])} />
    </Dialog>
  )
}

export function UpdateBalanceDialog({ onClose, initialAccountId }: { onClose: () => void; initialAccountId?: string }) {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const firstAccount = initialAccountId ?? activeAccounts(data.accounts).find(isBudgetAccount)?.id ?? activeAccounts(data.accounts)[0]?.id ?? data.accounts[0]!.id
  const [accountId, setAccountId] = useState(firstAccount)
  const account = data.accounts.find((a) => a.id === accountId)!
  const current = accountBalance(data, account).balanceMinor
  const isCredit = account.kind === 'credit'
  /** En tarjetas se muestra la deuda en positivo; internamente el saldo es negativo. */
  const shown = (acc: typeof account) => {
    const bal = accountBalance(data, acc).balanceMinor
    return acc.kind === 'credit' ? -bal : bal
  }
  const [amountText, setAmountText] = useState(() => fmt.moneyInput(shown(account)))
  const [date, setDate] = useState(today)
  const [settleKeys, setSettleKeys] = useState<string[]>([])
  const [issues, setIssues] = useState<Issue[]>([])
  const [amountError, setAmountError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const overdue = useMemo(
    () => openItemsUntil(data, today, today).filter((i) => i.state === 'overdue' && i.budgetEffectMinor < 0 && i.accountId === accountId),
    [data, today, accountId],
  )

  const submit = async () => {
    const parsed = parseMoneyText(amountText, fmt, { allowNegative: true, allowZero: true })
    setAmountError(moneyErrorMessage(t, parsed))
    if (!parsed.ok || busy) return
    setBusy(true)
    const settle = overdue
      .filter((i) => settleKeys.includes(i.key))
      .map((i) => ({
        scheduleId: i.source === 'schedule' ? i.sourceId : undefined,
        plannedTxId: i.source === 'planned' ? i.sourceId : undefined,
        occurrenceDate: i.date,
        amountMinor: i.amountMinor,
      }))
    const amountMinor = isCredit ? (parsed.minor === 0 ? 0 : -parsed.minor) : parsed.minor
    const { result, saved } = await run((d, c) => updateAccountBalance(d, { accountId, amountMinor, date, settle }, c))
    setBusy(false)
    if (!result.ok) {
      setIssues(result.issues)
      return
    }
    toast({ message: saved ? t('balance.updated') : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('balance.updateTitle')}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {t('balance.save')}
          </button>
        </>
      }
    >
      {data.accounts.length > 1 && (
        <SelectField
          label={t('fields.account')}
          value={accountId}
          onChange={(e) => {
            setAccountId(e.target.value)
            const acc = data.accounts.find((a) => a.id === e.target.value)!
            setAmountText(fmt.moneyInput(shown(acc)))
            setSettleKeys([])
          }}
          options={accountOptions(data.accounts, t, accountId)}
        />
      )}
      <MoneyField
        label={isCredit ? t('balance.debtLabel') : t('balance.amountLabel')}
        hint={isCredit ? t('balance.debtHint', { amount: fmt.money(-current) }) : t('balance.amountHint', { amount: fmt.money(current) })}
        value={amountText}
        onChange={setAmountText}
        error={amountError ?? fieldError(t, fmt, issues, 'anchor.amountMinor')}
        fmt={fmt}
      />
      <TextField label={t('balance.dateLabel')} type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} error={fieldError(t, fmt, issues, 'date')} />
      <p className="note">{t('balance.explain')}</p>
      {overdue.length > 0 && (
        <fieldset className="stack-sm">
          <legend className="field__label">{t('balance.overdueLegend')}</legend>
          {overdue.map((i) => (
            <CheckboxField
              key={i.key}
              checked={settleKeys.includes(i.key)}
              onChange={(v) => setSettleKeys((keys) => (v ? [...keys, i.key] : keys.filter((k) => k !== i.key)))}
              label={t('balance.overdueItem', { name: planItemName(i, t), amount: fmt.money(i.amountMinor), date: fmt.date(i.date) })}
            />
          ))}
          <p className="field__hint">{t('balance.overdueHint')}</p>
        </fieldset>
      )}
      <IssueList issues={otherIssues(issues, ['anchor.amountMinor', 'date'])} />
    </Dialog>
  )
}

export function AllocateDialog({ goal, mode, onClose, initialAmountMinor }: { goal: Goal; mode: 'add' | 'release'; onClose: () => void; initialAmountMinor?: number }) {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const [amountText, setAmountText] = useState(() => (initialAmountMinor ? fmt.moneyInput(initialAmountMinor) : ''))
  const [allocationId] = useState(newId)
  const [issues, setIssues] = useState<Issue[]>([])
  const [amountError, setAmountError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const progress = goalProgress(goal)
  const max = mode === 'release' ? progress.savedMinor : goal.fundedFrom === 'budget' ? maxBudgetAllocation(data, goal, today) : progress.remainingMinor

  const submit = async () => {
    const parsed = parseMoneyText(amountText, fmt)
    setAmountError(moneyErrorMessage(t, parsed))
    if (!parsed.ok || busy) return
    setBusy(true)
    const amountMinor = mode === 'release' ? -parsed.minor : parsed.minor
    const { result, saved } = await run((d, c) => allocateToGoal(d, { goalId: goal.id, amountMinor, allocationId }, c))
    setBusy(false)
    if (!result.ok) {
      setIssues(result.issues)
      return
    }
    toast({ message: saved ? t(mode === 'add' ? 'goals.allocated' : 'goals.released', { amount: fmt.money(parsed.minor), name: goal.name }) : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(mode === 'add' ? 'goals.addTitle' : 'goals.releaseTitle', { name: goal.name })}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || max <= 0}>
            {t(mode === 'add' ? 'goals.add' : 'goals.release')}
          </button>
        </>
      }
    >
      <p className="note">{t('goals.virtualNote')}</p>
      {max <= 0 ? (
        <Alert tone="warning" title={t(mode === 'add' ? 'goals.nothingToAdd' : 'goals.nothingToRelease')}>
          {mode === 'add' && goal.fundedFrom === 'budget' ? t('goals.nothingToAddHint') : null}
        </Alert>
      ) : (
        <MoneyField
          label={t('fields.amount')}
          hint={t(mode === 'add' ? (goal.fundedFrom === 'budget' ? 'goals.maxAddBudget' : 'goals.maxAddExternal') : 'goals.maxRelease', { amount: fmt.money(max) })}
          value={amountText}
          onChange={setAmountText}
          error={amountError ?? fieldError(t, fmt, issues, 'amountMinor')}
          fmt={fmt}
          autoFocus
        />
      )}
      <IssueList issues={otherIssues(issues, ['amountMinor'])} />
    </Dialog>
  )
}

/** Botones para elegir horizonte cuando no hay próximo ingreso. */
export function HorizonPicker() {
  const { t } = useT()
  const run = useRun()
  const toast = useToast()
  return (
    <div className="stack-sm">
      <p>{t('horizon.question')}</p>
      <div className="button-row">
        {HORIZON_OPTIONS.map((days) => (
          <button
            key={days}
            type="button"
            className="btn btn--secondary"
            onClick={async () => {
              const { saved } = await run((d, c) => updateSettings(d, { fallbackHorizonDays: days }, c))
              toast({ message: saved ? t('horizon.set', { days }) : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
            }}
          >
            {t('horizon.option', { days })}
          </button>
        ))}
        <a className="btn btn--primary" href={href('/plan/programado/nuevo?kind=income')}>
          {t('horizon.addIncome')}
        </a>
      </div>
    </div>
  )
}
