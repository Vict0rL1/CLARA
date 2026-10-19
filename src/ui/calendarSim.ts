/**
 * Qué se dice del día simulado en el calendario (revisión propia, R3). La simulación es otra proyección sobre una
 * copia: lo que se muestra sale de ELLA, no de la proyección base, porque con importes extremos puede dejar de ser
 * exacta antes (QA V2, FIN-01: `stopWhenOutOfRange`) y entonces ese día no tiene cifra y hay que decirlo.
 */
import type { ProjectionDay, ProjectionResult } from '../domain/projection'
import type { LocalDate } from '../domain/types'

export type SimulationView =
  /** El día simulado tiene saldo proyectado. */
  | { kind: 'result'; day: ProjectionDay }
  /** Con ese pago el saldo deja de ser exacto desde `from`: sin cifra para ese día. */
  | { kind: 'outOfRange'; from: LocalDate }
  /** La simulación no llega a ese día (límite de días proyectados): `lastDate` es su último día con cifra. */
  | { kind: 'beyond'; lastDate: LocalDate }

export function simulationView(simulated: Pick<ProjectionResult, 'days' | 'outOfRangeFrom'>, simDay: LocalDate): SimulationView {
  const day = simulated.days.find((d) => d.date === simDay)
  if (day) return { kind: 'result', day }
  if (simulated.outOfRangeFrom && simDay >= simulated.outOfRangeFrom) return { kind: 'outOfRange', from: simulated.outOfRangeFrom }
  const last = simulated.days[simulated.days.length - 1]
  return { kind: 'beyond', lastDate: last ? last.date : simDay }
}
