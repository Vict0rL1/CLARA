import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPackLoader, PACK_URLS, packTranslator, requestJson } from './packs'
import { createTranslator, loadLanguage } from './index'
import bankImportEn from './packs/bankImport.en.json'
import bankImportEs from './packs/bankImport.es.json'
import bankImportFr from './packs/bankImport.fr.json'
import bankImportPt from './packs/bankImport.pt.json'
import galleryEn from './packs/gallery.en.json'
import galleryEs from './packs/gallery.es.json'
import galleryFr from './packs/gallery.fr.json'
import galleryPt from './packs/gallery.pt.json'
import legalEn from './packs/legal.en.json'
import legalEs from './packs/legal.es.json'
import legalFr from './packs/legal.fr.json'
import legalPt from './packs/legal.pt.json'
import nativeAppEn from './packs/nativeApp.en.json'
import nativeAppEs from './packs/nativeApp.es.json'
import nativeAppFr from './packs/nativeApp.fr.json'
import nativeAppPt from './packs/nativeApp.pt.json'
import shortfallEn from './packs/shortfall.en.json'
import shortfallEs from './packs/shortfall.es.json'
import shortfallFr from './packs/shortfall.fr.json'
import shortfallPt from './packs/shortfall.pt.json'
import whatChangedEn from './packs/whatChanged.en.json'
import whatChangedEs from './packs/whatChanged.es.json'
import whatChangedFr from './packs/whatChanged.fr.json'
import whatChangedPt from './packs/whatChanged.pt.json'
import { es } from './es'
import { fromDisk } from '../test/packFiles'

const ALL: Record<string, Record<string, Record<string, string>>> = {
  legal: { es: legalEs, en: legalEn, pt: legalPt, fr: legalFr },
  gallery: { es: galleryEs, en: galleryEn, pt: galleryPt, fr: galleryFr },
  bankImport: { es: bankImportEs, en: bankImportEn, pt: bankImportPt, fr: bankImportFr },
  nativeApp: { es: nativeAppEs, en: nativeAppEn, pt: nativeAppPt, fr: nativeAppFr },
  whatChanged: { es: whatChangedEs, en: whatChangedEn, pt: whatChangedPt, fr: whatChangedFr },
  shortfall: { es: shortfallEs, en: shortfallEn, pt: shortfallPt, fr: shortfallFr },
}
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('paquetes de texto diferidos', () => {
  it('cada paquete tiene las mismas claves en los cuatro idiomas, sin textos vacíos, y ninguna de esas claves sigue en el diccionario principal', async () => {
    const packs = createPackLoader(PACK_URLS, 0, fromDisk)
    for (const [name, reference] of [['legal', legalEs], ['gallery', galleryEs], ['bankImport', bankImportEs], ['nativeApp', nativeAppEs], ['whatChanged', whatChangedEs], ['shortfall', shortfallEs]] as const) {
      const keys = Object.keys(reference).sort()
      expect(keys.length).toBe({ legal: 22, gallery: 54, bankImport: 103, nativeApp: 72, whatChanged: 69, shortfall: 67 }[name])
      for (const lang of ['es', 'en', 'pt', 'fr'] as const) {
        const { pack, language } = await packs.load(name, lang)
        expect(language).toBe(lang)
        expect(Object.keys(pack).sort(), `${name} ${lang}`).toEqual(keys)
        for (const k of keys) expect(pack[k]!.trim().length, `${name} ${lang} ${k}`).toBeGreaterThan(0)
      }
      // El paquete de la app de iPhone lleva además sustituciones de claves de la interfaz, a propósito (decisión 164;
      // `nativeTexts.test.ts` exige que existan): aquí solo se miran sus claves propias.
      for (const k of keys) if (name !== 'nativeApp' || k.startsWith('nativeApp.')) expect(k in es, k).toBe(false)
    }
    // Lo que las pantallas siguen pidiendo al diccionario principal no se movió.
    for (const k of ['gallery.coachStep', 'gallery.clear', 'legal.title', 'legal.updated', 'legal.terms.title', 'legal.privacy.title', 'bankImport.title', 'changes.title', 'changes.link', 'changes.kind.estimate', 'changes.kind.assumption', 'shortfall.title', 'shortfall.open', 'shortfall.baseAlert']) expect(k in es, k).toBe(true)
  })

  it('cada paquete e idioma es un archivo JSON propio, fuera del JS inicial', () => {
    const urls = Object.values(PACK_URLS).flatMap((byLang) => Object.values(byLang))
    expect(new Set(urls).size).toBe(24)
    for (const name of ['legal', 'gallery', 'bankImport', 'nativeApp', 'whatChanged', 'shortfall'] as const) {
      for (const lang of ['es', 'en', 'pt', 'fr'] as const) expect(PACK_URLS[name][lang]).toMatch(new RegExp(`${name}\\.${lang}[^/]*\\.json$`))
    }
  })

  it('las variables {x} de cada texto coinciden con las del español y cada plural tiene _one y _other en los cuatro idiomas (como en los diccionarios principales)', () => {
    for (const [name, byLang] of Object.entries(ALL)) {
      const keys = Object.keys(byLang.es!)
      for (const lang of ['en', 'pt', 'fr']) {
        for (const k of keys) expect(vars(byLang[lang]![k]!), `${name} ${lang} ${k}`).toEqual(vars(byLang.es![k]!))
      }
      for (const lang of ['es', 'en', 'pt', 'fr']) {
        const bases = keys.filter((k) => k.endsWith('_one')).map((k) => k.slice(0, -4))
        for (const b of bases) expect(`${b}_other` in byLang[lang]!, `${name} ${lang} ${b}_other`).toBe(true)
        for (const k of keys.filter((x) => x.endsWith('_one'))) expect(byLang[lang]![k]!.includes('{count}') || !byLang.es![k]!.includes('{count}'), `${name} ${lang} ${k}`).toBe(true)
      }
    }
  })

  it('packTranslator: las claves del paquete salen del paquete (también los plurales, con las reglas del idioma del paquete) y las demás, del traductor de la interfaz', async () => {
    await loadLanguage('en')
    const ui = createTranslator('en')
    const { t, tn } = packTranslator({ 'x.title': 'Título {n}', 'x.rows_one': '{count} fila', 'x.rows_other': '{count} filas' }, 'es', ui)
    expect(t('x.title', { n: 2 })).toBe('Título 2')
    expect(tn('x.rows', 1)).toBe('1 fila')
    expect(tn('x.rows', 3)).toBe('3 filas')
    // Una clave de la interfaz nunca sale en el idioma del paquete (revisión, B3).
    expect(t('common.cancel')).toBe('Cancel')
  })

  it('se guarda en memoria: la segunda carga devuelve el mismo objeto', async () => {
    const packs = createPackLoader(PACK_URLS, 0, fromDisk)
    const a = await packs.load('legal', 'fr')
    const b = await packs.load('legal', 'fr')
    expect(b.pack).toBe(a.pack)
    expect(packs.cached('legal', 'fr')?.pack).toBe(a.pack)
  })
})

describe('requestJson (el fetch de verdad, con un fetch falso)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('una respuesta que no es 2xx falla con su código; una que no es JSON (la página servida en su lugar) también; un reintento no usa la caché HTTP', async () => {
    const seen: RequestInit[] = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      seen.push(init)
      if (url.includes('missing')) return Promise.resolve(new Response('Not found', { status: 404 }))
      if (url.includes('html')) return Promise.resolve(new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } }))
      return Promise.resolve(new Response('{"a":"b"}', { status: 200 }))
    })
    const signal = new AbortController().signal
    await expect(requestJson('/assets/missing.json', signal, false)).rejects.toThrow('packHttp:404')
    await expect(requestJson('/assets/html.json', signal, false)).rejects.toThrow()
    await expect(requestJson('/assets/ok.json', signal, false)).resolves.toEqual({ a: 'b' })
    await expect(requestJson('/assets/ok.json?retry=2', signal, true)).resolves.toEqual({ a: 'b' })
    expect(seen.map((i) => i.cache)).toEqual(['default', 'default', 'default', 'no-store'])
    expect(seen.every((i) => i.credentials === 'same-origin' && i.signal === signal)).toBe(true)
  })

  it('con el cargador: un 404 o una página HTML nunca entran en memoria, y una petición que lanza al llamarla también es un fallo', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('<html></html>', { status: 200 })))
    const packs = createPackLoader(PACK_URLS, 0)
    await expect(packs.load('legal', 'es')).rejects.toThrow()
    expect(packs.cached('legal', 'es')).toBeNull()
    expect(packs.pending()).toEqual([])
    const throwing = createPackLoader(PACK_URLS, 0, () => {
      throw new TypeError('boom')
    })
    await expect(throwing.load('legal', 'es')).rejects.toThrow('boom')
    expect(throwing.pending()).toEqual([])
  })
})
