/** Escalas de los gráficos SVG (sin React: se prueban como funciones puras). */

/**
 * Escala vertical con signo: el cero siempre está dentro del eje y los valores negativos bajan de él.
 * `bar(v)` da `y` y `height` (siempre ≥ 0) de una barra que sale del cero.
 */
export function signedScale(values: readonly number[], top: number, bottom: number) {
  const max = Math.max(1, ...values)
  const min = Math.min(0, ...values)
  const y = (v: number) => top + ((bottom - top) * (max - v)) / (max - min)
  const bar = (v: number) => ({ y: Math.min(y(v), y(0)), height: Math.abs(y(v) - y(0)) })
  return { y, bar, min, max }
}
