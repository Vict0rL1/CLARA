import { describe, expect, it } from 'vitest'
import { similarTransactions } from './duplicates'
import { baseData, tx, TODAY } from '../test/fixtures'

const draft = (over: Partial<Parameters<typeof similarTransactions>[1]> = {}) => ({ id: 'new', kind: 'expense' as const, accountId: 'main', amountMinor: 450, date: TODAY, ...over })

describe('posible duplicado antes de guardar', () => {
  it('avisa con el mismo tipo, cuenta e importe a ±3 días; no con 4 días ni con otro importe', () => {
    const data = baseData({
      transactions: [
        tx({ id: 'a', amountMinor: 450, date: '2026-09-26', note: 'café' }),
        tx({ id: 'b', amountMinor: 450, date: '2026-09-24', note: 'café' }),
        tx({ id: 'c', amountMinor: 451, date: TODAY }),
      ],
    })
    expect(similarTransactions(data, draft({ note: 'Café' })).map((t) => t.id)).toEqual(['a'])
    expect(similarTransactions(data, draft({ amountMinor: 451 })).map((t) => t.id)).toEqual(['c'])
  })

  it('las notas distintas descartan; una nota vacía no', () => {
    const data = baseData({ transactions: [tx({ id: 'a', amountMinor: 450, date: TODAY, note: 'gasolina' }), tx({ id: 'b', amountMinor: 450, date: TODAY })] })
    expect(similarTransactions(data, draft({ note: 'café' })).map((t) => t.id)).toEqual(['b'])
    expect(similarTransactions(data, draft()).map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('no compara transferencias, ajustes, previstos, otra cuenta, el propio id ni la misma ocurrencia del calendario', () => {
    const data = baseData({
      transactions: [
        tx({ id: 'self', amountMinor: 450, date: TODAY }),
        tx({ id: 'planned', amountMinor: 450, date: TODAY, status: 'planned' }),
        tx({ id: 'other', amountMinor: 450, date: TODAY, accountId: 'cash' }),
        tx({ id: 'occ', amountMinor: 450, date: TODAY, scheduleId: 's1', occurrenceDate: TODAY }),
      ],
    })
    expect(similarTransactions(data, draft({ id: 'self' }), 's1')).toEqual([])
    expect(similarTransactions(data, draft({ kind: 'transfer' }))).toEqual([])
    expect(similarTransactions(data, draft({ kind: 'adjustment' }))).toEqual([])
    expect(similarTransactions(data, draft({ id: 'x' })).map((t) => t.id)).toEqual(['occ', 'self'])
  })

  it('un importe no válido o una fecha mal formada no avisan de nada', () => {
    const data = baseData({ transactions: [tx({ id: 'a', amountMinor: 450, date: TODAY })] })
    expect(similarTransactions(data, draft({ amountMinor: 0 }))).toEqual([])
    expect(similarTransactions(data, draft({ amountMinor: 4.5 }))).toEqual([])
    expect(similarTransactions(data, draft({ date: '28/09/2026' }))).toEqual([])
  })
})
