/**
 * Filtros de Estadísticas (Clara 2.0 §14, fase 4): cuenta, etiqueta y comercio.
 *
 * No hay fórmulas nuevas: se filtran los MOVIMIENTOS y cada cifra, gráfico y tabla se calcula igual que sin
 * filtro (`domain/statistics.ts`) sobre esa copia, así todos dicen lo mismo. Solo cambia `transactions`;
 * cuentas, ajustes y programados quedan como están (el saldo futuro, que es de todas las cuentas del
 * presupuesto, no se filtra y la pantalla lo dice).
 *
 * - Cuenta: el movimiento es de esa cuenta (`accountId`). Una transferencia no es ingreso ni gasto, así que
 *   no cambia ninguna cifra en ningún caso.
 * - Etiqueta: el movimiento la lleva.
 * - Comercio: la misma clave que agrupa «Top comercios» (`merchants.ts`), así las variantes («UBER *EATS
 *   8XK2L», «Uber Eats») cuentan juntas.
 * Varios filtros a la vez se combinan con «y».
 */
import { merchantKey } from './merchants'
import { normalizeText } from './text'
import type { AppData, Transaction } from './types'

export interface StatsFilter {
  accountId?: string
  tagId?: string
  /** Clave de comercio (`txMerchantKey`). */
  merchant?: string
}

/** Clave con la que se agrupa un movimiento por comercio: comercio o nota; `null` si no tiene texto. */
export function txMerchantKey(tx: Pick<Transaction, 'merchant' | 'note'>): string | null {
  const label = (tx.merchant ?? tx.note ?? '').trim()
  if (!label) return null
  return merchantKey(label) || normalizeText(label)
}

export function statsFilterCount(f: StatsFilter): number {
  return (f.accountId ? 1 : 0) + (f.tagId ? 1 : 0) + (f.merchant ? 1 : 0)
}

export function matchesStatsFilter(tx: Transaction, f: StatsFilter): boolean {
  if (f.accountId && tx.accountId !== f.accountId) return false
  if (f.tagId && !tx.tagIds?.includes(f.tagId)) return false
  if (f.merchant && txMerchantKey(tx) !== f.merchant) return false
  return true
}

/** Los mismos datos con solo los movimientos que pasan el filtro (sin filtro, los datos tal cual). */
export function filterStatsData(data: AppData, f: StatsFilter): AppData {
  if (statsFilterCount(f) === 0) return data
  return { ...data, transactions: data.transactions.filter((tx) => matchesStatsFilter(tx, f)) }
}
