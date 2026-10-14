/**
 * Conciliación de programados (etapa 3): movimientos ya registrados que parecen una ocurrencia
 * abierta pero no están vinculados (por ejemplo, un pago anotado a mano o importado antes de marcar
 * el calendario). Solo propone; vincular es un acto explícito y nunca registra ni marca nada solo.
 *
 * Regla de coincidencia: mismo sentido (gasto ↔ pago, ingreso ↔ cobro), mismo importe, fecha a
 * ±`MATCH_WINDOW_DAYS` de la ocurrencia, movimiento realizado sin `scheduleId`. Cada movimiento se
 * propone para una sola ocurrencia y cada ocurrencia recibe un candidato: se ordenan TODAS las parejas
 * posibles por cercanía antes de asignar (la coincidencia exacta de fecha gana siempre).
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
  // Todas las parejas posibles, ordenadas por cercanía ANTES de asignar: un pago del mismo día de una
  // ocurrencia nunca se lo queda otra ocurrencia anterior que solo estaba más arriba en la lista.
  const pairs: { item: PlanItem; index: number; tx: Transaction; distance: number }[] = []
  open.forEach((item, index) => {
    const wanted = item.direction === 'income' ? 'income' : 'expense'
    for (const tx of candidates) {
      if (tx.kind !== wanted || tx.amountMinor !== item.amountMinor) continue
      const distance = Math.abs(daysBetween(tx.date, item.date))
      if (distance <= MATCH_WINDOW_DAYS) pairs.push({ item, index, tx, distance })
    }
  })
  // A igual distancia: el movimiento más reciente, luego la ocurrencia más antigua; ids para un orden estable.
  pairs.sort((a, b) => a.distance - b.distance || cmp(b.tx.date, a.tx.date) || cmp(a.item.date, b.item.date) || cmp(a.tx.id, b.tx.id) || a.index - b.index)
  const usedTx = new Set<string>()
  const usedItem = new Set<number>()
  const out: (UnlinkedSettlement & { index: number })[] = []
  for (const p of pairs) {
    if (usedTx.has(p.tx.id) || usedItem.has(p.index)) continue
    usedTx.add(p.tx.id)
    usedItem.add(p.index)
    out.push({ item: p.item, transaction: p.tx, distanceDays: p.distance, index: p.index })
  }
  return out.sort((a, b) => a.index - b.index).map(({ index: _index, ...rest }) => rest)
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
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
