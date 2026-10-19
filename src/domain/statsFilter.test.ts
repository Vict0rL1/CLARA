import { describe, expect, it } from 'vitest'
import { categoryBreakdown, periodStats, statsRange, topMerchants } from './statistics'
import { filterStatsData, statsFilterCount, txMerchantKey } from './statsFilter'
import { account, baseData, ctx, tx } from '../test/fixtures'

/** Septiembre de 2026, dos cuentas, etiquetas y el mismo comercio escrito de dos formas. */
const data = baseData({
  accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 100000, date: '2026-08-01', setAt: '2026-08-01T12:00:00.000Z' } }), account({ id: 'card', name: 'Tarjeta', kind: 'credit', anchor: { amountMinor: 0, date: '2026-08-01', setAt: '2026-08-01T12:00:00.000Z' } })],
  transactions: [
    tx({ id: 'u1', date: '2026-09-03', amountMinor: 1850, categoryId: 'dining', note: 'UBER *EATS 8XK2L', accountId: 'card', tagIds: ['trip'] }),
    tx({ id: 'u2', date: '2026-09-10', amountMinor: 2200, categoryId: 'dining', merchant: 'Uber Eats', accountId: 'main' }),
    tx({ id: 'g1', date: '2026-09-12', amountMinor: 8000, categoryId: 'groceries', note: 'Super', accountId: 'main', tagIds: ['trip'] }),
    tx({ id: 'r1', kind: 'refund', date: '2026-09-14', amountMinor: 500, categoryId: 'dining', note: 'Uber Eats', accountId: 'card' }),
    tx({ id: 'in', kind: 'income', date: '2026-09-15', amountMinor: 150000, categoryId: 'salary', accountId: 'main' }),
    tx({ id: 'tr', kind: 'transfer', date: '2026-09-20', amountMinor: 30000, categoryId: undefined, accountId: 'main', toAccountId: 'card' }),
  ],
})
const range = statsRange('month', data.settings, ctx.today)

describe('filtros de Estadísticas', () => {
  it('sin filtro son los mismos datos; con filtro solo cambian los movimientos', () => {
    expect(filterStatsData(data, {})).toBe(data)
    const f = filterStatsData(data, { accountId: 'card' })
    expect(f.transactions.map((t) => t.id)).toEqual(['u1', 'r1'])
    expect(f.accounts).toBe(data.accounts)
    expect(f.settings).toBe(data.settings)
  })

  it('por cuenta: cada cifra se calcula igual sobre los movimientos de esa cuenta; la transferencia no cuenta nunca', () => {
    const card = periodStats(filterStatsData(data, { accountId: 'card' }), 'month', range)
    expect([card.incomeMinor, card.expensesMinor, card.netMinor]).toEqual([0, 1850 - 500, -(1850 - 500)])
    const main = periodStats(filterStatsData(data, { accountId: 'main' }), 'month', range)
    expect([main.incomeMinor, main.expensesMinor]).toEqual([150000, 2200 + 8000])
    // Las dos cuentas suman lo mismo que sin filtro.
    const all = periodStats(data, 'month', range)
    expect(card.expensesMinor + main.expensesMinor).toBe(all.expensesMinor)
  })

  it('por comercio: la misma clave que «Top comercios» junta las variantes (también la devolución)', () => {
    const key = txMerchantKey({ note: 'UBER *EATS 8XK2L' })
    expect(key).toBe(txMerchantKey({ merchant: 'Uber Eats' }))
    const uber = filterStatsData(data, { merchant: key! })
    expect(uber.transactions.map((t) => t.id)).toEqual(['u1', 'u2', 'r1'])
    expect(periodStats(uber, 'month', range).expensesMinor).toBe(1850 + 2200 - 500)
    expect(topMerchants(uber, range)).toMatchObject([{ key, amountMinor: 3550, count: 3 }])
    expect(txMerchantKey({ note: '   ' })).toBeNull()
  })

  it('por etiqueta, y varios filtros a la vez se combinan con «y»', () => {
    const trip = filterStatsData(data, { tagId: 'trip' })
    expect(categoryBreakdown(trip, range).categories.map((c) => [c.categoryId, c.netMinor])).toEqual([
      ['groceries', 8000],
      ['dining', 1850],
    ])
    const both = { tagId: 'trip', accountId: 'main' }
    expect(statsFilterCount(both)).toBe(2)
    expect(filterStatsData(data, both).transactions.map((t) => t.id)).toEqual(['g1'])
  })
})
