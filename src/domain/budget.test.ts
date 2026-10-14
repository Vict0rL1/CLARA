import { describe, expect, it } from 'vitest'
import { accountBalance, spendableBalance } from './balances'
import { computeBudget } from './budget'
import { allocateToGoal, markOccurrence, realizePlanned, saveAccount, saveTransaction, updateAccountBalance, type OpResult } from './operations'
import { account, baseData, bill, ctx, EARLIER, goal, income, NOW, TODAY, tx } from '../test/fixtures'

function must<T>(r: OpResult<T>): Extract<OpResult<T>, { ok: true }> {
  if (!r.ok) throw new Error(`Operación rechazada: ${JSON.stringify(r.issues)}`)
  return r
}

describe('disponible hasta el próximo ingreso', () => {
  it('resta pagos reservados y apartados; el día del ingreso queda excluido', () => {
    const data = baseData({
      schedules: [income('2026-10-03', 50000), bill('2026-10-01', 30000)],
      goals: [goal({ allocations: [{ id: 'al1', amountMinor: 10000, date: TODAY, createdAt: EARLIER }] })],
    })
    const b = computeBudget(data, TODAY)
    expect(b.status).toBe('ok')
    expect(b.spendableMinor).toBe(100000)
    expect(b.reservedTotalMinor).toBe(30000)
    expect(b.goalsReservedMinor).toBe(10000)
    expect(b.availableMinor).toBe(60000)
    // Del 28-sep al 2-oct: 5 días (el 3-oct, día del ingreso, no cuenta).
    expect(b.horizon?.days).toBe(5)
    expect(b.dailyMinor).toBe(12000)
    expect(b.weeklyMinor).toBe(60000)
    expect(b.weeklyDays).toBe(5)
  })

  it('no suma ingresos futuros al disponible', () => {
    const data = baseData({ schedules: [income('2026-10-03', 999900)] })
    expect(computeBudget(data, TODAY).availableMinor).toBe(100000)
  })

  it('reserva un pago que vence el mismo día del ingreso', () => {
    const data = baseData({ schedules: [income('2026-10-03', 50000), bill('2026-10-03', 20000), bill('2026-10-04', 5000)] })
    const b = computeBudget(data, TODAY)
    expect(b.reservedTotalMinor).toBe(20000)
  })

  it('redondea el diario hacia abajo para no gastar de más', () => {
    const data = baseData({
      accounts: [account({ id: 'main', anchor: { amountMinor: 1000, date: TODAY, setAt: EARLIER } })],
      schedules: [income('2026-10-01', 1)],
    })
    const b = computeBudget(data, TODAY)
    expect(b.horizon?.days).toBe(3)
    expect(b.dailyMinor).toBe(333) // 10.00 / 3 = 3.333… → 3.33
    expect(b.weeklyMinor).toBe(1000)
  })

  it('con periodo largo, semanal = 7 días proporcionales', () => {
    const data = baseData({ schedules: [income('2026-10-12', 1)] })
    const b = computeBudget(data, TODAY)
    expect(b.horizon?.days).toBe(14)
    expect(b.dailyMinor).toBe(7142)
    expect(b.weeklyMinor).toBe(50000)
  })

  it('saldo negativo: disponible negativo y diario 0 (sin dividir negativos)', () => {
    const data = baseData({
      accounts: [account({ id: 'main', anchor: { amountMinor: -5000, date: TODAY, setAt: EARLIER } })],
      schedules: [income('2026-10-03', 50000), bill('2026-09-30', 2000)],
    })
    const b = computeBudget(data, TODAY)
    expect(b.availableMinor).toBe(-7000)
    expect(b.dailyMinor).toBe(0)
    expect(b.weeklyMinor).toBe(0)
  })

  it('sin ingreso registrado pide un horizonte y no divide entre cero', () => {
    const b = computeBudget(baseData(), TODAY)
    expect(b.status).toBe('needsHorizon')
    expect(b.dailyMinor).toBeNull()
    expect(b.weeklyMinor).toBeNull()
    const withFallback = computeBudget(baseData({ settings: { ...baseData().settings, fallbackHorizonDays: 14 } }), TODAY)
    expect(withFallback.status).toBe('ok')
    expect(withFallback.horizon).toMatchObject({ source: 'fallback', days: 14, endDate: '2026-10-12' })
    expect(withFallback.dailyMinor).toBe(7142)
  })

  it('ingreso retrasado: no se cuenta y se pide actualizarlo', () => {
    const late = income('2026-09-25', 60000, { id: 'late' })
    const data = baseData({ schedules: [late] })
    const b = computeBudget(data, TODAY)
    expect(b.overdueIncomes.map((i) => i.sourceId)).toEqual(['late'])
    expect(b.status).toBe('needsHorizon')
    expect(b.availableMinor).toBe(100000)
  })

  it('ingreso recurrente retrasado: usa el siguiente ingreso y avisa del retraso', () => {
    const data = baseData({ schedules: [income('2026-09-25', 60000, { frequency: 'biweekly' })] })
    const b = computeBudget(data, TODAY)
    expect(b.overdueIncomes).toHaveLength(1)
    expect(b.horizon?.endDate).toBe('2026-10-09')
    expect(b.horizon?.days).toBe(11)
  })

  it('ingreso previsto para hoy sin marcar: no se cuenta y el periodo va al siguiente', () => {
    const data = baseData({ schedules: [income(TODAY, 60000, { frequency: 'weekly' })] })
    const b = computeBudget(data, TODAY)
    expect(b.incomeDueToday).toHaveLength(1)
    expect(b.horizon?.endDate).toBe('2026-10-05')
    expect(b.availableMinor).toBe(100000)
  })

  it('reserva los pagos vencidos sin marcar', () => {
    const data = baseData({ schedules: [income('2026-10-03', 1), bill('2026-09-20', 4280)] })
    const b = computeBudget(data, TODAY)
    expect(b.overdueBills).toHaveLength(1)
    expect(b.reservedTotalMinor).toBe(4280)
  })

  it('advierte si el saldo es antiguo', () => {
    const old = account({ id: 'main', anchor: { amountMinor: 1000, date: '2026-09-20', setAt: '2026-09-20T15:00:00.000Z' } })
    const b = computeBudget(baseData({ accounts: [old] }), TODAY)
    expect(b.balanceAgeDays).toBe(8)
    expect(b.isBalanceStale).toBe(true)
  })
})

describe('saldo de referencia y movimientos (sin doble conteo)', () => {
  it('movimientos anteriores al saldo ya están incluidos; los posteriores se aplican', () => {
    const data = baseData({
      transactions: [
        tx({ date: '2026-09-27', amountMinor: 500 }), // antes de la fecha del saldo
        tx({ date: TODAY, amountMinor: 700, realizedAt: '2026-09-28T12:00:00.000Z' }), // mismo día, antes de escribir el saldo
        tx({ date: TODAY, amountMinor: 300, realizedAt: NOW }), // mismo día, después
        tx({ date: TODAY, amountMinor: 900, status: 'planned', realizedAt: undefined }), // previsto: nunca cuenta
      ],
    })
    expect(spendableBalance(data).totalMinor).toBe(100000 - 300)
  })

  it('guardar un gasto de hoy lo aplica; marcarlo "ya incluido" no lo resta otra vez', () => {
    const data = baseData()
    const a = must(saveTransaction(data, { id: 't1', kind: 'expense', status: 'realized', amountMinor: 1500, date: TODAY, accountId: 'main', categoryId: 'dining' }, ctx))
    expect(spendableBalance(a.data).totalMinor).toBe(98500)
    const b = must(saveTransaction(data, { id: 't2', kind: 'expense', status: 'realized', amountMinor: 1500, date: TODAY, accountId: 'main', categoryId: 'dining', alreadyInBalance: true }, ctx))
    expect(spendableBalance(b.data).totalMinor).toBe(100000)
    // Cambiar de opinión al editar: deja de estar incluido y se aplica.
    const c = must(saveTransaction(b.data, { ...b.value, alreadyInBalance: false }, ctx))
    expect(spendableBalance(c.data).totalMinor).toBe(98500)
  })

  it('actualizar el saldo incorpora los movimientos anteriores', () => {
    const data = baseData({ transactions: [tx({ amountMinor: 2000 })] })
    expect(spendableBalance(data).totalMinor).toBe(98000)
    const later = { today: TODAY, now: '2026-09-28T20:00:00.000Z' }
    const r = must(updateAccountBalance(data, { accountId: 'main', amountMinor: 97000, date: TODAY }, later))
    expect(spendableBalance(r.data).totalMinor).toBe(97000)
  })

  it('un movimiento realizado no puede tener fecha futura', () => {
    const r = saveTransaction(baseData(), { id: 'x', kind: 'expense', status: 'realized', amountMinor: 100, date: '2026-09-29', accountId: 'main', categoryId: 'dining' }, ctx)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0]?.code).toBe('realizedInFuture')
  })

  it('un previsto marcado como realizado se aplica una sola vez', () => {
    const planned = tx({ id: 'p1', status: 'planned', date: '2026-10-02', amountMinor: 2500, realizedAt: undefined })
    const data = baseData({ transactions: [planned] })
    expect(spendableBalance(data).totalMinor).toBe(100000)
    const r = must(realizePlanned(data, 'p1', { date: TODAY }, ctx))
    expect(spendableBalance(r.data).totalMinor).toBe(97500)
    const again = must(realizePlanned(r.data, 'p1', { date: TODAY }, ctx))
    expect(again.unchanged).toBe(true)
    expect(again.data.transactions).toHaveLength(1)
  })
})

describe('transferencias', () => {
  const savings = account({ id: 'sav', name: 'Ahorros', kind: 'savings', includeInBudget: false })
  const cash = account({ id: 'cash', name: 'Efectivo', kind: 'cash' })

  it('entre cuentas del presupuesto: no es ingreso ni gasto y el total no cambia', () => {
    const data = baseData({ accounts: [account({ id: 'main' }), cash] })
    const r = must(saveTransaction(data, { id: 't', kind: 'transfer', status: 'realized', amountMinor: 20000, date: TODAY, accountId: 'main', toAccountId: 'cash' }, ctx))
    expect(accountBalance(r.data, r.data.accounts[0]!).balanceMinor).toBe(80000)
    expect(accountBalance(r.data, r.data.accounts[1]!).balanceMinor).toBe(120000)
    expect(spendableBalance(r.data).totalMinor).toBe(200000)
  })

  it('hacia una cuenta fuera del presupuesto reduce el disponible', () => {
    const data = baseData({ accounts: [account({ id: 'main' }), savings] })
    const r = must(saveTransaction(data, { id: 't', kind: 'transfer', status: 'realized', amountMinor: 20000, date: TODAY, accountId: 'main', toAccountId: 'sav' }, ctx))
    expect(spendableBalance(r.data).totalMinor).toBe(80000)
    expect(accountBalance(r.data, r.data.accounts[1]!).balanceMinor).toBe(120000)
  })

  it('no se permite transferir a la misma cuenta', () => {
    const r = saveTransaction(baseData(), { id: 't', kind: 'transfer', status: 'realized', amountMinor: 100, date: TODAY, accountId: 'main', toAccountId: 'main' }, ctx)
    expect(r.ok).toBe(false)
  })
})

describe('devoluciones', () => {
  it('una devolución parcial suma al saldo y no puede superar el gasto original', () => {
    const purchase = tx({ id: 'buy', amountMinor: 4999, categoryId: 'shopping' })
    const data = baseData({ transactions: [purchase] })
    expect(spendableBalance(data).totalMinor).toBe(95001)
    const r1 = must(saveTransaction(data, { id: 'r1', kind: 'refund', status: 'realized', amountMinor: 1500, date: TODAY, accountId: 'main', categoryId: 'shopping', refundOfId: 'buy' }, ctx))
    expect(spendableBalance(r1.data).totalMinor).toBe(96501)
    const tooMuch = saveTransaction(r1.data, { id: 'r2', kind: 'refund', status: 'realized', amountMinor: 3500, date: TODAY, accountId: 'main', categoryId: 'shopping', refundOfId: 'buy' }, ctx)
    expect(tooMuch.ok).toBe(false)
    if (!tooMuch.ok) expect(tooMuch.issues[0]).toMatchObject({ code: 'refundExceeds', params: { remainingMinor: 3499 } })
    const rest = must(saveTransaction(r1.data, { id: 'r2', kind: 'refund', status: 'realized', amountMinor: 3499, date: TODAY, accountId: 'main', categoryId: 'shopping', refundOfId: 'buy' }, ctx))
    expect(spendableBalance(rest.data).totalMinor).toBe(100000)
  })
})

describe('pagos recurrentes marcados como realizados', () => {
  const rent = bill('2026-10-01', 65000, { id: 'rent', frequency: 'monthly' })
  const data = baseData({ schedules: [income('2026-10-03', 50000), rent] })

  it('pasa de reserva a movimiento realizado sin descontarse dos veces', () => {
    const before = computeBudget(data, TODAY)
    expect(before.reservedTotalMinor).toBe(65000)
    expect(before.availableMinor).toBe(35000)
    const r = must(markOccurrence(data, { scheduleId: 'rent', occurrenceDate: '2026-10-01', amountMinor: 65000, date: TODAY }, ctx))
    const after = computeBudget(r.data, TODAY)
    expect(after.spendableMinor).toBe(35000)
    expect(after.reservedTotalMinor).toBe(0)
    expect(after.availableMinor).toBe(35000)
  })

  it('marcar dos veces (o doble clic) no crea un segundo movimiento', () => {
    const input = { scheduleId: 'rent', occurrenceDate: '2026-10-01', amountMinor: 65000, date: TODAY, txId: 'click-1' }
    const once = must(markOccurrence(data, input, ctx))
    const twice = must(markOccurrence(once.data, input, ctx))
    const other = must(markOccurrence(twice.data, { ...input, txId: 'click-2' }, ctx))
    expect(other.data.transactions).toHaveLength(1)
    expect(twice.unchanged).toBe(true)
    expect(other.unchanged).toBe(true)
  })

  it('si el importe real difiere, solo cambia la diferencia', () => {
    const r = must(markOccurrence(data, { scheduleId: 'rent', occurrenceDate: '2026-10-01', amountMinor: 66000, date: TODAY }, ctx))
    expect(computeBudget(r.data, TODAY).availableMinor).toBe(34000)
  })

  it('si ya estaba incluido en el saldo, solo libera la reserva', () => {
    const r = must(markOccurrence(data, { scheduleId: 'rent', occurrenceDate: '2026-10-01', amountMinor: 65000, date: TODAY, alreadyInBalance: true }, ctx))
    const b = computeBudget(r.data, TODAY)
    expect(b.spendableMinor).toBe(100000)
    expect(b.availableMinor).toBe(100000)
  })

  it('la siguiente ocurrencia sigue pendiente', () => {
    const r = must(markOccurrence(data, { scheduleId: 'rent', occurrenceDate: '2026-10-01', amountMinor: 65000, date: TODAY }, ctx))
    const later = computeBudget({ ...r.data, schedules: [income('2026-11-05', 1), rent] }, TODAY)
    expect(later.reservedItems.map((i) => i.date)).toEqual(['2026-11-01'])
  })

  it('al actualizar el saldo se pueden marcar vencidos como ya pagados', () => {
    const overdue = baseData({ schedules: [income('2026-10-03', 1), bill('2026-09-20', 4280, { id: 'luz' })] })
    const r = must(
      updateAccountBalance(overdue, { accountId: 'main', amountMinor: 95720, date: TODAY, settle: [{ scheduleId: 'luz', occurrenceDate: '2026-09-20', amountMinor: 4280 }] }, ctx),
    )
    const b = computeBudget(r.data, TODAY)
    expect(b.spendableMinor).toBe(95720)
    expect(b.reservedTotalMinor).toBe(0)
  })
})

describe('metas y reservas de ahorro', () => {
  it('una reserva de ahorro se descuenta una sola vez', () => {
    const data = baseData({ schedules: [income('2026-10-03', 1)], goals: [goal({ id: 'g', targetMinor: 50000 })] })
    const r = must(allocateToGoal(data, { goalId: 'g', amountMinor: 20000, allocationId: 'a1' }, ctx))
    expect(computeBudget(r.data, TODAY).availableMinor).toBe(80000)
    // Reintentar el mismo apartado (misma operación) no lo duplica.
    const again = must(allocateToGoal(r.data, { goalId: 'g', amountMinor: 20000, allocationId: 'a1' }, ctx))
    expect(again.unchanged).toBe(true)
    expect(computeBudget(again.data, TODAY).availableMinor).toBe(80000)
  })

  it('no permite apartar dinero ya comprometido en pagos u otras metas', () => {
    const data = baseData({
      schedules: [income('2026-10-03', 1), bill('2026-10-01', 70000)],
      goals: [goal({ id: 'g1', targetMinor: 100000 }), goal({ id: 'g2', targetMinor: 100000 })],
    })
    const first = must(allocateToGoal(data, { goalId: 'g1', amountMinor: 20000 }, ctx))
    const second = allocateToGoal(first.data, { goalId: 'g2', amountMinor: 20000 }, ctx)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.issues[0]).toMatchObject({ code: 'exceedsFreeMoney', params: { freeMinor: 10000 } })
  })

  it('las metas con dinero en una cuenta externa no se descuentan del disponible', () => {
    const data = baseData({
      schedules: [income('2026-10-03', 1)],
      goals: [goal({ fundedFrom: 'external', allocations: [{ id: 'x', amountMinor: 40000, date: TODAY, createdAt: EARLIER }] })],
    })
    expect(computeBudget(data, TODAY).availableMinor).toBe(100000)
  })

  it('no aparta más de lo que falta ni libera más de lo apartado', () => {
    const data = baseData({ goals: [goal({ id: 'g', targetMinor: 5000, allocations: [{ id: 'x', amountMinor: 4000, date: TODAY, createdAt: EARLIER }] })] })
    const tooMuch = allocateToGoal(data, { goalId: 'g', amountMinor: 2000 }, ctx)
    expect(tooMuch.ok || tooMuch.issues[0]?.code).toBe('exceedsRemaining')
    const release = allocateToGoal(data, { goalId: 'g', amountMinor: -5000 }, ctx)
    expect(release.ok || release.issues[0]?.code).toBe('exceedsSaved')
    const ok = must(allocateToGoal(data, { goalId: 'g', amountMinor: -1500 }, ctx))
    expect(computeBudget(ok.data, TODAY).goalsReservedMinor).toBe(2500)
  })

  it('advierte si los apartados superan el dinero después de pagos', () => {
    const data = baseData({
      schedules: [income('2026-10-03', 1), bill('2026-10-01', 90000)],
      goals: [goal({ allocations: [{ id: 'x', amountMinor: 20000, date: TODAY, createdAt: EARLIER }] })],
    })
    const b = computeBudget(data, TODAY)
    expect(b.goalsExceedMoney).toBe(true)
    expect(b.availableMinor).toBe(-10000)
  })
})

describe('cambio de mes y fechas límite', () => {
  it('pago mensual del 31 en febrero se reserva el 28', () => {
    const data = baseData({
      accounts: [account({ id: 'main', anchor: { amountMinor: 100000, date: '2027-02-25', setAt: '2027-02-25T15:00:00.000Z' } })],
      schedules: [income('2027-03-05', 1), bill('2027-01-31', 10000, { frequency: 'monthly', skippedDates: ['2027-01-31'] })],
    })
    const b = computeBudget(data, '2027-02-25')
    expect(b.reservedItems.map((i) => i.date)).toEqual(['2027-02-28'])
    expect(b.horizon?.days).toBe(8) // 25-feb → 5-mar (2027 no es bisiesto)
  })

  it('el periodo cruza fin de año correctamente', () => {
    const data = baseData({
      accounts: [account({ id: 'main', anchor: { amountMinor: 70000, date: '2026-12-30', setAt: '2026-12-30T15:00:00.000Z' } })],
      schedules: [income('2027-01-06', 1)],
    })
    const b = computeBudget(data, '2026-12-30')
    expect(b.horizon?.days).toBe(7)
    expect(b.dailyMinor).toBe(10000)
  })
})

describe('tarjetas de crédito', () => {
  const card = (overrides: Partial<Parameters<typeof account>[0]> = {}) =>
    account({ id: 'card', name: 'Tarjeta', kind: 'credit', anchor: { amountMinor: -20000, date: TODAY, setAt: EARLIER }, ...overrides })

  it('la deuda de una tarjeta del presupuesto se descuenta del disponible', () => {
    const data = baseData({ accounts: [account({ id: 'main' }), card()], schedules: [income('2026-10-03', 1)] })
    expect(computeBudget(data, TODAY).spendableMinor).toBe(80000)
  })

  it('compra con tarjeta y pago de la tarjeta: la compra se cuenta una sola vez', () => {
    let data = baseData({ accounts: [account({ id: 'main' }), card({ anchor: { amountMinor: 0, date: TODAY, setAt: EARLIER } })] })
    data = must(saveTransaction(data, { id: 'buy', kind: 'expense', status: 'realized', amountMinor: 5000, date: TODAY, accountId: 'card', categoryId: 'shopping' }, ctx)).data
    expect(spendableBalance(data).totalMinor).toBe(95000)
    // Pagar la tarjeta es una transferencia banco → tarjeta: no cambia el total.
    data = must(saveTransaction(data, { id: 'pay', kind: 'transfer', status: 'realized', amountMinor: 5000, date: TODAY, accountId: 'main', toAccountId: 'card' }, ctx)).data
    expect(spendableBalance(data).totalMinor).toBe(95000)
    expect(accountBalance(data, data.accounts[1]!).balanceMinor).toBe(0)
    expect(accountBalance(data, data.accounts[0]!).balanceMinor).toBe(95000)
  })

  it('tarjeta fuera del presupuesto: la compra no afecta hasta que se paga', () => {
    let data = baseData({ accounts: [account({ id: 'main' }), card({ includeInBudget: false, anchor: { amountMinor: 0, date: TODAY, setAt: EARLIER } })] })
    data = must(saveTransaction(data, { id: 'buy', kind: 'expense', status: 'realized', amountMinor: 5000, date: TODAY, accountId: 'card', categoryId: 'shopping' }, ctx)).data
    expect(spendableBalance(data).totalMinor).toBe(100000)
    data = must(saveTransaction(data, { id: 'pay', kind: 'transfer', status: 'realized', amountMinor: 5000, date: TODAY, accountId: 'main', toAccountId: 'card' }, ctx)).data
    expect(spendableBalance(data).totalMinor).toBe(95000)
  })

  it('no permite convertir una cuenta en tarjeta ni al revés', () => {
    const data = baseData({ accounts: [account({ id: 'main' }), card()] })
    const r1 = saveAccount(data, { id: 'card', name: 'Tarjeta', kind: 'bank', includeInBudget: true }, ctx)
    expect(r1.ok || r1.issues[0]?.code).toBe('creditKindChange')
    const r2 = saveAccount(data, { id: 'main', name: 'Principal', kind: 'credit', includeInBudget: true }, ctx)
    expect(r2.ok || r2.issues[0]?.code).toBe('creditKindChange')
  })
})

describe('periodo de calendario (§6): mes con y sin arrastre', () => {
  it('con arrastre el disponible parte del saldo consolidado; sin arrastre, del neto del periodo; los días cuentan hoy', () => {
    const base = baseData({
      transactions: [tx({ id: 'i', kind: 'income', categoryId: 'salary', amountMinor: 50000, date: '2026-09-29' }), tx({ id: 'e', amountMinor: 20000, date: '2026-09-29' })],
      schedules: [bill('2026-09-30', 10000, { id: 'b' }), bill('2026-10-02', 99900, { id: 'later' })],
    })
    const on = computeBudget({ ...base, settings: { ...base.settings, budgetPeriod: { type: 'month', weekStartsOn: 1 }, carryOverBalance: true } }, '2026-09-30')
    expect(on.period).toMatchObject({ type: 'month', start: '2026-09-01', end: '2026-09-30', daysLeft: 1 })
    expect(on.horizon).toMatchObject({ source: 'period', endDate: '2026-09-30', days: 1 })
    // Saldo consolidado 100000 + 50000 − 20000 = 130000; solo se reserva el pago del periodo (30-sep).
    expect(on.baseMinor).toBe(130000)
    expect(on.reservedTotalMinor).toBe(10000)
    expect(on.availableMinor).toBe(120000)
    expect(on.dailyMinor).toBe(120000)
    const off = computeBudget({ ...base, settings: { ...base.settings, budgetPeriod: { type: 'month', weekStartsOn: 1 }, carryOverBalance: false } }, '2026-09-30')
    expect(off.baseMinor).toBe(30000)
    expect(off.availableMinor).toBe(20000)
    expect(off.spendableMinor).toBe(130000)
    // «Hasta mi próximo ingreso» sigue igual que siempre.
    const legacy = computeBudget(base, '2026-09-30')
    expect(legacy.period).toBeNull()
    expect(legacy.baseMinor).toBe(legacy.spendableMinor)
  })
})

describe('sin arrastre, el disponible nunca supera el saldo real (QA-03)', () => {
  const month = (d: ReturnType<typeof baseData>, carryOverBalance: boolean) => ({ ...d, settings: { ...d.settings, budgetPeriod: { type: 'month' as const, weekStartsOn: 1 as const }, carryOverBalance } })
  const bank = (amountMinor: number, id = 'main', includeInBudget = true) => account({ id, includeInBudget, anchor: { amountMinor, date: ctx.today, setAt: EARLIER } })

  it('deuda previa −500 e ingreso 1000: saldo 500 → la base es 500, no 1000; con arrastre también 500', () => {
    const d = baseData({ accounts: [bank(-50000)], transactions: [tx({ kind: 'income', categoryId: 'salary', amountMinor: 100000 })] })
    const off = computeBudget(month(d, false), ctx.today)
    expect(off.spendableMinor).toBe(50000)
    expect(off.periodBalance).toMatchObject({ poolNetMinor: 100000, balanceMinor: 50000, spendableBaseMinor: 50000, limitedByBalance: true, outsideMinor: 0 })
    expect(off.baseMinor).toBe(50000)
    expect(off.availableMinor).toBe(50000)
    expect(computeBudget(month(d, true), ctx.today).availableMinor).toBe(50000)
  })

  it('saldo previo positivo: sin arrastre manda la asignación del periodo (lo que entró menos lo que salió)', () => {
    const d = baseData({ accounts: [bank(200000)], transactions: [tx({ kind: 'income', categoryId: 'salary', amountMinor: 100000 }), tx({ amountMinor: 20000 })] })
    const off = computeBudget(month(d, false), ctx.today)
    expect(off.spendableMinor).toBe(280000)
    expect(off.periodBalance).toMatchObject({ poolNetMinor: 80000, spendableBaseMinor: 80000, limitedByBalance: false, carryOverMinor: 200000 })
    expect(off.availableMinor).toBe(80000)
    expect(computeBudget(month(d, true), ctx.today).availableMinor).toBe(280000)
  })

  it('un ingreso en una cuenta excluida no es dinero del presupuesto: no entra en la asignación y se explica', () => {
    const d = baseData({ accounts: [bank(100000), bank(0, 'savings', false)], transactions: [tx({ kind: 'income', categoryId: 'salary', amountMinor: 100000, accountId: 'savings' })] })
    const off = computeBudget(month(d, false), ctx.today)
    expect(off.spendableMinor).toBe(100000)
    expect(off.periodBalance).toMatchObject({ incomeMinor: 100000, poolNetMinor: 0, outsideMinor: -100000, spendableBaseMinor: 0 })
    expect(off.availableMinor).toBe(0)
  })

  it('transferir al ahorro reduce la asignación del periodo y el saldo; el patrimonio no cambia', () => {
    const d = baseData({ accounts: [bank(100000), bank(0, 'savings', false)], transactions: [tx({ kind: 'income', categoryId: 'salary', amountMinor: 50000 }), tx({ kind: 'transfer', categoryId: undefined, toAccountId: 'savings', amountMinor: 30000 })] })
    const off = computeBudget(month(d, false), ctx.today)
    expect(off.spendableMinor).toBe(120000)
    expect(off.periodBalance).toMatchObject({ poolNetMinor: 20000, outsideMinor: -30000, spendableBaseMinor: 20000, carryOverMinor: 100000 })
    expect(off.availableMinor).toBe(20000)
  })

  it('pagos pendientes y apartados se restan una sola vez de la base limitada; el déficit se ve', () => {
    const d = baseData({
      accounts: [bank(-50000)],
      transactions: [tx({ kind: 'income', categoryId: 'salary', amountMinor: 100000 })],
      schedules: [bill('2026-09-30', 20000, { id: 'b' })],
      goals: [goal({ allocations: [{ id: 'a', amountMinor: 10000, date: ctx.today, createdAt: EARLIER }] })],
    })
    const off = computeBudget(month(d, false), ctx.today)
    expect(off.baseMinor).toBe(50000)
    expect(off.reservedTotalMinor).toBe(20000)
    expect(off.goalsReservedMinor).toBe(10000)
    expect(off.availableMinor).toBe(20000)
    // Más deuda previa que ingresos: la base es negativa y no se esconde.
    const deep = baseData({ accounts: [bank(-150000)], transactions: [tx({ kind: 'income', categoryId: 'salary', amountMinor: 100000 })] })
    expect(computeBudget(month(deep, false), ctx.today)).toMatchObject({ baseMinor: -50000, availableMinor: -50000, dailyMinor: 0 })
  })

  it('cambiar el ajuste de arrastre cambia la base, nunca el saldo ni los movimientos', () => {
    const d = baseData({ accounts: [bank(-50000)], transactions: [tx({ kind: 'income', categoryId: 'salary', amountMinor: 100000 })] })
    const on = computeBudget(month(d, true), ctx.today)
    const off = computeBudget(month(d, false), ctx.today)
    expect([on.spendableMinor, off.spendableMinor]).toEqual([50000, 50000])
    expect(on.baseMinor).toBe(50000)
    expect(off.baseMinor).toBe(50000)
    expect(d.transactions).toHaveLength(1)
  })
})

describe('UX-02 · el horizonte explicado es el que usó el cálculo', () => {
  // Reproducción del informe (auditoría 2026-10-12): 11-oct-2026 en America/Vancouver, saldo 2 000,
  // sin ingreso programado, sin pagos y un apartado de 300 dentro del presupuesto.
  const TODAY_V = '2026-10-11'
  const vancouver = (period: 'month' | 'quarter' | 'untilIncome', extra: { fallbackHorizonDays?: number | null; schedules?: ReturnType<typeof income>[] } = {}) =>
    baseData({
      settings: { ...baseData().settings, timeZone: 'America/Vancouver', budgetPeriod: { type: period, weekStartsOn: 1 }, fallbackHorizonDays: extra.fallbackHorizonDays ?? null },
      accounts: [account({ id: 'main', anchor: { amountMinor: 200000, date: TODAY_V, setAt: '2026-10-11T19:00:00.000Z' } })],
      goals: [goal({ allocations: [{ id: 'r', amountMinor: 30000, date: TODAY_V, createdAt: '2026-10-11T19:00:00.000Z' }] })],
      schedules: extra.schedules ?? [],
    })

  it('periodo mensual sin fecha de ingreso: 1 700 en los 21 días que quedan de octubre (80,95 por día), aunque haya un valor de respaldo guardado', () => {
    const b = computeBudget(vancouver('month'), TODAY_V)
    expect(b.status).toBe('ok')
    expect(b.horizon).toEqual({ source: 'period', endDate: '2026-10-31', days: 21 })
    expect(b.availableMinor).toBe(170000)
    expect(b.dailyMinor).toBe(8095)
    // Un horizonte en días guardado antes no participa: el periodo de calendario manda.
    const stale = computeBudget(vancouver('month', { fallbackHorizonDays: 14 }), TODAY_V)
    expect(stale.horizon).toEqual(b.horizon)
    expect(stale.dailyMinor).toBe(8095)
  })

  it('«hasta mi próximo ingreso» sin fecha: ahí sí rigen los 14 días elegidos (121,42 por día, truncado)', () => {
    const b = computeBudget(vancouver('untilIncome', { fallbackHorizonDays: 14 }), TODAY_V)
    expect(b.horizon).toEqual({ source: 'fallback', endDate: '2026-10-25', days: 14 })
    expect(b.availableMinor).toBe(170000)
    expect(b.dailyMinor).toBe(12142)
  })

  it('con fecha de ingreso conocida: el periodo «hasta mi próximo ingreso» termina ese día y el mensual sigue el calendario', () => {
    const pay = income('2026-10-24', 50000, { id: 'pay' })
    const untilIncome = computeBudget(vancouver('untilIncome', { schedules: [pay] }), TODAY_V)
    expect(untilIncome.horizon).toMatchObject({ source: 'income', endDate: '2026-10-24', days: 13 })
    expect(untilIncome.availableMinor).toBe(170000) // el ingreso futuro no se suma
    expect(untilIncome.dailyMinor).toBe(13076)
    const monthly = computeBudget(vancouver('month', { schedules: [pay] }), TODAY_V)
    expect(monthly.horizon).toEqual({ source: 'period', endDate: '2026-10-31', days: 21 })
    expect(monthly.dailyMinor).toBe(8095)
  })

  it('cambio de día y fin de mes: el último día cuenta 1 y al día siguiente empieza el periodo nuevo', () => {
    const lastDay = computeBudget(vancouver('month'), '2026-10-31')
    expect(lastDay.horizon).toEqual({ source: 'period', endDate: '2026-10-31', days: 1 })
    expect(lastDay.dailyMinor).toBe(170000)
    const firstDay = computeBudget(vancouver('month'), '2026-11-01')
    expect(firstDay.horizon).toEqual({ source: 'period', endDate: '2026-11-30', days: 30 })
    expect(firstDay.dailyMinor).toBe(5666)
  })

  it('otro periodo de calendario (trimestral): los días que quedan son los del trimestre', () => {
    const b = computeBudget(vancouver('quarter'), TODAY_V)
    expect(b.horizon).toEqual({ source: 'period', endDate: '2026-12-31', days: 82 })
    expect(b.dailyMinor).toBe(2073)
  })
})
