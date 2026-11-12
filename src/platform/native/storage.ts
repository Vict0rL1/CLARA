/**
 * Solo dentro de la app de iPhone (se carga con `import()` desde `platform/repository.ts`): registra el plugin nativo
 * de almacenamiento. Es de los pocos archivos que importan Capacitor (decisión 152).
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { NativeTextStore } from '../../storage/nativeRepository'
import { CLARA_STORAGE_PLUGIN, nativeStoreFromPlugin, type ClaraStoragePlugin } from '../nativeStore'

/** ¿Está el plugin en esta compilación de la app? (Lo publica el puente nativo al arrancar.) */
export function nativeStorageAvailable(): boolean {
  return Capacitor.isPluginAvailable(CLARA_STORAGE_PLUGIN)
}

export function createNativeStore(): NativeTextStore {
  return nativeStoreFromPlugin(registerPlugin<ClaraStoragePlugin>(CLARA_STORAGE_PLUGIN))
}
