/**
 * Verificar saldo (conciliación): compara el saldo calculado de una cuenta con el
 * que la persona ve en su banco o en efectivo, en la misma fecha.
 */
import { activeAccounts, isBudgetAccount } from '../../domain/balances'
import { useState } from 'react'
import { newId } from '../../domain/ids'
import { reconcileAccount, type ReconcileInput } from '../../domain/operations'
import { balanceAtDate, nearbyTransactions, NEARBY_DAYS, reconciliationsFor, reconciliationState } from '../../domain/reconcile'
import type { Account, Reconciliation } from '../../domain/types'
import type { Issue } from '../../domain/validation'
import { useT, type MessageKey } from '../../i18n'
import { useRun, useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { Alert, Badge, CalcRow, Card, Explain, PageHeader } from '../components/common'
import { Dialog } from '../components/Dialog'
import { MoneyField, SelectField, TextField } from '../components/fields'
import { Icon } from '../components/Icon'
import { useToast } from '../components/toastContext'
import { useFormat, type Formatter } from '../format'
import { accountOptions, fieldError, issueMessage, otherIssues, transactionTitle } from '../labels'
import { moneyErrorMessage, parseMoneyText } from '../moneyText'
import { href, withQuery, type Route } from '../router'

/** En tarjetas se muestra la deuda en positivo (el saldo interno es negativo). */
function balanceText(t: ReturnType<typeof useT>['t'], fmt: Formatter, account: Account, minor: number): string {
  if (account.kind !== 'credit') return fmt.money(minor)
  return minor <= 0 ? t('settings.accounts.debt', { amount: fmt.money(-minor) }) : t('settings.accounts.creditInFavor', { amount: fmt.money(minor) })
}

export function Reconcile({ route }: { route: Route }) {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()

  const queryAccount = route.query.get('cuenta')
  const [accountId, setAccountId] = useState(
    queryAccount && data.accounts.some((a) => a.id === queryAccount) ? queryAccount : (activeAccounts(data.accounts).find(isBudgetAccount) ?? activeAccounts(data.accounts)[0] ?? data.accounts[0]!).id,
  )
  const account = data.accounts.find((a) => a.id === accountId)!
  const isCredit = account.kind === 'credit'
  const [date, setDate] = useState(today)
  const [observedText, setObservedText] = useState('')
  const [observedError, setObservedError] = useState<string | null>(null)
  const [compared, setCompared] = useState<{ date: string; observedMinor: number } | null>(null)
  const [recId, setRecId] = useState(newId)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [issues, setIssues] = useState<Issue[]>([])
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setCompared(null)
    setIssues([])
    setRecId(newId())
  }

  const compare = () => {
    const parsed = parseMoneyText(observedText, fmt, { allowNegative: true, allowZero: true })
    setObservedError(moneyErrorMessage(t, parsed))
    if (!parsed.ok) return
    const observedMinor = isCredit ? (parsed.minor === 0 ? 0 : -parsed.minor) : parsed.minor
    setIssues([])
    setCompared({ date, observedMinor })
  }

  const computed = compared ? balanceAtDate(data, account, compared.date) : null
  const difference = compared && computed !== null ? compared.observedMinor - computed : null

  const save = async (resolution: ReconcileInput['resolution'], extra: Partial<ReconcileInput> = {}) => {
    if (!compared || busy) return false
    setBusy(true)
    const { result, saved } = await run((d, c) =>
      reconcileAccount(d, { id: recId, accountId, date: compared.date, observedMinor: compared.observedMinor, resolution, ...extra }, c),
    )
    setBusy(false)
    if (!result.ok) {
      setIssues(result.issues)
      return false
    }
    const r = result.value.reconciliation.resolution
    toast({
      message: saved ? t(r === 'matched' ? 'reconcile.savedMatch' : r === 'adjusted' ? 'reconcile.savedAdjusted' : 'reconcile.savedUnresolved') : t('save.error.generic'),
      tone: saved ? 'good' : 'critical',
    })
    setObservedText('')
    reset()
    return true
  }

  const recheck = (rec: Reconciliation) => {
    setDate(rec.date)
    setObservedText(fmt.moneyInput(isCredit ? -rec.observedMinor : rec.observedMinor))
    reset()
  }

  const selfLink = withQuery('/conciliar', { cuenta: accountId })
  const nearby = compared ? nearbyTransactions(data, accountId, compared.date) : []
  const history = reconciliationsFor(data, accountId)
  const unknown = otherIssues(issues, ['date', 'observedMinor'])

  return (
    <div className="stack">
      <PageHeader title={t('reconcile.title')} back={{ href: href('/'), label: t('nav.home') }} />
      <p className="note">{t('reconcile.intro')}</p>

      <Card>
        <form
          className="form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            compare()
          }}
        >
          {data.accounts.length > 1 && (
            <SelectField
              label={t('fields.account')}
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value)
                reset()
              }}
              options={accountOptions(data.accounts, t, accountId)}
            />
          )}
          <TextField
            label={t('reconcile.date')}
            type="date"
            value={date}
            min={account.anchor.date}
            max={today}
            onChange={(e) => {
              setDate(e.target.value)
              setCompared(null)
            }}
            hint={t('reconcile.dateHint', { date: fmt.date(account.anchor.date) })}
            error={fieldError(t, fmt, issues, 'date')}
            required
          />
          <MoneyField
            label={isCredit ? t('reconcile.observedDebt') : t('reconcile.observed')}
            hint={isCredit ? t('reconcile.observedDebtHint') : t('reconcile.observedHint')}
            value={observedText}
            onChange={(v) => {
              setObservedText(v)
              setCompared(null)
            }}
            error={observedError ?? fieldError(t, fmt, issues, 'observedMinor')}
            fmt={fmt}
          />
          <Explain summary={t('reconcile.whichTitle')}>
            <p>{t('reconcile.whichText')}</p>
          </Explain>
          {isCredit && <p className="note">{t('reconcile.cardText')}</p>}
          <div className="form__actions">
            <button type="submit" className="btn btn--primary">
              <Icon name="scale" />
              {t('reconcile.compare')}
            </button>
          </div>
        </form>
      </Card>

      {compared && computed === null && <Alert tone="critical" role="alert" title={t('issue.beforeAnchor', { date: fmt.date(account.anchor.date) })} />}

      {compared && computed !== null && difference !== null && (
        <Card labelledBy="rec-result">
          <h2 id="rec-result" className="card__title">
            {fmt.date(compared.date)} · {account.name}
          </h2>
          <div className="calc" data-testid="reconcile-result">
            <CalcRow label={t('reconcile.observedRow')} value={balanceText(t, fmt, account, compared.observedMinor)} />
            <CalcRow op="−" label={t('reconcile.computed')} value={balanceText(t, fmt, account, computed)} />
            <CalcRow op="=" label={t('reconcile.difference')} value={fmt.money(difference, { sign: true })} strong />
            <p className="calc__detail">{t('reconcile.computedHint', { anchorDate: fmt.date(account.anchor.date), date: fmt.date(compared.date) })}</p>
          </div>

          {difference === 0 ? (
            <>
              <Alert tone="good" title={t('reconcile.matchTitle')}>
                {t('reconcile.matchText')}
              </Alert>
              <div className="form__actions">
                <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void save('matched')}>
                  <Icon name="check" />
                  {t('reconcile.saveMatch')}
                </button>
              </div>
            </>
          ) : (
            <>
              <Alert tone="warning" title={t('reconcile.diffTitle', { amount: fmt.money(Math.abs(difference)) })} role="status">
                {t(difference > 0 ? 'reconcile.diffMore' : 'reconcile.diffLess', { amount: fmt.money(Math.abs(difference)) })}
              </Alert>
              <h3 className="section-title">{t('reconcile.nearbyTitle', { days: NEARBY_DAYS })}</h3>
              {nearby.length === 0 ? (
                <p className="note">{t('reconcile.nearbyEmpty')}</p>
              ) : (
                <ul className="item-list">
                  {nearby.map((tx) => (
                    <li key={tx.id}>
                      <a className="item item--link" href={href(withQuery(`/movimientos/editar/${tx.id}`, { returnTo: selfLink }))}>
                        <span className="item__main">
                          <span className="item__title">{transactionTitle(tx, data.accounts, t)}</span>
                          <span className="item__meta">
                            {fmt.date(tx.date, { compact: true, today })} · {t(`txKind.${tx.kind}` as MessageKey)}
                          </span>
                        </span>
                        <span className="item__amount">{fmt.money(tx.amountMinor)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <div className="button-row">
                <a className="btn btn--secondary" href={href(withQuery('/movimientos/nuevo', { account: accountId, date: compared.date, returnTo: selfLink }))}>
                  <Icon name="plus" />
                  {t('reconcile.addMissing')}
                </a>
                <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void save('unresolved')}>
                  {t('reconcile.saveUnresolved')}
                </button>
                <button type="button" className="btn btn--primary" onClick={() => setAdjustOpen(true)}>
                  <Icon name="sliders" />
                  {t('reconcile.createAdjustment')}
                </button>
              </div>
            </>
          )}
          {unknown.length > 0 && (
            <Alert tone="critical" title={t('common.fixErrors')} role="alert">
              <ul>
                {unknown.map((i, idx) => (
                  <li key={idx}>{issueMessage(t, fmt, i)}</li>
                ))}
              </ul>
            </Alert>
          )}
        </Card>
      )}

      <Card labelledBy="rec-history">
        <h2 id="rec-history" className="card__title">
          {t('reconcile.history')}
        </h2>
        {history.length === 0 ? (
          <p className="note">{t('reconcile.historyEmpty')}</p>
        ) : (
          <ul className="item-list">
            {history.map((rec) => {
              const state = reconciliationState(data, rec)
              return (
                <li key={rec.id} className="item item--stacked">
                  <div className="item__main">
                    <p className="item__title">{fmt.date(rec.date)}</p>
                    <p className="item__meta">
                      {t('reconcile.historyRow', {
                        observed: balanceText(t, fmt, account, rec.observedMinor),
                        computed: balanceText(t, fmt, account, rec.computedMinor),
                        difference: fmt.money(rec.differenceMinor, { sign: true }),
                      })}
                    </p>
                    {rec.reason && <p className="item__meta">{t('reconcile.reasonShown', { reason: rec.reason })}</p>}
                    <p className="item__badges">
                      <Badge tone={rec.resolution === 'unresolved' ? 'warning' : 'good'} icon={rec.resolution === 'unresolved' ? 'alert' : 'checkCircle'}>
                        {t(`reconcile.resolution.${rec.resolution}` as MessageKey)}
                      </Badge>
                      {state === 'needsReview' && (
                        <Badge tone="warning" icon="alert">
                          {t('reconcile.state.needsReview')}
                        </Badge>
                      )}
                      {state === 'superseded' && <Badge icon="info">{t('reconcile.state.superseded')}</Badge>}
                    </p>
                  </div>
                  <div className="item__actions">
                    {rec.adjustmentTxId && data.transactions.some((x) => x.id === rec.adjustmentTxId) && (
                      <a className="btn btn--small btn--ghost" href={href(withQuery(`/movimientos/editar/${rec.adjustmentTxId}`, { returnTo: selfLink }))}>
                        {t('reconcile.seeAdjustment')}
                      </a>
                    )}
                    {(state === 'needsReview' || rec.resolution === 'unresolved') && (
                      <button type="button" className="btn btn--small btn--secondary" onClick={() => recheck(rec)}>
                        {t('reconcile.recheck')}
                        <span className="sr-only">: {fmt.date(rec.date)}</span>
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {adjustOpen && compared && difference !== null && difference !== 0 && (
        <AdjustDialog
          amount={fmt.money(Math.abs(difference))}
          account={account.name}
          date={fmt.date(compared.date)}
          onCancel={() => setAdjustOpen(false)}
          onConfirm={async (reason, adjustmentTxId) => {
            const done = await save('adjusted', { reason, adjustmentTxId })
            if (done) setAdjustOpen(false)
            return done
          }}
          issues={issues}
        />
      )}
    </div>
  )
}

function AdjustDialog({
  amount,
  account,
  date,
  onCancel,
  onConfirm,
  issues,
}: {
  amount: string
  account: string
  date: string
  onCancel: () => void
  onConfirm: (reason: string, adjustmentTxId: string) => Promise<boolean>
  issues: Issue[]
}) {
  const { t } = useT()
  const fmt = useFormat()
  const [reason, setReason] = useState('')
  // Id del ajuste fijado al abrir: confirmar dos veces no crea dos ajustes.
  const [adjustmentTxId] = useState(newId)
  return (
    <Dialog
      open
      onClose={onCancel}
      title={t('reconcile.adjustTitle', { amount })}
      onSubmit={() => void onConfirm(reason, adjustmentTxId)}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary">
            {t('reconcile.createAdjustment')}
          </button>
        </>
      }
    >
      <p>{t('reconcile.adjustText', { account, date })}</p>
      <TextField
        label={t('reconcile.reason')}
        hint={t('reconcile.reasonHint')}
        value={reason}
        maxLength={200}
        onChange={(e) => setReason(e.target.value)}
        error={fieldError(t, fmt, issues, 'reason')}
        required
        autoFocus
      />
    </Dialog>
  )
}
