import { describe, expect, it } from 'vitest'
import type { ScheduleDraft } from './operations'
import { openItemsUntil } from './planItems'
import { recurringCosts } from './recurringCosts'
import { defaultSplitDate, saveScheduleFrom } from './scheduleFrom'
import type { AppData, Schedule } from './types'
import { baseData, bill, ctx, deepFreeze, goal, tx } from '../test/fixtures'

/** Renta de 650 cada día 1 desde junio; junio–septiembre pagados. Hoy = 2026-09-28. */
const rent = bill('2026-06-01', 65000, { id: 'rent', name: 'Renta', frequency: 'monthly', categoryId: 'housing' })
const paid = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'].map((d, i) => tx({ id: `p${i}`, date: d, amountMinor: 65000, categoryId: 'housing', scheduleId: 'rent', occurrenceDate: d }))
const data = (over: Partial<AppData> = {}) => deepFreeze(baseData({ schedules: [rent], transactions: paid, ...over }))

/** Lo que mandaría el formulario: los valores del programado con lo que cambió. */
const draft = (s: Schedule, over: Partial<ScheduleDraft>): ScheduleDraft => {
  const { createdAt: _c, updatedAt: _u, currency: _cur, ...rest } = s
  return { ...rest, id: 'rent-2', ...over }
}
const later = { today: '2026-10-16', now: '2026-10-16T16:00:00.000Z' }

describe('cambiar un programado desde una fecha', () => {
  it('lo anterior queda como estaba; desde la fecha, el importe nuevo (y nada se cuenta dos veces)', () => {
    const d = data()
    expect(defaultSplitDate(d, rent, ctx.today)).toBe('2026-10-01')
    const r = saveScheduleFrom(d, 'rent', draft(rent, { startDate: '2026-10-01', amountMinor: 70000 }), ctx)
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.value.ended).toMatchObject({ id: 'rent', amountMinor: 65000, startDate: '2026-06-01', endDate: '2026-09-30' })
    expect(r.value.next).toMatchObject({ id: 'rent-2', amountMinor: 70000, startDate: '2026-10-01', frequency: 'monthly', createdAt: ctx.now })
    // Los pagos registrados no se tocan y siguen vinculados al programado de siempre.
    expect(r.data.transactions).toBe(d.transactions)
    const open = openItemsUntil(r.data, ctx.today, '2026-12-31').map((i) => [i.sourceId, i.date, i.amountMinor])
    expect(open).toEqual([
      ['rent-2', '2026-10-01', 70000],
      ['rent-2', '2026-11-01', 70000],
      ['rent-2', '2026-12-01', 70000],
    ])
    // El coste anual es solo el de la serie nueva: 12 × 700.
    expect(recurringCosts(r.data, ctx.today).totalMinor).toBe(12 * 70000)
  })

  it('una fecha vencida sin marcar ANTES de la fecha elegida conserva su importe; elegir esa fecha la cambia (y su aplazamiento la sigue)', () => {
    const d = data({ inbox: { snoozed: [{ id: 'due:schedule:rent:2026-10-01', until: '2026-10-20', at: later.now }], dismissed: [] } })
    const fromNov = saveScheduleFrom(d, 'rent', draft(rent, { startDate: '2026-11-01', amountMinor: 70000 }), later)
    if (!fromNov.ok) throw new Error('fromNov')
    expect(openItemsUntil(fromNov.data, later.today, '2026-11-30').map((i) => [i.sourceId, i.date, i.state, i.amountMinor])).toEqual([
      ['rent', '2026-10-01', 'overdue', 65000],
      ['rent-2', '2026-11-01', 'pending', 70000],
    ])
    expect(fromNov.data.inbox.snoozed.map((s) => s.id)).toEqual(['due:schedule:rent:2026-10-01'])

    const fromOct = saveScheduleFrom(d, 'rent', draft(rent, { startDate: '2026-10-01', amountMinor: 70000 }), later)
    if (!fromOct.ok) throw new Error('fromOct')
    expect(openItemsUntil(fromOct.data, later.today, '2026-10-31').map((i) => [i.sourceId, i.date, i.state, i.amountMinor])).toEqual([['rent-2', '2026-10-01', 'overdue', 70000]])
    expect(fromOct.data.inbox.snoozed.map((s) => s.id)).toEqual(['due:schedule:rent-2:2026-10-01'])
  })

  it('no deja pagos registrados fuera de su programado: la fecha tiene que ser posterior al último', () => {
    // Octubre ya se pagó (por adelantado): desde el 1-oct no; se propone noviembre.
    const early = data({ transactions: [...paid, tx({ id: 'oct', date: '2026-09-27', amountMinor: 65000, scheduleId: 'rent', occurrenceDate: '2026-10-01' })] })
    const r = saveScheduleFrom(early, 'rent', draft(rent, { startDate: '2026-10-01', amountMinor: 70000 }), ctx)
    expect(r.ok ? [] : r.issues).toEqual([{ path: 'startDate', code: 'splitSettledAfter', params: { date: '2026-10-01' } }])
    expect(defaultSplitDate(early, rent, ctx.today)).toBe('2026-11-01')
    // Un cobro parcial también es un pago registrado.
    const partial = data({ transactions: [...paid, tx({ id: 'part', date: '2026-09-27', amountMinor: 30000, scheduleId: 'rent', occurrenceDate: '2026-10-01', partialSettlement: true })] })
    const r2 = saveScheduleFrom(partial, 'rent', draft(rent, { startDate: '2026-10-01' }), ctx)
    expect(r2.ok ? [] : r2.issues.map((i) => i.code)).toEqual(['splitSettledAfter'])
  })

  it('rechaza lo que no tiene sentido sin cambiar nada', () => {
    const d = data()
    const codes = (s: Schedule, startDate: string) => {
      const r = saveScheduleFrom(baseData({ ...d, schedules: [s] }), s.id, draft(s, { startDate }), ctx)
      return r.ok ? 'ok' : r.issues.map((i) => [i.code, i.params?.date ?? null])
    }
    expect(codes(rent, '2026-06-01')).toEqual([['splitNotAfterStart', '2026-06-01']])
    expect(codes(rent, '2026-05-01')).toEqual([['splitNotAfterStart', '2026-06-01']])
    expect(codes({ ...rent, endDate: '2026-12-31' }, '2027-01-01')).toEqual([['splitAfterEnd', '2026-12-31']])
    expect(codes({ ...rent, frequency: 'once' }, '2026-10-01')).toEqual([['splitNotRecurring', null]])
    expect(defaultSplitDate(d, { ...rent, frequency: 'once' }, ctx.today)).toBeNull()
    // Lo del formulario se valida igual que al editar (nombre vacío → el mismo error, en el mismo campo).
    const bad = saveScheduleFrom(d, 'rent', draft(rent, { startDate: '2026-10-01', name: '  ' }), ctx)
    expect(bad.ok ? [] : bad.issues.map((i) => i.path)).toEqual(['name'])
  })

  it('un gasto planificado vinculado a una fecha posterior pasa al nuevo; si esa fecha dejaría de existir, no se parte', () => {
    const plan = goal({ id: 'g', name: 'Renta de noviembre', kind: 'expense', targetMinor: 65000, plan: { link: { scheduleId: 'rent', occurrenceDate: '2026-11-01' }, history: [] } })
    const old = goal({ id: 'old', name: 'Renta de agosto', kind: 'expense', targetMinor: 65000, plan: { link: { scheduleId: 'rent', occurrenceDate: '2026-08-01' }, history: [] } })
    const d = data({ goals: [plan, old] })
    const same = saveScheduleFrom(d, 'rent', draft(rent, { startDate: '2026-10-01', amountMinor: 70000 }), ctx)
    if (!same.ok) throw new Error('same')
    expect(same.data.goals.map((g) => [g.id, g.plan?.link?.scheduleId])).toEqual([
      ['g', 'rent-2'],
      ['old', 'rent'],
    ])
    // Desde el 5-oct, cada día 5: el 1-nov ya no existiría.
    const moved = saveScheduleFrom(d, 'rent', draft(rent, { startDate: '2026-10-05' }), ctx)
    expect(moved.ok ? [] : moved.issues).toEqual([{ path: 'startDate', code: 'splitLinkedGoal', params: { name: 'Renta de noviembre', date: '2026-11-01' } }])
  })

  it('plantillas, escenarios y omitidas siguen a la serie; guardar dos veces no crea un tercero', () => {
    const d = data({
      schedules: [{ ...rent, skippedDates: ['2026-08-01', '2026-12-01'] }],
      templates: [{ id: 't', name: 'Quincena', kind: 'distribution', lines: [{ target: { kind: 'payment', scheduleId: 'rent' }, amount: { mode: 'fixed', amountMinor: 65000 } }], createdAt: ctx.now, updatedAt: ctx.now }],
      scenarios: [{ id: 'sc', name: 'Si sube', changes: [{ type: 'scheduleAmount', scheduleId: 'rent', newAmountMinor: 72000 }], baseFingerprint: 'x', createdAt: ctx.now, updatedAt: ctx.now }],
    })
    const r = saveScheduleFrom(d, 'rent', draft(d.schedules[0]!, { startDate: '2026-10-01', amountMinor: 70000 }), ctx)
    if (!r.ok) throw new Error('split')
    expect(r.value.ended.skippedDates).toEqual(['2026-08-01'])
    expect(r.value.next.skippedDates).toEqual(['2026-12-01'])
    const tpl = r.data.templates[0]!
    expect(tpl.kind === 'distribution' && tpl.lines[0]!.target).toEqual({ kind: 'payment', scheduleId: 'rent-2' })
    expect(r.data.scenarios[0]!.changes[0]).toMatchObject({ scheduleId: 'rent-2' })

    const again = saveScheduleFrom(r.data, 'rent', draft(d.schedules[0]!, { startDate: '2026-10-01', amountMinor: 71000 }), ctx)
    if (!again.ok) throw new Error('again')
    expect(again.data.schedules.map((s) => [s.id, s.amountMinor, s.endDate ?? null])).toEqual([
      ['rent', 65000, '2026-09-30'],
      ['rent-2', 71000, null],
    ])
  })
})
