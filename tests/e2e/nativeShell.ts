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
 *
 * Es un doble: comprueba el lado web de la app (repositorio nativo, textos, pantallas). No dice nada del Swift ni del
 * iPhone real; eso solo se prueba compilando en Xcode.
 */
export async function asNativeApp(page: Page, options: { storage?: boolean; biometric?: FakeBiometric } = {}) {
  await page.addInitScript(
    ({ prefix, storage, biometric }) => {
      type Entry = { text: string; revision: number }
      type Options = { name?: string; text?: string; revision?: number; expectedRevision?: number | null; reason?: string }
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
      const w = window as unknown as Record<string, unknown>
      w.webkit = { messageHandlers: { bridge: { postMessage() {} } } }
      w.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        PluginHeaders: Object.entries(plugins).map(([name, methods]) => ({ name, methods: Object.keys(methods).map((m) => ({ name: m, rtype: 'promise' })) })),
        nativePromise: (plugin: string, method: string, o?: Options) => Promise.resolve().then(() => plugins[plugin]![method]!(o ?? {})),
      }
    },
    { prefix: FAKE_NATIVE_PREFIX, storage: options.storage ?? true, biometric: options.biometric ?? null },
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
