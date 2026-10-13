/**
 * Aviso de posible duplicado ANTES de guardar (ronda 2026-10-12): la misma regla que la bandeja de
 * pendientes (`inbox.possibleDuplicates`), aplicada al borrador del formulario contra lo ya guardado.
 * Solo avisa; nunca bloquea ni cambia nada: la persona decide.
 */
import { daysBetween } from './dates'
import { normalizeText } from './rules'
import type { AppData, Transaction, TxKind } from './types'

export const DUPLICATE_WINDOW_DAYS = 3

export interface DuplicateDraft {
  /** Id del borrador (al editar, el propio movimiento no cuenta como duplicado de sí mismo). */
  id: string
  kind: TxKind
  accountId: string
  amountMinor: number
  date: string
  note?: string
}

/**
 * Movimientos realizados del mismo tipo, cuenta e importe a ±3 días del borrador cuyas notas coinciden
 * (o alguna falta). Transferencias y ajustes no se comparan; las líneas de una compra dividida son un
 * solo movimiento y los parciales de una misma ocurrencia del calendario son deliberados.
 */
export function similarTransactions(data: Pick<AppData, 'transactions'>, draft: DuplicateDraft, scheduleId?: string): Transaction[] {
  if (draft.kind !== 'expense' && draft.kind !== 'income' && draft.kind !== 'refund') return []
  if (!Number.isInteger(draft.amountMinor) || draft.amountMinor <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return []
  const note = normalizeText(draft.note ?? '')
  return data.transactions
    .filter((t) => {
      if (t.id === draft.id || t.status !== 'realized' || t.kind !== draft.kind || t.accountId !== draft.accountId || t.amountMinor !== draft.amountMinor) return false
      if (Math.abs(daysBetween(t.date, draft.date)) > DUPLICATE_WINDOW_DAYS) return false
      if (scheduleId && t.scheduleId === scheduleId) return false
      const other = normalizeText(t.note ?? '')
      return !note || !other || note === other
    })
    .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : a.id < b.id ? -1 : 1))
}
