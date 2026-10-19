/**
 * Bandeja de pendientes. Los avisos se calculan en `domain/inbox.ts`; aquí solo se
 * muestran con su motivo, un acceso para resolverlos y, cuando tiene sentido, posponer
 * o descartar (eso nunca cambia cifras).
 */
import { useMemo, useState } from 'react'
import { addDays } from '../../domain/dates'
import { dismissInboxItem, INBOX_KINDS, inboxView, snoozeInboxItem, undismissInboxItem, unsnoozeInboxItem, type InboxItem } from '../../domain/inbox'
import { setOccurrenceSkipped } from '../../domain/operations'
import { settlePlannedExpenseFromCalendar } from '../../domain/plannedExpenses'
import type { PlanItem } from '../../domain/planItems'
import { useT, type MessageKey } from '../../i18n'
import { useRun, useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { Badge, Card, EmptyState, PageHeader } from '../components/common'
import { Icon, type IconName } from '../components/Icon'
import { useToast } from '../components/toastContext'
import { MarkPaidDialog } from '../dialogs'
import { useFormat } from '../format'
import { accountName, categoryLabel, frequencyLabel, planItemName, planTitle, transactionTitle } from '../labels'
import { href, withQuery } from '../router'

const KIND_ICON: Record<InboxItem['kind'], IconName> = {
  overdue: 'clock',
  balance: 'scale',
  attention: 'alert',
  duplicate: 'list',
  uncategorized: 'star',
  integrity: 'shield',
  suggestion: 'repeat',
}

const SNOOZE_DAYS = 7
const PAGE = 20

export function Inbox() {
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const view = useMemo(() => inboxView(data, today), [data, today])
  const [payItem, setPayItem] = useState<PlanItem | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const snooze = async (item: InboxItem) => {
    const until = addDays(today, SNOOZE_DAYS)
    const { saved } = await run((d, c) => snoozeInboxItem(d, item.id, until, c))
    toast({
      message: saved ? tn('inbox.snoozedToast', SNOOZE_DAYS) : t('save.error.generic'),
      tone: saved ? 'good' : 'critical',
      action: { label: t('common.undo'), onClick: () => void run((d, c) => unsnoozeInboxItem(d, item.id, c)) },
    })
  }
  const dismiss = async (item: InboxItem) => {
    const { saved } = await run((d, c) => dismissInboxItem(d, item, c))
    toast({
      message: saved ? t('inbox.dismissedToast') : t('save.error.generic'),
      tone: saved ? 'good' : 'critical',
      action: { label: t('common.undo'), onClick: () => void run((d, c) => undismissInboxItem(d, item.id, c)) },
    })
  }

  const groups = INBOX_KINDS.map((kind) => ({ kind, items: view.active.filter((i) => i.kind === kind) })).filter((g) => g.items.length > 0)

  return (
    <div className="stack">
      <PageHeader title={t('inbox.title')} back={{ href: href('/'), label: t('nav.home') }} />
      <p className="lead">{t('inbox.intro')}</p>
      <p className="summary-line" aria-live="polite" data-testid="inbox-count">
        {tn('inbox.count', view.active.length)}
      </p>
      {view.active.length === 0 && (
        <EmptyState icon="checkCircle" title={t('inbox.empty')} text={t('inbox.emptyText')} />
      )}
      {groups.map((g) => {
        const shown = expanded[g.kind] ? g.items : g.items.slice(0, PAGE)
        return (
          <section key={g.kind} className="stack-sm" aria-labelledby={`inbox-${g.kind}`}>
            <h2 id={`inbox-${g.kind}`} className="section-title">
              <Icon name={KIND_ICON[g.kind]} size={18} /> {t(`inbox.kind.${g.kind}` as MessageKey)} ({g.items.length})
            </h2>
            <ul className="item-list">
              {shown.map((item) => (
                <li key={item.id}>
                  <InboxCard item={item} onPay={setPayItem} onSnooze={() => void snooze(item)} onDismiss={() => void dismiss(item)} />
                </li>
              ))}
            </ul>
            {g.items.length > shown.length && (
              <button type="button" className="btn btn--secondary" onClick={() => setExpanded((e) => ({ ...e, [g.kind]: true }))}>
                {t('movements.showMore', { count: g.items.length - shown.length })}
              </button>
            )}
          </section>
        )
      })}

      {view.snoozed.length > 0 && (
        <details className="explain">
          <summary>
            <Icon name="clock" size={16} />
            {tn('inbox.snoozedList', view.snoozed.length)}
          </summary>
          <ul className="item-list explain__body">
            {view.snoozed.map((item) => (
              <li key={item.id} className="item item--stacked">
                <ItemText item={item} />
                <p className="item__meta">{t('inbox.snoozedUntil', { date: fmt.date(item.until) })}</p>
                <button type="button" className="btn btn--ghost btn--small" onClick={() => void run((d, c) => unsnoozeInboxItem(d, item.id, c))}>
                  {t('inbox.showNow')}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {view.dismissed.length > 0 && (
        <details className="explain">
          <summary>
            <Icon name="check" size={16} />
            {tn('inbox.dismissedList', view.dismissed.length)}
          </summary>
          <ul className="item-list explain__body">
            {view.dismissed.map((item) => (
              <li key={item.id} className="item item--stacked">
                <ItemText item={item} />
                <button type="button" className="btn btn--ghost btn--small" onClick={() => void run((d, c) => undismissInboxItem(d, item.id, c))}>
                  {t('inbox.restore')}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="note">{t('inbox.rulesNote')}</p>
      {payItem && <MarkPaidDialog key={payItem.key} item={payItem} onClose={() => setPayItem(null)} />}
    </div>
  )
}

/** Título y explicación de un aviso (qué y por qué), con fecha e importe si corresponde. */
function ItemText({ item }: { item: InboxItem }) {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const tx = item.txIds?.[0] ? data.transactions.find((x) => x.id === item.txIds![0]) : undefined
  const other = item.txIds?.[1] ? data.transactions.find((x) => x.id === item.txIds![1]) : undefined
  const goal = item.goalId ? data.goals.find((g) => g.id === item.goalId) : undefined
  const rule = item.ruleId ? data.categoryRules.find((r) => r.id === item.ruleId) : undefined
  const plan = item.planId ? data.plans.find((p) => p.id === item.planId) : undefined
  const name =
    item.label
      ? item.label
      : item.planItem
      ? planItemName(item.planItem, t)
      : plan
        ? planTitle(t, plan)
      : rule
        ? rule.pattern
        : item.categoryId
          ? categoryLabel(t, item.categoryId)
          : item.accountId && item.kind !== 'duplicate'
        ? accountName(data.accounts, item.accountId, t)
        : goal
          ? goal.name
          : tx
            ? transactionTitle(tx, data.accounts, t)
            : t('inbox.deletedIncome')
  const params = {
    name,
    date: item.date ? fmt.date(item.date, { compact: true, today }) : '',
    amount: item.amountMinor !== undefined ? fmt.money(item.amountMinor) : '',
    other: other ? fmt.date(other.date, { compact: true, today }) : '',
    category: categoryLabel(t, item.categoryId),
    lastMovement: item.lastMovementDate ? fmt.date(item.lastMovementDate, { compact: true, today }) : t('inbox.none'),
    verified: item.verifiedDate ? fmt.date(item.verifiedDate, { compact: true, today }) : t('inbox.never'),
    count: item.count ?? 0,
    frequency: item.frequency ? frequencyLabel(t, item.frequency) : '',
  }
  return (
    <span className="item__main">
      <span className="item__title">{t(`inbox.title.${item.reason}` as MessageKey, params)}</span>
      <span className="item__meta">{t(`inbox.why.${item.reason}` as MessageKey, params)}</span>
      {(item.date || item.amountMinor !== undefined) && (
        <span className="item__badges">
          {item.date && <Badge icon="calendar">{params.date}</Badge>}
          {item.amountMinor !== undefined && <Badge>{params.amount}</Badge>}
        </span>
      )}
    </span>
  )
}

function InboxCard({ item, onPay, onSnooze, onDismiss }: { item: InboxItem; onPay: (i: PlanItem) => void; onSnooze: () => void; onDismiss: () => void }) {
  const { t } = useT()
  const run = useRun()
  const toast = useToast()
  const data = useData()
  const tx = item.txIds?.[0]
  const back = '/pendientes'
  return (
    <Card as="article" className="inbox-item">
      <ItemText item={item} />
      <div className="button-row">
        {item.reason === 'otherCategory' && tx && (
          <a className="btn btn--primary btn--small" href={href(withQuery(`/movimientos/editar/${tx}`, { returnTo: back }))}>
            {t('inbox.action.categorize')}
          </a>
        )}
        {item.planItem && (
          <button type="button" className="btn btn--primary btn--small" onClick={() => onPay(item.planItem!)}>
            {t(item.reason === 'overdueIncome' ? 'inbox.action.markReceived' : 'inbox.action.markPaid')}
          </button>
        )}
        {item.planItem?.source === 'schedule' && (
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={async () => {
              const p = item.planItem!
              const { saved } = await run((d, c) => setOccurrenceSkipped(d, p.sourceId, p.date, true, c))
              toast({
                message: saved ? t('calendar.skipped', { name: planItemName(p, t) }) : t('save.error.generic'),
                tone: saved ? 'good' : 'critical',
                action: { label: t('common.undo'), onClick: () => void run((d, c) => setOccurrenceSkipped(d, p.sourceId, p.date, false, c)) },
              })
            }}
          >
            {t('inbox.action.skip')}
          </button>
        )}
        {item.kind === 'duplicate' &&
          item.txIds!.map((id, i) => (
            <a key={id} className="btn btn--secondary btn--small" href={href(withQuery(`/movimientos/editar/${id}`, { returnTo: back }))}>
              {t(i === 0 ? 'inbox.action.seeFirst' : 'inbox.action.seeSecond')}
            </a>
          ))}
        {item.kind === 'balance' && (
          <a className="btn btn--primary btn--small" href={href(withQuery('/conciliar', { cuenta: item.accountId }))}>
            {t('inbox.action.verify')}
          </a>
        )}
        {(item.reason === 'cardNearLimit' || item.reason === 'cardOverLimit') && (
          <a className="btn btn--primary btn--small" href={href('/ajustes?seccion=cuentas')}>
            {t('inbox.action.seeCard')}
          </a>
        )}
        {item.reason === 'planOverLimit' && item.planId && (
          <a className="btn btn--primary btn--small" href={href(`/plan/planes/${item.planId}`)}>
            {t('inbox.action.seePlan')}
          </a>
        )}
        {item.ruleId && (
          <a className="btn btn--primary btn--small" href={href('/ajustes?seccion=reglas')}>
            {t('inbox.action.seeRules')}
          </a>
        )}
        {item.reason === 'goalPastDue' && item.goalId && (
          <a className="btn btn--primary btn--small" href={href(`/plan/metas/editar/${item.goalId}`)}>
            {t('inbox.action.editGoal')}
          </a>
        )}
        {item.reason === 'reserveForSettledBill' && item.goalId && (
          <button
            type="button"
            className="btn btn--primary btn--small"
            onClick={async () => {
              const { result, saved } = await run((d, c) => settlePlannedExpenseFromCalendar(d, item.goalId!, c))
              toast({ message: result.ok && saved ? t('inbox.settledToast') : t('save.error.generic'), tone: result.ok && saved ? 'good' : 'critical' })
            }}
          >
            {t('inbox.action.settle')}
          </button>
        )}
        {item.reason === 'recurringCandidate' && (
          // Clara 2.0 fase 3: abre el formulario ya relleno; programarlo es un paso explícito de la persona.
          <a
            className="btn btn--primary btn--small"
            href={href(
              withQuery('/plan/programado/nuevo', {
                kind: 'expense',
                name: item.label,
                amount: item.amountMinor,
                frequency: item.frequency,
                start: item.date,
                category: item.categoryId,
                account: item.accountId,
              }),
            )}
          >
            {t('inbox.action.schedule')}
          </a>
        )}
        {(item.reason === 'distributionIncomeChanged' || item.reason === 'distributionIncomeMissing') && (
          <a
            className="btn btn--primary btn--small"
            href={href(item.reason === 'distributionIncomeMissing' && data.trash.some((e) => e.id === tx) ? '/movimientos/papelera' : `/movimientos/distribuir/${tx}`)}
          >
            {t('inbox.action.reviewDistribution')}
          </a>
        )}
        <button type="button" className="btn btn--ghost btn--small" onClick={onSnooze}>
          <Icon name="clock" size={16} />
          {t('inbox.action.snooze', { days: SNOOZE_DAYS })}
        </button>
        {item.canDismiss && (
          <button type="button" className="btn btn--ghost btn--small" onClick={onDismiss}>
            <Icon name="check" size={16} />
            {t(item.kind === 'duplicate' ? 'inbox.action.notDuplicate' : item.kind === 'integrity' ? 'inbox.action.reviewed' : item.kind === 'suggestion' ? 'inbox.action.notRecurring' : 'inbox.action.keep')}
          </button>
        )}
      </div>
      {item.kind === 'duplicate' && <p className="note">{t('inbox.duplicateNote')}</p>}
    </Card>
  )
}
