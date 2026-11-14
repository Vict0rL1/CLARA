import { describe, expect, it } from 'vitest'
import { canonicalDecimalToMinor, readCaptureAmount, readCaptureQueue } from './captureQueue'

const line = (o: Record<string, unknown>) => JSON.stringify({ captureId: 'cap-00000001', createdAt: '2026-12-20T03:14:15Z', origin: 'apple_pay', rawAmount: '12.50', ...o })
const CAD = { currency: 'CAD', numberLocale: 'en-CA' }

describe('cola de capturas: leer el archivo (decisión 157)', () => {
  it('lee cada línea válida y conserva lo que dijo el sistema', () => {
    const text = [line({ merchant: '  Tim   Hortons ', card: 'Visa ••1234', currencyHint: 'cad' }), line({ captureId: 'cap-00000002', origin: 'siri' })].join('\n') + '\n'
    const read = readCaptureQueue(text)
    expect(read.issues).toEqual([])
    expect(read.partialTail).toBe(false)
    expect(read.records).toEqual([
      { captureId: 'cap-00000001', createdAt: '2026-12-20T03:14:15Z', origin: 'apple_pay', rawAmount: '12.50', currencyHint: 'CAD', merchant: 'Tim Hortons', card: 'Visa ••1234' },
      { captureId: 'cap-00000002', createdAt: '2026-12-20T03:14:15Z', origin: 'siri', rawAmount: '12.50' },
    ])
  })

  it('una línea mala se señala con su número y no impide leer las demás; nunca se descarta en silencio', () => {
    const text = [
      line({}),
      '{esto no es json',
      line({ captureId: 'corto' }),
      line({ captureId: 'cap-00000003', createdAt: '2026-12-20 03:14' }),
      line({ captureId: 'cap-00000004', origin: 'email' }),
      line({ captureId: 'cap-00000005', rawAmount: '' }),
      line({ captureId: 'cap-00000006', currencyHint: 12 }),
      line({ captureId: 'cap-00000007', rawText: 'x'.repeat(2001) }),
      line({}),
      '[]',
      line({ captureId: 'cap-00000008' }),
    ].join('\n')
    const read = readCaptureQueue(text)
    expect(read.records.map((r) => r.captureId)).toEqual(['cap-00000001', 'cap-00000008'])
    expect(read.issues).toEqual([
      { line: 2, issue: 'json' },
      { line: 3, issue: 'captureId' },
      { line: 4, issue: 'createdAt' },
      { line: 5, issue: 'origin' },
      { line: 6, issue: 'rawAmount' },
      { line: 7, issue: 'currencyHint' },
      { line: 8, issue: 'text' },
      { line: 9, issue: 'duplicateId' },
      { line: 10, issue: 'shape' },
    ])
  })

  it('una última línea a medias (se está escribiendo) no es un error: se lee la próxima vez', () => {
    const text = line({}) + '\n' + line({ captureId: 'cap-00000002' }).slice(0, 40)
    const read = readCaptureQueue(text)
    expect(read.records).toHaveLength(1)
    expect(read.issues).toEqual([])
    expect(read.partialTail).toBe(true)
  })

  it('líneas vacías y finales de línea de Windows no cuentan', () => {
    const read = readCaptureQueue(`\n${line({})}\r\n\r\n`)
    expect(read.records).toHaveLength(1)
    expect(read.issues).toEqual([])
  })

  it('el comercio se recorta al límite de nombres (60) y los espacios se normalizan', () => {
    const read = readCaptureQueue(line({ merchant: 'A'.repeat(100) }))
    expect(read.records[0]!.merchant).toBe('A'.repeat(60))
  })
})

describe('cola de capturas: el importe, sin flotantes ni conversiones', () => {
  it('decimal canónico → unidades menores según los decimales de la moneda (cálculo a mano)', () => {
    expect(canonicalDecimalToMinor('12.5', 'CAD')).toBe(1250)
    expect(canonicalDecimalToMinor('12.500', 'CAD')).toBe(1250)
    expect(canonicalDecimalToMinor('0.07', 'CAD')).toBe(7)
    expect(canonicalDecimalToMinor('1200', 'JPY')).toBe(1200)
    expect(canonicalDecimalToMinor('12500', 'KRW')).toBe(12500)
    expect(canonicalDecimalToMinor('88.3', 'CNY')).toBe(8830)
    // 0.1 + 0.2 en flotante es 0.30000000000000004; aquí no hay flotantes.
    expect(canonicalDecimalToMinor('0.30', 'CAD')).toBe(30)
    // Más precisión de la que tiene la moneda: no se redondea.
    expect(canonicalDecimalToMinor('12.345', 'CAD')).toBeNull()
    expect(canonicalDecimalToMinor('1200.5', 'JPY')).toBeNull()
    // Cero, notación científica, signos o separadores: no es un decimal canónico.
    for (const bad of ['0', '0.00', '1e3', '-5', '+5', '1,200', '12.', '.5', ' 12']) expect(canonicalDecimalToMinor(bad, 'CAD'), bad).toBeNull()
    expect(canonicalDecimalToMinor('12', 'XXX')).toBeNull()
  })

  it('con el código del sistema: en la moneda del presupuesto o en otra, sin convertir', () => {
    expect(readCaptureAmount({ rawAmount: '12.5', currencyHint: 'CAD' }, CAD)).toEqual({ kind: 'budget', minor: 1250 })
    expect(readCaptureAmount({ rawAmount: '1200', currencyHint: 'JPY' }, CAD)).toEqual({ kind: 'foreign', currency: 'JPY', minor: 1200 })
    expect(readCaptureAmount({ rawAmount: '88.3', currencyHint: 'cny' }, CAD)).toEqual({ kind: 'foreign', currency: 'CNY', minor: 8830 })
    expect(readCaptureAmount({ rawAmount: '12.345', currencyHint: 'CAD' }, CAD)).toEqual({ kind: 'unreadable', text: '12.345' })
    // Un código que no es una moneda admitida no se interpreta.
    expect(readCaptureAmount({ rawAmount: '10', currencyHint: 'XXX' }, CAD)).toEqual({ kind: 'unreadable', text: '10' })
  })

  it('«¥» suelto con un presupuesto en dólares canadienses: yen o yuan, nunca se adivina', () => {
    expect(readCaptureAmount({ rawAmount: '¥1,200' }, CAD)).toEqual({ kind: 'ambiguous', candidates: ['JPY', 'CNY'], text: '¥1,200' })
    expect(readCaptureAmount({ rawAmount: '￥88.30' }, CAD)).toEqual({ kind: 'ambiguous', candidates: ['JPY', 'CNY'], text: '￥88.30' })
  })

  it('«JP¥» y «CN¥» (como escribe un iPhone de Canadá el yen y el yuan) no son ambiguos', () => {
    expect(readCaptureAmount({ rawAmount: 'JP¥1,200' }, CAD)).toEqual({ kind: 'foreign', currency: 'JPY', minor: 1200 })
    expect(readCaptureAmount({ rawAmount: 'CN¥88.30' }, CAD)).toEqual({ kind: 'foreign', currency: 'CNY', minor: 8830 })
  })

  it('«¥» con un presupuesto en yenes es el yen, como en el resto de la app', () => {
    expect(readCaptureAmount({ rawAmount: '¥1,200' }, { currency: 'JPY', numberLocale: 'ja-JP' })).toEqual({ kind: 'budget', minor: 1200 })
  })

  it('el texto de Atajos se lee con el lector de monedas de toda la app', () => {
    expect(readCaptureAmount({ rawAmount: '$12.50' }, CAD)).toEqual({ kind: 'budget', minor: 1250 })
    expect(readCaptureAmount({ rawAmount: 'CA$12.50' }, CAD)).toEqual({ kind: 'budget', minor: 1250 })
    expect(readCaptureAmount({ rawAmount: '12.50' }, CAD)).toEqual({ kind: 'budget', minor: 1250 })
    expect(readCaptureAmount({ rawAmount: 'US$12.50' }, CAD)).toEqual({ kind: 'foreign', currency: 'USD', minor: 1250 })
    expect(readCaptureAmount({ rawAmount: '₩12,500' }, CAD)).toEqual({ kind: 'foreign', currency: 'KRW', minor: 12500 })
    expect(readCaptureAmount({ rawAmount: '£3.20' }, CAD)).toEqual({ kind: 'foreign', currency: 'GBP', minor: 320 })
    expect(readCaptureAmount({ rawAmount: '12,50 €' }, { currency: 'CAD', numberLocale: 'fr-CA' })).toEqual({ kind: 'foreign', currency: 'EUR', minor: 1250 })
  })

  it('los ejemplos del encargo, con cada formato de número de la app', () => {
    for (const numberLocale of ['es-MX', 'en-CA', 'fr-CA', 'es-ES']) {
      const settings = { currency: 'CAD', numberLocale }
      // Una coma con dos cifras detrás es el decimal; un número no se lee distinto según el formato elegido.
      expect(readCaptureAmount({ rawAmount: '12,50' }, settings), numberLocale).toEqual({ kind: 'budget', minor: 1250 })
      expect(readCaptureAmount({ rawAmount: '1.234,56 €' }, settings), numberLocale).toEqual({ kind: 'foreign', currency: 'EUR', minor: 123456 })
      // El won no tiene decimales: 15 000 unidades.
      expect(readCaptureAmount({ rawAmount: '₩15,000' }, settings), numberLocale).toEqual({ kind: 'foreign', currency: 'KRW', minor: 15000 })
      expect(readCaptureAmount({ rawAmount: '¥1,200' }, settings), numberLocale).toEqual({ kind: 'ambiguous', candidates: ['JPY', 'CNY'], text: '¥1,200' })
      expect(readCaptureAmount({ rawAmount: 'abc€' }, settings).kind, numberLocale).toBe('unreadable')
    }
    // Vacío: la línea no se acepta en la cola (ni llega a leerse el importe).
    expect(readCaptureQueue(line({ rawAmount: '   ' }) + '\n')).toMatchObject({ records: [], issues: [{ line: 1, issue: 'rawAmount' }] })
  })

  it('dos monedas que se contradicen, un código desconocido o un número raro: no se entiende', () => {
    expect(readCaptureAmount({ rawAmount: 'USD 10 CAD' }, CAD).kind).toBe('unreadable')
    expect(readCaptureAmount({ rawAmount: 'ABC 10' }, CAD).kind).toBe('unreadable')
    expect(readCaptureAmount({ rawAmount: 'doce' }, CAD).kind).toBe('unreadable')
    expect(readCaptureAmount({ rawAmount: '0.00' }, CAD).kind).toBe('unreadable')
  })
})
