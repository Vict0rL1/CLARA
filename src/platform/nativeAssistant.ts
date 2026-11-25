/**
 * Contratos de los plugins del asistente en la app de iPhone (Fase 5, decisiones 187–189) y lo que la web hace con sus
 * respuestas. No importa Capacitor: se prueba con dobles. Solo lo usa `native/assistant.ts`, que se carga con
 * `import()` dentro de la app (`main.tsx`), y lo deja en `nativeServices()`.
 *
 * - `ClaraSpeech` (`ios/App/App/ClaraSpeechPlugin.swift`): dictado EN el iPhone; el audio no sale del teléfono.
 * - `ClaraVision` (`ClaraVisionPlugin.swift`): texto de una foto y cámara de documentos (hasta 5 recibos seguidos).
 * - `ClaraAI` (`ClaraAIPlugin.swift`): la IA de Apple Intelligence que corre en el iPhone (opcional).
 *
 * Aquí no se interpreta nada: el texto va al asistente de siempre (`domain/parser.ts`, `domain/receipt.ts`) y lo que
 * diga la IA se comprueba entero en `domain/deviceAi.ts`. Toda respuesta del puente se lee como `unknown`.
 */
import { linesFromObservations, readObservations } from '../domain/ocrLines'
import type { Language } from '../domain/types'

type Listener = Promise<{ remove: () => Promise<void> }>

export interface ClaraSpeechPlugin {
  availability(options: { locale: string }): Promise<{ available?: unknown; reason?: unknown }>
  start(options: { locale: string }): Promise<unknown>
  stop(): Promise<{ text?: unknown }>
  addListener(event: 'partial' | 'end', listener: (data: { text?: unknown }) => void): Listener
}

export interface ClaraVisionPlugin {
  availability(): Promise<{ text?: unknown; scanner?: unknown }>
  recognize(options: { image: string; languages: string[] }): Promise<{ observations?: unknown }>
  scan(options: { max: number; languages: string[] }): Promise<{ pages?: unknown; skipped?: unknown; cancelled?: unknown }>
}

export interface ClaraAIPlugin {
  availability(options: { locale: string }): Promise<{ available?: unknown; reason?: unknown }>
  extract(options: { text: string; today: string; categories: string[] }): Promise<{ json?: unknown }>
  receipt(options: { text: string; today: string }): Promise<{ json?: unknown }>
}

export const CLARA_SPEECH_PLUGIN = 'ClaraSpeech'
export const CLARA_VISION_PLUGIN = 'ClaraVision'
export const CLARA_AI_PLUGIN = 'ClaraAI'

/**
 * Idiomas de dictado por idioma de Clara, en orden de preferencia: el primero que este iPhone sepa reconocer EN el
 * dispositivo. Los mismos acentos que el dictado de la web (`es-MX`, `en-CA`, `pt-BR`, `fr-CA`) y después otros del
 * mismo idioma, porque no todos tienen reconocimiento sin conexión en todos los iPhone.
 */
export const SPEECH_LOCALES: Readonly<Record<Language, readonly string[]>> = {
  es: ['es-MX', 'es-US', 'es-ES'],
  en: ['en-CA', 'en-US', 'en-GB'],
  pt: ['pt-BR', 'pt-PT'],
  fr: ['fr-CA', 'fr-FR'],
}

/** Idiomas para leer recibos (Vision): el de Clara y, en segundo lugar, el otro idioma oficial que más se ve en Canadá. */
export const VISION_LANGUAGES: Readonly<Record<Language, readonly string[]>> = {
  es: ['es-ES', 'en-US'],
  en: ['en-US', 'fr-FR'],
  pt: ['pt-BR', 'en-US'],
  fr: ['fr-FR', 'en-US'],
}

/** Recibos por escaneo como mucho (el Swift tampoco entrega más). */
export const RECEIPT_SCAN_MAX = 5
/** Lo que se tarda como mucho en esperar a la IA del iPhone; después, el analizador de siempre. */
export const DEVICE_AI_TIMEOUT_MS = 20_000
/** Texto dictado como mucho (el mismo tope que el campo del asistente). */
export const DICTATION_TEXT_MAX = 4000
/** Una imagen en base64 como mucho (una página de ≤ 1600 px en JPEG queda muy por debajo). */
const IMAGE_BASE64_MAX = 12_000_000
const JSON_MAX = 200_000

const codeOf = (error: unknown): string | undefined => {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  return typeof code === 'string' ? code : undefined
}

const textOf = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/* --------------------------------- Dictado --------------------------------- */

export type DictationUnavailable = 'unsupportedLocale' | 'noOnDevice' | 'denied' | 'restricted' | 'failed'
export type DictationAvailability = { available: true; locale: string } | { available: false; reason: DictationUnavailable }
export type DictationStartError = 'busy' | 'noOnDevice' | 'denied' | 'failed'

/** Lo que lanza `start` si no puede empezar: un `Error` con el motivo en `reason`. */
export class DictationError extends Error {
  readonly reason: DictationStartError
  constructor(reason: DictationStartError) {
    super(reason)
    this.reason = reason
  }
}

export interface DeviceDictation {
  /** El idioma de dictado de este iPhone para `language` (el primero de `SPEECH_LOCALES` que funciona), o por qué no hay. */
  availability(language: Language): Promise<DictationAvailability>
  /**
   * Empieza a dictar: `onText` recibe lo reconocido hasta ahora y `onEnd`, lo último si terminó sin pedirlo (silencio
   * largo o un error). Si no puede empezar, lanza `DictationError`.
   */
  start(locale: string, onText: (text: string) => void, onEnd: (text: string) => void): Promise<void>
  /** Para y devuelve lo reconocido. Nunca lanza: sin respuesta, `''`. */
  stop(): Promise<string>
}

const DICTATION_REASONS: readonly DictationUnavailable[] = ['unsupportedLocale', 'noOnDevice', 'denied', 'restricted']
const START_ERRORS: readonly DictationStartError[] = ['busy', 'noOnDevice', 'denied', 'failed']

export function createDictation(plugin: ClaraSpeechPlugin): DeviceDictation {
  let handles: { remove: () => Promise<void> }[] = []
  const detach = () => {
    for (const h of handles) void h.remove().catch(() => {})
    handles = []
  }
  return {
    async availability(language) {
      let first: DictationUnavailable | undefined
      for (const locale of SPEECH_LOCALES[language]) {
        try {
          const r = await plugin.availability({ locale })
          if (r.available === true) return { available: true, locale }
          const reason = DICTATION_REASONS.find((x) => x === r.reason) ?? 'failed'
          // Sin permiso o restringido vale para todos los idiomas: no se sigue probando.
          if (reason === 'denied' || reason === 'restricted') return { available: false, reason }
          first ??= reason
        } catch {
          first ??= 'failed'
        }
      }
      return { available: false, reason: first ?? 'unsupportedLocale' }
    },
    async start(locale, onText, onEnd) {
      detach()
      try {
        handles = await Promise.all([
          plugin.addListener('partial', (d) => onText(textOf(d?.text, DICTATION_TEXT_MAX))),
          plugin.addListener('end', (d) => {
            detach()
            onEnd(textOf(d?.text, DICTATION_TEXT_MAX))
          }),
        ])
        await plugin.start({ locale })
      } catch (error) {
        detach()
        throw new DictationError(START_ERRORS.find((x) => x === codeOf(error)) ?? 'failed')
      }
    },
    async stop() {
      try {
        const r = await plugin.stop()
        return textOf(r?.text, DICTATION_TEXT_MAX)
      } catch {
        return ''
      } finally {
        detach()
      }
    },
  }
}

/* --------------------------------- Recibos --------------------------------- */

/** Texto leído de una imagen, en líneas de arriba abajo (la misma forma que `ui/ocr.ts`). */
export interface DeviceOcrText {
  text: string
  lines: string[]
}

export interface ScannedReceipt {
  /** La página en JPEG, en base64 sin `data:`. */
  image: string
  text: DeviceOcrText
}

export interface ReceiptScan {
  pages: ScannedReceipt[]
  /** Páginas que no se leyeron: las que pasan de `RECEIPT_SCAN_MAX` y las que llegaron sin imagen válida. */
  skipped: number
  cancelled: boolean
}

export type ScanError = 'unavailable' | 'busy' | 'failed'

/** Lo que lanza `scan` si la cámara no se pudo abrir: un `Error` con el motivo en `reason`. */
export class ReceiptScanError extends Error {
  readonly reason: ScanError
  constructor(reason: ScanError) {
    super(reason)
    this.reason = reason
  }
}

export interface DeviceReceipts {
  /** ¿Tiene este iPhone la cámara de documentos? Sin respuesta, `false`. */
  scanner(): Promise<boolean>
  /** El texto de una imagen (base64 sin `data:`); `null` si no se pudo leer. */
  read(imageBase64: string, language: Language): Promise<DeviceOcrText | null>
  /** Abre la cámara de documentos (hasta `RECEIPT_SCAN_MAX` recibos). Si no se pudo abrir, lanza `ReceiptScanError`. */
  scan(language: Language): Promise<ReceiptScan>
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

function ocrText(observations: unknown): DeviceOcrText {
  const lines = linesFromObservations(readObservations(observations))
  return { text: lines.join('\n'), lines }
}

export function createReceipts(plugin: ClaraVisionPlugin): DeviceReceipts {
  return {
    async scanner() {
      try {
        return (await plugin.availability()).scanner === true
      } catch {
        return false
      }
    },
    async read(imageBase64, language) {
      try {
        const r = await plugin.recognize({ image: imageBase64, languages: [...VISION_LANGUAGES[language]] })
        return ocrText(r?.observations)
      } catch {
        return null
      }
    },
    async scan(language) {
      let r: Awaited<ReturnType<ClaraVisionPlugin['scan']>>
      try {
        r = await plugin.scan({ max: RECEIPT_SCAN_MAX, languages: [...VISION_LANGUAGES[language]] })
      } catch (error) {
        const code = codeOf(error)
        throw new ReceiptScanError(code === 'unavailable' || code === 'busy' ? code : 'failed')
      }
      const raw = Array.isArray(r?.pages) ? r.pages : []
      const pages: ScannedReceipt[] = []
      let skipped = typeof r?.skipped === 'number' && Number.isSafeInteger(r.skipped) && r.skipped > 0 ? r.skipped : 0
      for (const page of raw) {
        const image = page && typeof page === 'object' ? (page as { image?: unknown }).image : undefined
        if (pages.length >= RECEIPT_SCAN_MAX || typeof image !== 'string' || image.length > IMAGE_BASE64_MAX || !BASE64.test(image)) {
          skipped++
          continue
        }
        pages.push({ image, text: ocrText((page as { observations?: unknown }).observations) })
      }
      return { pages, skipped, cancelled: r?.cancelled === true }
    },
  }
}

/* ------------------------------ IA del iPhone ------------------------------ */

export type DeviceAiUnavailable = 'unsupportedOS' | 'deviceNotEligible' | 'appleIntelligenceNotEnabled' | 'modelNotReady' | 'unsupportedLanguage' | 'unknown'
export type DeviceAiAvailability = { available: true } | { available: false; reason: DeviceAiUnavailable }

export interface DeviceAi {
  availability(language: Language): Promise<DeviceAiAvailability>
  /** La respuesta de la IA ya leída del JSON, SIN comprobar (eso es `domain/deviceAi.ts`); `null` si falló o tardó. */
  extract(text: string, today: string, categories: readonly string[]): Promise<unknown>
  receipt(text: string, today: string): Promise<unknown>
}

const AI_REASONS: readonly DeviceAiUnavailable[] = ['unsupportedOS', 'deviceNotEligible', 'appleIntelligenceNotEnabled', 'modelNotReady', 'unsupportedLanguage']

function readJson(r: { json?: unknown } | undefined): unknown {
  if (typeof r?.json !== 'string' || r.json.length > JSON_MAX) return null
  try {
    return JSON.parse(r.json) as unknown
  } catch {
    return null
  }
}

/** La respuesta o `null` si no llega en `ms`: la espera no bloquea el asistente. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
    )
  })
}

/** El texto que la IA acepta como mucho (el Swift rechaza más). */
export const DEVICE_AI_TEXT_MAX = 8000

export function createDeviceAi(plugin: ClaraAIPlugin, timeoutMs = DEVICE_AI_TIMEOUT_MS): DeviceAi {
  return {
    async availability(language) {
      try {
        const r = await plugin.availability({ locale: SPEECH_LOCALES[language][0]! })
        if (r.available === true) return { available: true }
        return { available: false, reason: AI_REASONS.find((x) => x === r.reason) ?? 'unknown' }
      } catch {
        return { available: false, reason: 'unknown' }
      }
    },
    async extract(text, today, categories) {
      if (!text.trim() || text.length > DEVICE_AI_TEXT_MAX) return null
      return readJson((await within(plugin.extract({ text, today, categories: [...categories] }), timeoutMs)) ?? undefined)
    },
    async receipt(text, today) {
      if (!text.trim() || text.length > DEVICE_AI_TEXT_MAX) return null
      return readJson((await within(plugin.receipt({ text, today }), timeoutMs)) ?? undefined)
    },
  }
}
