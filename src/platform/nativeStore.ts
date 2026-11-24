/**
 * Adaptador entre el plugin nativo `ClaraStorage` (ios/App/App/ClaraStoragePlugin.swift) y el almacén de textos que usa
 * `NativeRepository`. No importa Capacitor: recibe el plugin ya registrado (`native/storage.ts`), así se prueba con uno
 * simulado.
 */
import { NativeStoreError, type NativeStoreErrorCode, type NativeTextStore } from '../storage/nativeRepository'

/** Contrato del plugin, tal como lo expone el lado nativo. */
export interface ClaraStoragePlugin {
  read(options: { name: string }): Promise<{ exists: boolean; text?: string; revision?: number }>
  write(options: { name: string; text: string; revision: number; expectedRevision: number | null }): Promise<void>
  remove(options: { name: string }): Promise<void>
}

export const CLARA_STORAGE_PLUGIN = 'ClaraStorage'

const CODES: Record<string, NativeStoreErrorCode> = { conflict: 'conflict', noSpace: 'noSpace', unavailable: 'unavailable' }

/** Capacitor rechaza con un error que lleva `code` (el segundo argumento de `call.reject` en Swift). */
export function toNativeStoreError(error: unknown): NativeStoreError {
  if (error instanceof NativeStoreError) return error
  const code = (error as { code?: unknown } | null)?.code
  const message = (error as { message?: unknown } | null)?.message
  return new NativeStoreError((typeof code === 'string' && CODES[code]) || 'unknown', typeof message === 'string' ? message : undefined)
}

export function nativeStoreFromPlugin(plugin: ClaraStoragePlugin): NativeTextStore {
  return {
    async read(name) {
      let result: Awaited<ReturnType<ClaraStoragePlugin['read']>>
      try {
        result = await plugin.read({ name })
      } catch (error) {
        throw toNativeStoreError(error)
      }
      if (!result.exists) return null
      // Una respuesta sin texto o sin revisión entera no es «vacío»: es un fallo del puente y se dice.
      if (typeof result.text !== 'string' || typeof result.revision !== 'number' || !Number.isInteger(result.revision)) throw new NativeStoreError('unknown', 'respuesta incompleta del almacén nativo')
      return { text: result.text, revision: result.revision }
    },
    async write(name, text, revision, expectedRevision) {
      try {
        await plugin.write({ name, text, revision, expectedRevision })
      } catch (error) {
        throw toNativeStoreError(error)
      }
    },
    async remove(name) {
      try {
        await plugin.remove({ name })
      } catch (error) {
        throw toNativeStoreError(error)
      }
    },
  }
}
