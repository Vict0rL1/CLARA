import { describe, expect, it } from 'vitest'
import type { ProjectionDay } from '../domain/projection'
import { simulationView } from './calendarSim'

const day = (date: string, endMinor: number): ProjectionDay => ({ date, endMinor, events: [] }) as unknown as ProjectionDay

describe('qué se dice del día simulado (R3, revisión propia)', () => {
  const days = [day('2026-09-28', 1000), day('2026-09-29', 500), day('2026-09-30', -200)]

  it('con saldo ese día: la cifra de la simulación', () => {
    expect(simulationView({ days, outOfRangeFrom: null }, '2026-09-29')).toEqual({ kind: 'result', day: days[1] })
  })

  it('más allá de los días simulados: se dice hasta dónde llega la simulación, no la proyección base', () => {
    expect(simulationView({ days, outOfRangeFrom: null }, '2026-10-05')).toEqual({ kind: 'beyond', lastDate: '2026-09-30' })
  })

  it('con importes extremos la simulación deja de ser exacta antes que la proyección base: ese día no tiene cifra y se dice desde cuándo', () => {
    // La proyección base llegaba al 30-sep; el pago simulado la saca del rango exacto desde el 30-sep.
    expect(simulationView({ days: days.slice(0, 2), outOfRangeFrom: '2026-09-30' }, '2026-09-30')).toEqual({ kind: 'outOfRange', from: '2026-09-30' })
    // Sin ningún día exacto (fuera de rango desde hoy) tampoco se inventa una fecha.
    expect(simulationView({ days: [], outOfRangeFrom: '2026-09-28' }, '2026-09-28')).toEqual({ kind: 'outOfRange', from: '2026-09-28' })
  })
})
