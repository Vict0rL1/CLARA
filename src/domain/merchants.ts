/**
 * Comercios (Clara 2.0 §7, fase 2): la misma tienda llega escrita de muchas formas en los extractos
 * del banco («UBER *EATS 8XK2L TORONTO», «SQ *CAFE CENTRAL», «AMZN Mktp CA*2K3LZ»). Aquí se limpia de
 * forma determinista, sin listas remotas ni IA:
 *
 * - prefijo del procesador de pagos seguido de «*» (`SQ *`, `TST*`, `PAYPAL *`, `PP*`…): se quita;
 * - signos (`*`, `#`, `.`, `/`, `-`, `&`…): pasan a ser espacios;
 * - códigos de referencia: palabras de 4 o más caracteres con algún dígito («8XK2L», «000123») o
 *   números de 3 o más cifras («1234»): se quitan. Un número corto («7» de «7-Eleven») se queda.
 *
 * Nunca cambia lo guardado: solo sirve para comparar (reglas, agrupar comercios) y para proponer un
 * texto de regla más limpio, que la persona ve y puede editar antes de guardarlo.
 */
import { normalizeText } from './text'

/** Prefijos de procesadores de pago que los bancos anteponen con «*». */
const PROCESSOR_PREFIX = /^\s*(sq|tst|pp|paypal|sp|dd|ic|wpy|ctlp|sumup|zettle|izettle|pos)\s*\*\s*/i

function isReference(token: string): boolean {
  if (/^\d+$/.test(token)) return token.length >= 3
  return token.length >= 4 && /\d/.test(token)
}

/** Palabras del comercio, con su forma original (mayúsculas y acentos), sin prefijo ni referencias. */
export function merchantTokens(text: string): string[] {
  const withoutPrefix = text.replace(PROCESSOR_PREFIX, '')
  return withoutPrefix
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== '' && !isReference(token))
}

/** Clave para comparar: las palabras del comercio, normalizadas («uber eats toronto»). */
export function merchantKey(text: string): string {
  return normalizeText(merchantTokens(text).join(' '))
}

/** Texto limpio para proponer como regla o mostrar («UBER EATS TORONTO»); vacío si no queda nada. */
export function merchantLabel(text: string): string {
  return merchantTokens(text).join(' ')
}
