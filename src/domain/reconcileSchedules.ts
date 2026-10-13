/**
 * Conciliación de programados (etapa 3): movimientos ya registrados que parecen una ocurrencia
 * abierta pero no están vinculados (por ejemplo, un pago anotado a mano o importado antes de marcar
 * el calendario). Solo propone; vincular es un acto explícito y nunca registra ni marca nada solo.
 *
 * Regla de coincidencia: mismo sentido (gasto ↔ pago, ingreso ↔ cobro), mismo importe, fecha a
 * ±`MATCH_WINDOW_DAYS` de la ocurrencia, movimiento realizado sin `scheduleId`. Cada movimiento se
 * propone para una sola ocurrencia (la más cercana en fecha) y cada ocurrencia recibe un candidato.
 */
import { addDays, daysBetween } from './dates'
import { saveTransaction, type OpContext, type OpResult } from './operations'
import { openItemsUntil, type PlanItem } from './planItems'
import type { AppData, LocalDate, Transaction } from './types'

export const MATCH_WINDOW_DAYS = 3
export const LOOKAHEAD_DAYS = 14
export const LOOKBACK_DAYS = 45

export interface UnlinkedSettlement {
  item: PlanItem
  transaction: Transaction
  /** Días entre la fecha del movimiento y la de la ocurrencia (0 = el mismo día). */
  distanceDays: number
}

export function unlinkedSettlements(data: AppData, today: LocalDate): UnlinkedSettlement[] {
  const since = addDays(today, -LOOKBACK_DAYS)
  const open = openItemsUntil(data, today, addDays(today, LOOKAHEAD_DAYS)).filter((i) => i.source === 'schedule' && i.date >= since && (i.state === 'pending' || i.state === 'overdue'))
  const candidates = data.transactions.filter((tx) => tx.status === 'realized' && !tx.scheduleId && (tx.kind === 'expense' || tx.kind === 'income'))
  const used = new Set<string>()
  const out: UnlinkedSettlement[] = []
  for (const item of open) {
    const wanted = item.direction === 'income' ? 'income' : 'expense'
    let best: { tx: Transaction; distance: number } | null = null
    for (const tx of candidates) {
      if (used.has(tx.id) || tx.kind !== wanted || tx.amountMinor !== item.amountMinor) continue
      const distance = Math.abs(daysBetween(tx.date, item.date))
      if (distance > MATCH_WINDOW_DAYS) continue
      if (!best || distance < best.distance || (distance === best.distance && tx.date > best.tx.date)) best = { tx, distance }
    }
    if (best) {
      used.add(best.tx.id)
      out.push({ item, transaction: best.tx, distanceDays: best.distance })
    }
  }
  return out
}

/** Vincula un movimiento existente con la ocurrencia: a partir de ahí cuenta como movimiento, no como reserva. */
export function linkSettlement(data: AppData, txId: string, scheduleId: string, occurrenceDate: LocalDate, ctx: OpContext): OpResult<Transaction> {
  const tx = data.transactions.find((t) => t.id === txId)
  if (!tx) return { ok: false, issues: [{ path: 'id', code: 'notFound' }] }
  if (tx.scheduleId === scheduleId && tx.occurrenceDate === occurrenceDate) return { ok: true, data, value: tx, unchanged: true }
  // Una ocurrencia cuenta como reserva o como movimiento, nunca dos veces: si ya tiene liquidación final, no se vincula otra.
  const settled = data.transactions.some((t) => t.id !== txId && t.scheduleId === scheduleId && t.occurrenceDate === occurrenceDate && t.status === 'realized' && !t.partialSettlement)
  if (settled) return { ok: false, issues: [{ path: 'occurrenceDate', code: 'occurrenceAlreadySettled', params: { date: occurrenceDate } }] }
  return saveTransaction(data, { ...tx, scheduleId, occurrenceDate }, ctx)
}
