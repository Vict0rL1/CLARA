import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../domain/types'
import { account, baseData, tx } from '../test/fixtures'
import { NATIVE_DATA, NATIVE_MIGRATION, NativeMigrationMismatch, NativeRepository, NativeStoreError, nativePreMigrationName, type LegacySource, type NativeTextStore } from './nativeRepository'
import type { LoadResult } from './repository'

/** Almacén nativo en memoria con el mismo contrato que el plugin `ClaraStorage` (revisión junto al texto, escritura con comparación). */
class FakeStore implements NativeTextStore {
  files = new Map<string, { text: string; revision: number }>()
  writes: string[] = []
  failNext: NativeStoreError | null = null
  /** Simula un disco que devuelve otra cosa al releer. */
  corruptReads = false

  async read(name: string) {
    const f = this.files.get(name)
    if (!f) return null
    return this.corruptReads ? { text: `${f.text} `, revision: f.revision } : { ...f }
  }
  async write(name: string, text: string, revision: number, expectedRevision: number | null) {
    if (this.failNext) {
      const e = this.failNext
      this.failNext = null
      throw e
    }
    const current = this.files.get(name)?.revision ?? null
    if (current !== expectedRevision) throw new NativeStoreError('conflict')
    this.files.set(name, { text, revision })
    this.writes.push(name)
  }
  async remove(name: string) {
    this.files.delete(name)
  }
}

const sample = () =>
  baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 150000, date: '2026-11-01', setAt: '2026-11-01T12:00:00.000Z' } })],
    transactions: [tx({ id: 'cafe', date: '2026-11-10', amountMinor: 450, kind: 'expense', status: 'realized', categoryId: 'dining' })],
  })

const legacyOf = (result: LoadResult): { source: LegacySource; cleared: () => number; loads: () => number } => {
  let cleared = 0
  let loads = 0
  return {
    source: {
      load: async () => {
        loads++
        return result
      },
      clear: async () => {
        cleared++
      },
    },
    cleared: () => cleared,
    loads: () => loads,
  }
}

describe('NativeRepository · datos en un archivo propio de la app', () => {
  it('sin archivo y sin nada que migrar está vacío; guardar y volver a leer devuelve lo mismo', async () => {
    const store = new FakeStore()
    const repo = new NativeRepository(store)
    expect(repo.backend).toBe('native')
    expect(await repo.load()).toEqual({ status: 'empty' })
    const data = sample()
    expect(await repo.save(data)).toEqual({ ok: true })
    expect(store.files.get(NATIVE_DATA)).toEqual({ text: JSON.stringify(data), revision: 1 })
    const again = await new NativeRepository(store).load()
    expect(again).toEqual({ status: 'ok', data })
  })

  it('cada guardado sube la revisión del archivo y escribe con la que leyó', async () => {
    const store = new FakeStore()
    const repo = new NativeRepository(store)
    await repo.load()
    await repo.save(sample())
    await repo.save({ ...sample(), revision: 7 })
    expect(store.files.get(NATIVE_DATA)!.revision).toBe(2)
  })

  it('no sobrescribe lo que otra sesión guardó después de leer: conflict, y el archivo queda como estaba', async () => {
    const store = new FakeStore()
    const a = new NativeRepository(store)
    const b = new NativeRepository(store)
    await a.load()
    await a.save(sample())
    await b.load()
    const fromB = { ...sample(), revision: 2 }
    expect(await b.save(fromB)).toEqual({ ok: true })
    // `a` leyó la revisión 1 y el archivo ya va por la 2.
    expect(await a.save({ ...sample(), revision: 99 })).toEqual({ ok: false, error: 'conflict' })
    expect(store.files.get(NATIVE_DATA)).toEqual({ text: JSON.stringify(fromB), revision: 2 })
  })

  it('traduce los fallos del almacén: sin espacio → quota, sin acceso → unavailable, lo demás → unknown; nunca «guardado»', async () => {
    const store = new FakeStore()
    const repo = new NativeRepository(store)
    await repo.load()
    store.failNext = new NativeStoreError('noSpace')
    expect(await repo.save(sample())).toEqual({ ok: false, error: 'quota' })
    store.failNext = new NativeStoreError('unavailable')
    expect(await repo.save(sample())).toEqual({ ok: false, error: 'unavailable' })
    store.failNext = new NativeStoreError('unknown')
    expect(await repo.save(sample())).toEqual({ ok: false, error: 'unknown' })
    expect(store.files.has(NATIVE_DATA)).toBe(false)
    // Tras un fallo, el siguiente intento sigue valiendo (la revisión esperada no se movió).
    expect(await repo.save(sample())).toEqual({ ok: true })
  })

  it('guardar sin haber leído no escribe nada', async () => {
    const store = new FakeStore()
    expect(await new NativeRepository(store).save(sample())).toEqual({ ok: false, error: 'unavailable' })
    expect(store.writes).toEqual([])
  })

  it('un archivo que no es JSON o no valida se enseña como dañado, tal cual, y no se toca', async () => {
    const store = new FakeStore()
    store.files.set(NATIVE_DATA, { text: '{no es json', revision: 4 })
    const bad = await new NativeRepository(store).load()
    expect(bad).toMatchObject({ status: 'corrupt', raw: '{no es json', issues: [{ path: 'file', code: 'invalidJson' }] })
    const future = JSON.stringify({ ...sample(), schemaVersion: SCHEMA_VERSION + 1 })
    store.files.set(NATIVE_DATA, { text: future, revision: 5 })
    const result = await new NativeRepository(store).load()
    expect(result.status).toBe('corrupt')
    expect(store.files.get(NATIVE_DATA)).toEqual({ text: future, revision: 5 })
  })

  it('datos de un esquema anterior: se migran al leer y el texto original queda guardado una sola vez', async () => {
    const store = new FakeStore()
    const old = JSON.stringify({ ...sample(), schemaVersion: SCHEMA_VERSION - 1 })
    store.files.set(NATIVE_DATA, { text: old, revision: 3 })
    const result = await new NativeRepository(store).load()
    expect(result.status).toBe('ok')
    const copy = store.files.get(nativePreMigrationName())
    expect(JSON.parse(copy!.text)).toEqual({ fromVersion: SCHEMA_VERSION - 1, raw: old })
    // Otra lectura no la pisa.
    store.files.set(NATIVE_DATA, { text: old.replace('Principal', 'Otra'), revision: 3 })
    await new NativeRepository(store).load()
    expect(store.files.get(nativePreMigrationName())).toEqual(copy)
  })

  it('una copia de datos dañados se guarda con un nombre que el almacén acepta', async () => {
    const store = new FakeStore()
    const repo = new NativeRepository(store)
    repo.preserveCorrupt('{roto', new Date('2026-11-12T08:09:10.123Z'))
    await Promise.resolve()
    expect([...store.files.keys()]).toEqual(['corrupt-20261112080910123'])
    expect([...store.files.keys()].every((k) => /^[a-z0-9-]{1,40}$/.test(k))).toBe(true)
  })
})

describe('NativeRepository · primer arranque: lo que hubiera en el WebView', () => {
  it('copia los datos del WebView, los relee, los compara y deja la marca; el origen no se borra', async () => {
    const store = new FakeStore()
    const data = sample()
    const legacy = legacyOf({ status: 'ok', data })
    const repo = new NativeRepository(store, { legacy: async () => legacy.source, now: () => new Date('2026-11-12T10:00:00.000Z') })
    expect(await repo.load()).toEqual({ status: 'ok', data })
    expect(store.files.get(NATIVE_DATA)).toEqual({ text: JSON.stringify(data), revision: 1 })
    expect(JSON.parse(store.files.get(NATIVE_MIGRATION)!.text)).toEqual({ from: 'webview', status: 'done', at: '2026-11-12T10:00:00.000Z', size: JSON.stringify(data).length })
    expect(legacy.cleared()).toBe(0)
    // Y se puede seguir guardando encima (la revisión leída es la del archivo recién escrito).
    expect(await repo.save({ ...data, revision: data.revision + 1 })).toEqual({ ok: true })
    expect(store.files.get(NATIVE_DATA)!.revision).toBe(2)
  })

  it('con datos nativos ya guardados nunca vuelve a mirar el WebView', async () => {
    const store = new FakeStore()
    const data = sample()
    store.files.set(NATIVE_DATA, { text: JSON.stringify(data), revision: 9 })
    const legacy = legacyOf({ status: 'ok', data: { ...data, budgetId: 'otro' } })
    expect(await new NativeRepository(store, { legacy: async () => legacy.source }).load()).toEqual({ status: 'ok', data })
    expect(legacy.loads()).toBe(0)
  })

  it('si al releer no es idéntico, no sigue: quita el archivo nuevo, no deja marca y el origen queda intacto', async () => {
    const store = new FakeStore()
    store.corruptReads = true
    const legacy = legacyOf({ status: 'ok', data: sample() })
    await expect(new NativeRepository(store, { legacy: async () => legacy.source }).load()).rejects.toBeInstanceOf(NativeMigrationMismatch)
    expect(store.files.has(NATIVE_DATA)).toBe(false)
    expect(store.files.has(NATIVE_MIGRATION)).toBe(false)
    expect(legacy.cleared()).toBe(0)
  })

  it('una migración cortada antes de la marca se repite entera en el siguiente arranque', async () => {
    const store = new FakeStore()
    const data = sample()
    const legacy = legacyOf({ status: 'ok', data })
    // Primer intento: el archivo de datos no llega a escribirse.
    store.failNext = new NativeStoreError('unknown')
    await expect(new NativeRepository(store, { legacy: async () => legacy.source }).load()).rejects.toBeInstanceOf(NativeStoreError)
    expect(store.files.size).toBe(0)
    expect(await new NativeRepository(store, { legacy: async () => legacy.source }).load()).toEqual({ status: 'ok', data })
    expect(store.files.has(NATIVE_MIGRATION)).toBe(true)
  })

  it('datos dañados en el WebView se enseñan tal cual y no se copian', async () => {
    const store = new FakeStore()
    const corrupt: LoadResult = { status: 'corrupt', raw: '{roto', issues: [{ path: 'file', code: 'invalidJson' }] }
    const legacy = legacyOf(corrupt)
    expect(await new NativeRepository(store, { legacy: async () => legacy.source }).load()).toEqual(corrupt)
    expect(store.files.size).toBe(0)
  })

  it('WebView vacío o ilegible: se empieza vacío y sin marca (se volverá a mirar)', async () => {
    const store = new FakeStore()
    expect(await new NativeRepository(store, { legacy: async () => legacyOf({ status: 'empty' }).source }).load()).toEqual({ status: 'empty' })
    expect(
      await new NativeRepository(store, {
        legacy: async () => {
          throw new Error('IndexedDB no abre')
        },
      }).load(),
    ).toEqual({ status: 'empty' })
    expect(await new NativeRepository(store, { legacy: async () => null }).load()).toEqual({ status: 'empty' })
    expect(store.files.size).toBe(0)
  })

  it('«Borrar todos los datos» quita el archivo, borra también el resto del WebView y deja la marca: nada vuelve solo', async () => {
    const store = new FakeStore()
    const data = sample()
    const legacy = legacyOf({ status: 'ok', data })
    const repo = new NativeRepository(store, { legacy: async () => legacy.source, now: () => new Date('2026-11-12T10:00:00.000Z') })
    await repo.load()
    await repo.clear()
    expect(store.files.has(NATIVE_DATA)).toBe(false)
    expect(legacy.cleared()).toBe(1)
    expect(JSON.parse(store.files.get(NATIVE_MIGRATION)!.text)).toMatchObject({ status: 'cleared' })
    // Aunque el WebView siguiera teniendo los datos (el borrado de allí falló), el siguiente arranque está vacío.
    const next = new NativeRepository(store, { legacy: async () => legacy.source })
    expect(await next.load()).toEqual({ status: 'empty' })
    expect(legacy.loads()).toBe(1)
    // Y se puede volver a empezar.
    expect(await next.save(data)).toEqual({ ok: true })
  })

  it('borrar todo sin migración previa también deja la marca', async () => {
    const store = new FakeStore()
    const repo = new NativeRepository(store)
    await repo.load()
    await repo.save(sample())
    await repo.clear()
    expect(JSON.parse(store.files.get(NATIVE_MIGRATION)!.text).status).toBe('cleared')
    expect(await repo.save(sample())).toEqual({ ok: true })
    expect(store.files.get(NATIVE_DATA)!.revision).toBe(1)
  })
})
