import { useEffect, useRef, useState } from 'react'
import { CategoryIcon } from '../components/CategoryIcon'
import { detectTimeZone, todayInTimeZone } from '../../domain/dates'
import { changeCurrency, updateSettings } from '../../domain/operations'
import { backupStatus, setBackupReminder } from '../../domain/backupReminder'
import type { AppData, BackupReminder, BudgetPeriodType, CurrencyCode, DateStyle, Language, NumberLocale, Weekday } from '../../domain/types'
import { BACKUP_REMINDERS, BUDGET_PERIOD_TYPES, DATE_STYLES, LANGUAGES, NUMBER_LOCALES } from '../../domain/validation'
import { formatMoney } from '../../domain/money'
import { createDemoData } from '../../demo/demoData'
import { loadLanguage, translate, useT, type MessageKey } from '../../i18n'
import { GROUP_TITLE_KEY, SETTINGS_GROUPS, SETTINGS_SECTIONS, settingsSection } from './settings/sections'
import { SearchBar } from '../components/base'
import { categoriesForKind } from '../../domain/categories'
import { localDateInTimeZone } from '../../domain/dates'
import { MAX_BACKUP_BYTES, parseBackup, performExport, type ImportIssue } from '../../storage/backup'
import { APP_VERSION, downloadText, useExportBackup, useVerifyBackup } from '../backupActions'
import { BUILD_HASH } from '../version'
import { nextFrame, ReadCancelled, readFileWithProgress } from '../readFile'
import { useRun, useToday } from '../../state/hooks'
import { getStore, useData } from '../../state/store'
import { Alert, Card, PageHeader } from '../components/common'
import { CheckboxField, Segmented, SelectField, TextField } from '../components/fields'
import { ConfirmDialog } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { href, navigate, type Route } from '../router'
import { useToast } from '../components/toastContext'
import { createFormatter, useFormat } from '../format'
import { issueMessage } from '../labels'
import { useThemePreference } from '../theme'
import { NotificationsSection } from './NotificationsSection'
import { RulesSection } from './RulesSection'
import { PersonalizeSection } from './PersonalizeSection'
import { InstallSection } from './settings/InstallSection'
import { ErrorReport } from './settings/ErrorReport'
import { FeedbackSection } from './settings/FeedbackSection'
import { IosShortcutsSection } from './settings/IosShortcutsSection'
import { AssistantSection } from './settings/AssistantSection'
import { AccountsSection } from './settings/AccountsSection'
import { BackupsSection } from './settings/BackupsSection'
import { DataCenterSection } from './settings/DataCenterSection'
import { PassphraseDialog } from './settings/PassphraseDialog'
import { useEncryptedExport } from '../useEncryptedExport'
import { DEV_MODE } from './Pro'
import { aiUsagePercent, isPro } from '../../domain/featureGate'
import { decryptBackup, isEncryptedBackup, looksEncrypted } from '../../storage/encryptedBackup'
import { monetaryRecords } from '../../domain/currencyChange'
import { CurrencyDialog } from './settings/CurrencyDialog'
import { ExportSection } from './settings/ExportSection'
import { LockSection } from './settings/LockSection'
import { SafeToSpendSection } from './settings/SafeToSpendSection'
import { ScheduledSection } from './settings/ScheduledSection'
import { TagsSection } from './settings/TagsSection'
import { useLockState } from '../lock/lockContext'
import { keepCopyBeforeReplace, localBackups } from '../useAutoBackup'
import { replaceWithUndo, type UndoReplaceResult } from '../../state/replaceUndo'
import { currencyName } from '../../domain/formatters'
import { getPeriod } from '../../domain/periods'
import { periodLabel } from '../periodLabel'
import { CategoryChip } from '../components/base'

/** Enlace de contacto solo si se configuró al compilar; sin dirección real no se muestra un botón que no funciona. */
const CONTACT_URL = typeof import.meta.env.VITE_CONTACT_URL === 'string' && /^(https?:|mailto:)/.test(import.meta.env.VITE_CONTACT_URL) ? import.meta.env.VITE_CONTACT_URL : null


const LANGUAGE_FLAGS: Record<string, string> = { es: '🇪🇸', en: '🇬🇧', pt: '🇧🇷', fr: '🇫🇷' }

const COMMON_TIME_ZONES = [
  'America/Toronto',
  'America/Vancouver',
  'America/Edmonton',
  'America/Winnipeg',
  'America/Halifax',
  'America/St_Johns',
  'America/Mexico_City',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/Madrid',
  'UTC',
]

export function Settings({ route }: { route: Route }) {
  const [theme, setTheme] = useThemePreference()
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const run = useRun()
  const toast = useToast()
  const today = useToday()
  const [importProgress, setImportProgress] = useState<{ stage: 'reading' | 'validating'; loaded: number; total: number } | null>(null)
  const importAbort = useRef<AbortController | null>(null)
  const [importState, setImportState] = useState<{ issues: ImportIssue[] } | { data: AppData; exportedAt: string | null; withoutReceipts: boolean } | null>(null)
  const [confirm, setConfirm] = useState<'resetDemo' | 'clearAll' | 'leaveDemo' | null>(null)
  const [understood, setUnderstood] = useState(false)
  const [typed, setTyped] = useState('')
  const [currencyOpen, setCurrencyOpen] = useState(false)
  const [encryptOpen, setEncryptOpen] = useState(false)
  const [decrypting, setDecrypting] = useState<{ text: string; error: string | null } | null>(null)
  const exportEncrypted = useEncryptedExport()
  const proActive = isPro(data.settings, { devMode: DEV_MODE })
  const aiPct = aiUsagePercent(data.settings, { today, devMode: DEV_MODE })
  const lock = useLockState()
  // Subpantalla pedida (`/ajustes/<id>`); `?seccion=<id>` (enlaces antiguos) redirige a ella.
  const section = settingsSection(route.segments[1])
  const legacy = settingsSection(route.query.get('seccion'))
  useEffect(() => {
    if (!route.segments[1] && legacy) navigate(legacy.href ?? `/ajustes/${legacy.id}`, { replace: true })
  }, [route.segments, legacy])
  const [search, setSearch] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const detected = detectTimeZone()
  const zones = Array.from(new Set([data.settings.timeZone, detected, ...COMMON_TIME_ZONES]))

  const setSetting = async (patch: Parameters<typeof updateSettings>[1]) => {
    const { saved } = await run((d, c) => updateSettings(d, patch, c))
    // F4: al cambiar el idioma, el aviso se traduce con el diccionario nuevo (el `t` de este
    // cierre es el del idioma anterior).
    const next = patch.language
    const say = (key: MessageKey) => (next && next !== data.settings.language ? translate(next, key) : t(key))
    if (saved && next && next !== data.settings.language) await loadLanguage(next)
    toast({ message: saved ? say('settings.saved') : say('save.error.generic'), tone: saved ? 'good' : 'critical' })
  }

  const exportData = useExportBackup()
  // Copia ligera sin fotos: no se registra como copia de seguridad, porque restaurarla las perdería.
  const exportWithoutReceipts = () => {
    const result = performExport(data, new Date(), APP_VERSION, downloadText, { withoutReceipts: true })
    toast({ message: t(result.ok ? 'backup.lightExported' : 'backup.exportFailed'), tone: result.ok ? 'info' : 'critical' })
  }
  const verifyBackup = useVerifyBackup()
  const verifyRef = useRef<HTMLInputElement>(null)
  const [verifyIssues, setVerifyIssues] = useState<ImportIssue[] | null>(null)
  const backup = backupStatus(data, today)
  // Los recibos son imágenes guardadas dentro de cada movimiento: viajan en la copia y la agrandan.
  const receipts = data.transactions.filter((tx) => tx.receiptUri)
  const receiptBytes = receipts.reduce((sum, tx) => sum + (tx.receiptUri?.length ?? 0), 0)

  const onVerifyFile = async (file: File | undefined) => {
    if (verifyRef.current) verifyRef.current.value = ''
    if (!file) return
    const r = await verifyBackup(file)
    setVerifyIssues(r.ok ? null : r.issues)
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_BACKUP_BYTES) {
      setImportState({ issues: [{ path: 'file', code: 'tooLarge' }] })
      return
    }
    const controller = new AbortController()
    importAbort.current = controller
    setImportProgress({ stage: 'reading', loaded: 0, total: file.size })
    try {
      const text = await readFileWithProgress(file, (loaded, total) => setImportProgress({ stage: 'reading', loaded, total }), controller.signal)
      setImportProgress({ stage: 'validating', loaded: file.size, total: file.size })
      await nextFrame()
      if (controller.signal.aborted) throw new ReadCancelled()
      if (looksEncrypted(text)) {
        // Copia cifrada: se pide la frase y se valida después, igual que cualquier importación.
        setDecrypting({ text, error: null })
        return
      }
      const result = parseBackup(text)
      if (controller.signal.aborted) throw new ReadCancelled()
      setImportState(result.ok ? { data: result.data, exportedAt: result.exportedAt, withoutReceipts: result.withoutReceipts } : { issues: result.issues })
    } catch (e) {
      // Cancelar: no se aplica nada; los datos siguen como estaban.
      if (e instanceof ReadCancelled) toast({ message: t('settings.backup.importCancelled'), tone: 'info' })
      else setImportState({ issues: [{ path: 'file', code: 'invalidJson' }] })
    } finally {
      importAbort.current = null
      setImportProgress(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const openEncrypted = async (passphrase: string) => {
    if (!decrypting) return
    let envelope: unknown
    try {
      envelope = JSON.parse(decrypting.text)
    } catch {
      envelope = null
    }
    if (!isEncryptedBackup(envelope)) {
      setDecrypting(null)
      setImportState({ issues: [{ path: 'file', code: 'notABackup' }] })
      return
    }
    const r = await decryptBackup(envelope, passphrase)
    if (!r.ok) {
      setDecrypting({ ...decrypting, error: t(r.reason === 'unsupported' ? 'encrypted.unsupported' : r.reason === 'invalid' ? 'encrypted.invalid' : 'encrypted.wrong') })
      return
    }
    setDecrypting(null)
    const result = parseBackup(r.json)
    setImportState(result.ok ? { data: result.data, exportedAt: result.exportedAt, withoutReceipts: result.withoutReceipts } : { issues: result.issues })
  }

  const applyImport = async () => {
    if (!importState || !('data' in importState)) return
    const next = importState.data
    setImportState(null)
    // REC-01: copia local de lo actual antes de reemplazarlo (camino de recuperación si «Deshacer» ya no es seguro).
    const copy = await keepCopyBeforeReplace(getStore().data)
    if (copy === 'failed') {
      toast({ message: t('localBackup.failed'), tone: 'critical' })
      return
    }
    const keptCopy = copy === 'kept'
    const { ok, undo } = await replaceWithUndo(next)
    toast({
      message: ok ? t('settings.backup.imported') : t('save.error.generic'),
      tone: ok ? 'good' : 'critical',
      ...(ok ? { action: { label: t('common.undo'), onClick: () => void undoReplaceToast(undo, keptCopy, 'settings.backup.importUndone') } } : {}),
    })
  }

  /** Deshacer un reemplazo solo si nada cambió después (REC-01); si no, se explica y se ofrece la copia local. */
  const undoReplaceToast = async (undo: () => Promise<UndoReplaceResult>, keptCopy: boolean, doneKey: MessageKey) => {
    const r = await undo()
    if (r === 'undone') toast({ message: t(doneKey), tone: 'good' })
    else if (r === 'stale')
      toast({
        message: t(keptCopy ? 'replace.undoStale' : 'replace.undoStaleNoCopy'),
        tone: 'critical',
        durationMs: 12_000,
        ...(keptCopy ? { action: { label: t('replace.openLocalCopies'), onClick: () => navigate('/ajustes/copias-locales') } } : {}),
      })
    else toast({ message: t('save.error.generic'), tone: 'critical' })
  }

  const resetDemo = async () => {
    const demo = createDemoData({ now: new Date(), timeZone: data.settings.timeZone, currency: 'CAD', language: data.settings.language })
    const ok = await getStore().commit(demo, { source: 'replace' })
    setConfirm(null)
    toast({ message: ok ? t('settings.demo.resetDone') : t('save.error.generic'), tone: ok ? 'good' : 'critical' })
  }

  const clearAll = async () => {
    setConfirm(null)
    // Copia local antes de borrar (operación crítica): si no se puede, igual se borra porque la persona lo confirmó dos veces.
    try {
      if (!data.isDemo) await localBackups()?.save(data, 'beforeDelete', new Date(), APP_VERSION)
    } catch {
      // Sin espacio o sin IndexedDB: la copia exportable ya se ofreció en el diálogo.
    }
    await getStore().clearAll()
  }

  // La misma regla que la operación (QA-01): saldos distintos de cero también son importes guardados. Si lo
  // único guardado es el colchón de seguridad (auditoría del PR #15, QA-02), se dice cuál es y cómo quitarlo.
  const records = monetaryRecords(data)
  const canChangeCurrency = records.length === 0
  const bufferOnly = records.length === 1 && records[0] === 'safeToSpendBuffer'
  const blockedMessage = () => (bufferOnly ? t('currency.bufferBlocks', { amount: fmt.money(data.settings.safeToSpend.bufferMinor), currency: data.settings.currency }) : t('currency.blocked'))
  const pickCurrency = async (code: CurrencyCode) => {
    setCurrencyOpen(false)
    const { result, saved } = await run((d, c) => changeCurrency(d, code, c))
    if (!result.ok) {
      toast({ message: blockedMessage(), tone: 'critical' })
      return
    }
    if (!result.unchanged) toast({ message: saved ? t('currency.changed', { code }) : t('save.error.generic'), tone: saved ? 'good' : 'critical' })
  }
  const currentPeriod = data.settings.budgetPeriod?.type && data.settings.budgetPeriod.type !== 'untilIncome' ? getPeriod(data.settings.budgetPeriod, today) : null

  const sample = createFormatter({ ...data.settings })
  const activeCategories = categoriesForKind('expense', data.categories, { prefs: data.categoryPrefs }).length + categoriesForKind('income', data.categories, { prefs: data.categoryPrefs }).length
  const rowValues: Partial<Record<string, string>> = {
    formato: `${data.settings.currency} · ${t(`settings.language.${data.settings.language}` as MessageKey)}`,
    cuentas: tn('localBackup.accounts', data.accounts.length),
    categorias: tn('settings.value.categories', activeCategories),
    etiquetas: tn('settings.value.tags', data.tags.length),
    programados: tn('settings.value.scheduled', data.schedules.filter((x) => !x.paused).length),
    copia: backup.lastExportAt ? t('settings.value.lastExport', { when: fmt.date(localDateInTimeZone(new Date(backup.lastExportAt), data.settings.timeZone), { compact: true }) }) : t('settings.value.never'),
    // El índice solo avisa cuando hay algo que revisar (copia nunca exportada o cambios sin copia); el
    // detalle vive en la sección. Sin aviso no hay subtítulo: el índice no crece (guarda C3 a 320 px).
    datos: data.isDemo ? undefined : backup.neverExported ? t('settings.value.dataCritical') : backup.hasUnbackedChanges ? t('settings.value.dataWarn') : undefined,
  }
  return (
    <div className={section ? 'stack settings-sub' : 'stack'}>
      {section ? (
        <PageHeader title={t(section.titleKey)} back={{ href: href('/ajustes'), label: t('settings.title') }} />
      ) : (
        <>
          <PageHeader title={t('settings.title')} />
          {/* Cuenta y Pro: filas compactas en lo alto (C3); el detalle vive en /cuenta y /pro. */}
          <a className="list-row list-row--link account-row" href={href('/cuenta')} data-testid="account-link">
            <CategoryIcon icon="user" />
            <span className="list-row__main">
              <span className="list-row__title">{data.profile.isGuest ? t('account.guestTitle') : (data.profile.displayName ?? data.profile.email ?? t('account.title'))}</span>
              <span className="list-row__subtitle">{t('account.open')}</span>
            </span>
            <Icon name="chevronRight" size={18} className="list-row__chevron" />
          </a>
          {!proActive && (
            <a className="list-row list-row--link pro-row" href={href('/pro')} data-testid="pro-link">
              <CategoryIcon icon="sparkles" />
              <span className="list-row__main">
                <span className="list-row__title">{t('pro.discover')}</span>
                <span className="list-row__subtitle" data-testid="ai-usage">{t('pro.aiUsagePct', { pct: aiPct })}</span>
              </span>
              <Icon name="chevronRight" size={18} className="list-row__chevron" />
            </a>
          )}

          <SearchBar value={search} onChange={setSearch} label={t('settings.search')} placeholder={t('settings.search')} clearLabel={t('common.clear')} />
          <SettingsIndex query={search} values={rowValues} />
        </>
      )}
      {section?.id === 'formato' && (
      <Card labelledBy="formato">
        <h2 id="formato" className="card__title">
          {t('settings.format.title')}
        </h2>
        <Segmented
          legend={t('settings.theme.label')}
          name="theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: t('settings.theme.system') },
            { value: 'light', label: t('settings.theme.light') },
            { value: 'dark', label: t('settings.theme.dark') },
          ]}
          hint={t('settings.theme.hint')}
        />
        <SelectField
          label={t('settings.format.number')}
          value={data.settings.numberLocale}
          onChange={(e) => void setSetting({ numberLocale: e.target.value as NumberLocale })}
          options={NUMBER_LOCALES.map((l) => ({ value: l, label: `${formatMoney(123456, data.settings.currency, l)} (${t(`settings.format.locale.${l}` as MessageKey)})` }))}
        />
        <SelectField
          label={t('settings.format.date')}
          value={data.settings.dateStyle}
          onChange={(e) => void setSetting({ dateStyle: e.target.value as DateStyle })}
          options={DATE_STYLES.map((s) => ({ value: s, label: createFormatter({ ...data.settings, dateStyle: s }).date(today) }))}
        />
        <SelectField
          label={t('settings.format.timeZone')}
          value={data.settings.timeZone}
          onChange={(e) => void setSetting({ timeZone: e.target.value })}
          options={zones.map((z) => ({ value: z, label: z === detected ? t('settings.format.detected', { zone: z }) : z }))}
          hint={t('settings.format.timeZoneHint', { today: sample.date(todayInTimeZone(data.settings.timeZone)) })}
        />
        <SelectField
          label={t('settings.period.label')}
          value={data.settings.budgetPeriod?.type ?? 'untilIncome'}
          onChange={(e) => void setSetting({ budgetPeriod: { ...(data.settings.budgetPeriod ?? { weekStartsOn: 1 }), type: e.target.value as BudgetPeriodType } })}
          options={BUDGET_PERIOD_TYPES.map((p) => ({ value: p, label: t(`period.type.${p}` as MessageKey) }))}
          hint={t('settings.period.hint')}
        />
        {data.settings.budgetPeriod?.type === 'biweek' && <p className="field__hint">{t('period.biweekHint')}</p>}
        {data.settings.budgetPeriod?.type === 'week' && (
          <SelectField
            label={t('settings.period.weekStart')}
            value={String(data.settings.budgetPeriod.weekStartsOn)}
            onChange={(e) => void setSetting({ budgetPeriod: { ...data.settings.budgetPeriod, weekStartsOn: Number(e.target.value) as Weekday } })}
            options={[1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: String(d), label: sample.weekdayShort(`2026-09-${27 + d}`) }))}
          />
        )}
        {data.settings.budgetPeriod?.type === 'custom' && (
          <>
            <TextField label={t('settings.period.customStart')} type="date" value={data.settings.budgetPeriod.customStart ?? ''} onChange={(e) => void setSetting({ budgetPeriod: { ...data.settings.budgetPeriod, customStart: e.target.value } })} />
            <TextField label={t('settings.period.customEnd')} type="date" value={data.settings.budgetPeriod.customEnd ?? ''} onChange={(e) => void setSetting({ budgetPeriod: { ...data.settings.budgetPeriod, customEnd: e.target.value } })} />
          </>
        )}
        {currentPeriod && (
          <p className="note note--box" data-testid="current-period">
            {t('settings.period.current', { label: periodLabel(t, fmt, currentPeriod), from: fmt.date(currentPeriod.start, { compact: true, today }), to: fmt.date(currentPeriod.end, { compact: true, today }) })}
          </p>
        )}
        {data.settings.budgetPeriod?.type !== 'untilIncome' && (
          <CheckboxField label={t('settings.period.carryOver')} hint={t('settings.period.carryOverHint')} checked={data.settings.carryOverBalance !== false} onChange={(v) => void setSetting({ carryOverBalance: v })} />
        )}
        <div className="field">
          <p className="field__label">{t('settings.currency.label')}</p>
          <p>
            <strong>{data.settings.currency}</strong> · {currencyName(data.settings.currency, data.settings.language)} · {sample.money(123456)}
          </p>
          <button type="button" className="btn btn--secondary btn--small" onClick={() => setCurrencyOpen(true)} data-testid="change-currency">
            <Icon name="coins" size={16} />
            {t('currency.change')}
          </button>
          <p className="field__hint" data-testid="currency-hint">{canChangeCurrency ? t('currency.canChange') : bufferOnly ? blockedMessage() : t('settings.currency.hint')}</p>
        </div>
        <fieldset className="field">
          <legend className="field__label">{t('settings.language.label')}</legend>
          <div className="chip-wrap" data-testid="language-chips">
            {LANGUAGES.map((l) => (
              <CategoryChip key={l} label={`${LANGUAGE_FLAGS[l]} ${t(`settings.language.${l}` as MessageKey)}`} icon="globe" color="sky" selected={data.settings.language === l} onClick={() => void setSetting({ language: l as Language })} />
            ))}
          </div>
          <p className="field__hint">{t('settings.language.hint')}</p>
        </fieldset>
      </Card>
      )}

      {section?.id === 'personalizar' && <PersonalizeSection />}

      {section?.id === 'instalar' && <InstallSection />}


      {section?.id === 'cuentas' && <AccountsSection />}

      {section?.id === 'reglas' && <RulesSection />}
      {section?.id === 'etiquetas' && <TagsSection />}
      {section?.id === 'programados' && <ScheduledSection />}
      {section?.id === 'safe-to-spend' && <SafeToSpendSection />}
      {section?.id === 'copias-locales' && <BackupsSection />}
      {section?.id === 'datos' && <DataCenterSection />}

      {section?.id === 'copia' && (
      <Card labelledBy="backup-title">
        <h2 id="copia" className="card__title">
          <span id="backup-title">{t('settings.backup.title')}</span>
        </h2>
        <p>{t('settings.backup.text')}</p>
        <Alert tone="neutral" icon="shield" title={t('backup.localNotBackup')} />
        <div className="backup-status" data-testid="backup-status">
          <p className="field__label">{t('backup.statusTitle')}</p>
          <ul className="bullets">
            {backup.neverExported ? (
              <li>
                <strong>{t('backup.neverExported')}</strong>
              </li>
            ) : (
              <li>
                {t('backup.lastExport', { when: fmt.timestamp(backup.lastExportAt!) })}
                <br />
                <span className="muted">{t('backup.lastExportNote')}</span>
              </li>
            )}
            <li>{backup.hasUnbackedChanges ? t('backup.unbacked') : t('backup.upToDate')}</li>
            <li>
              {backup.lastVerifiedAt
                ? t('backup.verified', { exported: backup.verifiedExportedAt ? fmt.timestamp(backup.verifiedExportedAt) : '—', when: fmt.timestamp(backup.lastVerifiedAt) })
                : t('backup.notVerified')}
              {backup.lastVerifiedAt && backup.latestExportUnverified ? ` ${t('backup.latestUnverified')}` : ''}
            </li>
            {receipts.length > 0 && (
              <li data-testid="backup-receipts">{t('backup.receipts', { count: receipts.length, size: receiptBytes >= 1048576 ? `${(receiptBytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(receiptBytes / 1024))} KB` })}</li>
            )}
            {backup.snoozedUntil && backup.snoozedUntil > today ? (
              <li>{t('backup.snoozedUntil', { date: fmt.date(backup.snoozedUntil) })}</li>
            ) : backup.dueDate && !data.isDemo ? (
              <li>{t('backup.nextDue', { date: fmt.date(backup.dueDate < today ? today : backup.dueDate) })}</li>
            ) : null}
          </ul>
        </div>
        <div className="button-row">
          <button type="button" className="btn btn--primary" onClick={() => void exportData()}>
            <Icon name="download" />
            {t('settings.backup.export')}
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => setEncryptOpen(true)}>
            <Icon name="lock" />
            {t('encrypted.export')}
          </button>
          {receipts.length > 0 && (
            <button type="button" className="btn btn--secondary" onClick={exportWithoutReceipts} aria-describedby="backup-light-hint" data-testid="export-without-receipts">
              <Icon name="download" />
              {t('backup.exportWithoutReceipts')}
            </button>
          )}
          <label className="btn btn--secondary file-button">
            <Icon name="shield" />
            {t('backup.verify')}
            <input ref={verifyRef} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void onVerifyFile(e.target.files?.[0])} data-testid="verify-file" />
          </label>
          <label className="btn btn--secondary file-button">
            <Icon name="upload" />
            {t('settings.backup.import')}
            <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} data-testid="import-file" />
          </label>
        </div>
        {receipts.length > 0 && (
          <p className="field__hint" id="backup-light-hint">
            {t('backup.lightHint')}
          </p>
        )}
        {importProgress && (
          <div className="stack-sm" role="status" data-testid="import-progress">
            <p>
              {importProgress.stage === 'reading'
                ? t('settings.backup.importReading', { pct: Math.floor((importProgress.loaded / Math.max(1, importProgress.total)) * 100), mb: (importProgress.total / 1048576).toFixed(1) })
                : t('settings.backup.importValidating')}
            </p>
            <progress max={importProgress.total || 1} value={importProgress.stage === 'reading' ? importProgress.loaded : undefined} aria-label={t('settings.backup.importProgress')} />
            <button type="button" className="btn btn--secondary btn--small" onClick={() => importAbort.current?.abort()}>
              {t('common.cancel')}
            </button>
          </div>
        )}
        <p className="note">{t('backup.verifyHint')}</p>
        {verifyIssues && (
          <Alert tone="critical" title={t('backup.verifyFailed')} role="alert">
            <ul>
              {verifyIssues.slice(0, 5).map((i, idx) => (
                <li key={idx}>{issueMessage(t, fmt, i)}</li>
              ))}
            </ul>
          </Alert>
        )}
        <SelectField
          label={t('backup.reminder')}
          value={data.backup.reminder}
          onChange={(e) => void run((d) => setBackupReminder(d, e.target.value as BackupReminder))}
          options={BACKUP_REMINDERS.map((r) => ({ value: r, label: t(`backup.reminder.${r}` as MessageKey) }))}
          hint={t('backup.reminderHint')}
        />
        <p className="note">{t('settings.backup.importNote')}</p>
        {importState && 'issues' in importState && (
          <Alert tone="critical" title={t('settings.backup.invalidTitle')} role="alert">
            <p>{t('settings.backup.invalidText')}</p>
            <ul>
              {importState.issues.slice(0, 8).map((i, idx) => (
                <li key={idx}>
                  {i.path !== 'file' ? <code>{i.path}</code> : null} {issueMessage(t, fmt, i)}
                </li>
              ))}
            </ul>
          </Alert>
        )}
      </Card>
      )}

      {section?.id === 'bloqueo' && lock && <LockSection lock={lock} />}
      {section?.id === 'exportar' && <ExportSection />}
      {section?.id === 'notificaciones' && <NotificationsSection />}
      {section?.id === 'asistente' && <AssistantSection />}

      {section?.id === 'formulas' && (
      <Card labelledBy="formulas-title">
        <h2 id="formulas" className="card__title">
          <span id="formulas-title">{t('settings.formulas.title')}</span>
        </h2>
        <ul className="bullets">
          <li>{t('settings.formulas.available')}</li>
          <li>{t('settings.formulas.period')}</li>
          <li>{t('settings.formulas.daily')}</li>
          <li>{t('settings.formulas.balance')}</li>
          <li>{t('settings.formulas.paid')}</li>
          <li>{t('settings.formulas.transfer')}</li>
          <li>{t('settings.formulas.monthEnd')}</li>
          <li>{t('settings.formulas.rounding')}</li>
        </ul>
      </Card>
      )}

      {section?.id === 'reinicio' && (
      <Card labelledBy="reinicio">
        <h2 id="reinicio" className="card__title">
          {t('settings.reset.title')}
        </h2>
        {data.isDemo ? (
          <div className="button-row">
            <button type="button" className="btn btn--secondary" onClick={() => setConfirm('resetDemo')}>
              {t('settings.demo.reset')}
            </button>
            <button type="button" className="btn btn--primary" onClick={() => setConfirm('leaveDemo')}>
              {t('shell.leaveDemo')}
            </button>
          </div>
        ) : (
          <p className="note">{t('settings.reset.noDemo')}</p>
        )}
        <button
          type="button"
          className="btn btn--danger-ghost"
          onClick={() => {
            setUnderstood(false)
            setTyped('')
            setConfirm('clearAll')
          }}
        >
          <Icon name="trash" />
          {t('settings.reset.clearAll')}
        </button>
      </Card>
      )}

      {section?.id === 'atajos' && (
      <Card labelledBy="atajos">
        <h2 id="atajos" className="card__title">
          {t('settings.shortcuts.title')}
        </h2>
        <ul className="bullets kbd-list">
          <li>
            <kbd>N</kbd> {t('settings.shortcuts.new')}
          </li>
          <li>
            <kbd>/</kbd> {t('settings.shortcuts.search')}
          </li>
          <li>
            <kbd>Ctrl</kbd> + <kbd>Enter</kbd> {t('settings.shortcuts.save')}
          </li>
          <li>
            <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Enter</kbd> {t('settings.shortcuts.saveNew')}
          </li>
        </ul>
        <p className="note">{t('settings.shortcuts.note')}</p>
      </Card>
      )}
      {section?.id === 'atajos' && <IosShortcutsSection />}

      {section?.id === 'legal' && (
      <Card labelledBy="legal-title">
        <h2 id="legal" className="card__title">
          <span id="legal-title">{t('legal.title')}</span>
        </h2>
        <p className="link-row">
          <a href={href('/legal/terminos')}>{t('legal.terms.title')}</a>
          <a href={href('/legal/privacidad')}>{t('legal.privacy.title')}</a>
        </p>
      </Card>
      )}

      {section?.id === 'acerca' && (
      <Card labelledBy="acerca">
        <h2 id="acerca" className="card__title">
          {t('settings.about.title')}
        </h2>
        <p>{t('settings.about.text', { version: APP_VERSION })}</p>
        <p className="item__meta" data-testid="about-build">{t('settings.about.build', { build: BUILD_HASH })}</p>
        {CONTACT_URL ? (
          <a className="btn btn--secondary btn--small" href={CONTACT_URL} target="_blank" rel="noreferrer">
            {t('settings.about.contact')}
          </a>
        ) : (
          <p className="note">{t('settings.about.noContact')}</p>
        )}
        <ErrorReport />
      </Card>
      )}

      {section?.id === 'comentarios' && <FeedbackSection />}

      {encryptOpen && (
        <PassphraseDialog
          mode="encrypt"
          onClose={() => setEncryptOpen(false)}
          onSubmit={async (p) => {
            if (await exportEncrypted(p)) setEncryptOpen(false)
          }}
        />
      )}
      {decrypting && <PassphraseDialog mode="decrypt" error={decrypting.error} onClose={() => setDecrypting(null)} onSubmit={openEncrypted} />}
      {currencyOpen && <CurrencyDialog current={data.settings.currency} language={data.settings.language} locale={data.settings.numberLocale} onPick={(code) => void pickCurrency(code)} onClose={() => setCurrencyOpen(false)} />}

      <ConfirmDialog
        open={!!importState && 'data' in importState}
        title={t('settings.backup.confirmTitle')}
        confirmLabel={t('settings.backup.confirm')}
        onConfirm={() => void applyImport()}
        onCancel={() => setImportState(null)}
        destructive
      >
        {importState && 'data' in importState && (
          <>
            <p>{t('settings.backup.confirmText')}</p>
            <ul className="bullets">
              {importState.exportedAt && <li>{t('settings.backup.summaryDate', { when: fmt.timestamp(importState.exportedAt) })}</li>}
              <li>{t('settings.backup.summaryCurrency', { currency: importState.data.settings.currency })}</li>
              <li>
                {t('settings.backup.summaryCounts', {
                  accounts: importState.data.accounts.length,
                  movements: importState.data.transactions.length,
                  schedules: importState.data.schedules.length,
                  goals: importState.data.goals.length,
                })}
              </li>
              {importState.data.isDemo && <li>{t('settings.backup.summaryDemo')}</li>}
              {importState.withoutReceipts && <li data-testid="import-no-receipts">{t('settings.backup.summaryNoReceipts')}</li>}
            </ul>
            <p className="note">{t('settings.backup.confirmHint')}</p>
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog open={confirm === 'resetDemo'} title={t('settings.demo.resetTitle')} confirmLabel={t('settings.demo.reset')} onConfirm={() => void resetDemo()} onCancel={() => setConfirm(null)} destructive>
        <p>{t('settings.demo.resetText')}</p>
      </ConfirmDialog>
      <ConfirmDialog open={confirm === 'leaveDemo'} title={t('shell.leaveDemoTitle')} confirmLabel={t('shell.leaveDemo')} onConfirm={() => void clearAll()} onCancel={() => setConfirm(null)}>
        <p>{t('shell.leaveDemoText')}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'clearAll'}
        title={t('settings.reset.clearTitle')}
        confirmLabel={t('settings.reset.clearConfirm')}
        onConfirm={() => void clearAll()}
        onCancel={() => setConfirm(null)}
        destructive
        confirmDisabled={!understood || typed.trim().toLocaleUpperCase() !== t('settings.reset.word').toLocaleUpperCase()}
      >
        <p>{t('settings.reset.clearText')}</p>
        <p className="note">{data.isDemo ? t('settings.reset.demoNote') : t('settings.reset.localCopyNote')}</p>
        <CheckboxField checked={understood} onChange={setUnderstood} label={t('settings.reset.understand')} />
        <TextField label={t('settings.reset.typeWord', { word: t('settings.reset.word') })} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
      </ConfirmDialog>
    </div>
  )
}

/**
 * Pedir al navegador que no borre los datos del sitio por falta de espacio
 * (`navigator.storage.persist`, ver `ui/persist.ts`). El navegador decide.
 */
/* ------------------------------------------------------------------ */
/* Índice de Ajustes: lista agrupada con búsqueda (C3)                 */
/* ------------------------------------------------------------------ */

const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()

function SettingsIndex({ query, values }: { query: string; values: Partial<Record<string, string>> }) {
  const { t } = useT()
  const q = fold(query.trim())
  const matches = (x: (typeof SETTINGS_SECTIONS)[number]) => !q || fold(`${t(x.titleKey)} ${t(`settings.keywords.${x.id}` as MessageKey)} ${values[x.id] ?? ''}`).includes(q)
  const row = (x: (typeof SETTINGS_SECTIONS)[number]) => (
    <li key={x.id}>
      <a className="list-row list-row--link settings-row" href={href(x.href ?? `/ajustes/${x.id}`)} data-testid={`settings-row-${x.id}`}>
        <span className="list-row__icon settings-row__icon" aria-hidden="true">
          <Icon name={x.icon} size={18} />
        </span>
        <span className="list-row__main">
          <span className="list-row__title">{t(x.titleKey)}</span>
          {values[x.id] && <span className="list-row__subtitle">{values[x.id]}</span>}
        </span>
        <Icon name="chevronRight" size={18} />
      </a>
    </li>
  )
  const groups = SETTINGS_GROUPS.map((g) => ({ g, items: SETTINGS_SECTIONS.filter((x) => x.group === g && matches(x)) })).filter((x) => x.items.length > 0)
  return (
    <nav className="settings-index" aria-label={t('settings.toc')}>
      {groups.length === 0 && (
        <p className="note" role="status">
          {t('settings.searchEmpty', { q: query.trim() })}
        </p>
      )}
      {groups.map(({ g, items }) => (
        <section key={g} className="settings-group" aria-labelledby={`settings-group-${g}`}>
          <h2 id={`settings-group-${g}`} className="settings-group__title">
            {t(GROUP_TITLE_KEY[g])}
          </h2>
          <ul className="settings-group__list">{items.map(row)}</ul>
        </section>
      ))}
    </nav>
  )
}
