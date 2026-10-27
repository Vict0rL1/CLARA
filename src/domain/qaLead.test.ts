/**
 * Pasada del responsable de implementación (2026-10-27): casos de aceptación adicionales sobre los hallazgos ya corregidos.
 * - QA-01 histórico con la copia v13 GENUINA escrita por la implementación anterior (819eaa9; `src/test/v13-known-intent-backup.json`,
 *   generada con `docs/qa/implementation-lead-2026-10-27/evidence/v13KnownIntent.gen.test.ts.txt`): saldo CAD 1 800 el 15-feb-2026,
 *   sueldo mensual de 2 400 fijado el 31-ene, seguro de 1 250 el 29-mar, importe del sueldo cambiado en 777 unidades menores
 *   aceptando el 28-feb propuesto. Se evalúa el 21-mar.
 * - F-02 variante B con una partición SIN dependientes al principio que recibe un escenario después.
 * - F-03 con gasto anterior 0 (nunca se divide entre cero).
 * Datos sintéticos; fechas explícitas.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { analysisItems } from './analysis'
import { computeBudget } from './budget'
import { recordHistory } from './history'
import { canRevert, revertDependents, revertEntry } from './historyRevert'
import { MAX_AMOUNT_MINOR } from './money'
import { type ScheduleDraft } from './operations'
import { saveScheduleFrom } from './scheduleFrom'
import { dismissSplitRepair, driftedSplits, repairSplit } from './splitRepair'
import type { AppData, Schedule } from './types'
import { backupText, parseBackup, validateAppData } from '../storage/backup'
import { account, baseData, bill, income, NOW, tx } from '../test/fixtures'

const persisted = (d: AppData): AppData => JSON.parse(JSON.stringify(d)) as AppData
const at = (today: string) => ({ today, now: `${today}T12:00:00.000Z` })
const V13 = readFileSync(new URL('../test/v13-known-intent-backup.json', import.meta.url), 'utf8')
const figures = (d: AppData, today: string) => {
  const b = computeBudget(d, today)
  return [b.horizon?.endDate ?? null, b.reservedTotalMinor, b.availableMinor] as const
}

describe('QA-01 histórico · copia v13 genuina de intención conocida (escrita por 819eaa9), evaluada el 21-mar-2026', () => {
  const imported = () => {
    const r = parseBackup(V13)
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    return r.data
  }
  it('la copia es esquema 13 tal cual la escribió la versión anterior y migra a 14 sin perder ningún registro', () => {
    const raw = JSON.parse(V13) as { data: { schemaVersion: number; schedules: { id: string }[]; accounts: unknown[]; history: unknown[]; transactions: unknown[] } }
    expect(raw.data.schemaVersion).toBe(13)
    const d = imported()
    expect(d.schemaVersion).toBe(14)
    expect([d.accounts.length, d.schedules.length, d.history.length, d.transactions.length]).toEqual([raw.data.accounts.length, raw.data.schedules.length, raw.data.history.length, raw.data.transactions.length])
    expect(d.schedules.map((s) => s.id)).toEqual(raw.data.schedules.map((s) => s.id))
    expect(d.schedules.map((s) => [s.id, s.startDate, s.endDate ?? null, s.anchorDate ?? null, s.amountMinor])).toEqual([
      ['salary', '2026-01-31', '2026-02-27', null, 240000],
      ['bill', '2026-03-29', null, null, 125000],
      ['salary-2', '2026-02-28', null, null, 240777],
    ])
    expect(validateAppData(persisted(d)).ok).toBe(true)
  })

  it('resultado histórico persistente tras importar (solo actualizar no repara): próximo ingreso 28-mar, 0 reservados, 180 000 disponibles', () => {
    expect(figures(imported(), '2026-03-21')).toEqual(['2026-03-28', 0, 180000])
  })

  it('la revisión lo detecta y propone las fechas de siempre (31-mar, 30-abr, 31-may) frente a las actuales (28-mar, 28-abr, 28-may)', () => {
    expect(driftedSplits(imported(), '2026-03-21')).toEqual([
      { scheduleId: 'salary-2', endedId: 'salary', name: 'Sueldo', anchor: '2026-01-31', startDate: '2026-02-28', current: ['2026-03-28', '2026-04-28', '2026-05-28'], proposed: ['2026-03-31', '2026-04-30', '2026-05-31'] },
    ])
  })

  it('elegir el 31 de siempre: próximo ingreso 31-mar, 125 000 reservados, 55 000 disponibles, también tras recargar y tras exportar e importar', () => {
    const d = imported()
    const r = repairSplit(d, 'salary-2', at('2026-03-21'))
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.value.anchorDate).toBe('2026-01-31')
    expect(r.value.amountMinor).toBe(240777)
    const saved = persisted(recordHistory(d, r.data, '2026-03-21T12:00:00.000Z'))
    expect(validateAppData(saved).ok).toBe(true)
    expect(figures(saved, '2026-03-21')).toEqual(['2026-03-31', 125000, 55000])
    const again = parseBackup(backupText(saved, new Date('2026-03-21T12:00:00.000Z'), 'test'))
    if (!again.ok) throw new Error(JSON.stringify(again.issues))
    expect(figures(again.data, '2026-03-21')).toEqual(['2026-03-31', 125000, 55000])
    expect(again.data.history.length).toBe(2)
  })

  it('declinar conserva el 28 elegido: nada cambia en las fechas y la revisión no vuelve a proponerse', () => {
    const d = imported()
    const r = dismissSplitRepair(d, 'salary-2', at('2026-03-21'))
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.data.schedules).toEqual(d.schedules)
    expect(figures(persisted(r.data), '2026-03-21')).toEqual(['2026-03-28', 0, 180000])
    expect(driftedSplits(r.data, '2026-03-21')).toEqual([])
  })

  it('una partición nueva por importe con la versión actual conserva el 31 sin ninguna revisión', () => {
    const base = baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 180000, date: '2026-02-15', setAt: '2026-02-15T12:00:00.000Z' } })],
      schedules: [income('2026-01-31', 240000, { id: 'salary', name: 'Sueldo', frequency: 'monthly' }), bill('2026-03-29', 125000, { id: 'bill', name: 'Seguro', frequency: 'once' })],
    })
    const { createdAt: _c, updatedAt: _u, currency: _cur, skippedDates: _k, ...rest } = base.schedules[0]! as Schedule
    const draft: ScheduleDraft = { ...rest, id: 'salary-2', startDate: '2026-02-28', amountMinor: 240777 }
    const r = saveScheduleFrom(base, 'salary', draft, at('2026-02-15'))
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.value.next.anchorDate).toBe('2026-01-31')
    expect(figures(r.data, '2026-03-21')).toEqual(['2026-03-31', 125000, 55000])
    expect(driftedSplits(r.data, '2026-03-21')).toEqual([])
  })
})

describe('F-02 variante B · una partición sin dependientes recibe un escenario DESPUÉS: revertir se rechaza sin tocar nada', () => {
  it('el escenario creado después apunta a la serie nueva: canRevert = dependents, revertEntry lo rechaza y los datos serializados no cambian', () => {
    const rent = bill('2026-06-01', 65000, { id: 'old', name: 'Renta', frequency: 'monthly', categoryId: 'housing' })
    const d = baseData({ schedules: [rent] })
    const { createdAt: _c, updatedAt: _u, currency: _cur, skippedDates: _k, ...rest } = rent
    const r = saveScheduleFrom(d, 'old', { ...rest, id: 'next', startDate: '2026-10-01', amountMinor: 70000 }, at('2026-09-28'))
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    const tracked = recordHistory(d, r.data, NOW)
    const entry = tracked.history.at(-1)!
    expect(canRevert(tracked, entry, '2026-09-28')).toBe('ok')
    const withScenario = recordHistory(tracked, { ...tracked, scenarios: [{ id: 'sc', name: 'Si sube', changes: [{ type: 'scheduleAmount', scheduleId: 'next', newAmountMinor: 72000 }], baseFingerprint: 'x', createdAt: NOW, updatedAt: NOW }] }, NOW)
    const stored = persisted(withScenario)
    const before = JSON.stringify(stored)
    expect(canRevert(stored, entry, '2026-09-28')).toBe('dependents')
    expect(revertDependents(stored, entry, '2026-09-28')).toEqual([{ kind: 'scenario', id: 'sc', name: 'Si sube', scheduleId: 'next' }])
    expect(revertEntry(stored, entry.id, at('2026-09-28'))).toEqual({ ok: false, issues: [{ path: 'history', code: 'revertDependents', params: { count: 1 } }] })
    expect(JSON.stringify(stored)).toBe(before)
    // Quitar el escenario (o moverlo) vuelve a permitir revertir, y entonces nada queda colgado.
    const removed = recordHistory(stored, { ...stored, scenarios: [] }, NOW)
    expect(canRevert(removed, entry, '2026-09-28')).toBe('ok')
    const back = revertEntry(removed, entry.id, at('2026-09-28'))
    expect(back.ok && back.data.schedules.map((s) => s.id)).toEqual(['old'])
    expect(back.ok && validateAppData(persisted(back.data)).ok).toBe(true)
  })
})

describe('F-03 · gasto anterior 0: nunca se divide entre cero y no hay señal de subida/bajada', () => {
  it('sin gasto el mes anterior y con gasto este mes no hay porcentaje (la base es 0) ni excepción', () => {
    const d = baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 0, date: '2026-07-01', setAt: '2026-07-01T12:00:00.000Z' } })],
      transactions: [tx({ id: 'c0', date: '2026-09-10', amountMinor: MAX_AMOUNT_MINOR, kind: 'expense', status: 'realized' })],
    })
    const items = analysisItems(d, '2026-09-28')
    expect(items.some((i) => i.id === 'spendingUp' || i.id === 'spendingDown')).toBe(false)
  })
})
