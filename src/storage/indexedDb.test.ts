/**
 * Almacenamiento IndexedDB y migración desde localStorage (con fake-indexeddb).
 */
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { saveTransaction } from '../domain/operations'
import { SCHEMA_VERSION, type AppData } from '../domain/types'
import { AppStore } from '../state/store'
import { baseData, ctx, tx } from '../test/fixtures'
import { createSyntheticData } from '../test/synthetic'
import { IndexedDbRepository, MIGRATED_STUB, openDatabase, PRE_IDB_KEY } from './indexedDbRepository'
import { STORAGE_KEY } from './localStorageRepository'

let factory: IDBFactory
let map: Map<string, string>
const g = globalThis as { localStorage?: unknown }
let original: unknown
beforeEach(() => {
  factory = new IDBFactory()
  map = new Map()
  original = g.localStorage
  g.localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
})
afterEach(() => {
  g.localStorage = original
})

const repo = async () => new IndexedDbRepository(await openDatabase(factory as unknown as globalThis.IDBFactory))
const withTx = (d: AppData, id: string) => {
  const r = saveTransaction(d, tx({ id, amountMinor: 1000, categoryId: 'dining' }), ctx)
  if (!r.ok) throw new Error('op')
  return r.data
}

describe('migración localStorage → IndexedDB', () => {
  it('copia, verifica, conserva el origen y marca el original; no vuelve a importar', async () => {
    const original = JSON.stringify(baseData({ transactions: [tx({ id: 'a' })] }))
    map.set(STORAGE_KEY, original)
    const r1 = await repo()
    const loaded = await r1.load()
    expect(loaded.status === 'ok' && loaded.data.transactions.map((t) => t.id)).toEqual(['a'])
    expect(map.get(PRE_IDB_KEY)).toBe(original) // origen intacto
    expect(map.get(STORAGE_KEY)).toBe(MIGRATED_STUB) // una versión antigua no lo sobrescribirá
    expect(await r1.readMigration()).toMatchObject({ from: 'localStorage', status: 'done' })
    // Una segunda apertura lee IndexedDB aunque la copia del origen cambie: nunca importa dos veces.
    map.set(PRE_IDB_KEY, JSON.stringify(baseData({ transactions: [tx({ id: 'otro' })] })))
    const again = await (await repo()).load()
    expect(again.status === 'ok' && again.data.transactions.map((t) => t.id)).toEqual(['a'])
  })

  it('migración interrumpida tras escribir en IndexedDB: se completa al abrir de nuevo', async () => {
    const original = JSON.stringify(baseData())
    map.set(STORAGE_KEY, original)
    const db = await openDatabase(factory as unknown as globalThis.IDBFactory)
    // Estado tras una interrupción: datos escritos y verificados, origen sin marcar.
    await new Promise<void>((resolve) => {
      const t = db.transaction('kv', 'readwrite')
      t.objectStore('kv').put(JSON.parse(original), 'data')
      t.objectStore('kv').put({ revision: 0, savedAt: 'x' }, 'meta')
      t.objectStore('kv').put({ from: 'localStorage', status: 'written', at: 'x' }, 'migration')
      t.oncomplete = () => resolve()
    })
    const r = new IndexedDbRepository(db)
    expect((await r.load()).status).toBe('ok')
    expect(map.get(PRE_IDB_KEY)).toBe(original)
    expect(map.get(STORAGE_KEY)).toBe(MIGRATED_STUB)
    expect(await r.readMigration()).toMatchObject({ status: 'done' })
  })

  it('si el navegador borró IndexedDB pero queda la copia del origen, se recupera (no se muestra vacía)', async () => {
    map.set(STORAGE_KEY, MIGRATED_STUB)
    map.set(PRE_IDB_KEY, JSON.stringify(baseData({ transactions: [tx({ id: 'rescatado' })] })))
    const loaded = await (await repo()).load()
    expect(loaded.status === 'ok' && loaded.data.transactions.map((t) => t.id)).toEqual(['rescatado'])
  })

  it('datos dañados o de una versión futura: no se migran ni se tocan', async () => {
    const future = JSON.stringify({ ...baseData(), schemaVersion: SCHEMA_VERSION + 50 })
    map.set(STORAGE_KEY, future)
    const r = await repo()
    expect((await r.load()).status).toBe('corrupt')
    expect(map.get(STORAGE_KEY)).toBe(future)
    expect(map.has(PRE_IDB_KEY)).toBe(false)
    expect(await r.readMigration()).toBeUndefined()
  })

  it('datos de una versión anterior: se migra el almacenamiento y se guarda la copia previa al cambio de formato', async () => {
    const v6: Record<string, unknown> = JSON.parse(JSON.stringify(baseData()))
    v6.schemaVersion = 6
    delete v6.inbox
    delete v6.incomeDistributions
    map.set(STORAGE_KEY, JSON.stringify(v6))
    const r = await repo()
    const loaded = await r.load()
    expect(loaded.status === 'ok' && loaded.data.schemaVersion).toBe(SCHEMA_VERSION)
    // La copia previa está en IndexedDB y Datos y recuperación la lee por el repositorio (antes solo miraba localStorage).
    const copy = JSON.parse((await r.preMigrationCopy())!) as { fromVersion: number; raw: string }
    expect(copy.fromVersion).toBe(6)
    expect(JSON.parse(copy.raw)).toEqual(v6)
  })

  it('borrar todos los datos elimina también la copia del origen (no reaparecen al abrir)', async () => {
    map.set(STORAGE_KEY, JSON.stringify(baseData()))
    const r = await repo()
    await r.load()
    await r.clear()
    expect(map.has(PRE_IDB_KEY)).toBe(false)
    expect((await (await repo()).load()).status).toBe('empty')
  })
})

describe('IndexedDB: guardado y pestañas', () => {
  it('dos pestañas: la segunda no sobrescribe lo que guardó la primera; tras recargar, sí guarda', async () => {
    map.set(STORAGE_KEY, JSON.stringify(baseData()))
    const tabA = new AppStore(await repo())
    await tabA.init()
    const tabB = new AppStore(await repo())
    await tabB.init()
    expect(await tabA.commit(withTx(tabA.data!, 'from-a'))).toBe(true)
    expect(await tabB.commit(withTx(tabB.data!, 'from-b'))).toBe(false)
    const s = tabB.getState()
    expect(s.phase === 'ready' && s.save).toEqual({ state: 'error', error: 'conflict' })
    await tabB.reload()
    expect(tabB.data!.transactions.map((t) => t.id)).toEqual(['from-a'])
    expect(await tabB.commit(withTx(tabB.data!, 'from-b'))).toBe(true)
    const fresh = await (await repo()).load()
    expect(fresh.status === 'ok' && fresh.data.transactions.map((t) => t.id).sort()).toEqual(['from-a', 'from-b'])
  })

  it('50.000 movimientos (no caben en localStorage) se guardan y se leen completos', async () => {
    const big = createSyntheticData({ movements: 50000, today: '2026-09-28' })
    const r = await repo()
    expect((await r.load()).status).toBe('empty')
    expect(await r.save(big)).toEqual({ ok: true })
    const loaded = await (await repo()).load()
    expect(loaded.status === 'ok' && loaded.data.transactions.length).toBe(big.transactions.length)
  }, 60_000)
})
