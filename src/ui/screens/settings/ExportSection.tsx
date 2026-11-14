/** Ajustes › Exportar datos (§7.7): CSV por alcance (con recuentos, BOM, separador por locale) e informe PDF. */
import { sourceGroupOf } from '../../../domain/txFilters'
import { useState } from 'react'
import { resolveCategories } from '../../../domain/categories'
import { categoriesToCsv, csvSeparatorFor, joinCsvSections, plansToCsv, transactionsToCsv, TX_CSV_COLUMNS, TX_CSV_ORIGINAL_COLUMNS } from '../../../domain/csvExport'
import { useT, type MessageKey } from '../../../i18n'
import { useData } from '../../../state/store'
import { downloadText } from '../../backupActions'
import { Card } from '../../components/common'
import { SelectField } from '../../components/fields'
import { Icon } from '../../components/Icon'
import { useToast } from '../../components/toastContext'
import { useFormat } from '../../format'
import { accountName, categoryLabel, planTitle } from '../../labels'
import { href } from '../../router'

type Scope = 'transactions' | 'categories' | 'plans' | 'all'

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

export function ExportSection() {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const toast = useToast()
  const [scope, setScope] = useState<Scope>('transactions')
  const separator = csvSeparatorFor(fmt.decimalSeparator)
  const categories = resolveCategories(data)
  const counts: Record<Scope, number> = { transactions: data.transactions.length, categories: categories.length, plans: data.plans.length, all: data.transactions.length + categories.length + data.plans.length }

  const build = (s: Exclude<Scope, 'all'>): string => {
    if (s === 'transactions') {
      return transactionsToCsv([...data.transactions].sort((a, b) => b.date.localeCompare(a.date)), {
        headers: [...TX_CSV_COLUMNS, ...TX_CSV_ORIGINAL_COLUMNS].map((k) => t(`csv.${k}` as MessageKey)),
        kind: (tx) => t(`txKind.${tx.kind}` as MessageKey),
        status: (tx) => t(`status.${tx.status}` as MessageKey),
        category: (tx) => (tx.splits?.length ? tx.splits.map((l) => categoryLabel(t, l.categoryId)).join(' + ') : categoryLabel(t, tx.categoryId)),
        account: (id) => accountName(data.accounts, id, t),
        source: (tx) => t(`source.${sourceGroupOf(tx)}` as MessageKey),
        rateSource: (s) => t(`csv.rateSource.${s}` as MessageKey),
        separator,
      })
    }
    if (s === 'categories') {
      return categoriesToCsv(categories, {
        headers: (['id', 'name', 'kind', 'group', 'color', 'icon', 'archived', 'custom'] as const).map((k) => t(`csv.cat.${k}` as MessageKey)),
        name: (c) => categoryLabel(t, c.id),
        kind: (c) => t(`txKind.${c.kind}` as MessageKey),
        group: (c) => t(`categoryGroup.${c.groupId}` as MessageKey),
        yes: t('common.yes'),
        no: t('common.no'),
        separator,
      })
    }
    return plansToCsv(data.plans, {
      headers: (['id', 'name', 'categories', 'limit', 'currency', 'period', 'start', 'end', 'recurring', 'status', 'spent', 'achieved'] as const).map((k) => t(`csv.plan.${k}` as MessageKey)),
      name: (p) => planTitle(t, p),
      categories: (p) => p.categoryIds.map((c) => categoryLabel(t, c)).join(' + '),
      period: (p) => t(`period.type.${p.periodType}` as MessageKey),
      status: (p) => t(`plans.status.${p.status}` as MessageKey),
      yes: t('common.yes'),
      no: t('common.no'),
      separator,
    })
  }

  const exportCsv = () => {
    try {
      const stamp = todayStamp()
      const text = scope === 'all' ? joinCsvSections([{ title: t('export.scope.transactions'), csv: build('transactions') }, { title: t('export.scope.categories'), csv: build('categories') }, { title: t('export.scope.plans'), csv: build('plans') }]) : build(scope)
      downloadText(`clara-${scope}-${stamp}.csv`, text, 'text/csv;charset=utf-8')
      toast({ message: t('export.done'), tone: 'good' })
    } catch {
      toast({ message: t('export.failed'), tone: 'critical' })
    }
  }

  return (
    <Card labelledBy="export-title">
      <h2 id="exportar" className="card__title">
        <span id="export-title">{t('export.title')}</span>
      </h2>
      <p className="note">{t('export.intro')}</p>
      <SelectField
        label={t('export.scope')}
        value={scope}
        onChange={(e) => setScope(e.target.value as Scope)}
        options={(['transactions', 'categories', 'plans', 'all'] as const).map((s) => ({ value: s, label: `${t(`export.scope.${s}`)} (${counts[s]})` }))}
        hint={t('export.csvHint', { separator })}
      />
      <div className="button-row">
        <button type="button" className="btn btn--primary" onClick={exportCsv} data-testid="export-csv">
          <Icon name="download" size={16} />
          {t('export.csv')}
        </button>
        <a className="btn btn--secondary" href={href('/estadisticas')}>
          <Icon name="chart" size={16} />
          {t('export.pdf')}
        </a>
      </div>
      <p className="note">{t('export.pdfHint')}</p>
    </Card>
  )
}
