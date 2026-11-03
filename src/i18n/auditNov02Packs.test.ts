/**
 * Auditoría independiente del 2026-11-02 sobre `420c700` (prioridad 3): un paquete de texto diferido que no cargaba se
 * guardaba como `{}` y Privacidad enseñaba claves internas hasta recargar. El cargador distingue cargando, listo (con
 * el idioma pedido o con el español como respaldo) y fallido; nunca guarda un fallo ni un módulo vacío, deduplica
 * cargas en curso y un reintento vuelve a pedir el archivo. Cargadores falsos; sin red.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPackLoader, failedModuleUrl, loadPack, type PackLoaders, type PackModule } from './packs'
import { legal as legalEs } from './packs/legal.es'
import { legal as legalEn } from './packs/legal.en'

const pack = (prefix: string) => ({ 'legal.terms.1.title': `${prefix} title`, 'legal.terms.1.text': `${prefix} text` })

/** Cargadores que fallan mientras `down` tenga su clave (con el error de Chromium, que dice la dirección), y cuentan cuántas veces se pidió cada uno. */
function fakeLoaders(down: Set<string>, calls: Record<string, number>) {
  const make = (name: string, lang: string, value: Record<string, string>) => (): Promise<PackModule> => {
    calls[`${name}:${lang}`] = (calls[`${name}:${lang}`] ?? 0) + 1
    return down.has(`${name}:${lang}`) ? Promise.reject(new TypeError(`Failed to fetch dynamically imported module: https://clara.test/assets/${name}.${lang}-Abc123.js`)) : Promise.resolve({ [name]: value })
  }
  const table = {} as PackLoaders
  for (const name of ['legal', 'gallery'] as const) {
    table[name] = { es: make(name, 'es', pack(`${name}-es`)), en: make(name, 'en', pack(`${name}-en`)), pt: make(name, 'pt', pack(`${name}-pt`)), fr: make(name, 'fr', pack(`${name}-fr`)) }
  }
  return table
}

describe('Auditoría 2026-11-02 · P3: el cargador de paquetes de texto diferidos', () => {
  it('el español que falla no se guarda como paquete: el estado es fallido, y al volver la red el reintento carga el texto real', async () => {
    const down = new Set(['legal:es'])
    const calls: Record<string, number> = {}
    // Sin dirección conocida que pedir de otra forma (`importFresh` falla), el reintento vuelve al import directo.
    const packs = createPackLoader(fakeLoaders(down, calls), 0, () => Promise.reject(new Error('offline')))
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

  it('el navegador recuerda el fallo del módulo: el reintento pide la misma dirección con una marca distinta y, si llega, queda en memoria', async () => {
    const down = new Set(['legal:es'])
    const calls: Record<string, number> = {}
    const fresh: string[] = []
    const packs = createPackLoader(fakeLoaders(down, calls), 0, (url, attempt) => {
      fresh.push(`${url}?retry=${attempt}`)
      return Promise.resolve({ legal: pack('legal-es-fresh') })
    })
    await expect(packs.load('legal', 'es')).rejects.toThrow()
    expect(fresh).toEqual([])
    // Con la dirección que dijo el error, el reintento no vuelve a pasar por el import que el navegador recuerda como fallido.
    await expect(packs.load('legal', 'es')).resolves.toEqual({ pack: pack('legal-es-fresh'), language: 'es' })
    expect(fresh).toEqual(['https://clara.test/assets/legal.es-Abc123.js?retry=1'])
    expect(calls['legal:es']).toBe(1)
    expect(packs.cached('legal', 'es')?.pack).toEqual(pack('legal-es-fresh'))
  })

  it('la dirección del módulo fallido se lee del error de Chromium y de Firefox; Safari no la da', () => {
    expect(failedModuleUrl(new TypeError('Failed to fetch dynamically imported module: http://localhost:4173/assets/legal.es-C-RZlY4S.js'))).toBe('http://localhost:4173/assets/legal.es-C-RZlY4S.js')
    expect(failedModuleUrl(new TypeError('error loading dynamically imported module: https://clara-d3m.pages.dev/assets/gallery.fr-r4wIIAWR.js'))).toBe('https://clara-d3m.pages.dev/assets/gallery.fr-r4wIIAWR.js')
    expect(failedModuleUrl(new TypeError('Importing a module script failed.'))).toBeNull()
    expect(failedModuleUrl('packTimeout')).toBeNull()
  })

  it('el idioma pedido falla y el español carga: listo con `language: es` (la pantalla lo dice); un reintento que ya carga devuelve el idioma pedido', async () => {
    const down = new Set(['legal:fr'])
    const calls: Record<string, number> = {}
    const packs = createPackLoader(fakeLoaders(down, calls), 0)
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
    const packs = createPackLoader(fakeLoaders(down, calls), 0)
    await expect(packs.load('legal', 'en')).rejects.toThrow()
    expect(packs.cached('legal', 'en')).toBeNull()
    expect(packs.cached('legal', 'es')).toBeNull()
    await expect(packs.load('gallery', 'en')).resolves.toMatchObject({ language: 'en' })
  })

  it('un módulo vacío o con textos vacíos no cuenta como paquete: fallido, nunca claves a la vista', async () => {
    const calls: Record<string, number> = {}
    const table = fakeLoaders(new Set(), calls)
    table.legal.es = () => Promise.resolve({ legal: {} })
    table.legal.en = () => Promise.resolve({ legal: { 'legal.terms.1.title': '   ' } })
    const packs = createPackLoader(table, 0)
    await expect(packs.load('legal', 'es')).rejects.toThrow('packEmpty')
    await expect(packs.load('legal', 'en')).rejects.toThrow()
    expect(packs.cached('legal', 'en')).toBeNull()
  })

  it('dos pantallas que piden el mismo paquete a la vez comparten una sola carga; una carga que no responde pasa a fallida al vencer el plazo y, si llega después, queda en memoria', async () => {
    vi.useFakeTimers()
    try {
      const calls: Record<string, number> = {}
      // El español también caído: así el plazo vencido no se tapa con el respaldo (que es lo que pasaría con red).
      const table = fakeLoaders(new Set(['gallery:es']), calls)
      let release: (v: PackModule) => void = () => {}
      table.gallery.pt = () => {
        calls['gallery:pt'] = (calls['gallery:pt'] ?? 0) + 1
        return new Promise<PackModule>((resolve) => {
          release = resolve
        })
      }
      const packs = createPackLoader(table, 1000)
      const outcome = (p: Promise<unknown>) => p.then(() => 'resolved', (e: Error) => `rejected:${e.message}`)
      const a = outcome(packs.load('gallery', 'pt'))
      const b = outcome(packs.load('gallery', 'pt'))
      expect(calls['gallery:pt']).toBe(1)
      await vi.advanceTimersByTimeAsync(1100)
      // El plazo vence: las dos esperas fallan (la pantalla ofrece reintentar); no hay bucle de reintentos.
      expect(await a).toMatch(/^rejected:/)
      expect(await b).toMatch(/^rejected:/)
      expect(calls['gallery:pt']).toBe(1)
      expect(packs.cached('gallery', 'pt')).toBeNull()
      release({ gallery: pack('gallery-pt') })
      await vi.advanceTimersByTimeAsync(0)
      expect(packs.cached('gallery', 'pt')?.pack).toEqual(pack('gallery-pt'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('con los módulos reales, `loadPack` sigue devolviendo cada idioma (y el mismo objeto la segunda vez)', async () => {
    expect(await loadPack('legal', 'es')).toBe(legalEs)
    expect(await loadPack('legal', 'en')).toBe(legalEn)
    expect(await loadPack('legal', 'en')).toBe(await loadPack('legal', 'en'))
  })
})
