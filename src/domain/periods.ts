/**
 * Periodos de presupuesto (§6): semana, quincena, mes, trimestre, semestre, año, personalizado y
 * «hasta mi próximo ingreso» (modelo original de Clara, decisión 7). Saldo del periodo con arrastre
 * y *safe to spend*. Funciones puras: «hoy» llega como parámetro; nunca se divide entre cero.
 */
import { spendableBalance, txEffectOnBudgetPool } from './balances'
import { addDays, addMonthsClamped, daysBetween, daysInMonth, endOfMonth, parseLocalDate, startOfMonth, toLocalDate, weekday } from './dates'
import { periodSummary } from './insights'
import { floorDiv, mulDivFloor, sumMinor } from './money'
import type { AppData, BudgetPeriodSettings, BudgetPeriodType, LocalDate, Weekday, SafeToSpendSettings } from './types'

export interface Period {
  type: BudgetPeriodType
  start: LocalDate
  /** Último día incluido. */
  end: LocalDate
  /** Días del periodo (start..end incluidos). */
  days: number
  /** Días que quedan contando hoy (0 si hoy ya pasó el fin). */
  daysLeft: number
  /** Para mes/trimestre/semestre/año: mes de inicio (1–12) y año, para etiquetas localizadas. */
  anchorMonth: number
  anchorYear: number
}

/** Primer día de la semana que contiene `date`, según el día de inicio elegido. */
export function startOfWeek(date: LocalDate, weekStartsOn: Weekday): LocalDate {
  return addDays(date, -((weekday(date) - weekStartsOn + 7) % 7))
}

function build(type: BudgetPeriodType, start: LocalDate, end: LocalDate, today: LocalDate): Period {
  const s = parseLocalDate(start)
  return {
    type,
    start,
    end,
    days: daysBetween(start, end) + 1,
    daysLeft: today > end ? 0 : today < start ? daysBetween(start, end) + 1 : daysBetween(today, end) + 1,
    anchorMonth: s.month,
    anchorYear: s.year,
  }
}

/** Periodo de `n` meses alineado (trimestre = 3, semestre = 6, año = 12). */
function monthsPeriod(type: BudgetPeriodType, today: LocalDate, n: number): Period {
  const { year, month } = parseLocalDate(today)
  const firstMonth = Math.floor((month - 1) / n) * n + 1
  const start = toLocalDate(year, firstMonth, 1)
  const end = endOfMonth(addMonthsClamped(start, n - 1, 1))
  return build(type, start, end, today)
}

/**
 * Periodo que contiene `today`. `untilIncome` necesita el horizonte (fin = día anterior al
 * ingreso); sin él devuelve `null`, igual que el modelo original.
 */
export function getPeriod(settings: BudgetPeriodSettings, today: LocalDate, options: { incomeEnd?: LocalDate | null } = {}): Period | null {
  switch (settings.type) {
    case 'week': {
      const start = startOfWeek(today, settings.weekStartsOn)
      return build('week', start, addDays(start, 6), today)
    }
    case 'biweek': {
      const { year, month, day } = parseLocalDate(today)
      if (day <= 15) return build('biweek', toLocalDate(year, month, 1), toLocalDate(year, month, 15), today)
      return build('biweek', toLocalDate(year, month, 16), toLocalDate(year, month, daysInMonth(year, month)), today)
    }
    case 'month':
      return build('month', startOfMonth(today), endOfMonth(today), today)
    case 'quarter':
      return monthsPeriod('quarter', today, 3)
    case 'semester':
      return monthsPeriod('semester', today, 6)
    case 'year':
      return monthsPeriod('year', today, 12)
    case 'custom': {
      if (!settings.customStart || !settings.customEnd || settings.customEnd < settings.customStart) return build('month', startOfMonth(today), endOfMonth(today), today)
      // El rango se repite con la misma duración hacia adelante (y hacia atrás) hasta contener hoy.
      const len = daysBetween(settings.customStart, settings.customEnd) + 1
      let start = settings.customStart
      if (today >= start) start = addDays(start, Math.floor(daysBetween(start, today) / len) * len)
      else start = addDays(start, -Math.ceil(daysBetween(today, start) / len) * len)
      return build('custom', start, addDays(start, len - 1), today)
    }
    case 'untilIncome': {
      if (!options.incomeEnd) return null
      // Igual que el horizonte: el día del ingreso no cuenta.
      const end = addDays(options.incomeEnd, -1)
      if (end < today) return null
      return build('untilIncome', today, end, today)
    }
  }
}

export interface PeriodBalance {
  period: Period
  /** Saldo consolidado al inicio del periodo (lo que había en las cuentas del presupuesto). */
  carryOverMinor: number
  /** Ingresos y gastos realizados del periodo (como en Estadísticas: todas las cuentas). */
  incomeMinor: number
  expensesMinor: number
  /**
   * Neto que entró o salió de las CUENTAS DEL PRESUPUESTO en el periodo (ingresos − gastos −
   * transferencias hacia fuera + transferencias desde fuera, ajustes incluidos). Es la asignación
   * del periodo sin arrastre: lo que el periodo «trajo». Puede ser negativo.
   */
  poolNetMinor: number
  /** poolNet − (ingresos − gastos): dinero que entró o salió fuera de las cuentas del presupuesto (0 casi siempre). */
  outsideMinor: number
  /** Saldo real de hoy en las cuentas del presupuesto (liquidez). */
  balanceMinor: number
  /** Con arrastre: el saldo real. Sin arrastre: el neto del periodo (asignación). */
  availableMinor: number
  /**
   * Base del disponible (QA-03). Con arrastre, el saldo real. Sin arrastre, el MENOR entre la
   * asignación del periodo y el saldo real: nunca se sugiere gastar dinero que no está en las cuentas
   * (por ejemplo, si el periodo empezó con deuda o saldo negativo).
   */
  spendableBaseMinor: number
  /** Sin arrastre y la asignación supera el saldo real: la base se limitó al saldo. */
  limitedByBalance: boolean
  /** Disponible / (carryOver + ingresos), entre 0 y 1; null si la base es ≤ 0. */
  availablePct: number | null
  carryOver: boolean
}

/**
 * Saldo del periodo (§6.2). Solo movimientos realizados. Para `untilIncome` el saldo consolidado
 * es el de hoy (el periodo empieza hoy), así que coincide con el modelo original.
 */
export function periodBalance(data: Pick<AppData, 'transactions' | 'accounts'>, period: Period, carryOver: boolean): PeriodBalance {
  const summary = periodSummary(data, period.start, period.end)
  const incomeMinor = summary.incomeMinor
  const expensesMinor = summary.netSpendingMinor
  const balanceMinor = spendableBalance(data).totalMinor
  const poolNetMinor = sumMinor(
    data.transactions.filter((tx) => tx.status === 'realized' && tx.date >= period.start && tx.date <= period.end).map((tx) => txEffectOnBudgetPool(tx, data.accounts)),
  )
  const outsideMinor = poolNetMinor - (incomeMinor - expensesMinor)
  // Lo que había al empezar el periodo = saldo de hoy − lo que el periodo trajo a las cuentas del presupuesto.
  const carryOverMinor = balanceMinor - poolNetMinor
  const availableMinor = carryOver ? balanceMinor : poolNetMinor
  const limitedByBalance = !carryOver && balanceMinor < poolNetMinor
  const spendableBaseMinor = carryOver ? balanceMinor : Math.min(poolNetMinor, balanceMinor)
  const base = carryOver ? carryOverMinor + incomeMinor : incomeMinor
  const availablePct = base > 0 ? Math.min(1, Math.max(0, availableMinor / base)) : null
  return { period, carryOverMinor, incomeMinor, expensesMinor, poolNetMinor, outsideMinor, balanceMinor, availableMinor, spendableBaseMinor, limitedByBalance, availablePct, carryOver }
}

export interface SafeToSpend {
  /** max(disponible − comprometido, 0). */
  safeMinor: number
  committedMinor: number
  daysLeft: number
  perDayMinor: number
  perWeekMinor: number
  perPeriodMinor: number
  /** true si el disponible no cubre lo comprometido. */
  short: boolean
  shortfallMinor: number
}

/** *Safe to spend* (§6.3): los días que quedan incluyen hoy; sin días no se divide. */
export function safeToSpend(availableMinor: number, committedMinor: number, daysLeft: number): SafeToSpend {
  const safeMinor = Math.max(availableMinor - committedMinor, 0)
  const days = Math.max(daysLeft, 0)
  const perDayMinor = days > 0 ? floorDiv(safeMinor, days) : 0
  const perWeekMinor = days > 0 ? mulDivFloor(safeMinor, Math.min(7, days), days) : 0
  return {
    safeMinor,
    committedMinor,
    daysLeft: days,
    perDayMinor,
    perWeekMinor,
    perPeriodMinor: safeMinor,
    short: availableMinor < committedMinor,
    shortfallMinor: Math.max(committedMinor - availableMinor, 0),
  }
}

/**
 * Comprometido que se resta del *safe to spend* según los ajustes (§7.7): pagos programados y/o
 * apartados de metas, y siempre el colchón de seguridad (Clara 2.0 §10).
 */
export function committedFor(settings: SafeToSpendSettings, reservedMinor: number, goalsMinor: number): number {
  return (settings.subtractScheduled ? reservedMinor : 0) + (settings.subtractGoalContributions ? goalsMinor : 0) + Math.max(0, settings.bufferMinor ?? 0)
}
