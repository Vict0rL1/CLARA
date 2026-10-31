/**
 * Paquetes de texto diferidos: textos que solo necesita una pantalla poco visitada (Legal, Galería) y que no van en el
 * JS inicial (presupuesto de tamaño, `scripts/check-size.mjs`). Cada paquete tiene un archivo por idioma en `packs/`,
 * con el mismo conjunto de claves (el tipo lo exige). Se cargan al abrir la pantalla y se guardan en memoria; si el
 * idioma pedido no carga, se usa el español, como con los diccionarios principales. El pseudo-idioma de desarrollo
 * no se aplica a estos textos.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Language } from '../domain/types'
import { createTranslator, useT, type MessageKey, type Params } from './index'

export type PackName = 'legal' | 'gallery'
type Pack = Record<string, string>

const loaders: Record<PackName, Record<Language, () => Promise<Pack>>> = {
  legal: {
    es: () => import('./packs/legal.es').then((m) => m.legal),
    en: () => import('./packs/legal.en').then((m) => m.legal),
    pt: () => import('./packs/legal.pt').then((m) => m.legal),
    fr: () => import('./packs/legal.fr').then((m) => m.legal),
  },
  gallery: {
    es: () => import('./packs/gallery.es').then((m) => m.gallery),
    en: () => import('./packs/gallery.en').then((m) => m.gallery),
    pt: () => import('./packs/gallery.pt').then((m) => m.gallery),
    fr: () => import('./packs/gallery.fr').then((m) => m.gallery),
  },
}

const cache = new Map<string, Pack>()

export async function loadPack(name: PackName, language: Language): Promise<Pack> {
  const id = `${name}:${language}`
  const hit = cache.get(id)
  if (hit) return hit
  let pack: Pack
  try {
    pack = await loaders[name][language]()
  } catch {
    pack = language === 'es' ? {} : await loadPack(name, 'es')
  }
  cache.set(id, pack)
  return pack
}

export type PackTranslate = (key: string, params?: Params) => string

/**
 * Traductor del paquete en el idioma activo, o `null` hasta que carga (la pantalla espera: no se dibujan claves).
 * Las claves del paquete no están en `MessageKey`; lo que no esté en el paquete cae al diccionario principal.
 */
export function usePackT(name: PackName): PackTranslate | null {
  const { language } = useT()
  const id = `${name}:${language}`
  const [loaded, setLoaded] = useState<{ id: string; pack: Pack } | null>(null)
  useEffect(() => {
    if (cache.has(id)) return
    let alive = true
    void loadPack(name, language).then((pack) => {
      if (alive) setLoaded({ id, pack })
    })
    return () => {
      alive = false
    }
  }, [id, name, language])
  const pack = cache.get(id) ?? (loaded?.id === id ? loaded.pack : null)
  return useMemo(() => {
    if (!pack) return null
    const translator = createTranslator(language, pack)
    return (key, params) => translator.t(key as MessageKey, params)
  }, [pack, language])
}
