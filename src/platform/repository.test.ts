import { describe, expect, it } from 'vitest'
import { NativeRepository, NativeStoreError, type NativeTextStore } from '../storage/nativeRepository'
import { MemoryRepository } from '../storage/localStorageRepository'
import { nativeStoreFromPlugin, toNativeStoreError, type ClaraStoragePlugin } from './nativeStore'
import { createPlatformRepository, nativeStorageFellBack } from './repository'

const memoryStore = (): NativeTextStore => {
  const files = new Map<string, { text: string; revision: number }>()
  return {
    read: async (name) => files.get(name) ?? null,
    write: async (name, text, revision) => void files.set(name, { text, revision }),
    remove: async (name) => void files.delete(name),
  }
}

describe('dónde guarda Clara según la plataforma', () => {
  it('en el navegador usa el almacenamiento de siempre y ni carga lo nativo', async () => {
    const web = new MemoryRepository()
    let loaded = 0
    const repo = await createPlatformRepository({
      native: false,
      web: async () => web,
      loadNative: async () => {
        loaded++
        throw new Error('no debería cargarse')
      },
    })
    expect(repo).toBe(web)
    expect(loaded).toBe(0)
    expect(nativeStorageFellBack()).toBe(false)
  })

  it('en la app de iPhone con el plugin usa el archivo nativo', async () => {
    const repo = await createPlatformRepository({
      native: true,
      web: async () => new MemoryRepository(),
      loadNative: async () => ({ nativeStorageAvailable: () => true, createNativeStore: memoryStore }),
    })
    expect(repo).toBeInstanceOf(NativeRepository)
    expect(repo.backend).toBe('native')
    expect(nativeStorageFellBack()).toBe(false)
  })

  it('en la app sin el plugin (o sin poder cargarlo) sigue con el WebView y lo marca para avisar', async () => {
    const web = new MemoryRepository()
    const missing = await createPlatformRepository({ native: true, web: async () => web, loadNative: async () => ({ nativeStorageAvailable: () => false, createNativeStore: memoryStore }) })
    expect(missing).toBe(web)
    expect(nativeStorageFellBack()).toBe(true)
    const broken = await createPlatformRepository({
      native: true,
      web: async () => web,
      loadNative: async () => {
        throw new Error('no cargó')
      },
    })
    expect(broken).toBe(web)
    expect(nativeStorageFellBack()).toBe(true)
    // La marca es de la última elección: una posterior en el navegador la limpia.
    await createPlatformRepository({ native: false, web: async () => web })
    expect(nativeStorageFellBack()).toBe(false)
  })
})

describe('adaptador del plugin ClaraStorage', () => {
  const plugin = (over: Partial<ClaraStoragePlugin> = {}): ClaraStoragePlugin & { calls: unknown[] } => {
    const calls: unknown[] = []
    return {
      calls,
      read: async (o) => (calls.push(['read', o]), { exists: false }),
      write: async (o) => void calls.push(['write', o]),
      remove: async (o) => void calls.push(['remove', o]),
      ...over,
    }
  }

  it('lee: sin archivo es null; con archivo, texto y revisión', async () => {
    expect(await nativeStoreFromPlugin(plugin()).read('data')).toBeNull()
    expect(await nativeStoreFromPlugin(plugin({ read: async () => ({ exists: true, text: '{}', revision: 3 }) })).read('data')).toEqual({ text: '{}', revision: 3 })
  })

  it('una respuesta incompleta del puente no se toma por «vacío»', async () => {
    for (const bad of [{ exists: true }, { exists: true, text: '{}' }, { exists: true, text: '{}', revision: 1.5 }, { exists: true, revision: 2 }]) {
      await expect(nativeStoreFromPlugin(plugin({ read: async () => bad })).read('data')).rejects.toMatchObject({ code: 'unknown' })
    }
  })

  it('escribe y quita con los argumentos del contrato nativo (null = «no había archivo»)', async () => {
    const p = plugin()
    const store = nativeStoreFromPlugin(p)
    await store.write('data', '{"a":1}', 1, null)
    await store.write('data', '{"a":2}', 2, 1)
    await store.remove('data')
    expect(p.calls).toEqual([
      ['write', { name: 'data', text: '{"a":1}', revision: 1, expectedRevision: null }],
      ['write', { name: 'data', text: '{"a":2}', revision: 2, expectedRevision: 1 }],
      ['remove', { name: 'data' }],
    ])
  })

  it('traduce los códigos de rechazo de Swift; lo desconocido es «unknown», nunca un éxito', async () => {
    const rejecting = (code?: string) =>
      nativeStoreFromPlugin(
        plugin({
          write: async () => {
            throw Object.assign(new Error('nativo'), code === undefined ? {} : { code })
          },
        }),
      )
    await expect(rejecting('conflict').write('data', '', 2, 1)).rejects.toMatchObject({ code: 'conflict' })
    await expect(rejecting('noSpace').write('data', '', 2, 1)).rejects.toMatchObject({ code: 'noSpace' })
    await expect(rejecting('unavailable').write('data', '', 2, 1)).rejects.toMatchObject({ code: 'unavailable' })
    await expect(rejecting('invalidName').write('data', '', 2, 1)).rejects.toMatchObject({ code: 'unknown' })
    await expect(rejecting('UNIMPLEMENTED').write('data', '', 2, 1)).rejects.toMatchObject({ code: 'unknown' })
    await expect(rejecting().write('data', '', 2, 1)).rejects.toMatchObject({ code: 'unknown' })
    expect(toNativeStoreError('texto suelto')).toBeInstanceOf(NativeStoreError)
    expect(toNativeStoreError(null).code).toBe('unknown')
  })
})

describe('centro de datos: la app de iPhone dice dónde guarda de verdad', () => {
  it('archivo nativo → fila correcta; WebView por no poder usar el archivo → aviso, nunca «todo bien»', async () => {
    const { recoveryStatus } = await import('../domain/recovery')
    const { baseData } = await import('../test/fixtures')
    const base = { data: baseData(), today: '2026-11-12', localCopies: { count: 1, lastCreatedAt: '2026-11-11T10:00:00.000Z' }, preMigrationCopy: false, errorCount: 0, offlineReady: true }
    const native = recoveryStatus({ ...base, backend: 'native' }).rows.find((r) => r.id === 'saving')!
    expect(native).toMatchObject({ state: 'ok', params: { backend: 'native', webViewFallback: 0 } })
    const fallback = recoveryStatus({ ...base, backend: 'indexeddb', webViewFallback: true }).rows.find((r) => r.id === 'saving')!
    expect(fallback).toMatchObject({ state: 'warn', params: { backend: 'indexeddb', webViewFallback: 1 } })
    // En el navegador no cambia nada.
    expect(recoveryStatus({ ...base, backend: 'indexeddb' }).rows.find((r) => r.id === 'saving')).toMatchObject({ state: 'ok' })
    // Solo memoria sigue siendo lo más grave.
    expect(recoveryStatus({ ...base, backend: 'memory', webViewFallback: true }).rows.find((r) => r.id === 'saving')!.state).toBe('critical')
  })
})
