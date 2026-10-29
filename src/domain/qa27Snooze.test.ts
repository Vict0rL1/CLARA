/**
 * Auditoría independiente del 2026-10-29 sobre `21b4ed8` (QA27-02, P2): una reparación partida cambia el id del tramo;
 * un aplazamiento cuya fecha coincide en las dos series (28-feb) tiene que pasar al tramo nuevo aunque la fecha no
 * cambie, con sus metadatos y sin duplicados. Datos sintéticos; fechas explícitas.
 */
import { describe, expect, it } from 'vitest'
import { recordHistory } from './history'
import { revertEntry } from './historyRevert'
import { inboxView } from './inbox'
import { occurrencesBetween } from './recurrence'
import { driftedSplits, repairSplit } from './splitRepair'
import type { AppData, HistoryEntry } from './types'
import { backupText, parseBackup } from '../storage/backup'
import { account, baseData, bill, income, NOW, tx } from '../test/fixtures'

const persisted = (d: AppData): AppData => JSON.parse(JSON.stringify(d)) as AppData
const at = (today: string) => ({ today, now: `${today}T12:00:00.000Z` })
const roundTrip = (d: AppData, today: string): AppData => {
  const r = parseBackup(backupText(persisted(d), new Date(`${today}T12:00:00.000Z`), 'test'))
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.data
}
const lastEntry = (d: AppData): HistoryEntry => d.history.at(-1)!

describe('QA27-02 (P2) · una reparación partida lleva al tramo nuevo los aplazamientos cuya fecha no cambia', () => {
  // Renta del 31 partida el 28-feb-2026 por una versión anterior: desde entonces cuenta el 28 (…, 28-ene-2027, 28-feb-2027).
  const rent = bill('2026-01-31', 150000, { id: 'r1', name: 'Renta', frequency: 'monthly', categoryId: 'housing' })
  const paidOn = (date: string, id: string) => tx({ id, kind: 'expense', amountMinor: 150000, date, categoryId: 'housing', scheduleId: 'r2', occurrenceDate: date })
  const fixture = (snoozed: AppData['inbox']['snoozed'], extraTx: AppData['transactions'] = []) =>
    baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 1000000, date: '2027-01-01', setAt: '2027-01-01T12:00:00.000Z' } })],
      schedules: [{ ...rent, endDate: '2026-02-27' }, { ...rent, id: 'r2', startDate: '2026-02-28' }],
      transactions: [...['2026-02-28', '2026-03-28', '2026-04-28', '2026-05-28', '2026-06-28', '2026-07-28', '2026-08-28', '2026-09-28', '2026-10-28', '2026-11-28', '2026-12-28', '2027-01-28'].map((d, i) => paidOn(d, `p${i}`)), ...extraTx],
      inbox: { snoozed, dismissed: [] },
    })
  const TODAY = '2027-03-01'

  it('el 28-feb vencido y aplazado hasta el 5-mar sigue aplazado tras reparar: mismo `until` y `at`, id del tramo nuevo, sin duplicados', () => {
    const d = fixture([{ id: 'due:schedule:r2:2027-02-28', until: '2027-03-05', at: '2027-02-28T12:00:00.000Z' }])
    expect(driftedSplits(d, TODAY).map((f) => [f.scheduleId, f.from])).toEqual([['r2', '2027-02-01']])
    expect(inboxView(d, TODAY).snoozed.map((i) => [i.id, i.until])).toEqual([['due:schedule:r2:2027-02-28', '2027-03-05']])
    const r = repairSplit(d, 'r2', at(TODAY), 'r3')
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.data.schedules.find((s) => s.id === 'r2')?.endDate).toBe('2027-01-31')
    expect(occurrencesBetween(r.value, '2027-02-01', '2027-04-30')).toEqual(['2027-02-28', '2027-03-31', '2027-04-30'])
    expect(r.data.inbox.snoozed).toEqual([{ id: 'due:schedule:r3:2027-02-28', until: '2027-03-05', at: '2027-02-28T12:00:00.000Z' }])
    const view = inboxView(r.data, TODAY)
    expect(view.active.map((i) => i.id)).not.toContain('due:schedule:r3:2027-02-28')
    expect(view.snoozed.map((i) => [i.id, i.until])).toEqual([['due:schedule:r3:2027-02-28', '2027-03-05']])
    for (const again of [persisted(r.data), roundTrip(r.data, TODAY)]) expect(again.inbox.snoozed).toEqual(r.data.inbox.snoozed)
    // Revertir la reparación devuelve el aplazamiento a su id anterior.
    const tracked = recordHistory(d, r.data, at(TODAY).now)
    const back = revertEntry(tracked, lastEntry(tracked).id, at(TODAY))
    expect(back.ok && back.data.inbox.snoozed).toEqual(d.inbox.snoozed)
  })

  it('fecha que cambia (28-mar → 31-mar) en la misma reparación: también pasa al tramo nuevo con sus metadatos', () => {
    const d = fixture([{ id: 'due:schedule:r2:2027-03-28', until: '2027-03-30', at: NOW }])
    const r = repairSplit(d, 'r2', at(TODAY), 'r3')
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.data.inbox.snoozed).toEqual([{ id: 'due:schedule:r3:2027-03-31', until: '2027-03-30', at: NOW }])
  })

  it('reparación EN EL SITIO (mismo id): una fecha que coincide queda igual y una que cambia se lleva; sin duplicados', () => {
    const s1 = income('2026-01-31', 300000, { id: 's1', name: 'Sueldo', frequency: 'monthly', endDate: '2026-02-27' })
    const s2 = income('2026-02-28', 320000, { id: 's2', name: 'Sueldo', frequency: 'monthly' })
    const d = baseData({ schedules: [s1, s2], inbox: { snoozed: [{ id: 'due:schedule:s2:2026-02-28', until: '2026-03-20', at: NOW }, { id: 'due:schedule:s2:2026-03-28', until: '2026-04-02', at: NOW }], dismissed: [] } })
    const r = repairSplit(d, 's2', at('2026-03-15'), 'unused')
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.data.schedules.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(r.data.inbox.snoozed).toEqual([{ id: 'due:schedule:s2:2026-02-28', until: '2026-03-20', at: NOW }, { id: 'due:schedule:s2:2026-03-31', until: '2026-04-02', at: NOW }])
  })

  it('un aplazamiento de una fecha ya pagada (antes de `from`) se queda en el tramo que termina; uno sin equivalente queda inerte, sin inventar otro', () => {
    const d = fixture([{ id: 'due:schedule:r2:2027-01-28', until: '2027-03-10', at: NOW }, { id: 'due:schedule:r2:2027-02-15', until: '2027-03-10', at: NOW }])
    const r = repairSplit(d, 'r2', at(TODAY), 'r3')
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.data.inbox.snoozed.map((z) => z.id).sort()).toEqual(['due:schedule:r2:2027-01-28', 'due:schedule:r2:2027-02-15'])
  })
})

