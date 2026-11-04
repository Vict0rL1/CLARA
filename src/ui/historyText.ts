/** Descripción legible de los cambios del historial (pantallas Historial y ¿Qué cambió?). */
import { goalSavedMinor } from '../domain/goals'
import type { Account, AppData, Goal, HistoryChange, HistoryEntry, Schedule, Transaction } from '../domain/types'
import type { useT, MessageKey } from '../i18n'
import type { Formatter } from './format'
import { accountName, categoryLabel, transactionTitle } from './labels'

type T = ReturnType<typeof useT>['t']

/**
 * ¿Sigue existiendo este registro? Con 50.000 movimientos y 1.000 entradas, recorrer la lista
 * en cada línea bloqueaba la pantalla más de un segundo: el conjunto de ids se construye una
 * vez por lista (los datos no se modifican en sitio, así que la lista identifica su contenido).
 */
const idSets = new WeakMap<readonly { id: string }[], Set<string>>()
function hasId(list: readonly { id: string }[], id: string): boolean {
  let ids = idSets.get(list)
  if (!ids) {
    ids = new Set(list.map((x) => x.id))
    idSets.set(list, ids)
  }
  return ids.has(id)
}

export interface Line {
  text: string
  details: string[]
  link?: string
}

function txDetails(a: Transaction, b: Transaction, data: AppData, t: T, fmt: Formatter): string[] {
  const out: string[] = []
  const field = (key: MessageKey, x: string, y: string) => x !== y && out.push(t('history.field', { field: t(key), before: x, after: y }))
  field('fields.amount', fmt.money(a.amountMinor), fmt.money(b.amountMinor))
  field('fields.date', fmt.date(a.date), fmt.date(b.date))
  field('fields.account', accountName(data.accounts, a.accountId, t), accountName(data.accounts, b.accountId, t))
  field('fields.category', categoryLabel(t, a.categoryId) || '—', categoryLabel(t, b.categoryId) || '—')
  field('history.note', a.note ?? '—', b.note ?? '—')
  field('history.status', t(`status.${a.status}` as MessageKey), t(`status.${b.status}` as MessageKey))
  if (JSON.stringify(a.splits ?? null) !== JSON.stringify(b.splits ?? null)) out.push(t('history.splitChanged'))
  return out
}

/** Una línea legible por registro cambiado (la papelera se describe junto al movimiento). */
export function describeChange(change: HistoryChange, entry: HistoryEntry, data: AppData, t: T, fmt: Formatter): Line | null {
  const verb = change.before === null ? 'created' : change.after === null ? 'deleted' : 'updated'
  switch (change.collection) {
    case 'transactions': {
      const tx = (change.after ?? change.before) as Transaction
      const toTrash = verb === 'deleted' && entry.changes.some((c) => c.collection === 'trash' && c.id === change.id && c.after !== null)
      const fromTrash = verb === 'created' && entry.changes.some((c) => c.collection === 'trash' && c.id === change.id && c.after === null)
      const key = toTrash ? 'history.tx.trashed' : fromTrash ? 'history.tx.restored' : `history.tx.${verb}`
      const sign = tx.kind === 'income' || tx.kind === 'refund' ? '+' : tx.kind === 'expense' ? '−' : ''
      return {
        text: t(key as MessageKey, { title: transactionTitle(tx, data.accounts, t), amount: `${sign}${fmt.money(tx.amountMinor)}`, date: fmt.date(tx.date) }),
        details: verb === 'updated' ? txDetails(change.before as Transaction, change.after as Transaction, data, t, fmt) : [],
        link: hasId(data.transactions, change.id) ? `/movimientos/editar/${change.id}` : undefined,
      }
    }
    case 'trash': {
      // Solo se menciona si no va con su movimiento (p. ej. eliminar definitivamente).
      if (entry.changes.some((c) => c.collection === 'transactions' && c.id === change.id)) return null
      const tx = ((change.before ?? change.after) as { transaction: Transaction }).transaction
      return { text: t(change.after === null ? 'history.trash.purged' : 'history.trash.added', { title: transactionTitle(tx, data.accounts, t), amount: fmt.money(tx.amountMinor) }), details: [] }
    }
    case 'goals': {
      const g = (change.after ?? change.before) as Goal
      const details = verb === 'updated' && goalSavedMinor(change.before as Goal) !== goalSavedMinor(change.after as Goal) ? [t('history.field', { field: t('history.saved'), before: fmt.money(goalSavedMinor(change.before as Goal)), after: fmt.money(goalSavedMinor(change.after as Goal)) })] : []
      if (verb === 'updated' && (change.before as Goal).targetMinor !== g.targetMinor) details.push(t('history.field', { field: t('history.target'), before: fmt.money((change.before as Goal).targetMinor), after: fmt.money(g.targetMinor) }))
      return { text: t(`history.goal.${verb}` as MessageKey, { name: g.name }), details, link: hasId(data.goals, g.id) ? `/plan/metas/editar/${g.id}` : undefined }
    }
    case 'schedules': {
      const s = (change.after ?? change.before) as Schedule
      const details = verb === 'updated' && (change.before as Schedule).amountMinor !== s.amountMinor ? [t('history.field', { field: t('fields.amount'), before: fmt.money((change.before as Schedule).amountMinor), after: fmt.money(s.amountMinor) })] : []
      return { text: t(`history.schedule.${verb}` as MessageKey, { name: s.name }), details, link: hasId(data.schedules, s.id) ? `/plan/programado/editar/${s.id}` : undefined }
    }
    case 'accounts': {
      const a = (change.after ?? change.before) as Account
      return { text: t(`history.account.${verb}` as MessageKey, { name: a.name }), details: [], link: '/ajustes?seccion=cuentas' }
    }
    case 'reconciliations':
      return { text: t(`history.reconciliation.${verb}` as MessageKey), details: [], link: '/conciliar' }
    case 'incomeDistributions':
      return { text: t(`history.distribution.${verb}` as MessageKey), details: [] }
    case 'periodBudgets': {
      const b = (change.after ?? change.before) as { name: string }
      return { text: t(`history.period.${verb}` as MessageKey, { name: b.name }), details: [] }
    }
    // v14 (PR #15, QA-05): lo que partir un programado reescribe y revertirlo devuelve.
    case 'templates': {
      const tp = (change.after ?? change.before) as { name: string }
      return { text: t(`history.template.${verb}` as MessageKey, { name: tp.name }), details: [], link: '/movimientos/plantillas' }
    }
    case 'scenarios': {
      const sc = (change.after ?? change.before) as { name: string }
      return { text: t(`history.scenario.${verb}` as MessageKey, { name: sc.name }), details: [], link: '/alcanza/escenarios' }
    }
    case 'inboxSnoozed': {
      const sn = (change.after ?? change.before) as { until: string }
      return { text: t(`history.snooze.${verb}` as MessageKey, { date: fmt.date(sn.until) }), details: [], link: '/pendientes' }
    }
    case 'settings':
    {
      const before = change.before as Record<string, unknown>
      const after = change.after as Record<string, unknown>
      const label: Record<string, MessageKey> = { currency: 'settings.currency.label', timeZone: 'settings.format.timeZone', fallbackHorizonDays: 'history.horizonDays' }
      const show = (k: string, v: unknown) => (v === null || v === undefined ? '—' : k === 'fallbackHorizonDays' ? t('horizon.option', { days: Number(v) }) : String(v))
      return {
        text: t('history.settings'),
        details: Object.keys(after)
          .filter((k) => before[k] !== after[k])
          .map((k) => t('history.field', { field: label[k] ? t(label[k]) : k, before: show(k, before[k]), after: show(k, after[k]) })),
      }
    }
  }
}

