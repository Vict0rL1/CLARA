/**
 * Comparador de escenarios: amplía «¿Me alcanza?» con escenarios guardados.
 * Todo se simula sobre una copia (`domain/scenarios.ts`): nada cambia los datos reales.
 */
import { activeAccounts, isBudgetAccount } from '../../domain/balances'
import { useMemo, useState } from 'react'
import { computeBudget } from '../../domain/budget'
import { newId } from '../../domain/ids'
import { estimateDailySpend } from '../../domain/projection'
import {
  compare,
  deleteScenario,
  isStale,
  markScenarioReviewed,
  MAX_COMPARED,
  restoreScenario,
  saveScenario,
  similarPlanned,
  type ScenarioResult,
} from '../../domain/scenarios'
import type { IncomeScenario, SavedScenario, ScenarioChange } from '../../domain/types'
import { LIMITS, MAX_SCENARIO_CHANGES, type Issue } from '../../domain/validation'
import { useT } from '../../i18n'
import { useRun, useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { Alert, Badge, Card, EmptyState, Explain, PageHeader } from '../components/common'
import { CheckboxField, MoneyField, Segmented, SelectField, TextField } from '../components/fields'
import { Icon } from '../components/Icon'
import { useToast } from '../components/toastContext'
import { useFormat, type Formatter } from '../format'
import { accountOptions, fieldError, issueMessage, otherIssues } from '../labels'
import { moneyErrorMessage, parseMoneyText } from '../moneyText'
import { href, withQuery, type Route, useNavigateIfStillHere } from '../router'

const HORIZONS = [30, 60, 90] as const
const LIST = '/alcanza/escenarios'

function useChangeText() {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  return (c: ScenarioChange) => {
    if (c.type === 'purchase' || c.type === 'income') {
      const text = t(c.type === 'income' ? 'scenario.change.income' : 'scenario.change.purchase', { amount: fmt.money(c.amountMinor), date: fmt.date(c.date, { compact: true, today }), note: c.note ? ` (${c.note})` : '' })
      const account = c.accountId ? data.accounts.find((a) => a.id === c.accountId) : undefined
      return c.accountId ? `${text} · ${account?.name ?? t('common.unknownAccount')}` : text
    }
    const s = data.schedules.find((x) => x.id === c.scheduleId)
    return s
      ? t('scenario.change.schedule', { name: s.name, from: fmt.money(s.amountMinor), to: fmt.money(c.newAmountMinor) })
      : t('scenario.change.scheduleMissing', { to: fmt.money(c.newAmountMinor) })
  }
}

export function Scenarios() {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const changeText = useChangeText()
  const [selected, setSelected] = useState<string[]>(() => data.scenarios.slice(0, MAX_COMPARED).map((s) => s.id))
  const [days, setDays] = useState<string>('30')
  const [income, setIncome] = useState<IncomeScenario>('min')
  const spend = useMemo(() => estimateDailySpend(data, today), [data, today])
  const [useSpend, setUseSpend] = useState(true)
  const dailySpendMinor = useSpend && spend.sufficient ? spend.dailyMinor : 0
  const hasVariable = data.schedules.some((s) => s.kind === 'income' && s.range)
  const chosen = data.scenarios.filter((s) => selected.includes(s.id)).slice(0, MAX_COMPARED)
  const result = useMemo(() => compare(data, today, chosen, { days: Number(days), dailySpendMinor, scenario: income }), [data, today, chosen, days, dailySpendMinor, income])
  const realAvailable = useMemo(() => computeBudget(data, today).availableMinor, [data, today])

  const toggle = (id: string, on: boolean) => setSelected((ids) => (on ? [...ids, id].slice(-MAX_COMPARED) : ids.filter((x) => x !== id)))

  const remove = async (sc: SavedScenario) => {
    const { result: r, saved } = await run((d, c) => deleteScenario(d, sc.id, c))
    if (!r.ok) return
    toast({
      message: saved ? t('scenario.deleted', { name: sc.name }) : t('save.error.generic'),
      tone: saved ? 'good' : 'critical',
      action: { label: t('common.undo'), onClick: () => void run((d, c) => restoreScenario(d, sc, c)) },
    })
  }

  const columns = [{ key: 'base', name: t('scenario.base'), kind: t('scenario.kindForecast'), r: result.base, stale: false }].concat(
    result.alternatives.map((a) => ({ key: a.scenario.id, name: a.scenario.name, kind: t('scenario.kindSimulation'), r: a.result, stale: a.stale })),
  )

  return (
    <div className="stack">
      <PageHeader title={t('scenario.title')} back={{ href: href('/alcanza'), label: t('afford.title') }}>
        {data.scenarios.length < 20 && (
          <a className="btn btn--primary" href={href(`${LIST}/nuevo`)}>
            <Icon name="plus" />
            {t('scenario.new')}
          </a>
        )}
      </PageHeader>
      <p className="lead">{t('scenario.intro')}</p>
      <Alert tone="info" icon="lock" title={t('scenario.isolatedTitle')}>
        {t('scenario.isolatedText')}
      </Alert>
      {result.base.firstNegativeDate && (
        <Alert
          tone="warning"
          title={t('shortfall.baseAlert', { date: fmt.date(result.base.firstNegativeDate), amount: fmt.money(result.base.shortfallMinor) })}
          actions={
            <a className="btn btn--secondary btn--small" href={href(withQuery('/alcanza/faltante', { dias: days, gasto: useSpend ? undefined : '0' }))}>
              {t('shortfall.open')}
            </a>
          }
        />
      )}

      {data.scenarios.length === 0 ? (
        <EmptyState icon="scale" title={t('scenario.empty')} text={t('scenario.emptyText')} action={<a className="btn btn--primary" href={href(`${LIST}/nuevo`)}>{t('scenario.new')}</a>} />
      ) : (
        <>
          <Card labelledBy="sc-assumptions">
            <h2 id="sc-assumptions" className="card__title">
              {t('scenario.assumptions')}
            </h2>
            <SelectField label={t('scenario.horizon')} value={days} onChange={(e) => setDays(e.target.value)} options={HORIZONS.map((d) => ({ value: String(d), label: t('horizon.option', { days: d }) }))} />
            {hasVariable && (
              <Segmented
                legend={t('projection.scenario')}
                name="sc-income"
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
            <p className="note">{t('scenario.sameAssumptions')}</p>
          </Card>

          <section className="stack-sm" aria-labelledby="sc-list">
            <h2 id="sc-list" className="section-title">
              {t('scenario.saved')}
            </h2>
            <p className="note">{t('scenario.selectHint', { max: MAX_COMPARED })}</p>
            <ul className="item-list">
              {data.scenarios.map((sc) => {
                const stale = isStale(sc, data)
                const on = selected.includes(sc.id)
                return (
                  <li key={sc.id} className="item item--stacked">
                    <CheckboxField checked={on} onChange={(v) => toggle(sc.id, v)} label={t('scenario.compareThis', { name: sc.name })} />
                    <ul className="bullets">
                      {sc.changes.map((c, i) => (
                        <li key={i}>
                          {changeText(c)}
                          {c.type === 'purchase' && <PlannedLink change={c} />}
                        </li>
                      ))}
                    </ul>
                    <p className="item__badges">
                      <Badge tone="info" icon="scale">
                        {t('scenario.kindSimulation')}
                      </Badge>
                      {stale && (
                        <Badge tone="warning" icon="alert">
                          {t('scenario.stale')}
                        </Badge>
                      )}
                    </p>
                    {stale && <p className="note">{t('scenario.staleText')}</p>}
                    <div className="item__actions">
                      {stale && (
                        <button type="button" className="btn btn--small btn--secondary" onClick={() => void run((d, c) => markScenarioReviewed(d, sc.id, c))}>
                          <Icon name="check" size={16} />
                          {t('scenario.markReviewed')}
                          <span className="sr-only">: {sc.name}</span>
                        </button>
                      )}
                      <a className="btn btn--small btn--ghost" href={href(`${LIST}/editar/${sc.id}`)}>
                        <Icon name="edit" size={16} />
                        {t('common.edit')}
                        <span className="sr-only">: {sc.name}</span>
                      </a>
                      <button type="button" className="btn btn--small btn--danger-ghost" onClick={() => void remove(sc)}>
                        <Icon name="trash" size={16} />
                        {t('common.delete')}
                        <span className="sr-only">: {sc.name}</span>
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>

          <Card labelledBy="sc-compare">
            <h2 id="sc-compare" className="card__title">
              {t('scenario.compareTitle')}
            </h2>
            <p>{t('scenario.realToday', { amount: fmt.money(realAvailable) })}</p>
            <div className="table-scroll" role="region" aria-labelledby="sc-compare" tabIndex={0}>
              <table className="data-table" data-testid="scenario-table">
                <caption className="sr-only">{t('scenario.caption', { days })}</caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">{t('afford.concept')}</span>
                    </th>
                    {columns.map((c) => (
                      <th scope="col" key={c.key}>
                        {c.name}
                        <span className="compare__sub">
                          {c.kind}
                          {c.stale ? ` · ${t('scenario.stale')}` : ''}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <Row label={t('scenario.row.end', { days })} columns={columns} value={(r) => fmt.money(r.endMinor)} />
                  <Row label={t('scenario.row.lowest')} columns={columns} value={(r) => `${fmt.money(r.lowest.minor)} · ${fmt.date(r.lowest.date, { compact: true, today })}`} />
                  <Row label={t('scenario.row.shortfall')} columns={columns} value={(r) => (r.firstNegativeDate ? t('scenario.shortfallValue', { amount: fmt.money(r.shortfallMinor), date: fmt.date(r.firstNegativeDate, { compact: true, today }) }) : t('projection.noShortfallShort'))} />
                  <Row label={t('scenario.row.available')} columns={columns} value={(r) => fmt.money(r.availableMinor)} />
                  <Row label={t('scenario.row.availableDiff')} columns={columns} value={(r) => fmt.money(r.availableMinor - result.base.availableMinor, { sign: true })} />
                  <Row
                    label={t('scenario.row.goals', { amount: fmt.money(result.base.goalsReservedMinor) })}
                    columns={columns}
                    value={(r) => (r.belowGoalsDate ? t('scenario.goalsBelow', { date: fmt.date(r.belowGoalsDate, { compact: true, today }) }) : t('scenario.goalsSafe'))}
                  />
                </tbody>
              </table>
            </div>
            {result.alternatives.some((a) => a.result.invalidChanges.length > 0) && (
              <Alert tone="warning" title={t('scenario.invalidTitle')}>
                {t('scenario.invalidText')}
              </Alert>
            )}
            <Explain summary={t('scenario.limitsTitle')}>
              <ul className="bullets">
                <li>{t('scenario.limit.simulation')}</li>
                <li>{t('scenario.limit.purchase')}</li>
                <li>{t('scenario.limit.schedule')}</li>
                <li>{t('scenario.limit.hypotheticalIncome')}</li>
                <li>{t('scenario.limit.income')}</li>
                <li>{t('scenario.limit.spend')}</li>
                <li>{t('scenario.limit.noGuarantee')}</li>
              </ul>
            </Explain>
          </Card>
        </>
      )}
    </div>
  )
}

function Row({ label, columns, value }: { label: string; columns: { key: string; r: ScenarioResult }[]; value: (r: ScenarioResult) => string }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      {columns.map((c) => (
        <td key={c.key}>{value(c.r)}</td>
      ))}
    </tr>
  )
}

/** Crear un gasto previsto a partir de una compra simulada: solo con una acción explícita y avisando de posibles duplicados. */
function PlannedLink({ change }: { change: Extract<ScenarioChange, { type: 'purchase' }> }) {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const similar = similarPlanned(data, change)
  if (change.date < today) return null
  const to = withQuery('/movimientos/nuevo', { kind: 'expense', status: 'planned', amount: change.amountMinor, date: change.date, note: change.note, account: change.accountId, returnTo: LIST })
  return (
    <>
      {' · '}
      {similar ? (
        <span>
          {t('scenario.similarExists', { date: fmt.date(similar.date, { compact: true, today }) })} <a href={href(`/movimientos/editar/${similar.id}`)}>{t('scenario.seeIt')}</a> ·{' '}
          <a href={href(to)}>{t('scenario.createAnyway')}</a>
        </span>
      ) : (
        <a href={href(to)}>{t('scenario.createPlanned')}</a>
      )}
    </>
  )
}

interface ChangeDraft {
  key: string
  type: ScenarioChange['type']
  amountText: string
  date: string
  note: string
  scheduleId: string
  /** '' = cuenta por defecto (la primera del presupuesto). */
  accountId: string
}

function toDraft(c: ScenarioChange, fmt: Formatter): ChangeDraft {
  return c.type === 'purchase' || c.type === 'income'
    ? { key: newId(), type: c.type, amountText: fmt.moneyInput(c.amountMinor), date: c.date, note: c.note ?? '', scheduleId: '', accountId: c.accountId ?? '' }
    : { key: newId(), type: 'scheduleAmount', amountText: fmt.moneyInput(c.newAmountMinor), date: '', note: '', scheduleId: c.scheduleId, accountId: '' }
}

export function ScenarioForm({ route }: { route: Route }) {
  const leave = useNavigateIfStillHere()
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const editId = route.segments[2] === 'editar' ? route.segments[3] : undefined
  const existing = editId ? data.scenarios.find((s) => s.id === editId) : undefined
  const expenseSchedules = data.schedules.filter((s) => s.kind === 'expense')
  const defaultAccountName = (activeAccounts(data.accounts).find(isBudgetAccount) ?? activeAccounts(data.accounts)[0] ?? data.accounts[0])?.name ?? ''
  const [id] = useState(() => existing?.id ?? newId())
  const [name, setName] = useState(existing?.name ?? '')
  const [changes, setChanges] = useState<ChangeDraft[]>(() =>
    existing ? existing.changes.map((c) => toDraft(c, fmt)) : [{ key: newId(), type: 'purchase', amountText: route.query.get('amount') && /^\d+$/.test(route.query.get('amount')!) ? fmt.moneyInput(Number(route.query.get('amount'))) : '', date: today, note: route.query.get('note') ?? '', scheduleId: '', accountId: '' }],
  )
  const [issues, setIssues] = useState<Issue[]>([])
  const [amountErrors, setAmountErrors] = useState<Record<string, string | null>>({})
  const [busy, setBusy] = useState(false)

  if (editId && !existing) return <PageHeader title={t('scenario.notFound')} back={{ href: href(LIST), label: t('scenario.title') }} />

  const update = (key: string, patch: Partial<ChangeDraft>) => setChanges((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)))
  const add = (type: ChangeDraft['type']) =>
    setChanges((cs) => [...cs, { key: newId(), type, amountText: '', date: today, note: '', scheduleId: type === 'scheduleAmount' ? (expenseSchedules[0]?.id ?? '') : '', accountId: '' }])

  const submit = async () => {
    const errors: Record<string, string | null> = {}
    const built: ScenarioChange[] = []
    for (const c of changes) {
      const parsed = parseMoneyText(c.amountText, fmt)
      errors[c.key] = moneyErrorMessage(t, parsed)
      if (!parsed.ok) continue
      built.push(c.type !== 'scheduleAmount' ? { type: c.type, amountMinor: parsed.minor, date: c.date, ...(c.note.trim() ? { note: c.note.trim() } : {}), ...(c.accountId ? { accountId: c.accountId } : {}) } : { type: 'scheduleAmount', scheduleId: c.scheduleId, newAmountMinor: parsed.minor })
    }
    setAmountErrors(errors)
    if (built.length !== changes.length || busy) return
    setBusy(true)
    const { result, saved } = await run((d, c) => saveScenario(d, { id, name, changes: built }, c))
    setBusy(false)
    if (!result.ok) {
      setIssues(result.issues)
      return
    }
    toast({ message: saved ? t('scenario.savedToast') : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
    leave(LIST)
  }

  const unknown = otherIssues(
    issues,
    ['name', ...changes.flatMap((_, i) => [`changes[${i}].date`, `changes[${i}].accountId`, `changes[${i}].scheduleId`, `changes[${i}].amountMinor`, `changes[${i}].newAmountMinor`])],
  )
  return (
    <div className="stack">
      <PageHeader title={existing ? t('scenario.editTitle') : t('scenario.newTitle')} back={{ href: href(LIST), label: t('scenario.title') }} />
      <Alert tone="info" icon="lock" title={t('scenario.isolatedTitle')}>
        {t('scenario.isolatedText')}
      </Alert>
      <form
        className="form card"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <TextField label={t('fields.name')} value={name} maxLength={LIMITS.nameMax} onChange={(e) => setName(e.target.value)} placeholder={t('scenario.namePlaceholder')} error={fieldError(t, fmt, issues, 'name')} required />
        {changes.map((c, i) => (
          <fieldset key={c.key} className="stack-sm card">
            <legend className="field__label">{t('scenario.changeN', { n: i + 1 })}</legend>
            <Segmented
              legend={t('scenario.changeType')}
              name={`type-${c.key}`}
              value={c.type}
              onChange={(v) => update(c.key, { type: v, scheduleId: v === 'scheduleAmount' ? c.scheduleId || (expenseSchedules[0]?.id ?? '') : '' })}
              options={[
                { value: 'purchase', label: t('scenario.type.purchase') },
                { value: 'scheduleAmount', label: t('scenario.type.schedule') },
                { value: 'income', label: t('scenario.type.income') },
              ]}
            />
            {c.type !== 'scheduleAmount' ? (
              <>
                {c.type === 'income' && (
                  <Alert tone="info" icon="info" title={t('scenario.incomeWarningTitle')}>
                    {t('scenario.incomeWarningText')}
                  </Alert>
                )}
                <MoneyField label={t(c.type === 'income' ? 'scenario.incomeAmount' : 'scenario.purchaseAmount')} value={c.amountText} onChange={(v) => update(c.key, { amountText: v })} fmt={fmt} error={amountErrors[c.key] ?? fieldError(t, fmt, issues, `changes[${i}].amountMinor`)} />
                <TextField label={t(c.type === 'income' ? 'scenario.incomeDate' : 'scenario.purchaseDate')} type="date" min={today} value={c.date} onChange={(e) => update(c.key, { date: e.target.value })} hint={t('scenario.purchaseDateHint')} error={fieldError(t, fmt, issues, `changes[${i}].date`)} required />
                {data.accounts.length > 1 && (
                  <SelectField
                    label={t('fields.account')}
                    value={c.accountId}
                    onChange={(e) => update(c.key, { accountId: e.target.value })}
                    options={[{ value: '', label: t('scenario.defaultAccount', { name: defaultAccountName }) }, ...accountOptions(data.accounts, t)]}
                    hint={t('scenario.accountHint')}
                    error={fieldError(t, fmt, issues, `changes[${i}].accountId`)}
                  />
                )}
                <TextField label={t('fields.noteOptional')} value={c.note} maxLength={LIMITS.noteMax} onChange={(e) => update(c.key, { note: e.target.value })} />
              </>
            ) : expenseSchedules.length === 0 ? (
              <p className="note">{t('scenario.noSchedules')}</p>
            ) : (
              <>
                <SelectField
                  label={t('scenario.schedule')}
                  value={c.scheduleId}
                  onChange={(e) => update(c.key, { scheduleId: e.target.value })}
                  options={expenseSchedules.map((s) => ({ value: s.id, label: `${s.name} · ${fmt.money(s.amountMinor)}` }))}
                  error={fieldError(t, fmt, issues, `changes[${i}].scheduleId`)}
                />
                <MoneyField label={t('scenario.newAmount')} value={c.amountText} onChange={(v) => update(c.key, { amountText: v })} fmt={fmt} hint={t('scenario.newAmountHint')} error={amountErrors[c.key] ?? fieldError(t, fmt, issues, `changes[${i}].newAmountMinor`)} />
              </>
            )}
            {changes.length > 1 && (
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setChanges((cs) => cs.filter((x) => x.key !== c.key))}>
                <Icon name="x" size={16} />
                {t('scenario.removeChange', { n: i + 1 })}
              </button>
            )}
          </fieldset>
        ))}
        {changes.length < MAX_SCENARIO_CHANGES && (
          <div className="button-row">
            <button type="button" className="btn btn--secondary btn--small" onClick={() => add('purchase')}>
              <Icon name="plus" size={16} />
              {t('scenario.addPurchase')}
            </button>
            {expenseSchedules.length > 0 && (
              <button type="button" className="btn btn--secondary btn--small" onClick={() => add('scheduleAmount')}>
                <Icon name="plus" size={16} />
                {t('scenario.addSchedule')}
              </button>
            )}
            <button type="button" className="btn btn--secondary btn--small" onClick={() => add('income')}>
              <Icon name="plus" size={16} />
              {t('scenario.addIncome')}
            </button>
          </div>
        )}
        {unknown.length > 0 && (
          <Alert tone="critical" title={t('common.fixErrors')} role="alert">
            <ul>
              {unknown.map((i, idx) => (
                <li key={idx}>{issueMessage(t, fmt, i)}</li>
              ))}
            </ul>
          </Alert>
        )}
        <p className="note">{t('scenario.saveNote')}</p>
        <div className="form__actions">
          <button type="submit" className="btn btn--primary btn--large" disabled={busy}>
            <Icon name="check" />
            {busy ? t('common.saving') : t('scenario.save')}
          </button>
          <a className="btn btn--secondary btn--large" href={href(LIST)}>
            {t('common.cancel')}
          </a>
        </div>
      </form>
    </div>
  )
}
