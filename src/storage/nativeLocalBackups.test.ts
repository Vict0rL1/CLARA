import { describe, expect, it } from 'vitest'
import { FakeStore } from '../test/fakeNativeStore'
import { baseData, EARLIER } from '../test/fixtures'
import { NativeStoreError } from './nativeRepository'
import { NATIVE_BACKUP_INDEX, NativeLocalBackups } from './nativeLocalBackups'

const at = (minutes: number) => new Date(Date.parse('2026-11-14T12:00:00.000Z') + minutes * 60_000)
const data = (updatedAt = EARLIER) => baseData({ updatedAt })

describe('copias locales en archivos de la app (NativeLocalBackups)', () => {
  it('guarda la copia en su propio archivo y la lista en un índice; leerla devuelve el JSON exacto', async () => {
    const store = new FakeStore()
    const backups = new NativeLocalBackups(store)
    const meta = await backups.save(data(), 'auto', at(0), '1.0.0')
    expect(meta).toMatchObject({ id: '2026-11-14T12:00:00.000Z-auto', reason: 'auto', budgetId: 'budget-1', isDemo: false, dataUpdatedAt: EARLIER })
    expect([...store.files.keys()].sort()).toEqual(['backup-1794657600000-auto', NATIVE_BACKUP_INDEX])
    expect(store.writes).toEqual(['backup-1794657600000-auto', NATIVE_BACKUP_INDEX])
    const json = await backups.read(meta.id)
    expect(json).toBe(store.files.get('backup-1794657600000-auto')!.text)
    expect(JSON.parse(json!).data.budgetId).toBe('budget-1')
    expect(await backups.list()).toEqual([meta])
    expect(await backups.read('no-existe')).toBeNull()
  })

  it('conserva las más recientes y borra del disco las que salen', async () => {
    const backups = new NativeLocalBackups(new FakeStore())
    const store = (backups as unknown as { store: FakeStore }).store
    for (let i = 0; i < 4; i++) await backups.save(data(`2026-11-14T0${i}:00:00.000Z`), i === 3 ? 'beforeRestore' : 'auto', at(i), '1.0.0', 2)
    expect((await backups.list()).map((b) => b.id)).toEqual(['2026-11-14T12:03:00.000Z-beforeRestore', '2026-11-14T12:02:00.000Z-auto'])
    expect([...store.files.keys()].filter((k) => k.startsWith('backup-')).sort()).toEqual(['backup-1794657720000-auto', 'backup-1794657780000-restore'])
  })

  it('si el índice no se puede escribir, la lista no cambia: nunca señala una copia que no existe', async () => {
    const store = new FakeStore()
    const backups = new NativeLocalBackups(store)
    await backups.save(data(), 'auto', at(0), '1.0.0')
    const before = await backups.list()
    // La copia se escribe; el índice falla.
    const write = store.write.bind(store)
    store.write = async (name, text, revision, expected) => {
      if (name === NATIVE_BACKUP_INDEX) throw new NativeStoreError('noSpace')
      return write(name, text, revision, expected)
    }
    await expect(backups.save(data('2026-11-14T10:00:00.000Z'), 'manual', at(5), '1.0.0')).rejects.toThrow()
    expect(await backups.list()).toEqual(before)
  })

  it('quitar una copia la saca del índice y del disco', async () => {
    const store = new FakeStore()
    const backups = new NativeLocalBackups(store)
    const meta = await backups.save(data(), 'manual', at(0), '1.0.0')
    await backups.remove(meta.id)
    expect(await backups.list()).toEqual([])
    expect([...store.files.keys()]).toEqual([NATIVE_BACKUP_INDEX])
    await expect(backups.remove('no-existe')).resolves.toBeUndefined()
  })

  it('un índice ilegible no se sobrescribe: se dice que no se pueden leer las copias', async () => {
    const store = new FakeStore()
    store.files.set(NATIVE_BACKUP_INDEX, { text: '{roto', revision: 3 })
    const backups = new NativeLocalBackups(store)
    await expect(backups.list()).rejects.toThrow()
    await expect(backups.save(data(), 'auto', at(0), '1.0.0')).rejects.toThrow()
    expect(store.files.get(NATIVE_BACKUP_INDEX)).toEqual({ text: '{roto', revision: 3 })
    store.files.set(NATIVE_BACKUP_INDEX, { text: JSON.stringify([{ id: 'x', file: '../data', createdAt: 'y' }]), revision: 4 })
    await expect(backups.list()).rejects.toThrow()
  })
})
