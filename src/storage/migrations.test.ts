import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../domain/types'
import { MIGRATIONS, migrate } from './migrations'
import { baseData } from '../test/fixtures'

describe('migración v10 → v11 (cuentas: archivada y orden)', () => {
  it('rellena solo lo ausente y respeta lo que ya existe', () => {
    const v10 = JSON.parse(JSON.stringify({ ...baseData(), schemaVersion: 10 })) as Record<string, unknown>
    const accounts = v10.accounts as Record<string, unknown>[]
    accounts.push({ ...accounts[0], id: 'arch', archived: true }, { ...accounts[0], id: 'ord', order: 7 })
    const out = MIGRATIONS[10]!(v10)
    expect(out.schemaVersion).toBe(11)
    expect((out.accounts as Record<string, unknown>[]).map((a) => [a.id, a.archived, a.order])).toEqual([
      ['main', false, 0],
      ['arch', true, 1],
      ['ord', false, 7],
    ])
    // Nada más cambia.
    const { accounts: _a, schemaVersion: _v, ...rest } = out
    const { accounts: _b, schemaVersion: _w, ...restIn } = v10
    expect(rest).toEqual(restIn)
  })

  it('una entrada mal formada se conserva tal cual (la validación la señala; nunca se borra)', () => {
    const out = MIGRATIONS[10]!({ schemaVersion: 10, accounts: [null, 'x', { id: 'ok' }] })
    expect(out.accounts).toEqual([null, 'x', { id: 'ok', archived: false, order: 2 }])
    expect(MIGRATIONS[10]!({ schemaVersion: 10, accounts: 'no' })).toEqual({ schemaVersion: 11, accounts: 'no' })
  })

  it('`migrate` encadena hasta la versión actual', () => {
    const out = migrate({ ...JSON.parse(JSON.stringify(baseData())), schemaVersion: 10 })
    expect(out.schemaVersion).toBe(SCHEMA_VERSION)
    expect((out.accounts as Record<string, unknown>[])[0]).toMatchObject({ archived: false, order: 0 })
  })
})
