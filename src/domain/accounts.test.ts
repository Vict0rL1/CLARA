import { describe, expect, it } from 'vitest'
import { accountBalance, activeAccounts, isBudgetAccount, netPosition, sortedAccounts, spendableBalance, txEffectOnBudgetPool } from './balances'
import { reorderAccounts, saveAccount, saveSchedule, saveTransaction, setAccountArchived, trashTransactions, restoreFromTrash } from './operations'
import { account, baseData, ctx, schedule, tx, TODAY } from '../test/fixtures'

/**
 * Etapa 1 del programa (cuentas y transferencias): archivar conservando el historial, ordenar,
 * patrimonio neto y las invariantes de transferencias y tarjetas (FORMULAS §0, §4, §10).
 */
const bank = account({ id: 'bank', name: 'Banco', kind: 'bank', anchor: { amountMinor: 100000, date: TODAY, setAt: '2026-09-28T13:00:00.000Z' } })
const savings = account({ id: 'sav', name: 'Ahorro', kind: 'savings', includeInBudget: false, anchor: { amountMinor: 50000, date: TODAY, setAt: '2026-09-28T13:00:00.000Z' } })
const card = account({ id: 'card', name: 'Visa', kind: 'credit', anchor: { amountMinor: -20000, date: TODAY, setAt: '2026-09-28T13:00:00.000Z' } })
const old = account({ id: 'old', name: 'Cuenta vieja', kind: 'bank', includeInBudget: true, archived: true, anchor: { amountMinor: 5000, date: TODAY, setAt: '2026-09-28T13:00:00.000Z' } })
const data = () => baseData({ accounts: [bank, savings, card, old] })

describe('cuentas archivadas y orden', () => {
  it('una archivada no cuenta para el presupuesto aunque esté marcada como incluida', () => {
    expect(isBudgetAccount(old)).toBe(false)
    expect(isBudgetAccount(bank)).toBe(true)
    expect(spendableBalance(data()).totalMinor).toBe(100000 - 20000)
    expect(txEffectOnBudgetPool({ kind: 'expense', amountMinor: 100, accountId: 'old' }, data().accounts)).toBe(0)
  })

  it('su historial y su saldo se conservan: el saldo de la cuenta sigue calculándose igual', () => {
    const d = baseData({ accounts: [bank, old], transactions: [tx({ id: 't1', accountId: 'old', kind: 'expense', amountMinor: 1000, date: TODAY })] })
    expect(accountBalance(d, old).balanceMinor).toBe(4000)
    expect(activeAccounts(d.accounts).map((a) => a.id)).toEqual(['bank'])
    expect(sortedAccounts(d.accounts).map((a) => a.id)).toEqual(['bank', 'old'])
  })

  it('el orden sigue `order` y, sin él, la posición en la lista', () => {
    const a = account({ id: 'a', order: 2 })
    const b = account({ id: 'b' })
    const c = account({ id: 'c', order: 0 })
    expect(sortedAccounts([a, b, c]).map((x) => x.id)).toEqual(['c', 'b', 'a'])
  })

  it('no se registra ni se programa nada nuevo en una cuenta archivada; lo existente se puede editar', () => {
    const d = baseData({ accounts: [bank, old], transactions: [tx({ id: 't1', accountId: 'old', kind: 'expense', amountMinor: 1000, date: TODAY })] })
    const nuevo = saveTransaction(d, { id: 'n1', kind: 'expense', status: 'realized', amountMinor: 500, date: TODAY, accountId: 'old', categoryId: 'groceries' }, ctx)
    expect(nuevo.ok).toBe(false)
    if (!nuevo.ok) expect(nuevo.issues).toEqual([{ path: 'accountId', code: 'accountArchived' }])
    const transferencia = saveTransaction(d, { id: 'n2', kind: 'transfer', status: 'realized', amountMinor: 500, date: TODAY, accountId: 'bank', toAccountId: 'old' }, ctx)
    expect(transferencia.ok).toBe(false)
    if (!transferencia.ok) expect(transferencia.issues[0]).toMatchObject({ path: 'toAccountId', code: 'accountArchived' })
    const editado = saveTransaction(d, { id: 't1', kind: 'expense', status: 'realized', amountMinor: 1200, date: TODAY, accountId: 'old', categoryId: 'groceries' }, ctx)
    expect(editado.ok).toBe(true)
    const programado = saveSchedule(d, { ...schedule({ id: 's1', accountId: 'old' }), reminderDaysBefore: 1 }, ctx)
    expect(programado.ok).toBe(false)
    if (!programado.ok) expect(programado.issues).toEqual([{ path: 'accountId', code: 'accountArchived' }])
  })

  it('archivar: no la última del presupuesto, no con programados activos; con saldo sí (la interfaz avisa)', () => {
    const d = data()
    const ultima = setAccountArchived(baseData({ accounts: [bank, old] }), 'bank', true, ctx)
    expect(ultima.ok).toBe(false)
    if (!ultima.ok) expect(ultima.issues).toEqual([{ path: 'id', code: 'lastBudgetAccount' }])
    const conProgramado = setAccountArchived({ ...d, schedules: [schedule({ id: 's1', accountId: 'sav' })] }, 'sav', true, ctx)
    expect(conProgramado.ok).toBe(false)
    if (!conProgramado.ok) expect(conProgramado.issues).toEqual([{ path: 'id', code: 'accountHasSchedules', params: { count: 1 } }])
    const pausado = setAccountArchived({ ...d, schedules: [schedule({ id: 's1', accountId: 'sav', paused: true })] }, 'sav', true, ctx)
    expect(pausado.ok).toBe(true)
    const r = setAccountArchived(d, 'sav', true, ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.accounts.find((a) => a.id === 'sav')).toMatchObject({ archived: true, anchor: savings.anchor, updatedAt: ctx.now })
    // Nada más cambia: saldos, movimientos y el resto de cuentas quedan como estaban.
    expect(r.data.transactions).toEqual(d.transactions)
    expect(r.data.accounts.filter((a) => a.id !== 'sav')).toEqual(d.accounts.filter((a) => a.id !== 'sav'))
    const back = setAccountArchived(r.data, 'sav', false, ctx)
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.data.accounts.find((a) => a.id === 'sav')).toEqual({ ...savings, updatedAt: ctx.now })
    expect(setAccountArchived(d, 'bank', false, ctx)).toMatchObject({ ok: true, unchanged: true })
    expect(setAccountArchived(d, 'nope', true, ctx)).toMatchObject({ ok: false })
  })

  it('reordenar: solo con todos los ids una vez; solo cambia `order`', () => {
    const d = data()
    const r = reorderAccounts(d, ['card', 'bank', 'old', 'sav'], ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(sortedAccounts(r.data.accounts).map((a) => a.id)).toEqual(['card', 'bank', 'old', 'sav'])
    expect(activeAccounts(r.data.accounts).map((a) => a.id)).toEqual(['card', 'bank', 'sav'])
    expect(r.data.accounts.map((a) => ({ ...a, order: undefined, updatedAt: undefined }))).toEqual(d.accounts.map((a) => ({ ...a, order: undefined, updatedAt: undefined })))
    expect(reorderAccounts(d, ['card', 'bank', 'old'], ctx)).toMatchObject({ ok: false, issues: [{ path: 'orderedIds', code: 'invalidValue' }] })
    expect(reorderAccounts(d, ['card', 'bank', 'old', 'sav', 'sav'], ctx)).toMatchObject({ ok: false })
    expect(reorderAccounts(r.data, ['card', 'bank', 'old', 'sav'], ctx)).toMatchObject({ ok: true, unchanged: true })
  })

  it('editar una cuenta conserva archivada y orden; una cuenta nueva va al final', () => {
    const d = baseData({ accounts: [{ ...bank, order: 3 }, { ...old, order: 1 }] })
    const edit = saveAccount(d, { id: 'old', name: 'Cuenta vieja 2', kind: 'bank', includeInBudget: true }, ctx)
    expect(edit.ok).toBe(true)
    if (edit.ok) expect(edit.value).toMatchObject({ archived: true, order: 1, name: 'Cuenta vieja 2' })
    const nueva = saveAccount(d, { id: 'n', name: 'Nueva', kind: 'cash', includeInBudget: true }, ctx)
    expect(nueva.ok).toBe(true)
    if (nueva.ok) expect(nueva.value.order).toBe(4)
  })
})

describe('patrimonio neto', () => {
  it('activos − pasivos, presupuesto aparte y archivadas informadas sin sumar', () => {
    const n = netPosition(data())
    expect(n).toMatchObject({ assetsMinor: 150000, liabilitiesMinor: 20000, netMinor: 130000, budgetMinor: 80000, archivedMinor: 5000 })
    expect(n.accounts.map((b) => b.account.id)).toEqual(['bank', 'sav', 'card', 'old'])
  })

  it('transferir entre cuentas propias no crea ni destruye dinero; pagar la tarjeta tampoco', () => {
    const d = data()
    const before = netPosition(d)
    const r1 = saveTransaction(d, { id: 'tr1', kind: 'transfer', status: 'realized', amountMinor: 30000, date: TODAY, accountId: 'bank', toAccountId: 'sav' }, ctx)
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const afterSavings = netPosition(r1.data)
    expect(afterSavings.netMinor).toBe(before.netMinor)
    expect(afterSavings.budgetMinor).toBe(before.budgetMinor - 30000)
    // Pago de tarjeta: baja el activo del banco y el pasivo de la tarjeta por igual.
    const r2 = saveTransaction(r1.data, { id: 'tr2', kind: 'transfer', status: 'realized', amountMinor: 20000, date: TODAY, accountId: 'bank', toAccountId: 'card' }, ctx)
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    const afterPay = netPosition(r2.data)
    expect(afterPay).toMatchObject({ netMinor: before.netMinor, liabilitiesMinor: 0, assetsMinor: before.assetsMinor - 20000 })
    expect(afterPay.budgetMinor).toBe(afterSavings.budgetMinor)
    expect(txEffectOnBudgetPool(r2.data.transactions.find((t) => t.id === 'tr2')!, r2.data.accounts)).toBe(0)
  })

  it('una transferencia es un solo registro: a la papelera y de vuelta, las dos cuentas cambian a la vez', () => {
    const d = data()
    const saved = saveTransaction(d, { id: 'tr1', kind: 'transfer', status: 'realized', amountMinor: 30000, date: TODAY, accountId: 'bank', toAccountId: 'sav' }, ctx)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    const bal = (x: typeof d, id: string) => accountBalance(x, x.accounts.find((a) => a.id === id)!).balanceMinor
    expect([bal(saved.data, 'bank'), bal(saved.data, 'sav')]).toEqual([70000, 80000])
    const trashed = trashTransactions(saved.data, ['tr1'], ctx)
    expect(trashed.ok).toBe(true)
    if (!trashed.ok) return
    expect([bal(trashed.data, 'bank'), bal(trashed.data, 'sav')]).toEqual([100000, 50000])
    expect(netPosition(trashed.data).netMinor).toBe(netPosition(d).netMinor)
    const restored = restoreFromTrash(trashed.data, 'tr1', ctx)
    expect(restored.ok).toBe(true)
    if (restored.ok) expect([bal(restored.data, 'bank'), bal(restored.data, 'sav')]).toEqual([70000, 80000])
  })
})
