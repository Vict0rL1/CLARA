import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = () => void

/** Contenedor de service workers falso: lo justo para `connect`. */
function fakeContainer(opts: { controlled: boolean; register: () => Promise<unknown>; ready?: Promise<unknown> }) {
  return {
    controller: opts.controlled ? ({} as ServiceWorker) : null,
    ready: opts.ready ?? new Promise(() => {}),
    register: vi.fn(opts.register),
    addEventListener: vi.fn((_type: string, _listener: Listener) => {}),
  } as unknown as ServiceWorkerContainer
}

async function load() {
  vi.resetModules()
  return import('./register')
}

describe('estado «Uso sin conexión»', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('una página que ya controla el service worker funciona sin conexión aunque `register()` falle (sin red)', async () => {
    const { connect, getPwaState } = await load()
    await connect(fakeContainer({ controlled: true, register: () => Promise.reject(new TypeError('Failed to fetch')) }), () => {})
    expect(getPwaState().offlineReady).toBe(true)
  })

  it('`ready` con un service worker activo también lo marca, aunque `register()` no responda', async () => {
    const { connect, getPwaState } = await load()
    const ready = Promise.resolve({ active: {} })
    void connect(fakeContainer({ controlled: false, register: () => new Promise(() => {}), ready }), () => {})
    await ready
    await Promise.resolve()
    expect(getPwaState().offlineReady).toBe(true)
  })

  it('sin service worker activo ni control no promete uso sin conexión', async () => {
    const { connect, getPwaState } = await load()
    await connect(fakeContainer({ controlled: false, register: () => Promise.reject(new Error('no')) }), () => {})
    expect(getPwaState().offlineReady).toBe(false)
  })

  it('dentro de la app de iPhone (puente nativo) ya abre sin conexión, sin service worker', async () => {
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true } })
    try {
      const { getPwaState } = await load()
      expect(getPwaState().offlineReady).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
    // De vuelta en el navegador, sin puente: no se promete nada.
    expect((await load()).getPwaState().offlineReady).toBe(false)
  })
})
