import { describe, expect, it } from 'vitest'
import { goalPace } from './goalChart'
import { markOccurrence } from './operations'
import { closeDuePlans, planBaseMinor, planComparison, planUpcoming, savePlan } from './plans'
import { projectBalance } from './projection'
import { linkSettlement, unlinkedSettlements } from './reconcileSchedules'
import { MIGRATIONS } from '../storage/migrations'
import { baseData, bill, ctx, goal, tx, TODAY } from '../test/fixtures'

/** Etapa 3: flujo de caja simulado, presupuestos con arrastre/compromisos/comparación, conciliación y ritmo de metas (FORMULAS §37). */

describe('planes: arrastre, compromisos y comparación con el ciclo anterior', () => {
  const plan = (over: Record<string, unknown> = {}) => ({ id: 'p1', name: 'Comida', categoryIds: ['dining'], amountMinor: 30000, periodType: 'month' as const, recurring: true, alertAt80: true, alertAt100: true, ...over })

  it('con arrastre, el ciclo nuevo suma lo no gastado (o resta lo excedido, nunca bajo 0); sin arrastre, el límite base', () => {
    const d0 = baseData({ transactions: [tx({ id: 't1', kind: 'expense', categoryId: 'dining', amountMinor: 12000, date: '2026-08-10' })] })
    const created = savePlan(d0, plan({ rollover: 'carry' }), { today: '2026-08-05', now: '2026-08-05T12:00:00.000Z' })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value).toMatchObject({ rollover: 'carry', startDate: '2026-08-01', endDate: '2026-08-31' })
    const closed = closeDuePlans(created.data, ctx)
    expect(closed.ok).toBe(true)
    if (!closed.ok) return
    const renewed = closed.value.renewed[0]!
    expect(renewed).toMatchObject({ amountMinor: 48000, carriedMinor: 18000, startDate: '2026-09-01', endDate: '2026-09-30', rollover: 'carry' })
    expect(planBaseMinor(renewed)).toBe(30000)
    // Exceso mayor que el límite: queda en 0 y sigue siendo válido.
    const over = baseData({ transactions: [tx({ id: 't2', kind: 'expense', categoryId: 'dining', amountMinor: 70000, date: '2026-08-10' })] })
    const c2 = savePlan(over, plan({ id: 'p2', rollover: 'carry' }), { today: '2026-08-05', now: '2026-08-05T12:00:00.000Z' })
    expect(c2.ok).toBe(true)
    if (!c2.ok) return
    const closed2 = closeDuePlans(c2.data, ctx)
    expect(closed2.ok && closed2.value.renewed[0]).toMatchObject({ amountMinor: 0, carriedMinor: -30000 })
    // Sin arrastre: el límite vuelve a la base.
    const c3 = savePlan(d0, plan({ id: 'p3' }), { today: '2026-08-05', now: '2026-08-05T12:00:00.000Z' })
    expect(c3.ok).toBe(true)
    if (!c3.ok) return
    const closed3 = closeDuePlans(c3.data, ctx)
    expect(closed3.ok && closed3.value.renewed[0]).toMatchObject({ amountMinor: 30000, rollover: 'none' })
    expect(closed3.ok && closed3.value.renewed[0]!.carriedMinor).toBeUndefined()
  })

  it('editar conserva lo que este ciclo recibió del arrastre', () => {
    const d = baseData({ plans: [{ ...plan(), kind: 'limit', currency: 'CAD', startDate: '2026-09-01', endDate: '2026-09-30', status: 'active', rollover: 'carry', carriedMinor: 5000, amountMinor: 35000, createdAt: ctx.now, updatedAt: ctx.now }] })
    const r = savePlan(d, plan({ amountMinor: 35000, rollover: 'none' }), ctx)
    expect(r.ok && r.value).toMatchObject({ rollover: 'none', carriedMinor: 5000 })
  })

  it('lo programado del ciclo es compromiso, no gasto; y la comparación usa el mismo punto del ciclo anterior', () => {
    const d0 = baseData({
      schedules: [bill('2026-09-30', 8000, { id: 's', name: 'Cena', categoryId: 'dining' })],
      transactions: [
        tx({ id: 'a', kind: 'expense', categoryId: 'dining', amountMinor: 10000, date: '2026-08-05' }),
        tx({ id: 'b', kind: 'expense', categoryId: 'dining', amountMinor: 20000, date: '2026-08-27' }),
        tx({ id: 'c', kind: 'expense', categoryId: 'dining', amountMinor: 15000, date: '2026-09-10' }),
      ],
    })
    const created = savePlan(d0, plan(), ctx)
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const d = created.data
    const p = d.plans[0]!
    const up = planUpcoming(d, p, { start: '2026-09-01', end: '2026-09-30' }, TODAY)
    expect(up.items.map((i) => i.name)).toEqual(['Cena'])
    expect(up.totalMinor).toBe(8000)
    expect(up.remainingAfterMinor).toBe(30000 - 15000 - 8000)
    const cmp = planComparison(d, p, TODAY)!
    expect(cmp).toMatchObject({ previous: { start: '2026-08-01', end: '2026-08-31' }, equivalentDate: '2026-08-28', currentToDateMinor: 15000, previousToDateMinor: 30000, previousTotalMinor: 30000, deltaMinor: -15000 })
    // Sin movimientos anteriores al ciclo no hay comparación (nunca se asume 0).
    const fresh = savePlan(baseData({ transactions: [tx({ id: 'c', kind: 'expense', categoryId: 'dining', amountMinor: 15000, date: '2026-09-10' })] }), plan(), ctx)
    expect(fresh.ok && planComparison(fresh.data, fresh.data.plans[0]!, TODAY)).toBeNull()
  })
})

describe('proyección con simulaciones', () => {
  it('una salida simulada en una fecha baja el saldo desde ese día y puede adelantar el primer día en negativo', () => {
    const d = baseData({ schedules: [bill('2026-10-05', 90000, { id: 'rent', name: 'Renta' })] })
    const base = projectBalance(d, TODAY, { days: 14 })
    expect(base.days[0]!.endMinor).toBe(100000)
    expect(base.firstNegativeDate).toBeNull()
    const sim = projectBalance(d, TODAY, { days: 14, extraOutflows: [{ date: '2026-10-02', amountMinor: 20000 }, { date: '2026-09-01', amountMinor: 500 }] })
    expect(sim.days.find((x) => x.date === '2026-09-28')!.endMinor).toBe(99500)
    expect(sim.days.find((x) => x.date === '2026-10-02')!.endMinor).toBe(79500)
    expect(sim.firstNegativeDate).toBe('2026-10-05')
    // Los datos no cambian: simular no guarda nada.
    expect(d.transactions).toEqual([])
  })
})

describe('conciliación de programados', () => {
  it('propone el movimiento sin vincular que coincide con una ocurrencia abierta y vincularlo deja de reservarla', () => {
    const d = baseData({
      schedules: [bill('2026-09-27', 4280, { id: 'power', name: 'Luz' })],
      transactions: [
        tx({ id: 'paid', kind: 'expense', categoryId: 'utilities', amountMinor: 4280, date: '2026-09-26' }),
        tx({ id: 'other', kind: 'expense', categoryId: 'utilities', amountMinor: 4280, date: '2026-09-01' }),
      ],
    })
    const found = unlinkedSettlements(d, TODAY)
    expect(found.map((f) => [f.item.sourceId, f.transaction.id, f.distanceDays])).toEqual([['power', 'paid', 1]])
    const linked = linkSettlement(d, 'paid', 'power', '2026-09-27', ctx)
    expect(linked.ok).toBe(true)
    if (!linked.ok) return
    expect(linked.data.transactions.find((t) => t.id === 'paid')).toMatchObject({ scheduleId: 'power', occurrenceDate: '2026-09-27' })
    expect(unlinkedSettlements(linked.data, TODAY)).toEqual([])
    expect(linkSettlement(linked.data, 'paid', 'power', '2026-09-27', ctx)).toMatchObject({ ok: true, unchanged: true })
    // Una ocurrencia ya liquidada no acepta un segundo vínculo.
    const again = linkSettlement(linked.data, 'other', 'power', '2026-09-27', ctx)
    expect(again.ok).toBe(false)
  })

  it('no propone nada si el importe o la fecha no cuadran, ni usa el mismo movimiento dos veces', () => {
    const d = baseData({
      schedules: [bill('2026-09-27', 4280, { id: 'a', name: 'A' }), bill('2026-09-29', 4280, { id: 'b', name: 'B' })],
      transactions: [tx({ id: 'x', kind: 'expense', categoryId: 'utilities', amountMinor: 4280, date: '2026-09-28' }), tx({ id: 'y', kind: 'expense', amountMinor: 4281, date: '2026-09-28' })],
    })
    const found = unlinkedSettlements(d, TODAY)
    expect(found.length).toBe(1)
    expect(found[0]!.transaction.id).toBe('x')
    const marked = markOccurrence(d, { scheduleId: 'a', occurrenceDate: '2026-09-27', amountMinor: 4280, date: '2026-09-27' }, ctx)
    expect(marked.ok && unlinkedSettlements(marked.data, TODAY).map((f) => f.item.sourceId)).toEqual(['b'])
  })
})

describe('ritmo de una meta', () => {
  it('compara lo apartado con la recta ideal y lo dice con cifras', () => {
    const g = goal({ targetMinor: 100000, targetDate: '2026-12-31', createdAt: '2026-09-01T00:00:00.000Z', allocations: [{ id: 'a1', amountMinor: 10000, date: '2026-09-10', createdAt: '2026-09-10T00:00:00.000Z' }] })
    // Inicio 1-sep, fin 31-dic: 121 días; hoy 28-sep son 27 → ideal ⌊100000 × 27 / 121⌋ = 22314.
    expect(goalPace(g, TODAY)).toEqual({ status: 'behind', idealToDateMinor: 22314, savedMinor: 10000, deltaMinor: -12314 })
    const ahead = goal({ ...g, allocations: [{ id: 'a1', amountMinor: 40000, date: '2026-09-10', createdAt: '2026-09-10T00:00:00.000Z' }] })
    expect(goalPace(ahead, TODAY).status).toBe('ahead')
    expect(goalPace(goal({ targetMinor: 100000, targetDate: undefined }), TODAY).status).toBe('noDate')
    const done = goal({ ...g, allocations: [{ id: 'a1', amountMinor: 100000, date: '2026-09-10', createdAt: '2026-09-10T00:00:00.000Z' }] })
    expect(goalPace(done, TODAY).status).toBe('complete')
  })
})

describe('migración v11 → v12', () => {
  it('rellena `rollover: none` en los planes y nada más', () => {
    const out = MIGRATIONS[11]!({ schemaVersion: 11, plans: [{ id: 'p', amountMinor: 100 }, { id: 'q', rollover: 'carry' }, null], transactions: [] })
    expect(out).toEqual({ schemaVersion: 12, plans: [{ id: 'p', amountMinor: 100, rollover: 'none' }, { id: 'q', rollover: 'carry' }, null], transactions: [] })
    expect(MIGRATIONS[11]!({ schemaVersion: 11 })).toEqual({ schemaVersion: 12 })
  })
})
