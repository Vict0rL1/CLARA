/**
 * Saldos por cuenta a partir del saldo de referencia (anchor) y los movimientos realizados.
 *
 * Regla anti doble conteo:
 *   Un movimiento REALIZADO cambia el saldo de una cuenta solo si ocurrió después
 *   del saldo de referencia:
 *     - su fecha es posterior a la fecha del saldo, o
 *     - es del mismo día y se marcó como realizado después de registrar el saldo.
 *   Todo lo anterior se considera ya incluido en el saldo que escribió la persona.
 *   Los movimientos PREVISTOS nunca cambian el saldo.
 */
import { sumMinor } from './money'
import type { Account, AppData, Transaction } from './types'

/** Cuenta para «lo que puedo gastar»: incluida en el presupuesto y no archivada. */
export function isBudgetAccount(a: Pick<Account, 'includeInBudget' | 'archived'>): boolean {
  return a.includeInBudget && !a.archived
}

/** Orden de presentación: `order` (v11) y, a igualdad o sin él, la posición en la lista. */
export function sortedAccounts<T extends Pick<Account, 'order'>>(accounts: readonly T[]): T[] {
  return accounts
    .map((a, index) => ({ a, index, key: a.order ?? index }))
    .sort((x, y) => x.key - y.key || x.index - y.index)
    .map((x) => x.a)
}

/** Cuentas que se ofrecen para registrar, programar o filtrar: las no archivadas, en su orden. */
export function activeAccounts<T extends Pick<Account, 'order' | 'archived'>>(accounts: readonly T[]): T[] {
  return sortedAccounts(accounts.filter((a) => !a.archived))
}

export function txAppliesToAccount(tx: Transaction, account: Account): boolean {
  if (tx.status !== 'realized') return false
  const { date, setAt } = account.anchor
  if (tx.date > date) return true
  if (tx.date < date) return false
  const realizedAt = tx.realizedAt ?? tx.createdAt
  return realizedAt > setAt
}

/** Efecto con signo de un movimiento sobre una cuenta (sin mirar el saldo de referencia). */
export function txEffectOnAccount(tx: Transaction, accountId: string): number {
  switch (tx.kind) {
    case 'income':
    case 'refund':
      return tx.accountId === accountId ? tx.amountMinor : 0
    case 'expense':
      return tx.accountId === accountId ? -tx.amountMinor : 0
    case 'transfer': {
      let effect = 0
      if (tx.accountId === accountId) effect -= tx.amountMinor
      if (tx.toAccountId === accountId) effect += tx.amountMinor
      return effect
    }
    case 'adjustment':
      return tx.accountId === accountId ? adjustmentSign(tx) * tx.amountMinor : 0
  }
}

/** +1 si el ajuste sube el saldo, −1 si lo baja. */
export function adjustmentSign(tx: Pick<Transaction, 'adjustmentDirection'>): 1 | -1 {
  return tx.adjustmentDirection === 'decrease' ? -1 : 1
}

export interface AccountBalance {
  account: Account
  anchorMinor: number
  /** Movimientos realizados que se aplicaron sobre el saldo de referencia. */
  applied: Transaction[]
  appliedTotalMinor: number
  balanceMinor: number
}

export function accountBalance(data: Pick<AppData, 'transactions'>, account: Account): AccountBalance {
  const applied = data.transactions.filter(
    (tx) => (tx.accountId === account.id || tx.toAccountId === account.id) && txAppliesToAccount(tx, account),
  )
  const appliedTotalMinor = sumMinor(applied.map((tx) => txEffectOnAccount(tx, account.id)))
  return {
    account,
    anchorMinor: account.anchor.amountMinor,
    applied,
    appliedTotalMinor,
    balanceMinor: sumMinor([account.anchor.amountMinor, appliedTotalMinor]),
  }
}

/**
 * Saldos de varias cuentas con una sola pasada por los movimientos (antes, una por cuenta).
 * Mismas reglas y mismo orden que `accountBalance`: cada cuenta recibe los movimientos que la
 * tocan, en el orden de la lista.
 */
export function allAccountBalances(data: Pick<AppData, 'transactions' | 'accounts'>, accounts: Account[] = data.accounts): AccountBalance[] {
  const byId = new Map<string, { account: Account; applied: Transaction[] }>()
  for (const account of accounts) byId.set(account.id, { account, applied: [] })
  // Ids repetidos (datos inválidos): se calcula cada cuenta por separado, como siempre.
  if (byId.size !== accounts.length) return accounts.map((a) => accountBalance(data, a))
  for (const tx of data.transactions) {
    if (tx.status !== 'realized') continue
    const from = byId.get(tx.accountId)
    if (from && txAppliesToAccount(tx, from.account)) from.applied.push(tx)
    if (tx.toAccountId && tx.toAccountId !== tx.accountId) {
      const to = byId.get(tx.toAccountId)
      if (to && txAppliesToAccount(tx, to.account)) to.applied.push(tx)
    }
  }
  return accounts.map((account) => {
    const { applied } = byId.get(account.id)!
    const appliedTotalMinor = sumMinor(applied.map((tx) => txEffectOnAccount(tx, account.id)))
    return {
      account,
      anchorMinor: account.anchor.amountMinor,
      applied,
      appliedTotalMinor,
      balanceMinor: sumMinor([account.anchor.amountMinor, appliedTotalMinor]),
    }
  })
}

/** Saldo total de las cuentas incluidas en el presupuesto. */
export function spendableBalance(data: Pick<AppData, 'transactions' | 'accounts'>): {
  totalMinor: number
  accounts: AccountBalance[]
} {
  const accounts = allAccountBalances(data, data.accounts.filter(isBudgetAccount))
  return { totalMinor: sumMinor(accounts.map((b) => b.balanceMinor)), accounts }
}

/**
 * Patrimonio neto a partir de los mismos saldos que Ajustes › Cuentas y la explicación de Inicio.
 *   activos = Σ saldos positivos de las cuentas no archivadas;
 *   pasivos = Σ |saldos negativos| (deuda de tarjetas, sobregiros);
 *   neto = activos − pasivos; presupuesto = Σ saldos de las cuentas que cuentan (§4 de FORMULAS).
 * Las archivadas no entran en el neto (se informan aparte para que nada quede escondido).
 * El crédito disponible de una tarjeta nunca es un activo.
 */
export interface NetPosition {
  assetsMinor: number
  liabilitiesMinor: number
  netMinor: number
  budgetMinor: number
  archivedMinor: number
  accounts: AccountBalance[]
}

export function netPosition(data: Pick<AppData, 'transactions' | 'accounts'>): NetPosition {
  const accounts = allAccountBalances(data, sortedAccounts(data.accounts))
  const active = accounts.filter((b) => !b.account.archived)
  const assetsMinor = sumMinor(active.map((b) => (b.balanceMinor > 0 ? b.balanceMinor : 0)))
  const liabilitiesMinor = sumMinor(active.map((b) => (b.balanceMinor < 0 ? -b.balanceMinor : 0)))
  return {
    assetsMinor,
    liabilitiesMinor,
    netMinor: assetsMinor - liabilitiesMinor,
    budgetMinor: sumMinor(active.filter((b) => isBudgetAccount(b.account)).map((b) => b.balanceMinor)),
    archivedMinor: sumMinor(accounts.filter((b) => b.account.archived).map((b) => b.balanceMinor)),
    accounts,
  }
}

/**
 * Efecto de un movimiento sobre el conjunto de cuentas del presupuesto:
 * una transferencia entre dos cuentas del presupuesto no cambia nada;
 * hacia una cuenta fuera del presupuesto (p. ej. ahorro) lo reduce.
 */
export function txEffectOnBudgetPool(
  tx: Pick<Transaction, 'kind' | 'amountMinor' | 'accountId' | 'toAccountId' | 'adjustmentDirection'>,
  accounts: Account[],
): number {
  const included = (id: string | undefined) => !!id && accounts.some((a) => a.id === id && isBudgetAccount(a))
  switch (tx.kind) {
    case 'income':
    case 'refund':
      return included(tx.accountId) ? tx.amountMinor : 0
    case 'expense':
      return included(tx.accountId) ? -tx.amountMinor : 0
    case 'transfer': {
      const from = included(tx.accountId)
      const to = included(tx.toAccountId)
      if (from === to) return 0
      return from ? -tx.amountMinor : tx.amountMinor
    }
    case 'adjustment':
      return included(tx.accountId) ? adjustmentSign(tx) * tx.amountMinor : 0
  }
}

/** Fecha y hora del saldo de referencia más antiguo entre las cuentas del presupuesto. */
export function oldestAnchor(data: Pick<AppData, 'accounts'>): Account['anchor'] | null {
  const included = data.accounts.filter(isBudgetAccount)
  if (included.length === 0) return null
  return included.reduce((old, a) => (a.anchor.setAt < old.setAt ? a.anchor : old), included[0]!.anchor)
}
