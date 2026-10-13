/**
 * «¿Qué cambió?»: compara el disponible de hoy con el de una fecha anterior y lo desglosa por
 * cambio registrado y por el paso del tiempo. Cálculo en `domain/whatChanged.ts`: el desglose
 * suma exactamente la diferencia; lo que no se puede explicar se muestra como tal.
 */
import { useEffect, useMemo, useState } from 'react'
import { addDays, isValidLocalDate, localDateInTimeZone } from '../../domain/dates'
import type { PlanItem } from '../../domain/planItems'
import { whatChangedSteps, type ChangeStep, type ComparePoint, type WhatChangedResult } from '../../domain/whatChanged'
import { useT, type MessageKey } from '../../i18n'
import { useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { Alert, Badge, CalcRow, Card, PageHeader } from '../components/common'
import { InsightsTabs } from '../components/InsightsTabs'
import { SelectField, TextField } from '../components/fields'
import { Icon } from '../components/Icon'
import { useFormat } from '../format'
import { planItemName } from '../labels'
import { href, type Route } from '../router'
import { describeChange, type Line } from '../historyText'

type Choice = 'today' | 'yesterday' | 'week' | 'month' | 'historyStart' | 'lastCut' | 'custom'

export function WhatChanged({ route }: { route: Route }) {
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const requested = route.query.get('desde')
  const [choice, setChoice] = useState<Choice>(requested && isValidLocalDate(requested) ? 'custom' : 'yesterday')
  const [custom, setCustom] = useState(requested && isValidLocalDate(requested) ? requested : addDays(today, -1))
  const lastCut = useMemo(() => data.history.map((e) => e.source).lastIndexOf('replace'), [data.history])

  const point: ComparePoint = useMemo(() => {
    switch (choice) {
      case 'today':
        return { kind: 'date', date: today }
      case 'yesterday':
        return { kind: 'date', date: addDays(today, -1) }
      case 'week':
        return { kind: 'date', date: addDays(today, -7) }
      case 'month':
        return { kind: 'date', date: addDays(today, -30) }
      case 'historyStart':
        return { kind: 'index', index: 0 }
      case 'lastCut':
        return { kind: 'index', index: lastCut + 1 }
      case 'custom':
        return { kind: 'date', date: isValidLocalDate(custom) && custom <= today ? custom : today }
    }
  }, [choice, custom, today, lastCut])
  // Con mucho historial el cálculo tarda (≈ 1–2 s con 50.000 movimientos y 1.000 entradas).
  // Se reparte en trozos de ~12 ms entre fotogramas: la pantalla responde y muestra el avance.
  const [computed, setComputed] = useState<{ data: unknown; today: string; point: ComparePoint; value: WhatChangedResult } | null>(null)
  const [progress, setProgress] = useState<{ data: unknown; today: string; point: ComparePoint; done: number; total: number } | null>(null)
  useEffect(() => {
    const run = whatChangedSteps(data, today, point)
    let timer = 0
    let shownAt = 0
    const slice = () => {
      const until = performance.now() + 12
      for (;;) {
        const step = run.next()
        if (step.done) {
          setComputed({ data, today, point, value: step.value })
          return
        }
        const now = performance.now()
        if (now >= until) {
          // El avance se repinta como mucho cada 150 ms (no en cada trozo).
          if (now - shownAt >= 150) {
            shownAt = now
            setProgress({ data, today, point, ...step.value })
          }
          timer = window.setTimeout(slice, 0)
          return
        }
      }
    }
    timer = window.setTimeout(slice, 0)
    return () => window.clearTimeout(timer)
  }, [data, today, point])
  const shownProgress = progress && progress.data === data && progress.today === today && progress.point === point ? progress : null
  // Solo vale el resultado calculado con los datos y el punto actuales.
  const r = computed && computed.data === data && computed.today === today && computed.point === point ? computed.value : null

  const options: { value: Choice; label: string }[] = [
    { value: 'today', label: t('changes.point.today') },
    { value: 'yesterday', label: t('changes.point.yesterday') },
    { value: 'week', label: t('changes.point.week') },
    { value: 'month', label: t('changes.point.month') },
    { value: 'historyStart', label: t('changes.point.historyStart', { date: fmt.timestamp(data.historyStartedAt) }) },
    ...(lastCut >= 0 ? [{ value: 'lastCut' as const, label: t('changes.point.lastCut', { date: fmt.timestamp(data.history[lastCut]!.at) }) }] : []),
    { value: 'custom', label: t('changes.point.custom') },
  ]

  const stepLines = (step: ChangeStep): Line[] =>
    step.entries.flatMap((e) => e.changes.map((c) => describeChange(c, e, data, t, fmt)).filter((l): l is Line => l !== null))
  const itemLine = (i: PlanItem, amountMinor: number) => `${planItemName(i, t)} · ${fmt.date(i.date, { compact: true, today })} · ${fmt.money(amountMinor)}`

  return (
    <div className="stack">
      <PageHeader title={t('changes.title')} back={{ href: href('/'), label: t('nav.home') }} />
      <InsightsTabs active="cambios" />
      <Card labelledBy="changes-point">
        <h2 id="changes-point" className="card__title">
          {t('changes.compareTitle')}
        </h2>
        <SelectField label={t('changes.compareWith')} value={choice} options={options} onChange={(e) => setChoice(e.target.value as Choice)} hint={t('changes.compareHint')} />
        {choice === 'custom' && <TextField label={t('fields.date')} type="date" max={today} value={custom} onChange={(e) => setCustom(e.target.value)} />}
      </Card>

      {!r && (
        <p className="note" role="status" data-testid="changes-loading">
          {t('changes.loading')}
          {/* El número de paso no se anuncia: cambiaría varias veces por segundo. */}
          {shownProgress && <span aria-hidden="true"> {t('changes.loadingStep', { done: shownProgress.done, total: shownProgress.total })}</span>}
        </p>
      )}
      {r?.status === 'beforeHistory' && (
        <Alert
          tone="info"
          title={t('changes.beforeHistoryTitle')}
          actions={
            <button type="button" className="btn btn--secondary btn--small" onClick={() => setChoice('historyStart')}>
              {t('changes.useHistoryStart')}
            </button>
          }
        >
          {t('changes.beforeHistoryText', { date: fmt.timestamp(r.historyStartedAt), earliest: fmt.date(r.earliestDate) })}
        </Alert>
      )}
      {r?.status === 'cut' && (
        <Alert
          tone="info"
          title={t('changes.cutTitle')}
          actions={
            <button type="button" className="btn btn--secondary btn--small" onClick={() => setChoice('lastCut')}>
              {t('changes.useLastCut')}
            </button>
          }
        >
          {t('changes.cutText', { date: fmt.timestamp(r.cutAt) })}
        </Alert>
      )}
      {r?.status === 'future' && <Alert tone="info" title={t('changes.future')} />}

      {r?.status === 'ok' && (
        <>
          <Card labelledBy="changes-summary" className="hero">
            <h2 id="changes-summary" className="card__title">
              {t('changes.summaryTitle')}
            </h2>
            <p className="changes-total" data-testid="changes-total">
              {r.totalMinor === 0 ? t('changes.same') : t(r.totalMinor > 0 ? 'changes.up' : 'changes.down', { amount: fmt.money(Math.abs(r.totalMinor)) })}
            </p>
            <div className="calc" data-testid="changes-calc">
              <CalcRow label={r.fromAt ? t('changes.availableAt', { date: fmt.timestamp(r.fromAt) }) : t('changes.availableOn', { date: fmt.date(r.fromDate) })} value={fmt.money(r.from.availableMinor)} />
              {r.byCategory
                .filter((c) => c.deltaMinor !== 0)
                .map((c) => (
                  <CalcRow key={c.category} op={c.deltaMinor < 0 ? '−' : '+'} label={`${t(`changes.cat.${c.category}` as MessageKey)} (${c.entries})`} value={fmt.money(Math.abs(c.deltaMinor))} />
                ))}
              {r.time.deltaMinor !== 0 && <CalcRow op={r.time.deltaMinor < 0 ? '−' : '+'} label={t('changes.time')} value={fmt.money(Math.abs(r.time.deltaMinor))} />}
              {r.unexplainedMinor !== 0 && <CalcRow op={r.unexplainedMinor < 0 ? '−' : '+'} label={t('changes.unexplained')} value={fmt.money(Math.abs(r.unexplainedMinor))} />}
              <CalcRow op="=" label={t('changes.availableToday')} value={fmt.money(r.to.availableMinor)} strong />
            </div>
            {r.unexplainedMinor === 0 ? (
              <p className="note note--icon">
                <Icon name="check" size={16} /> {t('changes.reconciled')}
              </p>
            ) : (
              <Alert tone="warning" title={t('changes.unexplainedTitle', { amount: fmt.money(r.unexplainedMinor, { sign: true }) })}>
                {t('changes.unexplainedText')}
              </Alert>
            )}
            {r.neutralEntries > 0 && <p className="note">{tn('changes.neutral', r.neutralEntries)}</p>}
          </Card>

          {r.daily && (
            <Card labelledBy="changes-daily">
              <h2 id="changes-daily" className="card__title">
                {t('changes.dailyTitle')}
              </h2>
              <div className="calc">
                <CalcRow label={t('changes.dailyFrom', { days: r.from.horizon?.days ?? 0 })} value={fmt.money(r.daily.fromMinor)} />
                <CalcRow op={r.daily.changesMinor < 0 ? '−' : '+'} label={t('changes.dailyChanges')} value={fmt.money(Math.abs(r.daily.changesMinor))} />
                <CalcRow op={r.daily.timeMinor < 0 ? '−' : '+'} label={t('changes.dailyTime')} value={fmt.money(Math.abs(r.daily.timeMinor))} />
                {r.daily.unexplainedMinor !== 0 && <CalcRow op={r.daily.unexplainedMinor < 0 ? '−' : '+'} label={t('changes.unexplained')} value={fmt.money(Math.abs(r.daily.unexplainedMinor))} />}
                <CalcRow op="=" label={t('changes.dailyTo', { days: r.to.horizon?.days ?? 0 })} value={fmt.money(r.daily.toMinor)} strong />
              </div>
              <p className="note">{t('changes.dailyNote')}</p>
            </Card>
          )}

          {(r.time.deltaMinor !== 0 || r.from.horizon?.endDate !== r.to.horizon?.endDate) && (
            <Card labelledBy="changes-time">
              <h2 id="changes-time" className="card__title">
                {t('changes.timeTitle')}
              </h2>
              <ul className="bullets">
                {r.from.horizon && r.to.horizon && r.from.horizon.endDate !== r.to.horizon.endDate && (
                  <li>{t('changes.horizonMoved', { from: fmt.date(r.from.horizon.endDate), to: fmt.date(r.to.horizon.endDate) })}</li>
                )}
                {r.time.entered.map((i) => (
                  <li key={`in-${i.key}`}>
                    {t('changes.entered')} <a href={href('/plan/calendario')}>{itemLine(i, -i.budgetEffectMinor - (r.to.coveredByGoals.get(i.key) ?? 0))}</a>
                  </li>
                ))}
                {r.time.left.map((i) => (
                  <li key={`out-${i.key}`}>
                    {t('changes.left')} {itemLine(i, -i.budgetEffectMinor - (r.from.coveredByGoals.get(i.key) ?? 0))}
                  </li>
                ))}
                {r.time.otherMinor !== 0 && <li>{t('changes.timeOther', { amount: fmt.money(r.time.otherMinor, { sign: true }) })}</li>}
              </ul>
            </Card>
          )}

          <Card labelledBy="changes-steps">
            <h2 id="changes-steps" className="card__title">
              {t('changes.stepsTitle')}
            </h2>
            {r.steps.length === 0 ? (
              <p className="note">{t('changes.noSteps')}</p>
            ) : (
              <ol className="changes-steps">
                {r.steps.map((step) => {
                  const lines = stepLines(step)
                  return (
                    <li key={step.entries[0]!.id} className="changes-step">
                      <p className="item__meta">
                        <Badge icon={step.deltaMinor < 0 ? 'arrowDown' : step.deltaMinor > 0 ? 'arrowUp' : 'check'} tone={step.deltaMinor < 0 ? 'warning' : step.deltaMinor > 0 ? 'good' : 'neutral'}>
                          {step.deltaMinor === 0 ? t('changes.noEffect') : fmt.money(step.deltaMinor, { sign: true })}
                        </Badge>
                        {t(`changes.cat.${step.category}` as MessageKey)} · {fmt.timestamp(step.entries[0]!.at)}
                        {step.entries.length > 1 && ` · ${tn('changes.grouped', step.entries.length)}`}
                      </p>
                      <ul className="bullets">
                        {lines.slice(0, 5).map((l, i) => (
                          <li key={i}>{l.link ? <a href={href(l.link)}>{l.text}</a> : l.text}</li>
                        ))}
                        {lines.length > 5 && <li>{tn('changes.moreLines', lines.length - 5)}</li>}
                      </ul>
                    </li>
                  )
                })}
              </ol>
            )}
            <p className="note">
              <a href={href('/ajustes/historial')}>{t('history.open')}</a>
            </p>
          </Card>

          <Card labelledBy="changes-basis">
            <h2 id="changes-basis" className="card__title">
              {t('changes.basisTitle')}
            </h2>
            <ul className="bullets">
              <li>
                <Badge icon="check">{t('changes.kind.registered')}</Badge> {t('changes.basis.registered')}
              </li>
              <li>
                <Badge icon="info">{t('changes.kind.estimate')}</Badge> {t('changes.basis.estimate')}
              </li>
              <li>
                <Badge icon="calendar">{t('changes.kind.assumption')}</Badge> {t('changes.basis.assumption')}
              </li>
              <li>{t('changes.basis.rules', { date: fmt.date(localDateInTimeZone(new Date(data.historyStartedAt), data.settings.timeZone)) })}</li>
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}
