import type { Page } from '@playwright/test'

/** Donde el doble del plugin guarda cada «archivo» (en la app real: Application Support, fuera del WebView). */
export const FAKE_NATIVE_PREFIX = 'fake-native:'

/** Respuesta del doble de Face ID / Touch ID (`ClaraBiometric`): si está disponible y si el sistema «reconoce» a la persona. */
export interface FakeBiometric {
  available: boolean
  /** `true`: el sistema confirma; `false`: la persona cancela. Se puede cambiar entre recargas con `setFakeBiometric`. */
  answer: boolean
}

/**
 * Hace que la página crea que corre dentro de la app de iPhone: deja el puente de Capacitor (`window.Capacitor` y
 * `webkit.messageHandlers.bridge`, que es por donde `@capacitor/core` reconoce iOS) y dobles de los plugins locales con
 * el mismo contrato que el Swift:
 * - `ClaraStorage` (`ios/App/App/ClaraStoragePlugin.swift`), salvo con `storage: false`: un texto por nombre con su
 *   revisión, rechazo `conflict` si la revisión esperada no coincide;
 * - `ClaraBiometric` (`ClaraBiometricPlugin.swift`), solo con `biometric`: `availability` y `authenticate`. Cada
 *   petición anota su texto en `sessionStorage` (`fake-biometric-calls`) para que la prueba lo lea tras recargar.
 * - `ClaraCaptures` (`ClaraCapturesPlugin.swift`): la cola `captures.jsonl` como un «archivo» más (sobrevive a
 *   recargar), con `read`, `remove`, `appendTest` y el evento `capturesAdded` (`addFakeCapture` lo dispara, como la
 *   acción de Atajos con la app abierta).
 *
 * Es un doble: comprueba el lado web de la app (repositorio nativo, textos, pantallas). No dice nada del Swift ni del
 * iPhone real; eso solo se prueba compilando en Xcode.
 */
export async function asNativeApp(page: Page, options: { storage?: boolean; biometric?: FakeBiometric } = {}) {
  await page.addInitScript(
    ({ prefix, storage, biometric, system }) => {
      type Entry = { text: string; revision: number }
      type Options = { name?: string; text?: string; revision?: number; expectedRevision?: number | null; reason?: string; path?: string }
      const read = (name: string): Entry | null => {
        const raw = localStorage.getItem(prefix + name)
        return raw === null ? null : (JSON.parse(raw) as Entry)
      }
      const fail = (message: string, code: string) => Promise.reject(Object.assign(new Error(message), { code }))
      const plugins: Record<string, Record<string, (o: Options) => unknown>> = {}
      if (storage) {
        plugins.ClaraStorage = {
          read: ({ name }) => {
            const entry = read(name!)
            return entry ? { exists: true, text: entry.text, revision: entry.revision } : { exists: false }
          },
          write: ({ name, text, revision, expectedRevision }) => {
            const current = read(name!)?.revision ?? null
            if (current !== (expectedRevision ?? null)) return fail('Lo guardado cambió después de leerlo', 'conflict')
            localStorage.setItem(prefix + name!, JSON.stringify({ text, revision }))
            return {}
          },
          remove: ({ name }) => {
            localStorage.removeItem(prefix + name!)
            return {}
          },
        }
      }
      if (biometric) {
        // Lo que se cambie con `setFakeBiometric` manda sobre lo que se pasó al abrir.
        const current = (): { available: boolean; answer: boolean } => JSON.parse(sessionStorage.getItem('fake-biometric') ?? JSON.stringify(biometric))
        plugins.ClaraBiometric = {
          availability: () => (current().available ? { available: true, type: 'faceID' } : { available: false, type: 'none', reason: 'notEnrolled' }),
          authenticate: ({ reason }) => {
            const calls = JSON.parse(sessionStorage.getItem('fake-biometric-calls') ?? '[]') as string[]
            sessionStorage.setItem('fake-biometric-calls', JSON.stringify([...calls, reason ?? '']))
            if (!current().available) return { ok: false, reason: 'notEnrolled' }
            return current().answer ? { ok: true } : { ok: false, reason: 'cancelled' }
          },
        }
      }
      // Plugins oficiales del sistema (`@capacitor/haptics`, `status-bar`, `filesystem`, `share`): cada llamada se anota
      // en `sessionStorage` (`fake-native-calls`) como «Plugin.método» con sus opciones, para que la prueba la lea.
      const record = (call: string, o: Options) => {
        const calls = JSON.parse(sessionStorage.getItem('fake-native-calls') ?? '[]') as { call: string; options: Options }[]
        sessionStorage.setItem('fake-native-calls', JSON.stringify([...calls, { call, options: o }]))
      }
      for (const [plugin, methods] of Object.entries(system)) {
        plugins[plugin] = Object.fromEntries(
          methods.map((method) => [
            method,
            (o: Options) => {
              record(`${plugin}.${method}`, o)
              if (plugin === 'Filesystem' && method === 'writeFile') return { uri: `file:///var/mobile/Containers/Data/Application/X/Library/Caches/${o.path}` }
              if (plugin === 'Share' && method === 'share') {
                // Lo que «elija» la persona en la hoja: guardar (por defecto), cerrar sin elegir o un fallo.
                const answer = sessionStorage.getItem('fake-share') ?? 'save'
                if (answer === 'cancel') return fail('Share canceled', '')
                if (answer === 'error') return fail('Error sharing item', '')
                return { activityType: 'com.apple.DocumentManagerUICore.SaveToFiles' }
              }
              return {}
            },
          ]),
        )
      }
      // Cola de capturas: el mismo contrato que `ClaraCaptureQueue` + plugin (líneas JSON; quitar por id).
      const queueKey = prefix + 'captures'
      const queue = () => localStorage.getItem(queueKey) ?? ''
      type CaptureOptions = Options & { ids?: string[]; rawAmount?: string; currencyHint?: string; merchant?: string }
      plugins.ClaraCaptures = {
        read: () => ({ text: queue() }),
        remove: (o) => {
          const ids = (o as CaptureOptions).ids ?? []
          const lines = queue().split('\n').filter((l) => l.trim() !== '')
          const kept = lines.filter((l) => {
            try {
              return !ids.includes((JSON.parse(l) as { captureId?: string }).captureId ?? '')
            } catch {
              return true
            }
          })
          localStorage.setItem(queueKey, kept.map((l) => l + '\n').join(''))
          return { removed: lines.length - kept.length }
        },
        appendTest: (o) => {
          const { rawAmount, currencyHint, merchant } = o as CaptureOptions
          const captureId = `cap-test-${Date.now()}`
          const createdAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
          localStorage.setItem(queueKey, queue() + JSON.stringify({ captureId, createdAt, origin: 'apple_pay', rawAmount, currencyHint, merchant, test: true }) + '\n')
          return { captureId }
        },
        removeListener: () => ({}),
      }
      const listeners: Record<string, (() => void)[]> = {}
      ;(window as unknown as { __fakeNativeFire: (event: string) => void }).__fakeNativeFire = (event) => (listeners[event] ?? []).forEach((l) => l())
      const w = window as unknown as Record<string, unknown>
      w.webkit = { messageHandlers: { bridge: { postMessage() {} } } }
      w.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        PluginHeaders: Object.entries(plugins).map(([name, methods]) => ({
          name,
          methods: [...Object.keys(methods).map((m) => ({ name: m, rtype: 'promise' })), ...(name === 'ClaraCaptures' ? [{ name: 'addListener', rtype: 'callback' }] : [])],
        })),
        nativePromise: (plugin: string, method: string, o?: Options) => Promise.resolve().then(() => plugins[plugin]![method]!(o ?? {})),
        // Solo `addListener`: guarda la función para que `addFakeCapture` la llame.
        nativeCallback: (_plugin: string, method: string, o: { eventName?: string }, callback: () => void) => {
          if (method === 'addListener' && o.eventName) (listeners[o.eventName] ??= []).push(callback)
          return 'fake-callback'
        },
      }
    },
    {
      prefix: FAKE_NATIVE_PREFIX,
      storage: options.storage ?? true,
      biometric: options.biometric ?? null,
      system: {
        Haptics: ['impact', 'notification', 'vibrate', 'selectionStart', 'selectionChanged', 'selectionEnd'],
        StatusBar: ['setStyle', 'setBackgroundColor', 'show', 'hide', 'getInfo', 'setOverlaysWebView'],
        Filesystem: ['writeFile', 'rmdir', 'deleteFile', 'getUri', 'readFile', 'mkdir', 'stat'],
        Share: ['share', 'canShare'],
      },
    },
  )
}

/** Cambia la respuesta del doble de Face ID para lo que venga (también tras recargar). */
export function setFakeBiometric(page: Page, biometric: FakeBiometric): Promise<void> {
  return page.evaluate((b) => sessionStorage.setItem('fake-biometric', JSON.stringify(b)), biometric)
}

/** Los textos con los que se pidió Face ID, en orden. */
export function fakeBiometricCalls(page: Page): Promise<string[]> {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('fake-biometric-calls') ?? '[]') as string[])
}

/** Lo que el doble del plugin tiene guardado bajo un nombre (o `null`). */
export function nativeFile(page: Page, name: string): Promise<{ text: string; revision: number } | null> {
  return page.evaluate(
    ({ prefix, key }) => {
      const raw = localStorage.getItem(prefix + key)
      return raw === null ? null : (JSON.parse(raw) as { text: string; revision: number })
    },
    { prefix: FAKE_NATIVE_PREFIX, key: name },
  )
}

/** Las llamadas a los plugins oficiales del sistema (`Haptics`, `StatusBar`, `Filesystem`, `Share`), en orden. */
export function nativeCalls(page: Page, prefix = ''): Promise<{ call: string; options: Record<string, unknown> }[]> {
  return page.evaluate(
    (p) => (JSON.parse(sessionStorage.getItem('fake-native-calls') ?? '[]') as { call: string; options: Record<string, unknown> }[]).filter((c) => c.call.startsWith(p)),
    prefix,
  )
}

/** Lo que hará la hoja Compartir la próxima vez: guardar, cerrarse sin elegir o fallar. */
export function setFakeShare(page: Page, answer: 'save' | 'cancel' | 'error'): Promise<void> {
  return page.evaluate((a) => sessionStorage.setItem('fake-share', a), answer)
}

/** Lo que hay en la cola de capturas del doble (el texto de `captures.jsonl`). */
export function fakeCaptureQueue(page: Page): Promise<string> {
  return page.evaluate((key) => localStorage.getItem(key) ?? '', FAKE_NATIVE_PREFIX + 'captures')
}

/** Como la acción de Atajos: añade un pago a la cola y, si la app está abierta, avisa (`capturesAdded`). */
export async function addFakeCapture(page: Page, record: Record<string, unknown>, notify = true): Promise<void> {
  await page.evaluate(
    ({ key, line, notify }) => {
      localStorage.setItem(key, (localStorage.getItem(key) ?? '') + line + '\n')
      if (notify) (window as unknown as { __fakeNativeFire: (event: string) => void }).__fakeNativeFire('capturesAdded')
    },
    { key: FAKE_NATIVE_PREFIX + 'captures', line: JSON.stringify(record), notify },
  )
}

/** Deja datos propios (no de demostración) en el archivo nativo del doble y recarga, como quien ya usaba la app. */
export async function seedNativeData(page: Page, data: unknown): Promise<void> {
  await page.evaluate(({ key, text }) => localStorage.setItem(key, JSON.stringify({ text, revision: 1 })), { key: FAKE_NATIVE_PREFIX + 'data', text: JSON.stringify(data) })
  await page.reload()
}
