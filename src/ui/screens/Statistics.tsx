/**
 * Estadísticas (§7.6): cabecera con navegador y chips de periodo, tres cifras con delta, donut por
 * categoría, ingresos vs gastos de 6 periodos, tendencia acumulada, top 5, promedio diario y saldo
 * futuro a 90 días. Solo muestra lo que calcula `domain/statistics.ts`.
 */
import { useMemo, useState } from 'react'
import { categoryVisual, categoryVisuals } from '../../domain/categories'
import { addDays } from '../../domain/dates'
import { categoryBreakdown, cumulativeTrend, dailyAverage, futureBalance, periodSeries, periodStats, shiftRange, statsRange, STATS_PERIOD_TYPES, topMerchants, type Delta, type SeriesPoint, type StatsPeriodType } from '../../domain/statistics'
import type { CategoryColor } from '../../domain/types'
import { useT, type MessageKey } from '../../i18n'
import { useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { MonthNavigator, SecondaryButton } from '../components/base'
import { Card, EmptyState, Explain, PageHeader } from '../components/common'
import { InsightsTabs } from '../components/InsightsTabs'
import { TextField } from '../components/fields'
import { Icon } from '../components/Icon'
import { CategoryDonut, FutureBalanceChart, IncomeExpenseBars, TrendLines } from '../components/statsCharts'
import { DATE_LOCALE, useFormat, type Formatter } from '../format'
import { categoryLabel } from '../labels'
import { periodLabel } from '../periodLabel'
import { href, navigate, withQuery, type Route } from '../router'

const CHIPS: StatsPeriodType[] = STATS_PERIOD_TYPES
/** Un domingo conocido: sumando el índice se obtiene cada día de la semana para etiquetarlo con el formateador. */
const A_SUNDAY = '2026-01-04'

function DeltaText({ delta, fmt, invert }: { delta: Delta; fmt: Formatter; invert?: boolean }) {
  const { t } = useT()
  if (delta.percent === null && delta.diffMinor === 0) return <span className="stat__delta stat__delta--neutral">{t('stats.noComparison')}</span>
  const up = delta.diffMinor > 0
  const good = invert ? !up : up
  const tone = delta.diffMinor === 0 ? 'neutral' : good ? 'good' : 'bad'
  return (
    <span className={`stat__delta stat__delta--${tone}`}>
      <Icon name={delta.diffMinor === 0 ? 'check' : up ? 'arrowUp' : 'arrowDown'} size={14} />
      {delta.percent === null ? fmt.money(delta.diffMinor, { sign: true }) : `${delta.percent > 0 ? '+' : ''}${delta.percent} %`}
      <span className="sr-only"> {t('stats.vsPrevious')}</span>
    </span>
  )
}

export function Statistics({ route }: { route: Route }) {
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const queryType = route.query.get('periodo')
  const defaultType: StatsPeriodType = data.settings.budgetPeriod.type === 'untilIncome' ? 'month' : data.settings.budgetPeriod.type
  const type: StatsPeriodType = CHIPS.includes(queryType as StatsPeriodType) ? (queryType as StatsPeriodType) : defaultType
  const anchor = route.query.get('fecha') ?? today
  const [customStart, setCustomStart] = useState(route.query.get('desde') ?? '')
  const [customEnd, setCustomEnd] = useState(route.query.get('hasta') ?? '')
  const range = useMemo(() => statsRange(type, data.settings, anchor, customStart && customEnd && customEnd >= customStart ? { start: customStart, end: customEnd } : undefined), [type, data.settings, anchor, customStart, customEnd])
  const stats = useMemo(() => periodStats(data, type, range), [data, type, range])
  const breakdown = useMemo(() => categoryBreakdown(data, range), [data, range])
  const series = useMemo(() => periodSeries(data, type, range, 6), [data, type, range])
  const trend = useMemo(() => cumulativeTrend(data, range, stats.previous, today), [data, range, stats.previous, today])
  const top = useMemo(() => topMerchants(data, range, 5), [data, range])
  const avg = useMemo(() => dailyAverage(data, range, today), [data, range, today])
  const future = useMemo(() => futureBalance(data, today), [data, today])
  const visuals = useMemo(() => categoryVisuals(data), [data])
  const color = (id: string): CategoryColor => categoryVisual(visuals, id).color
  const icon = (id: string): string => categoryVisual(visuals, id).icon
  const label = (p: SeriesPoint) => (p.range.period ? periodLabel(t, fmt, p.range.period) : t('home.period.range', { from: fmt.date(p.range.start, { compact: true }), to: fmt.date(p.range.end, { compact: true }) }))
  const title = label({ range, incomeMinor: 0, expensesMinor: 0 })
  // Eje de las barras: etiqueta corta («sep», «T3», «2026», «28 sep»); la completa va en el tooltip y la tabla.
  const axisLabel = (p: SeriesPoint) => {
    const per = p.range.period
    if (per?.type === 'year') return String(per.anchorYear)
    if (per?.type === 'month') return new Intl.DateTimeFormat(DATE_LOCALE[data.settings.language], { month: 'short', timeZone: 'UTC' }).format(new Date(`${p.range.start}T12:00:00Z`)).replace('.', '')
    if (per?.type === 'quarter') return t('stats.axisQuarter', { n: Math.floor((per.anchorMonth - 1) / 3) + 1 })
    if (per?.type === 'semester') return t('stats.axisSemester', { n: per.anchorMonth <= 6 ? 1 : 2 })
    return fmt.date(p.range.start, { compact: true })
  }
  const go = (patch: Record<string, string | undefined>) => navigate(withQuery('/estadisticas', { periodo: type, fecha: anchor, ...patch }))
  const move = (dir: -1 | 1) => {
    const next = shiftRange(range, type, data.settings, dir)
    if (type === 'custom') {
      setCustomStart(next.start)
      setCustomEnd(next.end)
      go({ desde: next.start, hasta: next.end })
    } else go({ fecha: next.start })
  }
  const isCurrent = range.end >= today
  const noData = stats.transactionCount === 0
  const print = () => window.print()

  return (
    <div className="stack statistics">
      <PageHeader title={t('stats.title')}>
        <SecondaryButton onClick={print}>
          <Icon name="download" size={16} />
          {t('stats.exportPdf')}
        </SecondaryButton>
      </PageHeader>
      <InsightsTabs active="estadisticas" />
      <p className="muted statistics__intro">{t('stats.intro')}</p>
      <div className="chips" role="group" aria-label={t('stats.periodType')}>
        {CHIPS.map((p) => (
          <button key={p} type="button" className={`chip${p === type ? ' chip--selected' : ''}`} aria-pressed={p === type} onClick={() => go({ periodo: p, fecha: today })}>
            {t(`period.type.${p}` as MessageKey)}
          </button>
        ))}
      </div>
      {type === 'custom' && (
        <div className="form__row">
          <TextField label={t('settings.period.customStart')} type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
          <TextField label={t('settings.period.customEnd')} type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
        </div>
      )}
      <MonthNavigator label={title} onPrev={() => move(-1)} onNext={() => move(1)} prevLabel={t('stats.prev')} nextLabel={t('stats.next')} nextDisabled={isCurrent} onToday={isCurrent ? undefined : () => go({ fecha: today, desde: undefined, hasta: undefined })} todayLabel={t('stats.today')} />
      <p className="note">{t('stats.rangeNote', { from: fmt.date(range.start, { compact: true, today }), to: fmt.date(range.end, { compact: true, today }) })}</p>

      <div className="stat-grid" data-testid="stats-tiles">
        <Card as="div" className="stat">
          <p className="stat__label">{t('stats.income')}</p>
          <p className="stat__value" data-testid="stats-income">{fmt.money(stats.incomeMinor)}</p>
          <DeltaText delta={stats.income} fmt={fmt} />
        </Card>
        <Card as="div" className="stat">
          <p className="stat__label">{t('stats.expenses')}</p>
          <p className="stat__value" data-testid="stats-expenses">{fmt.money(stats.expensesMinor)}</p>
          <DeltaText delta={stats.expenses} fmt={fmt} invert />
        </Card>
        <Card as="div" className="stat">
          <p className="stat__label">{t('stats.net')}</p>
          <p className="stat__value" data-testid="stats-net">{fmt.money(stats.netMinor, { sign: true })}</p>
          <DeltaText delta={stats.net} fmt={fmt} />
        </Card>
      </div>
      {!stats.previousComparable && <p className="note">{t('stats.notComparable')}</p>}

      {noData ? (
        <EmptyState icon="chart" title={t('stats.empty')} text={t('stats.emptyText')} />
      ) : (
        <>
          <Card labelledBy="stats-cat-title">
            <h2 id="stats-cat-title" className="section-title">
              {t('stats.byCategory')}
            </h2>
            {breakdown.categories.length === 0 ? (
              <EmptyState compact icon="chart" title={t('stats.noExpenses')} />
            ) : (
              <CategoryDonut categories={breakdown.categories} total={breakdown.total} fmt={fmt} label={(id) => categoryLabel(t, id)} color={color} icon={icon} onSelect={(id) => navigate(withQuery('/movimientos', { categoria: id, desde: range.start, hasta: range.end }))} />
            )}
            <Explain summary={t('common.howCalculated')}>
              <p>{t('stats.byCategoryExplain')}</p>
            </Explain>
          </Card>

          <Card labelledBy="stats-bars-title">
            <h2 id="stats-bars-title" className="section-title">
              {t('stats.barsTitle')}
            </h2>
            <IncomeExpenseBars series={series} fmt={fmt} label={label} axisLabel={axisLabel} currentStart={range.start} onOpen={type === 'custom' ? undefined : (p) => go({ fecha: p.range.start })} />
            <Explain summary={t('common.howCalculated')}>
              <p>{t('stats.barsExplain')}</p>
            </Explain>
          </Card>

          <Card labelledBy="stats-trend-title">
            <h2 id="stats-trend-title" className="section-title">
              {t('stats.trendTitle')}
            </h2>
            <TrendLines trend={trend} fmt={fmt} today={today} />
            <Explain summary={t('common.howCalculated')}>
              <p>{t('stats.trendExplain')}</p>
            </Explain>
          </Card>

          <Card labelledBy="stats-top-title">
            <h2 id="stats-top-title" className="section-title">
              {t('stats.topTitle')}
            </h2>
            {top.length === 0 ? (
              <EmptyState compact icon="list" title={t('stats.topEmpty')} />
            ) : (
              <ol className="top-list" data-testid="stats-top">
                {top.map((e) => (
                  <li key={e.key}>
                    <a href={href(withQuery('/movimientos', { desde: range.start, hasta: range.end }))}>
                      <span className="top-list__name">{e.label}</span>
                      <span className="top-list__meta">{tn('stats.topCount', e.count)}</span>
                      <span className="top-list__amount">{fmt.money(e.amountMinor)}</span>
                    </a>
                  </li>
                ))}
              </ol>
            )}
            <Explain summary={t('common.howCalculated')}>
              <p>{t('stats.topExplain')}</p>
            </Explain>
          </Card>

          <Card labelledBy="stats-avg-title">
            <h2 id="stats-avg-title" className="section-title">
              {t('stats.dailyTitle')}
            </h2>
            <p className="stat__value" data-testid="stats-daily">{fmt.money(avg.averageMinor)}</p>
            <p className="item__meta">{tn('stats.dailyDays', avg.daysCounted)}</p>
            {avg.topWeekday !== null && <p data-testid="stats-weekday">{t('stats.topWeekday', { day: fmt.weekdayShort(addDays(A_SUNDAY, avg.topWeekday)), amount: fmt.money(avg.topWeekdayMinor) })}</p>}
            <Explain summary={t('common.howCalculated')}>
              <p>{t('stats.dailyExplain')}</p>
            </Explain>
          </Card>
        </>
      )}

      {future.enough ? (
        <Card labelledBy="stats-future-title">
          <h2 id="stats-future-title" className="section-title">
            {t('stats.futureTitle')}
          </h2>
          <FutureBalanceChart future={future} fmt={fmt} today={today} />
          <p className="note">{t('stats.futureNote')}</p>
          <Explain summary={t('common.howCalculated')}>
            <p>{t('stats.futureExplain', { daily: fmt.money(future.dailySpendMinor), days: future.daysObserved })}</p>
          </Explain>
        </Card>
      ) : (
        <p className="note" data-testid="stats-future-hidden">
          {t(future.reason === 'noHistory' ? 'stats.futureNoHistory' : 'stats.futureFewDays')}
        </p>
      )}
      <p className="note">{t('stats.note')}</p>
    </div>
  )
}
