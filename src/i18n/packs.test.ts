import { describe, expect, it } from 'vitest'
import { loadPack } from './packs'
import { gallery as galleryEs } from './packs/gallery.es'
import { legal as legalEs } from './packs/legal.es'
import { es } from './es'

describe('paquetes de texto diferidos', () => {
  it('cada paquete tiene las mismas claves en los cuatro idiomas, sin textos vacíos, y ninguna de esas claves sigue en el diccionario principal', async () => {
    for (const [name, reference] of [['legal', legalEs], ['gallery', galleryEs]] as const) {
      const keys = Object.keys(reference).sort()
      expect(keys.length).toBe(name === 'legal' ? 22 : 54)
      for (const lang of ['es', 'en', 'pt', 'fr'] as const) {
        const pack = await loadPack(name, lang)
        expect(Object.keys(pack).sort(), `${name} ${lang}`).toEqual(keys)
        for (const k of keys) expect(pack[k]!.trim().length, `${name} ${lang} ${k}`).toBeGreaterThan(0)
      }
      for (const k of keys) expect(k in es, k).toBe(false)
    }
    // Lo que las pantallas siguen pidiendo al diccionario principal no se movió.
    for (const k of ['gallery.coachStep', 'gallery.clear', 'legal.title', 'legal.updated', 'legal.terms.title', 'legal.privacy.title']) expect(k in es, k).toBe(true)
  })

  it('se guarda en memoria: la segunda carga devuelve el mismo objeto', async () => {
    const a = await loadPack('legal', 'fr')
    const b = await loadPack('legal', 'fr')
    expect(b).toBe(a)
  })
})
