import { describe, expect, it, vi } from 'vitest'
import { captureQueueFromPlugin, type CaptureQueuePort, type ClaraCapturesPlugin } from '../platform/nativeCaptures'
import { baseData } from '../test/fixtures'
import type { AppData } from '../domain/types'
import { createCaptureSync, type CaptureSyncStore } from './captureSync'

const line = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ captureId: id, createdAt: '2026-09-28T15:00:00Z', origin: 'apple_pay', rawAmount: '4.25', currencyHint: 'CAD', merchant: 'Tim Hortons', ...extra }) + '\n'

/** Cola en memoria con el mismo contrato que el plugin. */
function fakeQueue(initial = '') {
  let text = initial
  const listeners = new Set<() => void>()
  const removed: string[][] = []
  const port: CaptureQueuePort & { removed: string[][]; text: () => string; append: (l: string) => void; fire: () => void } = {
    read: async () => text,
    remove: async (ids) => {
      removed.push([...ids])
      text = text
        .split('\n')
        .filter((l) => l && !ids.includes((JSON.parse(l) as { captureId: string }).captureId))
        .map((l) => l + '\n')
        .join('')
    },
    appendTest: async ({ rawAmount, currencyHint, merchant }) => {
      text += line('cap-test0001', { rawAmount, currencyHint, merchant, test: true })
      return 'cap-test0001'
    },
    onAdded: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    removed,
    text: () => text,
    append: (l) => {
      text += l
    },
    fire: () => listeners.forEach((l) => l()),
  }
  return port
}

function fakeStore(initial: AppData | null, saves = true) {
  const listeners = new Set<() => void>()
  const store: Omit<CaptureSyncStore, 'data'> & { data: AppData | null; commits: number; set: (d: AppData | null) => void } = {
    data: initial,
    commits: 0,
    commit: async (next) => {
      store.commits += 1
      if (!saves) return false
      store.data = next
      listeners.forEach((l) => l())
      return true
    },
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    set: (d) => {
      store.data = d
      listeners.forEach((l) => l())
    },
  }
  return store
}

describe('captureSync', () => {
  it('lee, guarda y SOLO después pide quitar las líneas; una segunda lectura no duplica', async () => {
    const queue = fakeQueue(line('cap-00000001'))
    const store = fakeStore(baseData())
    const sync = createCaptureSync(queue, store)
    expect(await sync.sync()).toMatchObject({ status: 'imported', summary: { saved: ['cap-00000001'] } })
    expect(store.data!.transactions.map((t) => [t.id, t.amountMinor, t.review?.reason])).toEqual([['cap-00000001', 425, 'auto_capture']])
    expect(queue.removed).toEqual([['cap-00000001']])
    expect(queue.text()).toBe('')
    expect(await sync.sync()).toEqual({ status: 'empty' })
    expect(store.commits).toBe(1)
  })

  it('si no se pudo guardar, la cola no se toca y la próxima vez se vuelve a intentar', async () => {
    const queue = fakeQueue(line('cap-00000001'))
    const store = fakeStore(baseData(), false)
    expect(await createCaptureSync(queue, store).sync()).toEqual({ status: 'notSaved' })
    expect(queue.removed).toEqual([])
    expect(queue.text()).toBe(line('cap-00000001'))
  })

  it('si quitar las líneas falla, lo guardado no se repite: la próxima lectura las salta y vuelve a pedir quitarlas', async () => {
    const queue = fakeQueue(line('cap-00000001'))
    const failing = { ...queue, remove: vi.fn().mockRejectedValueOnce(new Error('disk')).mockImplementation(queue.remove) }
    const store = fakeStore(baseData())
    const sync = createCaptureSync(failing, store)
    expect(await sync.sync()).toMatchObject({ status: 'imported' })
    expect(await sync.sync()).toMatchObject({ status: 'imported', summary: { saved: [], skipped: ['cap-00000001'], ack: ['cap-00000001'] } })
    expect(store.data!.transactions).toHaveLength(1)
    expect(queue.text()).toBe('')
  })

  it('no importa nada sin presupuesto ni en la demostración: los pagos esperan en la cola', async () => {
    const queue = fakeQueue(line('cap-00000001'))
    expect(await createCaptureSync(queue, fakeStore(null)).sync()).toEqual({ status: 'waiting', reason: 'noData' })
    expect(await createCaptureSync(queue, fakeStore(baseData({ isDemo: true }))).sync()).toEqual({ status: 'waiting', reason: 'demo' })
    expect(queue.removed).toEqual([])
  })

  it('una cola que no se puede leer no es «vacía»', async () => {
    const queue = { ...fakeQueue(), read: async () => Promise.reject(new Error('no')) }
    expect(await createCaptureSync(queue, fakeStore(baseData())).sync()).toEqual({ status: 'unavailable' })
  })

  it('dos lecturas a la vez no corren juntas: la segunda se hace justo después y ve lo nuevo', async () => {
    const queue = fakeQueue(line('cap-00000001'))
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const slow = { ...queue, read: async () => (await gate, queue.read()) }
    const store = fakeStore(baseData())
    const sync = createCaptureSync(slow, store)
    const first = sync.sync()
    queue.append(line('cap-00000002', { createdAt: '2026-09-28T15:30:00Z', merchant: 'Metro' }))
    const second = sync.sync()
    release()
    await Promise.all([first, second])
    expect(store.data!.transactions.map((t) => t.id).sort()).toEqual(['cap-00000001', 'cap-00000002'])
    expect(queue.text()).toBe('')
  })

  it('escucha: al tener datos, al volver a primer plano, con «visibilitychange» visible y con el aviso de la acción', async () => {
    const queue = fakeQueue()
    const store = fakeStore(null)
    const sync = createCaptureSync(queue, store)
    const target = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
    const stop = sync.start(target)
    const flush = () => new Promise((r) => setTimeout(r, 0))

    queue.append(line('cap-00000001'))
    store.set(baseData())
    await flush()
    expect(store.data!.transactions.map((t) => t.id)).toEqual(['cap-00000001'])

    queue.append(line('cap-00000002', { createdAt: '2026-09-28T15:30:00Z', merchant: 'Metro' }))
    target.dispatchEvent(new Event('resume'))
    await flush()
    expect(store.data!.transactions).toHaveLength(2)

    queue.append(line('cap-00000003', { createdAt: '2026-09-28T15:40:00Z', merchant: 'Uber' }))
    target.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(store.data!.transactions).toHaveLength(3)

    queue.append(line('cap-00000004', { createdAt: '2026-09-28T15:50:00Z', merchant: 'Cine' }))
    queue.fire()
    await flush()
    expect(store.data!.transactions).toHaveLength(4)

    stop()
    queue.append(line('cap-00000005', { createdAt: '2026-09-28T15:55:00Z', merchant: 'Bar' }))
    target.dispatchEvent(new Event('resume'))
    queue.fire()
    await flush()
    expect(store.data!.transactions).toHaveLength(4)
  })

  it('«Probar»: la prueba llega a las propuestas por el mismo camino y no crea ningún movimiento', async () => {
    const queue = fakeQueue()
    const store = fakeStore(baseData())
    expect(await createCaptureSync(queue, store).test('Prueba de Clara')).toBe(true)
    expect(store.data!.transactions).toEqual([])
    expect(store.data!.captures!.proposals).toMatchObject([{ captureId: 'cap-test0001', test: true, merchant: 'Prueba de Clara', amount: { kind: 'budget', minor: 1 } }])
    expect(await createCaptureSync(queue, fakeStore(baseData({ isDemo: true }))).test('x')).toBe(false)
  })
})

describe('adaptador del plugin ClaraCaptures', () => {
  const plugin = (over: Partial<ClaraCapturesPlugin> = {}): ClaraCapturesPlugin => ({
    read: async () => ({ text: 'x' }),
    remove: async () => ({ removed: 1 }),
    appendTest: async () => ({ captureId: 'id-1' }),
    addListener: async () => ({ remove: async () => {} }),
    ...over,
  })

  it('una respuesta sin texto es un fallo, nunca una cola vacía; quitar nada no llama al iPhone', async () => {
    await expect(captureQueueFromPlugin(plugin({ read: async () => ({}) })).read()).rejects.toThrow()
    await expect(captureQueueFromPlugin(plugin()).read()).resolves.toBe('x')
    const remove = vi.fn(async () => ({ removed: 0 }))
    await captureQueueFromPlugin(plugin({ remove })).remove([])
    expect(remove).not.toHaveBeenCalled()
    await captureQueueFromPlugin(plugin({ remove })).remove(['a', 'b'])
    expect(remove).toHaveBeenCalledWith({ ids: ['a', 'b'] })
    await expect(captureQueueFromPlugin(plugin({ appendTest: async () => ({}) })).appendTest({ rawAmount: '0.01', currencyHint: 'CAD', merchant: 'x' })).rejects.toThrow()
  })

  it('dejar de escuchar antes de que el plugin responda también quita la escucha', async () => {
    const removeHandle = vi.fn(async () => {})
    let resolve!: (h: { remove: () => Promise<void> }) => void
    const port = captureQueueFromPlugin(plugin({ addListener: () => new Promise((r) => (resolve = r)) }))
    const stop = port.onAdded(() => {})
    stop()
    resolve({ remove: removeHandle })
    await Promise.resolve()
    await Promise.resolve()
    expect(removeHandle).toHaveBeenCalled()
  })
})
