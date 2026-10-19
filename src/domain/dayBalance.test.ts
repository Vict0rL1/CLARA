/**
 * `dayBalance` es la única regla sobre qué se dice de un día: para la proyección base del calendario y para una
 * simulación (revisión propia, R3): proyectado, fuera del rango exacto (QA V2, FIN-01) o más allá de los días calculados.
 */
import { describe, expect, it } from 'vitest'
import { dayBalance, type ProjectionDay } from './projection'

const day = (date: string, endMinor: number): ProjectionDay => ({ date, endMinor, events: [] }) as unknown as ProjectionDay
const today = '2026-09-28'

describe('qué se dice de un día (base o simulación)', () => {
  const days = [day('2026-09-28', 1000), day('2026-09-29', 500), day('2026-09-30', -200)]

  it('con saldo ese día: la cifra; antes de hoy: pasado', () => {
    expect(dayBalance({ today, days, outOfRangeFrom: null }, '2026-09-29')).toEqual({ state: 'projected', endMinor: 500 })
    expect(dayBalance({ today, days, outOfRangeFrom: null }, '2026-09-27')).toEqual({ state: 'past' })
  })

  it('más allá de los días calculados: se dice hasta dónde llega ESA proyección, nunca la cifra del último día', () => {
    expect(dayBalance({ today, days, outOfRangeFrom: null }, '2026-10-05')).toEqual({ state: 'beyond', lastDate: '2026-09-30' })
  })

  it('fuera del rango exacto: ese día no tiene cifra y se dice desde cuándo (también si no hay ningún día exacto)', () => {
    expect(dayBalance({ today, days: days.slice(0, 2), outOfRangeFrom: '2026-09-30' }, '2026-09-30')).toEqual({ state: 'outOfRange', from: '2026-09-30' })
    expect(dayBalance({ today, days: days.slice(0, 2), outOfRangeFrom: '2026-09-30' }, '2026-10-15')).toEqual({ state: 'outOfRange', from: '2026-09-30' })
    expect(dayBalance({ today, days: [], outOfRangeFrom: '2026-09-28' }, '2026-09-28')).toEqual({ state: 'outOfRange', from: '2026-09-28' })
  })
})
