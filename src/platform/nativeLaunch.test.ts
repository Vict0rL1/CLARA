import { describe, expect, it, vi } from 'vitest'
import { followLaunchRequests, launchPath, type ClaraLaunchPlugin } from './nativeLaunch'

/** Un doble del plugin con el mismo contrato que `ClaraLaunchPlugin.swift`: `take()` entrega la pantalla una vez. */
function fakePlugin(initial?: string) {
  let pending: unknown = initial
  let listener: (() => void) | null = null
  const removed = vi.fn(async () => {})
  const plugin: ClaraLaunchPlugin = {
    take: async () => {
      const screen = pending
      pending = undefined
      return screen === undefined ? {} : { screen }
    },
    addListener: async (_event, l) => {
      listener = l
      return { remove: removed }
    },
  }
  return {
    plugin,
    removed,
    /** Lo que hace el Swift al ejecutarse la acción con la app abierta. */
    request(screen: unknown) {
      pending = screen
      listener?.()
    },
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('launchPath', () => {
  it('solo las pantallas que existen tienen ruta', () => {
    expect(launchPath('newExpense')).toBe('/movimientos/nuevo')
    expect(launchPath('review')).toBeNull()
    expect(launchPath('toString')).toBeNull()
    expect(launchPath(undefined)).toBeNull()
    expect(launchPath(3)).toBeNull()
  })
})

describe('followLaunchRequests', () => {
  it('al arrancar abre la pantalla que se pidió antes de que la web cargara, una sola vez', async () => {
    const fake = fakePlugin('newExpense')
    const open = vi.fn()
    followLaunchRequests(fake.plugin, open)
    await flush()
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('/movimientos/nuevo')
    fake.request(undefined)
    await flush()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('con la app abierta, cada petición abre su pantalla; un nombre desconocido no abre nada', async () => {
    const fake = fakePlugin()
    const open = vi.fn()
    followLaunchRequests(fake.plugin, open)
    await flush()
    expect(open).not.toHaveBeenCalled()
    fake.request('newExpense')
    await flush()
    fake.request('borrarTodo')
    await flush()
    expect(open.mock.calls).toEqual([['/movimientos/nuevo']])
  })

  it('dejar de escuchar quita el oyente y no abre nada más', async () => {
    const fake = fakePlugin()
    const open = vi.fn()
    const stop = followLaunchRequests(fake.plugin, open)
    await flush()
    stop()
    fake.request('newExpense')
    await flush()
    expect(open).not.toHaveBeenCalled()
    expect(fake.removed).toHaveBeenCalled()
  })

  it('un plugin que falla no rompe el arranque', async () => {
    const open = vi.fn()
    const broken: ClaraLaunchPlugin = { take: () => Promise.reject(new Error('sin plugin')), addListener: () => Promise.reject(new Error('sin plugin')) }
    expect(() => followLaunchRequests(broken, open)).not.toThrow()
    await flush()
    expect(open).not.toHaveBeenCalled()
  })
})
