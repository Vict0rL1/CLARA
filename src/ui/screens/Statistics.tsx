/**
 * Estadísticas (§7.6): cabecera con navegador y chips de periodo, tres cifras con delta, donut por
 * categoría, ingresos vs gastos de 6 periodos, tendencia acumulada, top 5, promedio diario y saldo
 * futuro a 90 días. Solo muestra lo que calcula `domain/statistics.ts`.
 */
import { useMemo, useState } from 'react'
import { categoryVisual, categoryVisuals } from '../../domain/categories'
import { addDays, daysBetween } from '../../domain/dates'
import { filterStatsData, statsFilterCount, type StatsFilter } from '../../domain/statsFilter'
import { categoryBreakdown, cumulativeTrend, dailyAverage, futureBalance, periodSeries, periodStats, shiftRange, statsRange, STATS_PERIOD_TYPES, topMerchants, type Delta, type SeriesPoint, type StatsPeriodType } from '../../domain/statistics'
import type { CategoryColor } from '../../domain/types'
import { useT, type MessageKey } from '../../i18n'
import { useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { MonthNavigator, SecondaryButton } from '../components/base'
import { Card, EmptyState, Explain, PageHeader } from '../components/common'
import { InsightsTabs } from '../components/InsightsTabs'
import { SelectField, TextField } from '../components/fields'
import { Icon } from '../components/Icon'
import { CategoryDonut, FutureBalanceChart, IncomeExpenseBars, TrendLines } from '../components/statsCharts'
import { DATE_LOCALE, useFormat, type Formatter } from '../format'
import { categoryLabel } from '../labels'
import { periodLabel } from '../periodLabel'
import { href, navigate, replaceRouteQuietly, withQuery, type Route } from '../router'

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
  // Revisión propia (R2): la dirección manda. Al navegar (chips, «Hoy», atrás/adelante) las fechas escritas se alinean
  // con las de la dirección —también cuando no las hay— (estado ajustado durante el render, sin efecto); escribirlas
  // cambia el estado y actualiza la dirección sin navegar (`setCustom`), así nunca se contradicen. Hoy la pantalla se
  // vuelve a montar con cada dirección (App.tsx la clava por ruta y consulta); esta guarda vale igual sin eso.
  const urlStart = route.query.get('desde') ?? ''
  const urlEnd = route.query.get('hasta') ?? ''
  const urlDates = `${urlStart}|${urlEnd}`
  const [custom, setCustomState] = useState({ from: urlDates, start: urlStart, end: urlEnd })
  if (custom.from !== urlDates) setCustomState({ from: urlDates, start: urlStart, end: urlEnd })
  const customStart = custom.from === urlDates ? custom.start : urlStart
  const customEnd = custom.from === urlDates ? custom.end : urlEnd
  const range = useMemo(() => statsRange(type, data.settings, anchor, customStart && customEnd && customEnd >= customStart ? { start: customStart, end: customEnd } : undefined), [type, data.settings, anchor, customStart, customEnd])
  // Clara 2.0 fase 4: filtros por cuenta, etiqueta y comercio (en la dirección, como el periodo). Solo se
  // filtran los movimientos; cada cifra se calcula igual. Un valor que ya no existe se ignora.
  const qAccount = route.query.get('cuenta') ?? ''
  const qTag = route.query.get('etiqueta') ?? ''
  const qMerchant = (route.query.get('comercio') ?? '').slice(0, 120)
  const filter: StatsFilter = useMemo(
    () => ({
      ...(data.accounts.some((a) => a.id === qAccount) ? { accountId: qAccount } : {}),
      ...(data.tags.some((tg) => tg.id === qTag) ? { tagId: qTag } : {}),
      ...(qMerchant ? { merchant: qMerchant } : {}),
    }),
    [data.accounts, data.tags, qAccount, qTag, qMerchant],
  )
  const filterCount = statsFilterCount(filter)
  const fdata = useMemo(() => filterStatsData(data, filter), [data, filter])
  // Comercios para elegir: los del último año (sin filtros), y el elegido aunque ya no salga.
  const merchantOptions = useMemo(() => {
    const list = topMerchants(data, { start: addDays(today, -365), end: today, period: null }, 40).map((e) => ({ value: e.key, label: e.label }))
    return filter.merchant && !list.some((o) => o.value === filter.merchant) ? [...list, { value: filter.merchant, label: filter.merchant }] : list
  }, [data, today, filter.merchant])
  const stats = useMemo(() => periodStats(fdata, type, range), [fdata, type, range])
  const breakdown = useMemo(() => categoryBreakdown(fdata, range), [fdata, range])
  const series = useMemo(() => periodSeries(fdata, type, range, 6), [fdata, type, range])
  const trend = useMemo(() => cumulativeTrend(fdata, range, stats.previous, today), [fdata, range, stats.previous, today])
  const top = useMemo(() => topMerchants(fdata, range, 5), [fdata, range])
  const avg = useMemo(() => dailyAverage(fdata, range, today), [fdata, range, today])
  const future = useMemo(() => futureBalance(data, today), [data, today])
  const visuals = useMemo(() => categoryVisuals(data), [data])
  const color = (id: string): CategoryColor => categoryVisual(visuals, id).color
  const icon = (id: string): string => categoryVisual(visuals, id).icon
  const label = (p: SeriesPoint) => (p.range.period ? periodLabel(t, fmt, p.range.period) : t('home.period.range', { from: fmt.date(p.range.start, { compact: true }), to: fmt.date(p.range.end, { compact: true }) }))
  const title = label({ range, incomeMinor: 0, expensesMinor: 0 })
  // Eje de las barras: etiqueta corta («sep», «T3», «2026», «28 sep»); la completa va en el tooltip y la tabla.
  // F-05: para semanas, quincenas y periodos personalizados se ofrecen dos formas (fecha compacta —sin el año si es el
  // de hoy— y «día mes» en el estilo de fecha elegido) y el gráfico dibuja la más larga que cabe en cada hueco.
  const dayMonth = (date: string) => {
    if (data.settings.dateStyle === 'iso') return date.slice(5)
    const locale = DATE_LOCALE[data.settings.language]
    const d = new Date(`${date}T12:00:00Z`)
    if (data.settings.dateStyle === 'short') return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(d)
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d).replace(/\./g, '').replace(/ de /g, ' ')
  }
  const axisLabel = (p: SeriesPoint): string | readonly string[] => {
    const per = p.range.period
    if (per?.type === 'year') return String(per.anchorYear)
    if (per?.type === 'month') return new Intl.DateTimeFormat(DATE_LOCALE[data.settings.language], { month: 'short', timeZone: 'UTC' }).format(new Date(`${p.range.start}T12:00:00Z`)).replace('.', '')
    if (per?.type === 'quarter') return t('stats.axisQuarter', { n: Math.floor((per.anchorMonth - 1) / 3) + 1 })
    if (per?.type === 'semester') return t('stats.axisSemester', { n: per.anchorMonth <= 6 ? 1 : 2 })
    return [fmt.date(p.range.start, { compact: true, today }), dayMonth(p.range.start)]
  }
  // QA V2 (STAT-01): las fechas de un periodo personalizado viven en la dirección como el resto; cambiar un filtro
  // las conserva y escribirlas las actualiza (sin navegar), así sobreviven a recargar y a compartir el enlace.
  const pathFor = (patch: Record<string, string | undefined>) =>
    withQuery('/estadisticas', {
      periodo: type,
      fecha: anchor,
      // Las fechas personalizadas van solo cuando el periodo DESTINO es el personalizado (no quedan en otro periodo).
      ...((patch.periodo ?? type) === 'custom' ? { desde: customStart || undefined, hasta: customEnd || undefined } : {}),
      cuenta: filter.accountId,
      etiqueta: filter.tagId,
      comercio: filter.merchant,
      ...patch,
    })
  const go = (patch: Record<string, string | undefined>) => navigate(pathFor(patch))
  const setCustom = (start: string, end: string) => {
    setCustomState((c) => ({ ...c, start, end }))
    replaceRouteQuietly(pathFor({ desde: start || undefined, hasta: end || undefined }))
  }
  const filterNames = [
    filter.accountId ? data.accounts.find((a) => a.id === filter.accountId)?.name : undefined,
    filter.tagId ? data.tags.find((tg) => tg.id === filter.tagId)?.name : undefined,
    filter.merchant ? (merchantOptions.find((o) => o.value === filter.merchant)?.label ?? filter.merchant) : undefined,
  ].filter((x): x is string => !!x)
  const move = (dir: -1 | 1) => {
    const next = shiftRange(range, type, data.settings, dir)
    if (type === 'custom') go({ desde: next.start, hasta: next.end })
    else go({ fecha: next.start })
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
          <TextField label={t('settings.period.customStart')} type="date" value={customStart} onChange={(e) => setCustom(e.target.value, customEnd)} />
          <TextField label={t('settings.period.customEnd')} type="date" value={customEnd} onChange={(e) => setCustom(customStart, e.target.value)} />
        </div>
      )}
      <MonthNavigator label={title} onPrev={() => move(-1)} onNext={() => move(1)} prevLabel={t('stats.prev')} nextLabel={t('stats.next')} nextDisabled={isCurrent} onToday={isCurrent ? undefined : () => (type === 'custom' ? go({ desde: addDays(today, -daysBetween(range.start, range.end)), hasta: today }) : go({ fecha: today }))} todayLabel={t('stats.today')} />
      <p className="note">{t('stats.rangeNote', { from: fmt.date(range.start, { compact: true, today }), to: fmt.date(range.end, { compact: true, today }) })}</p>
      <details className="explain" data-testid="stats-filters" open={filterCount > 0 || undefined}>
        <summary>
          <Icon name="sliders" size={16} />
          <span>{filterCount > 0 ? t('stats.filters.titleCount', { count: filterCount }) : t('stats.filters.title')}</span>
        </summary>
        <div className="stack-sm">
          <SelectField
            label={t('stats.filters.account')}
            value={filter.accountId ?? ''}
            onChange={(e) => go({ cuenta: e.target.value || undefined })}
            options={[{ value: '', label: t('stats.filters.any') }, ...data.accounts.filter((a) => !a.archived || a.id === filter.accountId).map((a) => ({ value: a.id, label: a.name }))]}
          />
          {data.tags.length > 0 && (
            <SelectField
              label={t('stats.filters.tag')}
              value={filter.tagId ?? ''}
              onChange={(e) => go({ etiqueta: e.target.value || undefined })}
              options={[{ value: '', label: t('stats.filters.any') }, ...data.tags.map((tg) => ({ value: tg.id, label: tg.name }))]}
            />
          )}
          {merchantOptions.length > 0 && (
            <SelectField
              label={t('stats.filters.merchant')}
              hint={t('stats.filters.merchantHint')}
              value={filter.merchant ?? ''}
              onChange={(e) => go({ comercio: e.target.value || undefined })}
              options={[{ value: '', label: t('stats.filters.any') }, ...merchantOptions]}
            />
          )}
        </div>
      </details>
      {filterCount > 0 && (
        <div className="stack-sm" data-testid="stats-filter-active">
          <p className="note">{t('stats.filters.active', { list: filterNames.join(' · ') })}</p>
          <SecondaryButton onClick={() => go({ cuenta: undefined, etiqueta: undefined, comercio: undefined })}>{t('stats.filters.clear')}</SecondaryButton>
        </div>
      )}

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
          {filterCount > 0 && <p className="note">{t('stats.filters.futureNote')}</p>}
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
