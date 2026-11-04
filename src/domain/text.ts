/** Texto comparable, compartido por reglas, comercios, búsqueda y duplicados. */

/** Minúsculas, sin acentos y con espacios simples: "  CAFÉ  Central " → "cafe central". */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}
