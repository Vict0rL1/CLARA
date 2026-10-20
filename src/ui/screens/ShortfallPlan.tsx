/**
 * Plan ante un faltante: cuándo y cuánto falta, qué lo causa, qué se supone y qué palancas
 * lo evitarían. Todo se simula sobre una copia (`domain/shortfall.ts`). Solo se aplican a la
 * planificación las palancas que lo permiten, mostrando cada cambio y con confirmación.
 */
import { useMemo, useState } from 'react'
import { isValidLocalDate } from '../../domain/dates'
import { revertEntry } from '../../domain/historyRevert'
import { estimateDailySpend } from '../../domain/projection'
import { analyzeShortfall, applyShortfallPlan, evaluateLevers, leverBasis, type ShortfallLever } from '../../domain/shortfall'
import type { AppData, IncomeScenario } from '../../domain/types'
import { useT } from '../../i18n'
import { useRun, useToday } from '../../state/hooks'
import { getStore, useData } from '../../state/store'
import { Alert, Badge, CalcRow, Card, PageHeader } from '../components/common'
import { CheckboxField, MoneyField, Segmented, SelectField, TextField } from '../components/fields'
import { ConfirmDialog } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { useToast } from '../components/toastContext'
import { useFormat, type Formatter } from '../format'
import { issueMessage, planItemName } from '../labels'
import { parseMoneyText } from '../moneyText'
import { href, type Route } from '../router'

const HORIZONS = [30, 60, 90] as const
type T = ReturnType<typeof useT>['t']

const leverKey = (l: ShortfallLever) => {
  switch (l.kind) {
    case 'postponePlanned':
    case 'reducePlanned':
      return `${l.kind}:${l.txId}`
    case 'incomeAmount':
      return `${l.kind}:${l.scheduleId}:${l.occurrenceDate}`
    case 'incomeDate':
      return `${l.kind}:${l.scheduleId}:${l.fromDate}`
    case 'dailySpend':
      return l.kind
  }
}

function leverText(l: ShortfallLever, data: AppData, t: T, fmt: Formatter): string {
  const txName = (id: string) => {
    const tx = data.transactions.find((x) => x.id === id)
    return tx?.note || t('shortfall.plannedPurchase')
  }
  const sName = (id: string) => data.schedules.find((s) => s.id === id)?.name ?? '—'
  switch (l.kind) {
    case 'postponePlanned':
      return t('shortfall.lever.postpone', { name: txName(l.txId), from: fmt.date(l.fromDate), to: fmt.date(l.toDate) })
    case 'reducePlanned':
      if (l.toMinor === 0) return t('shortfall.lever.remove', { name: txName(l.txId), amount: fmt.money(l.fromMinor) })
      return t('shortfall.lever.reduce', { name: txName(l.txId), from: fmt.money(l.fromMinor), to: fmt.money(l.toMinor) })
    case 'incomeAmount':
      return t('shortfall.lever.incomeAmount', { name: sName(l.scheduleId), date: fmt.date(l.occurrenceDate), from: fmt.money(l.fromMinor), to: fmt.money(l.toMinor) })
    case 'incomeDate':
      return t('shortfall.lever.incomeDate', { name: sName(l.scheduleId), from: fmt.date(l.fromDate), to: fmt.date(l.toDate) })
    case 'dailySpend':
      return t('shortfall.lever.daily', { from: fmt.money(l.fromMinor), to: fmt.money(l.toMinor) })
  }
}

export function ShortfallPlan({ route }: { route: Route }) {
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const [days, setDays] = useState(() => (HORIZONS as readonly number[]).includes(Number(route.query.get('dias'))) ? route.query.get('dias')! : '30')
  const [income, setIncome] = useState<IncomeScenario>('min')
  const spend = useMemo(() => estimateDailySpend(data, today), [data, today])
  const [useSpend, setUseSpend] = useState(route.query.get('gasto') !== '0')
  const dailySpendMinor = useSpend && spend.sufficient ? spend.dailyMinor : 0
  const options = useMemo(() => ({ days: Number(days), dailySpendMinor, scenario: income }), [days, dailySpendMinor, income])
  const analysis = useMemo(() => analyzeShortfall(data, today, options), [data, today, options])
  const hasVariable = data.schedules.some((s) => s.kind === 'income' && s.range)

  // Palancas elegidas y valores editados (texto) por clave.
  const [chosen, setChosen] = useState<Record<string, boolean>>({})
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const proposals = analysis.status === 'shortfall' ? analysis.levers : []
  /** Palanca con el valor editado por la persona (si es válido). */
  const edited = (l: ShortfallLever): ShortfallLever | null => {
    const text = edits[leverKey(l)]
    if (text === undefined) return l
    if (l.kind === 'postponePlanned' || l.kind === 'incomeDate') return isValidLocalDate(text) && text >= today ? { ...l, toDate: text } : null
    const p = parseMoneyText(text, fmt, { allowZero: true })
    if (!p.ok) return null
    if (l.kind === 'reducePlanned') return p.minor < l.fromMinor ? { ...l, toMinor: p.minor } : null
    if (l.kind === 'dailySpend') return p.minor <= l.fromMinor ? { ...l, toMinor: p.minor } : null
    return { ...l, toMinor: p.minor }
  }
  const selected = proposals.filter((p) => chosen[leverKey(p.lever)]).map((p) => ({ ...p, lever: edited(p.lever) }))
  const invalidEdit = selected.some((s) => s.lever === null)
  const selectedLevers = selected.flatMap((s) => (s.lever ? [s.lever] : []))
  const combined = selectedLevers.length && !invalidEdit ? evaluateLevers(data, today, selectedLevers, options) : null
  const toApply = selected.filter((s) => s.applicable && s.lever).map((s) => ({ lever: s.lever!, basis: leverBasis(data, s.lever!) }))
  const simulationOnly = selected.filter((s) => !s.applicable)

  const apply = async () => {
    setConfirmOpen(false)
    const { result, saved } = await run((d, c) => applyShortfallPlan(d, toApply, c), { source: 'plan' })
    if (!result.ok) return setError(result.issues.map((i) => (i.code === 'revertConflict' ? t('shortfall.conflict') : issueMessage(t, fmt, i))).join(' '))
    setError(null)
    setChosen({})
    setEdits({})
    const entry = [...(getStore().data?.history ?? [])].reverse().find((e) => e.source === 'plan')
    toast({
      message: saved ? tn('shortfall.applied', result.value) : t('save.error.generic'),
      tone: saved ? 'good' : 'critical',
      ...(saved && entry
        ? {
            action: {
              label: t('common.undo'),
              onClick: () =>
                void run((d, c) => revertEntry(d, entry.id, c), { source: 'revert', revertOf: entry.id }).then(({ result: r }) => {
                  if (!r.ok) toast({ message: issueMessage(t, fmt, r.issues[0]!), tone: 'critical' })
                }),
            },
          }
        : {}),
    })
  }

  const roleBadge = (role: 'obligation' | 'planned' | 'transfer') =>
    role === 'obligation' ? <Badge icon="lock">{t('shortfall.role.obligation')}</Badge> : role === 'planned' ? <Badge icon="calendar">{t('shortfall.role.planned')}</Badge> : <Badge icon="transfer">{t('shortfall.role.transfer')}</Badge>

  return (
    <div className="stack">
      <PageHeader title={t('shortfall.title')} back={{ href: href('/alcanza/escenarios'), label: t('scenario.title') }} />
      <Alert tone="info" icon="lock" title={t('shortfall.safeTitle')}>
        {t('shortfall.safeText')}
      </Alert>

      <Card labelledBy="sf-assumptions">
        <h2 id="sf-assumptions" className="card__title">
          {t('scenario.assumptions')}
        </h2>
        <SelectField label={t('scenario.horizon')} value={days} onChange={(e) => setDays(e.target.value)} options={HORIZONS.map((d) => ({ value: String(d), label: t('horizon.option', { days: d }) }))} />
        {hasVariable && (
          <Segmented
            legend={t('projection.scenario')}
            name="sf-income"
            value={income}
            onChange={setIncome}
            options={(['min', 'expected', 'extra'] as const).map((x) => ({ value: x, label: t(`projection.scenario.${x}`) }))}
            hint={t('scenario.incomeHint')}
          />
        )}
        <CheckboxField
          checked={useSpend && spend.sufficient}
          onChange={setUseSpend}
          label={spend.sufficient ? t('afford.useSpendEstimate', { amount: fmt.money(spend.dailyMinor) }) : t('afford.spendEstimateUnavailable')}
        />
      </Card>

      {analysis.status === 'none' && (
        <Alert tone="good" icon="check" title={t('shortfall.noneTitle', { days })}>
          {t('shortfall.noneText', { lowest: fmt.money(analysis.projection.lowest.minor), date: fmt.date(analysis.projection.lowest.date) })}
        </Alert>
      )}

      {analysis.status === 'shortfall' && (
        <>
          <Card labelledBy="sf-summary" className="hero">
            <h2 id="sf-summary" className="card__title">
              {t('shortfall.summaryTitle')}
            </h2>
            <p className="changes-total" data-testid="shortfall-first">
              {t('shortfall.first', { date: fmt.date(analysis.firstNegativeDate), amount: fmt.money(analysis.firstNegativeMinor) })}
            </p>
            {analysis.worst.date !== analysis.firstNegativeDate && <p>{t('shortfall.worst', { date: fmt.date(analysis.worst.date), amount: fmt.money(analysis.worst.shortfallMinor) })}</p>}
            <div className="calc">
              <CalcRow label={t('shortfall.start')} value={fmt.money(analysis.projection.startMinor)} />
              <CalcRow op="−" label={t('shortfall.outflows', { date: fmt.date(analysis.firstNegativeDate) })} value={fmt.money(analysis.contributors.reduce((s, c) => s + c.amountMinor, 0))} />
              {analysis.dailySpendTotalMinor > 0 && <CalcRow op="−" label={t('shortfall.dailyTotal')} value={fmt.money(analysis.dailySpendTotalMinor)} />}
              {(() => {
                const inflow = analysis.incomes.filter((i) => i.date <= analysis.firstNegativeDate).reduce((s, i) => s + i.budgetEffectMinor, 0)
                return inflow > 0 ? <CalcRow op="+" label={t('shortfall.incomesUntil')} value={fmt.money(inflow)} /> : null
              })()}
              <CalcRow op="=" label={t('shortfall.endOfDay', { date: fmt.date(analysis.firstNegativeDate) })} value={fmt.money(-analysis.firstNegativeMinor)} strong />
            </div>
          </Card>

          <Card labelledBy="sf-contributors">
            <h2 id="sf-contributors" className="card__title">
              {t('shortfall.contributorsTitle')}
            </h2>
            <ul className="item-list">
              {analysis.contributors.map((c) => (
                <li key={c.item.key} className="item item--stacked">
                  <p className="item__title">
                    {planItemName(c.item, t)} · {fmt.money(c.amountMinor)}
                  </p>
                  <p className="item__meta">
                    {fmt.date(c.item.date, { compact: true, today })} {roleBadge(c.role)} {c.isEstimate && <Badge icon="info">{t('changes.kind.estimate')}</Badge>}
                  </p>
                </li>
              ))}
            </ul>
            <p className="note">{t('shortfall.obligationNote')}</p>
          </Card>

          <Card labelledBy="sf-incomes">
            <h2 id="sf-incomes" className="card__title">
              {t('shortfall.incomesTitle')}
            </h2>
            <ul className="bullets">
              {analysis.incomes.map((i) => (
                <li key={i.key}>
                  <Badge icon="calendar">{t('changes.kind.assumption')}</Badge> {t('shortfall.incomeLine', { name: planItemName(i, t), date: fmt.date(i.date), amount: fmt.money(i.budgetEffectMinor) })}
                  {i.range ? ` · ${t('shortfall.incomeScenario')}` : ''}
                </li>
              ))}
              {analysis.projection.lateIncomesExcluded.map((i) => (
                <li key={i.key}>{t('shortfall.lateIncome', { name: planItemName(i, t), date: fmt.date(i.date) })}</li>
              ))}
              {analysis.incomes.length === 0 && <li>{t('shortfall.noIncome')}</li>}
              <li>{t('shortfall.goalsNote')}</li>
            </ul>
          </Card>

          <Card labelledBy="sf-levers">
            <h2 id="sf-levers" className="card__title">
              {t('shortfall.leversTitle')}
            </h2>
            <p className="note">{t('shortfall.leversIntro')}</p>
            {proposals.length === 0 && <p className="note">{t('shortfall.noLevers')}</p>}
            <ul className="stack">
              {proposals.map((p) => {
                const key = leverKey(p.lever)
                const current = edited(p.lever)
                return (
                  <li key={key} className="template-line" data-testid={`lever-${p.lever.kind}`}>
                    <CheckboxField checked={!!chosen[key]} onChange={(v) => setChosen((c) => ({ ...c, [key]: v }))} label={leverText(current ?? p.lever, data, t, fmt)} />
                    <p className="item__meta">
                      {p.applicable ? <Badge icon="edit">{t('shortfall.canApply')}</Badge> : <Badge icon="info">{t('shortfall.simulationOnly')}</Badge>}
                      {p.effect.resolves ? (
                        <Badge tone="good" icon="check">
                          {t('shortfall.resolves')}
                        </Badge>
                      ) : (
                        <span>{t('shortfall.stillShort', { amount: fmt.money(p.effect.shortfallMinor) })}</span>
                      )}
                    </p>
                    {chosen[key] && (p.lever.kind === 'postponePlanned' || p.lever.kind === 'incomeDate') && (
                      <TextField label={t('shortfall.newDate')} type="date" min={today} value={edits[key] ?? p.lever.toDate} onChange={(e) => setEdits((x) => ({ ...x, [key]: e.target.value }))} error={current ? undefined : t('shortfall.invalidValue')} />
                    )}
                    {chosen[key] && (p.lever.kind === 'reducePlanned' || p.lever.kind === 'incomeAmount' || p.lever.kind === 'dailySpend') && (
                      <MoneyField label={t('shortfall.newAmount')} value={edits[key] ?? fmt.moneyInput(p.lever.toMinor)} onChange={(v) => setEdits((x) => ({ ...x, [key]: v }))} fmt={fmt} error={current ? undefined : t('shortfall.invalidValue')} />
                    )}
                  </li>
                )
              })}
            </ul>

            {combined && (
              <div className="stack-sm" aria-live="polite" data-testid="shortfall-combined">
                <p className="field__label">{t('shortfall.combinedTitle')}</p>
                {combined.resolves ? (
                  <Alert tone="good" icon="check" title={t('shortfall.combinedResolves', { lowest: fmt.money(combined.lowest.minor), date: fmt.date(combined.lowest.date) })} />
                ) : (
                  <Alert tone="warning" title={t('shortfall.combinedShort', { amount: fmt.money(combined.shortfallMinor), date: fmt.date(combined.firstNegativeDate!) })}>
                    <p>{t('shortfall.unresolved')}</p>
                    <ul className="bullets">
                      {combined.obligations.map((i) => (
                        <li key={i.key}>
                          {planItemName(i, t)} · {fmt.date(i.date, { compact: true, today })} · {fmt.money(-i.budgetEffectMinor)}
                        </li>
                      ))}
                      {combined.obligations.length === 0 && <li>{t('shortfall.unresolvedSpending')}</li>}
                    </ul>
                  </Alert>
                )}
                {simulationOnly.length > 0 && <p className="note">{t('shortfall.simulationOnlyNote')}</p>}
              </div>
            )}
            {error && <Alert tone="critical" title={error} role="alert" />}
            <div className="form__actions">
              <button type="button" className="btn btn--primary btn--large" disabled={toApply.length === 0 || invalidEdit} onClick={() => setConfirmOpen(true)}>
                <Icon name="check" />
                {tn('shortfall.apply', toApply.length)}
              </button>
            </div>
            <p className="note">{t('shortfall.applyNote')}</p>
          </Card>
        </>
      )}

      <ConfirmDialog open={confirmOpen} title={t('shortfall.confirmTitle')} confirmLabel={t('shortfall.confirm')} onCancel={() => setConfirmOpen(false)} onConfirm={() => void apply()}>
        <p>{t('shortfall.confirmText')}</p>
        <ul className="bullets">
          {toApply.map((c) => (
            <li key={leverKey(c.lever)}>{leverText(c.lever, data, t, fmt)}</li>
          ))}
        </ul>
        {simulationOnly.length > 0 && <p className="note">{tn('shortfall.notApplied', simulationOnly.length)}</p>}
      </ConfirmDialog>
    </div>
  )
}
