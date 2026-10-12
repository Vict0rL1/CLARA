/**
 * Asistente de registro (§7.3 / §8): convierte entradas confirmadas de la vista previa en
 * movimientos reales, todo o nada, con la misma validación que el formulario manual. El
 * proveedor de IA (local o remoto) solo propone; esta función es la única que registra, y
 * nunca calcula ni modifica saldos (eso lo hacen las fórmulas de siempre).
 */
import { saveTransaction, type OpContext, type OpResult } from './operations'
import type { AppData, LocalDate, Transaction, TransactionSource } from './types'
import type { Issue } from './validation'

export interface ConfirmedEntry {
  id: string
  kind: 'expense' | 'income'
  amountMinor: number
  date: LocalDate
  accountId: string
  categoryId: string
  note?: string
  merchant?: string
  /** Foto del recibo comprimida (solo entradas desde foto). */
  receiptUri?: string
  source: TransactionSource
  /** Vínculo con un pago o ingreso programado abierto (lo eligió la persona en la revisión). */
  scheduleId?: string
  occurrenceDate?: LocalDate
}

/** Registra todas las entradas o ninguna. Los errores llevan el índice de la entrada (`entries[i].campo`). */
export function saveConfirmedEntries(data: AppData, entries: readonly ConfirmedEntry[], ctx: OpContext): OpResult<Transaction[]> {
  if (entries.length === 0) return { ok: false, issues: [{ path: 'entries', code: 'required' }] }
  let next = data
  const saved: Transaction[] = []
  const issues: Issue[] = []
  entries.forEach((e, i) => {
    const r = saveTransaction(
      next,
      {
        id: e.id,
        kind: e.kind,
        status: e.date > ctx.today ? 'planned' : 'realized',
        amountMinor: e.amountMinor,
        date: e.date,
        accountId: e.accountId,
        categoryId: e.categoryId,
        ...(e.note ? { note: e.note } : {}),
        ...(e.merchant ? { merchant: e.merchant } : {}),
        ...(e.receiptUri ? { receiptUri: e.receiptUri } : {}),
        ...(e.scheduleId && e.occurrenceDate ? { scheduleId: e.scheduleId, occurrenceDate: e.occurrenceDate } : {}),
        source: e.source,
      },
      ctx,
    )
    if (!r.ok) issues.push(...r.issues.map((x) => ({ ...x, path: `entries[${i}].${x.path}` })))
    else {
      next = r.data
      saved.push(r.value)
    }
  })
  if (issues.length) return { ok: false, issues }
  return { ok: true, data: next, value: saved }
}

/** Mes `AAAA-MM` de una fecha local (para el contador mensual de uso de IA). */
export function monthOf(date: LocalDate): string {
  return date.slice(0, 7)
}

/** Suma un uso del asistente al contador del mes (se reinicia al cambiar de mes). Solo cuenta, no limita. */
export function recordAiUsage(data: AppData, ctx: OpContext): OpResult<AppData['settings']['aiUsage']> {
  const month = monthOf(ctx.today)
  const prev = data.settings.aiUsage ?? { month, count: 0 }
  const aiUsage = prev.month === month ? { month, count: prev.count + 1 } : { month, count: 1 }
  return { ok: true, data: { ...data, settings: { ...data.settings, aiUsage }, updatedAt: ctx.now }, value: aiUsage }
}
