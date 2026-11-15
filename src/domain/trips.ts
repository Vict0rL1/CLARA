/**
 * Modo viaje (Fase 3 nativa, decisión 176; ver `docs/FORMULAS.md` §46).
 *
 * Un viaje es un Presupuesto por periodo con plantilla «Viaje» y `trip`: sus monedas, la del país donde se está ahora
 * («moneda local actual», que resuelve un «¥» suelto) y una tasa escrita a mano por moneda, con su fecha. Está activo
 * entre sus fechas (incluidas) si no está archivado; con varios activos, manda el que empezó más tarde (a igualdad, el
 * creado más tarde), siempre el mismo.
 *
 * - Una tasa del viaje solo se usa para lo que se registra DESPUÉS de escribirla: cambiarla nunca toca un movimiento ya
 *   guardado (cada uno lleva la suya en `original`).
 * - Nunca se inventa una tasa: sin una escrita para esa moneda, no hay conversión (la captura queda como propuesta, el
 *   formulario pide la tasa o el cargo real).
 * - La vista del viaje suma lo REALIZADO asociado al periodo (como `summarizePeriod`), separado por la moneda en que se
 *   pagó; el total en la moneda del presupuesto es el gastado del periodo. Ninguna suma de importes originales se
 *   redondea ni se recorta: si no cabe en un entero exacto, esa línea dice que no hay cifra.
 */
import { daysBetween } from './dates'
import { convertToBudget, parseRate, rateToText } from './fx'
import { checkedSumMinor, currencyDigits, floorDiv, localeSeparators, markMatchesCurrency, parseMoney, stripCurrencyMark, SUPPORTED_CURRENCIES, type ParseMoneyResult } from './money'
import type { OpContext, OpResult } from './operations'
import { summarizePeriod, type PeriodSummaryResult } from './periodBudgets'
import type { AppData, CurrencyCode, LocalDate, OriginalAmount, PeriodBudget, Transaction, TripRate, TripSettings } from './types'
import { validatePeriodBudget, type Issue } from './validation'

const fail = (issues: Issue[]): { ok: false; issues: Issue[] } => ({ ok: false, issues })

/** Los viajes con modo viaje que están en curso hoy, del que manda al último. */
export function activeTrips(data: Pick<AppData, 'periodBudgets'>, today: LocalDate): PeriodBudget[] {
  return data.periodBudgets
    .filter((b) => b.template === 'trip' && b.trip && !b.archived && b.startDate <= today && today <= b.endDate)
    .sort((a, b) =>
      a.startDate === b.startDate
        ? a.createdAt === b.createdAt
          ? a.id < b.id
            ? 1
            : -1
          : a.createdAt < b.createdAt
            ? 1
            : -1
        : a.startDate < b.startDate
          ? 1
          : -1,
    )
}

/** El viaje en curso en esa fecha (el que manda), o ninguno. */
export function activeTrip(data: Pick<AppData, 'periodBudgets'>, date: LocalDate): PeriodBudget | undefined {
  return activeTrips(data, date)[0]
}

/** La tasa escrita para esa moneda en el viaje, si hay. */
export function tripRate(trip: TripSettings | undefined, currency: string): TripRate | undefined {
  return trip?.rates.find((r) => r.currency === currency)
}

/**
 * Un «¥» suelto es yen o yuan: solo lo resuelve la moneda local actual del viaje, si es una de las candidatas. Si no,
 * sigue sin resolver (nunca se elige).
 */
export function resolveAmbiguous(trip: TripSettings | undefined, candidates: readonly CurrencyCode[]): CurrencyCode | undefined {
  const local = trip?.localCurrency
  return local && candidates.includes(local) ? local : undefined
}

function updateTrip(data: AppData, budgetId: string, ctx: OpContext, change: (trip: TripSettings) => TripSettings): OpResult<PeriodBudget> {
  const budget = data.periodBudgets.find((b) => b.id === budgetId)
  if (!budget || !budget.trip) return fail([{ path: 'budgetId', code: 'notFound' }])
  const trip = change(budget.trip)
  const updated: PeriodBudget = { ...budget, trip, updatedAt: ctx.now }
  const issues = validatePeriodBudget(updated, { data })
  if (issues.length) return fail(issues)
  return { ok: true, data: { ...data, updatedAt: ctx.now, periodBudgets: data.periodBudgets.map((b) => (b.id === budgetId ? updated : b)) }, value: updated }
}

/** «Ahora estoy en…»: cambia la moneda local actual (o la quita con `null`). Solo afecta a lo que se registre después. */
export function setTripLocalCurrency(data: AppData, budgetId: string, currency: CurrencyCode | null, ctx: OpContext): OpResult<PeriodBudget> {
  return updateTrip(data, budgetId, ctx, (trip) => {
    const { localCurrency: _old, ...rest } = trip
    return currency === null ? rest : { ...rest, localCurrency: currency }
  })
}

/**
 * Escribe (o quita, con `rate: null`) la tasa de una moneda del viaje. Se guarda en su forma exacta canónica
 * («1.3950» → «1.395»). Lo ya registrado conserva su tasa.
 */
export function setTripRate(
  data: AppData,
  budgetId: string,
  currency: CurrencyCode,
  rate: string | null,
  date: LocalDate,
  ctx: OpContext,
): OpResult<PeriodBudget> {
  let text: string | null = null
  if (rate !== null) {
    const parsed = parseRate(rate)
    if (!parsed) return fail([{ path: 'rate', code: 'invalidValue' }])
    text = rateToText(parsed)
  }
  return updateTrip(data, budgetId, ctx, (trip) => {
    const others = trip.rates.filter((r) => r.currency !== currency)
    return { ...trip, rates: text === null ? others : [...others, { currency, rate: text, date }] }
  })
}

export interface TripCurrencyLine {
  currency: CurrencyCode
  /** Movimientos realizados en esa moneda. */
  count: number
  /** Gastado en esa moneda (devoluciones restan), en sus unidades menores. `null` = no cabe en un entero exacto. */
  originalMinor: number | null
  /** Lo mismo convertido a la moneda del presupuesto (lo que cuenta). */
  convertedMinor: number | null
}

export interface TripSummary {
  period: PeriodSummaryResult
  /** Primero la moneda del presupuesto si hay gastos en ella; luego las del viaje en su orden; luego cualquier otra. */
  byCurrency: TripCurrencyLine[]
  /** Días transcurridos del viaje, contando el primero y hoy (o todos, si terminó; 0 si no empezó). */
  daysElapsed: number
  /** Gastado por día hasta hoy: gastado ÷ días transcurridos, hacia abajo. `null` sin días transcurridos. */
  spentPerDayMinor: number | null
  /** Pagos en otra moneda dentro de las fechas que siguen como propuesta: NO están en ninguna cifra. */
  unconvertedProposals: number
}

/**
 * Gastado REALIZADO por la moneda en que se pagó (las devoluciones restan): `transactions` son gastos y devoluciones ya
 * elegidos (los de un viaje o los de un periodo de Estadísticas). Lo que no lleva `original` cuenta en la moneda del
 * presupuesto. Orden: la del presupuesto, luego `order`, luego el resto por código. Sumas exactas o `null`.
 */
export function spentByCurrency(transactions: readonly Transaction[], budgetCurrency: CurrencyCode, order: readonly CurrencyCode[] = []): TripCurrencyLine[] {
  const groups = new Map<CurrencyCode, { count: number; original: number[]; converted: number[] }>()
  for (const t of transactions) {
    if (t.status !== 'realized' || (t.kind !== 'expense' && t.kind !== 'refund')) continue
    const sign = t.kind === 'refund' ? -1 : 1
    const currency = t.original?.currency ?? budgetCurrency
    const g = groups.get(currency) ?? { count: 0, original: [], converted: [] }
    g.count += 1
    g.original.push(sign * (t.original?.amountMinor ?? t.amountMinor))
    g.converted.push(sign * t.amountMinor)
    groups.set(currency, g)
  }
  const ranked = [budgetCurrency, ...order]
  const rank = (c: CurrencyCode) => (ranked.includes(c) ? ranked.indexOf(c) : ranked.length)
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || (a < b ? -1 : 1))
    .map(([currency, g]) => ({ currency, count: g.count, originalMinor: checkedSumMinor(g.original), convertedMinor: checkedSumMinor(g.converted) }))
}

export function tripSummary(data: AppData, budget: PeriodBudget, today: LocalDate): TripSummary {
  const period = summarizePeriod(data, budget, today)
  const byCurrency = spentByCurrency(period.transactions, budget.currency, budget.trip?.currencies ?? [])
  const daysElapsed = period.status === 'upcoming' ? 0 : period.status === 'ended' ? period.totalDays : daysBetween(budget.startDate, today) + 1
  const spentPerDayMinor = daysElapsed > 0 ? (period.spentMinor > 0 ? floorDiv(period.spentMinor, daysElapsed) : 0) : null
  const unconvertedProposals = (data.captures?.proposals ?? []).filter(
    (p) => !p.test && p.reason === 'currency' && p.date >= budget.startDate && p.date <= budget.endDate,
  ).length
  return { period, byCurrency, daysElapsed, spentPerDayMinor, unconvertedProposals }
}

export type TextAmount =
  | { kind: 'budget'; minor: number }
  /** Escrito en una moneda del viaje en curso ese día y convertido con SU tasa y su comisión. */
  | { kind: 'trip'; minor: number; original: OriginalAmount; trip: PeriodBudget }
  /** Lo de siempre: el error de leerlo en la moneda del presupuesto (otra moneda sin tasa, sin entender…). */
  | { kind: 'none'; result: ParseMoneyResult }

/**
 * Un importe escrito (el campo de una línea del asistente) con el modo viaje (Fase 3, decisión 180). En la moneda del
 * presupuesto, como siempre. Con otra moneda escrita, solo si ese día hay un viaje en curso con tasa para ESA moneda:
 * convertido con ella y la comisión del viaje. Una marca que puede ser de varias monedas («¥», «kr») solo la resuelve la
 * moneda local del viaje; un código o un símbolo de una sola moneda vale si es del viaje. Si no, el error de siempre:
 * nunca se convierte sin una tasa escrita.
 */
export function tripAmountFromText(data: Pick<AppData, 'periodBudgets' | 'settings'>, text: string, date: LocalDate): TextAmount {
  const budget = data.settings.currency
  const locale = data.settings.numberLocale
  const result = parseMoney(text, budget, locale)
  if (result.ok) return { kind: 'budget', minor: result.minor }
  const none: TextAmount = { kind: 'none', result }
  if (result.error !== 'currencyMismatch') return none
  const trip = activeTrip(data, date)
  if (!trip?.trip) return none
  const { text: number, mark } = stripCurrencyMark(text)
  if (!mark || 'unknown' in mark || 'conflict' in mark) return none
  const candidates = SUPPORTED_CURRENCIES.map((c) => c.code).filter((c) => c !== budget && markMatchesCurrency(mark, c))
  const code = candidates.length === 1 ? candidates[0] : resolveAmbiguous(trip.trip, candidates)
  if (!code || !trip.trip.currencies.includes(code)) return none
  const rate = tripRate(trip.trip, code)
  if (!rate) return none
  // El asistente escribe el número con los decimales del presupuesto («1200.00»): ceros de sobra no cambian el importe.
  const { decimal } = localeSeparators(locale)
  const zeros = new RegExp(`${decimal === '.' ? '\\.' : decimal}0+$`)
  const parsed = parseMoney(currencyDigits(code) === 0 ? number.replace(zeros, '') : number, code, locale)
  if (!parsed.ok) return none
  const feeBps = trip.trip.feeBps ?? 0
  const minor = convertToBudget(parsed.minor, code, budget, rate.rate, feeBps)
  if (minor === null) return none
  return { kind: 'trip', minor, trip, original: { currency: code, amountMinor: parsed.minor, rate: rate.rate, rateDate: rate.date, rateSource: 'manual', ...(feeBps > 0 ? { feeBps } : {}) } }
}
