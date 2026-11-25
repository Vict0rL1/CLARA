import { describe, expect, it } from 'vitest'
import { chooseEntries, receiptFromDeviceAi } from '../domain/deviceAi'
import type { ParseContext } from '../domain/parser'
import { parseReceiptText } from '../domain/receipt'
import { createDeviceAi, createDictation, createReceipts, DictationError, RECEIPT_SCAN_MAX, ReceiptScanError, SPEECH_LOCALES, type ClaraAIPlugin, type ClaraSpeechPlugin, type ClaraVisionPlugin } from './nativeAssistant'

/*
 * Respuestas SIMULADAS de los plugins del iPhone (Fase 5): lo que la web hace con ellas. Nada de esto dice que el Swift
 * funcione en un iPhone; eso solo lo prueba Victor.
 */
const reject = (code: string) => Promise.reject(Object.assign(new Error(code), { code }))

function speechFake(availability: Record<string, { available?: unknown; reason?: unknown }>) {
  const listeners = new Map<string, (d: { text?: unknown }) => void>()
  const calls: string[] = []
  let startResult: () => Promise<unknown> = () => Promise.resolve()
  const plugin: ClaraSpeechPlugin = {
    availability: ({ locale }) => (calls.push(`availability ${locale}`), Promise.resolve(availability[locale] ?? { available: false, reason: 'unsupportedLocale' })),
    start: ({ locale }) => (calls.push(`start ${locale}`), startResult()),
    stop: () => (calls.push('stop'), Promise.resolve({ text: ' café 4,50 y uber 18 ayer ' })),
    addListener: (event, listener) => {
      listeners.set(event, listener)
      return Promise.resolve({ remove: async () => void listeners.delete(event) })
    },
  }
  return { plugin, calls, listeners, failStart: (code: string) => (startResult = () => reject(code)) }
}

describe('dictado del iPhone', () => {
  it('usa el primer idioma de Clara que el iPhone reconoce EN el dispositivo', async () => {
    const fake = speechFake({ 'es-MX': { available: false, reason: 'noOnDevice' }, 'es-US': { available: true } })
    expect(await createDictation(fake.plugin).availability('es')).toEqual({ available: true, locale: 'es-US' })
    expect(fake.calls).toEqual(['availability es-MX', 'availability es-US'])
  })

  it('sin reconocimiento en el dispositivo para ninguno, dice el primer motivo; sin permiso no sigue probando', async () => {
    const none = speechFake({ 'fr-CA': { available: false, reason: 'noOnDevice' }, 'fr-FR': { available: false, reason: 'unsupportedLocale' } })
    expect(await createDictation(none.plugin).availability('fr')).toEqual({ available: false, reason: 'noOnDevice' })
    const denied = speechFake({ 'en-CA': { available: false, reason: 'denied' } })
    expect(await createDictation(denied.plugin).availability('en')).toEqual({ available: false, reason: 'denied' })
    expect(denied.calls).toEqual(['availability en-CA'])
    // Un motivo desconocido no se inventa: «no se pudo comprobar».
    const odd = speechFake(Object.fromEntries(SPEECH_LOCALES.pt.map((l) => [l, { available: false, reason: 'raro' }])))
    expect(await createDictation(odd.plugin).availability('pt')).toEqual({ available: false, reason: 'failed' })
  })

  it('lo reconocido llega mientras se habla y al parar; los oyentes se quitan', async () => {
    const fake = speechFake({})
    const dictation = createDictation(fake.plugin)
    const partial: string[] = []
    await dictation.start('es-MX', (t) => partial.push(t), () => {})
    fake.listeners.get('partial')!({ text: 'café 4,50' })
    fake.listeners.get('partial')!({ text: 42 })
    expect(partial).toEqual(['café 4,50', ''])
    expect(await dictation.stop()).toBe('café 4,50 y uber 18 ayer')
    expect(fake.listeners.size).toBe(0)
  })

  it('si termina solo, avisa con lo último; si no puede empezar, lanza con el motivo del iPhone', async () => {
    const fake = speechFake({})
    const dictation = createDictation(fake.plugin)
    let ended = ''
    await dictation.start('es-MX', () => {}, (t) => (ended = t))
    fake.listeners.get('end')!({ text: 'uber 18' })
    expect(ended).toBe('uber 18')
    fake.failStart('denied')
    await expect(dictation.start('es-MX', () => {}, () => {})).rejects.toMatchObject({ reason: 'denied' })
    fake.failStart('otro')
    const error = await dictation.start('es-MX', () => {}, () => {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DictationError)
    expect((error as DictationError).reason).toBe('failed')
    expect(fake.listeners.size).toBe(0)
  })
})

/** Un recuadro de Vision (origen abajo a la izquierda). */
const obs = (text: string, x: number, y: number) => ({ text, x, y, width: 0.2, height: 0.03 })
const RECEIPT = [obs('CAFE CENTRAL', 0.1, 0.9), obs('24/11/2026', 0.1, 0.85), obs('TOTAL', 0.1, 0.5), obs('4.25', 0.7, 0.5)]
const ctx: ParseContext = { today: '2026-11-25', currency: 'CAD', language: 'es', categories: [{ id: 'dining', kind: 'expense' }, { id: 'other_expense', kind: 'expense' }] }

function visionFake(pages: unknown, extra: Record<string, unknown> = {}) {
  const plugin: ClaraVisionPlugin = {
    availability: () => Promise.resolve({ text: true, scanner: true }),
    recognize: () => Promise.resolve({ observations: RECEIPT }),
    scan: () => Promise.resolve({ pages, skipped: 0, ...extra }),
  }
  return plugin
}

describe('recibos con Vision', () => {
  it('el texto de una foto sale en líneas y el lector de siempre encuentra total, fecha y comercio', async () => {
    const text = await createReceipts(visionFake([])).read('AAAA', 'es')
    expect(text?.lines).toEqual(['CAFE CENTRAL', '24/11/2026', 'TOTAL 4.25'])
    const receipt = parseReceiptText(text!.text, ctx)
    expect([receipt.totalMinor, receipt.date, receipt.merchant]).toEqual([425, '2026-11-24', 'CAFE CENTRAL'])
  })

  it('un escaneo entrega como mucho 5 recibos; lo que sobra o llega sin imagen válida se cuenta, no se lee', async () => {
    const page = { image: 'QUJD', observations: RECEIPT }
    const pages = [...Array.from({ length: RECEIPT_SCAN_MAX + 1 }, () => page), { image: 'no es base64!', observations: RECEIPT }, { observations: RECEIPT }]
    const scan = await createReceipts(visionFake(pages, { skipped: 2 })).scan('es')
    expect([scan.pages.length, scan.skipped, scan.cancelled]).toEqual([5, 2 + 3, false])
    expect(scan.pages[0]!.text.lines).toEqual(['CAFE CENTRAL', '24/11/2026', 'TOTAL 4.25'])
  })

  it('cancelar no es un error; sin cámara de documentos o si falla, lanza con el motivo', async () => {
    expect(await createReceipts(visionFake([], { cancelled: true })).scan('es')).toEqual({ pages: [], skipped: 0, cancelled: true })
    const broken = (code: string): ClaraVisionPlugin => ({ ...visionFake([]), scan: () => reject(code), availability: () => reject(code) })
    await expect(createReceipts(broken('unavailable')).scan('es')).rejects.toBeInstanceOf(ReceiptScanError)
    await expect(createReceipts(broken('unavailable')).scan('es')).rejects.toMatchObject({ reason: 'unavailable' })
    await expect(createReceipts(broken('x')).scan('es')).rejects.toMatchObject({ reason: 'failed' })
    expect(await createReceipts(broken('x')).scanner()).toBe(false)
  })
})

describe('IA del iPhone', () => {
  const ai = (over: Partial<ClaraAIPlugin>): ClaraAIPlugin => ({
    availability: () => Promise.resolve({ available: true }),
    extract: () => Promise.resolve({ json: JSON.stringify({ entries: [{ fragment: 'café 4,50', category: 'dining' }, { fragment: 'uber 18 ayer' }] }) }),
    receipt: () => Promise.resolve({ json: JSON.stringify({ fragment: 'TOTAL 4.25', total: '4.25' }) }),
    ...over,
  })

  it('«café 4,50 y uber 18 ayer» dictado: dos propuestas, cada una con su trozo, comprobadas contra el texto', async () => {
    const raw = await createDeviceAi(ai({})).extract('café 4,50 y uber 18 ayer', '2026-11-25', ['dining'])
    const chosen = chooseEntries(raw, 'café 4,50 y uber 18 ayer', ctx)
    expect(chosen.by).toBe('deviceAi')
    expect(chosen.entries.map((e) => [e.amountMinor, e.date, e.suggestedBy])).toEqual([
      [450, '2026-11-25', 'deviceAi'],
      [1800, '2026-11-24', 'deviceAi'],
    ])
  })

  it('el total de un recibo, solo si cita su línea', async () => {
    const raw = await createDeviceAi(ai({})).receipt('CAFE\nTOTAL 4.25', '2026-11-25')
    expect(receiptFromDeviceAi(raw, 'CAFE\nTOTAL 4.25', ctx)).toEqual({ totalMinor: 425, fragment: 'TOTAL 4.25' })
  })

  it('si no responde a tiempo, falla o devuelve algo que no es JSON: null, y manda el analizador de siempre', async () => {
    const slow = createDeviceAi(ai({ extract: () => new Promise(() => {}) }), 10)
    expect(await slow.extract('café 4,50', '2026-11-25', [])).toBeNull()
    expect(await createDeviceAi(ai({ extract: () => reject('failed') })).extract('café 4,50', '2026-11-25', [])).toBeNull()
    expect(await createDeviceAi(ai({ extract: () => Promise.resolve({ json: '{roto' }) })).extract('café 4,50', '2026-11-25', [])).toBeNull()
    expect(await createDeviceAi(ai({})).extract('x'.repeat(8001), '2026-11-25', [])).toBeNull()
    expect(chooseEntries(null, 'café 4,50 y uber 18 ayer', ctx)).toMatchObject({ by: 'local', reason: 'aiFailed' })
  })

  it('dice por qué no está disponible con los motivos del iPhone; uno desconocido es «unknown»', async () => {
    expect(await createDeviceAi(ai({ availability: () => Promise.resolve({ available: false, reason: 'appleIntelligenceNotEnabled' }) })).availability('es')).toEqual({ available: false, reason: 'appleIntelligenceNotEnabled' })
    expect(await createDeviceAi(ai({ availability: () => Promise.resolve({ available: false, reason: 'otro' }) })).availability('es')).toEqual({ available: false, reason: 'unknown' })
    expect(await createDeviceAi(ai({ availability: () => reject('x') })).availability('es')).toEqual({ available: false, reason: 'unknown' })
  })
})
