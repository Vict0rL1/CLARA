/**
 * Textos de la interfaz en cuatro idiomas (`es` es la base; `en`, `pt` y `fr` tienen el mismo tipo,
 * así TypeScript obliga a tener todas las claves). Una clave que faltara usaría el texto en español.
 * En desarrollo, `?pseudo=1` en la URL activa el pseudo-locale (`pseudo.ts`) para encontrar texto
 * que no pasa por i18n.
 */
import { createContext, useContext, useEffect, useState } from 'react'
import type { Language } from '../domain/types'
import { es } from './es'
import { pseudoDictionary } from './pseudo'

export type MessageKey = keyof typeof es
export type Params = Record<string, string | number>

/**
 * El español va en el paquete principal (base y respaldo). Inglés, portugués y francés se cargan
 * bajo demanda: cada diccionario pesa ≈ 180–200 KB y casi nadie usa más de uno (decisión 55). El
 * *service worker* los precarga igualmente, así que funcionan sin conexión.
 */
const dictionaries: Partial<Record<Language, Partial<Record<MessageKey, string>>>> = { es }
const loaders: Record<Exclude<Language, 'es'>, () => Promise<Partial<Record<MessageKey, string>>>> = {
  en: () => import('./en').then((m) => m.en),
  pt: () => import('./pt').then((m) => m.pt),
  fr: () => import('./fr').then((m) => m.fr),
}
const pending = new Map<Language, Promise<void>>()

export function isLanguageLoaded(language: Language): boolean {
  return dictionaries[language] !== undefined
}

/** Carga el diccionario de un idioma (idempotente). Si falla (sin conexión y sin caché), se usa el español. */
export function loadLanguage(language: Language): Promise<void> {
  if (isLanguageLoaded(language)) return Promise.resolve()
  const existing = pending.get(language)
  if (existing) return existing
  const p = loaders[language as Exclude<Language, 'es'>]()
    .then((dict) => {
      dictionaries[language] = dict
    })
    .catch(() => {
      dictionaries[language] = {}
    })
    .finally(() => pending.delete(language))
  pending.set(language, p)
  return p
}

/** Idioma que se puede mostrar ya: el pedido si está cargado; si no, el último cargado mientras llega. */
export function useLoadedLanguage(language: Language): { language: Language; ready: boolean } {
  // Último idioma ya cargado que se pidió: se sigue mostrando mientras llega el nuevo.
  const [shown, setShown] = useState<Language>(() => (isLanguageLoaded(language) ? language : 'es'))
  useEffect(() => {
    if (isLanguageLoaded(language)) return
    let alive = true
    void loadLanguage(language).then(() => {
      if (alive) setShown(language)
    })
    return () => {
      alive = false
    }
  }, [language])
  const ready = isLanguageLoaded(language)
  return { language: ready ? language : shown, ready }
}

/** Pseudo-locale (solo desarrollo): sustituye el idioma activo por la versión marcada. */
let pseudo: Record<MessageKey, string> | null = null
export function enablePseudoLocale(on: boolean): void {
  pseudo = on ? pseudoDictionary(es) : null
}

function interpolate(message: string, params?: Params): string {
  if (!params) return message
  return message.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

export function translate(language: Language, key: MessageKey, params?: Params): string {
  const message = pseudo?.[key] ?? dictionaries[language]?.[key] ?? es[key] ?? key
  return interpolate(message, params)
}

/** Clave del plural: `<clave>_one` o `<clave>_other` según la cantidad. */
export function pluralKey(language: Language, base: string, count: number): string {
  return `${base}_${new Intl.PluralRules(language).select(count) === 'one' ? 'one' : 'other'}`
}

/** Plurales: busca `<clave>_one` o `<clave>_other` según la cantidad. */
export function translatePlural(language: Language, base: string, count: number, params?: Params): string {
  return translate(language, pluralKey(language, base, count) as MessageKey, { count, ...params })
}

export interface Translator {
  language: Language
  t: (key: MessageKey, params?: Params) => string
  tn: (base: string, count: number, params?: Params) => string
}

/**
 * `extra` añade textos que vienen de los datos (nombres de categorías
 * personalizadas: `category.c_…`) o de un paquete diferido (`packs.ts`, también sus plurales `_one`/`_other`), así se
 * muestran igual que las fijas.
 */
export function createTranslator(language: Language, extra: Record<string, string> = {}): Translator {
  return {
    language,
    t: (key, params) => (key in extra ? interpolate(extra[key]!, params) : translate(language, key, params)),
    tn: (base, count, params) => {
      const key = pluralKey(language, base, count)
      return key in extra ? interpolate(extra[key]!, { count, ...params }) : translatePlural(language, base, count, params)
    },
  }
}

export const I18nContext = createContext<Translator>(createTranslator('es'))

export function useT(): Translator {
  return useContext(I18nContext)
}
