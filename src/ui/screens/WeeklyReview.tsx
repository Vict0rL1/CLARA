/**
 * Revisión semanal: resumen de lunes a domingo con comparación equivalente y
 * observaciones basadas en reglas (sin IA). Cálculos en `domain/weeklyReview.ts`.
 */
import { useMemo } from 'react'
import { addDays, isValidLocalDate } from '../../domain/dates'
import { updateSettings } from '../../domain/operations'
import { trackedSince, weeklyReview, weekStartOf, type Observation, type WeekChange } from '../../domain/weeklyReview'
import { useT } from '../../i18n'
import { useRun, useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { Alert, Badge, CalcRow, Card, Explain, Meter, PageHeader } from '../components/common'
import { InsightsTabs } from '../components/InsightsTabs'
import { CheckboxField } from '../components/fields'
import { Icon } from '../components/Icon'
import { useFormat, type Formatter } from '../format'
import { categoryLabel, planItemName } from '../labels'
import { href, withQuery, type Route } from '../router'

export function WeeklyReview({ route }: { route: Route }) {
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const requested = route.query.get('semana')
  const thisWeek = weekStartOf(today)
  const start = requested && isValidLocalDate(requested) && requested <= today ? weekStartOf(requested) : thisWeek
  const r = useMemo(() => weeklyReview(data, start, today), [data, start, today])
  const since = useMemo(() => trackedSince(data), [data])
  const prevHref = href(withQuery('/revision', { semana: addDays(start, -7) }))
  const nextStart = addDays(start, 7)

  const change = (c: WeekChange, previousMinor: number) => {
    if (r.current.coverage !== 'complete' || r.previous.coverage !== 'complete') return t('weekly.compareMissing')
    const diff = fmt.money(Math.abs(c.diffMinor))
    const base = t('weekly.comparePrev', { amount: fmt.money(previousMinor) })
    if (c.diffMinor === 0) return `${base} · ${t('weekly.same')}`
    const dir = t(c.diffMinor > 0 ? 'weekly.more' : 'weekly.less', { amount: diff })
    return c.percent === null ? `${base} · ${dir} · ${t('weekly.noPercent')}` : `${base} · ${dir} (${fmt.percent(Math.abs(c.percent) / 100)})`
  }

  return (
    <div className="stack">
      <PageHeader title={t('weekly.title')} back={{ href: href('/'), label: t('nav.home') }} />
      <InsightsTabs active="revision" />
      <nav className="month-nav" aria-label={t('weekly.navAria')}>
        <a className="btn btn--ghost btn--icon" href={prevHref}>
          <Icon name="chevronLeft" />
          <span className="sr-only">{t('weekly.prev')}</span>
        </a>
        <h2 className="month-nav__title" aria-live="polite">
          {t('weekly.range', { from: fmt.date(r.weekStart), to: fmt.date(r.weekEnd) })}
        </h2>
        {nextStart <= today ? (
          <a className="btn btn--ghost btn--icon" href={href(nextStart === thisWeek ? '/revision' : withQuery('/revision', { semana: nextStart }))}>
            <Icon name="chevronRight" />
            <span className="sr-only">{t('weekly.next')}</span>
          </a>
        ) : (
          <span className="btn btn--ghost btn--icon" aria-hidden="true" />
        )}
      </nav>
      <p className="item__badges">
        {r.isCurrent ? (
          <Badge tone="info" icon="clock">
            {t('weekly.current', { date: fmt.date(r.throughDate, { compact: true, today }) })}
          </Badge>
        ) : (
          <Badge icon="check">{t('weekly.closed')}</Badge>
        )}
      </p>

      {r.current.coverage !== 'complete' && (
        <Alert tone="warning" title={t(r.current.coverage === 'none' ? 'weekly.coverageNone' : 'weekly.coveragePartial')}>
          {t('weekly.coverageText', { date: fmt.date(since) })}
        </Alert>
      )}

      <Card labelledBy="week-totals">
        <h2 id="week-totals" className="card__title">
          {t('weekly.totals')}
        </h2>
        <div className="stats">
          <div className="stat">
            <p className="stat__label">{t('weekly.income')}</p>
            <p className="stat__value">{fmt.money(r.current.incomeMinor)}</p>
            <p className="stat__hint">{change(r.incomeChange, r.previous.incomeMinor)}</p>
          </div>
          <div className="stat">
            <p className="stat__label">{t('weekly.spending')}</p>
            <p className="stat__value" data-testid="week-spending">
              {fmt.money(r.current.spendingMinor)}
            </p>
            <p className="stat__hint" data-testid="week-spending-change">
              {change(r.spendingChange, r.previous.spendingMinor)}
            </p>
          </div>
          <div className="stat">
            <p className="stat__label">{t('weekly.balance')}</p>
            <p className="stat__value">{fmt.money(r.current.balanceMinor, { sign: true })}</p>
            <p className="stat__hint">{t('weekly.balanceHint')}</p>
          </div>
        </div>
        {r.current.realizedCount === 0 && r.current.coverage !== 'none' && <p className="note">{t('weekly.noRecordsNote')}</p>}
        <ul className="bullets">
          <li>{t('weekly.toSavings', { amount: fmt.money(r.current.toSavingsMinor) })}</li>
          <li>{t('weekly.goalContributions', { amount: fmt.money(r.current.goalContributionsMinor) })}</li>
        </ul>
        <p className="note">{t('weekly.notSpendingNote')}</p>
        <Explain>
          <div className="calc">
            <CalcRow label={t('weekly.income')} value={fmt.money(r.current.incomeMinor)} />
            <CalcRow op="−" label={t('weekly.spendingExplain')} value={fmt.money(r.current.spendingMinor)} />
            <CalcRow op="=" label={t('weekly.balance')} value={fmt.money(r.current.balanceMinor, { sign: true })} strong />
          </div>
          <ul className="bullets">
            <li>{t('weekly.explainWeek', { zone: data.settings.timeZone })}</li>
            <li>{t(r.isCurrent ? 'weekly.explainCurrent' : 'weekly.explainClosed', { from: fmt.date(r.previous.from), to: fmt.date(r.previous.to) })}</li>
            <li>{t('weekly.explainPercent')}</li>
            <li>{t('weekly.explainExcluded')}</li>
          </ul>
        </Explain>
      </Card>

      <Card labelledBy="week-observations">
        <h2 id="week-observations" className="card__title">
          {t('weekly.observations')}
        </h2>
        {r.observations.length === 0 ? (
          <p>{t('weekly.noObservations')}</p>
        ) : (
          <ul className="bullets" data-testid="week-observations">
            {r.observations.map((o) => (
              <li key={o.id}>{observationText(o, t, tn, fmt)}</li>
            ))}
          </ul>
        )}
        <p className="note">{t('weekly.rulesNote')}</p>
      </Card>

      {r.current.categories.length > 0 && (
        <Card labelledBy="week-categories">
          <h2 id="week-categories" className="card__title">
            {t('weekly.topCategories')}
          </h2>
          <ol className="bullets">
            {r.current.categories.map((c) => (
              <li key={c.categoryId}>
                {categoryLabel(t, c.categoryId)} · {fmt.money(c.netMinor)}
              </li>
            ))}
          </ol>
          <a className="link-more" href={href(withQuery('/movimientos', { desde: r.weekStart, hasta: r.throughDate }))}>
            {t('weekly.seeMovements')}
            <Icon name="chevronRight" size={16} />
          </a>
        </Card>
      )}

      {r.isCurrent && (
        <Card labelledBy="week-upcoming">
          <h2 id="week-upcoming" className="card__title">
            {t('weekly.upcoming')}
          </h2>
          {r.upcoming.length === 0 ? (
            <p>{t('weekly.noUpcoming')}</p>
          ) : (
            <ul className="bullets">
              {r.upcoming.map((i) => (
                <li key={i.key}>
                  {planItemName(i, t)} · {fmt.date(i.date, { compact: true, today })} · {fmt.money(i.amountMinor)}
                  {i.state === 'overdue' ? ` · ${t('state.overdue')}` : ''}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {r.goals.length > 0 && (
        <Card labelledBy="week-goals">
          <h2 id="week-goals" className="card__title">
            {t('weekly.goals')}
          </h2>
          <ul className="goal-mini-list">
            {r.goals.map((g) => {
              const fraction = g.targetMinor > 0 ? g.savedMinor / g.targetMinor : 0
              const valueText = t('goals.progressText', { saved: fmt.money(g.savedMinor), target: fmt.money(g.targetMinor), pct: fmt.percent(Math.min(1, fraction)) })
              return (
                <li key={g.goal.id}>
                  <div className="goal-mini__row">
                    <span className="goal-mini__name">{g.goal.name}</span>
                    <span className="goal-mini__pct">{fmt.money(g.weekMinor, { sign: true })}</span>
                  </div>
                  <Meter fraction={fraction} label={g.goal.name} valueText={valueText} />
                  <p className="item__meta">
                    {valueText} · {t('weekly.goalWeek', { amount: fmt.money(g.weekMinor, { sign: true }) })}
                  </p>
                </li>
              )
            })}
          </ul>
          <p className="note">{t('weekly.goalsNote')}</p>
        </Card>
      )}

      <Card>
        <CheckboxField
          checked={data.settings.weeklyReview !== false}
          onChange={(v) => void run((d, c) => updateSettings(d, { weeklyReview: v }, c))}
          label={t('weekly.settingLabel')}
          hint={t('weekly.settingHint')}
        />
      </Card>
    </div>
  )
}

function observationText(o: Observation, t: ReturnType<typeof useT>['t'], tn: ReturnType<typeof useT>['tn'], fmt: Formatter): string {
  const p = o.params
  const money = (k: string) => fmt.money(Number(p[k] ?? 0))
  switch (o.id) {
    case 'upcomingPayments':
      return tn('weekly.obs.upcomingPayments', Number(p.count), { total: money('totalMinor') })
    case 'overdueBills':
      return tn('weekly.obs.overdueBills', Number(p.count))
    case 'topCategory':
      return t('weekly.obs.topCategory', { category: categoryLabel(t, String(p.categoryId)), amount: money('amountMinor') })
    case 'partialData':
      return t('weekly.obs.partialData', { date: fmt.date(String(p.date)) })
    case 'spendingMore':
    case 'spendingLess':
    case 'goalContributions':
    case 'toSavings':
      return t(`weekly.obs.${o.id}`, { amount: money('amountMinor') })
    default:
      return t(`weekly.obs.${o.id}`)
  }
}
