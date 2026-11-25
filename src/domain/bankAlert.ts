/**
 * Avisos de texto del banco (Fase 4 nativa, decisión 183): el SMS o la alerta que una automatización de Atajos pasa a
 * «Registrar desde texto». El Swift no lo interpreta: llega a la cola como `rawText` y aquí se decide qué dice.
 *
 * Dos niveles, y ninguno inventa el formato de un banco:
 *
 * 1. **Formatos conocidos** (`BANK_ALERT_PATTERNS`): uno por cada formato REAL que Victor haya pasado (con los números
 *    de tarjeta tapados). Cada uno lleva su ejemplo y una prueba que lo exige. Mientras la tabla esté vacía, ningún
 *    aviso se registra solo. Un formato conocido da importe y comercio, y la captura sigue el camino de Apple Pay:
 *    gasto «Por revisar» (o propuesta, con las mismas reglas: otra moneda, duplicado, «Guardar automáticamente»).
 * 2. **Texto desconocido**: queda como propuesta sin entender (`unparsed`), con el texto original, y no cuenta en ninguna
 *    cifra. Solo como AYUDA para escribir el importe se sugiere uno si en el texto hay exactamente un importe escrito con
 *    su moneda (símbolo, código o nombre pegados al número: «$4.25», «12,50 €», «USD 12.50»). Con dos o más (por ejemplo
 *    la compra y el saldo disponible), o con números sin moneda (tarjeta, fecha, hora), no se sugiere nada.
 *
 * El texto original solo se guarda mientras haga falta (encargo, §6): en la propuesta o en el movimiento «Por revisar»
 * hasta que la persona lo confirma; nunca en el historial ni en la papelera (`withoutCaptureText`, `captureText.ts`).
 */
import { readCaptureAmount, type CaptureAmount } from './captureQueue'
import { currencyMarksAround } from './money'
import { LIMITS } from './validation'

/** Un formato real de aviso de un banco. */
export interface BankAlertPattern {
  /** Estable y legible: banco, tipo de aviso e idioma (p. ej. «banco-compra-es»). */
  id: string
  /** Debe casar con el aviso ENTERO. Grupos con nombre: `amount` (obligatorio, tal como se escribe, con su moneda),
   *  `merchant` y `card` (opcionales). */
  re: RegExp
  /** Solo las compras se convierten en gasto. Otros tipos (devolución, rechazo…) se añaden cuando haya ejemplos. */
  kind: 'purchase'
  /** El aviso real del que sale el patrón, con los números tapados. La prueba comprueba que casa y qué lee. */
  example: string
}

/**
 * Formatos conocidos. VACÍA hasta tener ejemplos reales de los avisos de Victor (encargo, §4 Fase 4: «No inventes
 * formatos de bancos»). Para añadir uno: el aviso real con los números tapados como `example`, el patrón y una prueba
 * en `bankAlert.test.ts` con el importe y el comercio calculados a mano.
 */
export const BANK_ALERT_PATTERNS: readonly BankAlertPattern[] = []

export type BankAlertRead =
  | { kind: 'known'; pattern: string; amount: CaptureAmount; merchant?: string; card?: string }
  /** `guess`: el único importe escrito con su moneda (tal como se escribió y leído), para rellenar el campo; `null` si
   *  no hay uno solo. */
  | { kind: 'unknown'; guess: AlertGuess | null }

export interface AlertGuess {
  /** Como aparece en el aviso («$4.25», «12,50 €»). */
  text: string
  amount: Exclude<CaptureAmount, { kind: 'unreadable' }>
}

/** Lo más largo que se guarda de un aviso (igual que `CAPTURE_TEXT_MAX`, que lo valida en la cola y en los datos). */
export const BANK_ALERT_TEXT_MAX = 2000

const clean = (s: string | undefined, max: number) => {
  const v = (s ?? '').replace(/\s+/g, ' ').trim()
  return v ? v.slice(0, max) : undefined
}

/**
 * Importes escritos en un texto libre: cifras con separadores de miles (punto, coma, espacio, apóstrofo) y decimales.
 * No arrastra dos números separados por un espacio («1234 4.25» son dos).
 */
const NUMBER = /(?<!\p{N})(?:\d{1,3}(?:[.,'\u00a0\u202f ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?![\p{N}])/gu

/** El único importe del texto escrito con su moneda (lo que se lee como un campo de importe), o `null`. */
export function singleMarkedAmount(text: string, settings: { currency: string; numberLocale: string }): AlertGuess | null {
  const found: string[] = []
  for (const m of text.matchAll(NUMBER)) {
    const start = m.index!
    const end = start + m[0].length
    const marks = currencyMarksAround(text, start, end)
    if (marks.length === 0) continue
    found.push(text.slice(Math.min(start, marks[0]!.start), Math.max(end, marks[marks.length - 1]!.end)))
    if (found.length > 1) return null
  }
  if (found.length !== 1) return null
  const written = found[0]!.trim().slice(0, 64)
  const amount = readCaptureAmount({ rawAmount: written }, settings)
  return amount.kind === 'unreadable' ? null : { text: written, amount }
}

/** Qué dice un aviso de texto: un formato conocido o, si no, como mucho una sugerencia de importe. */
export function readBankAlert(text: string, settings: { currency: string; numberLocale: string }, patterns: readonly BankAlertPattern[] = BANK_ALERT_PATTERNS): BankAlertRead {
  const body = text.replace(/\r\n?/g, '\n').trim()
  for (const p of patterns) {
    const m = new RegExp(`^(?:${p.re.source})$`, p.re.flags.replace('g', '')).exec(body)
    const raw = m?.groups?.amount
    if (!raw) continue
    const amount = readCaptureAmount({ rawAmount: raw.trim().slice(0, 64) }, settings)
    // Un formato conocido con un importe que no se lee no se da por bueno: sigue como texto desconocido.
    if (amount.kind === 'unreadable') break
    const merchant = clean(m.groups?.merchant, LIMITS.nameMax)
    const card = clean(m.groups?.card, 64)
    return { kind: 'known', pattern: p.id, amount, ...(merchant ? { merchant } : {}), ...(card ? { card } : {}) }
  }
  return { kind: 'unknown', guess: singleMarkedAmount(body, settings) }
}

/** Lo que se enseña como «importe sin entender» de un aviso desconocido: la sugerencia o el principio del texto. */
export function unknownAlertLabel(text: string, guess: string | null): string {
  if (guess) return guess.slice(0, 64)
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= 64 ? flat || '…' : `${flat.slice(0, 63)}…`
}
