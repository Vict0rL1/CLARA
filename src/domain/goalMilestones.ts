/**
 * Hitos de las metas de ahorro (Clara 2.0 §13, fase 3): 25, 50, 75 y 100 % de lo apartado sobre el
 * objetivo. Se calcula, no se guarda nada: el aviso lleva una clave estable por meta y nivel
 * (`goal<nivel>:<id>`) y la capa de avisos no repite una clave ya mostrada.
 *
 * - Solo metas de ahorro y fondo de emergencia (los gastos planificados tienen su propio vencimiento).
 * - En enteros: un nivel está alcanzado si `apartado × 100 ≥ objetivo × nivel`.
 * - Solo el nivel MÁS ALTO alcanzado: si un aporte lleva la meta del 10 % al 80 %, un único aviso (75 %).
 * - Es una noticia, no un estado: solo durante `GOAL_MILESTONE_DAYS` días desde el apartado que cruzó ese
 *   nivel (la última vez que lo cruzó hacia arriba). Una meta que ya estaba al 60 % no avisa de nada nuevo.
 */
import { addDays } from './dates'
import { goalSavedMinor } from './goals'
import type { AppData, Goal, LocalDate } from './types'

export const GOAL_MILESTONES = [25, 50, 75, 100] as const
export type GoalMilestone = (typeof GOAL_MILESTONES)[number]
export const GOAL_MILESTONE_DAYS = 7

export interface GoalMilestoneReached {
  goal: Goal
  level: GoalMilestone
  savedMinor: number
  /** Fecha del apartado con el que se cruzó el nivel. */
  reachedOn: LocalDate
}

const reached = (savedMinor: number, targetMinor: number, level: number) => savedMinor * 100 >= targetMinor * level

/** Nivel más alto alcanzado hoy, o `null`. */
export function goalMilestone(goal: Goal): GoalMilestone | null {
  if (goal.kind === 'expense' || goal.targetMinor <= 0) return null
  const saved = goalSavedMinor(goal)
  let level: GoalMilestone | null = null
  for (const l of GOAL_MILESTONES) if (reached(saved, goal.targetMinor, l)) level = l
  return level
}

/** Hitos recientes (cruzados en los últimos `GOAL_MILESTONE_DAYS` días, hoy incluido). */
export function goalMilestones(data: Pick<AppData, 'goals'>, today: LocalDate): GoalMilestoneReached[] {
  const since = addDays(today, -(GOAL_MILESTONE_DAYS - 1))
  const out: GoalMilestoneReached[] = []
  for (const goal of data.goals) {
    const level = goalMilestone(goal)
    if (!level) continue
    // Recorrido en el orden de los apartados: la última vez que la suma pasó de debajo a encima del nivel.
    const ordered = [...goal.allocations].sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date < b.date ? -1 : 1))
    let sum = 0
    let reachedOn: LocalDate | null = null
    for (const a of ordered) {
      const before = sum
      sum += a.amountMinor
      if (!reached(before, goal.targetMinor, level) && reached(sum, goal.targetMinor, level)) reachedOn = a.date
    }
    if (reachedOn && reachedOn >= since && reachedOn <= today) out.push({ goal, level, savedMinor: sum, reachedOn })
  }
  return out
}
