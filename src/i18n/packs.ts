/**
 * Paquetes de texto diferidos: textos que solo necesita una pantalla poco visitada (Legal, Galería) y que no van en el
 * JS inicial (presupuesto de tamaño, `scripts/check-size.mjs`). Cada paquete tiene un archivo por idioma en `packs/`,
 * con el mismo conjunto de claves (el tipo lo exige). Se cargan al abrir la pantalla y, si cargan, se guardan en
 * memoria; si el idioma pedido no carga, se intenta el español y la pantalla lo dice. El pseudo-idioma de desarrollo
 * no se aplica a estos textos.
 *
 * Auditoría independiente del 2026-11-02 (P3): un fallo de carga NUNCA se guarda como si fuera el paquete (antes un
 * español que no cargaba quedaba en memoria como `{}` y Privacidad enseñaba claves internas como
 * `legal.privacy.1.text` hasta recargar la app). Los tres estados son distintos —cargando, listo (con el idioma
 * pedido o con el español como respaldo), fallido—, una carga que no responde pasa a fallido a los
 * `PACK_LOAD_TIMEOUT_MS`, y el reintento solo lo pide la persona (o volver a abrir la pantalla): sin bucles. Como el
 * navegador recuerda el fallo de un módulo mientras dura la página, el reintento pide el archivo con una marca
 * distinta en la dirección (`failedModuleUrl`), y si no la conoce queda «Recargar la app».
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Language } from '../domain/types'
import { createTranslator, useT, type MessageKey, type Params } from './index'

export type PackName = 'legal' | 'gallery'
type Pack = Record<string, string>
/** Módulo de un paquete: exporta el paquete con el nombre del paquete (`legal`, `gallery`). */
export type PackModule = Record<string, unknown>
export type PackLoaders = Record<PackName, Record<Language, () => Promise<PackModule>>>

const loaders: PackLoaders = {
  legal: {
    es: () => import('./packs/legal.es'),
    en: () => import('./packs/legal.en'),
    pt: () => import('./packs/legal.pt'),
    fr: () => import('./packs/legal.fr'),
  },
  gallery: {
    es: () => import('./packs/gallery.es'),
    en: () => import('./packs/gallery.en'),
    pt: () => import('./packs/gallery.pt'),
    fr: () => import('./packs/gallery.fr'),
  },
}

/** Una carga que no responde en este tiempo se da por fallida (la pantalla ofrece reintentar); si llega después, queda en memoria. */
export const PACK_LOAD_TIMEOUT_MS = 15_000

export interface LoadedPack {
  pack: Pack
  /** Idioma del texto: el pedido, o `es` si el pedido no cargó. */
  language: Language
}

/** Un paquete válido tiene claves y todas con texto: un módulo vacío o a medias nunca se enseña (saldrían claves). */
const isUsablePack = (pack: unknown): pack is Pack =>
  typeof pack === 'object' && pack !== null && Object.keys(pack).length > 0 && Object.values(pack).every((v) => typeof v === 'string' && v.trim().length > 0)

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  ms <= 0
    ? promise
    : new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('packTimeout')), ms)
        promise.then(
          (v) => {
            clearTimeout(timer)
            resolve(v)
          },
          (e: unknown) => {
            clearTimeout(timer)
            reject(e instanceof Error ? e : new Error(String(e)))
          },
        )
      })

export interface PackLoader {
  /** El paquete en el idioma pedido o, si no carga, en español; rechaza si ninguno carga (nunca devuelve algo vacío). */
  load: (name: PackName, language: Language) => Promise<LoadedPack>
  /** Lo que ya está en memoria para ese idioma (solo cargas correctas). */
  cached: (name: PackName, language: Language) => LoadedPack | null
}

/**
 * La dirección del archivo que no se pudo cargar, si el navegador la dice en el error (Chromium: «Failed to fetch
 * dynamically imported module: …», Firefox: «error loading dynamically imported module: …»; Safari no la da).
 */
export function failedModuleUrl(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error)
  return /(https?:\/\/[^\s'"()]+?\.m?js)(?=[\s'")?#]|$)/.exec(message)?.[1] ?? null
}

/** Volver a pedir el mismo archivo con una marca distinta: `import()` de nuevo con la misma dirección no vuelve a la red. */
const importFreshDefault = (url: string, attempt: number): Promise<PackModule> => import(/* @vite-ignore */ `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`) as Promise<PackModule>

export function createPackLoader(table: PackLoaders, timeoutMs = PACK_LOAD_TIMEOUT_MS, importFresh = importFreshDefault): PackLoader {
  const cache = new Map<string, Pack>()
  const inflight = new Map<string, Promise<Pack>>()
  /** Dirección del archivo cuya carga falló (por paquete e idioma), para que el reintento la pida de verdad. */
  const failedUrls = new Map<string, string>()
  let attempts = 0
  const one = (name: PackName, language: Language): Promise<Pack> => {
    const id = `${name}:${language}`
    const hit = cache.get(id)
    if (hit) return Promise.resolve(hit)
    let running = inflight.get(id)
    if (!running) {
      // Chromium y Firefox guardan el fallo de un módulo mientras dura la página: otro `import()` de la misma dirección
      // falla sin pedirla. Si el error dijo la dirección, el reintento la pide con una marca distinta (misma dirección,
      // misma política de contenido: solo archivos propios); si no la dijo (Safari), vuelve a intentar el import y la
      // pantalla ofrece además «Recargar la app».
      const direct = table[name][language]
      const url = failedUrls.get(id)
      const request = url ? () => importFresh(url, ++attempts).catch(() => direct()) : direct
      // Solo un éxito entra en memoria; un fallo se olvida en cuanto termina, así el siguiente intento vuelve a pedirlo.
      running = request()
        .then((module) => {
          const pack = module[name]
          if (!isUsablePack(pack)) throw new Error('packEmpty')
          cache.set(id, pack)
          failedUrls.delete(id)
          return pack
        })
        .catch((error: unknown) => {
          const seen = failedModuleUrl(error)
          if (seen) failedUrls.set(id, seen)
          throw error
        })
        .finally(() => inflight.delete(id))
      inflight.set(id, running)
    }
    return withTimeout(running, timeoutMs)
  }
  return {
    load: async (name, language) => {
      try {
        return { pack: await one(name, language), language }
      } catch (error) {
        if (language === 'es') throw error
        return { pack: await one(name, 'es'), language: 'es' }
      }
    },
    cached: (name, language) => {
      const own = cache.get(`${name}:${language}`)
      return own ? { pack: own, language } : null
    },
  }
}

const packs = createPackLoader(loaders)

/** El paquete (en el idioma pedido o en español). Rechaza si no carga ninguno. */
export const loadPack = (name: PackName, language: Language): Promise<Pack> => packs.load(name, language).then((r) => r.pack)

export type PackTranslate = (key: string, params?: Params) => string

export type PackState =
  | { status: 'loading'; retry: () => void }
  /** `fallback`: el texto está en español porque el idioma pedido no cargó. */
  | { status: 'ready'; t: PackTranslate; language: Language; fallback: boolean; retry: () => void }
  | { status: 'failed'; retry: () => void }

/**
 * Estado del paquete en el idioma activo. Las claves del paquete no están en `MessageKey`; lo que no esté en el
 * paquete cae al diccionario principal. La pantalla no dibuja ninguna clave mientras no esté `ready`.
 */
export function usePack(name: PackName): PackState {
  const { language } = useT()
  const id = `${name}:${language}`
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ id: string; attempt: number; loaded: LoadedPack | null } | null>(null)
  const hit = packs.cached(name, language)
  const cachedNow = hit !== null
  useEffect(() => {
    if (cachedNow) return
    let alive = true
    packs.load(name, language).then(
      (loaded) => {
        if (alive) setResult({ id, attempt, loaded })
      },
      () => {
        if (alive) setResult({ id, attempt, loaded: null })
      },
    )
    return () => {
      alive = false
    }
  }, [id, name, language, attempt, cachedNow])
  const retry = useCallback(() => setAttempt((a) => a + 1), [])
  const loaded: LoadedPack | null | undefined = hit ?? (result && result.id === id && result.attempt === attempt ? result.loaded : undefined)
  return useMemo<PackState>(() => {
    if (loaded === undefined) return { status: 'loading', retry }
    if (loaded === null) return { status: 'failed', retry }
    const translator = createTranslator(loaded.language, loaded.pack)
    return { status: 'ready', t: (key, params) => translator.t(key as MessageKey, params), language: loaded.language, fallback: loaded.language !== language, retry }
  }, [loaded, language, retry])
}
