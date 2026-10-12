import { useMemo, useState } from 'react'
import { backupStatus, SNOOZE_OPTIONS } from '../../domain/backupReminder'
import { heroFigures } from '../../domain/heroFigures'
import { FavoriteChips } from '../favoritesUi'
import { computeBudget, upcomingItems } from '../../domain/budget'
import { homePeriodAt, homeSnapshotAt, isCurrentPeriod, nextPeriod, previousPeriod } from '../../domain/homeSnapshot'
import { verificationSummary } from '../../domain/reconcile'
import { useExportBackup, useSnoozeBackup } from '../backupActions'
import { daysOfUse, readDeviceFlags, showInstallCard, showSafetyCard, useInstallMode, writeDeviceFlags } from '../install'
import { SafetyCard } from '../safetyCard'
import { cardPaymentReminders } from '../../domain/cards'
import { localDateInTimeZone } from '../../domain/dates'
import { planProgress } from '../../domain/plans'
import { goalProgress } from '../../domain/goals'
import { reminders, type PlanItem } from '../../domain/planItems'
import { setOccurrenceSkipped, updateSettings } from '../../domain/operations'
import { committedFor, safeToSpend } from '../../domain/periods'
import { periodLabel } from '../periodLabel'
import { CoachMark, CountUp } from '../components/base'
import { haptic } from '../haptics'
import { Segmented } from '../components/fields'
import { weeklyReview, weekStartOf } from '../../domain/weeklyReview'
import { inboxView } from '../../domain/inbox'
import { useT, type MessageKey } from '../../i18n'
import { useRun, useToday } from '../../state/hooks'
import { useData } from '../../state/store'
import { CompositionBar } from '../components/charts'
import { Alert, Badge, CalcRow, Card, EmptyState, Explain, Meter, ProgressArc, Why } from '../components/common'
import { Icon } from '../components/Icon'
import { useToast } from '../components/toastContext'
import { HorizonPicker, MarkPaidDialog, UpdateBalanceDialog } from '../dialogs'
import { relativeDayKey, useFormat } from '../format'
import { planItemName, planTitle } from '../labels'
import { href, withQuery } from '../router'
import { nextPrivacyLevel, usePreferences, type HomeSection, type QuickAction } from '../preferences'
import type { IconName } from '../components/Icon'

/** Secciones que siguen a la vista en la vista completa; el resto se pliega en «Más en tu Inicio». */
const PRIMARY_SECTIONS: ReadonlySet<HomeSection> = new Set<HomeSection>(['inbox', 'upcoming'])
const HINT_KEY = 'clara.hint.view'
function readHintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return true
  }
}
function writeHintSeen() {
  try {
    localStorage.setItem(HINT_KEY, '1')
  } catch {
    /* sin almacenamiento: la pista volverá a verse */
  }
}

export function Home() {
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const run = useRun()
  const toast = useToast()
  const [prefs, setPrefs] = usePreferences()
  const essential = prefs.view === 'essential'
  // Pista de una sola vez sobre la vista esencial (preferencia del dispositivo, como el tema).
  const [hintSeen, setHintSeen] = useState(() => readHintSeen())
  const dismissHint = () => {
    setHintSeen(true)
    writeHintSeen()
  }
  const liveBudget = useMemo(() => computeBudget(data, today), [data, today])
  // D1: periodo que se muestra. null = el actual (cifras vivas); otro = instantánea al cierre, solo lectura.
  const [viewStart, setViewStart] = useState<string | null>(null)
  const periodSettings = data.settings.budgetPeriod
  const viewPeriod = useMemo(() => homePeriodAt(periodSettings, viewStart ?? today, today), [periodSettings, viewStart, today])
  const viewing = viewStart !== null && !isCurrentPeriod(viewPeriod, today)
  const snapshot = useMemo(() => (viewing ? homeSnapshotAt(data, viewPeriod.end, { today }) : null), [viewing, data, viewPeriod.end, today])
  const budget = snapshot?.budget ?? liveBudget
  const canGoNext = nextPeriod(periodSettings, viewPeriod, today) !== null
  const goPrev = () => setViewStart(previousPeriod(periodSettings, viewPeriod, today).start)
  const goNext = () => {
    const next = nextPeriod(periodSettings, viewPeriod, today)
    setViewStart(next && !isCurrentPeriod(next, today) ? next.start : null)
  }
  const upcoming = useMemo(() => upcomingItems(data, today, 14).slice(0, 4), [data, today])
  const reminderItems = useMemo(() => reminders(data, today), [data, today])
  const cardReminders = useMemo(() => cardPaymentReminders(data, today), [data, today])
  const overLimits = useMemo(
    () => data.plans.filter((p) => p.status === 'active').map((p) => ({ plan: p, progress: planProgress(data, p, today) })).filter((x) => x.progress.state === 'over'),
    [data, today],
  )
  const [payItem, setPayItem] = useState<PlanItem | null>(null)
  const [balanceOpen, setBalanceOpen] = useState(false)
  const backup = useMemo(() => backupStatus(data, today), [data, today])
  const verification = useMemo(() => verificationSummary(data, today), [data, today])
  const exportBackup = useExportBackup()
  const snooze = useSnoozeBackup()
  // K2: «Instala Clara», una sola vez, tras 3 días de uso y fuera de la app instalada.
  const install = useInstallMode()
  const [installCardDismissed, setInstallCardDismissed] = useState(() => readDeviceFlags().installCardDismissed === true)
  const showInstall = showInstallCard({ mode: install.mode, daysOfUse: daysOfUse(data.createdAt, today, data.settings.timeZone), dismissed: installCardDismissed, isDemo: data.isDemo })
  const dismissInstallCard = () => {
    writeDeviceFlags({ installCardDismissed: true })
    setInstallCardDismissed(true)
  }
  // K3: «Protege tus datos», una vez por dispositivo, tras la configuración o en la app instalada.
  const [safetyAsked, setSafetyAsked] = useState(() => readDeviceFlags().safetyAsked === true)
  const showSafety = showSafetyCard({ isDemo: data.isDemo, asked: safetyAsked, daysOfUse: daysOfUse(data.createdAt, today, data.settings.timeZone), standalone: install.mode === 'installed' })
  const closeSafety = () => {
    writeDeviceFlags({ safetyAsked: true })
    setSafetyAsked(true)
  }

  const rel = (date: string) => {
    const r = relativeDayKey(date, today)
    return r.key === 'inDays' || r.key === 'daysAgo' ? tn(`relative.${r.key}`, r.days) : t(`relative.${r.key}`)
  }

  const skip = async (item: PlanItem) => {
    const { saved } = await run((d, c) => setOccurrenceSkipped(d, item.sourceId, item.date, true, c))
    toast({
      message: saved ? t('calendar.skipped', { name: planItemName(item, t) }) : t('save.error.generic'),
      tone: saved ? 'good' : 'critical',
      action: { label: t('common.undo'), onClick: () => void run((d, c) => setOccurrenceSkipped(d, item.sourceId, item.date, false, c)) },
    })
  }

  const horizonText = budget.period
    ? t(budget.period.daysLeft > 0 ? 'home.period.untilEnd' : 'home.period.ended', { label: periodLabel(t, fmt, budget.period), days: tn('home.periodDays', budget.period.daysLeft) })
    : budget.horizon
      ? budget.horizon.source === 'income'
        ? t('home.untilIncome', { date: fmt.date(budget.horizon.endDate, { weekday: true }) })
        : t('home.untilHorizon', { date: fmt.date(budget.horizon.endDate, { weekday: true }) })
      : t('home.noHorizonTitle')
  // Safe to spend (§6.3) sobre el periodo de calendario: base del periodo − comprometido hasta su fin.
  const safeSettings = data.settings.safeToSpend
  const safe = budget.period && safeSettings.showOnHome ? safeToSpend(budget.baseMinor, committedFor(safeSettings, budget.reservedTotalMinor, budget.goalsReservedMinor), budget.period.daysLeft) : null
  const granularity = data.settings.safeToSpend?.granularity ?? 'day'
  const setGranularity = (g: 'day' | 'week' | 'period') => void run((d, c) => updateSettings(d, { safeToSpend: { ...d.settings.safeToSpend, granularity: g } }, c))
  const tourSeen = (data.settings.toursSeen ?? []).includes('home')
  const [tourStep, setTourStep] = useState(0)
  const isEmpty = data.transactions.length === 0 && !data.isDemo
  const liveHero = useMemo(() => heroFigures(data, liveBudget, today), [data, liveBudget, today])
  const hero = snapshot?.hero ?? liveHero
  const endTour = () => void run((d, c) => updateSettings(d, { toursSeen: [...(d.settings.toursSeen ?? []).filter((x) => x !== 'home'), 'home'] }, c))

  const goalsForHome = data.goals.filter((g) => !g.plan?.paidAt).slice(0, 3)
  const showWeekly = data.settings.weeklyReview !== false
  const week = useMemo(() => (showWeekly ? weeklyReview(data, weekStartOf(today), today) : null), [data, today, showWeekly])
  const hideWeekly = async () => {
    const { saved } = await run((d, c) => updateSettings(d, { weeklyReview: false }, c))
    toast({
      message: saved ? t('weekly.hidden') : t('save.error.generic'),
      tone: saved ? 'good' : 'critical',
      action: { label: t('common.undo'), onClick: () => void run((d, c) => updateSettings(d, { weeklyReview: true }, c)) },
    })
  }
  const otherReminders = reminderItems.filter((i) => i.state !== 'overdue')
  const pendingCount = useMemo(() => inboxView(data, today).active.length, [data, today])

  // Avisos que no cambian la cifra principal: se agrupan debajo de ella para no saturar
  // la pantalla (el primero visible; el resto, plegado). Orden: pagos vencidos, copia de
  // seguridad (sin servidor, es la única protección contra perder datos), saldo antiguo,
  // límites y metas.
  const notices = [
    budget.overdueBills.length > 0 && {
      key: 'overdueBills',
      node: (
        <Alert
          tone="warning"
          title={tn('home.alert.overdueBills', budget.overdueBills.length)}
          actions={
            <a className="btn btn--small btn--secondary" href={href('/plan/calendario')}>
              {t('home.alert.reviewCalendar')}
            </a>
          }
        >
          <Why short={t('home.alert.overdueBillsShort')}>{t('home.alert.overdueBillsText')}</Why>
        </Alert>
      ),
    },
    (backup.due) && {
      key: 'backup',
      node: (
        <Alert
          tone="info"
          icon="shield"
          title={t('home.backup.title')}
          actions={
            <>
              <button type="button" className="btn btn--small btn--primary" onClick={() => void exportBackup()}>
                <Icon name="download" size={16} />
                {t('home.backup.export')}
              </button>
              <button type="button" className="btn btn--small btn--secondary" onClick={() => void snooze(SNOOZE_OPTIONS[1])}>
                {t('home.backup.snooze', { days: SNOOZE_OPTIONS[1] })}
              </button>
            </>
          }
        >
          {backup.neverExported ? t('home.backup.textNever') : t('home.backup.textOld', { date: fmt.date(localDateInTimeZone(new Date(backup.lastExportAt!), data.settings.timeZone)) })}
        </Alert>
      ),
    },
    showInstall && {
      key: 'install',
      node: (
        <div data-testid="install-card">
        <Alert
          tone="info"
          icon="phone"
          title={t('install.card.title')}
          actions={
            <>
              <a className="btn btn--small btn--primary" href={href('/ajustes/instalar')} onClick={dismissInstallCard}>
                {t('install.card.how')}
              </a>
              <button type="button" className="btn btn--small btn--secondary" onClick={dismissInstallCard}>
                {t('install.card.dismiss')}
              </button>
            </>
          }
        >
          {t('install.card.text')}
        </Alert>
        </div>
      ),
    },
    (budget.isBalanceStale && budget.balanceAgeDays !== null) && {
      key: 'stale',
      node: (
        <Alert
          tone="warning"
          icon="clock"
          title={tn('home.alert.staleTitle', budget.balanceAgeDays)}
          actions={
            <button type="button" className="btn btn--small btn--primary" onClick={() => setBalanceOpen(true)}>
              {t('home.updateBalance')}
            </button>
          }
        >
          {t('home.alert.staleText')}
        </Alert>
      ),
    },
    (overLimits.length > 0) && {
      key: 'limits',
      node: (
        <Alert
          tone="warning"
          title={tn('home.alert.limitOverTitle', overLimits.length)}
          actions={
            <a className="btn btn--small btn--secondary" href={href('/plan/planes')}>
              {t('home.alert.seePlans')}
            </a>
          }
        >
          {t('home.alert.limitOverText', {
            list: overLimits.map((x) => `${planTitle(t, x.plan)} (${t('plans.exceededBy', { amount: fmt.money(-x.progress.remainingMinor) })})`).join(' · '),
          })}
        </Alert>
      ),
    },
    budget.incompleteScheduleIds.length > 0 && {
      key: 'incomplete',
      node: (
        <Alert
          tone="critical"
          title={t('home.alert.incompleteTitle', { names: budget.incompleteScheduleIds.map((id) => `«${data.schedules.find((s) => s.id === id)?.name ?? id}»`).join(', ') })}
          actions={
            <a className="btn btn--small btn--secondary" href={href('/plan/calendario')}>
              {t('home.alert.reviewCalendar')}
            </a>
          }
        >
          <span data-testid="incomplete-reserves">{t('home.alert.incompleteText')}</span>
        </Alert>
      ),
    },
    (budget.goalsExceedMoney) && {
      key: 'goals',
      node: (
        <Alert tone="warning" title={t('home.alert.goalsExceedTitle')}>
          {t('home.alert.goalsExceedText')}
        </Alert>
      ),
    },
  ].filter((n): n is { key: string; node: React.JSX.Element } => !!n)

  const QUICK: Record<QuickAction, { href: string; icon: IconName; label: string }> = {
    afford: { href: '/alcanza', icon: 'cart', label: t('home.canIAfford') },
    income: { href: withQuery('/movimientos/nuevo', { kind: 'income', returnTo: '/' }), icon: 'arrowUp', label: t('quickAction.income') },
    transfer: { href: withQuery('/movimientos/nuevo', { kind: 'transfer', returnTo: '/' }), icon: 'transfer', label: t('quickAction.transfer') },
    whatChanged: { href: '/cambios', icon: 'clock', label: t('changes.title') },
    search: { href: '/buscar', icon: 'search', label: t('quickAction.search') },
    calendar: { href: '/plan/calendario', icon: 'calendar', label: t('quickAction.calendar') },
    reconcile: { href: '/conciliar', icon: 'scale', label: t('home.verify.action') },
    scenarios: { href: '/alcanza/escenarios', icon: 'trend', label: t('scenario.title') },
  }

  // Vista esencial: acceso a todo lo demás desde una sola tarjeta (nada queda inaccesible).
  const toolsCard = (
    <Card labelledBy="tools-title">
      <h2 id="tools-title" className="card__title">
        <Icon name="sliders" />
        {t('home.tools.title')}
      </h2>
      <ul className="tool-links">
        <li>
          <a href={href('/pendientes')} data-testid="inbox-link">
            {pendingCount > 0 ? tn('inbox.homeCount', pendingCount) : t('inbox.homeNone')}
          </a>
        </li>
        <li>
          <a href={href('/plan/calendario')}>{t('home.seeCalendar')}</a>
        </li>
        <li>
          <a href={href('/plan/metas')}>{t('home.seeGoals')}</a>
        </li>
        <li>
          <a href={href('/conciliar')}>{t('home.verify.action')}</a>
        </li>
        <li>
          <a href={href('/revision')}>{t('weekly.open')}</a>
        </li>
        <li>
          <a href={href('/alcanza/escenarios')}>{t('scenario.title')}</a>
        </li>
      </ul>
      <button type="button" className="btn btn--secondary" onClick={() => setPrefs((p) => ({ ...p, view: 'full' }))} data-testid="show-full-home">
        {t('home.tools.showFull')}
      </button>
    </Card>
  )

  const visibleSections = prefs.sections.filter((x) => x.visible && !(x.id === 'weekly' && !week) && !(x.id === 'reminders' && otherReminders.length === 0 && cardReminders.length === 0))
  const secondarySections = visibleSections.filter((x) => !PRIMARY_SECTIONS.has(x.id))
  const sectionNodes: Record<HomeSection, React.ReactNode> = {
    inbox: (
    <>
      {/* Acceso compacto a la bandeja de pendientes (sin llenar la pantalla de avisos) */}
      <a className="inbox-link" href={href('/pendientes')} data-testid="inbox-link">
        <Icon name={pendingCount > 0 ? 'alert' : 'checkCircle'} size={18} />
        <span>{pendingCount > 0 ? tn('inbox.homeCount', pendingCount) : t('inbox.homeNone')}</span>
        <Icon name="chevronRight" size={16} />
      </a>
    </>
  ),
    reminders: (
    <>
      {/* Recordatorios dentro de la app */}
      {(otherReminders.length > 0 || cardReminders.length > 0) && (
        <Card labelledBy="reminders-title">
          <h2 id="reminders-title" className="card__title">
            <Icon name="clock" />
            {t('home.remindersTitle')}
          </h2>
          <ul className="item-list">
            {cardReminders.map(({ account, summary }) => (
              <li key={`card-${account.id}`} className="item">
                <div className="item__main">
                  <p className="item__title">{t('card.reminderTitle')}</p>
                  <p className="item__meta">
                    {t('card.reminderItem', {
                      name: account.name,
                      date: fmt.date(summary.nextDueDate!, { compact: true, today }),
                      debt: fmt.money(summary.debtMinor),
                      min: fmt.money(summary.minPaymentMinor),
                    })}
                  </p>
                </div>
              </li>
            ))}
            {otherReminders.map((i) => (
              <li key={i.key} className="item">
                <div className="item__main">
                  <p className="item__title">{planItemName(i, t)}</p>
                  <p className="item__meta">
                    {rel(i.date)} · {fmt.date(i.date, { compact: true, today })}
                  </p>
                </div>
                <p className="item__amount">{fmt.money(i.amountMinor)}</p>
              </li>
            ))}
          </ul>
          <Why short={t('home.remindersShort')}>{t('home.remindersNote')}</Why>
        </Card>
      )}
    </>
  ),
    upcoming: (
    <>
      {/* Próximos pagos */}
      <Card labelledBy="upcoming-title">
        <h2 id="upcoming-title" className="card__title">
          <Icon name="calendar" />
          {t('home.upcomingTitle')}
        </h2>
        {upcoming.length === 0 ? (
          <EmptyState
            compact
            icon="calendar"
            title={t('home.upcomingEmpty')}
            action={
              <a className="btn btn--secondary" href={href('/plan/programado/nuevo')}>
                {t('calendar.new')}
              </a>
            }
          />
        ) : (
          <ul className="item-list">
            {upcoming.map((i) => (
              <li key={i.key} className="item">
                <div className="item__main">
                  <p className="item__title">{planItemName(i, t)}</p>
                  <p className="item__meta">
                    {fmt.date(i.date, { compact: true, today, weekday: true })} · {rel(i.date)}
                    {i.state === 'overdue' && (
                      <>
                        {' '}
                        <Badge tone="warning" icon="alert">
                          {t('state.overdue')}
                        </Badge>
                      </>
                    )}
                    {i.isEstimate && (
                      <>
                        {' '}
                        <Badge>{t('state.estimate')}</Badge>
                      </>
                    )}
                  </p>
                </div>
                <div className="item__side">
                  <p className="item__amount">
                    {i.budgetEffectMinor > 0 ? '+' : i.budgetEffectMinor < 0 ? '−' : ''}
                    {fmt.money(i.amountMinor)}
                  </p>
                  <button type="button" className="btn btn--small btn--secondary" onClick={() => setPayItem(i)}>
                    {i.direction === 'income' ? t('calendar.markReceived') : t('calendar.markPaid')}
                    <span className="sr-only">: {planItemName(i, t)}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <a className="link-more" href={href('/plan/calendario')}>
          {t('home.seeCalendar')}
          <Icon name="chevronRight" size={16} />
        </a>
      </Card>
    </>
  ),
    weekly: (
    <>
      {/* Revisión semanal (se puede ocultar en Ajustes) */}
      {week && (
        <Card labelledBy="week-title">
          <h2 id="week-title" className="card__title">
            <Icon name="calendar" />
            {t('weekly.homeTitle')}
          </h2>
          <p data-testid="week-home">
            {t('weekly.homeSpent', { amount: fmt.money(week.current.spendingMinor), income: fmt.money(week.current.incomeMinor) })}
          </p>
          <p className="note">
            {week.current.coverage !== 'complete' || week.previous.coverage !== 'complete'
              ? t('weekly.homeNoCompare')
              : t('weekly.homeCompare', { amount: fmt.money(week.previous.spendingMinor) })}
          </p>
          <div className="button-row">
            <a className="btn btn--secondary btn--small" href={href('/revision')}>
              {t('weekly.open')}
            </a>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => void hideWeekly()}>
              {t('weekly.hide')}
            </button>
          </div>
        </Card>
      )}
    </>
  ),
    freshness: (
    <>
      {/* Actualización de datos */}
      <Card className="freshness" labelledBy="freshness-title">
        <h2 id="freshness-title" className="card__title">
          <Icon name="clock" />
          {t('home.freshnessTitle')}
        </h2>
        {budget.balanceSetAt && (
          <p>
            {t('home.freshnessText', { when: fmt.timestamp(budget.balanceSetAt) })}{' '}
            {budget.balanceAgeDays !== null && <span className="muted">({tn('home.freshnessAge', budget.balanceAgeDays)})</span>}
          </p>
        )}
        <ul className="bullets" data-testid="verification">
          <li>
            {verification.lastMovementDate
              ? t('home.verify.lastMovement', { date: fmt.date(verification.lastMovementDate, { compact: true, today }) })
              : t('home.verify.noMovements')}
          </li>
          {verification.oldestVerifiedDate ? (
            <li>
              {t('home.verify.verified', {
                date: fmt.date(verification.oldestVerifiedDate, { compact: true, today }),
                age: tn('home.freshnessAge', verification.daysSinceVerified ?? 0),
              })}
            </li>
          ) : (
            <li>{tn('home.verify.unverified', verification.unverifiedAccounts.length)}</li>
          )}
          {verification.needsAttention.length > 0 && (
            <li>
              <Badge tone="warning" icon="alert">
                {tn('home.verify.attention', verification.needsAttention.length)}
              </Badge>
            </li>
          )}
        </ul>
        <Why short={t('home.freshnessShort')}>{t('home.freshnessNote')}</Why>
        <div className="button-row">
          <a className="btn btn--primary" href={href('/conciliar')}>
            <Icon name="scale" />
            {t('home.verify.action')}
          </a>
          <button type="button" className="btn btn--secondary" onClick={() => setBalanceOpen(true)}>
            {t('home.updateBalance')}
          </button>
        </div>
      </Card>
    </>
  ),
    goals: (
    <>
      {/* Metas */}
      <Card labelledBy="goals-title">
        <h2 id="goals-title" className="card__title">
          <Icon name="target" />
          {t('home.goalsTitle')}
        </h2>
        {goalsForHome.length === 0 ? (
          <EmptyState
            compact
            icon="target"
            title={t('goals.empty')}
            action={
              <a className="btn btn--secondary" href={href('/plan/metas/nueva')}>
                {t('goals.new')}
              </a>
            }
          />
        ) : (
          <ul className="goal-mini-list">
            {goalsForHome.map((g) => {
              const p = goalProgress(g)
              const valueText = t('goals.progressText', { saved: fmt.money(p.savedMinor), target: fmt.money(p.targetMinor), pct: fmt.percent(p.fraction) })
              return (
                <li key={g.id} className="goal-mini">
                  <ProgressArc fraction={p.fraction} label={g.name} valueText={valueText} text={fmt.percent(p.fraction)} complete={p.complete} />
                  <div className="goal-mini__main">
                    <span className="goal-mini__name">{g.name}</span>
                    <span className="item__meta">{valueText}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <a className="link-more" href={href('/plan/metas')}>
          {t('home.seeGoals')}
          <Icon name="chevronRight" size={16} />
        </a>
      </Card>
    </>
  ),
  }

  return (
    <div className="stack">
      {/* Sin título visible: la cabecera ya identifica la app y la cifra principal es lo primero (C1). */}
      <h1 id="page-title" className="sr-only" tabIndex={-1}>
        {t('home.title')}
      </h1>
      {prefs.privacy > 0 && (
        <p className="note note--icon" role="status">
          <Icon name="lock" size={16} /> {t('privacy.banner')}
        </p>
      )}

      {!tourSeen && !data.isDemo && tourStep < 3 && (
        <CoachMark
          step={tourStep + 1}
          total={3}
          title={t(`tour.home.${tourStep + 1}.title` as Parameters<typeof t>[0])}
          onNext={() => (tourStep === 2 ? endTour() : setTourStep(tourStep + 1))}
          onDismiss={endTour}
          nextLabel={tourStep === 2 ? t('tour.done') : t('tour.next')}
          dismissLabel={t('tour.skip')}
        >
          {t(`tour.home.${tourStep + 1}.text` as Parameters<typeof t>[0])}
        </CoachMark>
      )}
      {viewing && (
        <div className="banner banner--warning period-banner" role="status" data-testid="period-banner">
          <Icon name="alert" size={18} />
          <span className="banner__text">
            {t('home.period.viewingOther')} <span className="banner__sub">{t('home.period.snapshotNote')}</span>
          </span>
          <button type="button" className="btn btn--secondary btn--small" onClick={() => setViewStart(null)} data-testid="period-back">
            {t('home.period.backToCurrent')}
          </button>
          <button type="button" className="btn btn--ghost btn--icon" onClick={() => setViewStart(null)} aria-label={t('common.close')}>
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
      <div className="home-grid">
        <div className="stack">
          {/* Cifra principal: siempre la primera tarjeta (C1). */}
          <Card className="hero" labelledBy="hero-label">
            <div className="hero__head">
              {/* ‹ periodo ›: los pasados se ven al cierre, solo lectura; el futuro no se navega (D1). */}
              <div className="hero__period-nav">
                <button type="button" className="btn btn--ghost btn--icon hero__period-btn" onClick={goPrev} aria-label={t('home.period.prev')} data-testid="period-prev">
                  <Icon name="chevronLeft" size={18} />
                </button>
                <span className="hero__period" data-testid="period-label" aria-live="polite">
                  {/* Debajo de 480 px se ve el mes corto («Ago 2026»); el nombre completo sigue para lectores de pantalla. */}
                  <span className="hero__period-long">{periodLabel(t, fmt, viewPeriod)}</span>
                  {viewPeriod.type === 'month' && (
                    <span className="hero__period-short" aria-hidden="true">
                      {fmt.monthYearShort(viewPeriod.start)}
                    </span>
                  )}
                </span>
                <button type="button" className="btn btn--ghost btn--icon hero__period-btn" onClick={goNext} aria-label={t('home.period.next')} disabled={!canGoNext} data-testid="period-next">
                  <Icon name="chevronRight" size={18} />
                </button>
              </div>
              <span className="hero__tools">
                <a className="hero__stats" href={href('/estadisticas')} data-testid="stats-link">
                  <Icon name="chart" size={16} /> <span className="hero__stats-text">{t('stats.title')}</span>
                </a>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon hero__privacy"
                  aria-pressed={prefs.privacy > 0}
                  title={t(`privacy.levelHint.${prefs.privacy}` as MessageKey)}
                  onClick={() => {
                    haptic('tick')
                    setPrefs((p) => ({ ...p, privacy: nextPrivacyLevel(p.privacy) }))
                  }}
                  data-testid="privacy-toggle"
                  data-privacy-level={prefs.privacy}
                >
                  <Icon name="lock" />
                  <span className="sr-only">{t(`privacy.next.${prefs.privacy}` as MessageKey)}</span>
                </button>
              </span>
            </div>
            <p className="hero__label" id="hero-label">
              {budget.status === 'ok' ? t('home.availableLabel') : t('home.balanceLabel')}
            </p>
            <p className="hero__value" data-testid="available">
              <CountUp valueMinor={budget.status === 'ok' ? budget.availableMinor : budget.spendableMinor} format={(m) => fmt.money(m)} animate={!fmt.privacy} />
            </p>
            <p className="hero__sub">
              {viewing ? `${t('home.period.closedSub', { label: periodLabel(t, fmt, viewPeriod) })}${snapshot && snapshot.transactionCount === 0 ? ` ${t('home.period.noMovements')}` : ''}` : horizonText}
              {budget.horizon && !budget.period && (
                <>
                  {' · '}
                  {tn('home.periodDays', budget.horizon.days)}
                </>
              )}
            </p>
            {/* Saldo en cuentas, reservado y (si difiere) base del periodo: lo que compone la cifra, sin abrir la explicación. */}
            {budget.status === 'ok' && !viewing && (
              <p className="hero__ledger" data-testid="hero-ledger">
                <span className="hero__ledger-item">
                  <span className="hero__ledger-label">{t('home.ledger.cash')}</span> <span className="hero__ledger-value">{fmt.money(budget.spendableMinor)}</span>
                </span>
                {budget.baseMinor !== budget.spendableMinor && (
                  <span className="hero__ledger-item">
                    <span className="hero__ledger-label">{t('home.ledger.base')}</span> <span className="hero__ledger-value">{fmt.money(budget.baseMinor)}</span>
                  </span>
                )}
                <span className="hero__ledger-item">
                  <span className="hero__ledger-label">{t('home.ledger.reserved')}</span> <span className="hero__ledger-value">−{fmt.money(budget.reservedTotalMinor + budget.goalsReservedMinor)}</span>
                </span>
              </p>
            )}
            {budget.status === 'ok' && (
              <>
                <div className="hero__boxes">
                  <div className="hero__box" data-testid="period-income">
                    <span className="hero__box-label">
                      <Icon name="arrowUp" size={14} /> {t('home.hero.income')}
                    </span>
                    <span className="hero__box-value hero__box-value--income">{fmt.money(hero.incomeMinor, { sign: true })}</span>
                  </div>
                  <div className="hero__box" data-testid="period-expenses">
                    <span className="hero__box-label">
                      <Icon name="arrowDown" size={14} /> {t('home.hero.expenses')}
                    </span>
                    <span className="hero__box-value hero__box-value--expenses">{fmt.money(-hero.expensesMinor, { sign: true })}</span>
                  </div>
                </div>
                <div className="hero__pct" data-testid="available-pct">
                  <Meter fraction={hero.availablePct / 100} label={t('home.hero.availablePct', { pct: hero.availablePct })} valueText={t('home.hero.availablePct', { pct: hero.availablePct })} />
                  <span className="hero__pct-text">{t('home.hero.availablePct', { pct: hero.availablePct })}</span>
                </div>
              </>
            )}
            {budget.status === 'ok' && budget.availableMinor < 0 && (
              <Alert tone="critical" title={t('home.negativeTitle', { amount: fmt.money(-budget.availableMinor) })}>
                {t('home.negativeText')}{' '}
                <a href={href('/alcanza/faltante')}>{t('shortfall.open')}</a>
              </Alert>
            )}
            {budget.status === 'needsHorizon' && <HorizonPicker />}

            {/* Línea «por día»: una sola fila; las ayudas y el reparto del saldo viven en «¿Cómo se calculó?» (C1). */}
            {budget.status === 'ok' && safe && (
              <div className="safe safe--compact" data-testid="safe-to-spend">
                <p className="hero__daily">
                  <span className="stat__label">{granularity === 'day' ? t('home.daily') : granularity === 'week' ? t('home.weekly') : t('home.safe.period')}</span>{' '}
                  <strong className="stat__value">{fmt.money(granularity === 'day' ? safe.perDayMinor : granularity === 'week' ? safe.perWeekMinor : safe.perPeriodMinor)}</strong>
                </p>
                <Segmented
                  legend={t('home.safe.granularity')}
                  name="safe-granularity"
                  value={granularity}
                  onChange={setGranularity}
                  options={[
                    { value: 'day', label: t('home.safe.day') },
                    { value: 'week', label: t('home.safe.week') },
                    { value: 'period', label: t('home.safe.period') },
                  ]}
                />
              </div>
            )}
            {budget.status === 'ok' && !safe && budget.dailyMinor !== null && budget.weeklyMinor !== null && (
              <p className="hero__daily" data-testid="daily-line">
                <span className="stat__label">{t('home.daily')}</span> <strong className="stat__value">{fmt.money(budget.dailyMinor)}</strong>
                <span className="hero__daily-sep" aria-hidden="true">
                  {' · '}
                </span>
                <span className="stat__label">{budget.weeklyDays === 7 ? t('home.weekly') : tn('home.weeklyShort', budget.weeklyDays ?? 0)}</span>{' '}
                <strong className="stat__value">{fmt.money(budget.weeklyMinor)}</strong>
              </p>
            )}

            <div className="hero__actions">
              {/* Una sola acción secundaria («¿Me alcanza?»); registrar va por la pestaña «+» (B3). */}
              {(viewing ? [] : essential ? (['afford'] as QuickAction[]) : (['afford' as QuickAction, ...prefs.quickActions.filter((a) => a !== 'afford')] as QuickAction[])).map((a) => (
                <a key={a} className="btn btn--secondary" href={href(QUICK[a].href)}>
                  {QUICK[a].label}
                </a>
              ))}
            <Explain className="explain--inline" summaryShort={t('common.howCalculatedShort')}>
              <div className="calc">
                {budget.status === 'ok' && (
                  <CompositionBar
                    spendableMinor={budget.spendableMinor}
                    reservedMinor={budget.reservedTotalMinor}
                    goalsMinor={budget.goalsReservedMinor}
                    availableMinor={budget.availableMinor}
                    fmt={fmt}
                  />
                )}
                {safe && (
                  <p className="calc__detail">
                    {t(granularity === 'day' ? 'home.safe.perDayHint' : granularity === 'week' ? 'home.safe.perWeekHint' : 'home.safe.perPeriodHint')} {t('home.safe.committed', { amount: fmt.money(safe.committedMinor) })}
                  </p>
                )}
                {!safe && budget.dailyMinor !== null && (
                  <p className="calc__detail">
                    {t('home.dailyHint')} {t('home.weeklyHint')}
                  </p>
                )}
                {budget.periodBalance && (
                  <>
                    {budget.periodBalance.carryOver ? (
                      <CalcRow label={t('explain.period.carryOver')} value={fmt.money(budget.periodBalance.carryOverMinor)} />
                    ) : (
                      <p className="calc__detail">{t('explain.period.noCarry')}</p>
                    )}
                    <CalcRow op={budget.periodBalance.carryOver ? '+' : undefined} label={t('explain.period.income')} value={fmt.money(budget.periodBalance.incomeMinor)} />
                    <CalcRow op="−" label={t('explain.period.expenses')} value={fmt.money(budget.periodBalance.expensesMinor)} />
                    {budget.periodBalance.outsideMinor !== 0 && (
                      <CalcRow op={budget.periodBalance.outsideMinor > 0 ? '+' : '−'} label={t('explain.period.outside')} value={fmt.money(Math.abs(budget.periodBalance.outsideMinor))} />
                    )}
                    {budget.periodBalance.limitedByBalance ? (
                      <>
                        {/* QA-03: sin arrastre, la asignación del periodo supera el saldo real → la base es el saldo. */}
                        <CalcRow op="=" label={t('explain.period.net')} value={fmt.money(budget.periodBalance.poolNetMinor)} />
                        <CalcRow label={t('explain.period.liquidity')} value={fmt.money(budget.periodBalance.balanceMinor)} />
                        <CalcRow op="=" label={t('explain.period.base')} value={fmt.money(budget.baseMinor)} strong />
                        <p className="calc__detail" data-testid="limited-by-balance">{t('explain.period.limitedByBalance')}</p>
                      </>
                    ) : (
                      <CalcRow op="=" label={t('explain.period.base')} value={fmt.money(budget.baseMinor)} strong />
                    )}
                  </>
                )}
                <CalcRow label={t('explain.balance')} value={fmt.money(budget.spendableMinor)} />
                {budget.accountBalances.map((b) => (
                  <p className="calc__detail" key={b.account.id}>
                    {t('explain.accountLine', {
                      name: b.account.name,
                      anchor: fmt.money(b.anchorMinor),
                      when: fmt.timestamp(b.account.anchor.setAt),
                      applied: fmt.money(b.appliedTotalMinor, { sign: true }),
                      count: b.applied.length,
                      balance: fmt.money(b.balanceMinor),
                    })}
                    {b.account.kind === 'credit' ? ` · ${t('explain.cardDebt')}` : ''}{' '}
                    <a href={href(`/conciliar?cuenta=${b.account.id}`)}>{t('explain.verify')}</a>
                  </p>
                ))}
                <CalcRow op="−" label={tn('explain.reserved', budget.reservedItems.length)} value={fmt.money(budget.reservedTotalMinor)} />
                {budget.reservedItems.map((i) => (
                  <p className="calc__detail" key={i.key}>
                    {planItemName(i, t)} · {fmt.date(i.date, { compact: true, today })}
                    {i.state === 'overdue' ? ` · ${t('state.overdue')}` : ''} · {fmt.money(-i.budgetEffectMinor)}
                    {i.isEstimate ? ` · ${t('explain.estimate')}` : ''}
                    {budget.coveredByGoals.get(i.key) ? ` · ${t('explain.coveredByGoal', { amount: fmt.money(budget.coveredByGoals.get(i.key)!) })}` : ''}
                  </p>
                ))}
                <CalcRow op="−" label={t('explain.goals')} value={fmt.money(budget.goalsReservedMinor)} />
                {budget.goalReservations.map((g) => (
                  <p className="calc__detail" key={g.goal.id}>
                    {g.goal.name} · {fmt.money(g.amountMinor)}
                    {g.consumedMinor > 0 ? ` · ${t(g.goal.kind === 'expense' && g.goal.plan?.link ? 'explain.goalPaid' : 'explain.goalConsumed', { amount: fmt.money(g.consumedMinor) })}` : ''}
                  </p>
                ))}
                <CalcRow op="=" label={t('explain.available')} value={fmt.money(budget.availableMinor)} strong />
                {budget.horizon && budget.dailyMinor !== null && (
                  <>
                    <p className="calc__detail">
                      {t('explain.daily', {
                        available: fmt.money(Math.max(0, budget.availableMinor)),
                        days: budget.horizon.days,
                        daily: fmt.money(budget.dailyMinor),
                      })}
                    </p>
                    <p className="calc__detail">
                      {t(budget.horizon.source === 'period' ? 'explain.period.days' : budget.horizon.source === 'income' ? 'explain.incomeDayExcluded' : 'explain.fallbackHorizon', {
                        from: budget.period ? fmt.date(budget.period.start, { compact: true }) : '',
                        to: budget.period ? fmt.date(budget.period.end, { compact: true }) : '',
                        days: budget.period ? tn('home.periodDays', budget.period.daysLeft) : '',
                        date: fmt.date(budget.horizon.endDate),
                      })}
                    </p>
                  </>
                )}
                <p className="calc__detail">{t('explain.futureIncomeNotCounted')}</p>
                {budget.horizon?.source === 'income' && budget.horizon.income && (
                  <p className="calc__detail">
                    <Badge icon="calendar">{t('changes.kind.assumption')}</Badge> {t('explain.horizonAssumption', { name: planItemName(budget.horizon.income, t), date: fmt.date(budget.horizon.endDate) })}
                  </p>
                )}
                <h3 className="calc__subtitle">{t('explain.pendingTitle')}</h3>
                <ul className="bullets" data-testid="explain-pending">
                  {budget.overdueIncomes.map((i) => (
                    <li key={i.key}>{t('explain.pending.overdueIncome', { name: planItemName(i, t), date: fmt.date(i.date), amount: fmt.money(i.amountMinor) })}</li>
                  ))}
                  {budget.incomeDueToday.map((i) => (
                    <li key={i.key}>{t('explain.pending.incomeToday', { name: planItemName(i, t), amount: fmt.money(i.amountMinor) })}</li>
                  ))}
                  {budget.overdueBills.length > 0 && <li>{tn('explain.pending.overdueBills', budget.overdueBills.length)}</li>}
                  {budget.isBalanceStale && budget.balanceAgeDays !== null && <li>{tn('explain.pending.stale', budget.balanceAgeDays)}</li>}
                  {budget.overdueIncomes.length + budget.incomeDueToday.length + budget.overdueBills.length === 0 && !budget.isBalanceStale && <li>{t('explain.pending.none')}</li>}
                </ul>
                <ul className="bullets calc__glossary" aria-label={t('explain.glossary.title')}>
                  <li>{t('explain.glossary.balance')}</li>
                  <li>{t('explain.glossary.reserved')}</li>
                  <li>{t('explain.glossary.goals')}</li>
                  <li>{t('explain.glossary.card')}</li>
                </ul>
                <p className="calc__detail" data-testid="explain-pct">
                  {t('explain.hero.pct', { available: fmt.money(budget.availableMinor), start: fmt.money(hero.startBalanceMinor), income: fmt.money(hero.incomeMinor), pct: hero.availablePct })}{' '}
                  {t('home.hero.periodNote', { from: fmt.date(hero.start, { compact: true }), to: fmt.date(hero.end, { compact: true }) })}
                </p>
                <p className="link-row">
                  <a href={href('/cambios')} data-testid="what-changed-link">
                    <Icon name="clock" size={16} /> {t('changes.link')}
                  </a>
                  <a href={href('/ajustes/formulas')}>{t('explain.moreInfo')}</a>
                </p>
              </div>
            </Explain>
            </div>
          </Card>
          {viewing ? null : (
          <>
          {isEmpty && (
            <div className="first-use" data-testid="first-use">
              <Icon name="sparkles" size={18} />
              <span className="first-use__text">
                <strong>{t('home.empty.title')}</strong> {t('home.firstUse.line')}
              </span>
              <a className="btn btn--primary btn--small" href={href(withQuery('/asistente', { texto: t('assistant.exampleText'), returnTo: '/' }))} data-testid="try-assistant">
                {t('home.empty.try')}
              </a>
            </div>
          )}
          {showSafety && <SafetyCard onClose={closeSafety} />}
          {/* Ingresos sin confirmar: explican por qué no se suman a la cifra principal */}
          {budget.overdueIncomes.map((item) => (
            <Alert
              key={item.key}
              tone="warning"
              title={t('home.alert.lateIncomeTitle', { name: planItemName(item, t), date: fmt.date(item.date) })}
              actions={
                <>
                  <button type="button" className="btn btn--small btn--primary" onClick={() => setPayItem(item)}>
                    {t('home.alert.markReceived')}
                  </button>
                  {item.source === 'schedule' && (
                    <button type="button" className="btn btn--small btn--secondary" onClick={() => void skip(item)}>
                      {t('home.alert.didNotArrive')}
                    </button>
                  )}
                  <a className="btn btn--small btn--ghost" href={href(`/plan/programado/editar/${item.sourceId}`)}>
                    {t('home.alert.changeDate')}
                  </a>
                </>
              }
            >
              {t('home.alert.lateIncomeText')}
            </Alert>
          ))}
          {budget.incomeDueToday.map((item) => (
            <Alert
              key={item.key}
              tone="info"
              title={t('home.alert.incomeTodayTitle', { name: planItemName(item, t) })}
              actions={
                <button type="button" className="btn btn--small btn--primary" onClick={() => setPayItem(item)}>
                  {t('home.alert.markReceived')}
                </button>
              }
            >
              {t('home.alert.incomeTodayText')}
            </Alert>
          ))}
          {notices[0]?.node}
          {notices.length > 1 && (
            <details className="explain" data-testid="more-notices">
              <summary>
                <Icon name="alert" size={16} />
                {tn('home.moreNotices', notices.length - 1)}
              </summary>
              <div className="explain__body stack-sm">
                {notices.slice(1).map((n) => (
                  <div key={n.key}>{n.node}</div>
                ))}
              </div>
            </details>
          )}
          {/* Vista esencial: los dos próximos pagos o ingresos en una franja (la vista completa tiene la tarjeta). */}
          {essential && upcoming.length > 0 && (
            <section className="upcoming-strip" aria-labelledby="upcoming-strip-title" data-testid="upcoming-strip">
              <div className="upcoming-strip__head">
                <h2 id="upcoming-strip-title" className="upcoming-strip__title">
                  <Icon name="calendar" size={16} /> {t('home.upcomingStrip')}
                </h2>
                <a className="link-more" href={href('/plan/calendario')}>
                  {upcoming.length > 2 ? tn('home.upcomingMore', upcoming.length - 2) : t('home.seeCalendar')}
                  <Icon name="chevronRight" size={16} />
                </a>
              </div>
              <ul className="upcoming-strip__list">
                {upcoming.slice(0, 2).map((i) => (
                  <li key={i.key} className="upcoming-strip__item">
                    <span className="upcoming-strip__name">{planItemName(i, t)}</span>
                    <span className="upcoming-strip__when">
                      {i.state === 'overdue' ? (
                        <Badge tone="warning" icon="alert">
                          {t('state.overdue')}
                        </Badge>
                      ) : (
                        fmt.date(i.date, { compact: true, today, weekday: true })
                      )}
                    </span>
                    <span className="upcoming-strip__amount">
                      {i.budgetEffectMinor > 0 ? '+' : i.budgetEffectMinor < 0 ? '−' : ''}
                      {fmt.money(i.amountMinor)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {/* Favoritos: atajos para registrar; en ambas vistas, tras el primer aviso (C1). */}
          <FavoriteChips returnTo="/" limit={4} />
          {essential ? toolsCard : null}
          {essential && !hintSeen && (
            <div className="note note--box view-hint" data-testid="view-hint">
              <p>
                <strong>{t('home.viewHint.title')}</strong> {t('home.viewHint.text')}
              </p>
              <div className="button-row">
                <a className="btn btn--ghost btn--small" href={href('/ajustes?seccion=personalizar')}>
                  {t('home.viewHint.action')}
                </a>
                <button type="button" className="btn btn--ghost btn--small" onClick={dismissHint}>
                  {t('home.viewHint.dismiss')}
                </button>
              </div>
            </div>
          )}
          </>
          )}
        </div>

        {!essential && !viewing && (
          <div className="stack" data-testid="home-sections">
            {visibleSections
              .filter((x) => PRIMARY_SECTIONS.has(x.id))
              .map((x) => (
                <div key={x.id} className="home-section" data-section={x.id}>
                  {sectionNodes[x.id]}
                </div>
              ))}
            {/* Lo secundario (semana, metas, datos, recordatorios) se pliega en una sola tarjeta (C1). */}
            {secondarySections.length > 0 && (
              <details className="explain home-more" data-testid="home-more">
                <summary>
                  <Icon name="list" size={16} />
                  {t('home.more.title')} · {tn('home.more.count', secondarySections.length)}
                </summary>
                <div className="explain__body stack">
                  {secondarySections.map((x) => (
                    <div key={x.id} className="home-section" data-section={x.id}>
                      {sectionNodes[x.id]}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>

      {payItem && <MarkPaidDialog key={payItem.key} item={payItem} onClose={() => setPayItem(null)} />}
      {balanceOpen && <UpdateBalanceDialog onClose={() => setBalanceOpen(false)} />}
    </div>
  )
}
