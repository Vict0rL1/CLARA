/**
 * Lo que espera revisión de las capturas automáticas (Fase 2 nativa): movimientos registrados solos («Por revisar») y
 * propuestas. Va aparte de `captureImport.ts` porque Inicio y la bandeja solo necesitan contar, y esto es lo único que
 * entra en el JS inicial.
 */
import type { AppData, Transaction } from './types'

/** Movimientos «Por revisar», del pago más reciente al más antiguo (a igualdad, por id). */
export function transactionsToReview(data: Pick<AppData, 'transactions'>): Transaction[] {
  const at = (t: Transaction) => t.realizedAt ?? t.createdAt
  return data.transactions.filter((t) => t.review?.needed).sort((a, b) => (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Cuántos pagos capturados esperan a la persona: movimientos «Por revisar» más propuestas. */
export function captureReviewCount(data: Pick<AppData, 'transactions' | 'captures'>): number {
  let count = data.captures?.proposals.length ?? 0
  for (const t of data.transactions) if (t.review?.needed) count += 1
  return count
}
