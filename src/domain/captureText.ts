/**
 * El texto original de un aviso del banco (`review.rawText`) solo se guarda mientras el movimiento espera revisión
 * (encargo, §6; decisión 184). Módulo mínimo, sin dependencias, para que lo usen el historial y la papelera.
 */
import type { Transaction } from './types'

/**
 * El movimiento sin el texto original del aviso (`review.rawText`): lo que guardan el historial y la papelera. El texto
 * solo vive en el movimiento mientras espera revisión; un movimiento sin él se devuelve tal cual (misma referencia).
 */
export function withoutCaptureText<T extends Pick<Transaction, 'review'>>(tx: T): T {
  if (!tx.review?.rawText) return tx
  const { rawText: _drop, ...review } = tx.review
  return { ...tx, review }
}
