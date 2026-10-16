import { useEffect, useMemo, useRef, useState } from 'react'
import { activeAccounts, isBudgetAccount } from '../../domain/balances'
import { categoriesForKind } from '../../domain/categories'
import { addDays, isValidLocalDate } from '../../domain/dates'
import { favoritePrefill, type FavoritePrefill } from '../../domain/favorites'
import { newId } from '../../domain/ids'
import { sumMinor } from '../../domain/money'
import { computeBudget } from '../../domain/budget'
import { implausibilityRatio, isImplausibleAmount } from '../../domain/plausibility'
import { ConfirmDialog } from '../components/Dialog'
import { CategoryPicker } from '../components/CategoryPicker'
import { SecondDayField } from '../components/SecondDayField'
import { secondDayError, secondDayFrom } from '../secondDay'
import { saveTransactionWithSchedule } from '../../domain/repeat'
import { FREQUENCIES } from '../../domain/validation'
import { Toggle } from '../components/base'
import { frequencyLabel } from '../labels'
import { deleteCategoryRule, markOccurrence, saveCategoryRule, saveTransaction, type OpContext } from '../../domain/operations'
import { periodsProposedFor, setTransactionPeriods } from '../../domain/periodBudgets'
import { inferRefundSplit, refundableByCategory, suggestSplitFromHistory, txCategoryIds } from '../../domain/splits'
import { openItemsUntil } from '../../domain/planItems'
import { explainRuleMatch, suggestRuleFromCorrection } from '../../domain/rules'
import { historyOfRecord } from '../../domain/history'
import { similarTransactions } from '../../domain/duplicates'
import { readMovementLink, suggestCategoryForMerchant } from '../../domain/shortcutLink'
import { lastUsedAccount, recentCategories } from '../../domain/quickEntry'
import { resolveSplitTemplate } from '../../domain/templates'
import { clearDraft, readDraft, writeDraft } from '../../storage/drafts'
import type { Frequency, AppData, CategoryRule, SplitLine, Transaction, TxKind, TxStatus } from '../../domain/types'
import type { Issue } from '../../domain/validation'
import { LIMITS } from '../../domain/validation'
import { useT, type MessageKey } from '../../i18n'
import { useRun, useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { forgetListReturn } from '../listView'
import { Alert, Badge, Card, EmptyState, PageHeader } from '../components/common'
import { CheckboxField, MoneyField, Segmented, SelectField, TextField, FieldShell } from '../components/fields'
import { parseMoneyText, moneyErrorMessage } from '../moneyText'
import { Icon } from '../components/Icon'
import { useToast } from '../components/toastContext'
import { BalanceInclusionControl } from '../dialogs'
import { CategoryChip } from '../components/base'
import { FavoriteChips, FavoriteDialog } from '../favoritesUi'
import { useDeleteTransaction } from '../useDeleteTransaction'
import { SplitEditor } from '../splitEditor'
import { draftsFromLines, newSplitDraft, parseDrafts, type SplitDraft } from '../splitDrafts'
import { useFormat } from '../format'
import { accountName, accountOptions as accountOptionsFor, categoryLabel, fieldError, issueMessage, otherIssues, planItemName, transactionTitle, withCurrent } from '../labels'
import { sourceGroupOf } from '../../domain/txFilters'
import { href, navigate, withQuery, type Route, navigateIfStillAt, useNavigateIfStillHere } from '../router'

type FormKind = Exclude<TxKind, 'adjustment'>

const DRAFT_NAME = 'movement'

/** Lo que se conserva de un movimiento a medio escribir (texto del formulario, no un registro). */
interface MovementDraft {
  id: string
  kind: FormKind
  status: TxStatus
  amountText: string
  date: string
  accountId: string
  toAccountId: string
  categoryId: string
  note: string
  splitDrafts: SplitDraft[] | null
}

const FIELD_PATHS = ['amountMinor', 'date', 'accountId', 'toAccountId', 'categoryId', 'refundOfId', 'note', 'merchant', 'link', 'expectRemainder', 'splits']

export function MovementForm({ route }: { route: Route }) {
  const { t } = useT()
  const data = useData()
  const editId = route.segments[0] === 'movimientos' && route.segments[1] === 'editar' ? route.segments[2] : undefined
  const existing = editId ? data.transactions.find((tx) => tx.id === editId) : undefined
  const returnTo = route.query.get('returnTo') || '/movimientos'

  if (editId && !existing) {
    return (
      <div className="stack">
        <PageHeader title={t('movementForm.notFound')} back={{ href: href('/movimientos'), label: t('nav.movements') }} />
        <EmptyState icon="search" title={t('movementForm.notFoundText')} />
      </div>
    )
  }
  if (existing?.kind === 'adjustment') return <AdjustmentView tx={existing} returnTo={returnTo} />
  return <MovementEditor route={route} existing={existing} returnTo={returnTo} />
}

/** Un ajuste de conciliación no se edita como un gasto: se muestra y se puede enviar a la papelera. */
function AdjustmentView({ tx, returnTo }: { tx: Transaction; returnTo: string }) {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const deleteTx = useDeleteTransaction()
  const account = accountName(data.accounts, tx.accountId, t)
  return (
    <div className="stack">
      <PageHeader title={t('adjustment.title')} back={{ href: href(returnTo), label: t('common.back') }} />
      <Card>
        <p className="lead">{t(tx.adjustmentDirection === 'decrease' ? 'adjustment.decrease' : 'adjustment.increase', { amount: fmt.money(tx.amountMinor) })}</p>
        <p>
          {fmt.date(tx.date)} · {account}
        </p>
        {tx.note && <p>{t('reconcile.reasonShown', { reason: tx.note })}</p>}
        <p className="note">{t('adjustment.text', { account })}</p>
        <div className="form__actions">
          <a className="btn btn--secondary" href={href(withQuery('/conciliar', { cuenta: tx.accountId }))}>
            <Icon name="scale" />
            {t('adjustment.seeReconciliation')}
          </a>
          <button
            type="button"
            className="btn btn--danger-ghost"
            onClick={async () => {
              const from = window.location.hash
              if (await deleteTx(tx.id)) {
                forgetListReturn(data.budgetId)
                navigateIfStillAt(from, returnTo)
              }
            }}
          >
            <Icon name="trash" />
            {t('common.delete')}
          </button>
        </div>
        <p className="note">{t('adjustment.deleteNote')}</p>
      </Card>
    </div>
  )
}

function MovementEditor({ route, existing, returnTo }: { route: Route; existing: Transaction | undefined; returnTo: string }) {
  const leave = useNavigateIfStillHere()
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const deleteTx = useDeleteTransaction()
  const q = route.query

  // Favorito: rellena el formulario (fecha de hoy) pero nunca guarda nada por sí solo.
  const favorite = !existing && q.get('favorito') ? data.favorites.find((f) => f.id === q.get('favorito')) : undefined
  const [prefill] = useState<FavoritePrefill | undefined>(() => (favorite ? favoritePrefill(data, favorite) : undefined))

  // Duplicar como borrador: copia los campos de otro movimiento, con fecha de hoy y un id nuevo.
  const [duplicateOf] = useState(() => {
    const source = !existing && q.get('duplicar') ? data.transactions.find((x) => x.id === q.get('duplicar')) : undefined
    return source && source.kind !== 'adjustment' ? source : undefined
  })
  const queryKind = (duplicateOf?.kind as FormKind | undefined) ?? prefill?.kind ?? (q.get('kind') as FormKind | null) ?? 'expense'
  // Cuenta: la del último movimiento de ese tipo (visible y editable en el formulario).
  // Para transferencias, sin historial, se propone una cuenta que no sea tarjeta (el pago sale del banco).
  const accountFor = (k: TxKind) => {
    const last = lastUsedAccount(data, k)
    const usable = activeAccounts(data.accounts)
    return (
      usable.find((a) => a.id === last) ??
      (k === 'transfer' ? usable.find((a) => isBudgetAccount(a) && a.kind !== 'credit') : undefined) ??
      usable.find(isBudgetAccount) ??
      usable[0] ??
      data.accounts[0]!
    )
  }
  const [lastAccount, setLastAccount] = useState(() => (existing ? undefined : lastUsedAccount(data, queryKind)))
  const defaultAccount = accountFor(queryKind)
  // La cuenta propuesta cambia con el tipo hasta que la persona elige una.
  const [accountTouched, setAccountTouched] = useState(() => !!existing || !!duplicateOf || !!prefill || !!q.get('account'))
  const initialKind = ((existing?.kind as FormKind | undefined) ?? queryKind) as FormKind
  // L1: enlace externo (Atajos de iPhone): `importe` en unidades mayores, `comercio`, `source=shortcut`.
  const [link] = useState(() => (existing ? null : readMovementLink(q, data.settings)))
  // El comercio del enlace sugiere la categoría (regla > aprendizaje > diccionario) si no viene una.
  const [merchantSuggestion] = useState(() =>
    link?.merchant && !q.get('category') && !prefill && !duplicateOf && (initialKind === 'expense' || initialKind === 'income')
      ? suggestCategoryForMerchant(link.merchant, initialKind, data)
      : undefined,
  )
  const [id, setId] = useState(() => existing?.id ?? newId())
  const [kind, setKind] = useState<FormKind>(initialKind)
  const [status, setStatus] = useState<TxStatus>(existing?.status ?? (q.get('status') === 'planned' ? 'planned' : 'realized'))
  // Presupuestos por periodo (solo los no archivados se pueden cambiar aquí).
  const openPeriods = data.periodBudgets.filter((b) => !b.archived)
  // Elecciones explícitas (o ya guardadas). Lo que no está aquí lo propone la regla del periodo.
  const [periodChoice, setPeriodChoice] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      existing ? openPeriods.map((b) => [b.id, b.txIds.includes(existing.id)]) : openPeriods.filter((b) => b.id === q.get('periodo')).map((b) => [b.id, true]),
    ),
  )
  const [amountText, setAmountText] = useState(() => {
    if (existing) return fmt.moneyInput(existing.amountMinor)
    if (duplicateOf) return fmt.moneyInput(duplicateOf.amountMinor)
    if (prefill?.amountMinor !== undefined) return fmt.moneyInput(prefill.amountMinor)
    return link?.amountMinor !== undefined ? fmt.moneyInput(link.amountMinor) : ''
  })
  const [date, setDate] = useState(existing?.date ?? (q.get('date') && isValidLocalDate(q.get('date')) ? q.get('date')! : today))
  const [accountId, setAccountId] = useState(existing?.accountId ?? duplicateOf?.accountId ?? (prefill ? (prefill.accountId ?? '') : (q.get('account') ?? defaultAccount.id)))
  const [toAccountId, setToAccountId] = useState(existing?.toAccountId ?? duplicateOf?.toAccountId ?? data.accounts.find((a) => a.id !== accountId)?.id ?? '')
  const [categoryId, setCategoryId] = useState(
    existing?.categoryId ?? duplicateOf?.categoryId ?? (prefill ? (prefill.categoryId ?? '') : (q.get('category') ?? merchantSuggestion ?? (initialKind === 'income' ? 'salary' : 'other_expense'))),
  )
  const [refundOfId, setRefundOfId] = useState(existing?.refundOfId ?? '')
  const [note, setNote] = useState(existing?.note ?? duplicateOf?.note ?? prefill?.note ?? q.get('note') ?? '')
  const [merchant, setMerchant] = useState(existing?.merchant ?? duplicateOf?.merchant ?? link?.merchant ?? '')
  const [keepReceipt, setKeepReceipt] = useState(true)
  const [tagIds, setTagIds] = useState<string[]>(() => existing?.tagIds ?? duplicateOf?.tagIds ?? favorite?.tagIds ?? [])
  const [alreadyInBalance, setAlreadyInBalance] = useState(() => {
    if (!existing || existing.status !== 'realized') return false
    const acc = data.accounts.find((a) => a.id === existing.accountId)
    return !!acc && existing.date === acc.anchor.date && (existing.realizedAt ?? existing.createdAt) <= acc.anchor.setAt
  })
  const [issues, setIssues] = useState<Issue[]>([])
  const [amountError, setAmountError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [favoriteOpen, setFavoriteOpen] = useState(false)
  const submitting = useRef(false)
  // D6: «Repetir» crea el programado en la misma operación; este movimiento es su primera ocurrencia.
  const [repeat, setRepeat] = useState(false)
  const [repeatFrequency, setRepeatFrequency] = useState<Frequency>('monthly')
  const [repeatEnd, setRepeatEnd] = useState('')
  const [repeatSecondDay, setRepeatSecondDay] = useState('')
  const [repeatSecondDayError, setRepeatSecondDayError] = useState<string | null>(null)
  const [scheduleId] = useState(() => `s_${newId()}`)
  // G5: un gasto desproporcionado pide confirmación una vez por movimiento.
  const [implausible, setImplausible] = useState<number | null | false>(false)
  const implausibleOk = useRef(false)
  const pendingAnother = useRef(false)
  const availableMinor = useMemo(() => computeBudget(data, today).availableMinor, [data, today])
  // Regla de categoría: solo propone mientras la persona no elija la categoría a mano.
  const [categoryTouched, setCategoryTouched] = useState(() => !!existing || !!duplicateOf || !!q.get('category') || !!prefill)
  const [ruleApplied, setRuleApplied] = useState<CategoryRule | undefined>(undefined)
  // Clara 2.0 §7: categoría que proponía una regla y la persona cambió (para ofrecer recordar la corrección).
  const [correctedFrom, setCorrectedFrom] = useState<string | undefined>(undefined)
  const [ruleCompetitors, setRuleCompetitors] = useState(0)
  // Vínculo con un pago o ingreso previsto (solo movimientos nuevos): evita contarlo dos veces.
  const [linkKey, setLinkKey] = useState('')
  const [expectRemainder, setExpectRemainder] = useState(false)
  // Sugerencia de vínculo descartada por la persona (clave de la ocurrencia): no se vuelve a ofrecer.
  const [dismissedLink, setDismissedLink] = useState('')
  // Compra dividida (gastos) o reparto de la devolución de una compra dividida.
  const [splitDrafts, setSplitDrafts] = useState<SplitDraft[] | null>(() => {
    const lines = existing?.splits ?? (duplicateOf?.kind === 'expense' ? duplicateOf.splits : undefined)
    // Al duplicar, las líneas llevan ids nuevos.
    return lines?.length ? (existing ? draftsFromLines(lines, fmt) : lines.map((l) => ({ ...newSplitDraft(l.categoryId, fmt.moneyInput(l.amountMinor)), note: l.note ?? '' }))) : null
  })
  const [templateNote, setTemplateNote] = useState<{ tone: 'info' | 'warning' | 'critical'; title: string; lines: string[] } | null>(null)
  // Detalles (fecha, estado, nota…) plegados en el registro rápido; abiertos al editar.
  const [detailsOpen, setDetailsOpen] = useState(() => !!existing || !!link?.merchant || !!duplicateOf?.note || !!prefill?.note || !!q.get('note') || (!!q.get('date') && q.get('date') !== today) || q.get('status') === 'planned')
  const [splitError, setSplitError] = useState<string | null>(null)

  // Borrador persistente (solo movimientos nuevos sin datos de partida).
  const plainNew = !existing && !favorite && !duplicateOf && !['kind', 'amount', 'importe', 'comercio', 'source', 'category', 'note', 'date', 'account', 'otro', 'status'].some((k) => q.get(k) !== null)
  const [pendingDraft, setPendingDraft] = useState(() => (plainNew ? readDraft<MovementDraft>(DRAFT_NAME, data.budgetId) : null))
  // Abierto con datos de partida (favorito, duplicar, acceso rápido…) y con un borrador anterior
  // sin recuperar: no se pisa; seguirá ofreciéndose la próxima vez.
  const [keepsOldDraft] = useState(() => !existing && !plainNew && readDraft<MovementDraft>(DRAFT_NAME, data.budgetId) !== null)
  const finished = useRef(false)
  useEffect(() => {
    if (existing || pendingDraft || keepsOldDraft || finished.current) return
    const hasContent = amountText.trim() !== '' || note.trim() !== '' || !!splitDrafts
    if (!hasContent) return void clearDraft(DRAFT_NAME)
    const timer = window.setTimeout(() => {
      if (!finished.current) writeDraft<MovementDraft>(DRAFT_NAME, data.budgetId, { id, kind, status, amountText, date, accountId, toAccountId, categoryId, note, splitDrafts })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [existing, pendingDraft, keepsOldDraft, id, kind, status, amountText, date, accountId, toAccountId, categoryId, note, splitDrafts, data.budgetId])

  const recoverDraft = () => {
    if (!pendingDraft) return
    const v = pendingDraft.value
    setId(v.id)
    setKind(v.kind)
    setStatus(v.status)
    setAmountText(v.amountText)
    setDate(v.date)
    if (data.accounts.some((a) => a.id === v.accountId)) {
      setAccountId(v.accountId)
      setAccountTouched(true)
    }
    if (data.accounts.some((a) => a.id === v.toAccountId)) setToAccountId(v.toAccountId)
    setCategoryId(v.categoryId)
    setCategoryTouched(true)
    setNote(v.note)
    setSplitDrafts(v.splitDrafts)
    setDetailsOpen(v.note.trim() !== '' || v.date !== today || v.status !== 'realized')
    setPendingDraft(null)
  }
  const discardDraft = () => {
    clearDraft(DRAFT_NAME)
    setPendingDraft(null)
  }

  const recent = useMemo(() => (existing || kind === 'transfer' ? [] : recentCategories(data, kind)), [data, kind, existing])

  const linkCandidates = useMemo(() => {
    if (existing || (kind !== 'income' && kind !== 'expense')) return []
    return openItemsUntil(data, today, addDays(today, 14)).filter((i) => i.source === 'schedule' && i.direction === kind && i.date >= addDays(today, -45))
  }, [data, today, kind, existing])
  const linked = linkCandidates.find((i) => i.key === linkKey)

  const changeNote = (value: string) => {
    setNote(value)
    // Una regla de categoría nunca sobrescribe una división manual.
    if (categoryTouched || kind === 'transfer' || splitDrafts) return
    const match = explainRuleMatch(value, kind, data.categoryRules, data.categories, data.categoryPrefs)
    if (match) {
      setCategoryId(match.rule.categoryId)
      setRuleApplied(match.rule)
      setRuleCompetitors(match.competitors.length)
    } else if (ruleApplied) {
      setCategoryId(kind === 'income' ? 'salary' : 'other_expense')
      setRuleApplied(undefined)
      setRuleCompetitors(0)
    }
  }

  const changeKind = (k: FormKind) => {
    setKind(k)
    let from = accountId
    if (!accountTouched && !existing) {
      from = accountFor(k).id
      setAccountId(from)
      setLastAccount(lastUsedAccount(data, k))
    }
    if (k !== kind) setSplitDrafts(null)
    setRuleApplied(undefined)
    setLinkKey('')
    const valid = categoriesForKind(k, data.categories, { prefs: data.categoryPrefs })
    if (k !== 'transfer' && !valid.includes(categoryId)) setCategoryId(k === 'income' ? 'salary' : 'other_expense')
    if (k === 'transfer' && toAccountId === from) setToAccountId(data.accounts.find((a) => a.id !== from)?.id ?? '')
  }

  // Solo hace falta para devoluciones. Lo ya devuelto se suma en UNA pasada (antes era O(n²):
  // con 10.000 movimientos guardar tardaba más de un segundo; ver docs/PERFORMANCE.md).
  const refundCandidates = useMemo(() => {
    if (kind !== 'refund') return []
    const refunded = new Map<string, number>()
    for (const r of data.transactions) {
      if (r.kind === 'refund' && r.refundOfId && r.id !== id) refunded.set(r.refundOfId, sumMinor([refunded.get(r.refundOfId) ?? 0, r.amountMinor]))
    }
    return data.transactions
      .filter((tx) => tx.kind === 'expense' && tx.status === 'realized' && tx.id !== id)
      .map((tx) => ({ tx, remaining: tx.amountMinor - (refunded.get(tx.id) ?? 0) }))
      .filter((c) => c.remaining > 0 || c.tx.id === refundOfId)
      .sort((a, b) => (a.tx.date < b.tx.date ? 1 : -1))
      .slice(0, 50)
  }, [data.transactions, id, refundOfId, kind])

  const proposedPeriods = existing ? [] : periodsProposedFor(data, { kind, date, categoryId })
  const periodChecked = (budgetId: string) => (budgetId in periodChoice ? periodChoice[budgetId]! : proposedPeriods.includes(budgetId))
  const periodIds = openPeriods.filter((b) => periodChecked(b.id)).map((b) => b.id)

  const parsedAmount = parseMoneyText(amountText, fmt)
  // Posible duplicado antes de guardar: misma regla que la bandeja; solo avisa, nunca bloquea.
  const similar = useMemo(() => {
    if (existing || status !== 'realized' || !parsedAmount.ok || kind === 'transfer') return []
    return similarTransactions(data, { id, kind, accountId, amountMinor: parsedAmount.minor, date, note }, linked?.sourceId)
  }, [existing, status, parsedAmount, kind, data, id, accountId, date, note, linked])
  // Si el importe (o la categoría y la fecha) coincide con una ocurrencia abierta del calendario, se ofrece vincularla.
  const linkSuggestion = useMemo(() => {
    if (existing || linkKey || status !== 'realized' || !parsedAmount.ok) return undefined
    return linkCandidates.find((i) => i.key !== dismissedLink && (i.amountMinor === parsedAmount.minor || (!!i.categoryId && i.categoryId === categoryId && i.date === date)))
  }, [existing, linkKey, status, parsedAmount, linkCandidates, dismissedLink, categoryId, date])
  const applyLink = (key: string) => {
    setLinkKey(key)
    setExpectRemainder(false)
    const item = linkCandidates.find((i) => i.key === key)
    if (item && !amountText.trim()) setAmountText(fmt.moneyInput(item.amountMinor))
  }
  const refundOriginal = kind === 'refund' && refundOfId ? data.transactions.find((x) => x.id === refundOfId) : undefined
  const refundSplitMode = !!refundOriginal?.splits?.length
  const refundPending = useMemo(() => (refundOriginal && refundSplitMode ? refundableByCategory(data, refundOriginal, id) : undefined), [data, refundOriginal, refundSplitMode, id])
  const inferredRefund = refundOriginal && refundSplitMode && parsedAmount.ok ? inferRefundSplit(data, refundOriginal, parsedAmount.minor, id) : null
  const expenseCategories = categoriesForKind('expense', data.categories, { prefs: data.categoryPrefs })
  // Propuesta: repartir como la última compra dividida con la misma descripción.
  const historySplit = kind === 'expense' && !splitDrafts ? suggestSplitFromHistory(data, note, parsedAmount.ok ? parsedAmount.minor : null, id) : null

  const canRepeat = !existing && !linked && (kind === 'expense' || kind === 'income') && status === 'realized' && !splitDrafts

  const submit = async (another = false) => {
    const parsed = parseMoneyText(amountText, fmt)
    setAmountError(moneyErrorMessage(t, parsed))
    // Evita un segundo envío por doble clic antes de que React vuelva a pintar.
    if (!parsed.ok || submitting.current) return
    // «Repetir» dos veces al mes: el segundo día se valida antes de guardar (misma regla que el dominio).
    const badSecondDay = repeat && canRepeat && repeatFrequency === 'semimonthly' && secondDayError(date, repeatSecondDay)
    setRepeatSecondDayError(badSecondDay ? t('issue.semimonthlyDays') : null)
    if (badSecondDay) return
    if (kind === 'expense' && !implausibleOk.current && isImplausibleAmount(parsed.minor, availableMinor, data.settings.currency)) {
      pendingAnother.current = another
      setImplausible(implausibilityRatio(parsed.minor, availableMinor))
      return
    }
    // División: las líneas deben ser válidas y sumar exactamente el total (también lo valida el dominio).
    let splits: SplitLine[] | undefined
    const splitActive = (kind === 'expense' || refundSplitMode) && splitDrafts
    if (splitActive) {
      const lines = parseDrafts(splitDrafts, fmt)
      if (!lines) return void setSplitError(t('split.invalidLine'))
      const diff = parsed.minor - lines.reduce((sum, l) => sum + l.amountMinor, 0)
      if (diff !== 0) return void setSplitError(t('issue.splitMismatch', { differenceMinor: fmt.money(diff) }))
      splits = lines
    } else if (refundSplitMode) {
      return void setSplitError(t('split.refundNeedsSplit'))
    }
    setSplitError(null)
    submitting.current = true
    setBusy(true)
    const useLink = !!linked && status === 'realized'
    const periods = kind === 'expense' || kind === 'refund' ? periodIds : []

    const { result, saved } = await run((d, c) => {
      const r = save(d, c, parsed.minor, splits)
      if (!r.ok || (useLink && r.unchanged && r.value.id !== id) || openPeriods.length === 0) return r
      // Asociación con presupuestos por periodo en la misma operación (todo o nada).
      const p = setTransactionPeriods(r.data, r.value.id, periods, c)
      if (!p.ok) return p
      return p.unchanged ? r : { ok: true as const, data: p.data, value: r.value }
    })
    setBusy(false)
    if (!result.ok) {
      submitting.current = false
      setIssues(result.issues)
      if (result.issues.some((i) => /^(date|note|status)/.test(i.path))) setDetailsOpen(true)
      return
    }
    // Si otra pestaña ya cerró esa ocurrencia, no se crea nada: se avisa en vez de duplicar.
    if (useLink && result.unchanged && result.value.id !== id) {
      submitting.current = false
      setIssues([{ path: 'link', code: 'occurrenceAlreadySettled', params: { date: fmt.date(linked.date) } }])
      return
    }
    const savedTx = result.value
    if (saved) {
      finished.current = true
      if (!keepsOldDraft) clearDraft(DRAFT_NAME)
    }
    const canDistribute = saved && !existing && savedTx.kind === 'income' && savedTx.status === 'realized'
    if (saved && another && !existing) {
      toast({ message: t('quick.savedNext'), tone: 'good' })
      // Otro movimiento con el mismo tipo, cuenta, categoría y fecha (id nuevo al montar).
      return leave(
        withQuery('/movimientos/nuevo', {
          kind,
          account: accountId,
          category: kind === 'transfer' ? undefined : (splits?.[0]?.categoryId ?? categoryId),
          date: date === today ? undefined : date,
          returnTo: returnTo === '/movimientos' ? undefined : returnTo,
          otro: newId(),
        }),
      )
    }
    const savedMessage = t(existing ? 'movementForm.updated' : repeat && canRepeat ? 'movementForm.repeatSaved' : 'movementForm.saved')
    // Clara 2.0 §7: si la persona corrigió la categoría, se OFRECE recordarla como regla; nunca se guarda sola.
    const learn = saved && !canDistribute ? suggestRuleFromCorrection(data, { note: savedTx.note, kind: savedTx.kind, categoryId: savedTx.categoryId, previousCategoryId: existing ? existing.categoryId : correctedFrom, hasSplits: !!savedTx.splits }) : null
    toast({
      message: !saved ? t('save.error.generic') : learn ? t('rules.learn.offer', { saved: savedMessage, category: categoryLabel(t, learn.categoryId), pattern: learn.pattern }) : savedMessage,
      tone: saved ? 'good' : 'critical',
      // Tras registrar un ingreso recibido se ofrece repartirlo (nunca se hace solo).
      ...(canDistribute ? { action: { label: t('distribution.offer'), onClick: () => navigate(`/movimientos/distribuir/${savedTx.id}`) } } : {}),
      ...(learn ? { action: { label: t('rules.learn.remember'), onClick: () => void rememberRule(learn) } } : {}),
    })
    // Tras guardar, el historial vuelve a abrirse limpio (solo «Volver» recupera la vista).
    forgetListReturn(data.budgetId)
    leave(returnTo)
  }

  /** Guarda la regla que la persona aceptó recordar; se puede deshacer desde el aviso. */
  async function rememberRule(learn: { pattern: string; kind: 'expense' | 'income'; categoryId: string }) {
    const ruleId = newId()
    const { result, saved } = await run((d, c) => saveCategoryRule(d, { id: ruleId, ...learn }, c))
    if (!result.ok || !saved) return void toast({ message: t(result.ok ? 'save.error.generic' : 'rules.learn.failed'), tone: 'critical' })
    toast({
      message: t('rules.learn.saved', { pattern: learn.pattern, category: categoryLabel(t, learn.categoryId) }),
      tone: 'good',
      action: { label: t('common.undo'), onClick: () => void run((d, c) => deleteCategoryRule(d, ruleId, c)) },
    })
  }

  /** Guarda el movimiento (o liquida la ocurrencia vinculada). */
  function save(d: AppData, c: OpContext, amountMinor: number, splits?: SplitLine[]) {
    if (linked && status === 'realized') {
      return markOccurrence(
        d,
        {
          scheduleId: linked.sourceId,
          occurrenceDate: linked.date,
          amountMinor,
          date,
          accountId,
          alreadyInBalance,
          txId: id,
          expectRemainder: expectRemainder && amountMinor < linked.amountMinor,
          categoryId,
          note,
        },
        c,
      )
    }
    const draft = {
      id,
      kind,
      status,
      amountMinor,
      date,
      accountId,
      ...(kind === 'transfer' ? { toAccountId } : { categoryId: splits?.[0]?.categoryId ?? categoryId }),
      ...(splits ? { splits } : {}),
      ...(kind === 'refund' && refundOfId ? { refundOfId } : {}),
      note,
      merchant: merchant.trim() || undefined,
      ...(existing?.receiptUri && !keepReceipt ? { receiptUri: null } : {}),
      tagIds: tagIds.filter((id) => d.tags.some((tg) => tg.id === id)),
      ...(existing ? {} : favorite ? { favoriteId: favorite.id, source: 'common' as const } : { source: link?.fromShortcut ? ('shortcut' as const) : ('manual' as const) }),
      ...(existing?.scheduleId ? { scheduleId: existing.scheduleId, occurrenceDate: existing.occurrenceDate, partialSettlement: existing.partialSettlement } : {}),
      alreadyInBalance,
    }
    if (repeat && canRepeat && (kind === 'expense' || kind === 'income')) {
      const name = (note.trim() || merchant.trim() || categoryLabel(t, categoryId)).slice(0, 60)
      return saveTransactionWithSchedule(d, draft, { id: scheduleId, name, kind, amountMinor, amountIsEstimate: false, accountId, categoryId, frequency: repeatFrequency, ...(repeatFrequency === 'semimonthly' ? { secondDay: secondDayFrom(date, repeatSecondDay) } : {}), startDate: date, ...(repeatEnd ? { endDate: repeatEnd } : {}), reminderDaysBefore: 1 }, c)
    }
    return saveTransaction(d, draft, c)
  }

  const splitTemplates = data.templates.filter((x): x is Extract<typeof x, { kind: 'split' }> => x.kind === 'split')
  /** Rellena la división con una plantilla (solo el formulario: nada se guarda). */
  const applyTemplate = (templateId: string) => {
    const tpl = splitTemplates.find((x) => x.id === templateId)
    if (!tpl) return
    if (!parsedAmount.ok) return setTemplateNote({ tone: 'warning', title: t('quick.templateNeedsAmount'), lines: [] })
    const r = resolveSplitTemplate(data, tpl, parsedAmount.minor)
    if ('exceeds' in r) return setTemplateNote({ tone: 'critical', title: t('issue.templateExceedsTotal'), lines: [] })
    const lines: string[] = r.lines.filter((l) => l.problem).map((l) => t(`quick.problem.${l.problem}` as MessageKey, { name: categoryLabel(t, l.line.categoryId) || l.line.categoryId, amount: fmt.money(l.amountMinor) }))
    if (r.rounding) lines.push(t('quick.templateRounding', { amount: fmt.money(r.rounding.amountMinor), name: categoryLabel(t, r.rounding.toCategoryId) }))
    if (r.unassignedMinor > 0) lines.push(t('quick.templateUnassigned', { amount: fmt.money(r.unassignedMinor) }))
    if (r.apply.length > 0) {
      setSplitDrafts(r.apply.map((l) => newSplitDraft(l.categoryId, fmt.moneyInput(l.amountMinor))))
      setSplitError(null)
      setRuleApplied(undefined)
    }
    setTemplateNote({ tone: lines.length ? 'warning' : 'info', title: t('quick.templateApplied', { name: tpl.name }), lines })
  }
  const splitAsTemplate = (() => {
    if (kind !== 'expense' || !splitDrafts) return null
    const lines = parseDrafts(splitDrafts, fmt)
    if (!lines || lines.length === 0) return null
    return withQuery('/movimientos/plantillas/nueva', { tipo: 'split', lineas: lines.map((l) => `${l.categoryId}:${l.amountMinor}`).join(','), returnTo: '/movimientos/nuevo' })
  })()

  const choose = { value: '', label: t('favorites.choose') }
  // Cuentas activas; la de un registro existente se conserva aunque esté archivada (marcada).
  const accountOptions = accountOptionsFor(data.accounts, t, existing?.accountId)
  const toAccountOptions = accountOptionsFor(data.accounts, t, existing?.toAccountId)
  const schedule = existing?.scheduleId ? data.schedules.find((s) => s.id === existing.scheduleId) : undefined
  const unknownIssues = otherIssues(issues, FIELD_PATHS)

  return (
    <div className="stack">
      <PageHeader title={existing ? t('movementForm.editTitle') : t('movementForm.newTitle')} back={{ href: href(returnTo), label: t('common.back') }} />

      {/* Detalle legible del movimiento guardado: importe con moneda, fecha, categoría, cuenta, origen y recurrencia. */}
      {existing && (
        <section className="tx-summary" aria-label={t('movementForm.summaryAria')} data-testid="movement-summary">
          <div className="tx-summary__head">
            <span className={`tx-summary__icon tx-summary__icon--${existing.kind}`} aria-hidden="true">
              <Icon name={existing.kind === 'income' ? 'arrowDown' : existing.kind === 'expense' ? 'arrowUp' : existing.kind === 'transfer' ? 'transfer' : existing.kind === 'refund' ? 'refund' : 'sliders'} size={20} />
            </span>
            <div className="tx-summary__main">
              <p className={`tx-summary__amount tx-summary__amount--${existing.kind}`}>
                <span className="sr-only">{t(`txKind.${existing.kind}` as MessageKey)}: </span>
                {existing.kind === 'income' || existing.kind === 'refund' ? '+' : existing.kind === 'expense' ? '−' : ''}
                {fmt.money(existing.amountMinor)} <span className="tx-summary__currency">{existing.currency}</span>
              </p>
              <p className="tx-summary__meta">
                {fmt.date(existing.date, { weekday: true })}
                {' · '}
                {existing.kind === 'transfer'
                  ? `${accountName(data.accounts, existing.accountId, t)} → ${accountName(data.accounts, existing.toAccountId, t)}`
                  : existing.kind === 'adjustment'
                    ? accountName(data.accounts, existing.accountId, t)
                    : `${existing.splits?.length ? txCategoryIds(existing).map((c) => categoryLabel(t, c)).join(', ') : categoryLabel(t, existing.categoryId)} · ${accountName(data.accounts, existing.accountId, t)}`}
              </p>
            </div>
          </div>
          <p className="item__badges">
            <Badge icon="edit">{t(`source.${sourceGroupOf(existing)}` as MessageKey)}</Badge>
            {existing.status === 'planned' && (
              <Badge tone="info" icon="clock">
                {t('status.planned')}
              </Badge>
            )}
            {schedule && (
              <Badge icon="calendar">
                {schedule.name} · {frequencyLabel(t, schedule.frequency)}
              </Badge>
            )}
            {existing.merchant && <Badge icon="tag">{existing.merchant}</Badge>}
          </p>
          {schedule && (
            <p className="note">
              {t('movementForm.scopeThisOnly', { name: schedule.name })} <a href={href(`/plan/programado/editar/${schedule.id}`)}>{t('movementForm.editSchedule')}</a>
            </p>
          )}
          <RecordHistory id={existing.id} />
        </section>
      )}

      {link?.fromShortcut && (
        <div data-testid="shortcut-banner">
          <Alert tone="info" icon="sparkles" title={t('movementForm.fromShortcut')} />
        </div>
      )}

      {pendingDraft && (
        <Alert
          tone="info"
          icon="edit"
          title={t('quick.draftTitle', { when: fmt.timestamp(pendingDraft.savedAt) })}
          actions={
            <>
              <button type="button" className="btn btn--primary btn--small" onClick={recoverDraft}>
                {t('quick.draftRecover')}
              </button>
              <button type="button" className="btn btn--secondary btn--small" onClick={discardDraft}>
                {t('quick.draftDiscard')}
              </button>
            </>
          }
        >
          {t('quick.draftText', {
            amount: pendingDraft.value.amountText || '—',
            what: pendingDraft.value.note || (pendingDraft.value.kind === 'transfer' ? t('txKind.transfer') : categoryLabel(t, pendingDraft.value.categoryId) || '—'),
          })}
        </Alert>
      )}
      {duplicateOf && (
        <Alert tone="info" icon="edit" title={t('quick.duplicateTitle', { title: transactionTitle(duplicateOf, data.accounts, t), date: fmt.date(duplicateOf.date) })}>
          {t('quick.duplicateText')}
        </Alert>
      )}
      {!existing && (
        <p className="note note--icon">
          <Badge icon="edit">{t('quick.badge.draft')}</Badge> {t('quick.unsavedNote')}
        </p>
      )}
      {!existing && !favorite && !duplicateOf && <FavoriteChips returnTo={returnTo} />}
      {favorite && prefill && (
        <Alert tone="info" icon="star" title={t('favorites.usingTitle', { name: favorite.name })}>
          <p>{t('favorites.usingText')}</p>
          {prefill.missingAccount && <p>{t('favorites.missingAccount')}</p>}
          {prefill.missingCategory && <p>{t('favorites.missingCategory')}</p>}
        </Alert>
      )}

      <ConfirmDialog
        open={implausible !== false}
        title={implausible === null ? t('form.implausibleNoAvailable') : t('form.implausibleTitle', { times: implausible === false ? 0 : implausible })}
        confirmLabel={t('form.implausibleConfirm')}
        onCancel={() => setImplausible(false)}
        onConfirm={() => {
          implausibleOk.current = true
          setImplausible(false)
          void submit(pendingAnother.current)
        }}
      >
        <p>{t('form.implausibleText', { available: fmt.money(Math.max(0, availableMinor)) })}</p>
      </ConfirmDialog>
      <form
        className="form card"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        onKeyDown={(e) => {
          // Ctrl/Cmd + Intro guarda; con Mayús, guarda y abre otro (solo movimientos nuevos).
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void submit(e.shiftKey && !existing)
          }
        }}
      >
        <Segmented
          legend={t('fields.kind')}
          name="kind"
          value={kind}
          onChange={changeKind}
          options={(['expense', 'income', 'transfer', 'refund'] as const).map((k) => ({ value: k, label: t(`txKind.${k}` as MessageKey) }))}
          hint={t(`movementForm.kindHint.${kind}` as MessageKey)}
        />

        <MoneyField
          label={t('fields.amount')}
          value={amountText}
          hint={
            link?.amountUnreadable
              ? t('movementForm.shortcutAmountUnreadable')
              : link?.foreignCurrency
                ? t('movementForm.shortcutForeignCurrency', { code: link.foreignCurrency, currency: data.settings.currency })
                : undefined
          }
          onChange={setAmountText}
          error={amountError ?? fieldError(t, fmt, issues, 'amountMinor')}
          fmt={fmt}
          big
          autoFocus={!existing}
          name="amount"
        />

        <SelectField
          label={kind === 'transfer' ? t('fields.fromAccount') : t('fields.account')}
          value={accountId}
          onChange={(e) => {
            setAccountId(e.target.value)
            setAccountTouched(true)
          }}
          options={accountId ? accountOptions : [choose, ...accountOptions]}
          error={fieldError(t, fmt, issues, 'accountId')}
          hint={!existing && lastAccount && accountId === lastAccount ? t('quick.lastAccount') : undefined}
        />

        {kind === 'transfer' &&
          (data.accounts.length < 2 ? (
            <Alert tone="info" title={t('movementForm.needTwoAccounts')}>
              <a href={href('/ajustes?seccion=cuentas')}>{t('movementForm.addAccountLink')}</a>
            </Alert>
          ) : (
            <SelectField
              label={t('fields.toAccount')}
              value={toAccountId}
              onChange={(e) => setToAccountId(e.target.value)}
              options={toAccountOptions}
              error={fieldError(t, fmt, issues, 'toAccountId')}
              hint={t('movementForm.transferHint')}
            />
          ))}

        {kind === 'expense' && !splitDrafts && (
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={() => {
              setSplitDrafts([newSplitDraft(categoryId || 'other_expense', amountText), newSplitDraft(expenseCategories.find((c) => c !== categoryId) ?? 'other_expense')])
              setRuleApplied(undefined)
            }}
          >
            <Icon name="list" size={16} />
            {t('split.start')}
          </button>
        )}
        {historySplit && (
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={() => {
              setSplitDrafts(historySplit.lines.map((l) => newSplitDraft(l.categoryId, fmt.moneyInput(l.amountMinor))))
              setRuleApplied(undefined)
            }}
          >
            <Icon name="undo" size={16} />
            {t('split.fromHistory', { note: historySplit.from.note ?? '', date: fmt.date(historySplit.from.date, { compact: true, today }) })}
          </button>
        )}
        {kind === 'expense' && splitTemplates.length > 0 && (
          <SelectField
            label={t('quick.useTemplate')}
            value=""
            onChange={(e) => applyTemplate(e.target.value)}
            options={[{ value: '', label: t('quick.chooseTemplate') }, ...splitTemplates.map((x) => ({ value: x.id, label: x.name }))]}
            hint={t('quick.templateHint')}
          />
        )}
        {templateNote && (
          <Alert tone={templateNote.tone} title={templateNote.title} role={templateNote.tone === 'critical' ? 'alert' : undefined}>
            {templateNote.lines.length > 0 && (
              <ul className="bullets">
                {templateNote.lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            )}
          </Alert>
        )}
        {kind === 'expense' && splitDrafts && (
          <>
            <SplitEditor
              legend={t('split.legend')}
              drafts={splitDrafts}
              onChange={(d) => {
                setSplitDrafts(d)
                setSplitError(null)
              }}
              totalMinor={parsedAmount.ok ? parsedAmount.minor : null}
              categories={withCurrent(expenseCategories, undefined).concat(existing?.splits?.map((l) => l.categoryId).filter((c) => !expenseCategories.includes(c)) ?? [])}
              error={splitError ?? fieldError(t, fmt, issues, 'splits')}
            />
            <p className="note">{t('split.hint')}</p>
            {splitAsTemplate && (
              <a className="btn btn--ghost btn--small" href={href(splitAsTemplate)}>
                <Icon name="star" size={16} />
                {t('quick.saveSplitAsTemplate')}
              </a>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => {
                setCategoryId(splitDrafts[0]?.categoryId ?? categoryId)
                setSplitDrafts(null)
                setSplitError(null)
              }}
            >
              <Icon name="x" size={16} />
              {t('split.remove')}
            </button>
          </>
        )}

        {recent.length > 0 && kind !== 'transfer' && !(kind === 'expense' && splitDrafts) && !refundSplitMode && (
          <div className="chips" role="group" aria-label={t('quick.recentCategories')}>
            <span className="chips__label">{t('quick.recentCategories')}</span>
            {recent.map((c) => (
              <button
                key={c}
                type="button"
                className={`chip${c === categoryId ? ' chip--selected' : ''}`}
                aria-pressed={c === categoryId}
                onClick={() => {
                  if (ruleApplied && ruleApplied.categoryId !== c) setCorrectedFrom(ruleApplied.categoryId)
                  setCategoryId(c)
                  setCategoryTouched(true)
                  setRuleApplied(undefined)
                }}
              >
                {categoryLabel(t, c)}
              </button>
            ))}
          </div>
        )}
        {kind !== 'transfer' && !(kind === 'expense' && splitDrafts) && (
          <CategoryPicker
            label={t('fields.category')}
            kind={kind === 'income' ? 'income' : 'expense'}
            data={data}
            value={categoryId}
            onChange={(id) => {
              if (ruleApplied && ruleApplied.categoryId !== id) setCorrectedFrom(ruleApplied.categoryId)
              setCategoryId(id)
              setCategoryTouched(true)
              setRuleApplied(undefined)
            }}
            keep={existing?.categoryId}
            allowNew
            testId="category-field"
            error={fieldError(t, fmt, issues, 'categoryId')}
            hint={
              ruleApplied
                ? `${t('movementForm.ruleHint', { pattern: ruleApplied.pattern })}${ruleCompetitors > 0 ? ` ${t('movementForm.ruleCompetitors', { count: ruleCompetitors })}` : ''}`
                : merchantSuggestion && categoryId === merchantSuggestion && link?.merchant
                  ? t('movementForm.merchantCategoryHint', { merchant: link.merchant })
                  : kind === 'refund'
                    ? t('movementForm.refundCategoryHint')
                    : undefined
            }
          />
        )}
        {canRepeat && (
          <div className="stack-sm" data-testid="repeat-block">
            <Toggle checked={repeat} onChange={setRepeat} label={t('movementForm.repeat')} hint={repeat ? t('movementForm.repeatHint') : undefined} />
            {repeat && (
              <div className="form-row">
                <SelectField label={t('fields.frequency')} value={repeatFrequency} onChange={(e) => setRepeatFrequency(e.target.value as Frequency)} options={FREQUENCIES.filter((f) => f !== 'once' && f !== 'custom').map((f) => ({ value: f, label: frequencyLabel(t, f) }))} />
                <TextField label={t('scheduleForm.endDate')} type="date" value={repeatEnd} min={date} onChange={(e) => setRepeatEnd(e.target.value)} />
              </div>
            )}
            {repeat && repeatFrequency === 'semimonthly' && (
              <SecondDayField startDate={date} value={repeatSecondDay} onChange={setRepeatSecondDay} error={repeatSecondDayError} name="repeat-second-day" />
            )}
          </div>
        )}

        {kind === 'refund' && (
          <SelectField
            label={t('movementForm.refundOf')}
            value={refundOfId}
            onChange={(e) => {
              setRefundOfId(e.target.value)
              const original = data.transactions.find((tx) => tx.id === e.target.value)
              if (original?.categoryId) setCategoryId(original.categoryId)
              setSplitDrafts(original?.splits?.length ? original.splits.map((l) => newSplitDraft(l.categoryId)) : null)
              setSplitError(null)
            }}
            options={[
              { value: '', label: t('movementForm.refundOfNone') },
              ...refundCandidates.map((c) => ({
                value: c.tx.id,
                label: t('movementForm.refundOption', {
                  title: transactionTitle(c.tx, data.accounts, t),
                  date: fmt.date(c.tx.date, { compact: true, today }),
                  remaining: fmt.money(c.remaining),
                }),
              })),
            ]}
            error={fieldError(t, fmt, issues, 'refundOfId')}
            hint={t('movementForm.refundOfHint')}
          />
        )}

        {refundSplitMode && refundOriginal && (
          <>
            <Alert tone="info" icon="info" title={t('split.refundTitle')}>
              {inferredRefund ? t('split.refundInferable') : t('split.refundAsk')}
            </Alert>
            {inferredRefund && (
              <button
                type="button"
                className="btn btn--secondary btn--small"
                onClick={() => setSplitDrafts(inferredRefund.map((l) => newSplitDraft(l.categoryId, fmt.moneyInput(l.amountMinor))))}
              >
                {t('split.refundAuto')}
              </button>
            )}
            <SplitEditor
              legend={t('split.refundLegend')}
              drafts={splitDrafts ?? []}
              onChange={(d) => {
                setSplitDrafts(d)
                setSplitError(null)
              }}
              totalMinor={parsedAmount.ok ? parsedAmount.minor : null}
              categories={[...new Set(refundOriginal.splits!.map((l) => l.categoryId))]}
              maxByCategory={refundPending}
              withNotes={false}
              error={splitError ?? fieldError(t, fmt, issues, 'splits')}
            />
          </>
        )}

        {linkSuggestion && (
          <div data-testid="link-suggestion">
            <Alert
              tone="info"
              icon="calendar"
              title={t(linkSuggestion.direction === 'income' ? 'movementForm.linkSuggestIncome' : 'movementForm.linkSuggestExpense', { name: planItemName(linkSuggestion, t), date: fmt.date(linkSuggestion.date, { compact: true, today }) })}
              actions={
                <>
                  <button type="button" className="btn btn--primary btn--small" onClick={() => applyLink(linkSuggestion.key)}>
                    {t('movementForm.linkSuggestYes')}
                  </button>
                  <button type="button" className="btn btn--ghost btn--small" onClick={() => setDismissedLink(linkSuggestion.key)}>
                    {t('movementForm.linkSuggestNo')}
                  </button>
                </>
              }
            >
              {t('movementForm.linkSuggestText', { amount: fmt.money(linkSuggestion.amountMinor) })}
            </Alert>
          </div>
        )}
        {linkCandidates.length > 0 && status === 'realized' && (
          <SelectField
            label={t(kind === 'income' ? 'movementForm.linkIncome' : 'movementForm.linkExpense')}
            value={linkKey}
            onChange={(e) => {
              setLinkKey(e.target.value)
              setExpectRemainder(false)
              const item = linkCandidates.find((i) => i.key === e.target.value)
              if (item && !amountText.trim()) setAmountText(fmt.moneyInput(item.amountMinor))
            }}
            options={[
              { value: '', label: t('movementForm.linkNone') },
              ...linkCandidates.map((i) => ({
                value: i.key,
                label: t('movementForm.linkOption', { name: planItemName(i, t), date: fmt.date(i.date, { compact: true, today }), amount: fmt.money(i.amountMinor) }),
              })),
            ]}
            hint={t('movementForm.linkHint')}
            error={fieldError(t, fmt, issues, 'link')}
          />
        )}
        {linked && parsedAmount.ok && parsedAmount.minor < linked.amountMinor && (
          <CheckboxField
            checked={expectRemainder}
            onChange={setExpectRemainder}
            label={t('movementForm.expectRemainder', { amount: fmt.money(linked.amountMinor - parsedAmount.minor) })}
            hint={t('markPaid.partialHint')}
          />
        )}

          {data.tags.length > 0 && (
            <fieldset className="field">
              <legend className="field__label">{t('fields.tags')}</legend>
              <div className="chip-wrap" data-testid="tag-chips">
                {data.tags.map((tg) => (
                  <CategoryChip key={tg.id} label={tg.name} icon="tag" color={tg.color} selected={tagIds.includes(tg.id)} onClick={() => setTagIds((ids) => (ids.includes(tg.id) ? ids.filter((x) => x !== tg.id) : [...ids, tg.id]))} />
                ))}
              </div>
              <p className="field__hint">
                <a href={href('/ajustes?seccion=etiquetas')}>{t('tags.manage')}</a>
              </p>
            </fieldset>
          )}

        <details
          className="form-details"
          open={detailsOpen}
          onToggle={(e) => setDetailsOpen((e.currentTarget as HTMLDetailsElement).open)}
          data-testid="movement-details"
        >
          <summary>
            {t('quick.details')}
            <span className="form-details__summary">
              {' · '}
              {status === 'planned' ? t('status.planned') : t('status.realized')} · {fmt.date(date, { compact: true, today })}
              {note.trim() ? ` · ${t('quick.withNote')}` : ''}
              {(kind === 'expense' || kind === 'refund') && periodIds.length > 0 ? ` · ${tn('quick.inPeriods', periodIds.length)}` : ''}
            </span>
          </summary>
          <div className="form-details__body">
          <Segmented
            legend={t('fields.status')}
            name="status"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'realized', label: t('status.realized') },
              { value: 'planned', label: t('status.planned') },
            ]}
            hint={t(status === 'planned' ? 'movementForm.plannedHint' : 'movementForm.realizedHint')}
          />

          <TextField
            label={t('fields.date')}
            type="date"
            value={date}
            max={status === 'realized' ? today : undefined}
            onChange={(e) => setDate(e.target.value)}
            error={fieldError(t, fmt, issues, 'date')}
            required
          />

          <FieldShell label={t('fields.noteOptional')} error={fieldError(t, fmt, issues, 'note')} hint={t('movementForm.noteHint', { max: LIMITS.noteMax })}>
            {({ inputId, describedBy, invalid }) => (
              <textarea
                id={inputId}
                className="input textarea"
                value={note}
                maxLength={LIMITS.noteMax}
                rows={2}
                onChange={(e) => changeNote(e.target.value)}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
              />
            )}
          </FieldShell>

          {kind !== 'transfer' && (
            <TextField label={t('fields.merchant')} value={merchant} maxLength={LIMITS.nameMax} onChange={(e) => setMerchant(e.target.value)} hint={t('movementForm.merchantHint')} error={fieldError(t, fmt, issues, 'merchant')} />
          )}
          {existing?.receiptUri && (
            <div className="field receipt-field" data-testid="receipt-field">
              <p className="field__label">{t('movementForm.receipt')}</p>
              {keepReceipt ? <img className="receipt-thumb receipt-thumb--large" src={existing.receiptUri} alt={t('assistant.receiptAlt')} /> : <p className="note">{t('movementForm.receiptWillBeRemoved')}</p>}
              <CheckboxField checked={!keepReceipt} onChange={(v) => setKeepReceipt(!v)} label={t('movementForm.removeReceipt')} />
            </div>
          )}

          {(kind === 'expense' || kind === 'refund') && openPeriods.length > 0 && (
            <fieldset className="stack-sm">
              <legend className="field__label">{t('period.formLegend')}</legend>
              {openPeriods.map((b) => (
                <CheckboxField
                  key={b.id}
                  checked={periodChecked(b.id)}
                  onChange={(v) => setPeriodChoice((choice) => ({ ...choice, [b.id]: v }))}
                  label={`${b.name} (${fmt.date(b.startDate, { compact: true, today })} – ${fmt.date(b.endDate, { compact: true, today })})`}
                  hint={!(b.id in periodChoice) && proposedPeriods.includes(b.id) ? t('period.proposedByRule') : undefined}
                />
              ))}
              <p className="field__hint">{t('period.formHint')}</p>
            </fieldset>
          )}

          {status === 'realized' && <BalanceInclusionControl accountId={accountId} date={date} checked={alreadyInBalance} onChange={setAlreadyInBalance} />}

          </div>
        </details>

        {schedule && existing?.occurrenceDate && (
          <Alert tone="info" icon="calendar" title={t('movementForm.linkedTitle', { name: schedule.name, date: fmt.date(existing.occurrenceDate) })}>
            {t('movementForm.linkedText')}
          </Alert>
        )}

        {kind === 'expense' && data.accounts.find((a) => a.id === accountId)?.kind === 'credit' && (
          <p className="note">{t('movementForm.cardPurchaseHint')}</p>
        )}
        {kind === 'transfer' && data.accounts.find((a) => a.id === toAccountId)?.kind === 'credit' && (
          <Alert tone="info" icon="info" title={t('movementForm.cardPaymentHint')} />
        )}
        {kind === 'expense' && (
          <Alert tone="neutral" icon="info" title={t('movementForm.cardTitle')}>
            {t('movementForm.cardText')}
          </Alert>
        )}

        {similar.length > 0 && (
          <div data-testid="duplicate-warning">
            <Alert tone="warning" icon="alert" title={tn('movementForm.dupTitle', similar.length)} role="status">
              <p>{t('movementForm.dupText')}</p>
              <ul className="bullets">
                {similar.slice(0, 2).map((x) => (
                  <li key={x.id}>
                    {transactionTitle(x, data.accounts, t)} · {fmt.date(x.date, { compact: true, today })} · {fmt.money(x.amountMinor)}{' '}
                    <a href={href(withQuery(`/movimientos/editar/${x.id}`, { returnTo }))}>{t('movementForm.dupView')}</a>
                  </li>
                ))}
              </ul>
            </Alert>
          </div>
        )}
        {unknownIssues.length > 0 && (
          <Alert tone="critical" title={t('common.fixErrors')} role="alert">
            <ul>
              {unknownIssues.map((i, idx) => (
                <li key={idx}>{issueMessage(t, fmt, i)}</li>
              ))}
            </ul>
          </Alert>
        )}

        <div className="form__actions">
          <button type="submit" className="btn btn--primary btn--large" disabled={busy} aria-keyshortcuts="Control+Enter Meta+Enter">
            <Icon name="check" />
            {busy ? t('common.saving') : t('common.save')}
          </button>
          {!existing && (
            <button type="button" className="btn btn--secondary btn--large" disabled={busy} onClick={() => void submit(true)} aria-keyshortcuts="Control+Shift+Enter Meta+Shift+Enter">
              <Icon name="plus" />
              {t('quick.saveAndNew')}
            </button>
          )}
          <a className="btn btn--secondary btn--large" href={href(returnTo)}>
            {t('common.cancel')}
          </a>
          {(kind === 'expense' || kind === 'income') && (
            <button type="button" className="btn btn--ghost" onClick={() => setFavoriteOpen(true)}>
              <Icon name="star" />
              {t('favorites.saveAs')}
            </button>
          )}
          {existing && (
            <button
              type="button"
              className="btn btn--danger-ghost"
              onClick={async () => {
                const from = window.location.hash
                if (await deleteTx(existing.id)) {
                  forgetListReturn(data.budgetId)
                  navigateIfStillAt(from, returnTo)
                }
              }}
            >
              <Icon name="trash" />
              {t('common.delete')}
            </button>
          )}
        </div>
        {existing && <p className="note">{t('trash.deleteNote')}</p>}
        {existing && (
          <a className="btn btn--secondary" href={href(withQuery('/movimientos/nuevo', { duplicar: existing.id, returnTo }))}>
            <Icon name="edit" />
            {t('quick.duplicate')}
          </a>
        )}
        {existing?.kind === 'income' && existing.status === 'realized' && (
          <a className="btn btn--secondary" href={href(`/movimientos/distribuir/${existing.id}`)}>
            <Icon name="target" />
            {t('distribution.offer')}
          </a>
        )}
      </form>

      {favoriteOpen && (kind === 'expense' || kind === 'income') && (
        <FavoriteDialog
          favorite={null}
          initial={{
            name: (note.trim() || categoryLabel(t, categoryId)).slice(0, 40),
            kind,
            accountId,
            categoryId,
            amountMinor: parsedAmount.ok ? parsedAmount.minor : undefined,
            note: note.trim() || undefined,
          }}
          onClose={() => setFavoriteOpen(false)}
        />
      )}
    </div>
  )
}

const HISTORY_FIELD_KEY: Record<string, MessageKey> = {
  amountMinor: 'fields.amount',
  date: 'fields.date',
  categoryId: 'fields.category',
  accountId: 'fields.account',
  toAccountId: 'fields.toAccount',
  note: 'fields.noteOptional',
  kind: 'fields.kind',
  status: 'fields.status',
  tagIds: 'fields.tags',
  merchant: 'fields.merchant',
}

/** Historial local de cambios de este movimiento (etapa 2): honesto sobre su alcance, plegado por defecto. */
function RecordHistory({ id }: { id: string }) {
  const { t } = useT()
  const fmt = useFormat()
  const data = useData()
  const items = useMemo(() => historyOfRecord(data, 'transactions', id), [data, id])
  return (
    <details className="explain" data-testid="movement-history">
      <summary>
        <Icon name="clock" size={16} />
        {t('movementForm.historyTitle')}
      </summary>
      <p className="note">{t('movementForm.historyNote')}</p>
      {items.length === 0 ? (
        <p className="note">{t('movementForm.historyEmpty')}</p>
      ) : (
        <ul className="bullets">
          {items.map((i) => (
            <li key={i.entryId}>
              {fmt.timestamp(i.at)} ·{' '}
              {i.kind === 'created'
                ? t('movementForm.historyCreated')
                : i.kind === 'deleted'
                  ? t('movementForm.historyDeleted')
                  : t('movementForm.historyUpdated', { fields: i.fields.map((f) => (HISTORY_FIELD_KEY[f] ? t(HISTORY_FIELD_KEY[f]!) : f)).join(', ') })}
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}
