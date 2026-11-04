/**
 * Cambio de moneda del presupuesto (QA-01 de la auditoría 2026-10-09).
 *
 * Los importes se guardan como enteros en unidades menores y casi ningún registro lleva su
 * propia moneda (saldos de referencia, límites de tarjeta, metas, plantillas…). Cambiar la
 * moneda con datos monetarios reinterpretaría el MISMO entero en otra unidad: CAD 2 000 se
 * convertiría en JPY 200 000 sin que nadie lo decidiera. Por eso el cambio solo se permite
 * cuando no hay ningún importe guardado; nunca se convierte ni se reetiqueta dinero.
 *
 * Esta es la ÚNICA lista de lo que cuenta como «importe guardado»: la usan la operación
 * (`changeCurrency`) y la interfaz (Ajustes › Formato), así no pueden divergir.
 */
import type { AppData } from './types'

export type MonetaryRecordKind =
  | 'accountBalance'
  | 'cardSettings'
  | 'transactions'
  | 'trash'
  | 'schedules'
  | 'goals'
  | 'plans'
  | 'favorites'
  | 'periodBudgets'
  | 'categoryLimits'
  | 'templates'
  | 'reconciliations'
  | 'incomeDistributions'
  | 'scenarios'
  | 'safeToSpendBuffer'

/** Qué registros con importe existen (vacío = se puede cambiar la moneda). */
export function monetaryRecords(data: AppData): MonetaryRecordKind[] {
  const found: MonetaryRecordKind[] = []
  // Un saldo de referencia distinto de cero (positivo, negativo o deuda de tarjeta) ya es dinero.
  if (data.accounts.some((a) => a.anchor.amountMinor !== 0)) found.push('accountBalance')
  if (data.accounts.some((a) => (a.card?.limitMinor ?? 0) !== 0 || (a.card?.minPaymentFloorMinor ?? 0) !== 0)) found.push('cardSettings')
  if (data.transactions.length > 0) found.push('transactions')
  if (data.trash.length > 0) found.push('trash')
  if (data.schedules.length > 0) found.push('schedules')
  if (data.goals.length > 0) found.push('goals')
  if (data.plans.length > 0) found.push('plans')
  if (data.favorites.some((f) => f.amountMinor !== undefined)) found.push('favorites')
  if (data.periodBudgets.length > 0) found.push('periodBudgets')
  if (data.categoryLimits.length > 0) found.push('categoryLimits')
  if (data.templates.some((t) => t.lines.some((l) => l.amount.mode === 'fixed'))) found.push('templates')
  if (data.reconciliations.length > 0) found.push('reconciliations')
  if (data.incomeDistributions.length > 0) found.push('incomeDistributions')
  if (data.scenarios.length > 0) found.push('scenarios')
  // Auditoría del PR #15 (QA-02): el colchón de seguridad (v13) es un importe guardado en la moneda del
  // presupuesto; sin esto, CAD 100 pasaba a leerse como JPY 10 000 al cambiar la moneda.
  if ((data.settings.safeToSpend?.bufferMinor ?? 0) !== 0) found.push('safeToSpendBuffer')
  return found
}

export function canChangeCurrency(data: AppData): boolean {
  return monetaryRecords(data).length === 0
}
