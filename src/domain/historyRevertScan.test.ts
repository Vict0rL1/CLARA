/**
 * `revertDependents` con un libro grande (revisión de seguridad QA27, O-9): solo recorre los movimientos que pueden
 * cambiar de estado (los de la propia entrada y los vinculados a un programado que la entrada toca) y da exactamente
 * lo mismo que comparar la liquidación de TODOS los movimientos entre el estado actual y el revertido.
 */
import { describe, expect, it } from 'vitest'
import { canRevert, revertDependents } from './historyRevert'
import { occurrencesBetween } from './recurrence'
import type { AppData, HistoryEntry, Schedule, Transaction } from './types'
import { account, baseData, bill, tx } from '../test/fixtures'

const TODAY = '2026-09-28'

function ledger(): { data: AppData; schedules: Schedule[] } {
  const schedules: Schedule[] = []
  const payments: Transaction[] = []
  for (let i = 0; i < 100; i++) {
    const dd = String((i % 28) + 1).padStart(2, '0')
    const s = bill(`2025-12-${dd}`, 1000 + i * 37, { id: `s${i}`, name: `Servicio ${i}`, frequency: 'monthly', categoryId: 'utilities' })
    schedules.push(s)
    for (let m = 0; m < 10; m++) {
      const month = ((11 + m) % 12) + 1
      const year = 11 + m >= 12 ? 2026 : 2025
      const date = `${year}-${String(month).padStart(2, '0')}-${dd}`
      payments.push(tx({ id: `p${i}-${m}`, kind: 'expense', status: 'realized', amountMinor: s.amountMinor, date, categoryId: 'utilities', scheduleId: s.id, occurrenceDate: date }))
    }
  }
  const noise = Array.from({ length: 5000 }, (_, i) => tx({ id: `n${i}`, kind: 'expense', status: 'realized', amountMinor: 100 + (i % 50), date: `2026-0${(i % 9) + 1}-15`, categoryId: 'groceries' }))
  const data = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 100000000, date: '2025-11-01', setAt: '2025-11-01T12:00:00.000Z' } })],
    schedules,
    transactions: [...payments, ...noise],
  })
  return { data, schedules }
}

/** Fuerza bruta: liquidación de cada movimiento realizado en el estado actual y en el revertido (programados sustituidos por `before`). */
function bruteForce(data: AppData, entry: HistoryEntry): string[] {
  const after = new Map(data.schedules.map((s) => [s.id, s]))
  for (const c of entry.changes) if (c.collection === 'schedules') {
    if (c.before) after.set(c.id, c.before as Schedule)
    else after.delete(c.id)
  }
  const before = new Map(data.schedules.map((s) => [s.id, s]))
  const settles = (t: Transaction, map: Map<string, Schedule>) => {
    if (t.status !== 'realized' || !t.scheduleId || !t.occurrenceDate) return false
    const s = map.get(t.scheduleId)
    return s !== undefined && occurrencesBetween(s, t.occurrenceDate, t.occurrenceDate).length > 0
  }
  return data.transactions.filter((t) => settles(t, before) && !settles(t, after)).map((t) => t.id)
}

describe('revertDependents · recorrido acotado con 100 programados, 1 000 pagos vinculados y 5 000 movimientos sueltos', () => {
  const { data, schedules } = ledger()
  const entryFor = (s: Schedule, before: Schedule, i: number): HistoryEntry => ({ id: `h${i}`, at: `2026-09-28T1${String(i).padStart(2, '0').slice(-2)}:00:00.000Z`, source: 'app', changes: [{ collection: 'schedules', id: s.id, before, after: s }] })

  it('un cambio solo de importe no deja ningún pago sin fecha: ninguna entrada revertible lista dependientes', () => {
    for (let i = 0; i < 15; i++) {
      const s = schedules[i]!
      const entry = entryFor(s, { ...s, amountMinor: s.amountMinor - 100 }, i)
      const withEntry = { ...data, history: [entry] }
      expect(revertDependents(withEntry, entry, TODAY)).toEqual([])
      expect(canRevert(withEntry, entry, TODAY)).toBe('ok')
    }
  })

  it('mover el inicio al 1-jun-2026 deja sin fecha los seis pagos anteriores de ESE programado, en orden, y de ningún otro: igual que la fuerza bruta', () => {
    for (let i = 15; i < 30; i++) {
      const s = schedules[i]!
      // `anchorDate` conserva el día: solo cambia desde cuándo cuenta; sin ancla cambiaría también el día y los diez quedarían sin fecha.
      const entry = entryFor(s, { ...s, startDate: '2026-06-01', anchorDate: s.startDate }, i)
      const withEntry = { ...data, history: [entry] }
      const deps = revertDependents(withEntry, entry, TODAY)
      expect(deps.map((d) => d.id)).toEqual(bruteForce(withEntry, entry))
      expect(deps).toHaveLength(6)
      expect(deps.every((d) => d.kind === 'payment' && d.scheduleId === s.id)).toBe(true)
      expect(canRevert(withEntry, entry, TODAY)).toBe('dependents')
    }
  })

  it('una entrada que elimina un programado (lo creó) lista sus diez pagos y solo los suyos', () => {
    const s = schedules[40]!
    const entry: HistoryEntry = { id: 'hc', at: '2026-09-28T12:00:00.000Z', source: 'app', changes: [{ collection: 'schedules', id: s.id, before: null, after: s }] }
    const withEntry = { ...data, history: [entry] }
    const deps = revertDependents(withEntry, entry, TODAY)
    expect(deps.map((d) => d.id)).toEqual(bruteForce(withEntry, entry))
    expect(deps).toHaveLength(10)
  })
})
