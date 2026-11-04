/**
 * Auditoría independiente del 2026-10-29 sobre `21b4ed8` (QA27-03, P2): totales seguros cuya DIFERENCIA no cabe en un
 * entero exacto no deben romper Análisis, Estadísticas ni la Revisión semanal: el porcentaje exacto sale de los
 * operandos (−200 %) y la diferencia se declara sin cifra. Datos sintéticos; fechas explícitas.
 */
import { describe, expect, it } from 'vitest'
import { analysisItems } from './analysis'
import { checkedPercentChange } from './money'
import { periodStats, statsRange } from './statistics'
import type { AppData } from './types'
import { weeklyReview } from './weeklyReview'
import { backupText, parseBackup, validateAppData } from '../storage/backup'
import { account, baseData, tx } from '../test/fixtures'

const persisted = (d: AppData): AppData => JSON.parse(JSON.stringify(d)) as AppData
const roundTrip = (d: AppData, today: string): AppData => {
  const r = parseBackup(backupText(persisted(d), new Date(`${today}T12:00:00.000Z`), 'test'))
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.data
}

describe('QA27-03 (P2) · totales seguros con una diferencia que no cabe en un entero exacto', () => {
  const X = 987654321000
  const many = (prefix: string, date: string, kind: 'expense' | 'refund') => Array.from({ length: 5000 }, (_, i) => tx({ id: `${prefix}${i}`, date, amountMinor: X, kind, status: 'realized', categoryId: 'groceries' }))
  const fixture = () =>
    baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 0, date: '2026-08-01', setAt: '2026-08-01T12:00:00.000Z' } })],
      transactions: [...many('e', '2026-09-10', 'expense'), ...many('r', '2026-10-10', 'refund')],
    })
  const TODAY = '2026-10-27'

  it('la copia y la validación pasan; Análisis no se rompe y dice −200 % exactos (4 938 271 605 000 000 → −4 938 271 605 000 000); ninguna fila con una cifra que no cabe', () => {
    const d = fixture()
    expect(validateAppData(persisted(d)).ok).toBe(true)
    const again = roundTrip(d, TODAY)
    for (const data of [d, again]) {
      const items = analysisItems(data, TODAY)
      const change = items.find((i) => i.id === 'spendingUp' || i.id === 'spendingDown')
      expect(change?.id).toBe('spendingDown')
      expect(change?.params).toMatchObject({ percent: 200, previous: 4938271605000000, current: -4938271605000000 })
      for (const row of change!.because) if (row.kind === 'money') expect(Number.isSafeInteger(row.value)).toBe(true)
    }
  })

  it('Estadísticas: el porcentaje es −200 y la diferencia se declara sin cifra; la Revisión semanal igual', () => {
    const d = fixture()
    const s = periodStats(d, 'month', statsRange('month', d.settings, TODAY))
    expect(s.expenses).toEqual({ diffMinor: null, percent: -200 })
    const w = baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 0, date: '2026-10-01', setAt: '2026-10-01T12:00:00.000Z' } })],
      transactions: [...many('e', '2026-10-14', 'expense'), ...many('r', '2026-10-21', 'refund')],
    })
    expect(weeklyReview(w, '2026-10-19', '2026-10-27').spendingChange).toEqual({ diffMinor: null, percent: -200 })
  })

  it('el caso corregido antes sigue igual: 9 900 % exactos; ±9,99 % y ±10 % simétricos; base 0 sin división', () => {
    const seed = (previous: number, current: number) =>
      baseData({
        accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 0, date: '2026-07-01', setAt: '2026-07-01T12:00:00.000Z' } })],
        transactions: [tx({ id: 'p', date: '2026-08-10', amountMinor: previous, kind: 'expense', status: 'realized' }), tx({ id: 'c', date: '2026-09-10', amountMinor: current, kind: 'expense', status: 'realized' })],
      })
    const change = (previous: number, current: number) => {
      const item = analysisItems(seed(previous, current), '2026-09-28').find((i) => i.id === 'spendingUp' || i.id === 'spendingDown')
      return item ? [item.id, item.params.percent] : null
    }
    expect(change(100, 10000)).toEqual(['spendingUp', 9900])
    expect(change(10000, 10999)).toBeNull()
    expect(change(10000, 11000)).toEqual(['spendingUp', 10])
    expect(change(10000, 9001)).toBeNull()
    expect(change(10000, 9000)).toEqual(['spendingDown', 10])
    const zero = baseData({ accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 0, date: '2026-07-01', setAt: '2026-07-01T12:00:00.000Z' } })], transactions: [tx({ id: 'c', date: '2026-09-10', amountMinor: 5000, kind: 'expense', status: 'realized' })] })
    expect(analysisItems(zero, '2026-09-28').some((i) => i.id === 'spendingUp' || i.id === 'spendingDown')).toBe(false)
  })
})

describe('QA27 · revisión financiera F2 (P3) y O2: sin cifra de diferencia no se afirma «lo mismo»; el porcentaje nunca es «-0»', () => {
  const X = 987654321000
  const many = (prefix: string, date: string, kind: 'expense' | 'refund', count = 5000) => Array.from({ length: count }, (_, i) => tx({ id: `${prefix}${i}`, date, amountMinor: X, kind, status: 'realized', categoryId: 'groceries' }))
  const week = (transactions: AppData['transactions']) =>
    baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 0, date: '2026-08-01', setAt: '2026-08-01T12:00:00.000Z' } })],
      transactions,
    })

  it('la semana pasada 5 000 gastos y esta 5 000 devoluciones (diferencia −9 876 543 210 000 000, no cabe): −200 % y ninguna observación de más/menos/lo mismo', () => {
    const r = weeklyReview(week([...many('p', '2026-10-14', 'expense'), ...many('c', '2026-10-21', 'refund')]), '2026-10-19', '2026-10-22')
    expect(r.spendingChange).toEqual({ diffMinor: null, percent: -200 })
    expect(r.observations.map((o) => o.id).filter((id) => id.startsWith('spending'))).toEqual([])
  })

  it('con diferencia exactamente 0 sí dice «lo mismo»; con una diferencia que cabe, «más» o «menos» con el importe', () => {
    const same = weeklyReview(week([tx({ id: 'a', date: '2026-10-14', amountMinor: 5000, kind: 'expense', status: 'realized', categoryId: 'groceries' }), tx({ id: 'b', date: '2026-10-21', amountMinor: 5000, kind: 'expense', status: 'realized', categoryId: 'groceries' })]), '2026-10-19', '2026-10-22')
    expect(same.spendingChange).toEqual({ diffMinor: 0, percent: 0 })
    expect(same.observations.map((o) => o.id)).toContain('spendingSame')
    const less = weeklyReview(week([tx({ id: 'a', date: '2026-10-14', amountMinor: 5000, kind: 'expense', status: 'realized', categoryId: 'groceries' }), tx({ id: 'b', date: '2026-10-21', amountMinor: 4000, kind: 'expense', status: 'realized', categoryId: 'groceries' })]), '2026-10-19', '2026-10-22')
    expect(less.observations.find((o) => o.id === 'spendingLess')?.params).toEqual({ amountMinor: 1000 })
  })

  it('un descenso menor del 1 % es 0, no «-0» (Object.is), y el ascenso menor del 1 % también', () => {
    expect(Object.is(checkedPercentChange(9999, 10000), 0)).toBe(true)
    expect(Object.is(checkedPercentChange(10001, 10000), 0)).toBe(true)
    expect(checkedPercentChange(9900, 10000)).toBe(-1)
  })
})
