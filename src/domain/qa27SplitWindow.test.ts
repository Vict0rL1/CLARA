/**
 * Revisión financiera independiente de la pasada QA27 (F1, P2): al reparar una partición antigua, la pareja de la última
 * fecha de la ventana de comparación (400 días desde hoy, ampliada a las fechas vinculadas) puede caer justo después de
 * la ventana. Antes, una fecha omitida en ese periodo se quedaba en la fecha movida (que la serie reparada ya no tiene:
 * la omisión se perdía y el pago volvía a contar) y un gasto planificado vinculado a ella bloqueaba la reparación.
 * Datos sintéticos; fechas explícitas.
 */
import { describe, expect, it } from 'vitest'
import { recordHistory } from './history'
import { revertEntry } from './historyRevert'
import { planItems } from './planItems'
import { occurrencesBetween } from './recurrence'
import { driftedSplits, repairSplit } from './splitRepair'
import type { AppData, Goal } from './types'
import { account, baseData, bill, goal, tx } from '../test/fixtures'

const at = (today: string) => ({ today, now: `${today}T12:00:00.000Z` })
const must = <T,>(r: { ok: true; data: AppData; value: T } | { ok: false; issues: unknown }) => {
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r
}

describe('QA27 · revisión financiera F1 (P2): la última fecha de la ventana de comparación también tiene pareja', () => {
  // «Alquiler» del 31 partido el 28-feb-2026 por una versión anterior (a1 termina el 27-feb; a2 cuenta el 28 sin
  // `anchorDate`), con el 28-feb, 28-mar y 28-abr pagados: la reparación parte la serie desde el 1-may (el 28-abr
  // pagado «es» el 30-abr). Hoy 25-may-2026 → la ventana llega al 29-jun-2027: el 28-jun-2027 es su última fecha y su
  // pareja de siempre, el 30-jun-2027, cae justo después.
  const rent = bill('2026-01-31', 165000, { id: 'a1', name: 'Alquiler', frequency: 'monthly', categoryId: 'housing' })
  const paidOn = (scheduleId: string, date: string, id: string) => tx({ id, kind: 'expense', amountMinor: 165000, date, categoryId: 'housing', scheduleId, occurrenceDate: date })
  const fixture = (a2: Partial<AppData['schedules'][number]> = {}, goals: Goal[] = []): AppData => {
    const d = baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 1000000, date: '2026-01-01', setAt: '2026-01-01T12:00:00.000Z' } })],
      schedules: [{ ...rent, endDate: '2026-02-27' }, { ...rent, id: 'a2', startDate: '2026-02-28', ...a2 }],
      transactions: [paidOn('a1', '2026-01-31', 'p0'), paidOn('a2', '2026-02-28', 'p1'), paidOn('a2', '2026-03-28', 'p2'), paidOn('a2', '2026-04-28', 'p3')],
      goals,
    })
    return { ...d, settings: { ...d.settings, fallbackHorizonDays: 30 } }
  }
  const TODAY = '2026-05-25'

  it('la vista previa no cambia: desde el 1-may, el 28 pasa al 31 (o al último día del mes)', () => {
    expect(driftedSplits(fixture(), TODAY).map((f) => [f.scheduleId, f.from, f.current, f.proposed])).toEqual([
      ['a2', '2026-05-01', ['2026-05-28', '2026-06-28', '2026-07-28'], ['2026-05-31', '2026-06-30', '2026-07-31']],
    ])
  })

  it('una fecha omitida 399 días adelante (28-jun-2027) sigue omitida en su fecha de siempre (30-jun-2027) tras reparar', () => {
    const d = fixture({ skippedDates: ['2027-06-28'] })
    const r = must(repairSplit(d, 'a2', at(TODAY), 'a3'))
    expect(r.value.id).toBe('a3')
    expect(r.value.skippedDates).toEqual(['2027-06-30'])
    expect(occurrencesBetween(r.value, '2027-06-01', '2027-06-30')).toEqual(['2027-06-30'])
    expect(planItems(r.data, { today: TODAY, from: '2027-06-01', to: '2027-06-30' }).map((i) => [i.key, i.state])).toEqual([['schedule:a3:2027-06-30', 'skipped']])
    // El tramo que termina conserva solo lo anterior a `from`; revertir devuelve la omisión al 28-jun-2027.
    expect(r.data.schedules.find((s) => s.id === 'a2')).toMatchObject({ endDate: '2026-04-30', skippedDates: [] })
    const tracked = recordHistory(d, r.data, at(TODAY).now)
    const undone = must(revertEntry(tracked, tracked.history.at(-1)!.id, at(TODAY)))
    expect(undone.data.schedules.map((s) => [s.id, s.skippedDates])).toEqual([['a1', []], ['a2', ['2027-06-28']]])
  })

  it('un gasto planificado vinculado al 28-jun-2027 tiene equivalente (30-jun-2027): la reparación no se rechaza y el vínculo pasa al tramo nuevo', () => {
    const linked = goal({ id: 'g', name: 'Alquiler jun-2027', kind: 'expense', targetMinor: 165000, targetDate: '2027-06-28', plan: { link: { scheduleId: 'a2', occurrenceDate: '2027-06-28' }, history: [] } })
    const r = must(repairSplit(fixture({}, [linked]), 'a2', at(TODAY), 'a3'))
    expect(r.data.goals[0]!.plan?.link).toEqual({ scheduleId: 'a3', occurrenceDate: '2027-06-30' })
  })

  it('control: la misma omisión un periodo antes (28-may-2027 → 31-may-2027) y otra mucho más allá de la ventana (28-ene-2028 → 31-ene-2028)', () => {
    const r = must(repairSplit(fixture({ skippedDates: ['2027-05-28', '2028-01-28'] }), 'a2', at(TODAY), 'a3'))
    expect(r.value.skippedDates).toEqual(['2027-05-31', '2028-01-31'])
    expect(occurrencesBetween(r.value, '2028-01-01', '2028-01-31')).toEqual(['2028-01-31'])
  })
})
