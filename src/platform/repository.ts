/**
 * Dónde guarda Clara según la plataforma. En el navegador, lo de siempre (IndexedDB; `localStorage` si no hay). En la
 * app de iPhone, un archivo propio de la app (`NativeRepository`, decisión 156); lo que hubiera en el WebView se trae
 * una sola vez.
 */
import { createRepository } from '../storage/indexedDbRepository'
import type { NativeTextStore } from '../storage/nativeRepository'
import type { DataRepository } from '../storage/repository'
import { isNativeIOS } from './index'

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
      const { NativeRepository } = await import('../storage/nativeRepository')
      return new NativeRepository(native.createNativeStore(), { legacy: web })
    }
  } catch {
    // Sin plugin (o sin poder cargarlo) se sigue con el almacenamiento del WebView, y se avisa.
  }
  fellBack = true
  return web()
}
