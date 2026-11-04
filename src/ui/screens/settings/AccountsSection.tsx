import { useState } from 'react'
import { accountBalance, activeAccounts, netPosition, sortedAccounts } from '../../../domain/balances'
import { newId } from '../../../domain/ids'
import { deleteAccount, reorderAccounts, saveAccount, setAccountArchived, type AccountDraft } from '../../../domain/operations'
import type { Account, AccountKind } from '../../../domain/types'
import { ACCOUNT_KINDS, type Issue } from '../../../domain/validation'
import { useT, type MessageKey } from '../../../i18n'
import { useRun, useToday } from '../../../state/hooks'
import { useData } from '../../../state/store'
import { CardFields, CardSummaryView } from '../../cardUi'
import { parseCardFields, useCardFields, type CardErrors } from '../../cardFields'
import { Alert, Badge, Card, Explain } from '../../components/common'
import { ConfirmDialog, Dialog } from '../../components/Dialog'
import { CheckboxField, MoneyField, SelectField, TextField } from '../../components/fields'
import { Icon, type IconName } from '../../components/Icon'
import { useToast } from '../../components/toastContext'
import { UpdateBalanceDialog } from '../../dialogs'
import { useFormat } from '../../format'
import { fieldError, issueMessage } from '../../labels'
import { moneyErrorMessage, parseMoneyText } from '../../moneyText'
import { href, withQuery } from '../../router'

const KIND_ICON: Record<AccountKind, IconName> = { bank: 'bank', cash: 'coins', savings: 'piggy', credit: 'creditCard', wallet: 'phone', prepaid: 'tag', investment: 'trend', other: 'wallet' }

/**
 * Ajustes › Cuentas (etapa 1 del programa): patrimonio neto explicado, lista ordenable con saldo,
 * tipo, última actividad y si cuenta para el presupuesto; archivar conservando el historial y
 * restaurar. Las cifras salen de `netPosition`/`accountBalance`, las mismas de Inicio.
 */
export function AccountsSection() {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const run = useRun()
  const toast = useToast()
  const [accountDialog, setAccountDialog] = useState<Account | 'new' | null>(null)
  const [balanceFor, setBalanceFor] = useState<string | null>(null)
  const [archiving, setArchiving] = useState<Account | null>(null)
  const [archiveIssue, setArchiveIssue] = useState<Issue | null>(null)

  const net = netPosition(data)
  const balanceOf = new Map(net.accounts.map((b) => [b.account.id, b]))
  const ordered = sortedAccounts(data.accounts)
  const active = activeAccounts(data.accounts)
  const archived = ordered.filter((a) => a.archived)

  const lastMovement = (id: string) =>
    data.transactions.reduce<string | null>((max, tx) => (tx.status === 'realized' && (tx.accountId === id || tx.toAccountId === id) && (!max || tx.date > max) ? tx.date : max), null)

  const move = async (id: string, delta: -1 | 1) => {
    const ids = active.map((a) => a.id)
    const i = ids.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    const { result, saved } = await run((d, c) => reorderAccounts(d, [...ids, ...archived.map((a) => a.id)], c))
    if (!result.ok || !saved) toast({ message: t('save.error.generic'), tone: 'critical' })
  }

  const setArchived = async (account: Account, value: boolean) => {
    const { result, saved } = await run((d, c) => setAccountArchived(d, account.id, value, c))
    if (!result.ok) {
      setArchiveIssue(result.issues[0] ?? null)
      return
    }
    setArchiving(null)
    toast({ message: saved ? t(value ? 'settings.accounts.archived' : 'settings.accounts.unarchived') : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
  }

  const balanceText = (a: Account, balanceMinor: number) =>
    a.kind === 'credit'
      ? balanceMinor <= 0
        ? t('settings.accounts.debt', { amount: fmt.money(-balanceMinor) })
        : t('settings.accounts.creditInFavor', { amount: fmt.money(balanceMinor) })
      : fmt.money(balanceMinor)

  const row = (a: Account, index: number, list: Account[]) => {
    const b = balanceOf.get(a.id) ?? accountBalance(data, a)
    const last = lastMovement(a.id)
    return (
      <li key={a.id} className={`item item--stacked account-row${a.archived ? ' account-row--archived' : ''}`} data-testid={`account-${a.id}`} data-account-name={a.name}>
        <div className="item__row">
          <span className="account-row__icon" aria-hidden="true">
            <Icon name={KIND_ICON[a.kind]} size={18} />
          </span>
          <div className="item__main">
            <p className="item__title">{a.name}</p>
            <p className="item__meta">
              {t(`accountKind.${a.kind}` as MessageKey)}
              {a.institution ? ` · ${a.institution}` : ''} · {t('settings.accounts.updated', { when: fmt.timestamp(a.anchor.setAt) })}
            </p>
            <p className="item__meta">{last ? t('settings.accounts.lastMovement', { when: fmt.date(last) }) : t('settings.accounts.noMovements')}</p>
            <p className="item__badges">
              {a.archived ? (
                <Badge tone="neutral" icon="lock">
                  {t('settings.accounts.archivedBadge')}
                </Badge>
              ) : (
                <Badge tone={a.includeInBudget ? 'info' : 'neutral'}>{t(a.includeInBudget ? 'settings.accounts.included' : 'settings.accounts.excluded')}</Badge>
              )}
            </p>
          </div>
          <div className="item__side account-row__side">
            <p className="item__amount">{balanceText(a, b.balanceMinor)}</p>
            <span className="item__currency">{data.settings.currency}</span>
          </div>
        </div>
        {a.kind === 'credit' && !a.archived && <CardSummaryView account={a} fmt={fmt} />}
        <div className="item__actions">
          {!a.archived && (
            <>
              <button type="button" className="btn btn--small btn--secondary" onClick={() => setBalanceFor(a.id)}>
                {t('home.updateBalance')}
                <span className="sr-only">: {a.name}</span>
              </button>
              <button type="button" className="btn btn--small btn--ghost" onClick={() => setAccountDialog(a)}>
                <Icon name="edit" size={16} />
                {t('common.edit')}
                <span className="sr-only">: {a.name}</span>
              </button>
              <button type="button" className="btn btn--small btn--ghost" aria-label={`${t('settings.accounts.archive')}: ${a.name}`} onClick={() => { setArchiveIssue(null); setArchiving(a) }}>
                <Icon name="lock" size={16} />
                {t('settings.accounts.archive')}
              </button>
              {list.length > 1 && (
                <span className="account-row__order">
                  <button type="button" className="btn btn--small btn--ghost" disabled={index === 0} onClick={() => void move(a.id, -1)} aria-label={`${t('settings.accounts.moveUp')}: ${a.name}`}>
                    <Icon name="up" size={16} />
                  </button>
                  <button type="button" className="btn btn--small btn--ghost" disabled={index === list.length - 1} onClick={() => void move(a.id, 1)} aria-label={`${t('settings.accounts.moveDown')}: ${a.name}`}>
                    <Icon name="down" size={16} />
                  </button>
                </span>
              )}
            </>
          )}
          {a.archived && (
            <button type="button" className="btn btn--small btn--secondary" aria-label={`${t('settings.accounts.unarchive')}: ${a.name}`} onClick={() => void setArchived(a, false)}>
              <Icon name="undo" size={16} />
              {t('settings.accounts.unarchive')}
            </button>
          )}
          <a className="btn btn--small btn--ghost" aria-label={`${t('settings.accounts.history')}: ${a.name}`} href={href(withQuery('/movimientos', { cuenta: a.id }))}>
            <Icon name="list" size={16} />
            {t('settings.accounts.history')}
          </a>
        </div>
      </li>
    )
  }

  return (
    <Card labelledBy="accounts-title">
      <h2 id="cuentas" className="card__title">
        <span id="accounts-title">{t('settings.accounts.title')}</span>
      </h2>
      <section className="net-position" aria-labelledby="net-title" data-testid="net-position">
        <h3 id="net-title" className="net-position__title">
          {t('settings.accounts.netTitle')}
        </h3>
        <p className="net-position__value" data-testid="net-worth">
          {fmt.money(net.netMinor)}
        </p>
        <dl className="net-position__parts">
          <div>
            <dt>{t('settings.accounts.netAssets')}</dt>
            <dd data-testid="net-assets">{fmt.money(net.assetsMinor)}</dd>
          </div>
          <div>
            <dt>{t('settings.accounts.netLiabilities')}</dt>
            <dd data-testid="net-liabilities">{net.liabilitiesMinor > 0 ? `−${fmt.money(net.liabilitiesMinor)}` : fmt.money(0)}</dd>
          </div>
          <div>
            <dt>{t('settings.accounts.netBudget')}</dt>
            <dd data-testid="net-budget">{fmt.money(net.budgetMinor)}</dd>
          </div>
          {net.archivedMinor !== 0 && (
            <div>
              <dt>{t('settings.accounts.netArchived')}</dt>
              <dd data-testid="net-archived">{fmt.money(net.archivedMinor)}</dd>
            </div>
          )}
        </dl>
        <Explain>
          <p>{t('settings.accounts.netExplain')}</p>
        </Explain>
      </section>
      <p className="note">{t('settings.accounts.orderHint')}</p>
      <ul className="item-list" data-testid="accounts-active">
        {active.map((a, i) => row(a, i, active))}
      </ul>
      <button type="button" className="btn btn--secondary" onClick={() => setAccountDialog('new')}>
        <Icon name="plus" />
        {t('settings.accounts.add')}
      </button>
      {archived.length > 0 && (
        <details className="explain" data-testid="archived-accounts">
          <summary>
            <Icon name="lock" size={16} />
            {t('settings.accounts.archivedTitle')} · {archived.length}
          </summary>
          <p className="note">{t('settings.accounts.archivedHint')}</p>
          <ul className="item-list">{archived.map((a, i) => row(a, i, archived))}</ul>
        </details>
      )}
      <Alert tone="neutral" icon="lock" title={t('settings.accounts.cardsTitle')}>
        {t('settings.accounts.cardsText')}
      </Alert>
      {accountDialog && <AccountDialog account={accountDialog === 'new' ? null : accountDialog} onClose={() => setAccountDialog(null)} />}
      {balanceFor && <UpdateBalanceDialog initialAccountId={balanceFor} onClose={() => setBalanceFor(null)} />}
      {archiving && (
        <ConfirmDialog
          open
          title={t('settings.accounts.archiveTitle', { name: archiving.name })}
          confirmLabel={t('settings.accounts.archive')}
          onConfirm={() => void setArchived(archiving, true)}
          onCancel={() => setArchiving(null)}
        >
          <p>{t('settings.accounts.archiveText')}</p>
          {(balanceOf.get(archiving.id)?.balanceMinor ?? 0) !== 0 && (
            <Alert tone="warning" icon="alert" title={t('settings.accounts.archiveBalance', { amount: fmt.money(balanceOf.get(archiving.id)!.balanceMinor) })} />
          )}
          {archiveIssue && <Alert tone="critical" title={issueMessage(t, fmt, archiveIssue)} role="alert" />}
        </ConfirmDialog>
      )}
    </Card>
  )
}

function AccountDialog({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const { t } = useT()
  const fmt = useFormat()
  const run = useRun()
  const toast = useToast()
  const today = useToday()
  const [id] = useState(() => account?.id ?? newId())
  const [name, setName] = useState(account?.name ?? '')
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? 'bank')
  const [include, setInclude] = useState(account?.includeInBudget ?? true)
  const [institution, setInstitution] = useState(account?.institution ?? '')
  const [balanceText, setBalanceText] = useState('')
  const [issues, setIssues] = useState<Issue[]>([])
  const [amountError, setAmountError] = useState<string | null>(null)
  const [cardText, setCardText] = useCardFields(account?.card, fmt)
  const [cardErrors, setCardErrors] = useState<CardErrors>({})

  const submit = async () => {
    let card: AccountDraft['card']
    if (kind === 'credit') {
      const parsed = parseCardFields(cardText, fmt, t)
      setCardErrors(parsed.errors)
      if (!parsed.card) return
      card = parsed.card
    }
    let openingBalanceMinor: number | undefined
    if (!account) {
      const parsed = parseMoneyText(balanceText || '0', fmt, { allowNegative: true, allowZero: true })
      setAmountError(moneyErrorMessage(t, parsed))
      if (!parsed.ok) return
      // En una tarjeta se escribe lo que se debe; se guarda como saldo negativo.
      openingBalanceMinor = kind === 'credit' ? (parsed.minor === 0 ? 0 : -parsed.minor) : parsed.minor
    }
    const draft: AccountDraft = { id, name, kind, includeInBudget: include, institution, openingBalanceMinor, openingDate: today, card }
    const { result, saved } = await run((d, c) => saveAccount(d, draft, c))
    if (!result.ok) {
      setIssues(result.issues)
      return
    }
    toast({ message: saved ? t('settings.accounts.saved') : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
    onClose()
  }

  const remove = async () => {
    if (!account) return
    const { result, saved } = await run((d, c) => deleteAccount(d, account.id, c))
    if (!result.ok) {
      setIssues(result.issues)
      return
    }
    toast({ message: saved ? t('settings.accounts.deleted') : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
    onClose()
  }

  const generalIssue = issues.find((i) => i.path === 'id' || i.path === 'includeInBudget' || i.path === 'kind')
  return (
    <Dialog
      open
      onClose={onClose}
      title={account ? t('settings.accounts.editTitle') : t('settings.accounts.newTitle')}
      onSubmit={() => void submit()}
      footer={
        <>
          {account && (
            <button type="button" className="btn btn--danger-ghost" onClick={() => void remove()}>
              {t('common.delete')}
            </button>
          )}
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary">
            {t('common.save')}
          </button>
        </>
      }
    >
      <TextField label={t('fields.name')} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} error={fieldError(t, fmt, issues, 'name')} required />
      <SelectField label={t('settings.accounts.kind')} value={kind}
        onChange={(e) => {
          const k = e.target.value as AccountKind
          setKind(k)
          // Una inversión nueva no cuenta para «Puedes gastar» salvo que se marque (no es dinero para el día a día).
          if (!account && k === 'investment') setInclude(false)
        }} options={ACCOUNT_KINDS.map((k) => ({ value: k, label: t(`accountKind.${k}` as MessageKey) }))} hint={t('settings.accounts.kindHint')} />
      <TextField label={t('settings.accounts.institution')} name="institution" value={institution} maxLength={40} onChange={(e) => setInstitution(e.target.value)} hint={t('settings.accounts.institutionHint')} error={fieldError(t, fmt, issues, 'institution')} />
      <CheckboxField
        checked={include}
        onChange={setInclude}
        label={t('settings.accounts.includeLabel')}
        hint={kind === 'credit' ? t('settings.accounts.creditIncludeHint') : t('settings.accounts.includeHint')}
      />
      {!account && (
        <MoneyField
          label={kind === 'credit' ? t('settings.accounts.debtLabel') : t('settings.accounts.openingBalance')}
          hint={kind === 'credit' ? t('settings.accounts.debtHint') : t('settings.accounts.openingHint')}
          value={balanceText}
          onChange={setBalanceText}
          error={amountError}
          fmt={fmt}
        />
      )}
      {kind === 'credit' && <CardFields value={cardText} onChange={setCardText} errors={cardErrors} fmt={fmt} />}
      {generalIssue && <Alert tone="critical" title={issueMessage(t, fmt, generalIssue)} role="alert" />}
    </Dialog>
  )
}
