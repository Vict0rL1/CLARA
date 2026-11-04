/**
 * Tarjetas de crédito: resumen de deuda, límite, fechas y estimaciones.
 *
 * - Deuda = −saldo (el saldo de una tarjeta es negativo cuando se debe dinero).
 * - Crédito disponible = límite − deuda (puede ser negativo: sobre el límite).
 * - Pago mínimo ESTIMADO = min(deuda, max(importe fijo, ceil(deuda × % / 100))).
 *   Por defecto 3 % con un mínimo de 10,00. Los bancos usan reglas propias.
 * - Interés mensual ESTIMADO = ceil(deuda × tasa anual / 12) sobre la deuda actual,
 *   si no se paga. Es una aproximación (los bancos usan saldo diario promedio).
 * - Fechas de corte y de pago: el día indicado de cada mes; en meses más cortos,
 *   el último día (igual que los pagos mensuales).
 */
import { accountBalance } from './balances'
import { daysInMonth, parseLocalDate, toLocalDate } from './dates'
import { mulDivCeil } from './money'
import type { Account, AppData, LocalDate } from './types'

export const DEFAULT_MIN_PAYMENT_BPS = 300
export const DEFAULT_MIN_PAYMENT_FLOOR_MINOR = 1000

/** Próxima fecha (hoy incluido) con ese día del mes, ajustado al último día en meses cortos. */
export function nextMonthlyDay(today: LocalDate, day: number): LocalDate {
  const { year, month } = parseLocalDate(today)
  const thisMonth = toLocalDate(year, month, Math.min(day, daysInMonth(year, month)))
  if (thisMonth >= today) return thisMonth
  const ny = month === 12 ? year + 1 : year
  const nm = month === 12 ? 1 : month + 1
  return toLocalDate(ny, nm, Math.min(day, daysInMonth(ny, nm)))
}

export interface CardSummary {
  debtMinor: number
  /** Saldo a favor (si se pagó de más). */
  creditBalanceMinor: number
  limitMinor: number | null
  availableCreditMinor: number | null
  /** Solo para mostrar (barra); no se usa en cálculos de dinero. */
  utilization: number | null
  overLimit: boolean
  nextStatementDate: LocalDate | null
  nextDueDate: LocalDate | null
  minPaymentMinor: number
  monthlyInterestMinor: number | null
}

export function minimumPayment(debtMinor: number, account: Pick<Account, 'card'>): number {
  if (debtMinor <= 0) return 0
  const bps = account.card?.minPaymentBps ?? DEFAULT_MIN_PAYMENT_BPS
  const floor = account.card?.minPaymentFloorMinor ?? DEFAULT_MIN_PAYMENT_FLOOR_MINOR
  return Math.min(debtMinor, Math.max(floor, mulDivCeil(debtMinor, bps, 10000)))
}

export function monthlyInterest(debtMinor: number, aprBps: number | undefined): number | null {
  if (aprBps === undefined) return null
  if (debtMinor <= 0 || aprBps === 0) return 0
  return mulDivCeil(debtMinor, aprBps, 10000 * 12)
}

export function cardSummary(data: Pick<AppData, 'transactions'>, account: Account, today: LocalDate): CardSummary {
  const balance = accountBalance(data, account).balanceMinor
  const debtMinor = Math.max(0, -balance)
  const card = account.card ?? {}
  const limitMinor = card.limitMinor ?? null
  const availableCreditMinor = limitMinor === null ? null : limitMinor - debtMinor
  return {
    debtMinor,
    creditBalanceMinor: Math.max(0, balance),
    limitMinor,
    availableCreditMinor,
    utilization: limitMinor ? Math.min(1, debtMinor / limitMinor) : null,
    overLimit: availableCreditMinor !== null && availableCreditMinor < 0,
    nextStatementDate: card.statementDay ? nextMonthlyDay(today, card.statementDay) : null,
    nextDueDate: card.dueDay ? nextMonthlyDay(today, card.dueDay) : null,
    minPaymentMinor: minimumPayment(debtMinor, account),
    monthlyInterestMinor: monthlyInterest(debtMinor, card.aprBps),
  }
}

/** Tarjetas con deuda cuyo pago vence en los próximos `days` días (recordatorio dentro de la app). */
export function cardPaymentReminders(data: Pick<AppData, 'transactions' | 'accounts'>, today: LocalDate, days = 7) {
  return data.accounts
    .filter((a) => a.kind === 'credit')
    .map((account) => ({ account, summary: cardSummary(data, account, today) }))
    .filter(({ summary }) => {
      if (summary.debtMinor <= 0 || !summary.nextDueDate) return false
      const { year, month, day } = parseLocalDate(today)
      const limit = new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
      return summary.nextDueDate <= limit
    })
}
