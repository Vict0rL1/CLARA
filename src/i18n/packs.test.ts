import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createPackLoader, PACK_URLS, type PackRequest } from './packs'
import bankImportEs from './packs/bankImport.es.json'
import galleryEs from './packs/gallery.es.json'
import legalEs from './packs/legal.es.json'
import { es } from './es'

/** Lee el archivo JSON al que apunta la dirección (en pruebas, `?url` da la ruta dentro del proyecto). Sin red. */
export const fromDisk: PackRequest = (url) => Promise.resolve(JSON.parse(readFileSync(join(process.cwd(), url.replace(/[?#].*$/, '')), 'utf8')) as unknown)

describe('paquetes de texto diferidos', () => {
  it('cada paquete tiene las mismas claves en los cuatro idiomas, sin textos vacíos, y ninguna de esas claves sigue en el diccionario principal', async () => {
    const packs = createPackLoader(PACK_URLS, 0, fromDisk)
    for (const [name, reference] of [['legal', legalEs], ['gallery', galleryEs], ['bankImport', bankImportEs]] as const) {
      const keys = Object.keys(reference).sort()
      expect(keys.length).toBe({ legal: 22, gallery: 54, bankImport: 103 }[name])
      for (const lang of ['es', 'en', 'pt', 'fr'] as const) {
        const { pack, language } = await packs.load(name, lang)
        expect(language).toBe(lang)
        expect(Object.keys(pack).sort(), `${name} ${lang}`).toEqual(keys)
        for (const k of keys) expect(pack[k]!.trim().length, `${name} ${lang} ${k}`).toBeGreaterThan(0)
      }
      for (const k of keys) expect(k in es, k).toBe(false)
    }
    // Lo que las pantallas siguen pidiendo al diccionario principal no se movió.
    for (const k of ['gallery.coachStep', 'gallery.clear', 'legal.title', 'legal.updated', 'legal.terms.title', 'legal.privacy.title', 'bankImport.title']) expect(k in es, k).toBe(true)
  })

  it('cada paquete e idioma es un archivo JSON propio, fuera del JS inicial', () => {
    const urls = Object.values(PACK_URLS).flatMap((byLang) => Object.values(byLang))
    expect(new Set(urls).size).toBe(12)
    for (const name of ['legal', 'gallery', 'bankImport'] as const) {
      for (const lang of ['es', 'en', 'pt', 'fr'] as const) expect(PACK_URLS[name][lang]).toMatch(new RegExp(`${name}\\.${lang}[^/]*\\.json$`))
    }
  })

  it('se guarda en memoria: la segunda carga devuelve el mismo objeto', async () => {
    const packs = createPackLoader(PACK_URLS, 0, fromDisk)
    const a = await packs.load('legal', 'fr')
    const b = await packs.load('legal', 'fr')
    expect(b.pack).toBe(a.pack)
    expect(packs.cached('legal', 'fr')?.pack).toBe(a.pack)
  })
})
