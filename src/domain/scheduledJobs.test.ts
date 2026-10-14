import { describe, expect, it } from 'vitest'
import { autoConfirmDue, overstatedAutoConfirms, setSchedulePaused } from './scheduledJobs'
import { dueNotices, isQuietHour } from './notifications'
import { markOccurrence } from './operations'
import { savePlan } from './plans'
import { computeBudget } from './budget'
import { baseData, bill, ctx, income, tx } from '../test/fixtures'
import { DEFAULT_NOTIFICATIONS } from './defaults'
import { validateAppData } from '../storage/backup'

describe('confirmación automática y pausa de programados', () => {
  it('registra las ocurrencias de hoy y de los últimos 7 días de los programados con autoConfirm; es idempotente', () => {
    const data = baseData({
      schedules: [
        bill('2026-09-26', 5000, { id: 'auto', name: 'Gimnasio', frequency: 'weekly', autoConfirm: true }),
        bill('2026-09-27', 9900, { id: 'manual', name: 'Luz' }),
        bill('2026-09-01', 1000, { id: 'old', name: 'Vieja', frequency: 'daily', autoConfirm: true }),
      ],
    })
    const r = autoConfirmDue(data, ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // «Gimnasio» 26-sep (dentro de la ventana) y «Vieja» del 21 al 28 (8 días); nada de «Luz» ni de antes del 21.
    const gym = r.value.confirmed.filter((t) => t.scheduleId === 'auto')
    const old = r.value.confirmed.filter((t) => t.scheduleId === 'old')
    expect(gym.map((t) => t.occurrenceDate)).toEqual(['2026-09-26'])
    expect(old.map((t) => t.occurrenceDate)).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28'])
    expect(r.value.confirmed.every((t) => t.status === 'realized' && t.source === 'scheduled')).toBe(true)
    expect(validateAppData(r.data).ok).toBe(true)
    // Segunda pasada: nada nuevo; «Luz» sigue vencida.
    const again = autoConfirmDue(r.data, ctx)
    expect(again).toMatchObject({ ok: true, unchanged: true })
    // «Luz» sigue vencida; lo anterior a la ventana de «Vieja» queda vencido (no se registra); de «Gimnasio» nada.
    const overdue = computeBudget(r.data, ctx.today).overdueBills
    expect(overdue.some((i) => i.sourceId === 'manual')).toBe(true)
    expect(overdue.filter((i) => i.sourceId === 'old').every((i) => i.date < '2026-09-21')).toBe(true)
    expect(overdue.filter((i) => i.sourceId === 'old').length).toBe(20)
    expect(overdue.some((i) => i.sourceId === 'auto')).toBe(false)
  })

  it('una ocurrencia omitida o ya liquidada no se registra dos veces', () => {
    const data = baseData({
      schedules: [bill('2026-09-27', 5000, { id: 'a', frequency: 'daily', autoConfirm: true, skippedDates: ['2026-09-27'] })],
      transactions: [tx({ id: 'done', scheduleId: 'a', occurrenceDate: '2026-09-28', amountMinor: 5000 })],
    })
    const r = autoConfirmDue(data, ctx)
    expect(r).toMatchObject({ ok: true, unchanged: true })
  })

  it('en pausa no genera ocurrencias ni reserva; al reanudar vuelve', () => {
    const data = baseData({ schedules: [bill('2026-10-01', 5000, { id: 'p' }), income('2026-10-09', 80000)] })
    expect(computeBudget(data, ctx.today).reservedTotalMinor).toBe(5000)
    const paused = setSchedulePaused(data, 'p', true, ctx)
    expect(paused.ok).toBe(true)
    if (!paused.ok) return
    expect(computeBudget(paused.data, ctx.today).reservedTotalMinor).toBe(0)
    expect(validateAppData(paused.data).ok).toBe(true)
    const back = setSchedulePaused(paused.data, 'p', false, ctx)
    expect(back.ok && computeBudget(back.data, ctx.today).reservedTotalMinor).toBe(5000)
    expect(setSchedulePaused(data, 'nope', true, ctx).ok).toBe(false)
  })
})

describe('notificaciones locales (reglas puras)', () => {
  const fmt = { amount: (m: number) => String(m), name: (i: { name: string }) => i.name }

  it('horas de silencio con rango que cruza medianoche', () => {
    expect(isQuietHour('23:00', '22:00', '08:00')).toBe(true)
    expect(isQuietHour('07:59', '22:00', '08:00')).toBe(true)
    expect(isQuietHour('08:00', '22:00', '08:00')).toBe(false)
    expect(isQuietHour('12:00', '22:00', '08:00')).toBe(false)
    expect(isQuietHour('12:00', '09:00', '17:00')).toBe(true)
    expect(isQuietHour('12:00', '12:00', '12:00')).toBe(false)
  })

  it('avisa de vencidos y de lo que vence hoy o mañana, recordatorio diario si no hay registros y resumen a su hora', () => {
    const data = baseData({ schedules: [bill('2026-09-27', 5000, { id: 'late', name: 'Luz' }), bill('2026-09-29', 1200, { id: 'tomorrow', name: 'Internet' }), bill('2026-10-05', 1, { id: 'far' })] })
    const settings = { ...DEFAULT_NOTIFICATIONS, scheduledAlerts: true, dailyReminder: true, dailyReminderTime: '20:00', dailySummary: true, dailySummaryTime: '21:00' }
    const morning = dueNotices(data, { today: ctx.today, now: '09:30', settings }, fmt)
    expect(morning.map((n) => n.kind)).toEqual(['scheduledOverdue', 'scheduledDue'])
    expect(morning[0]).toMatchObject({ params: { name: 'Luz', amount: '5000' }, href: '/plan/calendario' })
    expect(morning[1]!.titleKey).toBe('notify.dueTomorrow.title')
    const evening = dueNotices(data, { today: ctx.today, now: '21:30', settings }, fmt)
    expect(evening.map((n) => n.kind)).toEqual(['scheduledOverdue', 'scheduledDue', 'dailyReminder', 'dailySummary'])
    // Con un registro hoy no hay recordatorio; en horas de silencio no hay nada.
    const withTx = baseData({ ...data, transactions: [tx({ id: 't', date: ctx.today })] })
    expect(dueNotices(withTx, { today: ctx.today, now: '21:30', settings }, fmt).map((n) => n.kind)).not.toContain('dailyReminder')
    expect(dueNotices(data, { today: ctx.today, now: '23:00', settings: { ...settings, quietHours: true } }, fmt)).toEqual([])
    // Todo apagado: nada.
    expect(dueNotices(data, { today: ctx.today, now: '21:30', settings: DEFAULT_NOTIFICATIONS }, fmt)).toEqual([])
  })

  it('alertas de planes al 80 % y 100 % con clave por ciclo; respetan el ajuste y las horas de silencio', () => {
    const base = baseData({ transactions: [tx({ id: 'a', categoryId: 'dining', amountMinor: 17000 })] })
    const saved = savePlan(base, { id: 'p1', name: 'Comer fuera', categoryIds: ['dining'], amountMinor: 20000, periodType: 'month', recurring: true, alertAt80: true, alertAt100: true }, ctx)
    if (!saved.ok) throw new Error('plan')
    const settings = { ...DEFAULT_NOTIFICATIONS, planAlerts: true }
    const notices = dueNotices(saved.data, { today: ctx.today, now: '00:00', settings }, { ...fmt, planName: (p) => p.name })
    expect(notices).toMatchObject([{ key: 'plan80:p1:2026-09-01', kind: 'plan80', params: { name: 'Comer fuera', spent: '17000', limit: '20000', over: '0' }, href: '/plan/planes/p1' }])
    const over = baseData({ ...saved.data, transactions: [tx({ id: 'b', categoryId: 'dining', amountMinor: 25000 })] })
    expect(dueNotices(over, { today: ctx.today, now: '08:00', settings }, fmt)).toMatchObject([{ kind: 'plan100', params: { over: '5000' } }])
    expect(dueNotices(saved.data, { today: ctx.today, now: '08:00', settings: DEFAULT_NOTIFICATIONS }, fmt)).toEqual([])
    expect(dueNotices(saved.data, { today: ctx.today, now: '23:00', settings: { ...settings, quietHours: true } }, fmt)).toEqual([])
  })
})

describe('confirmación automática con cobros o pagos parciales (QA-02)', () => {
  const partialIncome = (overrides: Partial<Parameters<typeof income>[2]> = {}) =>
    baseData({ schedules: [income(ctx.today, 100000, { id: 'pay', name: 'Sueldo', autoConfirm: true, ...overrides })] })
  const total = (d: ReturnType<typeof baseData>) => d.transactions.reduce((sum, t) => sum + t.amountMinor, 0)

  it('ingreso 1000 con 400 a cuenta: añade solo los 600 que faltan, cierra la ocurrencia y una segunda pasada no añade nada', () => {
    const part = markOccurrence(partialIncome(), { scheduleId: 'pay', occurrenceDate: ctx.today, amountMinor: 40000, date: ctx.today, expectRemainder: true }, ctx)
    if (!part.ok) throw new Error('fixture')
    const auto = autoConfirmDue(part.data, ctx)
    expect(auto.ok).toBe(true)
    if (!auto.ok) return
    expect(auto.value.confirmed.map((t) => t.amountMinor)).toEqual([60000])
    expect(total(auto.data)).toBe(100000)
    expect(auto.data.transactions.filter((t) => t.scheduleId === 'pay' && !t.partialSettlement)).toHaveLength(1)
    expect(computeBudget(auto.data, ctx.today).incomeDueToday).toEqual([])
    expect(validateAppData(auto.data).ok).toBe(true)
    expect(autoConfirmDue(auto.data, ctx)).toMatchObject({ ok: true, unchanged: true })
    expect(total(auto.data)).toBe(100000)
  })

  it('activar la confirmación automática DESPUÉS del cobro parcial da el mismo resultado', () => {
    const manual = baseData({ schedules: [income(ctx.today, 100000, { id: 'pay', name: 'Sueldo' })] })
    const part = markOccurrence(manual, { scheduleId: 'pay', occurrenceDate: ctx.today, amountMinor: 40000, date: ctx.today, expectRemainder: true }, ctx)
    if (!part.ok) throw new Error('fixture')
    const enabled = { ...part.data, schedules: part.data.schedules.map((s) => ({ ...s, autoConfirm: true })) }
    const auto = autoConfirmDue(enabled, ctx)
    expect(auto.ok && total(auto.data)).toBe(100000)
  })

  it('un gasto con pago parcial también se completa solo por el resto', () => {
    const d = baseData({ schedules: [bill(ctx.today, 30000, { id: 'rent', name: 'Renta', autoConfirm: true }), income('2026-10-12', 100000)] })
    const part = markOccurrence(d, { scheduleId: 'rent', occurrenceDate: ctx.today, amountMinor: 10000, date: ctx.today, expectRemainder: true }, ctx)
    if (!part.ok) throw new Error('fixture')
    const auto = autoConfirmDue(part.data, ctx)
    expect(auto.ok && auto.value.confirmed.map((t) => t.amountMinor)).toEqual([20000])
    expect(auto.ok && computeBudget(auto.data, ctx.today).reservedTotalMinor).toBe(0)
    expect(auto.ok && computeBudget(auto.data, ctx.today).availableMinor).toBe(70000)
  })

  it('si los parciales ya cubren el importe, cierra la ocurrencia sin crear ningún movimiento', () => {
    // Un parcial editado a mano hasta el importe completo sigue marcado como parcial: la ocurrencia está «abierta por 0».
    const d = baseData({
      schedules: [income(ctx.today, 100000, { id: 'pay', name: 'Sueldo', autoConfirm: true })],
      transactions: [tx({ id: 'p1', kind: 'income', categoryId: 'salary', amountMinor: 100000, scheduleId: 'pay', occurrenceDate: ctx.today, partialSettlement: true })],
    })
    const auto = autoConfirmDue(d, ctx)
    expect(auto.ok).toBe(true)
    if (!auto.ok) return
    expect(auto.data.transactions).toHaveLength(1)
    expect(auto.data.transactions[0]).toMatchObject({ id: 'p1', amountMinor: 100000 })
    expect(auto.data.transactions[0]!.partialSettlement).toBeUndefined()
    expect(total(auto.data)).toBe(100000)
  })

  it('ingreso variable: el resto se calcula sobre el importe esperado', () => {
    const d = partialIncome({ amountMinor: 50000, range: { minMinor: 10000, extraMinor: 90000 } })
    const part = markOccurrence(d, { scheduleId: 'pay', occurrenceDate: ctx.today, amountMinor: 20000, date: ctx.today, expectRemainder: true }, ctx)
    if (!part.ok) throw new Error('fixture')
    const auto = autoConfirmDue(part.data, ctx)
    expect(auto.ok && auto.value.confirmed.map((t) => t.amountMinor)).toEqual([30000])
    expect(auto.ok && total(auto.data)).toBe(50000)
  })

  it('en pausa o con la ocurrencia omitida no registra nada, también con parciales previos', () => {
    const part = markOccurrence(partialIncome(), { scheduleId: 'pay', occurrenceDate: ctx.today, amountMinor: 40000, date: ctx.today, expectRemainder: true }, ctx)
    if (!part.ok) throw new Error('fixture')
    const paused = { ...part.data, schedules: part.data.schedules.map((s) => ({ ...s, paused: true })) }
    expect(autoConfirmDue(paused, ctx)).toMatchObject({ ok: true, unchanged: true })
    const skipped = { ...part.data, schedules: part.data.schedules.map((s) => ({ ...s, skippedDates: [ctx.today] })) }
    expect(autoConfirmDue(skipped, ctx)).toMatchObject({ ok: true, unchanged: true })
    expect(total(skipped)).toBe(40000)
  })

  it('detecta datos antiguos con el defecto (parcial + importe completo automático) y no marca liquidaciones correctas', () => {
    const schedule = income(ctx.today, 100000, { id: 'pay', name: 'Sueldo', autoConfirm: true })
    const partial = tx({ id: 'p', kind: 'income', categoryId: 'salary', amountMinor: 40000, scheduleId: 'pay', occurrenceDate: ctx.today, partialSettlement: true, date: '2026-09-27' })
    const wrongFinal = tx({ id: 'f', kind: 'income', categoryId: 'salary', amountMinor: 100000, scheduleId: 'pay', occurrenceDate: ctx.today, source: 'scheduled' })
    const bad = baseData({ schedules: [schedule], transactions: [partial, wrongFinal] })
    expect(overstatedAutoConfirms(bad)).toEqual([{ scheduleId: 'pay', occurrenceDate: ctx.today, finalTxId: 'f', partialTxIds: ['p'], excessMinor: 40000 }])
    // Corregido a mano (el resto) o liquidado a mano con el importe completo: nada que señalar.
    const fixed = baseData({ schedules: [schedule], transactions: [partial, { ...wrongFinal, amountMinor: 60000 }] })
    expect(overstatedAutoConfirms(fixed)).toEqual([])
    const manualFull = baseData({ schedules: [schedule], transactions: [partial, { ...wrongFinal, source: 'manual' }] })
    expect(overstatedAutoConfirms(manualFull)).toEqual([])
    expect(overstatedAutoConfirms(baseData({ schedules: [schedule], transactions: [wrongFinal] }))).toEqual([])
  })
})

describe('terminar un programado y su ficha (etapa 2)', () => {
  it('terminar conserva lo pagado y quita lo futuro; la ficha resume próximas, pagadas y vencidas', async () => {
    const { endSchedule, scheduleSummary } = await import('./scheduledJobs')
    const { markOccurrence } = await import('./operations')
    const { planItems } = await import('./planItems')
    const { baseData, bill, ctx, TODAY } = await import('../test/fixtures')
    const d0 = baseData({ schedules: [bill('2026-09-01', 10000, { id: 's', name: 'Luz', frequency: 'monthly' })] })
    const paid = markOccurrence(d0, { scheduleId: 's', occurrenceDate: '2026-09-01', amountMinor: 10000, date: '2026-09-01', accountId: 'main' }, ctx)
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    const before = scheduleSummary(paid.data, 's', TODAY)!
    expect(before.paid).toMatchObject([{ occurrenceDate: '2026-09-01', amountMinor: 10000, partial: false }])
    expect(before.paidCount).toBe(1)
    expect(before.next).toEqual(['2026-10-01', '2026-11-01', '2026-12-01'])
    expect(before.overdue).toEqual([])
    const ended = endSchedule(paid.data, 's', TODAY, ctx)
    expect(ended.ok).toBe(true)
    if (!ended.ok) return
    expect(ended.data.schedules[0]!.endDate).toBe(TODAY)
    expect(ended.data.transactions).toEqual(paid.data.transactions)
    expect(planItems(ended.data, { today: TODAY, from: TODAY, to: '2026-12-31' }).filter((i) => i.sourceId === 's')).toEqual([])
    expect(scheduleSummary(ended.data, 's', TODAY)!.next).toEqual([])
    expect(endSchedule(paid.data, 's', '2026-08-01', ctx)).toMatchObject({ ok: false, issues: [{ path: 'endDate', code: 'endBeforeStart' }] })
    expect(endSchedule(paid.data, 'nope', TODAY, ctx)).toMatchObject({ ok: false })
    expect(scheduleSummary(paid.data, 'nope', TODAY)).toBeNull()
  })
})
