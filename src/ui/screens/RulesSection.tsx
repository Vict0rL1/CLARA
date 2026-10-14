/** Ajustes › Reglas de categoría: «si la descripción contiene…, usar esta categoría». */
import { useMemo, useState } from 'react'
import { categoriesForKind } from '../../domain/categories'
import { newId } from '../../domain/ids'
import { deleteCategoryRule, restoreCategoryRule, saveCategoryRule } from '../../domain/operations'
import { previewRule, RULE_PATTERN_MAX, ruleConflicts } from '../../domain/rules'
import type { CategoryRule } from '../../domain/types'
import type { Issue } from '../../domain/validation'
import { useT } from '../../i18n'
import { useRun } from '../../state/hooks'
import { useData } from '../../state/store'
import { Alert, Card, EmptyState } from '../components/common'
import { Dialog } from '../components/Dialog'
import { Segmented, TextField } from '../components/fields'
import { Icon } from '../components/Icon'
import { useToast } from '../components/toastContext'
import { useFormat } from '../format'
import { categoryLabel, fieldError, withCurrent } from '../labels'
import { CategoryPicker } from '../components/CategoryPicker'

export function RulesSection() {
  const { t, tn } = useT()
  const data = useData()
  const run = useRun()
  const toast = useToast()
  const [editing, setEditing] = useState<CategoryRule | 'new' | null>(null)

  const rules = [...data.categoryRules].sort((a, b) => a.pattern.localeCompare(b.pattern))
  const conflicts = ruleConflicts(data.categoryRules)

  const remove = async (rule: CategoryRule) => {
    const { saved } = await run((d, c) => deleteCategoryRule(d, rule.id, c))
    toast({
      message: saved ? t('rules.deleted') : t('save.error.generic'),
      tone: saved ? 'good' : 'critical',
      action: saved ? { label: t('common.undo'), onClick: () => void run((d, c) => restoreCategoryRule(d, rule, c)) } : undefined,
    })
  }

  return (
    <Card labelledBy="rules-title">
      <h2 id="reglas" className="card__title">
        <span id="rules-title">{t('rules.title')}</span>
      </h2>
      <p className="note">{t('rules.text')}</p>
      {conflicts.length > 0 && (
        <Alert tone="warning" icon="alert" title={t('rules.conflictsTitle')}>
          <ul className="bullets" data-testid="rule-conflicts">
            {conflicts.map((c) => (
              <li key={`${c.winner.id}-${c.loser.id}`}>{t(c.reason === 'longer' ? 'rules.conflictLonger' : 'rules.conflictOlder', { winner: c.winner.pattern, loser: c.loser.pattern })}</li>
            ))}
          </ul>
        </Alert>
      )}
      {rules.length === 0 ? (
        <EmptyState compact icon="sparkles" title={t('rules.empty')} />
      ) : (
        <ul className="item-list">
          {rules.map((r) => (
            <li key={r.id} className="item item--stacked">
              <p className="item__title">{t('rules.summary', { pattern: r.pattern, category: categoryLabel(t, r.categoryId) })}</p>
              <p className="item__meta">
                {t(r.kind === 'income' ? 'rules.forIncome' : 'rules.forExpenses')} · {tn('rules.previewCount', previewRule(data, r.pattern, r.kind, r.categoryId).total)}
              </p>
              <div className="item__actions">
                <button type="button" className="btn btn--small btn--ghost" onClick={() => setEditing(r)}>
                  <Icon name="edit" size={16} />
                  {t('common.edit')}
                  <span className="sr-only">: {r.pattern}</span>
                </button>
                <button type="button" className="btn btn--small btn--danger-ghost" onClick={() => void remove(r)}>
                  <Icon name="trash" size={16} />
                  {t('common.delete')}
                  <span className="sr-only">: {r.pattern}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn--secondary" onClick={() => setEditing('new')}>
        <Icon name="plus" />
        {t('rules.add')}
      </button>
      {editing && <RuleDialog rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}

export function RuleDialog({
  rule,
  onClose,
  initial,
}: {
  rule: CategoryRule | null
  onClose: () => void
  /** Para crear una regla desde otra pantalla (por ejemplo, la importación). */
  initial?: Pick<CategoryRule, 'pattern' | 'kind' | 'categoryId'>
}) {
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const run = useRun()
  const toast = useToast()
  const start = rule ?? initial
  const [id] = useState(() => rule?.id ?? newId())
  const [pattern, setPattern] = useState(start?.pattern ?? '')
  const [kind, setKind] = useState<CategoryRule['kind']>(start?.kind ?? 'expense')
  const [categoryId, setCategoryId] = useState(start?.categoryId ?? 'other_expense')
  const [issues, setIssues] = useState<Issue[]>([])

  const options = withCurrent(categoriesForKind(kind, data.categories, { prefs: data.categoryPrefs }), rule?.kind === kind ? rule.categoryId : undefined)
  // Probar antes de guardar: qué movimientos ya registrados coinciden (la regla no los cambia).
  const preview = useMemo(() => previewRule(data, pattern, kind, categoryId), [data, pattern, kind, categoryId])

  const submit = async () => {
    const { result, saved } = await run((d, c) => saveCategoryRule(d, { id, pattern, kind, categoryId }, c))
    if (!result.ok) {
      setIssues(result.issues)
      return
    }
    toast({ message: saved ? t('rules.saved') : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={rule ? t('rules.editTitle') : t('rules.newTitle')}
      onSubmit={() => void submit()}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary">
            {t('common.save')}
          </button>
        </>
      }
    >
      <TextField
        label={t('rules.pattern')}
        value={pattern}
        maxLength={RULE_PATTERN_MAX}
        onChange={(e) => setPattern(e.target.value)}
        error={fieldError(t, fmt, issues, 'pattern')}
        hint={t('rules.patternHint')}
        required
        autoFocus
      />
      <p className="note" data-testid="rule-preview">
        {preview.total === 0
          ? t('rules.previewNone')
          : `${tn('rules.previewCount', preview.total)}${preview.withOtherCategory > 0 ? ` · ${t('rules.previewOther', { count: preview.withOtherCategory })}` : ''}`}
      </p>
      {preview.sample.length > 0 && (
        <ul className="bullets">
          {preview.sample.slice(0, 3).map((x) => (
            <li key={x.id}>
              {fmt.date(x.date, { compact: true })} · {fmt.money(x.amountMinor)} · {x.note || x.merchant} · {categoryLabel(t, x.categoryId)}
            </li>
          ))}
        </ul>
      )}
      <Segmented
        legend={t('rules.kind')}
        name="rulekind"
        value={kind}
        onChange={(k) => {
          setKind(k)
          setCategoryId(k === 'income' ? 'other_income' : 'other_expense')
        }}
        options={[
          { value: 'expense', label: t('rules.forExpenses') },
          { value: 'income', label: t('rules.forIncome') },
        ]}
      />
      <CategoryPicker label={t('fields.category')} kind={kind} data={data} value={categoryId} onChange={setCategoryId} only={options} keep={rule?.kind === kind ? rule.categoryId : undefined} error={fieldError(t, fmt, issues, 'categoryId')} />
    </Dialog>
  )
}
