/**
 * Texto de una foto leído en el iPhone (Fase 5, decisión 188): Vision devuelve cada trozo de texto con su recuadro, y
 * en un recibo «TOTAL» y «12.50» suelen llegar como dos trozos de la misma fila. Aquí se juntan en líneas, de arriba
 * abajo y de izquierda a derecha, para que `receipt.ts` las lea como siempre. El Swift solo transporta los trozos.
 *
 * Coordenadas como las da Vision (`VNRecognizedTextObservation.boundingBox`): normalizadas de 0 a 1 y con el origen
 * ABAJO a la izquierda.
 */

export interface TextObservation {
  text: string
  x: number
  y: number
  width: number
  height: number
}

/** Como mucho se leen tantos trozos por foto (un recibo largo tiene unos 100). */
export const OCR_OBSERVATIONS_MAX = 600
const TEXT_MAX = 300

const inUnit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -0.01 && v <= 1.01

/** Los trozos válidos de lo que llegó del iPhone; lo que no tiene la forma esperada se ignora. */
export function readObservations(raw: unknown): TextObservation[] {
  if (!Array.isArray(raw)) return []
  const out: TextObservation[] = []
  for (const o of raw.slice(0, OCR_OBSERVATIONS_MAX)) {
    if (!o || typeof o !== 'object') continue
    const r = o as Record<string, unknown>
    const text = typeof r.text === 'string' ? r.text.replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX) : ''
    if (!text || !inUnit(r.x) || !inUnit(r.y) || !inUnit(r.width) || !inUnit(r.height) || (r.height as number) <= 0) continue
    out.push({ text, x: r.x as number, y: r.y as number, width: r.width as number, height: r.height as number })
  }
  return out
}

/**
 * Las líneas del texto: un trozo entra en la fila de otro si su centro vertical cae dentro de la altura de esa fila.
 * Dentro de una fila, de izquierda a derecha y separados por un espacio.
 */
export function linesFromObservations(observations: readonly TextObservation[]): string[] {
  // De arriba abajo: con el origen abajo, la parte de arriba es `y + height`.
  const sorted = [...observations].sort((a, b) => b.y + b.height / 2 - (a.y + a.height / 2) || a.x - b.x)
  const rows: { top: number; bottom: number; items: TextObservation[] }[] = []
  for (const o of sorted) {
    const center = o.y + o.height / 2
    const row = rows.find((r) => center <= r.top && center >= r.bottom)
    if (row) {
      row.items.push(o)
      row.top = Math.max(row.top, o.y + o.height)
      row.bottom = Math.min(row.bottom, o.y)
    } else rows.push({ top: o.y + o.height, bottom: o.y, items: [o] })
  }
  return rows.sort((a, b) => b.top + b.bottom - (a.top + a.bottom)).map((r) => r.items.sort((a, b) => a.x - b.x).map((o) => o.text).join(' '))
}
