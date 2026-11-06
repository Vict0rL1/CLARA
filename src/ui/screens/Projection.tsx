import { useMemo, useState } from 'react'
import { computeBudget } from '../../domain/budget'
import { compareScenarios, estimateDailySpend, projectBalance } from '../../domain/projection'
import type { IncomeScenario } from '../../domain/types'
import { useT, type MessageKey } from '../../i18n'
import { useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { ProjectionChart } from '../components/charts'
import { Alert, Card, Explain, Why } from '../components/common'
import { MoneyField, Segmented } from '../components/fields'
import { parseMoneyText, moneyErrorMessage } from '../moneyText'
import { useFormat } from '../format'
import { planItemName } from '../labels'

type SpendMode = 'none' | 'average' | 'custom'

export function Projection() {
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const estimate = useMemo(() => estimateDailySpend(data, today), [data, today])
  const [mode, setMode] = useState<SpendMode>(estimate.sufficient ? 'average' : 'none')
  const [customText, setCustomText] = useState('')
  const custom = customText.trim() ? parseMoneyText(customText, fmt, { allowZero: true }) : null
  const customMinor = custom && custom.ok ? custom.minor : 0
  const dailySpendMinor = mode === 'average' ? estimate.dailyMinor : mode === 'custom' ? customMinor : 0

  // Por defecto, el escenario prudente: el mínimo de los ingresos variables.
  const [scenario, setScenario] = useState<IncomeScenario>('min')
  const hasVariable = data.schedules.some((s) => s.kind === 'income' && !!s.range)
  const projection = projectBalance(data, today, { dailySpendMinor, scenario })
  const comparison = hasVariable ? compareScenarios(data, today, { dailySpendMinor }) : []
  const budget = useMemo(() => computeBudget(data, today), [data, today])
  const eventDays = projection.days.filter((d) => d.events.length > 0 || d.endMinor < 0)
  // Fuera del rango exacto (auditoría del 2026-11-02, P4): la curva y las cifras llegan hasta el último día exacto y se
  // dice desde cuándo no hay cifra; «sin faltante» solo se afirma con la proyección completa. La cobertura es la de la
  // proyección ELEGIDA; cada fila del comparador lleva la suya (auditoría del 2026-11-04, F2) y con cero días exactos
  // no se afirma «hasta hoy».
  const outOfRangeFrom = projection.outOfRangeFrom
  const lastExact = projection.lastExactDate
  const compact = (date: string) => fmt.date(date, { compact: true, today })
  const partial = (date: string) => ({ date: compact(date), until: lastExact ? compact(lastExact) : '' })
  const scenarioLabel = (s: IncomeScenario) => t(`projection.scenario.${s}` as MessageKey)
  const anyPartial = comparison.some((c) => c.outOfRangeFrom !== null)
  const anyGrossMissing = comparison.some((c) => c.incomeMinor === null)

  return (
    <div className="stack">
      <Card>
        <Why short={t('projection.introShort')}>{t('projection.intro')}</Why>
        {projection.firstNegativeDate ? (
          <Alert tone="critical" title={t('projection.shortfallTitle', { date: fmt.date(projection.firstNegativeDate, { weekday: true }) })} role="status">
            <Why short={t('projection.shortfallShort', { amount: fmt.money(projection.lowest.minor), date: fmt.date(projection.lowest.date) })}>
              {t('projection.shortfallText', { amount: fmt.money(projection.lowest.minor), date: fmt.date(projection.lowest.date) })}
            </Why>
          </Alert>
        ) : outOfRangeFrom ? null : (
          <Alert tone="good" title={t('projection.noShortfallTitle')}>
            {t('projection.noShortfallText', { amount: fmt.money(projection.lowest.minor), date: fmt.date(projection.lowest.date) })}
          </Alert>
        )}
        {outOfRangeFrom && (
          <Alert tone="warning" title={lastExact ? t('projection.partialTitle', partial(outOfRangeFrom)) : t('projection.partialNoneTitle')} role="status">
            <span data-testid="projection-partial">
              {lastExact ? t(projection.firstNegativeDate ? 'projection.partialTextShortfall' : 'projection.partialText', partial(outOfRangeFrom)) : t('projection.partialNoneText')}
            </span>
          </Alert>
        )}
        {projection.firstBelowGoalsDate && !projection.firstNegativeDate && (
          <Alert tone="warning" title={t('projection.belowGoalsTitle', { date: fmt.date(projection.firstBelowGoalsDate) })}>
            {t('projection.belowGoalsText', { amount: fmt.money(projection.goalsReservedMinor) })}
          </Alert>
        )}
        {hasVariable && (
          <Segmented
            legend={t('projection.scenario')}
            name="scenario"
            value={scenario}
            onChange={setScenario}
            options={(['min', 'expected', 'extra'] as const).map((s) => ({ value: s, label: t(`projection.scenario.${s}` as MessageKey) }))}
            hint={t('projection.scenarioHint')}
          />
        )}
        <ProjectionChart projection={projection} fmt={fmt} today={today} />
        {outOfRangeFrom && <p className="note note--icon">{lastExact ? t('projection.partialChartNote', partial(outOfRangeFrom)) : t('projection.partialChartNoteNone')}</p>}
        <Why short={t('projection.chartShort')}>{t('projection.chartNote')}</Why>
      </Card>

      {hasVariable && (
        <Card labelledBy="compare-title">
          <h2 id="compare-title" className="card__title">
            {t('projection.compareTitle')}
          </h2>
          {/* Enfocable: en pantallas estrechas la tabla se desplaza y debe poder recorrerse con teclado. */}
          <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="compare-title">
            <table className="data-table" data-testid="scenario-table" aria-describedby={anyPartial ? 'scenario-coverage' : undefined}>
              <caption className="sr-only">{t('projection.compareCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('projection.colScenario')}</th>
                  <th scope="col" className="num">
                    {t('projection.colIncome')}
                  </th>
                  <th scope="col" className="num">
                    {t('projection.colLowest')}
                  </th>
                  <th scope="col" className="num">
                    {t('projection.colEnd')}
                  </th>
                  <th scope="col">{t('projection.colShortfall')}</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((c) => (
                  <tr key={c.scenario} className={c.firstNegativeDate ? 'is-negative' : undefined} aria-current={c.scenario === scenario ? 'true' : undefined}>
                    <th scope="row">{t(`projection.scenario.${c.scenario}` as MessageKey)}</th>
                    <td className="num">{c.incomeMinor === null ? t('projection.noFigureCell') : fmt.money(c.incomeMinor)}</td>
                    <td className="num">{fmt.money(c.lowest.minor)}</td>
                    <td className="num">{c.outOfRangeFrom ? t('projection.partialCell', { date: compact(c.outOfRangeFrom) }) : fmt.money(c.endMinor)}</td>
                    <td>
                      {c.firstNegativeDate
                        ? `⚠ ${t('projection.shortfallFrom', { date: compact(c.firstNegativeDate) })}`
                        : c.outOfRangeFrom
                          ? c.lastExactDate
                            ? t('projection.partialShortfall', { until: compact(c.lastExactDate) })
                            : t('projection.partialShortfallNone')
                          : t('projection.noShortfallShort')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {anyPartial && (
            <p className="note note--icon" id="scenario-coverage" data-testid="scenario-coverage">
              {t('projection.coverageIntro')}{' '}
              {comparison
                .map((c) =>
                  c.outOfRangeFrom === null
                    ? t('projection.coverageFull', { scenario: scenarioLabel(c.scenario), days: c.exactDays })
                    : c.lastExactDate
                      ? t('projection.coverageUntil', { scenario: scenarioLabel(c.scenario), until: compact(c.lastExactDate), days: c.exactDays })
                      : t('projection.coverageNone', { scenario: scenarioLabel(c.scenario) }),
                )
                .join(' · ')}
            </p>
          )}
          {anyGrossMissing && (
            <p className="note note--icon" data-testid="scenario-gross">
              {t('projection.grossNote')}
            </p>
          )}
          <Why short={t('projection.scenarioShort')}>{t('projection.scenarioHint')}</Why>
        </Card>
      )}

      <Card labelledBy="assumptions-title">
        <h2 id="assumptions-title" className="card__title">
          {t('projection.assumptionsTitle')}
        </h2>
        <Segmented
          legend={t('projection.spendLegend')}
          name="spend"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'none', label: t('projection.spendNone') },
            ...(estimate.sufficient ? [{ value: 'average' as const, label: t('projection.spendAverage', { amount: fmt.money(estimate.dailyMinor) }) }] : []),
            { value: 'custom', label: t('projection.spendCustom') },
          ]}
          hint={estimate.sufficient ? tn('projection.spendAverageHint', estimate.daysObserved) : t('projection.spendInsufficient')}
        />
        {mode === 'custom' && (
          <MoneyField label={t('projection.customLabel')} value={customText} onChange={setCustomText} error={custom && !custom.ok ? moneyErrorMessage(t, custom) : null} fmt={fmt} />
        )}
        <ul className="bullets">
          <li>{t('projection.assumeStart', { amount: fmt.money(projection.startMinor) })}</li>
          <li>{t('projection.assumePlanned')}</li>
          {dailySpendMinor > 0 && <li>{t('projection.assumeDaily', { amount: fmt.money(dailySpendMinor) })}</li>}
          {projection.overdueOutflowsToday.length > 0 && <li>{tn('projection.assumeOverdue', projection.overdueOutflowsToday.length)}</li>}
          {projection.lateIncomesExcluded.length > 0 && (
            <li>
              {t('projection.assumeLateIncome', {
                names: projection.lateIncomesExcluded.map((i) => planItemName(i, t)).join(', '),
              })}
            </li>
          )}
          {projection.estimatedItems.length > 0 && <li>{t('projection.assumeEstimates')}</li>}
          {hasVariable && <li>{t('projection.assumeScenario', { scenario: t(`projection.scenario.${scenario}` as MessageKey) })}</li>}
          <li>{t('projection.assumeGoals')}</li>
          <li>{t('projection.assumeNoCards')}</li>
        </ul>
        {!projection.hasIncomeInRange && <Alert tone="warning" title={t('projection.noIncomeTitle')}>{t('projection.noIncomeText')}</Alert>}
        {budget.isBalanceStale && budget.balanceAgeDays !== null && (
          <Alert tone="warning" icon="clock" title={tn('home.alert.staleTitle', budget.balanceAgeDays)}>
            {t('projection.staleText')}
          </Alert>
        )}
      </Card>

      <Card labelledBy="table-title">
        <h2 id="table-title" className="card__title">
          {t('projection.tableTitle')}
        </h2>
        <Explain summary={t('projection.tableToggle')}>
          <div className="table-scroll">
            <table className="data-table">
              <caption className="sr-only">{t('projection.tableCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('fields.date')}</th>
                  <th scope="col">{t('projection.colEvents')}</th>
                  <th scope="col" className="num">
                    {t('projection.colBalance')}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{fmt.date(today, { compact: true, today })}</td>
                  <td>{t('projection.realStart')}</td>
                  <td className="num">{fmt.money(projection.startMinor)}</td>
                </tr>
                {eventDays.map((d) => (
                  <tr key={d.date} className={d.endMinor < 0 ? 'is-negative' : undefined}>
                    <td>{fmt.date(d.date, { compact: true, today, weekday: true })}</td>
                    <td>
                      {d.events.length === 0
                        ? '—'
                        : d.events.map((e) => `${planItemName(e, t)} ${fmt.money(e.budgetEffectMinor, { sign: true })}`).join(' · ')}
                    </td>
                    <td className="num">
                      {d.endMinor < 0 && <span className="neg-flag">⚠ {t('projection.negative')} </span>}
                      {fmt.money(d.endMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">{t('projection.tableNote')}</p>
        </Explain>
      </Card>
    </div>
  )
}
