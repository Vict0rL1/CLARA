/**
 * Tasas del Banco de Canadá — la red, la caché y el interruptor (Fase 3, decisión 181; lo puro está en `domain/boc.ts`).
 * Solo lo cargan pantallas y módulos diferidos (el formulario «Pagado en otra moneda», «Por revisar», Ajustes › Tasas y
 * la lectura de capturas de la app): el JS inicial no lo lleva.
 *
 * - **Apagado por defecto** y de ESTE dispositivo (`clara.boc.v1`): decide a qué sitio se conecta este aparato, así que
 *   no viaja en las copias ni enciende la red en otro al restaurar. En la app de iPhone se copia con el resto de los
 *   ajustes del dispositivo (`platform/deviceMirror.ts`).
 * - Solo con presupuesto en CAD (las series son contra CAD).
 * - La petición es un GET sin cabeceras propias, sin credenciales ni `Referer` (`credentials: 'omit'`,
 *   `referrerPolicy: 'no-referrer'`): la dirección lleva la serie y dos fechas y nada más. Valet responde
 *   `Access-Control-Allow-Origin: *` y no atiende `OPTIONS` (redirige), así que la web y el WebView de la app la piden
 *   igual, sin capa nativa; una cabecera propia forzaría esa consulta previa y fallaría.
 * - Caché local acotada (`clara.boc.rates.v1`, `BOC_CACHE_MAX` resultados): solo lo definitivo (`bocResultFinal`).
 *   Es del dispositivo, no son datos: fuera de las copias, del historial y de toda cifra. Si no se puede leer, se pide.
 * - Sin conexión, sin respuesta a tiempo (`BOC_TIMEOUT_MS`), con un error del servidor o una respuesta que no se entiende:
 *   no hay tasa y se dice. Nunca se inventa una.
 */
import { useSyncExternalStore } from 'react'
import { bocKey, bocObservationsUrl, bocResultFinal, bocSeries, parseBocObservations, pickBocRate, type BocRate } from '../domain/boc'
import { isValidLocalDate } from '../domain/dates'
import { parseRate, rateToText } from '../domain/fx'
import type { LocalDate } from '../domain/types'

export const BOC_SETTING_KEY = 'clara.boc.v1'
export const BOC_CACHE_KEY = 'clara.boc.rates.v1'
/** Resultados guardados como mucho (los más viejos salen primero). */
export const BOC_CACHE_MAX = 300
/** Tiempo máximo de una petición: después se cancela y no hay tasa. */
export const BOC_TIMEOUT_MS = 8000

type KeyStorage = Pick<Storage, 'getItem' | 'setItem'>

const storageOrNull = (): KeyStorage | null => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/* ------------------------------ Interruptor ------------------------------ */

const listeners = new Set<() => void>()

/** ¿Está encendido en este dispositivo? Sin almacenamiento o con algo ilegible: apagado. */
export function bocEnabled(storage: KeyStorage | null = storageOrNull()): boolean {
  try {
    const raw = storage?.getItem(BOC_SETTING_KEY)
    return !!raw && (JSON.parse(raw) as { enabled?: unknown }).enabled === true
  } catch {
    return false
  }
}

/** Enciende o apaga. Devuelve si se pudo guardar (si no, sigue como estaba). */
export function setBocEnabled(enabled: boolean, storage: KeyStorage | null = storageOrNull()): boolean {
  try {
    if (!storage) return false
    storage.setItem(BOC_SETTING_KEY, JSON.stringify({ enabled }))
  } catch {
    return false
  }
  listeners.forEach((l) => l())
  return true
}

export function subscribeBoc(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === BOC_SETTING_KEY || e.key === null) listener()
  }
  globalThis.addEventListener?.('storage', onStorage)
  return () => {
    listeners.delete(listener)
    globalThis.removeEventListener?.('storage', onStorage)
  }
}

/** El interruptor para las pantallas (se actualiza al cambiarlo aquí o en otra pestaña). */
export function useBocEnabled(): boolean {
  return useSyncExternalStore(subscribeBoc, () => bocEnabled(), () => false)
}

/* --------------------------------- Caché --------------------------------- */

type Cached = BocRate | { none: true }
type CacheFile = { v: 1; entries: [string, Cached][] }

function readCache(storage: KeyStorage | null): Map<string, Cached> {
  const out = new Map<string, Cached>()
  try {
    const raw = storage?.getItem(BOC_CACHE_KEY)
    const file = raw ? (JSON.parse(raw) as CacheFile) : null
    if (!file || file.v !== 1 || !Array.isArray(file.entries)) return out
    for (const e of file.entries) {
      if (!Array.isArray(e) || typeof e[0] !== 'string' || !e[1] || typeof e[1] !== 'object') continue
      const [key, value] = e as [string, Record<string, unknown>]
      if (value.none === true) out.set(key, { none: true })
      else if (typeof value.rate === 'string' && isValidLocalDate(value.rateDate) && parseRate(value.rate)) {
        // Lo que vuelve de la caché se vuelve a leer como si llegara del banco (un valor tocado no pasa).
        out.set(key, { rate: rateToText(parseRate(value.rate)!), rateDate: value.rateDate })
      }
    }
  } catch {
    // Ilegible: como vacía (se vuelve a pedir).
  }
  return out
}

function writeCache(storage: KeyStorage | null, cache: Map<string, Cached>) {
  const entries = [...cache.entries()].slice(-BOC_CACHE_MAX)
  try {
    storage?.setItem(BOC_CACHE_KEY, JSON.stringify({ v: 1, entries } satisfies CacheFile))
  } catch {
    // Sin espacio: la tasa se usa igual; la próxima vez se pide otra vez.
  }
}

/* -------------------------------- Petición -------------------------------- */

export type BocLookup =
  | { status: 'ok'; rate: BocRate; cached: boolean }
  /** El banco respondió y no hay tasa publicada en el margen (o la serie no existe). */
  | { status: 'none' }
  /** Sin conexión o sin respuesta a tiempo. */
  | { status: 'offline' }
  /** Respondió con un error o con algo que no se entiende. */
  | { status: 'error' }
  /** Esa moneda no tiene serie (o el presupuesto no es en CAD): no se pidió nada. */
  | { status: 'unsupported' }

export interface BocDeps {
  fetch?: typeof fetch
  storage?: KeyStorage | null
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * La tasa del banco para un gasto del día `date` en `currency` (presupuesto `budgetCurrency`). Mira primero la caché;
 * si no, la pide. `today` decide si el resultado ya es definitivo y se puede guardar.
 */
export async function lookupBocRate(budgetCurrency: string, currency: string, date: LocalDate, today: LocalDate, deps: BocDeps = {}): Promise<BocLookup> {
  const series = bocSeries(budgetCurrency, currency)
  if (!series || !isValidLocalDate(date)) return { status: 'unsupported' }
  const storage = deps.storage === undefined ? storageOrNull() : deps.storage
  const key = bocKey(currency, date)
  const cache = readCache(storage)
  const hit = cache.get(key)
  if (hit) return 'none' in hit ? { status: 'none' } : { status: 'ok', rate: hit, cached: true }

  const doFetch = deps.fetch ?? globalThis.fetch?.bind(globalThis)
  if (!doFetch) return { status: 'offline' }
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  deps.signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? BOC_TIMEOUT_MS)
  let status: number
  let json: unknown
  try {
    const response = await doFetch(bocObservationsUrl(series, date), {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: controller.signal,
    })
    status = response.status
    try {
      json = await response.json()
    } catch {
      json = null
    }
  } catch {
    return { status: 'offline' }
  } finally {
    clearTimeout(timer)
    deps.signal?.removeEventListener('abort', onAbort)
  }
  const parsed = parseBocObservations(json, series)
  let result: BocLookup
  if (!parsed.ok) result = parsed.error === 'notFound' && status === 404 ? { status: 'none' } : { status: 'error' }
  else if (status !== 200) result = { status: 'error' }
  else {
    const picked = pickBocRate(parsed.observations, date)
    result = picked ? { status: 'ok', rate: picked, cached: false } : { status: 'none' }
    if (bocResultFinal(date, picked, today)) {
      const fresh = readCache(storage)
      fresh.delete(key)
      fresh.set(key, picked ?? { none: true })
      writeCache(storage, fresh)
    }
  }
  return result
}

/**
 * Para la lectura de capturas: las tasas de varios (moneda, fecha), cada una una sola vez y una detrás de otra (el
 * banco pide no saturarlo). Solo vuelven las que hay; lo demás queda como propuesta. Nada si está apagado.
 */
export async function bocRatesFor(
  budgetCurrency: string,
  wanted: readonly { currency: string; date: LocalDate }[],
  today: LocalDate,
  deps: BocDeps = {},
): Promise<Map<string, BocRate>> {
  const out = new Map<string, BocRate>()
  const storage = deps.storage === undefined ? storageOrNull() : deps.storage
  if (!bocEnabled(storage)) return out
  for (const w of wanted) {
    const key = bocKey(w.currency, w.date)
    if (out.has(key)) continue
    const r = await lookupBocRate(budgetCurrency, w.currency, w.date, today, { ...deps, storage })
    if (r.status === 'ok') out.set(key, r.rate)
    // Sin conexión, lo siguiente tampoco llegará: no se insiste.
    if (r.status === 'offline') break
  }
  return out
}
