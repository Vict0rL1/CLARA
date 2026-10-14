import { describe, expect, it } from 'vitest'
import { saveTransaction } from '../domain/operations'
import { MemoryRepository } from '../storage/localStorageRepository'
import { baseData, ctx } from '../test/fixtures'
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
