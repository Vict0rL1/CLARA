import { describe, expect, it } from 'vitest'
import { computeBudget } from './budget'
import { dismissInboxItem, inboxView, possibleDuplicates, snoozeInboxItem, undismissInboxItem, unsnoozeInboxItem } from './inbox'
import { markOccurrence, reconcileAccount, saveTransaction } from './operations'
import type { AppData } from './types'
import { validateAppData } from '../storage/backup'
import { account, baseData, bill, ctx, EARLIER, goal, NOW, TODAY, tx } from '../test/fixtures'
import { closeDuePlans } from './plans'

function ok<T>(r: { ok: true; data: AppData; value: T } | { ok: false; issues: unknown[] }) {
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r
}
// Avisos sin los de verificación de saldo (que tienen su propia prueba): cambiar un movimiento
// ya verificado marca la conciliación «por revisar», como corresponde.
const ids = (d: AppData, today = TODAY) => inboxView(d, today).active.filter((i) => i.kind !== 'balance').map((i) => i.id)
const verifiedMain = (d: AppData, date = TODAY) =>
  ok(reconcileAccount(d, { id: `rec-${date}`, accountId: 'main', date, observedMinor: computeBudget(d, TODAY).spendableMinor, resolution: 'matched' }, ctx)).data

describe('bandeja: movimientos sin categoría', () => {
  it('aparece una vez, se resuelve al categorizar y «está bien así» se recuerda salvo que cambie', () => {
    let d = verifiedMain(baseData({ transactions: [tx({ id: 'x', categoryId: 'other_expense', note: 'POS 1234', amountMinor: 999 })] }))
    expect(ids(d)).toEqual(['cat:x'])
    expect(ids(d)).toEqual(ids(d)) // estable: no se duplica al recalcular
    const item = inboxView(d, TODAY).active[0]!
    const dismissed = ok(dismissInboxItem(d, item, ctx)).data
    expect(ids(dismissed)).toEqual([])
    expect(inboxView(dismissed, TODAY).dismissed.map((i) => i.id)).toEqual(['cat:x'])
    // Cambia el importe: el descarte ya no aplica.
    const changed = ok(saveTransaction(dismissed, { ...dismissed.transactions[0]!, amountMinor: 1000 }, ctx)).data
    expect(ids(changed)).toEqual(['cat:x'])
    expect(ids(ok(undismissInboxItem(dismissed, 'cat:x', ctx)).data)).toEqual(['cat:x'])
    // Resolver: elegir una categoría.
    d = ok(saveTransaction(d, { ...d.transactions[0]!, categoryId: 'dining' }, ctx)).data
    expect(ids(d)).toEqual([])
  })
})

describe('bandeja: pagos vencidos sin confirmar', () => {
  const overdue = () => verifiedMain(baseData({ schedules: [bill('2026-09-25', 4280, { id: 'luz', name: 'Luz' })] }))

  it('aparece con fecha e importe y desaparece al registrar el pago', () => {
    const d = overdue()
    const item = inboxView(d, TODAY).active[0]!
    expect(item).toMatchObject({ id: 'due:schedule:luz:2026-09-25', kind: 'overdue', reason: 'overdueExpense', date: '2026-09-25', amountMinor: 4280, canDismiss: false })
    const paid = ok(markOccurrence(d, { scheduleId: 'luz', occurrenceDate: '2026-09-25', amountMinor: 4280, date: TODAY }, ctx)).data
    expect(ids(paid)).toEqual([])
  })

  it('posponer no cambia cifras ni lo oculta para siempre', () => {
    const d = overdue()
    const before = computeBudget(d, TODAY)
    const snoozed = ok(snoozeInboxItem(d, 'due:schedule:luz:2026-09-25', '2026-10-01', ctx)).data
    expect(ids(snoozed)).toEqual([])
    expect(inboxView(snoozed, TODAY).snoozed.map((i) => [i.id, i.until])).toEqual([['due:schedule:luz:2026-09-25', '2026-10-01']])
    expect(computeBudget(snoozed, TODAY)).toEqual(before)
    // Llega la fecha: vuelve si el problema sigue.
    expect(inboxView(snoozed, '2026-10-01').active.map((i) => i.id)).toContain('due:schedule:luz:2026-09-25')
    expect(ids(ok(unsnoozeInboxItem(snoozed, 'due:schedule:luz:2026-09-25', ctx)).data)).toEqual(['due:schedule:luz:2026-09-25'])
    // No se puede posponer al pasado ni descartar un pago vencido.
    expect(snoozeInboxItem(d, 'x', TODAY, ctx).ok).toBe(false)
    expect(dismissInboxItem(d, inboxView(d, TODAY).active[0]!, ctx).ok).toBe(false)
  })
})

describe('bandeja: posibles duplicados', () => {
  const two = (over: Partial<AppData['transactions'][number]> = {}) =>
    verifiedMain(baseData({ transactions: [tx({ id: 'a', note: 'Café Olé', amountMinor: 425, date: '2026-09-26' }), tx({ id: 'b', note: 'cafe ole', amountMinor: 425, date: '2026-09-27', ...over })] }))

  it('mismo tipo, cuenta e importe a ±3 días y misma nota → una sugerencia estable', () => {
    const d = two()
    expect(ids(d)).toEqual(['dup:a:b'])
    expect(possibleDuplicates(d)).toHaveLength(1)
    // Nunca se elimina ni combina nada.
    expect(d.transactions).toHaveLength(2)
  })

  it('falsos positivos excluidos: notas distintas, más de 3 días, otra cuenta, transferencias, cuotas parciales y compras divididas', () => {
    expect(ids(two({ note: 'Panadería' }))).toEqual([])
    expect(ids(two({ date: '2026-09-21' }))).toEqual([])
    const sav = account({ id: 'sav', name: 'Ahorro', includeInBudget: false, anchor: { amountMinor: 0, date: TODAY, setAt: EARLIER } })
    const transfers = verifiedMain(baseData({ accounts: [baseData().accounts[0]!, sav], transactions: [tx({ id: 't1', kind: 'transfer', categoryId: undefined, toAccountId: 'sav', amountMinor: 5000 }), tx({ id: 't2', kind: 'transfer', categoryId: undefined, toAccountId: 'sav', amountMinor: 5000 })] }))
    expect(ids(transfers).filter((i) => i.startsWith('dup:'))).toEqual([])
    const partials = verifiedMain(
      baseData({
        schedules: [bill('2026-09-20', 10000, { id: 'r' })],
        transactions: [
          tx({ id: 'p1', amountMinor: 5000, date: '2026-09-26', scheduleId: 'r', occurrenceDate: '2026-09-20', partialSettlement: true }),
          tx({ id: 'p2', amountMinor: 5000, date: '2026-09-27', scheduleId: 'r', occurrenceDate: '2026-09-20' }),
        ],
      }),
    )
    expect(ids(partials).filter((i) => i.startsWith('dup:'))).toEqual([])
    const split = verifiedMain(
      baseData({ transactions: [tx({ id: 's', amountMinor: 1000, categoryId: 'groceries', splits: [{ id: 'l1', categoryId: 'groceries', amountMinor: 500 }, { id: 'l2', categoryId: 'dining', amountMinor: 500 }] })] }),
    )
    expect(ids(split)).toEqual([])
  })

  it('«son distintos» se recuerda hasta que cambien datos relevantes', () => {
    const d = two()
    const kept = ok(dismissInboxItem(d, inboxView(d, TODAY).active[0]!, ctx)).data
    expect(ids(kept)).toEqual([])
    // Cambiar la fecha de uno (sigue dentro de la ventana) vuelve a preguntar.
    const moved = ok(saveTransaction(kept, { ...kept.transactions[1]!, date: '2026-09-28' }, ctx)).data
    expect(ids(moved)).toEqual(['dup:a:b'])
  })
})

describe('bandeja: cuentas para verificar', () => {
  it('distingue último movimiento y última verificación; desaparece al verificar y vuelve tras 30 días', () => {
    const d = baseData({ transactions: [tx({ id: 'x', date: '2026-09-20', categoryId: 'dining' })] })
    expect(inboxView(d, TODAY).active.find((i) => i.kind === 'balance')).toMatchObject({ id: 'bal:main:never', reason: 'neverVerified', lastMovementDate: '2026-09-20', verifiedDate: null })
    const verified = verifiedMain(d)
    expect(inboxView(verified, TODAY).active).toEqual([])
    // Un movimiento nuevo dentro del periodo verificado pide revisar la verificación.
    const edited = ok(saveTransaction(verified, { id: 'late', kind: 'expense', status: 'realized', amountMinor: 2000, date: TODAY, accountId: 'main', categoryId: 'dining' }, ctx)).data
    expect(inboxView(edited, TODAY).active.map((i) => i.reason)).toEqual(['verificationNeedsReview'])
    expect(inboxView(verified, '2026-10-29').active.find((i) => i.kind === 'balance')).toMatchObject({ id: 'bal:main:old', verifiedDate: TODAY, lastMovementDate: '2026-09-20' })
  })
})

describe('bandeja: copias', () => {
  it('lo pospuesto y descartado viaja en la copia y se valida', () => {
    const d = ok(snoozeInboxItem(baseData(), 'bal:main:never', '2026-10-05', ctx)).data
    const r = validateAppData(JSON.parse(JSON.stringify(d)))
    expect(r.ok && r.data.inbox).toEqual(d.inbox)
    const bad = JSON.parse(JSON.stringify(d))
    bad.inbox.snoozed[0].until = 'mañana'
    expect(validateAppData(bad).ok).toBe(false)
  })
})

describe('bandeja: para tener en cuenta', () => {
  const card = (debtMinor: number) =>
    account({ id: 'visa', name: 'Visa', kind: 'credit', includeInBudget: false, anchor: { amountMinor: -debtMinor, date: TODAY, setAt: EARLIER }, card: { limitMinor: 100000 } })
  const attention = (d: AppData, today = TODAY) => inboxView(d, today).active.filter((i) => i.kind === 'attention')

  it('tarjeta: 89 % no avisa, 90 % avisa (descartable), por encima del límite siempre', () => {
    expect(attention(baseData({ accounts: [baseData().accounts[0]!, card(89999)] }))).toEqual([])
    const near = baseData({ accounts: [baseData().accounts[0]!, card(90000)] })
    expect(attention(near).map((i) => [i.id, i.reason, i.amountMinor, i.canDismiss])).toEqual([['card:visa:near', 'cardNearLimit', 90000, true]])
    const dismissed = ok(dismissInboxItem(near, attention(near)[0]!, ctx)).data
    expect(attention(dismissed)).toEqual([])
    // Superar el límite es otro aviso (no se puede descartar).
    const over = { ...dismissed, accounts: [dismissed.accounts[0]!, card(100001)] }
    expect(attention(over).map((i) => [i.reason, i.canDismiss])).toEqual([['cardOverLimit', false]])
  })

  it('meta vencida sin completar: aparece, se descarta y desaparece al completarla o cambiar la fecha', () => {
    const d = baseData({ goals: [goal({ id: 'g', name: 'Viaje', targetMinor: 50000, targetDate: '2026-09-01', allocations: [{ id: 'a', amountMinor: 20000, date: '2026-08-01', createdAt: EARLIER }] })] })
    expect(attention(d).map((i) => [i.id, i.amountMinor])).toEqual([['goal:g:2026-09-01', 30000]])
    expect(attention(ok(dismissInboxItem(d, attention(d)[0]!, ctx)).data)).toEqual([])
    const moved = { ...d, goals: [{ ...d.goals[0]!, targetDate: '2026-12-01' }] }
    expect(attention(moved)).toEqual([])
    const done = { ...d, goals: [{ ...d.goals[0]!, targetMinor: 20000 }] }
    expect(attention(done)).toEqual([])
  })
})

describe('bandeja: límites de categoría y reglas', () => {
  const attention = (d: AppData, today = TODAY) => inboxView(d, today).active.filter((i) => i.kind === 'attention')
  const rule = (over: Partial<AppData['categoryRules'][number]> = {}) => ({
    id: 'r',
    pattern: 'Café Olé',
    kind: 'expense' as const,
    categoryId: 'dining',
    createdAt: '2026-06-01T16:00:00.000Z',
    updatedAt: '2026-06-01T16:00:00.000Z',
    ...over,
  })

  it('plan superado en su ciclo (con líneas de compras divididas): un aviso por plan y ciclo, descartable', () => {
    const plan = { id: 'p1', kind: 'limit' as const, name: '', categoryIds: ['dining'], amountMinor: 5000, currency: 'CAD' as const, periodType: 'month' as const, startDate: '2026-09-01', endDate: '2026-09-30', recurring: true, status: 'active' as const, alertAt80: true, alertAt100: true, createdAt: NOW, updatedAt: NOW }
    const d = baseData({
      plans: [plan],
      transactions: [
        tx({ id: 'a', categoryId: 'dining', amountMinor: 3000, date: '2026-09-02' }),
        tx({ id: 's', amountMinor: 4000, categoryId: 'groceries', date: '2026-09-10', splits: [{ id: 'l1', categoryId: 'groceries', amountMinor: 1999 }, { id: 'l2', categoryId: 'dining', amountMinor: 2001 }] }),
        tx({ id: 'old', categoryId: 'dining', amountMinor: 9000, date: '2026-08-30' }),
      ],
    })
    // 3000 + 2001 = 5001 > 5000: excede por 1 centavo (agosto no cuenta).
    expect(attention(d).map((i) => [i.id, i.reason, i.amountMinor, i.canDismiss, i.categoryId])).toEqual([['plan:p1:2026-09-01', 'planOverLimit', 1, true, 'dining']])
    const atLimit = { ...d, plans: [{ ...plan, amountMinor: 5001 }] }
    expect(attention(atLimit)).toEqual([])
    const dismissed = ok(dismissInboxItem(d, attention(d)[0]!, ctx)).data
    expect(attention(dismissed)).toEqual([])
    // Mes nuevo: el cierre diario completa el plan (resultado guardado) y el aviso desaparece.
    const closed = closeDuePlans(d, { today: '2026-10-01', now: NOW })
    expect(closed.ok && attention(closed.data, '2026-10-01')).toEqual([])
  })

  it('regla con la categoría archivada: se avisa (la regla se ignoraría sin decir nada)', () => {
    const custom = { id: 'c_cafe', kind: 'expense' as const, name: 'Cafés', archived: true, createdAt: EARLIER, updatedAt: EARLIER }
    const d = baseData({ categories: [custom], categoryRules: [rule({ categoryId: 'c_cafe', createdAt: EARLIER })] })
    expect(attention(d).map((i) => [i.id, i.reason, i.ruleId])).toEqual([['rule:r:category', 'ruleCategoryUnavailable', 'r']])
    expect(attention({ ...d, categories: [{ ...custom, archived: false }] })).toEqual([])
  })

  it('regla sin uso: solo si tiene ≥ 90 días y ningún movimiento de los últimos 90 días contiene su texto', () => {
    // Creada el 1-jun (119 días antes) y sin coincidencias.
    const unused = baseData({ categoryRules: [rule()], transactions: [tx({ id: 'x', note: 'CAFE OLE #12', date: '2026-05-20', categoryId: 'dining' })] })
    expect(attention(unused).map((i) => [i.id, i.reason, i.lastMovementDate])).toEqual([['rule:r:unused', 'ruleUnused', '2026-05-20']])
    // Una coincidencia reciente (sin acentos ni mayúsculas) la mantiene en uso.
    const used = { ...unused, transactions: [...unused.transactions, tx({ id: 'y', note: 'cafe ole centro', date: '2026-08-15', categoryId: 'dining' })] }
    expect(attention(used)).toEqual([])
    // Un ingreso con el mismo texto no cuenta para una regla de gastos.
    const income = { ...unused, transactions: [tx({ id: 'z', kind: 'income', categoryId: 'salary', note: 'Café Olé', date: '2026-09-01' })] }
    expect(attention(income).map((i) => i.id)).toEqual(['rule:r:unused'])
    // Regla reciente (menos de 90 días): todavía no se juzga.
    expect(attention(baseData({ categoryRules: [rule({ createdAt: '2026-07-15T16:00:00.000Z' })] }))).toEqual([])
    // Descartar se recuerda hasta que cambie el texto o la categoría.
    const kept = ok(dismissInboxItem(unused, attention(unused)[0]!, ctx)).data
    expect(attention(kept)).toEqual([])
    expect(attention({ ...kept, categoryRules: [rule({ pattern: 'Olé café' })] }).map((i) => i.id)).toEqual(['rule:r:unused'])
    // Nunca se borra nada.
    expect(kept.categoryRules).toHaveLength(1)
  })
})

describe('bandeja: confirmación automática que registró el importe completo tras un parcial (QA-02)', () => {
  it('señala el movimiento sobrante con lo registrado de más; corregir el importe lo resuelve; se puede descartar', () => {
    const schedule = bill('2026-09-20', 100000, { id: 'rent', name: 'Renta', autoConfirm: true })
    const partial = tx({ id: 'p', amountMinor: 40000, scheduleId: 'rent', occurrenceDate: '2026-09-20', partialSettlement: true, date: '2026-09-20' })
    const wrongFinal = tx({ id: 'f', amountMinor: 100000, scheduleId: 'rent', occurrenceDate: '2026-09-20', source: 'scheduled', date: '2026-09-21' })
    const data = baseData({ schedules: [schedule], transactions: [partial, wrongFinal] })
    const item = inboxView(data, ctx.today).active.find((i) => i.reason === 'autoConfirmOverstated')
    expect(item).toMatchObject({ id: 'int:auto:f', kind: 'integrity', amountMinor: 40000, txIds: ['f', 'p'], date: '2026-09-20', canDismiss: true })
    // Corregido a mano al resto (60000): el aviso desaparece.
    const fixed = saveTransaction(data, { ...wrongFinal, amountMinor: 60000 }, ctx)
    expect(fixed.ok && inboxView(fixed.data, ctx.today).active.some((i) => i.reason === 'autoConfirmOverstated')).toBe(false)
    // «Revisado» se recuerda mientras no cambien los datos relevantes.
    const dismissed = dismissInboxItem(data, item!, ctx)
    expect(dismissed.ok && inboxView(dismissed.data, ctx.today).active.some((i) => i.reason === 'autoConfirmOverstated')).toBe(false)
  })
})

describe('v15: pagos capturados por revisar', () => {
  it('un movimiento «Por revisar» en «Otros gastos» no sale además como sin categoría; al revisarlo, sí', () => {
    const captured = tx({ id: 'cap-a0000001', categoryId: 'other_expense', captureId: 'cap-a0000001', source: 'apple_pay', review: { needed: true, reason: 'auto_capture' } })
    const ids = (data: AppData) => inboxView(data, TODAY).active.filter((i) => i.kind === 'uncategorized').map((i) => i.id)
    expect(ids(baseData({ transactions: [captured] }))).toEqual([])
    const { review: _review, ...reviewed } = captured
    expect(ids(baseData({ transactions: [reviewed] }))).toEqual(['cat:cap-a0000001'])
  })
})
