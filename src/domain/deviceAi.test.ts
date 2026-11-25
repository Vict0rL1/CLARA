import { describe, expect, it } from 'vitest'
import { chooseEntries, DEVICE_AI_ENTRIES_MAX, entriesFromDeviceAi, receiptFromDeviceAi } from './deviceAi'
import type { ParseContext } from './parser'

/*
 * Respuestas SIMULADAS de la IA del iPhone (Foundation Models): estas pruebas comprueban lo que Clara hace con ellas,
 * no al modelo. Presupuesto en CAD, hoy 25-nov-2026.
 */
const ctx: ParseContext = {
  today: '2026-11-25',
  currency: 'CAD',
  language: 'es',
  categories: [
    { id: 'dining', kind: 'expense' },
    { id: 'transport', kind: 'expense' },
    { id: 'groceries', kind: 'expense' },
    { id: 'other_expense', kind: 'expense' },
    { id: 'salary', kind: 'income' },
  ],
}
const DICTATED = 'pues el café de esta mañana fueron 4,50 y luego el uber de ayer 18'

describe('entriesFromDeviceAi', () => {
  it('cada propuesta cita su trozo; el importe sale del analizador de siempre y la IA aporta descripción, categoría y fecha', () => {
    const entries = entriesFromDeviceAi(
      {
        entries: [
          { fragment: 'el uber de ayer 18', amount: '18', description: 'Uber', category: 'transport', date: '2026-11-24', kind: 'expense' },
          { fragment: 'el café de esta mañana fueron 4,50', amount: '4.50', description: 'Café', category: 'dining', kind: 'expense' },
        ],
      },
      DICTATED,
      ctx,
    )!
    // En el orden del texto, aunque la IA las devuelva al revés.
    expect(entries.map((e) => [e.amountMinor, e.description, e.categoryId, e.date, e.kind, e.suggestedBy])).toEqual([
      [450, 'Café', 'dining', '2026-11-25', 'expense', 'deviceAi'],
      [1800, 'Uber', 'transport', '2026-11-24', 'expense', 'deviceAi'],
    ])
  })

  it('un trozo que no está en el texto es una invención: se descarta (y sin ninguno válido, null)', () => {
    expect(entriesFromDeviceAi({ entries: [{ fragment: 'cena 80', amount: '80' }] }, DICTATED, ctx)).toBeNull()
    const one = entriesFromDeviceAi({ entries: [{ fragment: 'cena 80', amount: '80' }, { fragment: 'uber de ayer 18' }] }, DICTATED, ctx)!
    expect(one.map((e) => e.amountMinor)).toEqual([1800])
  })

  it('la IA no puede cambiar el importe que el analizador lee en el trozo', () => {
    const [e] = entriesFromDeviceAi({ entries: [{ fragment: 'uber de ayer 18', amount: '180' }] }, DICTATED, ctx)!
    expect(e!.amountMinor).toBe(1800)
  })

  it('solo si el analizador no encuentra importe se usa el de la IA, escrito como decimal canónico, y con poca confianza', () => {
    // Límite conocido: el analizador lee «cuatro» (4,00, importe en palabras, con poca confianza) y manda sobre lo que
    // diga la IA (4,50): la IA no decide un importe que el analizador sabe leer. La persona lo corrige en la vista previa.
    const words = 'taxi cuatro con cincuenta'
    const [e] = entriesFromDeviceAi({ entries: [{ fragment: words, amount: '4.50', description: 'Taxi' }] }, words, ctx)!
    expect([e!.amountMinor, e!.hints.includes('amountWords')]).toEqual([400, true])
    const [n] = entriesFromDeviceAi({ entries: [{ fragment: 'taxi', amount: '4.50' }] }, 'taxi', ctx)!
    expect([n!.amountMinor, n!.confidence]).toEqual([450, 0.3])
    // Un importe con flotantes raros, separador de miles o demasiados decimales no vale.
    for (const amount of ['4,50', '1,000.00', '4.505', '-3', '4.5e2', 'cuatro']) {
      const [x] = entriesFromDeviceAi({ entries: [{ fragment: 'taxi', amount }] }, 'taxi', ctx)!
      expect(x!.amountMinor, amount).toBeNull()
    }
  })

  it('otra moneda escrita en el trozo queda escrita (nunca se convierte), diga lo que diga la IA', () => {
    const [e] = entriesFromDeviceAi({ entries: [{ fragment: 'ramen ¥1,200', amount: '1200' }] }, 'cené ramen ¥1,200', ctx)!
    expect(e!.foreignCurrency).toBe('¥')
  })

  it('fecha, categoría y tipo de la IA solo si son válidos; las reglas de la persona ganan', () => {
    const [e] = entriesFromDeviceAi({ entries: [{ fragment: 'café 4,50', category: 'salary', date: '2026-12-01', kind: 'regalo' }] }, 'café 4,50', ctx)!
    expect([e!.categoryId, e!.date, e!.kind]).toEqual(['dining', '2026-11-25', 'expense'])
    const old = entriesFromDeviceAi({ entries: [{ fragment: 'café 4,50', date: '2025-01-01' }] }, 'café 4,50', ctx)!
    expect(old[0]!.date).toBe('2026-11-25')
    const withRule = { ...ctx, rules: [{ pattern: 'cafe', kind: 'expense' as const, categoryId: 'groceries' }] }
    expect(entriesFromDeviceAi({ entries: [{ fragment: 'café 4,50', category: 'dining' }] }, 'café 4,50', withRule)![0]!.categoryId).toBe('groceries')
  })

  it('una respuesta sin la forma esperada no se usa', () => {
    for (const raw of [null, 'texto', {}, { entries: 'x' }, { entries: [] }, { entries: Array.from({ length: DEVICE_AI_ENTRIES_MAX + 1 }, () => ({ fragment: 'café 4,50' })) }]) {
      expect(entriesFromDeviceAi(raw, 'café 4,50', ctx)).toBeNull()
    }
  })
})

describe('chooseEntries', () => {
  it('con una respuesta válida, lo de la IA', () => {
    const r = chooseEntries({ entries: [{ fragment: 'café 4,50' }, { fragment: 'uber 18' }] }, 'café 4,50 y uber 18', ctx)
    expect([r.by, r.entries.length]).toEqual(['deviceAi', 2])
  })

  it('si la IA falla o propone menos movimientos que el analizador de siempre, se usa el de siempre', () => {
    expect(chooseEntries(null, 'café 4,50 y uber 18', ctx)).toMatchObject({ by: 'local', reason: 'aiFailed' })
    const fewer = chooseEntries({ entries: [{ fragment: 'café 4,50' }] }, 'café 4,50 y uber 18', ctx)
    expect(fewer).toMatchObject({ by: 'local', reason: 'aiFewer' })
    expect(fewer.entries.map((e) => e.amountMinor)).toEqual([450, 1800])
    expect(fewer.entries.every((e) => e.suggestedBy === undefined)).toBe(true)
  })
})

describe('receiptFromDeviceAi', () => {
  const OCR = 'CAFE CENTRAL\n24/11/2026\nCAPUCCINO 4.25\nPAGADO CON TARJETA 4.25\nGRACIAS'

  it('acepta el total solo si cita su línea y el importe está en ella', () => {
    expect(receiptFromDeviceAi({ total: '4.25', fragment: 'PAGADO CON TARJETA 4.25', date: '2026-11-24', merchant: 'Café Central' }, OCR, ctx)).toEqual({ totalMinor: 425, date: '2026-11-24', merchant: 'Café Central' })
  })

  it('un total que no está en la línea citada, o una línea que no está en el recibo, no vale', () => {
    expect(receiptFromDeviceAi({ total: '42.50', fragment: 'PAGADO CON TARJETA 4.25' }, OCR, ctx)).toBeNull()
    expect(receiptFromDeviceAi({ total: '4.25', fragment: 'TOTAL 4.25' }, OCR, ctx)).toBeNull()
    expect(receiptFromDeviceAi({ total: 4.25, fragment: 'PAGADO CON TARJETA 4.25' }, OCR, ctx)).toBeNull()
    expect(receiptFromDeviceAi(null, OCR, ctx)).toBeNull()
  })

  it('una fecha futura o un comercio vacío no se usan', () => {
    expect(receiptFromDeviceAi({ total: '4.25', fragment: 'CAPUCCINO 4.25', date: '2027-01-01', merchant: '  ' }, OCR, ctx)).toEqual({ totalMinor: 425 })
  })
})
