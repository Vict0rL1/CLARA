import type { Page } from '@playwright/test'

/** Donde el doble del plugin guarda cada «archivo» (en la app real: Application Support, fuera del WebView). */
export const FAKE_NATIVE_PREFIX = 'fake-native:'

/**
 * Hace que la página crea que corre dentro de la app de iPhone: deja el puente de Capacitor (`window.Capacitor` y
 * `webkit.messageHandlers.bridge`, que es por donde `@capacitor/core` reconoce iOS) y, si `storage` no es `false`, un
 * doble del plugin local `ClaraStorage` con el mismo contrato que el Swift (`ios/App/App/ClaraStoragePlugin.swift`):
 * un texto por nombre con su revisión, rechazo `conflict` si la revisión esperada no coincide.
 *
 * Es un doble: comprueba el lado web de la app (repositorio nativo, textos, pantallas). No dice nada del Swift ni del
 * iPhone real; eso solo se prueba compilando en Xcode.
 */
export async function asNativeApp(page: Page, options: { storage?: boolean } = {}) {
  await page.addInitScript(
    ({ prefix, storage }) => {
      type Entry = { text: string; revision: number }
      type Options = { name?: string; text?: string; revision?: number; expectedRevision?: number | null }
      const read = (name: string): Entry | null => {
        const raw = localStorage.getItem(prefix + name)
        return raw === null ? null : (JSON.parse(raw) as Entry)
      }
      const fail = (message: string, code: string) => Promise.reject(Object.assign(new Error(message), { code }))
      const methods: Record<string, (o: Options) => unknown> = {
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
      const w = window as unknown as Record<string, unknown>
      w.webkit = { messageHandlers: { bridge: { postMessage() {} } } }
      w.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        PluginHeaders: storage ? [{ name: 'ClaraStorage', methods: Object.keys(methods).map((name) => ({ name, rtype: 'promise' })) }] : [],
        nativePromise: (_plugin: string, method: string, o?: Options) => Promise.resolve().then(() => methods[method]!(o ?? {})),
      }
    },
    { prefix: FAKE_NATIVE_PREFIX, storage: options.storage ?? true },
  )
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
