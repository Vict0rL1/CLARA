import { describe, expect, it } from 'vitest'
import { computeBudget } from './budget'
import { diffForHistory, HISTORY_MAX_ENTRIES, recordHistory, setValue, setValues } from './history'
import { canRevert, revertConflicts, revertEntry, stateBefore } from './historyRevert'
import { allocateToGoal, deleteTransaction, markOccurrence, saveTransaction, updateSettings } from './operations'
import type { AppData } from './types'
import { validateAppData } from '../storage/backup'
import { baseData, bill, ctx, goal, income, NOW, TODAY, tx } from '../test/fixtures'

function ok<T>(r: { ok: true; data: AppData; value: T } | { ok: false; issues: unknown[] }) {
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r
}
/** Simula el guardado: aplica la operación y registra el historial (como AppStore.commit). */
const commit = (prev: AppData, next: AppData, meta = {}) => recordHistory(prev, next, NOW, meta)

describe('historial: qué se registra', () => {
  it('crear, editar y eliminar: valores anteriores y nuevos, con los registros vinculados', () => {
    let d = baseData()
    const created = ok(saveTransaction(d, tx({ id: 'a', amountMinor: 1000, note: 'Café' }), ctx)).data
    d = commit(d, created)
    expect(d.history).toHaveLength(1)
    expect(d.history[0]!.changes).toEqual([{ collection: 'transactions', id: 'a', before: null, after: expect.objectContaining({ amountMinor: 1000 }) }])

    const edited = ok(saveTransaction(d, { ...d.transactions[0]!, amountMinor: 1250 }, ctx)).data
    d = commit(d, edited)
    expect(d.history[1]!.changes[0]).toMatchObject({ before: { amountMinor: 1000 }, after: { amountMinor: 1250 } })

    const deleted = ok(deleteTransaction(d, 'a', ctx)).data
    d = commit(d, deleted)
    // Eliminar = sale de movimientos y entra en la papelera: ambas cosas en la misma entrada.
    expect(d.history[2]!.changes.map((c) => [c.collection, c.before === null, c.after === null])).toEqual([
      ['transactions', false, true],
      ['trash', true, false],
    ])
  })

  it('cambios no financieros (idioma) no se registran; zona horaria sí', () => {
    const d = baseData()
    const lang = ok(updateSettings(d, { language: 'en' }, ctx)).data
    expect(diffForHistory(d, lang)).toEqual([])
    const tz = ok(updateSettings(d, { timeZone: 'Asia/Tokyo' }, ctx)).data
    expect(diffForHistory(d, tz)).toEqual([{ collection: 'settings', id: 'settings', before: expect.objectContaining({ timeZone: 'America/Toronto' }), after: expect.objectContaining({ timeZone: 'Asia/Tokyo' }) }])
  })

  it('sin cambios no hay entrada; importar una copia es un corte sin detalle', () => {
    const d = baseData()
    expect(commit(d, d).history).toEqual([])
    const replaced = commit(d, baseData({ transactions: [tx({ id: 'x' })] }), { source: 'replace' })
    expect(replaced.history).toEqual([expect.objectContaining({ source: 'replace', changes: [] })])
  })

  it('límite de entradas: se descarta la más antigua y se actualiza desde cuándo hay historial', () => {
    let d = baseData()
    d = { ...d, history: Array.from({ length: HISTORY_MAX_ENTRIES }, (_, i) => ({ id: `h${i}`, at: `2026-09-${String(1 + (i % 27)).padStart(2, '0')}T00:00:00.000Z`, source: 'app' as const, changes: [] })) }
    const next = commit(d, ok(saveTransaction(d, tx({ id: 'n' }), ctx)).data)
    expect(next.history).toHaveLength(HISTORY_MAX_ENTRIES)
    expect(next.history[0]!.id).toBe('h1')
    expect(next.historyStartedAt).toBe(next.history[0]!.at)
  })

  it('el historial viaja en la copia y se valida', () => {
    const d = commit(baseData(), ok(saveTransaction(baseData(), tx({ id: 'a' }), ctx)).data)
    const r = validateAppData(JSON.parse(JSON.stringify(d)))
    expect(r.ok && r.data.history).toEqual(JSON.parse(JSON.stringify(d.history)))
  })
})

describe('historial: revertir', () => {
  const twoSteps = () => {
    let d = baseData()
    d = commit(d, ok(saveTransaction(d, tx({ id: 'a', amountMinor: 1000 }), ctx)).data)
    d = commit(d, ok(saveTransaction(d, { ...d.transactions[0]!, amountMinor: 1500 }, ctx)).data)
    return d
  }

  it('revertir la última edición devuelve el valor anterior y queda registrado como reversión', () => {
    const d = twoSteps()
    const last = d.history[1]!
    expect(canRevert(d, last)).toBe('ok')
    const reverted = commit(d, ok(revertEntry(d, last.id, ctx)).data, { source: 'revert', revertOf: last.id })
    expect(reverted.transactions[0]!.amountMinor).toBe(1000)
    expect(reverted.history.at(-1)).toMatchObject({ source: 'revert', revertOf: last.id })
    expect(canRevert(reverted, last)).toBe('alreadyReverted')
    expect(validateAppData(JSON.parse(JSON.stringify(reverted))).ok).toBe(true)
  })

  it('no se puede revertir la creación si después se editó: se explica el conflicto y no se toca nada', () => {
    const d = twoSteps()
    const creation = d.history[0]!
    expect(canRevert(d, creation)).toBe('conflict')
    expect(revertConflicts(d, creation).map((c) => c.id)).toEqual(['a'])
    expect(revertEntry(d, creation.id, ctx)).toMatchObject({ ok: false, issues: [{ code: 'revertConflict', params: { count: 1 } }] })
  })

  it('revertir una eliminación restaura el movimiento y lo saca de la papelera (como «Restaurar»)', () => {
    let d = twoSteps()
    const before = computeBudget(d, TODAY).availableMinor
    d = commit(d, ok(deleteTransaction(d, 'a', ctx)).data)
    const del = d.history.at(-1)!
    d = commit(d, ok(revertEntry(d, del.id, ctx)).data, { source: 'revert', revertOf: del.id })
    expect(d.trash).toEqual([])
    expect(computeBudget(d, TODAY).availableMinor).toBe(before)
    expect(validateAppData(JSON.parse(JSON.stringify(d))).ok).toBe(true)
  })

  it('un corte (copia importada) no se puede revertir', () => {
    const d = commit(baseData(), baseData(), { source: 'replace' })
    expect(canRevert(d, d.history[0]!)).toBe('notRevertible')
  })

  it('revertir un pago del calendario vuelve a reservarlo; revertir un apartado lo libera', () => {
    let d = baseData({ schedules: [income('2026-10-05', 90000), bill('2026-10-01', 5000, { id: 'luz' })], goals: [goal({ id: 'g' })] })
    const start = computeBudget(d, TODAY).availableMinor // 1000 − 50 = 950
    d = commit(d, ok(markOccurrence(d, { scheduleId: 'luz', occurrenceDate: '2026-10-01', amountMinor: 5000, date: TODAY }, ctx)).data)
    d = commit(d, ok(allocateToGoal(d, { goalId: 'g', amountMinor: 10000 }, ctx)).data)
    expect(computeBudget(d, TODAY).availableMinor).toBe(start - 10000)
    const alloc = d.history.at(-1)!
    d = commit(d, ok(revertEntry(d, alloc.id, ctx)).data, { source: 'revert', revertOf: alloc.id })
    expect(computeBudget(d, TODAY).availableMinor).toBe(start)
    const pay = d.history[0]!
    d = commit(d, ok(revertEntry(d, pay.id, ctx)).data, { source: 'revert', revertOf: pay.id })
    expect(d.transactions).toEqual([])
    expect(computeBudget(d, TODAY).availableMinor).toBe(start)
  })
})

describe('historial: reconstruir un estado anterior', () => {
  it('deshacer en orden inverso todas las entradas desde un punto devuelve el estado de entonces', () => {
    let d = baseData()
    const s0 = d
    d = commit(d, ok(saveTransaction(d, tx({ id: 'a', amountMinor: 1000 }), ctx)).data)
    const s1 = d
    d = commit(d, ok(saveTransaction(d, { ...d.transactions[0]!, amountMinor: 1500 }, ctx)).data)
    d = commit(d, ok(saveTransaction(d, tx({ id: 'b', amountMinor: 300 }), ctx)).data)
    expect(stateBefore(d, 0)!.transactions).toEqual(s0.transactions)
    expect(stateBefore(d, 1)!.transactions).toEqual(s1.transactions)
    // Con un corte en medio no se puede reconstruir.
    const withCut = commit(d, d, { source: 'replace' })
    expect(stateBefore(withCut, 0)).toBeNull()
  })
})

describe('historial: aplicar en bloque', () => {
  it('equivale a aplicar los cambios uno a uno (crear, editar, borrar y repetir el mismo registro)', () => {
    let seed = 7
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let round = 0; round < 50; round++) {
      const start = baseData({ transactions: Array.from({ length: 8 }, (_, i) => tx({ id: `t${i}`, amountMinor: 100 + i })) })
      const values = Array.from({ length: 12 }, () => {
        const id = `t${Math.floor(rand() * 12)}`
        const value = rand() < 0.3 ? null : tx({ id, amountMinor: Math.floor(rand() * 1000) + 1 })
        return { collection: 'transactions' as const, id, value }
      })
      let sequential = start
      for (const v of values) sequential = setValue(sequential, v.collection, v.id, v.value)
      const batch = setValues(start, values)
      const byId = (d: AppData) => Object.fromEntries(d.transactions.map((t) => [t.id, t.amountMinor]))
      expect(byId(batch)).toEqual(byId(sequential))
    }
  })
})

describe('historial de un registro (etapa 2)', () => {
  it('lista creado, cambios por campo y eliminación, lo más reciente primero, solo con lo que vio', async () => {
    const { historyOfRecord, recordHistory } = await import('./history')
    const { saveTransaction, trashTransactions } = await import('./operations')
    const { baseData, ctx, TODAY } = await import('../test/fixtures')
    const d0 = baseData()
    const c1 = saveTransaction(d0, { id: 'x', kind: 'expense', status: 'realized', amountMinor: 1000, date: TODAY, accountId: 'main', categoryId: 'groceries' }, ctx)
    expect(c1.ok).toBe(true)
    if (!c1.ok) return
    const d1 = recordHistory(d0, c1.data, '2026-09-28T16:00:00.000Z')
    const c2 = saveTransaction(d1, { id: 'x', kind: 'expense', status: 'realized', amountMinor: 1200, date: TODAY, accountId: 'main', categoryId: 'dining' }, ctx)
    expect(c2.ok).toBe(true)
    if (!c2.ok) return
    const d2 = recordHistory(d1, c2.data, '2026-09-28T16:05:00.000Z')
    const c3 = trashTransactions(d2, ['x'], ctx)
    expect(c3.ok).toBe(true)
    if (!c3.ok) return
    const d3 = recordHistory(d2, c3.data, '2026-09-28T16:10:00.000Z')
    const items = historyOfRecord(d3, 'transactions', 'x')
    expect(items.map((i) => [i.kind, i.fields, i.at])).toEqual([
      ['deleted', [], '2026-09-28T16:10:00.000Z'],
      ['updated', ['amountMinor', 'categoryId'], '2026-09-28T16:05:00.000Z'],
      ['created', [], '2026-09-28T16:00:00.000Z'],
    ])
    expect(historyOfRecord(d3, 'transactions', 'other')).toEqual([])
    // Sin historial previo no se inventa nada: un registro que ya existía antes no tiene «creado».
    expect(historyOfRecord(baseData({ transactions: c1.data.transactions }), 'transactions', 'x')).toEqual([])
  })
})
