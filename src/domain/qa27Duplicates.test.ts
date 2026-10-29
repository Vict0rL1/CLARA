/**
 * Auditoría independiente del 2026-10-29 (QA27-03b, hallazgo propio al verificar QA27-03 en el navegador): con los
 * 5 000 gastos iguales del mismo día de la prueba de la auditoría, la bandeja calculaba 12,5 millones de parejas de
 * «posible duplicado» y la pestaña se quedaba sin memoria (también en `21b4ed8`). La lista por grupo tiene tope.
 */
import { describe, expect, it } from 'vitest'
import { DUPLICATE_PAIRS_PER_GROUP, inboxView, possibleDuplicates } from './inbox'
import { account, baseData, tx } from '../test/fixtures'

describe('QA27-03b · posibles duplicados con tope por grupo', () => {
  const many = (prefix: string, date: string, kind: 'expense' | 'refund', count: number) => Array.from({ length: count }, (_, i) => tx({ id: `${prefix}${String(i).padStart(4, '0')}`, date, amountMinor: 987654321000, kind, status: 'realized', categoryId: 'groceries' }))
  const fixture = () =>
    baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 0, date: '2026-08-01', setAt: '2026-08-01T12:00:00.000Z' } })],
      transactions: [...many('e', '2026-09-10', 'expense', 5000), ...many('r', '2026-10-10', 'refund', 5000)],
    })

  it('5 000 gastos y 5 000 devoluciones iguales el mismo día: 50 parejas por grupo, siempre las mismas, y la bandeja se calcula en menos de un segundo', () => {
    const d = fixture()
    const t0 = performance.now()
    const pairs = possibleDuplicates(d)
    const view = inboxView(d, '2026-10-27')
    expect(performance.now() - t0).toBeLessThan(1000)
    expect(pairs).toHaveLength(2 * DUPLICATE_PAIRS_PER_GROUP)
    expect(pairs.slice(0, 3).map(([a, b]) => [a.id, b.id])).toEqual([['e0000', 'e0001'], ['e0000', 'e0002'], ['e0000', 'e0003']])
    expect(view.active.filter((i) => i.kind === 'duplicate')).toHaveLength(2 * DUPLICATE_PAIRS_PER_GROUP)
    expect(possibleDuplicates(d).map(([a, b]) => `${a.id}:${b.id}`)).toEqual(pairs.map(([a, b]) => `${a.id}:${b.id}`))
  })

  it('por debajo del tope nada cambia: tres iguales en tres días son tres parejas; un cuarto a más de tres días no entra', () => {
    const d = baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 0, date: '2026-08-01', setAt: '2026-08-01T12:00:00.000Z' } })],
      transactions: [tx({ id: 'a', date: '2026-09-10', amountMinor: 1200, kind: 'expense', status: 'realized' }), tx({ id: 'b', date: '2026-09-11', amountMinor: 1200, kind: 'expense', status: 'realized' }), tx({ id: 'c', date: '2026-09-13', amountMinor: 1200, kind: 'expense', status: 'realized' }), tx({ id: 'd', date: '2026-09-20', amountMinor: 1200, kind: 'expense', status: 'realized' })],
    })
    expect(possibleDuplicates(d).map(([a, b]) => `${a.id}:${b.id}`)).toEqual(['a:b', 'a:c', 'b:c'])
  })
})
