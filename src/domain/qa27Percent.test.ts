/**
 * Auditoría independiente del 2026-10-29 sobre `21b4ed8` (QA27-03, P2): totales seguros cuya DIFERENCIA no cabe en un
 * entero exacto no deben romper Análisis, Estadísticas ni la Revisión semanal: el porcentaje exacto sale de los
 * operandos (−200 %) y la diferencia se declara sin cifra. Datos sintéticos; fechas explícitas.
 */
import { describe, expect, it } from 'vitest'
import { analysisItems } from './analysis'
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
