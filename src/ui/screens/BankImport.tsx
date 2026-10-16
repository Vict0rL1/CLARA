import { SUPPORTED_CURRENCIES } from '../../domain/money'
import { activeAccounts, isBudgetAccount } from '../../domain/balances'
import { useMemo, useRef, useState } from 'react'
import { parseCsv, type BankDateFormat, type ColumnMapping, defaultSelection, guessMapping, type ImportRow, isImportable, looksLikeHeader, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, omissionSignature, possibleDateFormats, previewImport } from '../../domain/bankImport'
import { categoriesForKind } from '../../domain/categories'
import { newId } from '../../domain/ids'
import { importTransactions, removeTransactions } from '../../domain/operations'
import { matchCategoryRule, RULE_PATTERN_MAX } from '../../domain/rules'
import { merchantLabel } from '../../domain/merchants'
import type { CategoryRule } from '../../domain/types'
import type { Issue } from '../../domain/validation'
import { useT, type MessageKey } from '../../i18n'
import { useRun, useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { Alert, Badge, Card, PageHeader } from '../components/common'
import { CheckboxField, Segmented, SelectField } from '../components/fields'
import { Icon } from '../components/Icon'
import { useToast } from '../components/toastContext'
import { useFormat } from '../format'
import { accountOptions, categoryLabel, issueMessage, planItemName } from '../labels'
import { reviewProposals, type ProposalReview } from '../../domain/review'
import { href, useNavigateIfStillHere } from '../router'
import { RuleDialog } from './RulesSection'
import { CategoryPicker } from '../components/CategoryPicker'

const PAGE = 100

interface LoadedFile {
  name: string
  table: string[][]
  /** Cada archivo elegido es otro, aunque se llame igual (RT-03). */
  pick: number
}

/** Lee el archivo como UTF-8; si no lo es, como Windows-1252 (habitual en bancos). */
async function readText(file: File): Promise<string> {
  const bytes = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

export function BankImport() {
  const leave = useNavigateIfStillHere()
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [accountId, setAccountId] = useState(() => (activeAccounts(data.accounts).find(isBudgetAccount) ?? activeAccounts(data.accounts)[0] ?? data.accounts[0]!).id)
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [fileError, setFileError] = useState<MessageKey | null>(null)
  const [hasHeader, setHasHeader] = useState(true)
  const [mapping, setMapping] = useState<ColumnMapping>({ date: 0, description: 1, amount: 2 })
  const [dateFormat, setDateFormat] = useState<BankDateFormat>('ymd')
  const [invertSign, setInvertSign] = useState(false)
  const [sameDayIncluded, setSameDayIncluded] = useState(true)
  const [fileCurrency, setFileCurrency] = useState(data.settings.currency)
  const [expenseCategory, setExpenseCategory] = useState('other_expense')
  const [incomeCategory, setIncomeCategory] = useState('other_income')
  const [choices, setChoices] = useState<Map<string, boolean>>(new Map())
  // Filas que la persona decidió vincular con el pago programado que coincide (por huella).
  const [links, setLinks] = useState<Map<string, boolean>>(new Map())
  // Categoría elegida a mano en una fila (tiene prioridad sobre las reglas).
  const [rowCategories, setRowCategories] = useState<Map<string, string>>(new Map())
  const [ruleFor, setRuleFor] = useState<{ pattern: string; kind: 'expense' | 'income'; categoryId: string } | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const [issues, setIssues] = useState<Issue[]>([])
  const [busy, setBusy] = useState(false)
  // Más de MAX_IMPORT_ROWS filas: confirmar exige reconocer cuántas quedan fuera (nunca en silencio).
  // El reconocimiento es de UNA vista previa: el archivo elegido y qué filas quedan fuera (RT-03).
  const [ackedOmission, setAckedOmission] = useState<string | null>(null)
  const picks = useRef(0)
  const int = (n: number) => new Intl.NumberFormat(fmt.numberLocale).format(n)
  // Un id por fila, fijado al verla por primera vez: confirmar dos veces no duplica.
  const ids = useRef(new Map<string, string>())
  const idFor = (ref: string) => {
    let id = ids.current.get(ref)
    if (!id) ids.current.set(ref, (id = newId()))
    return id
  }

  const account = data.accounts.find((a) => a.id === accountId)

  const onFile = async (picked: File | undefined) => {
    if (fileRef.current) fileRef.current.value = ''
    if (!picked) return
    setFile(null)
    setIssues([])
    if (picked.size > MAX_IMPORT_BYTES) return setFileError('bankImport.error.tooLarge')
    const table = parseCsv(await readText(picked))
    const width = table.reduce((max, r) => Math.max(max, r.length), 0)
    if (table.length === 0 || width < 2) return setFileError('bankImport.error.notCsv')
    const header = looksLikeHeader(table[0]!)
    const guessed = header ? guessMapping(table[0]!) : null
    const nextMapping = guessed ?? { date: 0, description: Math.min(1, width - 1), amount: Math.min(2, width - 1) }
    const formats = possibleDateFormats((header ? table.slice(1) : table).map((r) => r[nextMapping.date] ?? ''))
    setFileError(null)
    setHasHeader(header)
    setMapping(nextMapping)
    setDateFormat(formats[0] ?? 'dmy')
    setInvertSign(false)
    setChoices(new Map())
    setLimit(PAGE)
    setFile({ name: picked.name, table, pick: ++picks.current })
  }

  const preview = useMemo(
    () => (file ? previewImport(file.table, data, { accountId, mapping, hasHeader, dateFormat, invertSign, locale: data.settings.numberLocale, today, fileCurrency }) : null),
    [file, data, accountId, mapping, hasHeader, dateFormat, invertSign, today, fileCurrency],
  )

  const omission = file && preview ? omissionSignature(preview) : null
  const omissionKey = omission === null ? null : `${file!.pick}|${omission}`
  const omittedAck = omissionKey !== null && ackedOmission === omissionKey

  const header = file?.table[0] ?? []
  const width = file ? file.table.reduce((max, r) => Math.max(max, r.length), 0) : 0
  const columnOptions = Array.from({ length: width }, (_, i) => ({
    value: String(i),
    label: hasHeader && header[i] ? t('bankImport.columnNamed', { n: i + 1, name: header[i] }) : t('bankImport.column', { n: i + 1 }),
  }))
  const dateValues = file ? (hasHeader ? file.table.slice(1) : file.table).map((r) => r[mapping.date] ?? '') : []
  const validFormats = possibleDateFormats(dateValues)
  const splitAmount = mapping.amount === undefined

  // Marcadas por defecto: la misma regla que `defaultSelection` (nuevas que no parecen pagos de tarjeta).
  const defaults = useMemo(() => (preview ? defaultSelection(preview) : new Set<number>()), [preview])
  const isChecked = (row: ImportRow) => isImportable(row) && (choices.get(row.importRef) ?? defaults.has(row.line))
  const selected = preview ? preview.rows.filter(isChecked) : []
  const hasSameDay = selected.some((r) => r.anchorRelation === 'sameDay')
  const selectedTotal = selected.reduce((sum, r) => sum + (r.kind === 'income' ? r.amountMinor! : -r.amountMinor!), 0)
  // Efecto real sobre el saldo antes de confirmar: solo las filas posteriores al saldo de referencia (y las del
  // mismo día si no estaban ya incluidas); las anteriores se guardan como historial y no lo cambian.
  const balanceEffect = selected.reduce(
    (acc, r) => {
      const counts = r.anchorRelation === 'after' || (r.anchorRelation === 'sameDay' && !sameDayIncluded)
      return counts ? { effectMinor: acc.effectMinor + (r.kind === 'income' ? r.amountMinor! : -r.amountMinor!), count: acc.count + 1 } : acc
    },
    { effectMinor: 0, count: 0 },
  )

  /** Categoría de una fila: la elegida a mano, si no la de una regla, si no la general. */
  const categoryFor = (row: ImportRow): { categoryId: string; rule?: CategoryRule } => {
    const kind = row.kind ?? 'expense'
    const manual = row.importRef ? rowCategories.get(row.importRef) : undefined
    if (manual) return { categoryId: manual }
    const rule = matchCategoryRule(row.description, kind, data.categoryRules, data.categories)
    if (rule) return { categoryId: rule.categoryId, rule }
    return { categoryId: kind === 'income' ? incomeCategory : expenseCategory }
  }

  const setRowCategory = (row: ImportRow, categoryId: string) => {
    if (!row.importRef) return
    setRowCategories((prev) => new Map(prev).set(row.importRef!, categoryId))
  }

  const toggle = (row: ImportRow, value: boolean) => {
    if (!row.importRef) return
    setChoices((prev) => new Map(prev).set(row.importRef!, value))
  }

  const confirm = async () => {
    if (busy || !preview || selected.length === 0 || (preview.omittedRows > 0 && !omittedAck)) return
    setBusy(true)
    const items = selected.filter(isImportable).map((r) => ({
      id: idFor(r.importRef),
      kind: r.kind,
      amountMinor: r.amountMinor,
      date: r.date,
      accountId,
      categoryId: categoryFor(r).categoryId,
      note: r.description || undefined,
      importRef: r.importRef,
      ...(links.get(r.importRef) && reviews.get(r.importRef)?.scheduleMatch
        ? { scheduleId: reviews.get(r.importRef)!.scheduleMatch!.sourceId, occurrenceDate: reviews.get(r.importRef)!.scheduleMatch!.date }
        : {}),
    }))
    const { result, saved } = await run((d, c) => importTransactions(d, { items, sameDayAlreadyInBalance: sameDayIncluded }, c))
    setBusy(false)
    if (!result.ok) {
      setIssues(result.issues)
      return
    }
    const created = result.value.ids
    toast({
      message: saved ? `${tn('bankImport.done', created.length)}${preview.omittedRows > 0 ? ` · ${tn('bankImport.omittedAfter', preview.omittedRows)}` : ''}` : t('save.error.generic'),
      tone: saved ? 'good' : 'critical',
      action: created.length ? { label: t('common.undo'), onClick: () => void run((d, c) => removeTransactions(d, created, c)) } : undefined,
    })
    if (saved) leave('/movimientos')
  }

  const rowBadges = (row: ImportRow) => {
    switch (row.status) {
      case 'error':
        return <Badge tone="critical" icon="alert">{t(`bankImport.error.row.${row.error}` as MessageKey, { found: row.currency ?? '?', expected: data.settings.currency })}</Badge>
      case 'duplicate':
        return <Badge tone="neutral" icon="check">{t('bankImport.status.duplicate')}</Badge>
      case 'possibleDuplicate':
        return <Badge tone="warning" icon="alert">{t('bankImport.status.possibleDuplicate')}</Badge>
      case 'trashed':
        return <Badge tone="neutral" icon="trash">{t('bankImport.status.trashed')}</Badge>
      case 'purged':
        return <Badge tone="warning" icon="info">{t('bankImport.status.purged')}</Badge>
      default:
        return (
          <>
            <Badge tone="good" icon="plus">{t('bankImport.status.new')}</Badge>
            {row.cardPaymentHint && <Badge tone="warning" icon="alert">{t('bankImport.status.cardPayment')}</Badge>}
          </>
        )
    }
  }
  const cardPaymentRows = preview ? preview.rows.filter((r) => r.cardPaymentHint && isImportable(r)).length : 0

  // Revisión única (etapa 2): coincidencia con pagos programados abiertos, como en el formulario y el asistente.
  const reviews = useMemo(() => {
    const map = new Map<string, ProposalReview>()
    if (!preview) return map
    const rows = preview.rows.filter(isImportable)
    const result = reviewProposals(
      data,
      rows.map((r) => ({ id: idFor(r.importRef), source: 'csv' as const, kind: r.kind, amountMinor: r.amountMinor, date: r.date, accountId, categoryId: categoryFor(r).categoryId, description: r.description })),
      today,
    )
    rows.forEach((r, i) => map.set(r.importRef, result.reviews[i]!))
    return map
    // `categoryFor` cambia con las categorías elegidas a mano; `rowCategories` es su única entrada variable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, data, accountId, today, rowCategories])

  const possibleMatch = (row: ImportRow) => {
    const match = row.matchId ? data.transactions.find((tx) => tx.id === row.matchId) : undefined
    if (!match || row.status !== 'possibleDuplicate') return null
    return t('bankImport.matchHint', { date: fmt.date(match.date, { compact: true, today }), note: match.note || categoryLabel(t, match.categoryId) })
  }

  return (
    <div className="stack">
      <PageHeader title={t('bankImport.title')} back={{ href: href('/movimientos'), label: t('nav.movements') }} />

      <Card labelledBy="import-file-title">
        <h2 id="import-file-title" className="card__title">
          {t('bankImport.step1')}
        </h2>
        <p>{t('bankImport.intro')}</p>
        <SelectField
          label={t('bankImport.account')}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          options={accountOptions(data.accounts, t)}
          hint={t('bankImport.accountHint')}
        />
        <div className="button-row">
          <label className="btn btn--primary file-button">
            <Icon name="upload" />
            {file ? t('bankImport.chooseOther') : t('bankImport.choose')}
            <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} data-testid="bank-file" />
          </label>
        </div>
        <p className="note">
          <Icon name="lock" size={14} /> {t('bankImport.privacy', { max: MAX_IMPORT_ROWS })}
        </p>
        {file && <p className="note">{t('bankImport.loaded', { name: file.name })}</p>}
        {fileError && (
          <Alert tone="critical" title={t(fileError)} role="alert">
            {t('bankImport.error.help')}
          </Alert>
        )}
      </Card>

      {file && preview && (
        <>
          <Card labelledBy="import-map-title">
            <h2 id="import-map-title" className="card__title">
              {t('bankImport.step2')}
            </h2>
            <p className="note">{t('bankImport.mapIntro')}</p>
            <CheckboxField label={t('bankImport.hasHeader')} checked={hasHeader} onChange={setHasHeader} />
            <div className="form-grid">
              <SelectField label={t('bankImport.dateColumn')} value={String(mapping.date)} onChange={(e) => setMapping({ ...mapping, date: Number(e.target.value) })} options={columnOptions} />
              <SelectField
                label={t('bankImport.descriptionColumn')}
                value={String(mapping.description)}
                onChange={(e) => setMapping({ ...mapping, description: Number(e.target.value) })}
                options={columnOptions}
              />
            </div>
            <Segmented
              legend={t('bankImport.amountMode')}
              name="amount-mode"
              value={splitAmount ? 'split' : 'single'}
              onChange={(v) =>
                setMapping({
                  date: mapping.date,
                  description: mapping.description,
                  ...(mapping.currency !== undefined ? { currency: mapping.currency } : {}),
                  ...(mapping.reference !== undefined ? { reference: mapping.reference } : {}),
                  ...(v === 'single'
                    ? { amount: mapping.debit ?? Math.min(2, width - 1) }
                    : { debit: mapping.amount ?? Math.min(2, width - 1), credit: Math.min((mapping.amount ?? 2) + 1, width - 1) }),
                })
              }
              options={[
                { value: 'single', label: t('bankImport.amountSingle') },
                { value: 'split', label: t('bankImport.amountSplit') },
              ]}
            />
            <div className="form-grid">
              {splitAmount ? (
                <>
                  <SelectField label={t('bankImport.debitColumn')} value={String(mapping.debit)} onChange={(e) => setMapping({ ...mapping, debit: Number(e.target.value) })} options={columnOptions} />
                  <SelectField label={t('bankImport.creditColumn')} value={String(mapping.credit)} onChange={(e) => setMapping({ ...mapping, credit: Number(e.target.value) })} options={columnOptions} />
                </>
              ) : (
                <SelectField
                  label={t('bankImport.amountColumn')}
                  value={String(mapping.amount)}
                  onChange={(e) => setMapping({ ...mapping, amount: Number(e.target.value) })}
                  options={columnOptions}
                  hint={t('bankImport.amountHint')}
                />
              )}
              <SelectField
                label={t('bankImport.dateFormat')}
                value={dateFormat}
                onChange={(e) => setDateFormat(e.target.value as BankDateFormat)}
                options={(['ymd', 'dmy', 'mdy'] as const).map((f) => ({ value: f, label: t(`bankImport.dateFormat.${f}` as MessageKey) }))}
                hint={validFormats.length > 1 ? t('bankImport.dateAmbiguous') : undefined}
                error={validFormats.length > 0 && !validFormats.includes(dateFormat) ? t('bankImport.dateMismatch') : null}
              />
            </div>
            <div className="form-grid">
              {/* QA-05: la moneda del archivo se declara o se lee de una columna; una distinta nunca se importa. */}
              <SelectField
                label={t('bankImport.fileCurrency')}
                value={fileCurrency}
                onChange={(e) => setFileCurrency(e.target.value)}
                options={SUPPORTED_CURRENCIES.map((c) => ({ value: c.code, label: c.code }))}
                hint={t('bankImport.fileCurrencyHint', { currency: data.settings.currency })}
              />
              <SelectField
                label={t('bankImport.currencyColumn')}
                value={mapping.currency === undefined ? '' : String(mapping.currency)}
                onChange={(e) => {
                  const { currency: _omit, ...rest } = mapping
                  setMapping(e.target.value === '' ? rest : { ...rest, currency: Number(e.target.value) })
                }}
                options={[{ value: '', label: t('bankImport.currencyColumnNone') }, ...columnOptions]}
                hint={t('bankImport.currencyColumnHint')}
              />
              {/* Referencia del banco: identidad estable de cada fila (dos movimientos iguales no se confunden). */}
              <SelectField
                label={t('bankImport.referenceColumn')}
                value={mapping.reference === undefined ? '' : String(mapping.reference)}
                onChange={(e) => {
                  const { reference: _omit, ...rest } = mapping
                  setMapping(e.target.value === '' ? rest : { ...rest, reference: Number(e.target.value) })
                }}
                options={[{ value: '', label: t('bankImport.currencyColumnNone') }, ...columnOptions]}
                hint={t('bankImport.referenceColumnHint')}
              />
            </div>
            <CheckboxField
              label={t('bankImport.invert')}
              hint={account?.kind === 'credit' ? t('bankImport.invertCardHint') : t('bankImport.invertHint')}
              checked={invertSign}
              onChange={setInvertSign}
            />
            <div className="form-grid">
              <CategoryPicker label={t('bankImport.expenseCategory')} kind="expense" data={data} value={expenseCategory} onChange={setExpenseCategory} />
              <CategoryPicker label={t('bankImport.incomeCategory')} kind="income" data={data} value={incomeCategory} onChange={setIncomeCategory} />
            </div>
            <p className="note">
              {t('bankImport.categoryNote')} <a href={href('/ajustes?seccion=reglas')}>{t('bankImport.manageRules')}</a>
            </p>
          </Card>

          <Card labelledBy="import-review-title">
            <h2 id="import-review-title" className="card__title">
              {t('bankImport.step3')}
            </h2>
            <ul className="import-counts" aria-live="polite">
              <li>
                <Badge tone="good" icon="plus">{tn('bankImport.count.new', preview.counts.new)}</Badge>
              </li>
              {preview.counts.possibleDuplicate > 0 && (
                <li>
                  <Badge tone="warning" icon="alert">{tn('bankImport.count.possibleDuplicate', preview.counts.possibleDuplicate)}</Badge>
                </li>
              )}
              {preview.counts.duplicate > 0 && (
                <li>
                  <Badge tone="neutral" icon="check">{tn('bankImport.count.duplicate', preview.counts.duplicate)}</Badge>
                </li>
              )}
              {preview.counts.trashed > 0 && (
                <li>
                  <Badge tone="neutral" icon="trash">{tn('bankImport.count.trashed', preview.counts.trashed)}</Badge>
                </li>
              )}
              {preview.counts.purged > 0 && (
                <li>
                  <Badge tone="warning" icon="info">{tn('bankImport.count.purged', preview.counts.purged)}</Badge>
                </li>
              )}
              {preview.counts.error > 0 && (
                <li>
                  <Badge tone="critical" icon="alert">{tn('bankImport.count.error', preview.counts.error)}</Badge>
                </li>
              )}
            </ul>
            {preview.omittedLines && (
              <Alert tone="critical" title={t('bankImport.tooManyRows', { total: int(preview.totalRows), max: int(MAX_IMPORT_ROWS), from: int(preview.omittedLines.from), to: int(preview.omittedLines.to), omitted: int(preview.omittedRows) })}>
                <p data-testid="import-omitted">{t('bankImport.tooManyRowsHelp')}</p>
              </Alert>
            )}
            {preview.counts.possibleDuplicate > 0 && <p className="note">{t('bankImport.possibleNote')}</p>}
            {preview.counts.duplicate > 0 && <p className="note">{t('bankImport.duplicateNote')}</p>}
            {preview.counts.trashed > 0 && (
              <p className="note">
                {t('bankImport.trashedNote')} <a href={href('/movimientos/papelera')}>{t('trash.title')}</a>
              </p>
            )}
            {preview.counts.purged > 0 && <p className="note">{t('bankImport.purgedNote')}</p>}
            {cardPaymentRows > 0 && (
              <p className="note" data-testid="import-card-payment-note">{tn('bankImport.cardPaymentNote', cardPaymentRows)}</p>
            )}
            {preview.rows.some((r) => r.error === 'currency') && (
              <p className="note" data-testid="import-currency-note">{t('bankImport.currencyNote', { count: preview.rows.filter((r) => r.error === 'currency').length, currency: data.settings.currency })}</p>
            )}
            {account && selected.some((r) => r.anchorRelation === 'before') && (
              <p className="note">{t('bankImport.beforeAnchorNote', { date: fmt.date(account.anchor.date) })}</p>
            )}

            <ul className="item-list import-rows">
              {preview.rows.slice(0, limit).map((row) => {
                const importable = isImportable(row)
                const inputId = `import-row-${row.line}`
                const matchHint = possibleMatch(row)
                const category = importable ? categoryFor(row) : null
                return (
                  <li key={row.line} className={`item import-row${importable ? '' : ' import-row--disabled'}`}>
                    <input
                      id={inputId}
                      type="checkbox"
                      className="import-row__check"
                      checked={isChecked(row)}
                      disabled={!importable}
                      onChange={(e) => toggle(row, e.target.checked)}
                      aria-describedby={`${inputId}-meta`}
                    />
                    <div className="item__main">
                      <label htmlFor={inputId} className="import-row__label">
                        <span className="item__title">{row.description || t('bankImport.noDescription')}</span>
                        <span className="item__meta" id={`${inputId}-meta`}>
                          {t('bankImport.line', { n: row.line })}
                          {row.date ? ` · ${fmt.date(row.date, { compact: true, today })}` : ''}
                          {matchHint ? ` · ${matchHint}` : ''}
                          {importable && row.anchorRelation === 'before' ? ` · ${t('bankImport.notInBalance')}` : ''}
                          {category?.rule ? ` · ${t('bankImport.byRule', { pattern: category.rule.pattern })}` : ''}
                          {importable && reviews.get(row.importRef)?.scheduleMatch
                            ? ` · ${t('bankImport.scheduleMatch', { name: planItemName(reviews.get(row.importRef)!.scheduleMatch!, t), date: fmt.date(reviews.get(row.importRef)!.scheduleMatch!.date, { compact: true, today }) })}`
                            : ''}
                        </span>
                        <span className="item__badges">{rowBadges(row)}</span>
                      </label>
                      {importable && reviews.get(row.importRef)?.scheduleMatch && (
                        <CheckboxField
                          checked={!!links.get(row.importRef)}
                          onChange={(v) => setLinks((prev) => new Map(prev).set(row.importRef!, v))}
                          label={t('bankImport.linkSchedule', { name: planItemName(reviews.get(row.importRef)!.scheduleMatch!, t) })}
                        />
                      )}
                      {importable && category && (
                        <div className="import-row__category">
                          <select
                            className="input select input--small"
                            value={category.categoryId}
                            aria-label={t('bankImport.rowCategory', { description: row.description || t('bankImport.line', { n: row.line }) })}
                            onChange={(e) => setRowCategory(row, e.target.value)}
                          >
                            {categoriesForKind(row.kind, data.categories, { prefs: data.categoryPrefs }).map((c) => (
                              <option key={c} value={c}>
                                {categoryLabel(t, c)}
                              </option>
                            ))}
                          </select>
                          {rowCategories.has(row.importRef) &&
                            row.description &&
                            matchCategoryRule(row.description, row.kind, data.categoryRules, data.categories)?.categoryId !== category.categoryId && (
                            <button
                              type="button"
                              className="btn btn--small btn--ghost"
                              onClick={() => setRuleFor({ pattern: (merchantLabel(row.description) || row.description).slice(0, RULE_PATTERN_MAX), kind: row.kind, categoryId: category.categoryId })}
                            >
                              <Icon name="plus" size={16} />
                              {t('bankImport.makeRule')}
                              <span className="sr-only">: {row.description}</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    {row.amountMinor !== undefined && (
                      <span className={`item__amount item__amount--${row.kind}`}>{fmt.money(row.kind === 'income' ? row.amountMinor : -row.amountMinor, { sign: true })}</span>
                    )}
                  </li>
                )
              })}
            </ul>
            {preview.rows.length > limit && (
              <button type="button" className="btn btn--secondary" onClick={() => setLimit(limit + PAGE)}>
                {t('movements.showMore', { count: preview.rows.length - limit })}
              </button>
            )}

            {hasSameDay && account && (
              <CheckboxField
                label={t('bankImport.sameDay', { date: fmt.date(account.anchor.date) })}
                hint={t('bankImport.sameDayHint')}
                checked={sameDayIncluded}
                onChange={setSameDayIncluded}
              />
            )}

            {issues.length > 0 && (
              <Alert tone="critical" title={t('bankImport.failed')} role="alert">
                <ul>
                  {issues.slice(0, 5).map((i, idx) => (
                    <li key={idx}>{issueMessage(t, fmt, i)}</li>
                  ))}
                </ul>
              </Alert>
            )}

            <p className="summary-line">{t('bankImport.selectedSummary', { count: selected.length, total: fmt.money(selectedTotal, { sign: true }) })}</p>
            {account && (
              <p className="note" data-testid="import-balance-effect">
                {t('bankImport.balanceEffect', { account: account.name, currency: data.settings.currency, effect: fmt.money(balanceEffect.effectMinor, { sign: true }), count: balanceEffect.count })}
              </p>
            )}
            {preview.omittedRows > 0 && (
              <CheckboxField label={tn('bankImport.omittedAck', preview.omittedRows)} checked={omittedAck} onChange={(checked) => setAckedOmission(checked ? omissionKey : null)} />
            )}
            <div className="form__actions">
              <button type="button" className="btn btn--primary btn--large" disabled={busy || selected.length === 0 || (preview.omittedRows > 0 && !omittedAck)} onClick={() => void confirm()}>
                <Icon name="check" />
                {tn('bankImport.confirm', selected.length)}
              </button>
              <a className="btn btn--secondary btn--large" href={href('/movimientos')}>
                {t('common.cancel')}
              </a>
            </div>
          </Card>
          {ruleFor && <RuleDialog rule={null} initial={ruleFor} onClose={() => setRuleFor(null)} />}
        </>
      )}
    </div>
  )
}
