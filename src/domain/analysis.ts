/**
 * Análisis explicable (etapa 4): señales calculadas con reglas fijas a partir de los datos, cada una
 * con las cifras que la producen («porque») para que la pantalla pueda enseñar «¿Cómo se calculó?».
 * Sin IA, sin notificaciones y sin guardar nada: se recalculan al abrir la pantalla. Los ids son
 * estables (regla + registro) para que la interfaz pueda enlazar y probar cada señal.
 */
import { backupStatus } from './backupReminder'
import { addDays, addMonthsClamped, daysBetween, startOfMonth } from './dates'
import { goalPace } from './goalChart'
import { periodSummary } from './insights'
import { floorDiv, mulDivFloor, sumMinor } from './money'
import { planItems } from './planItems'
import { planProgress } from './plans'
import { projectBalance } from './projection'
import { trackedSince } from './weeklyReview'
import type { AppData, LocalDate } from './types'

export type AnalysisId = 'overdueBills' | 'shortfall' | 'belowReserves' | 'limitOver' | 'limitNear' | 'goalBehind' | 'spendingUp' | 'spendingDown' | 'topCategory' | 'backupDue'
export type AnalysisSeverity = 'critical' | 'warning' | 'info'
export type BecauseId =
  | 'overdueCount'
  | 'overdueTotal'
  | 'startBalance'
  | 'outflowsUntil'
  | 'inflowsUntil'
  | 'balanceOn'
  | 'reserved'
  | 'spent'
  | 'limit'
  | 'remaining'
  | 'saved'
  | 'ideal'
  | 'delta'
  | 'currentToDate'
  | 'previousToDate'
  | 'difference'
  | 'categoryTotal'
  | 'periodTotal'
  | 'share'
  | 'lastExport'
  | 'neverExported'

export interface Because {
  id: BecauseId
  /** Importe en unidades menores, recuento o texto (fecha, nombre), según `kind`. */
  kind: 'money' | 'count' | 'percent' | 'date' | 'text'
  value: number | string
  op?: '+' | '−' | '='
}

export interface AnalysisItem {
  /** Estable: regla y, si aplica, id del registro. */
  key: string
  id: AnalysisId
  severity: AnalysisSeverity
  params: Record<string, string | number>
  because: Because[]
  /** Ruta interna a la pantalla que lo explica o lo resuelve. */
  href: string
}

export const ANALYSIS_HORIZON_DAYS = 60
/** Variación mínima del gasto a fecha equivalente para avisar (porcentaje entero). */
export const SPENDING_CHANGE_THRESHOLD = 10
/** Cuota mínima de una categoría para destacarla. */
export const TOP_CATEGORY_SHARE = 30

const ORDER: Record<AnalysisSeverity, number> = { critical: 0, warning: 1, info: 2 }

export function analysisItems(data: AppData, today: LocalDate): AnalysisItem[] {
  const out: AnalysisItem[] = []

  // 1. Pagos vencidos sin marcar (los mismos que el calendario).
  const overdue = planItems(data, { today, from: today, to: today, includeOverdueBefore: true }).filter((i) => i.state === 'overdue' && i.direction === 'expense')
  if (overdue.length > 0) {
    const total = sumMinor(overdue.map((i) => i.amountMinor))
    out.push({
      key: 'overdueBills',
      id: 'overdueBills',
      severity: 'warning',
      params: { count: overdue.length, total },
      because: [
        { id: 'overdueCount', kind: 'count', value: overdue.length },
        { id: 'overdueTotal', kind: 'money', value: total, op: '=' },
      ],
      href: '/plan/calendario',
    })
  }

  // 2. Saldo proyectado en negativo o por debajo de los apartados (misma proyección que el calendario).
  const projection = projectBalance(data, today, { days: ANALYSIS_HORIZON_DAYS })
  const flowBecause = (until: LocalDate): Because[] => {
    const days = projection.days.filter((d) => d.date <= until)
    // Bruto: cada ingreso y cada pago por separado. +100 y −150 el mismo día son «+100» y «−150», no
    // «0» y «−50» (antes se neteaba por día y la explicación no coincidía con lo que ocurre).
    const effects = days.flatMap((d) => d.events.map((e) => e.budgetEffectMinor))
    const inflows = sumMinor(effects.filter((v) => v > 0))
    const outflows = sumMinor([...effects.filter((v) => v < 0), ...days.map((d) => d.extraMinor - d.dailySpendMinor)])
    const end = days[days.length - 1]?.endMinor ?? projection.startMinor
    return [
      { id: 'startBalance', kind: 'money', value: projection.startMinor },
      { id: 'inflowsUntil', kind: 'money', value: inflows, op: '+' },
      { id: 'outflowsUntil', kind: 'money', value: -outflows, op: '−' },
      { id: 'balanceOn', kind: 'money', value: end, op: '=' },
    ]
  }
  // El punto del aviso: si el saldo de hoy ya está por debajo (antes de cualquier previsto), la cifra es
  // ese saldo y no el cierre del día (que podría ser positivo si hoy entra un ingreso).
  const pointOf = (date: LocalDate, below: (minor: number) => boolean): { amount: number; because: Because[] } => {
    if (date === projection.today && below(projection.startMinor)) {
      return { amount: projection.startMinor, because: [{ id: 'startBalance', kind: 'money', value: projection.startMinor, op: '=' }] }
    }
    const day = projection.days.find((d) => d.date === date)
    return { amount: day?.endMinor ?? projection.startMinor, because: flowBecause(date) }
  }
  if (projection.firstNegativeDate) {
    const point = pointOf(projection.firstNegativeDate, (m) => m < 0)
    out.push({
      key: 'shortfall',
      id: 'shortfall',
      severity: 'critical',
      params: { date: projection.firstNegativeDate, amount: point.amount },
      because: point.because,
      href: '/plan/calendario',
    })
  } else if (projection.firstBelowGoalsDate && projection.goalsReservedMinor > 0) {
    const point = pointOf(projection.firstBelowGoalsDate, (m) => m < projection.goalsReservedMinor)
    out.push({
      key: 'belowReserves',
      id: 'belowReserves',
      severity: 'warning',
      params: { date: projection.firstBelowGoalsDate, amount: point.amount, reserved: projection.goalsReservedMinor },
      because: [...point.because, { id: 'reserved', kind: 'money', value: projection.goalsReservedMinor }],
      href: '/plan/proyeccion',
    })
  }

  // 3. Límites superados o cerca del límite.
  for (const plan of data.plans) {
    if (plan.status !== 'active') continue
    const p = planProgress(data, plan, today)
    if (!p.cycle || (p.state !== 'over' && p.state !== 'near')) continue
    out.push({
      key: `${p.state === 'over' ? 'limitOver' : 'limitNear'}:${plan.id}`,
      id: p.state === 'over' ? 'limitOver' : 'limitNear',
      severity: p.state === 'over' ? 'warning' : 'info',
      params: { planId: plan.id, name: plan.name, spent: p.spentMinor, limit: p.limitMinor, remaining: Math.abs(p.remainingMinor), percent: p.percent },
      // Límite − gastado = restante (negativo = superado): la ecuación cuadra con sus operandos.
      because: [
        { id: 'limit', kind: 'money', value: p.limitMinor },
        { id: 'spent', kind: 'money', value: p.spentMinor, op: '−' },
        { id: 'remaining', kind: 'money', value: p.remainingMinor, op: '=' },
      ],
      href: `/plan/planes/${plan.id}`,
    })
  }

  // 4. Metas por detrás del ritmo (misma regla que la pantalla de metas).
  for (const goal of data.goals) {
    if (goal.kind === 'expense' || !goal.targetDate) continue
    const pace = goalPace(goal, today)
    if (pace.status !== 'behind') continue
    out.push({
      key: `goalBehind:${goal.id}`,
      id: 'goalBehind',
      severity: 'info',
      params: { goalId: goal.id, name: goal.name, behind: -pace.deltaMinor, ideal: pace.idealToDateMinor, saved: pace.savedMinor, date: goal.targetDate },
      because: [
        { id: 'saved', kind: 'money', value: pace.savedMinor },
        { id: 'ideal', kind: 'money', value: pace.idealToDateMinor, op: '−' },
        { id: 'delta', kind: 'money', value: pace.deltaMinor, op: '=' },
      ],
      href: '/plan/metas',
    })
  }

  // 5. Gasto del mes a fecha equivalente del mes anterior (solo con datos completos en ambos tramos).
  const monthStart = startOfMonth(today)
  const elapsed = daysBetween(monthStart, today) + 1
  const prevStart = addMonthsClamped(monthStart, -1, 1)
  const prevEnd = addDays(prevStart, elapsed - 1)
  const comparable = trackedSince(data) <= prevStart && prevEnd < monthStart
  if (comparable) {
    const current = periodSummary(data, monthStart, today).netSpendingMinor
    const previous = periodSummary(data, prevStart, prevEnd).netSpendingMinor
    if (previous > 0) {
      const percent = floorDiv((current - previous) * 100, previous)
      if (Math.abs(percent) >= SPENDING_CHANGE_THRESHOLD) {
        out.push({
          key: percent > 0 ? 'spendingUp' : 'spendingDown',
          id: percent > 0 ? 'spendingUp' : 'spendingDown',
          severity: 'info',
          params: { percent: Math.abs(percent), current, previous, date: prevEnd },
          because: [
            { id: 'currentToDate', kind: 'money', value: current },
            { id: 'previousToDate', kind: 'money', value: previous, op: '−' },
            { id: 'difference', kind: 'money', value: current - previous, op: '=' },
          ],
          href: '/estadisticas',
        })
      }
    }
  }

  // 6. Categoría dominante del mes (≥ 30 % del gasto neto positivo).
  const summary = periodSummary(data, monthStart, today)
  const positive = summary.categories.filter((c) => c.netMinor > 0)
  const total = sumMinor(positive.map((c) => c.netMinor))
  const top = positive.reduce<(typeof positive)[number] | null>((best, c) => (!best || c.netMinor > best.netMinor ? c : best), null)
  if (top && total > 0) {
    const share = mulDivFloor(top.netMinor, 100, total)
    if (share >= TOP_CATEGORY_SHARE) {
      out.push({
        key: `topCategory:${top.categoryId}`,
        id: 'topCategory',
        severity: 'info',
        params: { categoryId: top.categoryId, amount: top.netMinor, total, percent: share },
        because: [
          { id: 'categoryTotal', kind: 'money', value: top.netMinor },
          { id: 'periodTotal', kind: 'money', value: total },
          { id: 'share', kind: 'percent', value: share, op: '=' },
        ],
        href: '/estadisticas',
      })
    }
  }

  // 7. Copia de seguridad pendiente (misma regla que el recordatorio; nunca con datos de demostración).
  const backup = backupStatus(data, today)
  if (backup.due && !data.isDemo) {
    out.push({
      key: 'backupDue',
      id: 'backupDue',
      severity: 'warning',
      params: { lastExport: backup.lastExportAt ?? '' },
      because: backup.lastExportAt ? [{ id: 'lastExport', kind: 'text', value: backup.lastExportAt }] : [{ id: 'neverExported', kind: 'text', value: '' }],
      href: '/ajustes/datos',
    })
  }

  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.key.localeCompare(b.key))
}
