/**
 * Auditoría independiente del 2026-11-02 sobre `420c700` (prioridad 3): un paquete de texto diferido que no cargaba se
 * guardaba como `{}` y Privacidad enseñaba claves internas hasta recargar. El cargador distingue cargando, listo (con
 * el idioma pedido o con el español como respaldo) y fallido; nunca guarda un fallo ni un archivo vacío, deduplica
 * cargas en curso y un reintento vuelve a pedir el archivo. Desde la auditoría del 2026-11-04 (F3) los paquetes son
 * archivos JSON pedidos con `fetch` (ver `auditNov04Packs.test.ts`): aquí las peticiones son falsas; sin red.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPackLoader, PACK_URLS, retryUrl, type PackRequest } from './packs'
import legalEs from './packs/legal.es.json'
import legalEn from './packs/legal.en.json'
import { fromDisk } from './packs.test'

const pack = (prefix: string) => ({ 'legal.terms.1.title': `${prefix} title`, 'legal.terms.1.text': `${prefix} text` })
const packOf = (url: string) => /(legal|gallery|bankImport)\.(es|en|pt|fr)\.json/.exec(url)!

/** Peticiones que fallan mientras `down` tenga su clave (como un `fetch` sin red), y cuentan cuántas veces se pidió cada paquete. */
function fakeRequests(down: Set<string>, calls: Record<string, number>, urls: string[] = []): PackRequest {
  return (url) => {
    const [, name, lang] = packOf(url)
    const id = `${name}:${lang}`
    calls[id] = (calls[id] ?? 0) + 1
    urls.push(url)
    return down.has(id) ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(pack(`${name}-${lang}`))
  }
}

describe('Auditoría 2026-11-02 · P3: el cargador de paquetes de texto diferidos', () => {
  it('el español que falla no se guarda como paquete: el estado es fallido, y al volver la red el reintento carga el texto real', async () => {
    const down = new Set(['legal:es'])
    const calls: Record<string, number> = {}
    const packs = createPackLoader(PACK_URLS, 0, fakeRequests(down, calls))
    await expect(packs.load('legal', 'es')).rejects.toThrow()
    expect(packs.cached('legal', 'es')).toBeNull()
    // Un segundo intento mientras sigue caído vuelve a pedirlo (no hay fallo en memoria) y vuelve a fallar.
    await expect(packs.load('legal', 'es')).rejects.toThrow()
    expect(calls['legal:es']).toBe(2)
    down.delete('legal:es')
    await expect(packs.load('legal', 'es')).resolves.toEqual({ pack: pack('legal-es'), language: 'es' })
    expect(packs.cached('legal', 'es')?.pack).toEqual(pack('legal-es'))
    // Ya en memoria: no se vuelve a pedir.
    await packs.load('legal', 'es')
    expect(calls['legal:es']).toBe(3)
  })

  it('tras un fallo, el reintento pide la misma dirección con una marca distinta: una petición nueva, no el fallo que el navegador recuerde', async () => {
    const down = new Set(['legal:es'])
    const calls: Record<string, number> = {}
    const urls: string[] = []
    const packs = createPackLoader(PACK_URLS, 0, fakeRequests(down, calls, urls))
    await expect(packs.load('legal', 'es')).rejects.toThrow()
    expect(urls).toEqual([PACK_URLS.legal.es])
    down.delete('legal:es')
    await expect(packs.load('legal', 'es')).resolves.toEqual({ pack: pack('legal-es'), language: 'es' })
    expect(urls[1]).toBe(retryUrl(PACK_URLS.legal.es, 2))
    expect(urls[1]).not.toBe(urls[0])
    expect(packs.cached('legal', 'es')?.pack).toEqual(pack('legal-es'))
    // Tras un éxito, el siguiente intento de ese paquete (otro idioma no cargado antes) vuelve a la dirección sin marca.
    await packs.load('legal', 'en')
    expect(urls[2]).toBe(PACK_URLS.legal.en)
  })

  it('la marca de reintento se añade a la dirección tenga o no ya una consulta', () => {
    expect(retryUrl('/assets/legal.es-C-RZlY4S.json', 2)).toBe('/assets/legal.es-C-RZlY4S.json?retry=2')
    expect(retryUrl('/assets/legal.es-C-RZlY4S.json?v=1', 3)).toBe('/assets/legal.es-C-RZlY4S.json?v=1&retry=3')
  })

  it('el idioma pedido falla y el español carga: listo con `language: es` (la pantalla lo dice); un reintento que ya carga devuelve el idioma pedido', async () => {
    const down = new Set(['legal:fr'])
    const calls: Record<string, number> = {}
    const packs = createPackLoader(PACK_URLS, 0, fakeRequests(down, calls))
    await expect(packs.load('legal', 'fr')).resolves.toEqual({ pack: pack('legal-es'), language: 'es' })
    expect(packs.cached('legal', 'fr')).toBeNull()
    expect(packs.cached('legal', 'es')?.language).toBe('es')
    down.delete('legal:fr')
    await expect(packs.load('legal', 'fr')).resolves.toEqual({ pack: pack('legal-fr'), language: 'fr' })
    expect(calls).toMatchObject({ 'legal:fr': 2, 'legal:es': 1 })
  })

  it('los dos fallan: rechaza, nada queda en memoria, y cada paquete se evalúa por separado (Galería puede cargar aunque Legal no)', async () => {
    const down = new Set(['legal:en', 'legal:es'])
    const calls: Record<string, number> = {}
    const packs = createPackLoader(PACK_URLS, 0, fakeRequests(down, calls))
    await expect(packs.load('legal', 'en')).rejects.toThrow()
    expect(packs.cached('legal', 'en')).toBeNull()
    expect(packs.cached('legal', 'es')).toBeNull()
    await expect(packs.load('gallery', 'en')).resolves.toMatchObject({ language: 'en' })
  })

  it('un archivo vacío, con textos vacíos o que no es un objeto no cuenta como paquete: fallido, nunca claves a la vista', async () => {
    const bad: Record<string, unknown> = { 'legal:es': {}, 'legal:en': { 'legal.terms.1.title': '   ' }, 'legal:pt': ['x'], 'legal:fr': 'texto' }
    const packs = createPackLoader(PACK_URLS, 0, (url) => {
      const [, name, lang] = packOf(url)
      return Promise.resolve(bad[`${name}:${lang}`])
    })
    await expect(packs.load('legal', 'es')).rejects.toThrow('packEmpty')
    await expect(packs.load('legal', 'en')).rejects.toThrow()
    await expect(packs.load('legal', 'pt')).rejects.toThrow()
    await expect(packs.load('legal', 'fr')).rejects.toThrow()
    for (const lang of ['es', 'en', 'pt', 'fr'] as const) expect(packs.cached('legal', lang)).toBeNull()
  })

  it('dos pantallas que piden el mismo paquete a la vez comparten una sola carga; una carga que no responde pasa a fallida al vencer el plazo, se cancela, y lo que llegue tarde ya no entra en memoria', async () => {
    vi.useFakeTimers()
    try {
      const calls: Record<string, number> = {}
      const signals: AbortSignal[] = []
      let release: (v: unknown) => void = () => {}
      // El español también caído: así el plazo vencido no se tapa con el respaldo (que es lo que pasaría con red).
      const packs = createPackLoader(PACK_URLS, 1000, (url, signal) => {
        const [, name, lang] = packOf(url)
        calls[`${name}:${lang}`] = (calls[`${name}:${lang}`] ?? 0) + 1
        if (lang === 'es') return Promise.reject(new TypeError('Failed to fetch'))
        signals.push(signal)
        return new Promise((resolve) => {
          release = resolve
        })
      })
      const outcome = (p: Promise<unknown>) => p.then(() => 'resolved', (e: Error) => `rejected:${e.message}`)
      const a = outcome(packs.load('gallery', 'pt'))
      const b = outcome(packs.load('gallery', 'pt'))
      expect(calls['gallery:pt']).toBe(1)
      await vi.advanceTimersByTimeAsync(1100)
      // El plazo vence: las dos esperas fallan (la pantalla ofrece reintentar); no hay bucle de reintentos.
      expect(await a).toMatch(/^rejected:/)
      expect(await b).toMatch(/^rejected:/)
      expect(calls['gallery:pt']).toBe(1)
      expect(signals[0]!.aborted).toBe(true)
      expect(packs.cached('gallery', 'pt')).toBeNull()
      expect(packs.pending()).toEqual([])
      // Auditoría 2026-11-04 (F3): el intento vencido ya se retiró; si su respuesta llegara tarde no entraría en memoria
      // (antes sí: «si llega después, queda en memoria», pero ese mismo intento pendiente era el que colgaba el reintento).
      release({ 'gallery.title': 'tarde' })
      await vi.advanceTimersByTimeAsync(0)
      expect(packs.cached('gallery', 'pt')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('con los archivos reales, el cargador devuelve cada idioma (y el mismo objeto la segunda vez)', async () => {
    const packs = createPackLoader(PACK_URLS, 0, fromDisk)
    expect((await packs.load('legal', 'es')).pack).toEqual(legalEs)
    expect((await packs.load('legal', 'en')).pack).toEqual(legalEn)
    expect((await packs.load('legal', 'en')).pack).toBe((await packs.load('legal', 'en')).pack)
  })
})
