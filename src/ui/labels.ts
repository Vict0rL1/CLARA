/** Textos derivados de datos (categorías, nombres, mensajes de validación). */
import { isValidLocalDate } from '../domain/dates'
import { activeAccounts } from '../domain/balances'
import type { PlanItem } from '../domain/planItems'
import type { Account, Frequency, Plan, Transaction } from '../domain/types'
import type { Issue } from '../domain/validation'
import type { ImportIssue } from '../storage/backup'
import type { MessageKey, Translator } from '../i18n'
import type { Formatter } from './format'

export function categoryLabel(t: Translator['t'], id: string | undefined): string {
  if (!id) return ''
  return t(`category.${id}` as MessageKey)
}

/** Opciones de categoría: si el registro usa una categoría archivada, se mantiene visible. */
/** Título de un plan: su nombre o, si está vacío, sus categorías («Todas las categorías» si no tiene). */
export function planTitle(t: Translator['t'], plan: Pick<Plan, 'name' | 'categoryIds'>): string {
  if (plan.name.trim()) return plan.name
  if (plan.categoryIds.length === 0) return t('plans.allCategories')
  return plan.categoryIds.map((id) => categoryLabel(t, id)).join(', ')
}

export function withCurrent(options: readonly string[], current: string | undefined): string[] {
  return current && !options.includes(current) ? [...options, current] : [...options]
}

export function frequencyLabel(t: Translator['t'], f: Frequency): string {
  return t(`frequency.${f}` as MessageKey)
}

export function accountName(accounts: Account[], id: string | undefined, t: Translator['t']): string {
  return accounts.find((a) => a.id === id)?.name ?? t('common.unknownAccount')
}

/** Nombre con «(archivada)» si procede: para filtros e historial, donde las archivadas siguen apareciendo. */
export function accountLabel(a: Pick<Account, 'name' | 'archived'>, t: Translator['t']): string {
  return a.archived ? `${a.name} ${t('common.archivedSuffix')}` : a.name
}

/**
 * Opciones de un selector de cuenta para registrar o programar: las activas, en su orden.
 * `keepId` (la cuenta de un registro existente) se conserva aunque esté archivada, marcada.
 */
export function accountOptions(accounts: Account[], t: Translator['t'], keepId?: string): { value: string; label: string }[] {
  const options = activeAccounts(accounts).map((a) => ({ value: a.id, label: a.name }))
  const kept = keepId ? accounts.find((a) => a.id === keepId && a.archived) : undefined
  return kept ? [...options, { value: kept.id, label: accountLabel(kept, t) }] : options
}

export function planItemName(item: PlanItem, t: Translator['t']): string {
  return item.name || categoryLabel(t, item.categoryId) || t(`txKind.${item.direction}` as MessageKey)
}

export function transactionTitle(tx: Transaction, accounts: Account[], t: Translator['t']): string {
  if (tx.note) return tx.note
  if (tx.kind === 'transfer') {
    return t('movements.transferTitle', { from: accountName(accounts, tx.accountId, t), to: accountName(accounts, tx.toAccountId, t) })
  }
  return categoryLabel(t, tx.categoryId) || t(`txKind.${tx.kind}` as MessageKey)
}

/** Mensaje legible para un problema de validación; los importes se formatean. */
export function issueMessage(t: Translator['t'], fmt: Formatter | null, issue: Issue | ImportIssue): string {
  const params: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(issue.params ?? {})) {
    // Importes y fechas con el formato de la persona (una fecha `AAAA-MM-DD` en crudo no se lee bien).
    params[k] = k.endsWith('Minor') && typeof v === 'number' && fmt ? fmt.money(v) : (k === 'date' || k.endsWith('Date')) && typeof v === 'string' && isValidLocalDate(v) && fmt ? fmt.date(v) : v
  }
  return t(`issue.${issue.code}` as MessageKey, params)
}

/** Mensaje para el primer problema de un campo concreto. */
export function fieldError(t: Translator['t'], fmt: Formatter | null, issues: Issue[], path: string): string | null {
  const issue = issues.find((i) => i.path === path)
  return issue ? issueMessage(t, fmt, issue) : null
}

/** Problemas que no corresponden a ningún campo visible. */
export function otherIssues(issues: Issue[], knownPaths: string[]): Issue[] {
  return issues.filter((i) => !knownPaths.includes(i.path))
}
