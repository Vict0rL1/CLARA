/**
 * Análisis (etapa 4): señales calculadas con reglas fijas (`domain/analysis.ts`), cada una con su
 * «¿Cómo se calculó?» (regla + cifras). La pantalla solo muestra: no guarda, no notifica, no decide.
 */
import { useMemo } from 'react'
import { analysisItems, type AnalysisItem, type Because } from '../../domain/analysis'
import { useT, type MessageKey } from '../../i18n'
import { useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { Badge, CalcRow, Card, EmptyState, Explain, PageHeader, type Tone } from '../components/common'
import { Icon, type IconName } from '../components/Icon'
import { InsightsTabs } from '../components/InsightsTabs'
import { useFormat, type Formatter } from '../format'
import { categoryLabel } from '../labels'
import { href } from '../router'

const TONE: Record<AnalysisItem['severity'], Tone> = { critical: 'critical', warning: 'warning', info: 'info' }
const ICON: Record<AnalysisItem['severity'], IconName> = { critical: 'alert', warning: 'alert', info: 'info' }
const SIGNED = new Set<Because['id']>(['delta', 'difference', 'remaining'])

function becauseValue(b: Because, fmt: Formatter, today: string): string {
  if (b.kind === 'money') return fmt.money(b.value as number, { sign: SIGNED.has(b.id) })
  if (b.kind === 'count') return String(b.value)
  if (b.kind === 'percent') return `${b.value} %`
  if (b.kind === 'date') return fmt.date(String(b.value), { compact: true, today })
  if (b.id === 'lastExport' && b.value) return fmt.timestamp(String(b.value))
  return b.value ? String(b.value) : '—'
}

export function Insights() {
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const items = useMemo(() => analysisItems(data, today), [data, today])

  const title = (i: AnalysisItem): string => {
    const p = i.params
    const money = (k: string) => fmt.money(Number(p[k] ?? 0))
    const date = (k: string) => fmt.date(String(p[k] ?? today), { compact: true, today })
    switch (i.id) {
      case 'overdueBills':
        return tn('insights.overdueBills.title', Number(p.count), { total: money('total') })
      case 'shortfall':
        return t('insights.shortfall.title', { date: date('date'), amount: money('amount') })
      case 'belowReserves':
        return t('insights.belowReserves.title', { date: date('date'), amount: money('amount'), reserved: money('reserved') })
      case 'limitOver':
        return t('insights.limitOver.title', { name: String(p.name), remaining: money('remaining') })
      case 'limitNear':
        return t('insights.limitNear.title', { name: String(p.name), percent: Number(p.percent) })
      case 'goalBehind':
        return t('insights.goalBehind.title', { name: String(p.name), behind: money('behind'), date: date('date') })
      case 'spendingUp':
      case 'spendingDown':
        return t(`insights.${i.id}.title`, { percent: Number(p.percent) })
      case 'topCategory':
        return t('insights.topCategory.title', { category: categoryLabel(t, String(p.categoryId)), percent: Number(p.percent), amount: money('amount'), total: money('total') })
      case 'backupDue':
        return t('insights.backupDue.title')
    }
  }
  const rule = (i: AnalysisItem): string => {
    const key = i.id === 'limitOver' || i.id === 'limitNear' ? 'insights.limit.rule' : i.id === 'spendingUp' || i.id === 'spendingDown' ? 'insights.spending.rule' : (`insights.${i.id}.rule` as MessageKey)
    return t(key, { date: i.params.date ? fmt.date(String(i.params.date), { compact: true, today }) : '' })
  }

  return (
    <div className="stack">
      <PageHeader title={t('insights.title')} />
      <InsightsTabs active="avisos" />
      <p className="note">{t('insights.intro')}</p>
      {items.length === 0 ? (
        <EmptyState icon="checkCircle" title={t('insights.empty')} text={t('insights.emptyText')} />
      ) : (
        <ul className="insight-list" data-testid="insight-list">
          {items.map((i) => (
            <li key={i.key}>
              <Card as="article" className="insight" labelledBy={`insight-${i.key}`}>
                <p className="item__badges">
                  <Badge tone={TONE[i.severity]} icon={ICON[i.severity]}>
                    {t(`insights.severity.${i.severity}`)}
                  </Badge>
                </p>
                <h2 id={`insight-${i.key}`} className="card__title" data-testid="insight-title" data-id={i.id}>
                  {title(i)}
                </h2>
                <Explain summary={t('common.howCalculated')}>
                  <p>
                    <strong>{t('insights.rule')}:</strong> {rule(i)}
                  </p>
                  <div className="composition">
                    {i.because.map((b, idx) => (
                      <CalcRow key={`${b.id}-${idx}`} op={b.op} label={t(`insights.because.${b.id}`)} value={becauseValue(b, fmt, today)} strong={b.op === '='} />
                    ))}
                  </div>
                </Explain>
                <div className="button-row">
                  <a className="btn btn--secondary btn--small" href={href(i.href)}>
                    {t('insights.open')}
                    <Icon name="chevronRight" size={16} />
                  </a>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
