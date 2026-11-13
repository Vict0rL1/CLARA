/**
 * Filtros del historial (D4). Lógica pura: la pantalla solo recoge los criterios. Los importes son
 * enteros en unidades menores y el rango es inclusivo; categorías y etiquetas aceptan «cualquiera».
 */
import { txCategoryIds } from './splits'
import type { Transaction, TxKind, TxStatus } from './types'

/** v15: `capture` = lo que registró una captura automática del iPhone (Apple Pay, aviso del banco, Siri). */
export type SourceGroup = 'manual' | 'assistant' | 'import' | 'scheduled' | 'common' | 'shortcut' | 'capture'
/** Los filtros de siempre. `capture` solo se ofrece si hay algún movimiento capturado (en la web no se captura nada). */
export const SOURCE_GROUPS: readonly SourceGroup[] = ['manual', 'assistant', 'import', 'scheduled', 'common', 'shortcut']

export interface TxFilter {
  kind?: 'all' | TxKind
  status?: 'all' | TxStatus
  accountId?: string
  categoryIds?: readonly string[]
  tagIds?: readonly string[]
  from?: string
  to?: string
  minMinor?: number | null
  maxMinor?: number | null
  source?: 'all' | SourceGroup
}

/** Cómo se registró: las marcas del registro mandan sobre `source` (ausente = manual). */
export function sourceGroupOf(tx: Transaction): SourceGroup {
  if (tx.importRef || tx.source === 'import') return 'import'
  if (tx.scheduleId || tx.source === 'scheduled') return 'scheduled'
  if (tx.favoriteId || tx.source === 'common') return 'common'
  if (tx.source === 'ai_text' || tx.source === 'voice' || tx.source === 'photo') return 'assistant'
  if (tx.source === 'shortcut') return 'shortcut'
  if (tx.captureId || tx.source === 'apple_pay' || tx.source === 'bank_text' || tx.source === 'siri') return 'capture'
  return 'manual'
}

export function matchesTxFilter(tx: Transaction, f: TxFilter): boolean {
  if (f.kind && f.kind !== 'all' && tx.kind !== f.kind) return false
  if (f.status && f.status !== 'all' && tx.status !== f.status) return false
  if (f.accountId && f.accountId !== 'all' && tx.accountId !== f.accountId && tx.toAccountId !== f.accountId) return false
  // Una compra dividida aparece en cada categoría de sus líneas.
  if (f.categoryIds && f.categoryIds.length > 0) {
    const own = txCategoryIds(tx)
    if (!f.categoryIds.some((c) => own.includes(c))) return false
  }
  if (f.tagIds && f.tagIds.length > 0 && !f.tagIds.some((tg) => tx.tagIds?.includes(tg))) return false
  if (f.from && tx.date < f.from) return false
  if (f.to && tx.date > f.to) return false
  if (f.minMinor != null && tx.amountMinor < f.minMinor) return false
  if (f.maxMinor != null && tx.amountMinor > f.maxMinor) return false
  if (f.source && f.source !== 'all' && sourceGroupOf(tx) !== f.source) return false
  return true
}
