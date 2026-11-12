/**
 * Auditoría independiente del 2026-11-04 sobre `f8d6da0` (F3): una descarga de paquete de texto que no respondía
 * dejaba el intento pendiente para siempre: el plazo rechazaba la espera pero el intento seguía como «en curso», el
 * reintento se colgaba de él y no pedía nada (y un `import()` pendiente lo recuerda el navegador por su dirección).
 * Ahora cada intento tiene identidad propia y señal de cancelación: al vencer el plazo se cancela y se retira, el
 * reintento pide la dirección con otra marca (petición nueva de verdad) y un intento viejo que termine tarde ni entra
 * en memoria ni retira al nuevo. Peticiones falsas que respetan (o ignoran, a propósito) la señal; sin red.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPackLoader, PACK_URLS, retryUrl, type PackRequest } from './packs'

const pack = (prefix: string) => ({ 'legal.terms.1.title': `${prefix} title`, 'legal.terms.1.text': `${prefix} text` })
const packOf = (url: string) => /(legal|gallery|bankImport)\.(es|en|pt|fr)\.json/.exec(url)!
const outcome = (p: Promise<unknown>) => p.then(() => 'resolved', (e: Error) => `rejected:${e.message}`)

interface Call {
  url: string
  id: string
  signal: AbortSignal
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
}

/**
 * Peticiones controladas a mano: cada una queda pendiente hasta que la prueba la resuelve. Como `fetch`, una petición
 * cancelada rechaza con `AbortError` (salvo `ignoreAbort`, que simula una respuesta que llega aunque ya nadie la espere).
 */
function manual(calls: Call[], ignoreAbort = false): PackRequest {
  return (url, signal) =>
    new Promise((resolve, reject) => {
      const [, name, lang] = packOf(url)
      calls.push({ url, id: `${name}:${lang}`, signal, resolve, reject })
      if (!ignoreAbort) signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
    })
}

describe('Auditoría 2026-11-04 · F3: una descarga de paquete que no responde', () => {
  it('al vencer el plazo se cancela la petición y se retira el intento; «Reintentar» pide el archivo de nuevo con otra marca y el texto llega sin recargar', async () => {
    vi.useFakeTimers()
    try {
      const calls: Call[] = []
      const packs = createPackLoader(PACK_URLS, 15_000, manual(calls))
      const first = outcome(packs.load('legal', 'es'))
      expect(calls.map((c) => c.url)).toEqual([PACK_URLS.legal.es])
      expect(packs.pending()).toEqual(['legal:es'])
      await vi.advanceTimersByTimeAsync(14_999)
      expect(packs.pending()).toEqual(['legal:es'])
      await vi.advanceTimersByTimeAsync(1)
      // Vence: la espera falla (español: sin respaldo), la petición se cancela y el intento ya no cuenta como en curso.
      expect(await first).toBe('rejected:packTimeout')
      expect(calls[0]!.signal.aborted).toBe(true)
      expect(packs.pending()).toEqual([])
      expect(packs.cached('legal', 'es')).toBeNull()
      // Reintentar: una petición NUEVA, a la misma dirección con otra marca (antes: ninguna, se reutilizaba la pendiente).
      const second = outcome(packs.load('legal', 'es'))
      expect(calls).toHaveLength(2)
      expect(calls[1]!.url).toBe(retryUrl(PACK_URLS.legal.es, 2))
      expect(calls[1]!.signal.aborted).toBe(false)
      calls[1]!.resolve(pack('legal-es'))
      expect(await second).toBe('resolved')
      expect(packs.cached('legal', 'es')?.pack).toEqual(pack('legal-es'))
      // Ya en memoria: una tercera pantalla no pide nada.
      await packs.load('legal', 'es')
      expect(calls).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('un intento vencido que termina tarde no entra en memoria ni retira al intento nuevo; otra espera mientras tanto comparte el nuevo', async () => {
    vi.useFakeTimers()
    try {
      const calls: Call[] = []
      // Peticiones que ignoran la cancelación: la respuesta vieja llega igual.
      const packs = createPackLoader(PACK_URLS, 1000, manual(calls, true))
      const first = outcome(packs.load('legal', 'es'))
      await vi.advanceTimersByTimeAsync(1001)
      expect(await first).toBe('rejected:packTimeout')
      const second = outcome(packs.load('legal', 'es'))
      expect(calls).toHaveLength(2)
      expect(packs.pending()).toEqual(['legal:es'])
      // La respuesta del intento vencido llega ahora: no entra en memoria y el intento nuevo sigue en curso.
      calls[0]!.resolve(pack('viejo'))
      await vi.advanceTimersByTimeAsync(0)
      expect(packs.cached('legal', 'es')).toBeNull()
      expect(packs.pending()).toEqual(['legal:es'])
      // Una tercera espera comparte el intento nuevo (no pide otra vez).
      const third = outcome(packs.load('legal', 'es'))
      expect(calls).toHaveLength(2)
      calls[1]!.resolve(pack('nuevo'))
      expect(await second).toBe('resolved')
      expect(await third).toBe('resolved')
      expect(packs.cached('legal', 'es')?.pack).toEqual(pack('nuevo'))
      expect(packs.pending()).toEqual([])
      // Y un rechazo tardío del intento viejo tampoco toca nada.
      calls[0]!.reject(new TypeError('tarde'))
      await vi.advanceTimersByTimeAsync(0)
      expect(packs.cached('legal', 'es')?.pack).toEqual(pack('nuevo'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('el idioma pedido no responde: respaldo en español (y la pantalla lo marca); al reintentar, el idioma pedido con una petición nueva', async () => {
    vi.useFakeTimers()
    try {
      const calls: Call[] = []
      const packs = createPackLoader(PACK_URLS, 1000, manual(calls))
      const first = packs.load('legal', 'en')
      await vi.advanceTimersByTimeAsync(1001)
      // El inglés venció: se pide el español, que responde.
      expect(calls.map((c) => c.id)).toEqual(['legal:en', 'legal:es'])
      expect(calls[0]!.signal.aborted).toBe(true)
      calls[1]!.resolve(pack('legal-es'))
      await expect(first).resolves.toEqual({ pack: pack('legal-es'), language: 'es' })
      expect(packs.cached('legal', 'en')).toBeNull()
      // Reintentar con red: el inglés se pide de nuevo (otra marca) y llega en su idioma.
      const second = packs.load('legal', 'en')
      expect(calls).toHaveLength(3)
      expect(calls[2]!.url).toBe(retryUrl(PACK_URLS.legal.en, 3))
      calls[2]!.resolve(pack('legal-en'))
      await expect(second).resolves.toEqual({ pack: pack('legal-en'), language: 'en' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('un archivo que responde con error (404) o con un JSON que no es un paquete: fallido, nada en memoria, y el reintento pide de nuevo con otra marca', async () => {
    const urls: string[] = []
    let mode: 'http' | 'invalid' | 'ok' = 'http'
    const packs = createPackLoader(PACK_URLS, 0, (url) => {
      urls.push(url)
      if (mode === 'http') return Promise.reject(new Error('packHttp:404'))
      if (mode === 'invalid') return Promise.resolve({ 'legal.terms.1.title': 7 })
      return Promise.resolve(pack('legal-es'))
    })
    await expect(packs.load('legal', 'es')).rejects.toThrow('packHttp:404')
    mode = 'invalid'
    await expect(packs.load('legal', 'es')).rejects.toThrow('packEmpty')
    expect(packs.cached('legal', 'es')).toBeNull()
    mode = 'ok'
    await expect(packs.load('legal', 'es')).resolves.toEqual({ pack: pack('legal-es'), language: 'es' })
    expect(urls).toEqual([PACK_URLS.legal.es, retryUrl(PACK_URLS.legal.es, 2), retryUrl(PACK_URLS.legal.es, 3)])
    expect(packs.pending()).toEqual([])
  })

  it('cada paquete e idioma por separado: una descarga detenida de Legal en español no bloquea Galería ni el Legal en otro idioma', async () => {
    vi.useFakeTimers()
    try {
      const calls: Call[] = []
      const packs = createPackLoader(PACK_URLS, 1000, manual(calls))
      const stalled = outcome(packs.load('legal', 'es'))
      const gallery = packs.load('gallery', 'es')
      const french = packs.load('legal', 'fr')
      expect(packs.pending().sort()).toEqual(['gallery:es', 'legal:es', 'legal:fr'])
      calls.find((c) => c.id === 'gallery:es')!.resolve({ 'gallery.title': 'Galería' })
      calls.find((c) => c.id === 'legal:fr')!.resolve(pack('legal-fr'))
      await expect(gallery).resolves.toMatchObject({ language: 'es' })
      await expect(french).resolves.toMatchObject({ language: 'fr' })
      expect(packs.pending()).toEqual(['legal:es'])
      await vi.advanceTimersByTimeAsync(1001)
      expect(await stalled).toBe('rejected:packTimeout')
      expect(packs.pending()).toEqual([])
      expect(packs.cached('gallery', 'es')).not.toBeNull()
      expect(packs.cached('legal', 'fr')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
