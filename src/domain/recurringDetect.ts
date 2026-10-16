/**
 * Pagos que parecen fijos pero no están programados (Clara 2.0 §12, fase 3).
 *
 * Se buscan gastos realizados, sin vínculo con un programado, del mismo comercio (clave de
 * `merchants.ts`) y EXACTAMENTE el mismo importe, con una cadencia regular:
 *
 * | cadencia      | separación entre fechas | mínimo de veces |
 * |---------------|-------------------------|-----------------|
 * | cada mes      | 27–34 días              | 3               |
 * | cada 2 semanas| 13–15 días              | 3               |
 * | cada semana   | 6–8 días                | 4               |
 *
 * y que siga activa (el último pago no está más lejos que la separación máxima + 7 días). No se
 * propone si ya hay un programado recurrente (no terminado) del mismo importe que encaja por nombre o por
 * categoría y cadencia. Solo PROPONE (una sugerencia de la bandeja): programarlo es un paso explícito de la persona
 * en el formulario, ya relleno; nunca se crea ni se reserva nada solo.
 */
import { addDays, addMonthsClamped, daysBetween, parseLocalDate } from './dates'
import { merchantKey, merchantLabel } from './merchants'
import type { AppData, Frequency, LocalDate } from './types'

export type DetectedFrequency = Extract<Frequency, 'weekly' | 'biweekly' | 'monthly'>

export interface RecurringCandidate {
  /** Clave de comercio («netflix com»). */
  key: string
  /** Nombre propuesto, sin prefijo ni códigos («NETFLIX COM»). */
  label: string
  amountMinor: number
  frequency: DetectedFrequency
  categoryId?: string
  accountId: string
  /** Fechas de los pagos encontrados, de la más antigua a la más reciente. */
  dates: LocalDate[]
  txIds: string[]
  /** Próxima fecha esperada, nunca anterior a hoy. */
  nextDate: LocalDate
}

export const DETECT_LOOKBACK_DAYS = 400

const CADENCES: { frequency: DetectedFrequency; min: number; max: number; count: number }[] = [
  { frequency: 'monthly', min: 27, max: 34, count: 3 },
  { frequency: 'biweekly', min: 13, max: 15, count: 3 },
  { frequency: 'weekly', min: 6, max: 8, count: 4 },
]

function nextAfter(last: LocalDate, frequency: DetectedFrequency, today: LocalDate): LocalDate {
  const day = parseLocalDate(last).day
  let next = last
  for (let i = 1; next < today || next === last; i++) {
    next = frequency === 'monthly' ? addMonthsClamped(last, i, day) : addDays(last, (frequency === 'weekly' ? 7 : 14) * i)
  }
  return next
}

export function detectRecurring(data: Pick<AppData, 'transactions' | 'schedules'>, today: LocalDate): RecurringCandidate[] {
  const since = addDays(today, -DETECT_LOOKBACK_DAYS)
  const groups = new Map<string, { key: string; amountMinor: number; txs: AppData['transactions'] }>()
  const eligible = data.transactions.filter((tx) => tx.status === 'realized' && tx.kind === 'expense' && !tx.scheduleId && tx.date >= since && tx.date <= today)
  // Ninguna cadencia acepta menos de 3 pagos del MISMO importe: lo demás se descarta antes de mirar el texto.
  const minCount = Math.min(...CADENCES.map((c) => c.count))
  const perAmount = new Map<number, number>()
  for (const tx of eligible) perAmount.set(tx.amountMinor, (perAmount.get(tx.amountMinor) ?? 0) + 1)
  // Los textos se repiten mucho (el mismo comercio cada mes): la clave se calcula una vez por texto.
  const keys = new Map<string, string>()
  for (const tx of eligible) {
    if ((perAmount.get(tx.amountMinor) ?? 0) < minCount) continue
    const text = (tx.merchant || tx.note || '').trim()
    let key = keys.get(text)
    if (key === undefined) keys.set(text, (key = merchantKey(text)))
    if (key.length < 3 || !/\p{L}/u.test(key)) continue
    const id = `${key}|${tx.amountMinor}`
    const g = groups.get(id) ?? { key, amountMinor: tx.amountMinor, txs: [] }
    g.txs.push(tx)
    groups.set(id, g)
  }

  const covered = data.schedules
    // Uno que ya terminó no cubre pagos que siguen llegando.
    .filter((s) => s.kind === 'expense' && s.frequency !== 'once' && (!s.endDate || s.endDate >= today))
    .map((s) => ({ amountMinor: s.amountMinor, key: merchantKey(s.name), categoryId: s.categoryId, frequency: s.frequency }))

  const out: RecurringCandidate[] = []
  for (const g of groups.values()) {
    const txs = [...g.txs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    const dates = txs.map((t) => t.date)
    // Dos pagos el mismo día no son una cadencia (más bien un duplicado): no se propone nada.
    if (new Set(dates).size !== dates.length) continue
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i]!, d))
    const cadence = CADENCES.find((c) => dates.length >= c.count && gaps.every((gap) => gap >= c.min && gap <= c.max))
    if (!cadence) continue
    const last = dates[dates.length - 1]!
    if (daysBetween(last, today) > cadence.max + 7) continue
    const latest = txs[txs.length - 1]!
    const already = covered.some(
      (s) =>
        s.amountMinor === g.amountMinor &&
        ((s.key.length >= 3 && (s.key.includes(g.key) || g.key.includes(s.key))) || (s.categoryId === latest.categoryId && s.frequency === cadence.frequency)),
    )
    if (already) continue
    const text = (latest.merchant || latest.note || '').trim()
    out.push({
      key: g.key,
      label: (merchantLabel(text) || text).slice(0, 60),
      amountMinor: g.amountMinor,
      frequency: cadence.frequency,
      categoryId: latest.categoryId,
      accountId: latest.accountId,
      dates,
      txIds: txs.map((t) => t.id),
      nextDate: nextAfter(last, cadence.frequency, today),
    })
  }
  return out.sort((a, b) => (a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : a.key.localeCompare(b.key)))
}
