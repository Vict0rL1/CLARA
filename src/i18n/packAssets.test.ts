/**
 * Los paquetes de texto diferidos son archivos de verdad en la versión compilada (auditoría del 2026-11-04, F3): Vite
 * incrusta por defecto como `data:` lo que pesa menos de 4 KB, y un `fetch` de un `data:` no pasa `connect-src 'self'`
 * (los paquetes no cargaban en la versión compilada). `packAssetsInlineLimit` los deja fuera de esa regla y no toca lo demás.
 */
import { describe, expect, it } from 'vitest'
import { packAssetsInlineLimit } from '../../vite.config'

describe('paquetes de texto: nunca incrustados', () => {
  it('un paquete JSON nunca se incrusta; lo demás sigue con el umbral por defecto', () => {
    expect(packAssetsInlineLimit('/home/x/ALCANZA/src/i18n/packs/legal.es.json')).toBe(false)
    expect(packAssetsInlineLimit('C:\\x\\ALCANZA\\src\\i18n\\packs\\bankImport.fr.json')).toBe(false)
    expect(packAssetsInlineLimit('/home/x/ALCANZA/src/i18n/packs/gallery.pt.json?url')).toBeUndefined()
    expect(packAssetsInlineLimit('/home/x/ALCANZA/src/assets/icon.svg')).toBeUndefined()
    expect(packAssetsInlineLimit('/home/x/ALCANZA/src/i18n/es.ts')).toBeUndefined()
  })
})
