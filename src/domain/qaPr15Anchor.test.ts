/**
 * Auditoría independiente del PR #15 (cabeza 819eaa9, base a23b135): reproducción y contrato de QA-01 (al partir un programado cambiando solo el importe, la serie conserva sus fechas).
 * Datos sintéticos, fechas fijas; falla sobre 819eaa9 y fija el contrato corregido. QA-03 (= STAT-01) y QA-04
 * (= CUR-02) están en `qaV2.test.ts` y `tests/e2e/qa-v2.spec.ts`; la aceptación de navegador en `tests/e2e/qa-pr15.spec.ts`.
 */
import { describe, expect, it } from 'vitest'
import { computeBudget } from './budget'
import { type ScheduleDraft } from './operations'
import { occurrencesBetween } from './recurrence'
import { defaultSplitDate, saveScheduleFrom } from './scheduleFrom'
import type { AppData, Schedule } from './types'
import { validateAppData } from '../storage/backup'
import { account, baseData, bill, income, tx } from '../test/fixtures'

/** El borrador que manda el formulario al partir «desde una fecha» cambiando SOLO el importe (con la fecha propuesta). */
function amountOnly(s: Schedule, startDate: string, amountMinor: number): ScheduleDraft {
  const { createdAt: _c, updatedAt: _u, currency: _cur, skippedDates: _k, ...rest } = s
  return { ...rest, id: 'next', startDate, amountMinor }
}
const at = (today: string) => ({ today, now: `${today}T12:00:00.000Z` })
const split = (d: AppData, id: string, draft: ScheduleDraft, today: string) => {
  const r = saveScheduleFrom(d, id, draft, at(today))
  if (!r.ok) throw new Error(`split: ${JSON.stringify(r.issues)}`)
  return r
}

describe('QA-01 · partir un programado cambiando solo el importe conserva las fechas de la serie', () => {
  const salary = (startDate: string, extra: Partial<Schedule> = {}) => income(startDate, 300000, { id: 'salary', name: 'Sueldo', frequency: 'monthly', ...extra })
  const data = (schedules: Schedule[], anchorDate = '2026-02-15') =>
    baseData({ accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 100000, date: anchorDate, setAt: `${anchorDate}T12:00:00.000Z` } })], schedules })

  it('sueldo mensual del 31-ene, hoy 15-feb: se propone el 28-feb y la serie nueva sigue el día 31 (31-mar, 30-abr, 31-may)', () => {
    const d = data([salary('2026-01-31')])
    const from = defaultSplitDate(d, d.schedules[0]!, '2026-02-15')
    expect(from).toBe('2026-02-28')
    const r = split(d, 'salary', amountOnly(d.schedules[0]!, from!, 320000), '2026-02-15')
    expect(occurrencesBetween(r.value.next, '2026-02-28', '2026-06-30')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30'])
    expect(r.value.ended.endDate).toBe('2026-02-27')
    expect(occurrencesBetween(r.value.ended, '2026-01-01', '2026-12-31')).toEqual(['2026-01-31'])
    expect(validateAppData(r.data).ok).toBe(true)
  })

  it('caso financiero: con el sueldo partido, el pago del 30-mar sigue reservado por el ingreso del 31-mar (disponible 10 000, reservado 90 000)', () => {
    const d = data([salary('2026-01-31'), bill('2026-03-30', 90000, { id: 'bill', name: 'Pago', frequency: 'once' })])
    const before = computeBudget(d, '2026-03-20')
    expect([before.horizon?.endDate, before.reservedTotalMinor, before.availableMinor]).toEqual(['2026-03-31', 90000, 10000])
    const r = split(d, 'salary', amountOnly(d.schedules[0]!, defaultSplitDate(d, d.schedules[0]!, '2026-02-15')!, 400000), '2026-02-15')
    const after = computeBudget(r.data, '2026-03-20')
    // Un ingreso futuro más alto nunca sube el dinero de hoy, y la reserva del pago no se suelta.
    expect([after.horizon?.endDate, after.reservedTotalMinor, after.availableMinor]).toEqual(['2026-03-31', 90000, 10000])
  })

  it('dos veces al mes (1 y 20) desde el 20-oct: se guarda sin arreglar el segundo día a mano y conserva 1 y 20; desde el 1-nov también', () => {
    const d = data([bill('2026-08-01', 5000, { id: 'tw', name: 'Cuota', frequency: 'semimonthly', secondDay: 20 })])
    const from = defaultSplitDate(d, d.schedules[0]!, '2026-10-17')
    expect(from).toBe('2026-10-20')
    const r = saveScheduleFrom(d, 'tw', amountOnly(d.schedules[0]!, from!, 5500), at('2026-10-17'))
    expect(r.ok, JSON.stringify(r.ok ? null : r.issues)).toBe(true)
    if (!r.ok) return
    expect(r.value.next.secondDay).toBe(20)
    expect(occurrencesBetween(r.value.next, '2026-10-20', '2026-12-31')).toEqual(['2026-10-20', '2026-11-01', '2026-11-20', '2026-12-01', '2026-12-20'])
    expect(validateAppData(r.data).ok).toBe(true)
    const r2 = split(d, 'tw', amountOnly(d.schedules[0]!, defaultSplitDate(d, d.schedules[0]!, '2026-10-25')!, 5500), '2026-10-25')
    expect(occurrencesBetween(r2.value.next, '2026-11-01', '2026-12-31')).toEqual(['2026-11-01', '2026-11-20', '2026-12-01', '2026-12-20'])
  })

  it('guardar dos veces el mismo tramo (mismo id, como al reintentar el formulario) conserva la fecha que fija la serie', () => {
    const d = data([salary('2026-01-31')])
    const draft = amountOnly(d.schedules[0]!, '2026-02-28', 320000)
    const first = split(d, 'salary', draft, '2026-02-15')
    expect(first.value.next.anchorDate).toBe('2026-01-31')
    // Revisión propia (R1): la rama idempotente (el id del nuevo ya existe) guardaba el borrador tal cual y perdía el ancla.
    const again = split(first.data, 'salary', draft, '2026-02-15')
    expect(again.value.next.anchorDate).toBe('2026-01-31')
    expect(occurrencesBetween(again.value.next, '2026-02-28', '2026-05-31')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
    expect(again.data.schedules.map((s) => s.id)).toEqual(['salary', 'next'])
    expect(again.value.ended.endDate).toBe('2026-02-27')
    expect(validateAppData(again.data).ok).toBe(true)
  })

  it.each([
    ['mensual del 31 (febrero bisiesto)', income('2028-01-31', 1000, { id: 's', frequency: 'monthly' }), '2028-02-15', '2028-02-29', ['2028-02-29', '2028-03-31', '2028-04-30', '2028-05-31']],
    ['mensual del 30', income('2026-01-30', 1000, { id: 's', frequency: 'monthly' }), '2026-02-10', '2026-02-28', ['2026-02-28', '2026-03-30', '2026-04-30', '2026-05-30']],
    ['mensual del 29 (febrero no bisiesto)', income('2026-01-29', 1000, { id: 's', frequency: 'monthly' }), '2026-02-10', '2026-02-28', ['2026-02-28', '2026-03-29', '2026-04-29']],
    ['trimestral del 30-nov', income('2025-11-30', 1000, { id: 's', frequency: 'quarterly' }), '2026-02-10', '2026-02-28', ['2026-02-28', '2026-05-30', '2026-08-30', '2026-11-30']],
    ['anual del 29-feb', income('2028-02-29', 1000, { id: 's', frequency: 'yearly' }), '2029-02-10', '2029-02-28', ['2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']],
  ] as const)('%s: se propone la fecha movida y la serie nueva vuelve al día nominal', (_label, s, today, from, dates) => {
    const d = data([s], '2025-01-01')
    expect(defaultSplitDate(d, s, today)).toBe(from)
    const r = split(d, 's', amountOnly(s, from, 1200), today)
    expect(occurrencesBetween(r.value.next, from, dates[dates.length - 1]!)).toEqual([...dates])
  })

  it('omitidas, fecha de fin y pagos registrados: lo anterior no cambia y las guardas siguen', () => {
    const s = salary('2026-01-31', { endDate: '2026-12-31', skippedDates: ['2026-04-30'] })
    const paid = tx({ id: 'p1', kind: 'income', date: '2026-01-31', amountMinor: 300000, categoryId: 'salary', scheduleId: 'salary', occurrenceDate: '2026-01-31' })
    const d: AppData = { ...data([s]), transactions: [paid] }
    const r = split(d, 'salary', amountOnly(s, '2026-02-28', 320000), '2026-02-15')
    expect(r.value.next).toMatchObject({ endDate: '2026-12-31', skippedDates: ['2026-04-30'] })
    expect(r.value.ended.skippedDates).toEqual([])
    expect(occurrencesBetween(r.value.next, '2026-02-28', '2026-12-31')).toContain('2026-04-30')
    expect(r.data.transactions).toEqual([paid])
    const settledLater: AppData = { ...d, transactions: [tx({ id: 'p2', kind: 'income', date: '2026-03-31', amountMinor: 300000, categoryId: 'salary', scheduleId: 'salary', occurrenceDate: '2026-03-31' })] }
    expect(saveScheduleFrom(settledLater, 'salary', amountOnly(s, '2026-02-28', 320000), at('2026-02-15'))).toMatchObject({ ok: false, issues: [{ code: 'splitSettledAfter' }] })
  })

  it('control: cambiar la regla explícitamente sigue valiendo (una fecha que no es de la serie la reancla)', () => {
    const d = data([salary('2026-01-31')])
    const r = split(d, 'salary', amountOnly(d.schedules[0]!, '2026-03-05', 300000), '2026-02-15')
    expect(occurrencesBetween(r.value.next, '2026-03-05', '2026-05-31')).toEqual(['2026-03-05', '2026-04-05', '2026-05-05'])
  })
})
