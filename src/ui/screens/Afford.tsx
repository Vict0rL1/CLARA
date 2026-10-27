import { useMemo, useState } from 'react'
import { simulatePurchase, type AffordVerdict } from '../../domain/affordability'
import { estimateDailySpend } from '../../domain/projection'
import { useT } from '../../i18n'
import { useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { Alert, CalcRow, Card, Explain, PageHeader } from '../components/common'
import { MoneyField, TextField } from '../components/fields'
import { parseMoneyText, moneyErrorMessage } from '../moneyText'
import { Icon, type IconName } from '../components/Icon'
import { HorizonPicker } from '../dialogs'
import { useFormat } from '../format'
import { planItemName } from '../labels'
import { href, withQuery } from '../router'

const VERDICT: Record<AffordVerdict, { tone: 'good' | 'warning' | 'critical'; icon: IconName }> = {
  fits: { tone: 'good', icon: 'checkCircle' },
  tight: { tone: 'warning', icon: 'alert' },
  onlyWithBuffer: { tone: 'warning', icon: 'alert' },
  onlyWithGoals: { tone: 'warning', icon: 'alert' },
  doesNotFit: { tone: 'critical', icon: 'x' },
}

export function Afford() {
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const [priceText, setPriceText] = useState('')
  const [what, setWhat] = useState('')
  const [useSpendEstimate, setUseSpendEstimate] = useState(true)

  const parsed = priceText.trim() === '' ? null : parseMoneyText(priceText, fmt)
  const priceError = parsed && !parsed.ok ? moneyErrorMessage(t, parsed) : null
  const spend = useMemo(() => estimateDailySpend(data, today), [data, today])
  const dailySpendMinor = useSpendEstimate && spend.sufficient ? spend.dailyMinor : 0

  const priceMinor = parsed && parsed.ok ? parsed.minor : null
  const result = useMemo(() => (priceMinor !== null ? simulatePurchase(data, today, priceMinor, { dailySpendMinor }) : null), [data, today, priceMinor, dailySpendMinor])
  const budget = result?.budget

  return (
    <div className="stack">
      <PageHeader title={t('afford.title')} back={{ href: href('/'), label: t('nav.home') }} />
      <p className="lead">{t('afford.intro')}</p>

      <Card className="form">
        <MoneyField label={t('afford.priceLabel')} value={priceText} onChange={setPriceText} error={priceError} fmt={fmt} big autoFocus name="price" />
        <TextField label={t('afford.whatLabel')} value={what} maxLength={120} onChange={(e) => setWhat(e.target.value)} placeholder={t('afford.whatPlaceholder')} />
        <p className="note">
          <Icon name="lock" size={16} /> {t('afford.noSave')}
        </p>
        <p className="link-row">
          <a href={href('/alcanza/escenarios')}>
            <Icon name="scale" size={16} />
            {t('scenario.openCompare')}
            {data.scenarios.length > 0 ? ` (${data.scenarios.length})` : ''}
          </a>
          {priceMinor !== null && (
            <a href={href(withQuery('/alcanza/escenarios/nuevo', { amount: priceMinor, note: what.trim() || undefined }))}>
              <Icon name="plus" size={16} />
              {t('scenario.saveFromAfford')}
            </a>
          )}
        </p>
      </Card>

      <div aria-live="polite" className="stack">
        {result && budget && budget.status === 'needsHorizon' && (
          <Card>
            <Alert tone="info" title={t('afford.needsHorizon')} />
            <HorizonPicker />
          </Card>
        )}

        {result && budget && result.verdict && budget.horizon && (
          <>
            <Card className={`verdict verdict--${VERDICT[result.verdict].tone}`}>
              <div className="verdict__head">
                <Icon name={VERDICT[result.verdict].icon} size={28} />
                <h2 className="verdict__title" data-testid="verdict">
                  {t(`afford.verdict.${result.verdict}`)}
                </h2>
              </div>
              <p>
                {t(`afford.verdictText.${result.verdict}`, {
                  price: fmt.money(result.priceMinor),
                  after: fmt.money(result.availableAfterMinor),
                  shortage: fmt.money(Math.max(0, -result.availableAfterMinor)),
                  date: fmt.date(budget.horizon.endDate),
                })}
              </p>
              {result.futureShortfallDate && !result.shortfallExistedBefore && (
                <Alert tone="warning" title={t('afford.futureShortfall', { date: fmt.date(result.futureShortfallDate, { weekday: true }) })}>
                  {t('afford.futureShortfallText')}
                </Alert>
              )}
              {result.futureShortfallDate && result.shortfallExistedBefore && result.projectionBefore.firstNegativeDate && (
                <Alert tone="warning" title={t('afford.existingShortfall', { date: fmt.date(result.projectionBefore.firstNegativeDate, { weekday: true }) })}>
                  {t('afford.existingShortfallText', { before: fmt.money(result.projectionBefore.lowest.minor), after: fmt.money(result.projectionAfter.lowest.minor) })}
                </Alert>
              )}

              <table className="compare">
                <caption className="sr-only">{t('afford.compareCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">{t('afford.concept')}</span>
                    </th>
                    <th scope="col">{t('afford.now')}</th>
                    <th scope="col">{t('afford.after')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">{t('afford.rowAvailable')}</th>
                    <td>{fmt.money(budget.availableMinor)}</td>
                    <td data-testid="available-after">{fmt.money(result.availableAfterMinor)}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('afford.rowDaily')}</th>
                    <td>{fmt.money(budget.dailyMinor ?? 0)}</td>
                    <td>{fmt.money(result.dailyAfterMinor ?? 0)}</td>
                  </tr>
                  <tr>
                    <th scope="row">{budget.weeklyDays === 7 ? t('home.weekly') : tn('home.weeklyShort', budget.weeklyDays ?? 0)}</th>
                    <td>{fmt.money(budget.weeklyMinor ?? 0)}</td>
                    <td>{fmt.money(result.weeklyAfterMinor ?? 0)}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('afford.rowLowest')}</th>
                    <td>
                      {fmt.money(result.projectionBefore.lowest.minor)}
                      <span className="compare__sub">{fmt.date(result.projectionBefore.lowest.date, { compact: true, today })}</span>
                    </td>
                    <td>
                      {fmt.money(result.projectionAfter.lowest.minor)}
                      <span className="compare__sub">{fmt.date(result.projectionAfter.lowest.date, { compact: true, today })}</span>
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="button-row">
                <a
                  className="btn btn--primary"
                  href={href(withQuery('/movimientos/nuevo', { kind: 'expense', amount: result.priceMinor, note: what.trim() || undefined, returnTo: '/' }))}
                >
                  <Icon name="plus" />
                  {t('afford.register')}
                </a>
              </div>
              <p className="note">{t('afford.registerNote')}</p>
            </Card>

            <Card labelledBy="considered-title">
              <h2 id="considered-title" className="card__title">
                {t('afford.consideredTitle')}
              </h2>
              <div className="calc">
                <CalcRow label={t('explain.balance')} value={fmt.money(budget.spendableMinor)} />
                <CalcRow op="−" label={tn('explain.reserved', budget.reservedItems.length)} value={fmt.money(budget.reservedTotalMinor)} />
                {budget.reservedItems.map((i) => (
                  <p className="calc__detail" key={i.key}>
                    {planItemName(i, t)} · {fmt.date(i.date, { compact: true, today })} · {fmt.money(-i.budgetEffectMinor)}
                  </p>
                ))}
                <CalcRow op="−" label={t('explain.goals')} value={fmt.money(budget.goalsReservedMinor)} />
                {budget.goalReservations.map((g) => (
                  <p className="calc__detail" key={g.goal.id}>
                    {g.goal.name} · {fmt.money(g.amountMinor)}
                  </p>
                ))}
                {budget.safetyBufferMinor > 0 && <CalcRow op="−" label={t('explain.buffer')} value={fmt.money(budget.safetyBufferMinor)} />}
                <CalcRow op="=" label={t('explain.available')} value={fmt.money(budget.availableMinor)} strong />
                <CalcRow op="−" label={t('afford.thisPurchase')} value={fmt.money(result.priceMinor)} />
                <CalcRow op="=" label={t('afford.availableAfter')} value={fmt.money(result.availableAfterMinor)} strong />
              </div>
              <ul className="bullets">
                <li>{budget.period ? t('explain.period.days', { from: fmt.date(budget.period.start, { compact: true }), to: fmt.date(budget.period.end, { compact: true }), days: tn('home.periodDays', budget.period.daysLeft) }) : t(budget.horizon.source === 'income' ? 'explain.incomeDayExcluded' : 'explain.fallbackHorizon', { date: fmt.date(budget.horizon.endDate) })}</li>
                <li>{t('explain.futureIncomeNotCounted')}</li>
                {budget.overdueIncomes.length > 0 && <li>{t('afford.lateIncomeNote')}</li>}
              </ul>
              <Explain summary={t('afford.projectionAssumptions')}>
                <label className="check">
                  <input type="checkbox" checked={useSpendEstimate} onChange={(e) => setUseSpendEstimate(e.target.checked)} disabled={!spend.sufficient} />
                  <span>
                    {spend.sufficient
                      ? t('afford.useSpendEstimate', { amount: fmt.money(spend.dailyMinor) })
                      : t('afford.spendEstimateUnavailable')}
                  </span>
                </label>
                <p className="note">{t('afford.projectionNote')}</p>
              </Explain>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
