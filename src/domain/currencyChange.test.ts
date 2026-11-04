import { describe, expect, it } from 'vitest'
import { canChangeCurrency, monetaryRecords } from './currencyChange'
import { recordHistory } from './history'
import { revertEntry } from './historyRevert'
import { changeCurrency, updateSettings } from './operations'
import { validateAppData } from '../storage/backup'
import { account, baseData, ctx, EARLIER, goal, NOW, TODAY, tx } from '../test/fixtures'

/** Presupuesto sin ningún importe guardado: la única situación en la que cambiar la moneda es seguro. */
const empty = (balanceMinor = 0) => baseData({ accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: balanceMinor, date: TODAY, setAt: EARLIER } })] })

describe('cambiar la moneda del presupuesto (QA-01)', () => {
  it('sin importes guardados cambia la moneda; la misma moneda no cambia nada; una desconocida se rechaza', () => {
    const r = changeCurrency(empty(), 'MXN', ctx)
    expect(r.ok && r.data.settings.currency).toBe('MXN')
    expect(r.ok && validateAppData(r.data).ok).toBe(true)
    expect(changeCurrency(empty(), 'CAD', ctx)).toMatchObject({ ok: true, unchanged: true })
    expect(changeCurrency(empty(), 'XXX' as never, ctx).ok).toBe(false)
  })

  it.each([
    ['positivo', 200000],
    ['negativo (sobregiro)', -5000],
  ])('un saldo de referencia %s sin movimientos bloquea el cambio a JPY y a USD: el entero no se reinterpreta', (_label, balance) => {
    const data = empty(balance)
    for (const code of ['JPY', 'USD'] as const) {
      const r = changeCurrency(data, code, ctx)
      expect(r).toMatchObject({ ok: false, issues: [{ path: 'currency', code: 'currencyMismatch', params: { expected: 'CAD' } }] })
    }
    // Nada cambió: la misma referencia, el mismo saldo y la misma moneda.
    expect(data.settings.currency).toBe('CAD')
    expect(data.accounts[0]!.anchor.amountMinor).toBe(balance)
  })

  it('un saldo en cero no es dinero: se puede cambiar; una tarjeta con límite o pago mínimo sí bloquea', () => {
    expect(changeCurrency(empty(0), 'JPY', ctx).ok).toBe(true)
    const card = baseData({ accounts: [account({ id: 'visa', kind: 'credit', anchor: { amountMinor: 0, date: TODAY, setAt: EARLIER }, card: { limitMinor: 500000 } })] })
    expect(monetaryRecords(card)).toEqual(['cardSettings'])
    expect(changeCurrency(card, 'JPY', ctx).ok).toBe(false)
    const floor = baseData({ accounts: [account({ id: 'visa', kind: 'credit', anchor: { amountMinor: 0, date: TODAY, setAt: EARLIER }, card: { minPaymentFloorMinor: 1000 } })] })
    expect(canChangeCurrency(floor)).toBe(false)
  })

  it('cada colección con importes bloquea y se nombra', () => {
    const base = empty()
    const favorite = { id: 'f', name: 'Café', kind: 'expense' as const, accountId: 'main', categoryId: 'dining', amountMinor: 100, order: 0, createdAt: ctx.now, updatedAt: ctx.now }
    expect(monetaryRecords(baseData({ ...base, transactions: [tx({ id: 't' })] }))).toEqual(['transactions'])
    expect(monetaryRecords(baseData({ ...base, trash: [{ id: 'tr', deletedAt: NOW, transaction: tx({ id: 't' }), unlinkedRefundIds: [] }] }))).toEqual(['trash'])
    expect(monetaryRecords(baseData({ ...base, goals: [goal()] }))).toEqual(['goals'])
    expect(monetaryRecords(baseData({ ...base, favorites: [favorite] }))).toEqual(['favorites'])
    expect(monetaryRecords(baseData({ ...base, favorites: [{ ...favorite, amountMinor: undefined }] }))).toEqual([])
    expect(monetaryRecords(baseData({ ...base, categoryLimits: [{ categoryId: 'dining', monthlyLimitMinor: 10000 }] }))).toEqual(['categoryLimits'])
    expect(monetaryRecords(baseData({ ...base, templates: [{ id: 'tp', name: 'Mitad', kind: 'split', lines: [{ categoryId: 'dining', amount: { mode: 'percent', bps: 5000 } }], createdAt: NOW, updatedAt: NOW }] }))).toEqual([])
    expect(monetaryRecords(baseData({ ...base, templates: [{ id: 'tp', name: 'Fijo', kind: 'split', lines: [{ categoryId: 'dining', amount: { mode: 'fixed', amountMinor: 500 } }], createdAt: NOW, updatedAt: NOW }] }))).toEqual(['templates'])
    expect(changeCurrency(baseData({ ...base, goals: [goal()] }), 'MXN', ctx).ok).toBe(false)
  })

  it('deshacer el cambio desde el historial sigue la misma regla: con importes guardados ya no se vuelve atrás', () => {
    const changed = changeCurrency(empty(), 'MXN', ctx)
    if (!changed.ok) throw new Error('fixture')
    const withHistory = recordHistory(empty(), changed.data, NOW)
    const entry = withHistory.history.at(-1)!
    expect(entry.changes.some((c) => c.collection === 'settings')).toBe(true)
    // Sin importes todavía: se puede deshacer.
    const undone = revertEntry(withHistory, entry.id, ctx)
    expect(undone.ok && undone.data.settings.currency).toBe('CAD')
    // Con un saldo ya registrado en MXN: deshacer reinterpretaría ese saldo → se rechaza sin tocar nada.
    const withMoney = { ...withHistory, accounts: [account({ id: 'main', anchor: { amountMinor: 123400, date: TODAY, setAt: EARLIER } })] }
    expect(revertEntry(withMoney, entry.id, ctx)).toMatchObject({ ok: false, issues: [{ code: 'currencyMismatch' }] })
  })

  it('los demás ajustes no tocan la moneda', () => {
    const r = updateSettings(empty(200000), { fallbackHorizonDays: 14 }, ctx)
    expect(r.ok && r.data.settings).toMatchObject({ currency: 'CAD', fallbackHorizonDays: 14 })
  })
})
