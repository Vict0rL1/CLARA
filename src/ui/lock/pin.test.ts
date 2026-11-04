import { describe, expect, it } from 'vitest'
import { createLockConfig, isValidPin, readLockConfig, shouldRelock, verifyPin, writeLockConfig } from './pin'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  clear() {
    this.map.clear()
  }
  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
  setItem(k: string, v: string) {
    this.map.set(k, v)
  }
}

describe('bloqueo con PIN', () => {
  it('el PIN se guarda como hash con sal, se verifica y nunca aparece en claro', async () => {
    const config = await createLockConfig('2468')
    expect(config.pinHash).toMatch(/^[0-9a-f]{64}$/)
    expect(config.salt).toMatch(/^[0-9a-f]{32}$/)
    // «Nunca en claro»: solo hash y sal, ambos hexadecimales de longitud fija; ningún otro campo puede
    // llevar el PIN. Antes se buscaba «2468» dentro del JSON, y una sal aleatoria lo contenía por azar
    // (≈ 1 de cada 700 ejecuciones; falló así en la CI).
    expect(Object.keys(config).sort()).toEqual(['pinHash', 'salt'])
    expect(Object.values(config)).not.toContain('2468')
    expect(await verifyPin('2468', config)).toBe(true)
    expect(await verifyPin('2469', config)).toBe(false)
    expect(await verifyPin('abc', config)).toBe(false)
    const other = await createLockConfig('2468')
    expect(other.pinHash).not.toBe(config.pinHash) // sal distinta
  })

  it('una sal que por azar contiene los dígitos del PIN no es un PIN en claro (caso de la CI)', async () => {
    // Sal fija que empieza por «2468»: la comprobación anterior (buscar el PIN en el JSON) fallaba aquí.
    const fixed = { getRandomValues: <T extends ArrayBufferView | null>(a: T) => { const b = a as unknown as Uint8Array; b.set([0x24, 0x68]); return a }, subtle: globalThis.crypto.subtle } as unknown as Crypto
    const config = await createLockConfig('2468', fixed)
    expect(config.salt.startsWith('2468')).toBe(true)
    expect(Object.keys(config).sort()).toEqual(['pinHash', 'salt'])
    expect(Object.values(config)).not.toContain('2468')
    expect(await verifyPin('2468', config, fixed)).toBe(true)
  })

  it('valida la longitud, persiste en el almacenamiento del dispositivo y decide cuándo volver a bloquear', async () => {
    expect(isValidPin('123')).toBe(false)
    expect(isValidPin('1234')).toBe(true)
    expect(isValidPin('123456789')).toBe(false)
    const storage = new MemoryStorage()
    const config = await createLockConfig('1234')
    expect(writeLockConfig(config, storage)).toBe(true)
    expect(readLockConfig(storage)).toEqual(config)
    storage.setItem('clara.lock.v1', '{bad')
    expect(readLockConfig(storage)).toBeNull()
    expect(writeLockConfig(null, storage)).toBe(true)
    expect(readLockConfig(storage)).toBeNull()
    expect(shouldRelock(null, 100_000)).toBe(false)
    expect(shouldRelock(0, 59_999)).toBe(false)
    expect(shouldRelock(0, 60_000)).toBe(true)
  })
})
