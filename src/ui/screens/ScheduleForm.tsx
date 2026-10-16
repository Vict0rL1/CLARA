import { useRef, useState } from 'react'
import { activeAccounts, isBudgetAccount } from '../../domain/balances'
import { categoriesForKind } from '../../domain/categories'
import { addDays, isValidLocalDate, parseLocalDate } from '../../domain/dates'
import { newId } from '../../domain/ids'
import { deleteSchedule, restoreSchedule, saveSchedule, type ScheduleDraft } from '../../domain/operations'
import { defaultSplitDate, saveScheduleFrom } from '../../domain/scheduleFrom'
import type { Frequency, ScheduleKind } from '../../domain/types'
import { FREQUENCIES, LIMITS, type Issue } from '../../domain/validation'
import { useT } from '../../i18n'
import { useRun, useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { Alert, EmptyState, PageHeader } from '../components/common'
import { CheckboxField, MoneyField, Segmented, SelectField, TextField } from '../components/fields'
import { CategoryPicker } from '../components/CategoryPicker'
import { SecondDayField } from '../components/SecondDayField'
import { secondDayFrom } from '../secondDay'
import { parseMoneyText, moneyErrorMessage } from '../moneyText'
import { Icon } from '../components/Icon'
import { useToast } from '../components/toastContext'
import { useFormat } from '../format'
import { accountOptions, fieldError, frequencyLabel, issueMessage, otherIssues } from '../labels'
import { href, type Route, useNavigateIfStillHere } from '../router'

const REMINDER_OPTIONS = [0, 1, 2, 3, 7, 14]

export function ScheduleForm({ route }: { route: Route }) {
  const leave = useNavigateIfStillHere()
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const editId = route.segments[2] === 'editar' ? route.segments[3] : undefined
  const existing = editId ? data.schedules.find((s) => s.id === editId) : undefined
  const queryKind = route.query.get('kind') === 'income' ? 'income' : 'expense'
  // Clara 2.0 fase 3: «Programar» desde una sugerencia de la bandeja abre el formulario relleno (solo uno
  // nuevo; cada valor se valida y uno que no sirve se ignora). Guardar sigue siendo decisión de la persona.
  const q = editId ? null : route.query
  const qAmount = Number(q?.get('amount'))
  const prefill = {
    name: q?.get('name')?.slice(0, LIMITS.nameMax) ?? '',
    amountMinor: Number.isSafeInteger(qAmount) && qAmount > 0 ? qAmount : undefined,
    frequency: (FREQUENCIES as readonly string[]).includes(q?.get('frequency') ?? '') ? (q!.get('frequency') as Frequency) : undefined,
    start: isValidLocalDate(q?.get('start')) ? q!.get('start')! : undefined,
    category: q?.get('category') ?? undefined,
    account: q?.get('account') && data.accounts.some((a) => a.id === q.get('account') && !a.archived) ? q.get('account')! : undefined,
  }

  const [id] = useState(() => existing?.id ?? newId())
  // Clara 2.0 fase 3: «desde una fecha» parte la serie; el id del nuevo se genera al abrir (guardar dos
  // veces actualiza el mismo). Solo se ofrece si hay fechas anteriores que conservar.
  const [splitId] = useState(() => newId())
  const [splitDefault] = useState(() => (existing ? defaultSplitDate(data, existing, today) : null))
  const [scope, setScope] = useState<'all' | 'from'>('all')
  const allStart = useRef(existing?.startDate ?? today)
  const [kind, setKind] = useState<ScheduleKind>(existing?.kind ?? queryKind)
  const [name, setName] = useState(existing?.name ?? prefill.name)
  const [amountText, setAmountText] = useState(existing ? fmt.moneyInput(existing.amountMinor) : prefill.amountMinor ? fmt.moneyInput(prefill.amountMinor) : '')
  const [isEstimate, setIsEstimate] = useState(existing?.amountIsEstimate ?? false)
  // Ingreso variable: mínimo y extra (el importe principal es el esperado).
  const [variable, setVariable] = useState(!!existing?.range)
  const [minText, setMinText] = useState(existing?.range ? fmt.moneyInput(existing.range.minMinor) : '')
  const [extraText, setExtraText] = useState(existing?.range ? fmt.moneyInput(existing.range.extraMinor) : '')
  const [rangeErrors, setRangeErrors] = useState<{ min: string | null; extra: string | null }>({ min: null, extra: null })
  const [frequency, setFrequency] = useState<Frequency>(existing?.frequency ?? prefill.frequency ?? 'monthly')
  const [intervalDays, setIntervalDays] = useState(String(existing?.intervalDays ?? 30))
  // Dos veces al mes: vacío = 15 días después (o antes) del primer día; se dice en la ayuda.
  const [secondDayText, setSecondDayText] = useState(existing?.secondDay ? String(existing.secondDay) : '')
  const [autoConfirm, setAutoConfirm] = useState(!!existing?.autoConfirm)
  const [paused, setPaused] = useState(!!existing?.paused)
  const [startDate, setStartDate] = useState(existing?.startDate ?? prefill.start ?? today)
  const [endDate, setEndDate] = useState(existing?.endDate ?? '')
  const [accountId, setAccountId] = useState(existing?.accountId ?? prefill.account ?? (activeAccounts(data.accounts).find(isBudgetAccount) ?? activeAccounts(data.accounts)[0] ?? data.accounts[0]!).id)
  const [categoryId, setCategoryId] = useState(
    existing?.categoryId ?? (prefill.category && categoriesForKind(queryKind, data.categories, { prefs: data.categoryPrefs }).includes(prefill.category) ? prefill.category : queryKind === 'income' ? 'salary' : 'other_expense'),
  )
  const [reminder, setReminder] = useState(existing?.reminderDaysBefore ?? (queryKind === 'income' ? 0 : 2))
  const [note, setNote] = useState(existing?.note ?? '')
  const [issues, setIssues] = useState<Issue[]>([])
  const [amountError, setAmountError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (editId && !existing) {
    return (
      <div className="stack">
        <PageHeader title={t('scheduleForm.notFound')} back={{ href: href('/plan/calendario'), label: t('plan.calendar') }} />
        <EmptyState icon="search" title={t('scheduleForm.notFoundText')} />
      </div>
    )
  }

  const changeKind = (k: ScheduleKind) => {
    setKind(k)
    if (!categoriesForKind(k, data.categories, { prefs: data.categoryPrefs }).includes(categoryId)) setCategoryId(k === 'income' ? 'salary' : 'other_expense')
  }

  const submit = async () => {
    const parsed = parseMoneyText(amountText, fmt)
    setAmountError(moneyErrorMessage(t, parsed))
    let range: { minMinor: number; extraMinor: number } | undefined
    if (kind === 'income' && variable) {
      const min = parseMoneyText(minText, fmt, { allowZero: true })
      const extra = parseMoneyText(extraText, fmt, { allowZero: true })
      setRangeErrors({ min: moneyErrorMessage(t, min), extra: moneyErrorMessage(t, extra) })
      if (!min.ok || !extra.ok) return
      range = { minMinor: min.minor, extraMinor: extra.minor }
    }
    if (!parsed.ok || busy) return
    setBusy(true)
    const draft: ScheduleDraft = {
      id: scope === 'from' ? splitId : id,
      name,
      kind,
      amountMinor: parsed.minor,
      amountIsEstimate: isEstimate || !!range,
      range,
      accountId,
      categoryId,
      frequency,
      ...(frequency === 'custom' ? { intervalDays: Number(intervalDays) } : {}),
      ...(frequency === 'semimonthly' ? { secondDay: secondDay } : {}),
      startDate,
      endDate: endDate || undefined,
      reminderDaysBefore: reminder,
      note,
      ...(autoConfirm ? { autoConfirm: true } : {}),
      ...(paused ? { paused: true } : {}),
    }
    const { result, saved } = await run((d, c) => {
      if (scope !== 'from' || !existing) return saveSchedule(d, draft, c)
      const r = saveScheduleFrom(d, existing.id, draft, c)
      return r.ok ? { ...r, value: r.value.next } : r
    })
    setBusy(false)
    if (!result.ok) {
      setIssues(result.issues)
      return
    }
    const message = scope === 'from' ? t('scheduleForm.savedFrom', { date: fmt.date(startDate) }) : t('scheduleForm.saved')
    toast({ message: saved ? message : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
    leave('/plan/calendario')
  }

  const remove = async () => {
    if (!existing) return
    const { result, saved } = await run((d, c) => deleteSchedule(d, existing.id, c))
    if (!result.ok) return
    const removed = result.value
    toast({
      message: saved ? t('scheduleForm.deleted') : t('save.error.generic'),
      tone: saved ? 'good' : 'critical',
      action: { label: t('common.undo'), onClick: () => void run((d, c) => restoreSchedule(d, removed, c)) },
    })
    leave('/plan/calendario')
  }

  const day = startDate ? parseLocalDate(startDate).day : 0
  const secondDay = secondDayFrom(startDate, secondDayText)
  const unknown = otherIssues(issues, ['name', 'amountMinor', 'startDate', 'endDate', 'accountId', 'categoryId', 'range.minMinor', 'range.extraMinor', 'secondDay'])

  return (
    <div className="stack">
      <PageHeader title={existing ? t('scheduleForm.editTitle') : t('scheduleForm.newTitle')} back={{ href: href('/plan/calendario'), label: t('plan.calendar') }} />
      <form
        className="form card"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Segmented
          legend={t('fields.kind')}
          name="skind"
          value={kind}
          onChange={changeKind}
          options={[
            { value: 'expense', label: t('scheduleForm.kindExpense') },
            { value: 'income', label: t('scheduleForm.kindIncome') },
          ]}
        />
        <TextField label={t('fields.name')} value={name} maxLength={LIMITS.nameMax} onChange={(e) => setName(e.target.value)} placeholder={t(kind === 'income' ? 'scheduleForm.namePlaceholderIncome' : 'scheduleForm.namePlaceholderExpense')} error={fieldError(t, fmt, issues, 'name')} required />
        <MoneyField label={t('fields.amount')} value={amountText} onChange={setAmountText} error={amountError ?? fieldError(t, fmt, issues, 'amountMinor')} fmt={fmt} />
        {!(kind === 'income' && variable) && (
          <CheckboxField checked={isEstimate} onChange={setIsEstimate} label={t('scheduleForm.estimate')} hint={t('scheduleForm.estimateHint')} />
        )}
        {kind === 'income' && (
          <CheckboxField checked={variable} onChange={setVariable} label={t('scheduleForm.variable')} hint={t('scheduleForm.variableHint')} />
        )}
        {kind === 'income' && variable && (
          <div className="form-grid">
            <MoneyField label={t('scheduleForm.min')} value={minText} onChange={setMinText} error={rangeErrors.min ?? fieldError(t, fmt, issues, 'range.minMinor')} fmt={fmt} />
            <MoneyField label={t('scheduleForm.extra')} value={extraText} onChange={setExtraText} error={rangeErrors.extra ?? fieldError(t, fmt, issues, 'range.extraMinor')} fmt={fmt} />
          </div>
        )}
        <SelectField
          label={t('fields.frequency')}
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as Frequency)}
          options={FREQUENCIES.map((f) => ({ value: f, label: frequencyLabel(t, f) }))}
        />
        {frequency === 'custom' && (
          <TextField label={t('scheduleForm.intervalDays')} type="number" inputMode="numeric" min={1} max={365} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} hint={t('scheduleForm.intervalDaysHint')} error={fieldError(t, fmt, issues, 'intervalDays')} required />
        )}
        {splitDefault && (
          <Segmented
            legend={t('scheduleForm.scope')}
            name="sscope"
            value={scope}
            onChange={(next) => {
              if (next === scope) return
              if (next === 'from') allStart.current = startDate
              setStartDate(next === 'from' ? splitDefault : allStart.current)
              setScope(next)
              setIssues([])
            }}
            options={[
              { value: 'all', label: t('scheduleForm.scopeAll') },
              { value: 'from', label: t('scheduleForm.scopeFrom') },
            ]}
          />
        )}
        <TextField
          label={scope === 'from' ? t('scheduleForm.fromDate') : t('scheduleForm.nextDate')}
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          hint={
            scope === 'from' && isValidLocalDate(startDate)
              ? t('scheduleForm.fromHint', { date: fmt.date(addDays(startDate, -1)) })
              : frequency === 'monthly' && day >= 29
                ? t('scheduleForm.monthEndHint', { day })
                : startDate < today
                  ? t('scheduleForm.pastDateHint')
                  : t('scheduleForm.nextDateHint')
          }
          error={fieldError(t, fmt, issues, 'startDate')}
          required
        />
        {frequency === 'semimonthly' && (
          <SecondDayField startDate={startDate} value={secondDayText} onChange={setSecondDayText} error={fieldError(t, fmt, issues, 'secondDay')} />
        )}
        {frequency !== 'once' && (
          <TextField label={t('scheduleForm.endDate')} type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} hint={t('scheduleForm.endDateHint')} error={fieldError(t, fmt, issues, 'endDate')} />
        )}
        <SelectField label={t('fields.account')} value={accountId} onChange={(e) => setAccountId(e.target.value)} options={accountOptions(data.accounts, t, existing?.accountId)} error={fieldError(t, fmt, issues, 'accountId')} />
        <CategoryPicker label={t('fields.category')} kind={kind === 'income' ? 'income' : 'expense'} data={data} value={categoryId} onChange={setCategoryId} keep={existing?.categoryId} allowNew />
        <SelectField
          label={t('scheduleForm.reminder')}
          value={String(reminder)}
          onChange={(e) => setReminder(Number(e.target.value))}
          options={REMINDER_OPTIONS.map((n) => ({ value: String(n), label: n === 0 ? t('scheduleForm.reminderSameDay') : tn('scheduleForm.reminderDays', n) }))}
          hint={t('scheduleForm.reminderHint')}
        />
        <TextField label={t('fields.noteOptional')} value={note} maxLength={LIMITS.noteMax} onChange={(e) => setNote(e.target.value)} />
        <CheckboxField checked={autoConfirm} onChange={setAutoConfirm} label={t('scheduleForm.autoConfirm')} hint={t('scheduleForm.autoConfirmHint')} />
        {existing && <CheckboxField checked={paused} onChange={setPaused} label={t('scheduleForm.paused')} hint={t('scheduleForm.pausedHint')} />}
        {existing && scope === 'all' && <p className="note">{t('scheduleForm.editNote')}</p>}
        {unknown.length > 0 && (
          <Alert tone="critical" title={t('common.fixErrors')} role="alert">
            <ul>
              {unknown.map((i, idx) => (
                <li key={idx}>{issueMessage(t, fmt, i)}</li>
              ))}
            </ul>
          </Alert>
        )}
        <div className="form__actions">
          <button type="submit" className="btn btn--primary btn--large" disabled={busy}>
            <Icon name="check" />
            {busy ? t('common.saving') : t('common.save')}
          </button>
          <a className="btn btn--secondary btn--large" href={href('/plan/calendario')}>
            {t('common.cancel')}
          </a>
          {existing && (
            <button type="button" className="btn btn--danger-ghost" onClick={() => void remove()}>
              <Icon name="trash" />
              {t('common.delete')}
            </button>
          )}
        </div>
        {existing && <p className="note">{t('scheduleForm.deleteNote')}</p>}
      </form>
    </div>
  )
}

