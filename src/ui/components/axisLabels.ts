/**
 * Etiquetas del eje X de un gráfico de barras según la anchura del hueco (auditoría de seguimiento, F-05).
 *
 * Cada punto ofrece sus formas de etiqueta de la más larga a la más corta («1 jul 2026», «1 jul»). Se elige UNA
 * forma para todo el eje: la más larga con la que ninguna etiqueta se sale de su hueco. Si ni la más corta cabe, se
 * muestra cada k-ésima etiqueta (contando desde la última, que es el periodo actual y nunca se oculta). La fecha
 * completa sigue en el tooltip, en el nombre accesible y en la tabla; aquí solo se decide qué se dibuja.
 *
 * La anchura se estima (no hay DOM al decidir): `.stats-axis` es 11 px en unidades del viewBox, 600, con cifras
 * tabulares; una letra o cifra ≈ 0,62 em y un espacio ≈ 0,32 em. La guarda de maquetación (e2e) comprueba el
 * resultado real en es/en/pt/fr y en los tres tamaños.
 */
export const AXIS_FONT_PX = 11
const CHAR_EM = 0.62
const SPACE_EM = 0.32
/** Separación mínima entre dos etiquetas vecinas (unidades del viewBox). */
const GAP = 3

export function estimateAxisTextWidth(text: string): number {
  let em = 0
  for (const ch of text) em += ch === ' ' ? SPACE_EM : CHAR_EM
  return em * AXIS_FONT_PX
}

/**
 * Qué etiqueta dibujar en cada punto (`null` = ninguna). `forms[i]` son las formas del punto `i`, de la más larga a la
 * más corta (al menos una); `slot` es la anchura del hueco de cada punto.
 */
export function pickAxisLabels(forms: readonly (readonly string[])[], slot: number): (string | null)[] {
  const n = forms.length
  if (n === 0) return []
  const available = Math.max(0, slot - GAP)
  const formCount = Math.max(...forms.map((f) => f.length))
  const at = (i: number, form: number) => forms[i]![Math.min(form, forms[i]!.length - 1)] ?? ''
  for (let form = 0; form < formCount; form++) {
    if (forms.every((_, i) => estimateAxisTextWidth(at(i, form)) <= available)) return forms.map((_, i) => at(i, form))
  }
  // Ni la forma más corta cabe: una de cada `every`, siempre la última.
  const last = formCount - 1
  const widest = Math.max(...forms.map((_, i) => estimateAxisTextWidth(at(i, last))))
  const every = available > 0 ? Math.ceil(widest / available) : n
  return forms.map((_, i) => ((n - 1 - i) % every === 0 ? at(i, last) : null))
}
