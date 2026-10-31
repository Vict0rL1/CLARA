/**
 * Cota de exactitud (revisiones de la pasada QA27: O1 financiera, O-10 de seguridad, O-1 en navegador).
 *
 * Los importes individuales ya están acotados (`MAX_AMOUNT_MINOR`), pero sus SUMAS no lo estaban: con bastantes
 * movimientos cerca del máximo, un total por periodo o categoría pasaba de 2⁵³ − 1 y se redondeaba en silencio
 * (acumulación en coma flotante), o `sumMinor` lanzaba y la pantalla caía en «No se pudo abrir esta pantalla». La regla
 * de Clara es que una cifra que no cabe en un entero exacto no se redondea ni se recorta y nunca rompe una pantalla.
 *
 * Cada importe entra en los cálculos con un signo: lo que ENTRA (ingresos, devoluciones, saldos de referencia
 * positivos, ajustes al alza) y lo que SALE (gastos, saldos de referencia negativos, ajustes a la baja); una
 * transferencia entra en una cuenta y sale de otra, así que cuenta en los dos lados. Mientras la suma de lo que entra y
 * la suma de lo que sale (movimientos realizados y previstos, y la papelera) no pasen de 2⁵³ − 1 cada una, CUALQUIER
 * suma parcial con signo de esos importes —saldo de una cuenta en cualquier momento, total de un periodo o de una
 * categoría, acumulado diario, comercio, estimación de gasto, saldo al empezar un periodo— queda entre −2⁵³ + 1 y
 * 2⁵³ − 1 y es un entero exacto, también en cada paso intermedio de una resta. Por eso los datos que pasan de la cota
 * no se aceptan (importar una copia, cargar lo guardado) ni se crean (guardar un movimiento, marcar pagado, importar
 * del banco, saldo de referencia, cuenta nueva con saldo). La papelera cuenta para que restaurar nunca cambie la cota.
 * Lo programado no entra: sus proyecciones usan `stopWhenOutOfRange` (FIN-01) o se declaran sin cifra.
 *
 * Hacen falta ≥ 9 008 movimientos de 10¹² del mismo lado para alcanzarla: solo datos sintéticos. Los 5 000 gastos y
 * 5 000 devoluciones de 987 654 321 000 de la auditoría (≈ 4,9 × 10¹⁵ por lado) entran.
 */
import type { AppData, Transaction } from './types'
import type { Issue } from './validation'

/** Suma máxima por lado con la que toda suma parcial con signo sigue siendo un entero exacto. */
export const EXACT_RANGE_MAX_MINOR = Number.MAX_SAFE_INTEGER

export interface SignedMagnitudes {
  /** Lo que entra: ingresos, devoluciones, transferencias, ajustes al alza, saldos de referencia positivos. */
  inflowMinor: number
  /** Lo que sale: gastos, transferencias, ajustes a la baja, saldos de referencia negativos. */
  outflowMinor: number
}

function add(m: SignedMagnitudes, t: Pick<Transaction, 'kind' | 'amountMinor' | 'adjustmentDirection'>): void {
  const a = Math.abs(t.amountMinor)
  if (t.kind === 'expense') m.outflowMinor += a
  else if (t.kind === 'transfer') {
    m.inflowMinor += a
    m.outflowMinor += a
  } else if (t.kind === 'adjustment') {
    if (t.adjustmentDirection === 'decrease') m.outflowMinor += a
    else m.inflowMinor += a
  } else m.inflowMinor += a
}

/**
 * Sumas por lado en coma flotante. Con términos ≥ 0 la comparación con 2⁵³ − 1 es exacta: mientras la suma real no
 * pasa de 2⁵³ − 1, cada suma parcial es un entero representable y el resultado es exacto; en cuanto la pasa, el
 * resultado redondeado es ≥ 2⁵³ y ya no vuelve a bajar.
 */
export function signedMagnitudes(data: Pick<AppData, 'accounts' | 'transactions' | 'trash'>): SignedMagnitudes {
  const m: SignedMagnitudes = { inflowMinor: 0, outflowMinor: 0 }
  for (const acc of data.accounts) {
    const a = acc.anchor.amountMinor
    if (a >= 0) m.inflowMinor += a
    else m.outflowMinor -= a
  }
  for (const t of data.transactions) add(m, t)
  for (const e of data.trash) add(m, e.transaction)
  return m
}

export function exceedsExactRange(data: Pick<AppData, 'accounts' | 'transactions' | 'trash'>): boolean {
  const m = signedMagnitudes(data)
  return m.inflowMinor > EXACT_RANGE_MAX_MINOR || m.outflowMinor > EXACT_RANGE_MAX_MINOR
}

/** Problema que devuelven las operaciones y la validación cuando los datos pasarían de la cota. */
export function exactRangeIssue(path = 'amountMinor'): Issue {
  return { path, code: 'amountsBeyondExactRange' }
}
