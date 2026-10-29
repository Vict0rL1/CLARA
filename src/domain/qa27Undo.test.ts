/**
 * Auditoría independiente del 2026-10-29 sobre `21b4ed8` (QA27-01, P1): deshacer una reparación (o una partición) con un
 * pago registrado DESPUÉS en una ocurrencia que la reversión eliminaría o movería (otro id, otra fecha de siempre)
 * dejaba el pago sin ocurrencia y la ocurrencia restaurada volvía a reservarse: el mismo dinero contaba dos veces.
 * Se rechaza sin tocar nada y se dice qué pago. Datos sintéticos; fechas explícitas.
 */
import { describe, expect, it } from 'vitest'
import { computeBudget } from './budget'
import { recordHistory } from './history'
import { canRevert, revertDependents, revertEntry } from './historyRevert'
import { markOccurrence, type ScheduleDraft } from './operations'
import { saveScheduleFrom } from './scheduleFrom'
import { autoConfirmDue } from './scheduledJobs'
import { repairSplit } from './splitRepair'
import type { AppData, HistoryEntry, Schedule } from './types'
import { backupText, parseBackup, validateAppData } from '../storage/backup'
import { account, baseData, bill, income, tx } from '../test/fixtures'

const persisted = (d: AppData): AppData => JSON.parse(JSON.stringify(d)) as AppData
const at = (today: string) => ({ today, now: `${today}T12:00:00.000Z` })
const roundTrip = (d: AppData, today: string): AppData => {
  const r = parseBackup(backupText(persisted(d), new Date(`${today}T12:00:00.000Z`), 'test'))
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.data
}
const figures = (d: AppData, today: string) => {
  const b = computeBudget(d, today)
  return { available: b.availableMinor, reserved: b.reservedTotalMinor, overdue: b.overdueBills.map((i) => i.key), horizon: b.horizon?.endDate ?? null }
}
const lastEntry = (d: AppData): HistoryEntry => d.history.at(-1)!
const amountOnly = (s: Schedule, startDate: string, amountMinor: number, id: string): ScheduleDraft => {
  const { createdAt: _c, updatedAt: _u, currency: _cur, skippedDates: _k, ...rest } = s
  return { ...rest, id, startDate, amountMinor }
}

describe('QA27-01 (P1) · deshacer una reparación o una partición con un pago registrado después en una ocurrencia que desaparecería', () => {
  /** Factura mensual del 31 partida el 28-feb por una versión anterior (sin `anchorDate`); horizonte de 7 días. */
  const fixture = (amountMinor: number, balanceMinor: number): AppData => {
    const d = baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: balanceMinor, date: '2026-03-01', setAt: '2026-03-01T12:00:00.000Z' } })],
      schedules: [
        bill('2026-01-31', amountMinor, { id: 'b1', name: 'Internet', frequency: 'monthly', endDate: '2026-02-27' }),
        bill('2026-02-28', amountMinor, { id: 'b2', name: 'Internet', frequency: 'monthly' }),
      ],
      // Lo anterior está pagado (fechas anteriores al saldo de referencia del 1-mar: no mueven el saldo).
      transactions: [
        tx({ id: 'p-jan', kind: 'expense', amountMinor, date: '2026-01-31', categoryId: 'utilities', scheduleId: 'b1', occurrenceDate: '2026-01-31' }),
        tx({ id: 'p-feb', kind: 'expense', amountMinor, date: '2026-02-28', categoryId: 'utilities', scheduleId: 'b2', occurrenceDate: '2026-02-28' }),
      ],
    })
    return { ...d, settings: { ...d.settings, fallbackHorizonDays: 7 } }
  }
  /** Repara el 20-mar (en el sitio: nada pagado en fechas movidas) y paga el 31-mar corregido el 29-mar. */
  const repairedAndPaid = (amountMinor: number, balanceMinor: number, pay: { date: string; occurrenceDate: string; partial?: boolean } = { date: '2026-03-29', occurrenceDate: '2026-03-31' }) => {
    const d = fixture(amountMinor, balanceMinor)
    const r = repairSplit(d, 'b2', at('2026-03-20'), 'b3')
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    const repaired = recordHistory(d, r.data, at('2026-03-20').now)
    const entry = lastEntry(repaired)
    const p = markOccurrence(repaired, { scheduleId: 'b2', occurrenceDate: pay.occurrenceDate, amountMinor: pay.partial ? Math.floor(amountMinor / 2) : amountMinor, date: pay.date, txId: 'p1', ...(pay.partial ? { expectRemainder: true } : {}) }, at(pay.date))
    if (!p.ok) throw new Error(JSON.stringify(p.issues))
    const paid = recordHistory(repaired, p.data, at(pay.date).now)
    return { d, entry, paid }
  }
  const expectRefused = (data: AppData, entry: HistoryEntry, today: string, scheduleId: string, occurrenceDate: string) => {
    const before = JSON.stringify(data)
    expect(canRevert(data, entry, today)).toBe('dependents')
    expect(revertDependents(data, entry, today)).toMatchObject([{ kind: 'payment', scheduleId, name: occurrenceDate }])
    expect(revertEntry(data, entry.id, at(today))).toMatchObject({ ok: false, issues: [{ path: 'history', code: 'revertDependents', params: { count: 1 } }] })
    expect(JSON.stringify(data)).toBe(before)
  }

  it('la reproducción del navegador: 1 400 de saldo, factura de 420 pagada el 29-mar para el 31-mar → 980 disponibles; revertir la reparación se rechaza y sigue en 980 (antes: 560 con el 28-mar vencido)', () => {
    const { entry, paid } = repairedAndPaid(42000, 140000)
    expect(figures(paid, '2026-03-29')).toEqual({ available: 98000, reserved: 0, overdue: [], horizon: '2026-04-05' })
    expectRefused(paid, entry, '2026-03-29', 'b2', '2026-03-31')
    expect(figures(paid, '2026-03-29').available).toBe(98000)
    // Tras recargar y tras exportar e importar: mismas cifras, mismo pago, misma negativa.
    for (const again of [persisted(paid), roundTrip(paid, '2026-03-29')]) {
      expect(figures(again, '2026-03-29')).toEqual({ available: 98000, reserved: 0, overdue: [], horizon: '2026-04-05' })
      expect(again.transactions.find((t) => t.id === 'p1')).toMatchObject({ scheduleId: 'b2', occurrenceDate: '2026-03-31', amountMinor: 42000, status: 'realized' })
      expectRefused(again, lastEntry(again) === entry ? entry : again.history.find((e) => e.id === entry.id)!, '2026-03-29', 'b2', '2026-03-31')
    }
  })

  it('la segunda reproducción: 700 de saldo, cuota de 137,25 → 562,75 disponibles tras pagarla; revertir se rechaza (antes: 425,50)', () => {
    const { entry, paid } = repairedAndPaid(13725, 70000)
    expect(figures(paid, '2026-03-29').available).toBe(56275)
    expectRefused(paid, entry, '2026-03-29', 'b2', '2026-03-31')
  })

  it('pago en la propia fecha (31-mar) y confirmación automática: también son pagos que la reversión dejaría sin ocurrencia', () => {
    const onDate = repairedAndPaid(42000, 140000, { date: '2026-03-31', occurrenceDate: '2026-03-31' })
    expectRefused(onDate.paid, onDate.entry, '2026-03-31', 'b2', '2026-03-31')

    const d = fixture(42000, 140000)
    const auto: AppData = { ...d, schedules: d.schedules.map((s) => (s.id === 'b2' ? { ...s, autoConfirm: true } : s)) }
    const r = repairSplit(auto, 'b2', at('2026-03-20'), 'b3')
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    const repaired = recordHistory(auto, r.data, at('2026-03-20').now)
    const entry = lastEntry(repaired)
    const c = autoConfirmDue(repaired, at('2026-03-31'))
    if (!c.ok) throw new Error(JSON.stringify(c.issues))
    expect(c.value.confirmed.map((t) => [t.scheduleId, t.occurrenceDate, t.amountMinor])).toEqual([['b2', '2026-03-31', 42000]])
    const confirmed = recordHistory(repaired, c.data, at('2026-03-31').now)
    expectRefused(confirmed, entry, '2026-03-31', 'b2', '2026-03-31')
  })

  it('un cobro parcial también cuenta', () => {
    const d = baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 100000, date: '2026-03-01', setAt: '2026-03-01T12:00:00.000Z' } })],
      schedules: [income('2026-01-31', 300000, { id: 's1', name: 'Sueldo', frequency: 'monthly', endDate: '2026-02-27' }), income('2026-02-28', 300000, { id: 's2', name: 'Sueldo', frequency: 'monthly', amountIsEstimate: true, range: { minMinor: 100000, extraMinor: 200000 } })],
    })
    const r = repairSplit(d, 's2', at('2026-03-20'), 's3')
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    const repaired = recordHistory(d, r.data, at('2026-03-20').now)
    const entry = lastEntry(repaired)
    const p = markOccurrence(repaired, { scheduleId: 's2', occurrenceDate: '2026-03-31', amountMinor: 100000, date: '2026-03-31', txId: 'i1', expectRemainder: true }, at('2026-03-31'))
    if (!p.ok) throw new Error(JSON.stringify(p.issues))
    const paid = recordHistory(repaired, p.data, at('2026-03-31').now)
    expect(paid.transactions.find((t) => t.id === 'i1')).toMatchObject({ partialSettlement: true, scheduleId: 's2', occurrenceDate: '2026-03-31' })
    expectRefused(paid, entry, '2026-03-31', 's2', '2026-03-31')
  })

  it('reparación PARTIDA: el pago del 31-may en el tramo nuevo impide revertir (la reversión eliminaría ese tramo)', () => {
    const rent = bill('2026-01-31', 150000, { id: 'r1', name: 'Renta', frequency: 'monthly', categoryId: 'housing' })
    const paid = (scheduleId: string, date: string, id: string) => tx({ id, kind: 'expense', amountMinor: 160000, date, categoryId: 'housing', scheduleId, occurrenceDate: date })
    const d0 = baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 1000000, date: '2026-01-01', setAt: '2026-01-01T12:00:00.000Z' } })],
      schedules: [{ ...rent, endDate: '2026-02-27' }, { ...rent, id: 'r2', startDate: '2026-02-28', amountMinor: 160000 }],
      transactions: [tx({ id: 'p0', kind: 'expense', amountMinor: 150000, date: '2026-01-31', categoryId: 'housing', scheduleId: 'r1', occurrenceDate: '2026-01-31' }), paid('r2', '2026-02-28', 'p1'), paid('r2', '2026-03-28', 'p2'), paid('r2', '2026-04-28', 'p3')],
    })
    const d = { ...d0, settings: { ...d0.settings, fallbackHorizonDays: 30 } }
    const r = repairSplit(d, 'r2', at('2026-05-15'), 'r3')
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.data.schedules.map((s) => s.id)).toEqual(['r1', 'r2', 'r3'])
    const repaired = recordHistory(d, r.data, at('2026-05-15').now)
    const entry = lastEntry(repaired)
    expect(canRevert(repaired, entry, '2026-05-15')).toBe('ok')
    const p = markOccurrence(repaired, { scheduleId: 'r3', occurrenceDate: '2026-05-31', amountMinor: 160000, date: '2026-05-29', txId: 'p4' }, at('2026-05-29'))
    if (!p.ok) throw new Error(JSON.stringify(p.issues))
    const afterPay = recordHistory(repaired, p.data, at('2026-05-29').now)
    expect(figures(afterPay, '2026-05-29')).toMatchObject({ reserved: 0, overdue: [] })
    expectRefused(afterPay, entry, '2026-05-29', 'r3', '2026-05-31')
  })

  it('partición normal «desde una fecha» (ya en 46fe617): pagar la primera ocurrencia del tramo nuevo impide revertir la partición', () => {
    const old = bill('2026-06-01', 65000, { id: 'old', name: 'Renta', frequency: 'monthly', categoryId: 'housing' })
    const d = baseData({ accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 500000, date: '2026-06-01', setAt: '2026-06-01T12:00:00.000Z' } })], schedules: [old] })
    const r = saveScheduleFrom(d, 'old', amountOnly(old, '2026-10-01', 70000, 'next'), at('2026-09-28'))
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    const split = recordHistory(d, r.data, at('2026-09-28').now)
    const entry = lastEntry(split)
    expect(canRevert(split, entry, '2026-09-28')).toBe('ok')
    const p = markOccurrence(split, { scheduleId: 'next', occurrenceDate: '2026-10-01', amountMinor: 70000, date: '2026-10-01', txId: 'p1' }, at('2026-10-01'))
    if (!p.ok) throw new Error(JSON.stringify(p.issues))
    const paid = recordHistory(split, p.data, at('2026-10-01').now)
    expectRefused(paid, entry, '2026-10-01', 'next', '2026-10-01')
  })

  it('sin trabajo dependiente posterior se sigue pudiendo revertir, y un movimiento posterior NO vinculado sobrevive', () => {
    const d = fixture(42000, 140000)
    const r = repairSplit(d, 'b2', at('2026-03-20'), 'b3')
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    const repaired = recordHistory(d, r.data, at('2026-03-20').now)
    const entry = lastEntry(repaired)
    expect(canRevert(repaired, entry, '2026-03-29')).toBe('ok')
    const later: AppData = { ...repaired, transactions: [...repaired.transactions, tx({ id: 'coffee', date: '2026-03-25', amountMinor: 450, kind: 'expense', status: 'realized' })] }
    const tracked = recordHistory(repaired, later, at('2026-03-25').now)
    expect(canRevert(tracked, entry, '2026-03-29')).toBe('ok')
    const back = revertEntry(tracked, entry.id, at('2026-03-29'))
    if (!back.ok) throw new Error(JSON.stringify(back.issues))
    expect(back.data.transactions.map((t) => t.id)).toEqual(['p-jan', 'p-feb', 'coffee'])
    expect(back.data.schedules.find((s) => s.id === 'b2')?.anchorDate).toBeUndefined()
    expect(validateAppData(persisted(back.data)).ok).toBe(true)
  })

  it('un pago que YA estaba sin ocurrencia antes de revertir no cuenta (no resolvía antes)', () => {
    const d = fixture(42000, 140000)
    const r = repairSplit(d, 'b2', at('2026-03-20'), 'b3')
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    const repaired = recordHistory(d, r.data, at('2026-03-20').now)
    const entry = lastEntry(repaired)
    const dangling: AppData = { ...repaired, transactions: [tx({ id: 'ghost', date: '2026-03-10', amountMinor: 42000, kind: 'expense', status: 'realized', scheduleId: 'b2', occurrenceDate: '2026-03-10' })] }
    expect(canRevert(dangling, entry, '2026-03-29')).toBe('ok')
  })
})

