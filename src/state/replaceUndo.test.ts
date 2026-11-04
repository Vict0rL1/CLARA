import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { saveTransaction } from '../domain/operations'
import { autoConfirmDue } from '../domain/scheduledJobs'
import type { AppData } from '../domain/types'
import { LocalBackups } from '../storage/autoBackup'
import { createBackup, parseBackup } from '../storage/backup'
import { IndexedDbRepository, openDatabase } from '../storage/indexedDbRepository'
import { MemoryRepository } from '../storage/localStorageRepository'
import type { DataRepository, SaveResult } from '../storage/repository'
import { baseData, bill, ctx, NOW } from '../test/fixtures'
import { replaceWithUndo } from './replaceUndo'
import { AppStore } from './store'

/** REC-01: «Deshacer» un reemplazo nunca borra lo que se guardó después. */
async function readyStore() {
  const repo = new MemoryRepository()
  await repo.save(baseData())
  const store = new AppStore(repo)
  await store.init()
  return { store, repo }
}

describe('REC-01 · deshacer importar/restaurar está atado a la revisión del reemplazo', () => {
  it('sin cambios posteriores, deshacer vuelve exactamente a lo anterior y queda guardado', async () => {
    const { store, repo } = await readyStore()
    const before = store.data!
    const imported = { ...baseData(), budgetId: 'b_importado' }
    const r = await replaceWithUndo(imported, store)
    expect(r.ok).toBe(true)
    expect(store.data!.budgetId).toBe('b_importado')
    expect(await r.undo()).toBe('undone')
    expect(store.data!.budgetId).toBe(before.budgetId)
    const loaded = await repo.load()
    expect(loaded.status === 'ok' && loaded.data.budgetId).toBe(before.budgetId)
  })

  it('si se guardó un movimiento después, deshacer se niega y el movimiento sobrevive (también al recargar)', async () => {
    const { store, repo } = await readyStore()
    const r = await replaceWithUndo({ ...baseData(), budgetId: 'b_importado' }, store)
    const saved = saveTransaction(store.data!, { id: 'tx_despues', kind: 'expense', status: 'realized', amountMinor: 900, date: ctx.today, accountId: store.data!.accounts[0]!.id, categoryId: 'dining' }, ctx)
    if (!saved.ok) throw new Error('save')
    expect(await store.commit(saved.data)).toBe(true)
    expect(await r.undo()).toBe('stale')
    expect(store.data!.transactions.some((t) => t.id === 'tx_despues')).toBe(true)
    const reloaded = new AppStore(repo)
    await reloaded.init()
    expect(reloaded.data!.transactions.some((t) => t.id === 'tx_despues')).toBe(true)
    expect(reloaded.data!.budgetId).toBe('b_importado')
  })

  it('deshacer dos veces no vuelve a reemplazar: la segunda ya es posterior', async () => {
    const { store } = await readyStore()
    const r = await replaceWithUndo({ ...baseData(), budgetId: 'b_importado' }, store)
    expect(await r.undo()).toBe('undone')
    expect(await r.undo()).toBe('stale')
  })
})

/* ------------------------------------------------------------------ */
/* RT-02: el «Deshacer» es del reemplazo, no de lo último que se guardó */
/* ------------------------------------------------------------------ */

/**
 * IndexedDB real (fake-indexeddb) con las escrituras en espera: cada `save` queda retenido hasta
 * `release()`, en orden de llegada, como un disco lento. La pantalla ya muestra el cambio (el
 * almacén es optimista) mientras la escritura sigue pendiente.
 */
class GatedRepository implements DataRepository {
  readonly kind = 'local' as const
  readonly backend = 'indexeddb' as const
  hold = true
  failNext = false
  private readonly inner: IndexedDbRepository
  private waiting: { go: () => void; done: Promise<SaveResult> }[] = []
  private queue: Promise<unknown> = Promise.resolve()
  constructor(inner: IndexedDbRepository) {
    this.inner = inner
  }
  load() {
    return this.inner.load()
  }
  clear() {
    return this.inner.clear()
  }
  subscribe() {
    return () => {}
  }
  save(data: AppData): Promise<SaveResult> {
    const fail = this.failNext
    this.failNext = false
    let go = () => {}
    const gate = this.hold ? new Promise<void>((resolve) => (go = resolve)) : null
    const run = async (): Promise<SaveResult> => {
      if (gate) await gate
      return fail ? { ok: false, error: 'quota' } : this.inner.save(data)
    }
    // En serie, como las transacciones de IndexedDB sobre el mismo almacén.
    const done = this.queue.then(run)
    this.queue = done.catch(() => undefined)
    if (gate) this.waiting.push({ go, done })
    return done
  }
  get pending(): number {
    return this.waiting.length
  }
  /** Deja pasar la escritura retenida más antigua y espera a que termine. */
  async release(): Promise<void> {
    while (this.waiting.length === 0) await new Promise((r) => setTimeout(r, 0))
    const next = this.waiting.shift()!
    next.go()
    await next.done
  }
}

const LS = globalThis as { localStorage?: unknown }
let lsOriginal: unknown
let idb: IDBFactory
beforeEach(() => {
  idb = new IDBFactory()
  lsOriginal = LS.localStorage
  const map = new Map<string, string>()
  LS.localStorage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) }
})
afterEach(() => {
  LS.localStorage = lsOriginal
})

const openRepo = async () => new IndexedDbRepository(await openDatabase(idb as unknown as globalThis.IDBFactory))

/** Lo que haría cada pantalla: importar un archivo (Ajustes › Copia) o restaurar una copia local (Copias locales). */
const CALLERS = {
  'importar una copia': async (next: AppData) => {
    const parsed = parseBackup(JSON.stringify(createBackup(next, new Date(NOW), '1.0.0')))
    if (!parsed.ok) throw new Error('backup')
    return parsed.data
  },
  'restaurar una copia local': async (next: AppData) => {
    const backups = new LocalBackups(new IDBFactory())
    const meta = await backups.save(next, 'manual', new Date(NOW), '1.0.0')
    const parsed = parseBackup((await backups.read(meta.id))!)
    if (!parsed.ok) throw new Error('backup')
    return parsed.data
  },
} as const

async function gatedStore() {
  const inner = await openRepo()
  await inner.load()
  await inner.save({ ...baseData(), revision: 1 })
  const repo = new GatedRepository(await openRepo())
  const store = new AppStore(repo)
  await store.init()
  return { store, repo }
}

/** Un gasto de CAD 9 registrado con la operación de siempre, sobre lo que se ve en ese momento. */
function cad9(store: AppStore): AppData {
  const r = saveTransaction(store.data!, { id: 'tx_cad9', kind: 'expense', status: 'realized', amountMinor: 900, date: ctx.today, accountId: store.data!.accounts[0]!.id, categoryId: 'dining' }, ctx)
  if (!r.ok) throw new Error('save')
  return r.data
}

async function reloaded(): Promise<AppData> {
  const fresh = new AppStore(await openRepo())
  await fresh.init()
  return fresh.data!
}

for (const [caller, source] of Object.entries(CALLERS)) {
  describe(`RT-02 · ${caller}: deshacer está ligado a la revisión que escribió el reemplazo`, () => {
    it('un gasto guardado mientras la escritura del reemplazo está pendiente: deshacer se niega y el gasto sobrevive a recargar', async () => {
      const { store, repo } = await gatedStore()
      const replacing = replaceWithUndo(await source({ ...baseData(), budgetId: 'b_importado' }), store)
      // La pantalla ya muestra lo importado; la persona registra un gasto antes de que termine de guardarse.
      expect(store.data!.budgetId).toBe('b_importado')
      const editing = store.commit(cad9(store))
      await repo.release() // escritura del reemplazo
      await repo.release() // escritura del gasto (en serie, después)
      const r = await replacing
      expect(r.ok).toBe(true)
      expect(await editing).toBe(true)
      repo.hold = false
      expect(await r.undo()).toBe('stale')
      expect(store.data!.transactions.some((t) => t.id === 'tx_cad9')).toBe(true)
      const after = await reloaded()
      expect(after.transactions.some((t) => t.id === 'tx_cad9')).toBe(true)
      expect(after.budgetId).toBe('b_importado')
    })

    it('un cambio posterior todavía pendiente al pulsar «Deshacer» también lo invalida', async () => {
      const { store, repo } = await gatedStore()
      const replacing = replaceWithUndo(await source({ ...baseData(), budgetId: 'b_importado' }), store)
      await repo.release()
      const r = await replacing
      const editing = store.commit(cad9(store))
      expect(repo.pending).toBe(1)
      expect(await r.undo()).toBe('stale')
      await repo.release()
      expect(await editing).toBe(true)
      expect((await reloaded()).transactions.some((t) => t.id === 'tx_cad9')).toBe(true)
    })

    it('una tarea automática que registra programados después del reemplazo también lo invalida (nunca se borran)', async () => {
      const { store, repo } = await gatedStore()
      const next = await source({ ...baseData(), budgetId: 'b_importado', schedules: [bill('2026-09-26', 5000, { id: 'auto', name: 'Gimnasio', frequency: 'weekly', autoConfirm: true })] })
      const replacing = replaceWithUndo(next, store)
      // Lo que hace `useScheduledJobs` en cuanto la pantalla muestra los datos nuevos.
      const auto = autoConfirmDue(store.data!, ctx)
      if (!auto.ok || auto.unchanged) throw new Error('auto')
      const job = store.commit(auto.data)
      await repo.release()
      await repo.release()
      const r = await replacing
      await job
      repo.hold = false
      expect(await r.undo()).toBe('stale')
      expect((await reloaded()).transactions.some((t) => t.scheduleId === 'auto')).toBe(true)
    })

    it('sin nada después, deshacer vuelve a lo anterior y queda guardado', async () => {
      const { store, repo } = await gatedStore()
      const before = store.data!
      const replacing = replaceWithUndo(await source({ ...baseData(), budgetId: 'b_importado' }), store)
      await repo.release()
      const r = await replacing
      repo.hold = false
      expect(await r.undo()).toBe('undone')
      expect(store.data!.budgetId).toBe(before.budgetId)
      expect((await reloaded()).budgetId).toBe(before.budgetId)
    })

    it('un cambio posterior cuyo guardado falla también lo invalida: no se pisa lo que se ve ni lo guardado', async () => {
      const { store, repo } = await gatedStore()
      repo.hold = false
      const r = await replaceWithUndo(await source({ ...baseData(), budgetId: 'b_importado' }), store)
      repo.failNext = true
      expect(await store.commit(cad9(store))).toBe(false)
      expect(store.hasUnsavedChanges).toBe(true)
      expect(await r.undo()).toBe('stale')
      // Lo que se ve sigue siendo el gasto sin guardar (para reintentar o descargar) y el almacenamiento, el reemplazo.
      expect(store.data!.transactions.some((t) => t.id === 'tx_cad9')).toBe(true)
      expect((await reloaded()).budgetId).toBe('b_importado')
    })

    it('si el reemplazo no se pudo guardar, no hay nada que deshacer y no se escribe nada más', async () => {
      const { store, repo } = await gatedStore()
      repo.failNext = true
      const replacing = replaceWithUndo(await source({ ...baseData(), budgetId: 'b_importado' }), store)
      await repo.release()
      const r = await replacing
      expect(r.ok).toBe(false)
      repo.hold = false
      expect(await r.undo()).toBe('stale')
      expect(repo.pending).toBe(0)
      expect((await reloaded()).budgetId).toBe(baseData().budgetId)
    })

    it('un gasto guardado cuando el reemplazo ya terminó: deshacer se niega (caso original de REC-01)', async () => {
      const { store, repo } = await gatedStore()
      repo.hold = false
      const r = await replaceWithUndo(await source({ ...baseData(), budgetId: 'b_importado' }), store)
      expect(await store.commit(cad9(store))).toBe(true)
      expect(await r.undo()).toBe('stale')
      expect((await reloaded()).transactions.some((t) => t.id === 'tx_cad9')).toBe(true)
    })
  })
}

describe('RT-02 · la copia «Antes de restaurar» sigue siendo el camino para recuperar lo anterior', () => {
  it('cuando deshacer se niega, lo anterior se puede leer de la copia local tal como estaba', async () => {
    const { store, repo } = await gatedStore()
    const before = store.data!
    const backups = new LocalBackups(new IDBFactory())
    // Lo que hacen ambas pantallas antes de reemplazar (keepCopyBeforeReplace / BackupsSection.restore).
    await backups.save(before, 'beforeRestore', new Date(NOW), '1.0.0')
    const replacing = replaceWithUndo({ ...baseData(), budgetId: 'b_importado' }, store)
    const editing = store.commit(cad9(store))
    await repo.release()
    await repo.release()
    const r = await replacing
    await editing
    repo.hold = false
    expect(await r.undo()).toBe('stale')
    const copy = (await backups.list()).find((b) => b.reason === 'beforeRestore')!
    const parsed = parseBackup((await backups.read(copy.id))!)
    expect(parsed.ok && parsed.data.budgetId).toBe(before.budgetId)
    expect(parsed.ok && parsed.data.transactions.map((t) => t.id)).toEqual(before.transactions.map((t) => t.id))
  })
})
