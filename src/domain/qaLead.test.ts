/**
 * Pasada del responsable de implementación (2026-10-27): casos de aceptación adicionales sobre los hallazgos ya corregidos.
 * - QA-01 histórico con la copia v13 GENUINA escrita por la implementación anterior (819eaa9; `src/test/v13-known-intent-backup.json`,
 *   generada con `docs/qa/implementation-lead-2026-10-27/evidence/v13KnownIntent.gen.test.ts.txt`): saldo CAD 1 800 el 15-feb-2026,
 *   sueldo mensual de 2 400 fijado el 31-ene, seguro de 1 250 el 29-mar, importe del sueldo cambiado en 777 unidades menores
 *   aceptando el 28-feb propuesto. Se evalúa el 21-mar.
 * - F-02 variante B con una partición SIN dependientes al principio que recibe un escenario después.
 * - F-03 con gasto anterior 0 (nunca se divide entre cero).
 * - Revisión financiera independiente del mismo pase, F-R1 (P1): reparar una partición antigua nunca vuelve a contar lo ya
 *   pagado ni resucita una fecha omitida (lo pagado se queda en su fecha; las fechas de siempre se aplican desde el día
 *   siguiente a la última ocurrencia pagada, llevada a su fecha de siempre; omitidas y vínculos siguen a su periodo).
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
import { occurrencesBetween } from './recurrence'
import { saveScheduleFrom } from './scheduleFrom'
import { dismissSplitRepair, driftedSplits, repairSplit } from './splitRepair'
import type { AppData, Schedule } from './types'
import { backupText, parseBackup, validateAppData } from '../storage/backup'
import { account, baseData, bill, goal, income, NOW, tx } from '../test/fixtures'

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
      { scheduleId: 'salary-2', endedId: 'salary', name: 'Sueldo', anchor: '2026-01-31', startDate: '2026-02-28', from: '2026-02-28', current: ['2026-03-28', '2026-04-28', '2026-05-28'], proposed: ['2026-03-31', '2026-04-30', '2026-05-31'] },
    ])
  })

  it('elegir el 31 de siempre: próximo ingreso 31-mar, 125 000 reservados, 55 000 disponibles, también tras recargar y tras exportar e importar', () => {
    const d = imported()
    const r = repairSplit(d, 'salary-2', at('2026-03-21'), 'salary-3')
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

describe('F-R1 (revisión financiera) · reparar una partición antigua no vuelve a contar lo pagado ni resucita lo omitido', () => {
  const rent = bill('2026-01-31', 150000, { id: 'r1', name: 'Renta', frequency: 'monthly', categoryId: 'housing' })
  const paid = (scheduleId: string, occurrenceDate: string, id: string, date = occurrenceDate) =>
    tx({ id, kind: 'expense', amountMinor: scheduleId === 'r1' ? 150000 : 160000, date, categoryId: 'housing', scheduleId, occurrenceDate })
  /** Renta del 31 partida el 28-feb por una versión anterior (sin `anchorDate`), con los pagos del 28 registrados. */
  const legacyRent = (paidDates: string[], extra: Partial<AppData> = {}, r2: Partial<Schedule> = {}): AppData => {
    const d = baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 1000000, date: '2026-01-01', setAt: '2026-01-01T12:00:00.000Z' } })],
      schedules: [{ ...rent, endDate: '2026-02-27' }, { ...rent, id: 'r2', startDate: '2026-02-28', amountMinor: 160000, ...r2 }],
      transactions: [paid('r1', '2026-01-31', 'p0'), ...paidDates.map((date, i) => paid('r2', date, `p${i + 1}`))],
      ...extra,
    })
    return { ...d, settings: { ...d.settings, fallbackHorizonDays: 30 } }
  }
  const budget = (d: AppData, today: string) => {
    const b = computeBudget(d, today)
    return { spendable: b.spendableMinor, horizon: b.horizon?.endDate ?? null, reserved: b.reservedTotalMinor, available: b.availableMinor, overdue: b.overdueBills.map((i) => i.key) }
  }

  it('pagados el 28-feb, 28-mar y 28-abr; hoy 15-may: lo pagado se queda en su tramo (termina el 30-abr) y uno nuevo cuenta el 31 desde el 1-may; nada vencido, 1 600 reservados una sola vez', () => {
    const d = legacyRent(['2026-02-28', '2026-03-28', '2026-04-28'])
    const TODAY = '2026-05-15'
    // 1 000 000 − 150 000 − 3 × 160 000 = 370 000; a 30 días solo cae el 28-may.
    expect(budget(d, TODAY)).toEqual({ spendable: 370000, horizon: '2026-06-14', reserved: 160000, available: 210000, overdue: [] })
    expect(driftedSplits(d, TODAY)).toEqual([
      { scheduleId: 'r2', endedId: 'r1', name: 'Renta', anchor: '2026-01-31', startDate: '2026-02-28', from: '2026-05-01', current: ['2026-05-28', '2026-06-28', '2026-07-28'], proposed: ['2026-05-31', '2026-06-30', '2026-07-31'] },
    ])
    const r = repairSplit(d, 'r2', at(TODAY), 'r3')
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.value).toMatchObject({ id: 'r3', startDate: '2026-05-01', anchorDate: '2026-01-31', amountMinor: 160000, skippedDates: [] })
    expect(r.value.endDate).toBeUndefined()
    expect(r.data.schedules.find((s) => s.id === 'r2')).toMatchObject({ startDate: '2026-02-28', endDate: '2026-04-30', skippedDates: [] })
    expect(r.data.schedules.find((s) => s.id === 'r2')?.anchorDate).toBeUndefined()
    expect(r.data.schedules.find((s) => s.id === 'r1')).toEqual(d.schedules[0])
    expect(r.data.transactions).toEqual(d.transactions)
    expect(occurrencesBetween(r.value, '2026-05-01', '2026-09-30')).toEqual(['2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30'])
    // Invariante (CLAUDE.md, FORMULAS §5): una ocurrencia pagada cuenta como movimiento O como reserva, nunca ambos.
    expect(budget(r.data, TODAY)).toEqual({ spendable: 370000, horizon: '2026-06-14', reserved: 160000, available: 210000, overdue: [] })
    expect(driftedSplits(r.data, TODAY)).toEqual([])
    expect(repairSplit(r.data, 'r2', at(TODAY), 'r4')).toMatchObject({ ok: false, issues: [{ code: 'notFound' }] })
    // Guardado, validado y reversible como una sola entrada del historial (los dos tramos vuelven a ser uno).
    const stored = persisted(recordHistory(d, r.data, at(TODAY).now))
    expect(validateAppData(stored).ok).toBe(true)
    const entry = stored.history.at(-1)!
    expect(entry.changes.map((c) => [c.collection, c.id]).sort()).toEqual([['schedules', 'r2'], ['schedules', 'r3']])
    expect(canRevert(stored, entry, TODAY)).toBe('ok')
    const back = revertEntry(stored, entry.id, at(TODAY))
    expect(back.ok && back.data.schedules.map((s) => s.id)).toEqual(['r1', 'r2'])
    expect(back.ok && budget(back.data, TODAY)).toEqual(budget(d, TODAY))
  })

  it('un ingreso recibido el 28-mar y el 28-abr no vuelve como «ingreso retrasado» el 31-mar ni el 30-abr; el de mayo se espera el 31', () => {
    const s1 = income('2026-01-31', 300000, { id: 's1', name: 'Sueldo', frequency: 'monthly', endDate: '2026-02-27' })
    const s2 = income('2026-02-28', 320000, { id: 's2', name: 'Sueldo', frequency: 'monthly' })
    const got = (date: string, id: string) => tx({ id, kind: 'income', amountMinor: 320000, date, categoryId: 'salary', scheduleId: 's2', occurrenceDate: date })
    const d = baseData({ accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 500000, date: '2026-01-01', setAt: '2026-01-01T12:00:00.000Z' } })], schedules: [s1, s2], transactions: [got('2026-02-28', 'i1'), got('2026-03-28', 'i2'), got('2026-04-28', 'i3')] })
    const TODAY = '2026-05-15'
    expect(computeBudget(d, TODAY).overdueIncomes.map((i) => i.key)).toEqual(['schedule:s1:2026-01-31'])
    const r = repairSplit(d, 's2', at(TODAY), 's3')
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    const after = computeBudget(r.data, TODAY)
    expect(after.overdueIncomes.map((i) => i.key)).toEqual(['schedule:s1:2026-01-31'])
    expect(after.horizon?.endDate).toBe('2026-05-31')
    expect(r.data.transactions).toEqual(d.transactions)
  })

  it('una fecha omitida sigue omitida en la fecha de siempre de su periodo: el 28-abr omitido pasa a ser el 30-abr omitido (nada vencido) y el 28-jun omitido, el 30-jun', () => {
    const d = legacyRent(['2026-02-28', '2026-03-28'], {}, { skippedDates: ['2026-04-28', '2026-06-28'] })
    const TODAY = '2026-05-15'
    expect(budget(d, TODAY)).toEqual({ spendable: 530000, horizon: '2026-06-14', reserved: 160000, available: 370000, overdue: [] })
    const found = driftedSplits(d, TODAY)
    expect(found.map((f) => [f.from, f.current, f.proposed])).toEqual([['2026-04-01', ['2026-05-28', '2026-07-28', '2026-08-28'], ['2026-05-31', '2026-07-31', '2026-08-31']]])
    const r = repairSplit(d, 'r2', at(TODAY), 'r3')
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.data.schedules.find((s) => s.id === 'r2')).toMatchObject({ endDate: '2026-03-31', skippedDates: [] })
    expect(r.value).toMatchObject({ id: 'r3', startDate: '2026-04-01', anchorDate: '2026-01-31', skippedDates: ['2026-04-30', '2026-06-30'] })
    expect(budget(r.data, TODAY)).toEqual({ spendable: 530000, horizon: '2026-06-14', reserved: 160000, available: 370000, overdue: [] })
    expect(validateAppData(persisted(r.data)).ok).toBe(true)
  })

  it('pagado por adelantado (el 28-abr registrado el 20-abr, hoy 20-abr): abril no vuelve a reservarse el 30-abr', () => {
    const d = legacyRent(['2026-02-28', '2026-03-28'], { transactions: [paid('r1', '2026-01-31', 'p0'), paid('r2', '2026-02-28', 'p1'), paid('r2', '2026-03-28', 'p2'), paid('r2', '2026-04-28', 'p3', '2026-04-20')] })
    const TODAY = '2026-04-20'
    expect(driftedSplits(d, TODAY).map((f) => [f.from, f.current, f.proposed])).toEqual([['2026-05-01', ['2026-05-28', '2026-06-28', '2026-07-28'], ['2026-05-31', '2026-06-30', '2026-07-31']]])
    const r = repairSplit(d, 'r2', at(TODAY), 'r3')
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.data.schedules.find((s) => s.id === 'r2')?.endDate).toBe('2026-04-30')
    expect(occurrencesBetween(r.value, '2026-04-01', '2026-06-30')).toEqual(['2026-05-31', '2026-06-30'])
    expect(budget(r.data, TODAY)).toEqual(budget(d, TODAY))
    expect(budget(r.data, TODAY).overdue).toEqual([])
  })

  it('sin nada pagado en fechas movidas, el tramo entero lleva `anchorDate` (una sola edición): el 28-mar pasado sin cobrar deja de ser «retrasado» y el sueldo se espera el 31-mar', () => {
    const s1 = income('2026-01-31', 300000, { id: 's1', name: 'Sueldo', frequency: 'monthly', endDate: '2026-02-27' })
    const s2 = income('2026-02-28', 320000, { id: 's2', name: 'Sueldo', frequency: 'monthly' })
    const d = baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 180000, date: '2026-03-01', setAt: '2026-03-01T12:00:00.000Z' } })],
      schedules: [s1, s2, bill('2026-03-29', 125000, { id: 'bill', name: 'Seguro', frequency: 'once' })],
      transactions: [
        tx({ id: 'i0', kind: 'income', amountMinor: 300000, date: '2026-01-31', categoryId: 'salary', scheduleId: 's1', occurrenceDate: '2026-01-31' }),
        tx({ id: 'i1', kind: 'income', amountMinor: 320000, date: '2026-02-28', categoryId: 'salary', scheduleId: 's2', occurrenceDate: '2026-02-28' }),
      ],
    })
    const TODAY = '2026-03-29'
    const before = computeBudget(d, TODAY)
    expect([before.overdueIncomes.map((i) => i.key), before.horizon?.endDate]).toEqual([['schedule:s2:2026-03-28'], '2026-04-28'])
    // El 28-feb pagado es también fecha de la serie del 31: no hace falta partir.
    expect(driftedSplits(d, TODAY).map((f) => f.from)).toEqual(['2026-03-01'])
    const r = repairSplit(d, 's2', at(TODAY), 'unused')
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.data.schedules.map((s) => s.id)).toEqual(['s1', 's2', 'bill'])
    expect(r.value).toMatchObject({ id: 's2', startDate: '2026-02-28', anchorDate: '2026-01-31' })
    expect(r.value.endDate).toBeUndefined()
    const after = computeBudget(r.data, TODAY)
    expect([after.overdueIncomes.map((i) => i.key), after.horizon?.endDate, after.reservedTotalMinor, after.availableMinor]).toEqual([[], '2026-03-31', 125000, 55000])
    const stored = persisted(recordHistory(d, r.data, at(TODAY).now))
    expect(stored.history.at(-1)!.changes.map((c) => [c.collection, c.id])).toEqual([['schedules', 's2']])
  })

  it('un cobro parcial también cuenta como pagado: el tramo termina el 31-mar y el nuevo cuenta desde el 1-abr', () => {
    const s1 = income('2026-01-31', 300000, { id: 's1', name: 'Sueldo', frequency: 'monthly', endDate: '2026-02-27' })
    const s2 = income('2026-02-28', 320000, { id: 's2', name: 'Sueldo', frequency: 'monthly', amountIsEstimate: true, range: { minMinor: 100000, extraMinor: 220000 } })
    const partial = tx({ id: 'i1', kind: 'income', amountMinor: 100000, date: '2026-03-28', categoryId: 'salary', scheduleId: 's2', occurrenceDate: '2026-03-28', partialSettlement: true })
    const d = baseData({ accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 100000, date: '2026-03-01', setAt: '2026-03-01T12:00:00.000Z' } })], schedules: [s1, s2], transactions: [partial] })
    const r = repairSplit(d, 's2', at('2026-04-10'), 's3')
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(driftedSplits(d, '2026-04-10').map((f) => f.from)).toEqual(['2026-04-01'])
    expect(r.data.schedules.find((s) => s.id === 's2')).toMatchObject({ endDate: '2026-03-31' })
    expect(r.value).toMatchObject({ id: 's3', startDate: '2026-04-01', anchorDate: '2026-01-31', amountIsEstimate: true, range: { minMinor: 100000, extraMinor: 220000 } })
    expect(r.data.transactions).toEqual([partial])
  })

  it('lo que mira hacia delante sigue a la serie: gasto planificado vinculado al 28-may → 31-may del tramo nuevo; plantilla, escenario y aplazamiento también; se revierte en bloque', () => {
    const TODAY = '2026-05-15'
    const d = legacyRent(['2026-02-28', '2026-03-28', '2026-04-28'], {
      goals: [goal({ id: 'g', name: 'Renta de mayo', kind: 'expense', targetMinor: 160000, targetDate: '2026-05-28', plan: { link: { scheduleId: 'r2', occurrenceDate: '2026-05-28' }, history: [] } })],
      templates: [{ id: 't', name: 'Quincena', kind: 'distribution', lines: [{ target: { kind: 'payment', scheduleId: 'r2' }, amount: { mode: 'fixed', amountMinor: 160000 } }], createdAt: NOW, updatedAt: NOW }],
      scenarios: [{ id: 'sc', name: 'Si sube', changes: [{ type: 'scheduleAmount', scheduleId: 'r2', newAmountMinor: 170000 }], baseFingerprint: 'x', createdAt: NOW, updatedAt: NOW }],
      inbox: { snoozed: [{ id: 'due:schedule:r2:2026-05-28', until: '2026-05-20', at: NOW }], dismissed: [] },
    })
    const r = repairSplit(d, 'r2', at(TODAY), 'r3')
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.data.goals[0]!.plan?.link).toEqual({ scheduleId: 'r3', occurrenceDate: '2026-05-31' })
    expect(r.data.templates[0]!.kind === 'distribution' && r.data.templates[0]!.lines[0]!.target).toEqual({ kind: 'payment', scheduleId: 'r3' })
    expect(r.data.scenarios[0]!.changes[0]).toMatchObject({ scheduleId: 'r3' })
    expect(r.data.inbox.snoozed.map((z) => z.id)).toEqual(['due:schedule:r3:2026-05-31'])
    expect(validateAppData(persisted(r.data)).ok).toBe(true)
    const stored = persisted(recordHistory(d, r.data, at(TODAY).now))
    const entry = stored.history.at(-1)!
    expect(canRevert(stored, entry, TODAY)).toBe('ok')
    const back = revertEntry(stored, entry.id, at(TODAY))
    expect(back.ok && back.data.goals[0]!.plan?.link).toEqual({ scheduleId: 'r2', occurrenceDate: '2026-05-28' })
    expect(back.ok && back.data.inbox.snoozed.map((z) => z.id)).toEqual(['due:schedule:r2:2026-05-28'])
  })

  it('un gasto planificado vinculado a una fecha sin equivalente (la serie termina antes del 31) no se deja colgado: se rechaza y nada cambia', () => {
    const d = legacyRent(['2026-02-28', '2026-03-28', '2026-04-28'], {
      goals: [goal({ id: 'g', name: 'Última renta', kind: 'expense', targetMinor: 160000, targetDate: '2026-05-28', plan: { link: { scheduleId: 'r2', occurrenceDate: '2026-05-28' }, history: [] } })],
    }, { endDate: '2026-05-29' })
    const before = JSON.stringify(d)
    expect(repairSplit(d, 'r2', at('2026-05-15'), 'r3')).toEqual({ ok: false, issues: [{ path: 'startDate', code: 'splitLinkedGoal', params: { name: 'Última renta', date: '2026-05-28' } }] })
    expect(JSON.stringify(d)).toBe(before)
  })

  it('el id del tramo nuevo lo pone quien llama: uno inválido o ya usado se rechaza', () => {
    const d = legacyRent(['2026-02-28', '2026-03-28', '2026-04-28'])
    expect(repairSplit(d, 'r2', at('2026-05-15'), 'r1')).toMatchObject({ ok: false, issues: [{ path: 'id', code: 'duplicateId' }] })
    expect(repairSplit(d, 'r2', at('2026-05-15'), 'no válido')).toMatchObject({ ok: false, issues: [{ path: 'id', code: 'invalidId' }] })
  })
})
