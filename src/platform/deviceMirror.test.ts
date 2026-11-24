import { describe, expect, it } from 'vitest'
import { FakeStore } from '../test/fakeNativeStore'
import { DEVICE_KEY } from '../ui/install'
import { LOCK_KEY } from '../ui/lock/pin'
import { PREFS_KEY } from '../ui/preferences'
import { THEME_KEY } from '../ui/theme'
import { DEVICE_KEYS, NATIVE_DEVICE, restoreDeviceKeys, startDeviceMirror } from './deviceMirror'

class MemoryStorage {
  map = new Map<string, string>()
  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.map.set(k, v)
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
}

const target = () => Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
const LOCK = 'clara.lock.v1'
const PREFS = 'clara.ui.v1'

describe('ajustes de este dispositivo fuera del WebView (deviceMirror)', () => {
  it('copia las claves del dispositivo (y solo esas) al archivo de la app, y solo si cambiaron', async () => {
    const store = new FakeStore()
    const storage = new MemoryStorage()
    storage.setItem(LOCK, '{"pin":"x"}')
    storage.setItem(PREFS, '{"density":"compact"}')
    storage.setItem('clara.errors.v1', '[1]')
    const mirror = startDeviceMirror(store, storage, target())
    expect(await mirror.save()).toBe(true)
    expect(JSON.parse(store.files.get(NATIVE_DEVICE)!.text)).toEqual({ [LOCK]: '{"pin":"x"}', [PREFS]: '{"density":"compact"}' })
    expect(await mirror.save()).toBe(true)
    expect(store.writes).toEqual([NATIVE_DEVICE])
    // Quitar el PIN también se copia: no puede volver tras un vaciado.
    storage.removeItem(LOCK)
    await mirror.save()
    expect(JSON.parse(store.files.get(NATIVE_DEVICE)!.text)).toEqual({ [PREFS]: '{"density":"compact"}' })
    expect(store.files.get(NATIVE_DEVICE)!.revision).toBe(2)
  })

  it('si iOS vació el WebView, lo que falta vuelve al abrir; lo que ya está nunca se pisa', async () => {
    const store = new FakeStore()
    store.files.set(NATIVE_DEVICE, { text: JSON.stringify({ [LOCK]: '{"pin":"x"}', [PREFS]: 'viejo', 'clara.otra': 'no', 'clara.theme': 7 }), revision: 4 })
    const storage = new MemoryStorage()
    storage.setItem(PREFS, 'nuevo')
    expect(await restoreDeviceKeys(store, storage)).toEqual([LOCK])
    expect(storage.getItem(LOCK)).toBe('{"pin":"x"}')
    expect(storage.getItem(PREFS)).toBe('nuevo')
    expect(storage.getItem('clara.otra')).toBeNull()
    expect(storage.getItem('clara.theme')).toBeNull()
  })

  it('un archivo que falta, ilegible o sin acceso no restaura nada ni rompe el arranque', async () => {
    const storage = new MemoryStorage()
    expect(await restoreDeviceKeys(new FakeStore(), storage)).toEqual([])
    const broken = new FakeStore()
    broken.files.set(NATIVE_DEVICE, { text: '{no', revision: 1 })
    expect(await restoreDeviceKeys(broken, storage)).toEqual([])
    const failing = new FakeStore()
    failing.read = async () => Promise.reject(new Error('sin acceso'))
    expect(await restoreDeviceKeys(failing, storage)).toEqual([])
    expect(storage.map.size).toBe(0)
  })

  it('al ir a segundo plano («pause» o pestaña oculta) se copia; tras parar, ya no', async () => {
    const store = new FakeStore()
    const storage = new MemoryStorage()
    const t = target()
    const mirror = startDeviceMirror(store, storage, t)
    const flush = () => new Promise((r) => setTimeout(r, 0))
    storage.setItem(PREFS, 'a')
    t.dispatchEvent(new Event('pause'))
    await flush()
    expect(JSON.parse(store.files.get(NATIVE_DEVICE)!.text)).toEqual({ [PREFS]: 'a' })
    storage.setItem(PREFS, 'b')
    t.visibilityState = 'hidden'
    t.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(JSON.parse(store.files.get(NATIVE_DEVICE)!.text)).toEqual({ [PREFS]: 'b' })
    mirror.stop()
    storage.setItem(PREFS, 'c')
    t.dispatchEvent(new Event('pause'))
    await flush()
    expect(JSON.parse(store.files.get(NATIVE_DEVICE)!.text)).toEqual({ [PREFS]: 'b' })
  })

  it('si iOS vació el WebView con la app suspendida, al volver se restaura antes de copiar: el vacío no pisa la copia', async () => {
    const store = new FakeStore()
    const storage = new MemoryStorage()
    const t = target()
    startDeviceMirror(store, storage, t)
    const flush = () => new Promise((r) => setTimeout(r, 0))
    storage.setItem(LOCK, '{"pin":"x"}')
    t.dispatchEvent(new Event('pause'))
    await flush()
    storage.map.clear()
    t.dispatchEvent(new Event('resume'))
    t.visibilityState = 'hidden'
    t.dispatchEvent(new Event('visibilitychange'))
    await flush()
    await flush()
    expect(storage.getItem(LOCK)).toBe('{"pin":"x"}')
    expect(JSON.parse(store.files.get(NATIVE_DEVICE)!.text)).toEqual({ [LOCK]: '{"pin":"x"}' })
  })

  it('si alguien más escribió el archivo, no se rinde: relee la revisión y lo intenta la vez siguiente', async () => {
    const store = new FakeStore()
    const storage = new MemoryStorage()
    const mirror = startDeviceMirror(store, storage, target())
    storage.setItem(PREFS, 'a')
    await mirror.save()
    store.files.set(NATIVE_DEVICE, { text: '{}', revision: 9 })
    storage.setItem(PREFS, 'b')
    expect(await mirror.save()).toBe(false)
    expect(await mirror.save()).toBe(true)
    expect(store.files.get(NATIVE_DEVICE)).toEqual({ text: JSON.stringify({ [PREFS]: 'b' }), revision: 10 })
  })

  it('las claves copiadas son las que usa el código (si una cambia de nombre, esta prueba falla)', () => {
    for (const key of [LOCK_KEY, PREFS_KEY, THEME_KEY, DEVICE_KEY]) expect(DEVICE_KEYS).toContain(key)
    expect(DEVICE_KEYS).not.toContain('clara.errors.v1')
  })
})
