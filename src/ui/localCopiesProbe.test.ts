/**
 * `probeLocalCopies` (revisión de seguridad QA27, O-3): que exista `indexedDB` no basta; la base tiene que abrir.
 */
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
})

describe('probeLocalCopies', () => {
  it('sin indexedDB → false; con una base que abre → true; con una que falla al abrir → false; se recuerda', async () => {
    vi.stubGlobal('indexedDB', undefined)
    let mod = await import('./useAutoBackup')
    expect(await mod.probeLocalCopies()).toBe(false)

    vi.resetModules()
    vi.stubGlobal('indexedDB', new IDBFactory())
    mod = await import('./useAutoBackup')
    expect(await mod.probeLocalCopies()).toBe(true)
    expect(await mod.probeLocalCopies()).toBe(true)

    vi.resetModules()
    const blocked = new IDBFactory()
    blocked.open = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('indexedDB', blocked)
    mod = await import('./useAutoBackup')
    expect(await mod.probeLocalCopies()).toBe(false)
  })
})
