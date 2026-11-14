import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../domain/types'
import { baseData, NOW, tx } from '../test/fixtures'
import { backupText, parseBackup, validateAppData } from './backup'
import { migrate } from './migrations'

const yen = () => tx({ id: 'yen-1', amountMinor: 1104, original: { currency: 'JPY', amountMinor: 1200, rate: '0.0092', rateDate: '2026-09-28', rateSource: 'manual' } })

describe('esquema 16: importe en otra moneda (Fase 3)', () => {
  it('la migración 15 → 16 solo sube el número: lo nuevo es opcional', () => {
    const v15 = { ...JSON.parse(JSON.stringify(baseData({ transactions: [tx({ id: 'cad-1' })] }))), schemaVersion: 15 }
    const migrated = migrate(v15)
    expect(migrated).toEqual({ ...v15, schemaVersion: SCHEMA_VERSION })
    expect(SCHEMA_VERSION).toBe(16)
    expect(validateAppData(migrated).ok).toBe(true)
  })

  it('una copia con un movimiento en yenes se exporta y se restaura igual, campo por campo', () => {
    const data = baseData({ transactions: [yen()] })
    const back = parseBackup(backupText(data, new Date(NOW), 'test'))
    expect(back.ok && back.data.transactions[0]!.original).toEqual(yen().original)
  })

  it('una tasa que no cuadra con la cifra en CAD hace la copia no válida y dice dónde', () => {
    const bad = JSON.parse(JSON.stringify(baseData({ transactions: [yen()] }))) as Record<string, any>
    bad.transactions[0].amountMinor = 1105
    const r = validateAppData(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.map((i) => i.path)).toContain('transactions[0].original.rate')
  })

  it('las claves desconocidas dentro de «original» se quitan al cargar', () => {
    const extra = JSON.parse(JSON.stringify(baseData({ transactions: [yen()] }))) as Record<string, any>
    extra.transactions[0].original.secret = 'x'
    const r = validateAppData(extra)
    expect(r.ok && r.data.transactions[0]!.original).toEqual(yen().original)
  })
})
