/**
 * Progreso de una meta (D7): la curva acumulada de lo apartado frente a la recta ideal hasta la
 * fecha objetivo, y una fecha estimada de llegada.
 *
 *   ideal(d)   = objetivo × (d − inicio) ÷ (fecha objetivo − inicio); inicio = primer apartado o la
 *                creación de la meta.
 *   ETA        = hoy + ⌈restante ÷ aporte medio diario⌉, con aporte medio diario = Σ aportes de los
 *                últimos 30 días ÷ 30. Solo con ≥ 2 aportes; sin aportes recientes no hay estimación.
 */
import { addDays, daysBetween } from './dates'
import { goalProgress } from './goals'
import { mulDivCeil, sumMinor } from './money'
import type { Goal, GoalAllocation, LocalDate } from './types'

export interface GoalPoint {
  date: LocalDate
  savedMinor: number
}

export interface GoalTrajectory {
  /** Acumulado por fecha (una entrada por día con movimiento), empezando en 0 el día de inicio. */
  points: GoalPoint[]
  start: LocalDate
  /** null sin fecha objetivo: no hay recta ideal. */
  end: LocalDate | null
  targetMinor: number
  /** Aportes confirmados (no liberaciones ni pagos). */
  contributions: number
}

const isContribution = (a: GoalAllocation) => (a.reason === undefined || a.reason === 'contribution') && a.amountMinor > 0

export function goalTrajectory(goal: Goal, today: LocalDate): GoalTrajectory {
  const sorted = [...goal.allocations].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const created = goal.createdAt.slice(0, 10) as LocalDate
  const start = sorted[0] && sorted[0].date < created ? sorted[0].date : created
  const points: GoalPoint[] = [{ date: start, savedMinor: 0 }]
  let acc = 0
  for (const a of sorted) {
    acc += a.amountMinor
    const last = points[points.length - 1]!
    if (last.date === a.date) last.savedMinor = acc
    else points.push({ date: a.date, savedMinor: acc })
  }
  const last = points[points.length - 1]!
  if (last.date < today) points.push({ date: today, savedMinor: acc })
  return { points, start, end: goal.targetDate ?? null, targetMinor: goal.targetMinor, contributions: sorted.filter(isContribution).length }
}

/** Valor de la recta ideal en una fecha (0 antes del inicio, objetivo después del fin). */
export function idealAt(t: GoalTrajectory, date: LocalDate): number {
  if (!t.end || t.end <= t.start) return t.targetMinor
  const total = daysBetween(t.start, t.end)
  const elapsed = Math.min(total, Math.max(0, daysBetween(t.start, date)))
  return Math.floor((t.targetMinor * elapsed) / total)
}

export type GoalEta = { status: 'complete' } | { status: 'tooFew'; contributions: number } | { status: 'noRecent' } | { status: 'ok'; date: LocalDate; perDayMinor: number; days: number }

export function goalEta(goal: Goal, today: LocalDate): GoalEta {
  const progress = goalProgress(goal)
  if (progress.complete) return { status: 'complete' }
  const contributions = goal.allocations.filter(isContribution)
  if (contributions.length < 2) return { status: 'tooFew', contributions: contributions.length }
  const since = addDays(today, -30)
  const recent = sumMinor(contributions.filter((a) => a.date > since && a.date <= today).map((a) => a.amountMinor))
  if (recent <= 0) return { status: 'noRecent' }
  // Ritmo = Σ últimos 30 días ÷ 30; días que faltan = ⌈restante × 30 ÷ Σ⌉ (sin flotantes).
  const days = mulDivCeil(progress.remainingMinor, 30, recent)
  return { status: 'ok', date: addDays(today, days), perDayMinor: Math.floor(recent / 30), days }
}

export type GoalPaceStatus = 'noDate' | 'complete' | 'ahead' | 'onTrack' | 'behind'

export interface GoalPace {
  status: GoalPaceStatus
  /** Lo que tocaría llevar hoy siguiendo la recta desde el inicio hasta la fecha objetivo. */
  idealToDateMinor: number
  savedMinor: number
  /** Positivo = por delante del ritmo; negativo = por detrás. */
  deltaMinor: number
}

/**
 * Ritmo frente a la recta ideal (etapa 3): explica «vas por detrás/delante» con cifras. Tolerancia
 * del 1 % del objetivo (mínimo 1 unidad menor) para no alarmar por redondeos. Sin fecha no hay ritmo.
 */
export function goalPace(goal: Goal, today: LocalDate): GoalPace {
  const progress = goalProgress(goal)
  if (!goal.targetDate) return { status: 'noDate', idealToDateMinor: 0, savedMinor: progress.savedMinor, deltaMinor: 0 }
  if (progress.complete) return { status: 'complete', idealToDateMinor: goal.targetMinor, savedMinor: progress.savedMinor, deltaMinor: progress.savedMinor - goal.targetMinor }
  const ideal = idealAt(goalTrajectory(goal, today), today)
  const delta = progress.savedMinor - ideal
  const tolerance = Math.max(1, Math.ceil(goal.targetMinor / 100))
  return { status: delta < -tolerance ? 'behind' : delta > tolerance ? 'ahead' : 'onTrack', idealToDateMinor: ideal, savedMinor: progress.savedMinor, deltaMinor: delta }
}
