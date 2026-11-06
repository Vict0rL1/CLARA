/**
 * Paquetes de texto diferidos: textos que solo necesita una pantalla poco visitada (Legal, Galería) y que no van en el
 * JS inicial (presupuesto de tamaño, `scripts/check-size.mjs`). Cada paquete es un archivo JSON por idioma en `packs/`
 * (con huella de contenido al compilar, precacheado por el service worker como cualquier otro archivo de la app), con el
 * mismo conjunto de claves en los cuatro idiomas (`packs/packKeys.ts` lo exige en `tsc`). Se piden con `fetch` al abrir
 * la pantalla y, si cargan, se guardan en memoria; si el idioma pedido no carga, se intenta el español y la pantalla lo
 * dice. El pseudo-idioma de desarrollo no se aplica a estos textos.
 *
 * Auditoría independiente del 2026-11-02 (P3): un fallo de carga NUNCA se guarda como si fuera el paquete (antes un
 * español que no cargaba quedaba en memoria como `{}` y Privacidad enseñaba claves internas como
 * `legal.privacy.1.text` hasta recargar la app). Los tres estados son distintos —cargando, listo (con el idioma
 * pedido o con el español como respaldo), fallido—, una carga que no responde pasa a fallido a los
 * `PACK_LOAD_TIMEOUT_MS`, y el reintento solo lo pide la persona (o volver a abrir la pantalla): sin bucles.
 *
 * Auditoría independiente del 2026-11-04 (F3): con `import()` una descarga que no respondía se quedaba pendiente para
 * siempre: el plazo rechazaba la espera pero el intento seguía contando como «en curso», el reintento se colgaba de él
 * y, aunque no lo hiciera, el navegador recuerda un módulo pendiente por su dirección y volver a importarla no pide
 * nada. Ahora cada intento tiene identidad propia y una señal de cancelación: al vencer el plazo se cancela la petición
 * y el intento se retira; el siguiente intento pide la dirección con una marca distinta (`retryUrl`: una petición nueva
 * de verdad, nunca la respuesta ni el fallo recordados de la anterior), y un intento viejo que terminara tarde ni entra
 * en memoria ni retira al nuevo. Lo demás no cambia: una sola carga por paquete e idioma, cada idioma por separado,
 * solo un éxito entra en memoria, respaldo en español y «Recargar la app» siguen en la pantalla.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Language } from '../domain/types'
import { createTranslator, useT, type MessageKey, type Params } from './index'
import bankImportEnUrl from './packs/bankImport.en.json?url'
import bankImportEsUrl from './packs/bankImport.es.json?url'
import bankImportFrUrl from './packs/bankImport.fr.json?url'
import bankImportPtUrl from './packs/bankImport.pt.json?url'
import galleryEnUrl from './packs/gallery.en.json?url'
import galleryEsUrl from './packs/gallery.es.json?url'
import galleryFrUrl from './packs/gallery.fr.json?url'
import galleryPtUrl from './packs/gallery.pt.json?url'
import legalEnUrl from './packs/legal.en.json?url'
import legalEsUrl from './packs/legal.es.json?url'
import legalFrUrl from './packs/legal.fr.json?url'
import legalPtUrl from './packs/legal.pt.json?url'

export type PackName = 'legal' | 'gallery' | 'bankImport'
type Pack = Record<string, string>
/** Dirección del archivo JSON de cada paquete e idioma. */
export type PackUrls = Record<PackName, Record<Language, string>>

export const PACK_URLS: PackUrls = {
  legal: { es: legalEsUrl, en: legalEnUrl, pt: legalPtUrl, fr: legalFrUrl },
  gallery: { es: galleryEsUrl, en: galleryEnUrl, pt: galleryPtUrl, fr: galleryFrUrl },
  bankImport: { es: bankImportEsUrl, en: bankImportEnUrl, pt: bankImportPtUrl, fr: bankImportFrUrl },
}

/** Una carga que no responde en este tiempo se cancela y se da por fallida (la pantalla ofrece reintentar). */
export const PACK_LOAD_TIMEOUT_MS = 15_000

export interface LoadedPack {
  pack: Pack
  /** Idioma del texto: el pedido, o `es` si el pedido no cargó. */
  language: Language
}

/** Pide un archivo y devuelve su JSON; `signal` cancela la petición al vencer el plazo. Inyectable para las pruebas. */
export type PackRequest = (url: string, signal: AbortSignal) => Promise<unknown>

const requestJson: PackRequest = async (url, signal) => {
  const response = await fetch(url, { signal, credentials: 'same-origin' })
  if (!response.ok) throw new Error(`packHttp:${response.status}`)
  return response.json() as Promise<unknown>
}

/** Un paquete válido tiene claves y todas con texto: un archivo vacío o a medias nunca se enseña (saldrían claves). */
const isUsablePack = (pack: unknown): pack is Pack =>
  typeof pack === 'object' &&
  pack !== null &&
  !Array.isArray(pack) &&
  Object.keys(pack).length > 0 &&
  Object.values(pack).every((v) => typeof v === 'string' && v.trim().length > 0)

/** La misma dirección con una marca distinta: una petición nueva, no la respuesta (ni el fallo) que el navegador recuerde de la anterior. */
export function retryUrl(url: string, attempt: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`
}

export interface PackLoader {
  /** El paquete en el idioma pedido o, si no carga, en español; rechaza si ninguno carga (nunca devuelve algo vacío). */
  load: (name: PackName, language: Language) => Promise<LoadedPack>
  /** Lo que ya está en memoria para ese idioma (solo cargas correctas). */
  cached: (name: PackName, language: Language) => LoadedPack | null
  /** Intentos en curso (`paquete:idioma`), para pruebas y diagnóstico. */
  pending: () => string[]
}

interface Attempt {
  promise: Promise<Pack>
}

export function createPackLoader(table: PackUrls, timeoutMs = PACK_LOAD_TIMEOUT_MS, request: PackRequest = requestJson): PackLoader {
  const cache = new Map<string, Pack>()
  /** El intento en curso de cada paquete e idioma. Solo él se retira a sí mismo: uno viejo que termine tarde no toca al nuevo. */
  const inflight = new Map<string, Attempt>()
  /** Paquetes cuyo último intento falló o venció: el siguiente pide la dirección con otra marca. */
  const failed = new Set<string>()
  let serial = 0
  const one = (name: PackName, language: Language): Promise<Pack> => {
    const id = `${name}:${language}`
    const hit = cache.get(id)
    if (hit) return Promise.resolve(hit)
    const running = inflight.get(id)
    if (running) return running.promise
    const attempt = ++serial
    const base = table[name][language]
    const url = failed.has(id) ? retryUrl(base, attempt) : base
    const controller = new AbortController()
    let entry: Attempt | null = null
    let settled = false
    const retire = () => {
      if (entry && inflight.get(id) === entry) inflight.delete(id)
    }
    const promise = new Promise<Pack>((resolve, reject) => {
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        failed.add(id)
        retire()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              fail(new Error('packTimeout'))
              controller.abort()
            }, timeoutMs)
          : null
      request(url, controller.signal).then(
        (json) => {
          if (timer !== null) clearTimeout(timer)
          // Un intento ya vencido no entra en memoria aunque llegue: el intento nuevo es el que manda.
          if (settled) return
          if (!isUsablePack(json)) {
            fail(new Error('packEmpty'))
            return
          }
          settled = true
          cache.set(id, json)
          failed.delete(id)
          retire()
          resolve(json)
        },
        (error: unknown) => {
          if (timer !== null) clearTimeout(timer)
          fail(error)
        },
      )
    })
    entry = { promise }
    inflight.set(id, entry)
    return promise
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
    pending: () => [...inflight.keys()],
  }
}

const packs = createPackLoader(PACK_URLS)

/** El paquete (en el idioma pedido o en español). Rechaza si no carga ninguno. */
export const loadPack = (name: PackName, language: Language): Promise<Pack> => packs.load(name, language).then((r) => r.pack)

export type PackTranslate = (key: string, params?: Params) => string
export type PackTranslatePlural = (base: string, count: number, params?: Params) => string

export type PackState =
  | { status: 'loading'; retry: () => void }
  /** `fallback`: el texto está en español porque el idioma pedido no cargó; la pantalla lo marca con `lang="es"`. */
  | { status: 'ready'; t: PackTranslate; tn: PackTranslatePlural; language: Language; fallback: boolean; retry: () => void }
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
    return {
      status: 'ready',
      t: (key, params) => translator.t(key as MessageKey, params),
      tn: translator.tn,
      language: loaded.language,
      fallback: loaded.language !== language,
      retry,
    }
  }, [loaded, language, retry])
}
