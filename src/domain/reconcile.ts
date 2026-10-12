/**
 * Conciliación de saldos (ver docs/FORMULAS.md §14).
 *
 *   Saldo calculado al final del día D =
 *       saldo de referencia de la cuenta
 *     + Σ efecto de los movimientos REALIZADOS aplicados a ese saldo con fecha ≤ D
 *   Diferencia = saldo observado (banco o efectivo) − saldo calculado
 *
 * Solo cuentan movimientos realizados (nunca previstos ni pagos programados). D no
 * puede ser anterior a la fecha del saldo de referencia: antes de esa fecha la app no
 * conoce el saldo. En tarjetas el saldo es negativo (deuda); el crédito disponible
 * NO es dinero propio y nunca se compara.
 */
import { isBudgetAccount, txAppliesToAccount, txEffectOnAccount } from './balances'
import { addDays, daysBetween } from './dates'
import { sumMinor } from './money'
import type { Account, AppData, LocalDate, Reconciliation, Transaction } from './types'

export const NEARBY_DAYS = 7

/** Movimientos realizados de la cuenta que ya forman parte del saldo al final del día `date`. */
function appliedUntil(data: Pick<AppData, 'transactions'>, account: Account, date: LocalDate): Transaction[] {
  return data.transactions.filter(
    (tx) => (tx.accountId === account.id || tx.toAccountId === account.id) && txAppliesToAccount(tx, account) && tx.date <= date,
  )
}

/** Saldo calculado al final de `date`, o `null` si es anterior al saldo de referencia. */
export function balanceAtDate(data: Pick<AppData, 'transactions'>, account: Account, date: LocalDate): number | null {
  if (date < account.anchor.date) return null
  return sumMinor([account.anchor.amountMinor, ...appliedUntil(data, account, date).map((tx) => txEffectOnAccount(tx, account.id))])
}

/**
 * Huella del saldo de referencia y de los movimientos que forman el saldo hasta
 * `date`. Si cambia un importe, fecha, tipo o cuenta de esos movimientos (o se
 * eliminan, restauran o añaden), la huella cambia y la conciliación queda
 * «pendiente de revisión». Cambiar solo una nota no la altera.
 */
export function reconciliationFingerprint(data: Pick<AppData, 'transactions'>, account: Account, date: LocalDate): string {
  const parts = appliedUntil(data, account, date)
    .map((tx) => [tx.id, tx.kind, tx.amountMinor, tx.date, tx.accountId, tx.toAccountId ?? '', tx.adjustmentDirection ?? ''].join(','))
    .sort()
  const source = [account.id, account.anchor.amountMinor, account.anchor.date, account.anchor.setAt, ...parts].join('|')
  // FNV-1a de 32 bits: suficiente para detectar cambios (no es una medida de seguridad).
  let hash = 0x811c9dc5
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${parts.length}-${hash.toString(16).padStart(8, '0')}`
}

export type ReconciliationState = 'ok' | 'needsReview' | 'superseded'

/**
 * - superseded: después se registró un saldo de referencia posterior a esa fecha.
 * - needsReview: cambió algún movimiento del periodo conciliado.
 */
export function reconciliationState(data: Pick<AppData, 'transactions' | 'accounts'>, rec: Reconciliation): ReconciliationState {
  const account = data.accounts.find((a) => a.id === rec.accountId)
  if (!account || rec.date < account.anchor.date) return 'superseded'
  return reconciliationFingerprint(data, account, rec.date) === rec.fingerprint ? 'ok' : 'needsReview'
}

/** Movimientos realizados de la cuenta a ±`days` días de la fecha (para buscar la diferencia). */
export function nearbyTransactions(data: Pick<AppData, 'transactions'>, accountId: string, date: LocalDate, days = NEARBY_DAYS): Transaction[] {
  const from = addDays(date, -days)
  const to = addDays(date, days)
  return data.transactions
    .filter((tx) => tx.status === 'realized' && (tx.accountId === accountId || tx.toAccountId === accountId) && tx.date >= from && tx.date <= to)
    .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1))
}

export function reconciliationsFor(data: Pick<AppData, 'reconciliations'>, accountId: string): Reconciliation[] {
  return data.reconciliations
    .filter((r) => r.accountId === accountId)
    .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1))
}

/** Última verificación vigente (sin diferencia pendiente y sin cambios posteriores). */
export function lastVerified(data: Pick<AppData, 'reconciliations' | 'transactions' | 'accounts'>, accountId: string): Reconciliation | null {
  return (
    reconciliationsFor(data, accountId).find((r) => r.resolution !== 'unresolved' && reconciliationState(data, r) === 'ok') ?? null
  )
}

export interface VerificationSummary {
  /** Fecha verificada más ANTIGUA entre las cuentas del presupuesto (null si alguna nunca se verificó). */
  oldestVerifiedDate: LocalDate | null
  /** Cuentas del presupuesto sin ninguna verificación vigente. */
  unverifiedAccounts: Account[]
  /** Conciliaciones que necesitan revisión o quedaron con diferencia. */
  needsAttention: Reconciliation[]
  /** Fecha del último movimiento realizado registrado en cuentas del presupuesto. */
  lastMovementDate: LocalDate | null
  /** Días desde la verificación más antigua (dato, no un porcentaje de confianza). */
  daysSinceVerified: number | null
}

export function verificationSummary(data: AppData, today: LocalDate): VerificationSummary {
  const budgetAccounts = data.accounts.filter(isBudgetAccount)
  const verified = budgetAccounts.map((a) => ({ account: a, rec: lastVerified(data, a.id) }))
  const unverifiedAccounts = verified.filter((v) => !v.rec).map((v) => v.account)
  const dates = verified.flatMap((v) => (v.rec ? [v.rec.date] : []))
  const oldestVerifiedDate = unverifiedAccounts.length === 0 && dates.length ? dates.reduce((min, d) => (d < min ? d : min)) : null
  const needsAttention = data.accounts.flatMap((a) => {
    const latest = reconciliationsFor(data, a.id)[0]
    if (!latest) return []
    const state = reconciliationState(data, latest)
    return state === 'needsReview' || (state === 'ok' && latest.resolution === 'unresolved') ? [latest] : []
  })
  const ids = new Set(budgetAccounts.map((a) => a.id))
  const lastMovementDate = data.transactions
    .filter((tx) => tx.status === 'realized' && (ids.has(tx.accountId) || (tx.toAccountId !== undefined && ids.has(tx.toAccountId))))
    .reduce<LocalDate | null>((max, tx) => (max === null || tx.date > max ? tx.date : max), null)
  return {
    oldestVerifiedDate,
    unverifiedAccounts,
    needsAttention,
    lastMovementDate,
    daysSinceVerified: oldestVerifiedDate ? Math.max(0, daysBetween(oldestVerifiedDate, today)) : null,
  }
}
