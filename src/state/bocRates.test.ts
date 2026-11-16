import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BOC_CACHE_KEY, BOC_CACHE_MAX, BOC_SETTING_KEY, bocEnabled, bocRatesFor, lookupBocRate, setBocEnabled } from './bocRates'

const fixtureText = (name: string) => readFileSync(new URL(`../domain/__fixtures__/boc/${name}`, import.meta.url), 'utf8')
const JPY = fixtureText('FXJPYCAD-2026-11-04_2026-11-10.json')
const NOT_FOUND = fixtureText('FXXXXCAD-404.json')

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), map }
}

/** Un `fetch` falso que apunta lo que se pidió y responde con el texto dado. */
function fakeFetch(body: string, status = 200) {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(body, { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fn, calls }
}

const TODAY = '2026-11-16'

describe('interruptor del Banco de Canadá', () => {
  it('apagado por defecto; se enciende y se apaga en este dispositivo', () => {
    const s = memory()
    expect(bocEnabled(s)).toBe(false)
    expect(setBocEnabled(true, s)).toBe(true)
    expect(bocEnabled(s)).toBe(true)
    expect(s.map.get(BOC_SETTING_KEY)).toBe('{"enabled":true}')
    setBocEnabled(false, s)
    expect(bocEnabled(s)).toBe(false)
    expect(bocEnabled(memory({ [BOC_SETTING_KEY]: 'no es json' }))).toBe(false)
    expect(bocEnabled(memory({ [BOC_SETTING_KEY]: '{"enabled":"yes"}' }))).toBe(false)
    expect(bocEnabled(null)).toBe(false)
  })
})

describe('pedir la tasa', () => {
  it('pide una serie y dos fechas, sin credenciales ni Referer ni cabeceras propias', async () => {
    const f = fakeFetch(JPY)
    const r = await lookupBocRate('CAD', 'JPY', '2026-11-08', TODAY, { fetch: f.fn, storage: memory() })
    expect(r).toEqual({ status: 'ok', rate: { rate: '0.00891', rateDate: '2026-11-06' }, cached: false })
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]!.url).toBe('https://www.bankofcanada.ca/valet/observations/FXJPYCAD/json?start_date=2026-10-29&end_date=2026-11-08')
    expect(f.calls[0]!.init).toMatchObject({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer' })
    expect(f.calls[0]!.init?.headers).toBeUndefined()
  })

  it('lo definitivo se guarda en la caché y la segunda vez no se pide', async () => {
    const s = memory()
    const f = fakeFetch(JPY)
    await lookupBocRate('CAD', 'JPY', '2026-11-08', TODAY, { fetch: f.fn, storage: s })
    const again = await lookupBocRate('CAD', 'JPY', '2026-11-08', TODAY, { fetch: f.fn, storage: s })
    expect(again).toEqual({ status: 'ok', rate: { rate: '0.00891', rateDate: '2026-11-06' }, cached: true })
    expect(f.calls).toHaveLength(1)
  })

  it('hoy, con la tasa de un día anterior, no se guarda: la del día aún puede publicarse', async () => {
    const s = memory()
    const f = fakeFetch(JPY)
    // Si «hoy» fuera el 11-nov, la del 10 es de ayer: se usa, pero se vuelve a pedir la próxima vez.
    const r = await lookupBocRate('CAD', 'JPY', '2026-11-11', '2026-11-11', { fetch: f.fn, storage: s })
    expect(r).toMatchObject({ status: 'ok', rate: { rateDate: '2026-11-10' } })
    expect(s.map.has(BOC_CACHE_KEY)).toBe(false)
    await lookupBocRate('CAD', 'JPY', '2026-11-11', '2026-11-11', { fetch: f.fn, storage: s })
    expect(f.calls).toHaveLength(2)
  })

  it('sin tasa en el margen: «none» (y se guarda si es definitivo)', async () => {
    const s = memory()
    const f = fakeFetch(JPY)
    expect(await lookupBocRate('CAD', 'JPY', '2026-11-03', TODAY, { fetch: f.fn, storage: s })).toEqual({ status: 'none' })
    expect(await lookupBocRate('CAD', 'JPY', '2026-11-03', TODAY, { fetch: f.fn, storage: s })).toEqual({ status: 'none' })
    expect(f.calls).toHaveLength(1)
  })

  it('serie inexistente (404) → none; otro error o algo que no se entiende → error; sin red → offline', async () => {
    expect(await lookupBocRate('CAD', 'JPY', '2026-11-08', TODAY, { fetch: fakeFetch(NOT_FOUND, 404).fn, storage: memory() })).toEqual({ status: 'none' })
    expect(await lookupBocRate('CAD', 'JPY', '2026-11-08', TODAY, { fetch: fakeFetch('{"message":"boom"}', 500).fn, storage: memory() })).toEqual({ status: 'error' })
    expect(await lookupBocRate('CAD', 'JPY', '2026-11-08', TODAY, { fetch: fakeFetch('<html>mantenimiento</html>').fn, storage: memory() })).toEqual({ status: 'error' })
    expect(await lookupBocRate('CAD', 'JPY', '2026-11-08', TODAY, { fetch: fakeFetch(JPY, 503).fn, storage: memory() })).toEqual({ status: 'error' })
    const offline = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const s = memory()
    expect(await lookupBocRate('CAD', 'JPY', '2026-11-08', TODAY, { fetch: offline, storage: s })).toEqual({ status: 'offline' })
    // Un fallo nunca se guarda.
    expect(s.map.has(BOC_CACHE_KEY)).toBe(false)
  })

  it('sin respuesta a tiempo se cancela: offline', async () => {
    const hang = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch
    expect(await lookupBocRate('CAD', 'JPY', '2026-11-08', TODAY, { fetch: hang, storage: memory(), timeoutMs: 5 })).toEqual({ status: 'offline' })
  })

  it('sin presupuesto en CAD o con una moneda sin serie no se pide nada', async () => {
    const f = fakeFetch(JPY)
    expect(await lookupBocRate('USD', 'JPY', '2026-11-08', TODAY, { fetch: f.fn, storage: memory() })).toEqual({ status: 'unsupported' })
    expect(await lookupBocRate('CAD', 'DKK', '2026-11-08', TODAY, { fetch: f.fn, storage: memory() })).toEqual({ status: 'unsupported' })
    expect(f.calls).toHaveLength(0)
  })

  it('una caché tocada o ilegible no da tasas: se vuelve a pedir', async () => {
    const f = fakeFetch(JPY)
    const bad = memory({ [BOC_CACHE_KEY]: JSON.stringify({ v: 1, entries: [['JPY|2026-11-08', { rate: '1e9', rateDate: '2026-11-06' }]] }) })
    expect(await lookupBocRate('CAD', 'JPY', '2026-11-08', TODAY, { fetch: f.fn, storage: bad })).toMatchObject({ status: 'ok', cached: false, rate: { rate: '0.00891' } })
    const junk = memory({ [BOC_CACHE_KEY]: '{' })
    expect(await lookupBocRate('CAD', 'JPY', '2026-11-08', TODAY, { fetch: f.fn, storage: junk })).toMatchObject({ status: 'ok', cached: false })
    expect(f.calls).toHaveLength(2)
  })

  it('la caché está acotada: salen las más viejas', async () => {
    const entries = Array.from({ length: BOC_CACHE_MAX }, (_, i) => [`USD|2020-01-${String((i % 28) + 1).padStart(2, '0')}#${i}`, { none: true }])
    const s = memory({ [BOC_CACHE_KEY]: JSON.stringify({ v: 1, entries }) })
    await lookupBocRate('CAD', 'JPY', '2026-11-08', TODAY, { fetch: fakeFetch(JPY).fn, storage: s })
    const saved = JSON.parse(s.map.get(BOC_CACHE_KEY)!) as { entries: [string, unknown][] }
    expect(saved.entries).toHaveLength(BOC_CACHE_MAX)
    expect(saved.entries.at(-1)).toEqual(['JPY|2026-11-08', { rate: '0.00891', rateDate: '2026-11-06' }])
    expect(saved.entries[0]![0]).toBe(entries[1]![0])
  })
})

describe('tasas para la lectura de capturas', () => {
  it('apagado: no pide nada', async () => {
    const f = fakeFetch(JPY)
    expect((await bocRatesFor('CAD', [{ currency: 'JPY', date: '2026-11-08' }], TODAY, { fetch: f.fn, storage: memory() })).size).toBe(0)
    expect(f.calls).toHaveLength(0)
  })

  it('encendido: cada (moneda, fecha) una sola vez; sin red, deja de insistir', async () => {
    const s = memory({ [BOC_SETTING_KEY]: '{"enabled":true}' })
    const f = fakeFetch(JPY)
    const out = await bocRatesFor('CAD', [{ currency: 'JPY', date: '2026-11-08' }, { currency: 'JPY', date: '2026-11-08' }, { currency: 'JPY', date: '2026-11-10' }], TODAY, { fetch: f.fn, storage: s })
    expect([...out.entries()]).toEqual([
      ['JPY|2026-11-08', { rate: '0.00891', rateDate: '2026-11-06' }],
      ['JPY|2026-11-10', { rate: '0.00894', rateDate: '2026-11-10' }],
    ])
    expect(f.calls).toHaveLength(2)
    let calls = 0
    const offline = (async () => {
      calls += 1
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const none = await bocRatesFor('CAD', [{ currency: 'USD', date: '2026-11-08' }, { currency: 'EUR', date: '2026-11-08' }], TODAY, { fetch: offline, storage: memory({ [BOC_SETTING_KEY]: '{"enabled":true}' }) })
    expect(none.size).toBe(0)
    expect(calls).toBe(1)
  })
})
