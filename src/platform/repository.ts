/**
 * Dónde guarda Clara según la plataforma. En el navegador, lo de siempre (IndexedDB; `localStorage` si no hay). En la
 * app de iPhone, un archivo propio de la app (`NativeRepository`, decisión 156); lo que hubiera en el WebView se trae
 * una sola vez.
 */
import { createRepository } from '../storage/indexedDbRepository'
import type { NativeTextStore } from '../storage/nativeRepository'
import type { DataRepository } from '../storage/repository'
import { isNativeIOS, provideNativeServices } from './index'

/** Lo que hace falta del lado nativo (en la app, `native/storage.ts`; en las pruebas, un doble). */
export interface NativeStorageModule {
  nativeStorageAvailable(): boolean
  createNativeStore(): NativeTextStore
}

export interface PlatformRepositoryDeps {
  native?: boolean
  loadNative?: () => Promise<NativeStorageModule>
  web?: () => Promise<DataRepository>
}

let fellBack = false

/**
 * `true` si esto es la app de iPhone pero no se pudo usar el archivo nativo y se está guardando en el almacenamiento
 * del WebView, que iOS puede vaciar. La interfaz lo avisa: nunca se oculta.
 */
export function nativeStorageFellBack(): boolean {
  return fellBack
}

export async function createPlatformRepository(deps: PlatformRepositoryDeps = {}): Promise<DataRepository> {
  const web = deps.web ?? createRepository
  fellBack = false
  if (!(deps.native ?? isNativeIOS())) return web()
  try {
    const native = await (deps.loadNative ?? (() => import('./native/storage')))()
    if (native.nativeStorageAvailable()) {
      const [{ NativeRepository }, { NativeLocalBackups }, mirror] = await Promise.all([import('../storage/nativeRepository'), import('../storage/nativeLocalBackups'), import('./deviceMirror')])
      const store = native.createNativeStore()
      // Fase 2 (decisión 173): las copias locales y los ajustes de este dispositivo, también fuera del WebView. Lo que
      // iOS hubiera vaciado del WebView vuelve antes de pintar (el bloqueo se lee al arrancar).
      if (typeof localStorage !== 'undefined' && typeof document !== 'undefined') {
        await mirror.restoreDeviceKeys(store, localStorage)
        const device = mirror.startDeviceMirror(store, localStorage, document)
        void device.save()
        provideNativeServices({ saveDeviceSettings: device.save })
      }
      provideNativeServices({ localBackups: new NativeLocalBackups(store) })
      return new NativeRepository(store, { legacy: web })
    }
  } catch {
    // Sin plugin (o sin poder cargarlo) se sigue con el almacenamiento del WebView, y se avisa.
  }
  fellBack = true
  return web()
}
