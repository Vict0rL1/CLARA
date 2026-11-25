import { describe, expect, it } from 'vitest'
import { BANK_ALERT_PATTERNS, readBankAlert, singleMarkedAmount, unknownAlertLabel, type BankAlertPattern } from './bankAlert'
import { withoutCaptureText } from './captureText'
import type { Transaction } from './types'

/*
 * Presupuesto en CAD con números de es-MX (punto decimal, coma de miles), como las pruebas de la cola.
 *
 * IMPORTANTE: los textos de estas pruebas son inventados a propósito y NO imitan el aviso de ningún banco (encargo,
 * §4 Fase 4: «No inventes formatos de bancos»). Prueban el lector genérico y el mecanismo de los formatos; los formatos
 * reales se añaden a `BANK_ALERT_PATTERNS` con los ejemplos de Victor, y la última prueba los recorre.
 */
const CAD = { currency: 'CAD', numberLocale: 'es-MX' }

describe('singleMarkedAmount — el único importe escrito con su moneda', () => {
  it('lee el importe con su moneda y lo deja como se escribió', () => {
    expect(singleMarkedAmount('abc $4.25 xyz', CAD)).toEqual({ text: '$4.25', amount: { kind: 'budget', minor: 425 } })
    expect(singleMarkedAmount('total CA$1,234.50 ok', CAD)).toEqual({ text: 'CA$1,234.50', amount: { kind: 'budget', minor: 123450 } })
    expect(singleMarkedAmount('pago 12.50 CAD hoy', CAD)).toEqual({ text: '12.50 CAD', amount: { kind: 'budget', minor: 1250 } })
  })

  it('los números sin moneda (tarjeta, fecha, hora) no cuentan ni estorban', () => {
    expect(singleMarkedAmount('tarjeta ••1234 el 24/11 a las 10:30: $4.25', CAD)).toEqual({ text: '$4.25', amount: { kind: 'budget', minor: 425 } })
    expect(singleMarkedAmount('numero 1234 4.25', CAD)).toBeNull()
  })

  it('con dos importes con moneda (p. ej. lo pagado y lo disponible) no sugiere ninguno', () => {
    expect(singleMarkedAmount('uno $4.25 otro $1,234.56', CAD)).toBeNull()
    expect(singleMarkedAmount('$4.25 y 4.25 USD', CAD)).toBeNull()
  })

  it('otra moneda queda sin convertir y el «¥» suelto sigue siendo ambiguo: nunca se adivina', () => {
    expect(singleMarkedAmount('algo USD 12.50 algo', CAD)).toEqual({ text: 'USD 12.50', amount: { kind: 'foreign', currency: 'USD', minor: 1250 } })
    expect(singleMarkedAmount('algo ¥1,200 algo', CAD)).toEqual({ text: '¥1,200', amount: { kind: 'ambiguous', candidates: ['JPY', 'CNY'], text: '¥1,200' } })
    expect(singleMarkedAmount('algo ₩15,000 algo', CAD)).toEqual({ text: '₩15,000', amount: { kind: 'foreign', currency: 'KRW', minor: 15000 } })
  })

  it('nada que sugerir: texto vacío, sin importes o con una moneda desconocida', () => {
    expect(singleMarkedAmount('', CAD)).toBeNull()
    expect(singleMarkedAmount('sin importes', CAD)).toBeNull()
    expect(singleMarkedAmount('algo 12.50 XAU', CAD)).toBeNull()
  })
})

/** Un formato de PRUEBA, inventado: no es el de ningún banco. */
const TEST_ONLY: BankAlertPattern = {
  id: 'solo-prueba',
  re: /PRUEBA (?<amount>.+?) EN (?<merchant>.+?)(?: TARJETA (?<card>\S+))?/,
  kind: 'purchase',
  example: 'PRUEBA $4.25 EN CAFE CENTRAL TARJETA ••1234',
}

describe('readBankAlert', () => {
  it('un formato conocido da importe, comercio y tarjeta', () => {
    expect(readBankAlert('PRUEBA $4.25 EN CAFE CENTRAL TARJETA ••1234', CAD, [TEST_ONLY])).toEqual({
      kind: 'known',
      pattern: 'solo-prueba',
      amount: { kind: 'budget', minor: 425 },
      merchant: 'CAFE CENTRAL',
      card: '••1234',
    })
    expect(readBankAlert('  PRUEBA USD 12.50 EN   TIENDA  \n', CAD, [TEST_ONLY])).toEqual({ kind: 'known', pattern: 'solo-prueba', amount: { kind: 'foreign', currency: 'USD', minor: 1250 }, merchant: 'TIENDA' })
  })

  it('el formato tiene que casar con el aviso ENTERO; si no, es texto desconocido (con sugerencia si la hay)', () => {
    expect(readBankAlert('antes PRUEBA $4.25 EN CAFE', CAD, [TEST_ONLY])).toEqual({ kind: 'unknown', guess: { text: '$4.25', amount: { kind: 'budget', minor: 425 } } })
  })

  it('un formato conocido con un importe que no se lee no se da por bueno', () => {
    expect(readBankAlert('PRUEBA ??? EN CAFE', CAD, [TEST_ONLY])).toEqual({ kind: 'unknown', guess: null })
  })

  it('sin formatos conocidos todo aviso es desconocido: como mucho se sugiere un importe, nunca se registra solo', () => {
    expect(readBankAlert('PRUEBA $4.25 EN CAFE CENTRAL', CAD, [])).toEqual({ kind: 'unknown', guess: { text: '$4.25', amount: { kind: 'budget', minor: 425 } } })
  })

  it('cada formato real de la tabla casa con su propio ejemplo y lee un importe', () => {
    for (const p of BANK_ALERT_PATTERNS) {
      const read = readBankAlert(p.example, CAD)
      expect(read.kind, p.id).toBe('known')
      expect(read.kind === 'known' && read.pattern, p.id).toBe(p.id)
    }
    // Mientras no haya ejemplos reales de Victor, la tabla está vacía a propósito.
    expect(BANK_ALERT_PATTERNS.every((p) => p.example.trim().length > 0)).toBe(true)
  })
})

describe('unknownAlertLabel', () => {
  it('enseña la sugerencia; sin ella, el principio del texto en una línea (como mucho 64 caracteres)', () => {
    expect(unknownAlertLabel('lo que sea', '$4.25')).toBe('$4.25')
    expect(unknownAlertLabel('  dos\nlíneas  ', null)).toBe('dos líneas')
    const long = unknownAlertLabel('x'.repeat(100), null)
    expect(long).toHaveLength(64)
    expect(long.endsWith('…')).toBe(true)
    expect(unknownAlertLabel('   ', null)).toBe('…')
  })
})

describe('withoutCaptureText', () => {
  const tx = { id: 't', review: { needed: true, reason: 'auto_capture', rawText: 'texto del aviso', card: 'Visa ••1234' } } as unknown as Transaction

  it('quita solo el texto original; la marca, el motivo y la tarjeta se quedan', () => {
    expect(withoutCaptureText(tx).review).toEqual({ needed: true, reason: 'auto_capture', card: 'Visa ••1234' })
    expect(tx.review?.rawText).toBe('texto del aviso')
  })

  it('sin texto devuelve el mismo objeto', () => {
    const plain = { id: 'p' } as Transaction
    expect(withoutCaptureText(plain)).toBe(plain)
  })
})
