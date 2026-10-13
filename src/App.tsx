import { useGlobalShortcuts } from './ui/shortcuts'
import { AddSheet } from './ui/components/AddSheet'
import { settingsSection } from './ui/screens/settings/sections'
import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Language } from './domain/types'
import { I18nContext, createTranslator, useLoadedLanguage, useT } from './i18n'
import { usePwaState } from './pwa/register'
import { getStore, useAppState, type SaveStatus } from './state/store'
import { createBackup, backupFileName } from './storage/backup'
import { APP_VERSION, downloadText } from './ui/backupActions'
import { Alert } from './ui/components/common'
import { ConfirmDialog } from './ui/components/Dialog'
import { Icon, type IconName } from './ui/components/Icon'
import { ToastProvider } from './ui/components/Toasts'
import { href, useRoute, type Route } from './ui/router'
import { useLocalNotifications } from './ui/notifications'
import { useScheduledJobs } from './ui/useScheduledJobs'
import { useAutoBackup } from './ui/useAutoBackup'
import { LockContext } from './ui/lock/lockContext'
import { LockScreen } from './ui/lock/LockScreen'
import { useLock } from './ui/lock/useLock'
import { usePrivacyLevel } from './ui/preferences'
import { ScreenSkeleton } from './ui/components/base'
import { Home } from './ui/screens/Home'
import { MovementForm } from './ui/screens/MovementForm'
import { Movements } from './ui/screens/Movements'
import { Setup } from './ui/screens/Setup'
import { logError } from './ui/errorLog'

// Pantallas secundarias: se cargan aparte (el service worker las guarda igual para usarlas sin conexión).
const Afford = lazy(() => import('./ui/screens/Afford').then((m) => ({ default: m.Afford })))
const Insights = lazy(() => import('./ui/screens/Insights').then((m) => ({ default: m.Insights })))
const Plan = lazy(() => import('./ui/screens/Plan').then((m) => ({ default: m.Plan })))
const PlanForm = lazy(() => import('./ui/screens/Plans').then((m) => ({ default: m.PlanForm })))
const PlanDetail = lazy(() => import('./ui/screens/Plans').then((m) => ({ default: m.PlanDetail })))
const Statistics = lazy(() => import('./ui/screens/Statistics').then((m) => ({ default: m.Statistics })))
const Legal = lazy(() => import('./ui/screens/Legal').then((m) => ({ default: m.Legal })))
const Account = lazy(() => import('./ui/screens/Account').then((m) => ({ default: m.Account })))
const Pro = lazy(() => import('./ui/screens/Pro').then((m) => ({ default: m.Pro })))
const ScheduleForm = lazy(() => import('./ui/screens/ScheduleForm').then((m) => ({ default: m.ScheduleForm })))
const GoalForm = lazy(() => import('./ui/screens/Goals').then((m) => ({ default: m.GoalForm })))
const Favorites = lazy(() => import('./ui/screens/Favorites').then((m) => ({ default: m.Favorites })))
const Trash = lazy(() => import('./ui/screens/Trash').then((m) => ({ default: m.Trash })))
const Settings = lazy(() => import('./ui/screens/Settings').then((m) => ({ default: m.Settings })))
const Reconcile = lazy(() => import('./ui/screens/Reconcile').then((m) => ({ default: m.Reconcile })))
const PeriodBudgetForm = lazy(() => import('./ui/screens/PeriodBudgets').then((m) => ({ default: m.PeriodBudgetForm })))
const PeriodBudgetDetail = lazy(() => import('./ui/screens/PeriodBudgets').then((m) => ({ default: m.PeriodBudgetDetail })))
const WeeklyReview = lazy(() => import('./ui/screens/WeeklyReview').then((m) => ({ default: m.WeeklyReview })))
const Scenarios = lazy(() => import('./ui/screens/Scenarios').then((m) => ({ default: m.Scenarios })))
const ScenarioForm = lazy(() => import('./ui/screens/Scenarios').then((m) => ({ default: m.ScenarioForm })))
const Search = lazy(() => import('./ui/screens/Search').then((m) => ({ default: m.Search })))
const Inbox = lazy(() => import('./ui/screens/Inbox').then((m) => ({ default: m.Inbox })))
const IncomeDistributionScreen = lazy(() => import('./ui/screens/IncomeDistribution').then((m) => ({ default: m.IncomeDistributionScreen })))
const WhatChanged = lazy(() => import('./ui/screens/WhatChanged').then((m) => ({ default: m.WhatChanged })))
const Templates = lazy(() => import('./ui/screens/Templates').then((m) => ({ default: m.Templates })))
const TemplateForm = lazy(() => import('./ui/screens/Templates').then((m) => ({ default: m.TemplateForm })))
const ShortfallPlan = lazy(() => import('./ui/screens/ShortfallPlan').then((m) => ({ default: m.ShortfallPlan })))
const History = lazy(() => import('./ui/screens/History').then((m) => ({ default: m.History })))
const BankImport = lazy(() => import('./ui/screens/BankImport').then((m) => ({ default: m.BankImport })))
const Categories = lazy(() => import('./ui/screens/Categories').then((m) => ({ default: m.Categories })))
const Assistant = lazy(() => import('./ui/screens/Assistant').then((m) => ({ default: m.Assistant })))
const Gallery = lazy(() => import('./ui/screens/Gallery').then((m) => ({ default: m.Gallery })))

/** Tareas en segundo plano con datos cargados: confirmación automática y avisos locales. */
function BackgroundJobs() {
  const state = useAppState()
  if (state.phase !== 'ready' || !state.data) return null
  return <BackgroundJobsReady />
}

function BackgroundJobsReady() {
  useScheduledJobs()
  useLocalNotifications()
  useAutoBackup()
  return null
}

export function App() {
  const state = useAppState()
  // Antes de configurar, el idioma se elige en la bienvenida; después se guarda en Ajustes.
  const [setupLanguage, setSetupLanguage] = useState<Language>('es')
  const requested = state.phase === 'ready' && state.data ? state.data.settings.language : setupLanguage
  // Los diccionarios que no son el español se cargan bajo demanda: mientras llega el pedido se muestra el anterior.
  const { language, ready: languageReady } = useLoadedLanguage(requested)
  // Primera apertura en otro idioma: se espera al diccionario para no mostrar la app en español un instante.
  const waitingLanguage = state.phase === 'ready' && !!state.data && !languageReady && language === 'es' && requested !== 'es'
  const categories = state.phase === 'ready' && state.data ? state.data.categories : undefined
  const categoryPrefs = state.phase === 'ready' && state.data ? state.data.categoryPrefs : undefined
  // Nombres de categorías personalizadas y nombres propios dados a las del sistema (categoryPrefs).
  const translator = useMemo(
    () =>
      createTranslator(language, {
        ...Object.fromEntries(Object.entries(categoryPrefs ?? {}).filter(([, p]) => p.name).map(([id, p]) => [`category.${id}`, p.name!])),
        ...Object.fromEntries((categories ?? []).map((c) => [`category.${c.id}`, c.name])),
      }),
    [language, categories, categoryPrefs],
  )

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  return (
    <I18nContext.Provider value={translator}>
      <ToastProvider>
        <UpdateBanner />
        <BackgroundJobs />
        {(state.phase === 'loading' || waitingLanguage) && <Loading />}
        {state.phase === 'corrupt' && <Corrupt raw={state.raw} newerVersion={state.issues.some((i) => i.code === 'schemaTooNew')} />}
        {state.phase === 'ready' && !state.data && (
          <>
            {state.storage === 'memory' && <MemoryWarning />}
            <Setup language={setupLanguage} onLanguageChange={setSetupLanguage} />
          </>
        )}
        {state.phase === 'ready' && state.data && !waitingLanguage && <LockedShell />}
      </ToastProvider>
    </I18nContext.Provider>
  )
}

/** Pantallas con un formulario que se perdería al recargar. */
const FORM_SEGMENTS = new Set(['nuevo', 'nueva', 'editar', 'importar', 'distribuir', 'asistente'])
function isFormRoute(route: Route): boolean {
  return route.segments[0] === 'conciliar' || route.segments.some((s) => FORM_SEGMENTS.has(s))
}

/**
 * Aviso real de versión nueva (solo aparece si el service worker instaló una). Actualizar
 * recarga la app, así que el botón no se ofrece con cambios sin guardar, con un formulario
 * abierto ni durante la configuración inicial: se explica qué hacer antes.
 */
function UpdateBanner() {
  const { t } = useT()
  const { update, reloadNeeded } = usePwaState()
  const state = useAppState()
  const route = useRoute()
  if (!update && !reloadNeeded) return null
  const unsaved = state.phase === 'ready' && state.unsaved
  const busy = state.phase === 'ready' && (!state.data || isFormRoute(route))
  const text = reloadNeeded ? 'shell.updateOtherTab' : unsaved ? 'shell.updateBlocked' : busy ? 'shell.updateAfterForm' : 'shell.updateText'
  return (
    <div className="banner banner--info" role="status" data-testid="update-banner">
      <Icon name="info" size={18} />
      <span>{t(text)}</span>
      {!unsaved && !busy && (
        <button type="button" className="btn btn--small btn--inverse" onClick={() => (update ? update() : window.location.reload())}>
          {t(reloadNeeded ? 'shell.updateReload' : 'shell.updateAction')}
        </button>
      )}
    </div>
  )
}

function Loading() {
  const { t } = useT()
  return (
    <main className="center-screen" id="main" aria-busy="true">
      <div className="spinner" aria-hidden="true" />
      <p role="status">{t('shell.loading')}</p>
    </main>
  )
}

/**
 * Los datos guardados no se pueden leer. Nunca se reemplazan sin preguntar: primero se
 * ofrece descargarlos y empezar de nuevo pide confirmación (y guarda una copia interna).
 * Si los guardó una versión más nueva de Clara, no están dañados: solo se ofrece recargar y
 * descargar una copia; nunca «Empezar de nuevo» (H4).
 */
function Corrupt({ raw, newerVersion }: { raw: string; newerVersion: boolean }) {
  const { t } = useT()
  const { update } = usePwaState()
  const [confirming, setConfirming] = useState(false)
  const downloadRaw = () => downloadText(newerVersion ? 'clara-datos-version-nueva.json' : 'clara-datos-danados.json', raw)
  return (
    <main className="center-screen" id="main">
      <div className="card setup__card">
        <Alert tone="critical" title={t(newerVersion ? 'shell.newerTitle' : 'shell.corruptTitle')} role="alert">
          <p>{t(newerVersion ? 'shell.newerText' : 'shell.corruptText')}</p>
          {newerVersion && <p>{t('shell.newerHint')}</p>}
        </Alert>
        <div className="form__actions form__actions--stack">
          {newerVersion && (
            <button type="button" className="btn btn--primary" onClick={() => (update ? update() : window.location.reload())}>
              {t('shell.newerReload')}
            </button>
          )}
          <button type="button" className="btn btn--secondary" onClick={downloadRaw}>
            <Icon name="download" />
            {t(newerVersion ? 'shell.newerDownload' : 'shell.corruptDownload')}
          </button>
          {/* H4: con datos de una versión más nueva no hay nada roto; «Empezar de nuevo» solo para datos dañados. */}
          {!newerVersion && (
            <button type="button" className="btn btn--danger-ghost" onClick={() => setConfirming(true)}>
              {t('shell.corruptReset')}
            </button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        title={t('shell.corruptConfirmTitle')}
        confirmLabel={t('shell.corruptReset')}
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => void getStore().discardCorrupt()}
      >
        <p>{t('shell.corruptConfirmText')}</p>
      </ConfirmDialog>
    </main>
  )
}

function MemoryWarning() {
  const { t } = useT()
  return (
    <div className="banner banner--critical" role="alert">
      <Icon name="alert" size={18} />
      <span>
        <strong>{t('shell.memoryTitle')}</strong> {t('shell.memoryText')}
      </span>
    </div>
  )
}

/** Iniciales (1–2 letras) de un nombre o correo; null si no hay de dónde sacarlas. */
function initials(name: string | undefined): string | null {
  const words = (name ?? '').replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean)
  if (words.length === 0) return null
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toLocaleUpperCase())
    .join('')
}

type NavKey = 'nav.home' | 'nav.movements' | 'nav.add' | 'nav.plan' | 'nav.insights' | 'nav.settings'
// Rutas que cuentan como «Análisis» (etapa 4): el destino agrupa estadísticas, revisión semanal y ¿qué cambió?
const INSIGHTS_TOPS = new Set(['analisis', 'estadisticas', 'revision', 'cambios'])
const NAV: { path: string; match: string; key: NavKey; icon: IconName; add?: boolean }[] = [
  { path: '/', match: '', key: 'nav.home', icon: 'home' },
  { path: '/movimientos', match: 'movimientos', key: 'nav.movements', icon: 'list' },
  // Registrar es la acción más frecuente: siempre a un toque desde la barra (celular) o el lateral
  // (escritorio), sin botón flotante que tape contenido. Abre la hoja «¿Qué quieres registrar?».
  { path: '/movimientos/nuevo', match: '', key: 'nav.add', icon: 'plus', add: true },
  // «/plan» abre la última pestaña visitada (Planes la primera vez).
  { path: '/plan', match: 'plan', key: 'nav.plan', icon: 'calendar' },
  { path: '/analisis', match: 'analisis', key: 'nav.insights', icon: 'chart' },
  { path: '/ajustes', match: 'ajustes', key: 'nav.settings', icon: 'sliders' },
]

function SaveIndicator({ save }: { save: SaveStatus }) {
  const { t } = useT()
  // «Guardado» se ve 2,5 s y luego se oculta (sigue en el DOM para lectores de pantalla);
  // los errores no se desvanecen nunca.
  const [quietFor, setQuietFor] = useState<SaveStatus | null>(null)
  useEffect(() => {
    if (save.state !== 'saved') return
    const id = window.setTimeout(() => setQuietFor(save), 2500)
    return () => window.clearTimeout(id)
  }, [save])
  const quiet = save.state === 'saved' && quietFor === save
  let content: React.ReactNode = null
  // En pantallas estrechas «Guardando…» y «Guardado» se muestran solo con icono (el texto
  // sigue para lectores de pantalla) para que la barra superior no ocupe dos filas.
  // Los errores siempre muestran su texto.
  if (save.state === 'saving')
    content = (
      <>
        <Icon name="clock" size={16} />
        <span className="save-indicator__text">{t('save.saving')}</span>
      </>
    )
  if (save.state === 'saved')
    content = (
      <>
        <Icon name="check" size={16} />
        <span className="save-indicator__text">{t('save.saved')}</span>
      </>
    )
  if (save.state === 'error')
    content = (
      <>
        <Icon name="alert" size={16} />
        {t(save.error === 'quota' ? 'save.error.quota' : save.error === 'unavailable' ? 'save.error.unavailable' : save.error === 'conflict' ? 'save.error.conflict' : 'save.error.notSaved')}
      </>
    )
  return (
    <span className={`save-indicator save-indicator--${save.state}${quiet ? ' save-indicator--quiet' : ''}`} role="status" aria-live="polite">
      {content}
    </span>
  )
}

/**
 * El último guardado falló: lo almacenado sigue siendo el último estado guardado y lo que se
 * ve incluye cambios que se perderían al cerrar. Se explica el motivo y se ofrecen salidas
 * (descargar una copia, reintentar o cargar lo guardado), sin decidir por la persona.
 */
function SaveProblemBanner({ error }: { error: string }) {
  const { t } = useT()
  const [busy, setBusy] = useState(false)
  const conflict = error === 'conflict'
  const download = () => {
    const data = getStore().data
    if (!data) return
    const now = new Date()
    downloadText(backupFileName(now, data.isDemo), JSON.stringify(createBackup(data, now, APP_VERSION), null, 2))
  }
  const reason = error === 'quota' ? 'quota' : error === 'unavailable' ? 'unavailable' : conflict ? 'conflict' : 'unknown'
  return (
    <div className="banner banner--critical banner--stack" role="alert" data-testid="save-problem">
      <Icon name="alert" size={18} />
      <div className="stack-sm">
        <p>
          <strong>{t('save.problem.title')}</strong> {t(`save.problem.${reason}` as 'save.problem.quota')}
        </p>
        <div className="button-row">
          <button type="button" className="btn btn--small btn--inverse" onClick={download}>
            <Icon name="download" size={16} />
            {t('save.problem.download')}
          </button>
          {conflict ? (
            <button type="button" className="btn btn--small btn--inverse" onClick={() => void getStore().reload()}>
              {t('save.problem.loadSaved')}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--small btn--inverse"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await getStore().retrySave()
                setBusy(false)
              }}
            >
              {t('save.problem.retry')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Con PIN configurado en este dispositivo, la app se muestra solo tras desbloquear (§7.7). */
function LockedShell() {
  const lock = useLock()
  return <LockContext.Provider value={lock}>{lock.locked && lock.config ? <LockScreen config={lock.config} onUnlock={lock.unlock} /> : <Shell />}</LockContext.Provider>
}

function Shell() {
  const { t } = useT()
  const state = useAppState()
  const unsaved = state.phase === 'ready' && state.unsaved

  // Con cambios sin guardar, el navegador pregunta antes de cerrar o recargar la pestaña.
  useEffect(() => {
    if (!unsaved) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])
  const route = useRoute()
  useGlobalShortcuts(state.phase === 'ready' && !!state.data)
  // Modo discreto (nivel 2 de privacidad): difumina descripciones en listas vía una clase en <html>.
  const privacyLevel = usePrivacyLevel()
  useEffect(() => {
    document.documentElement.classList.toggle('is-discreet', privacyLevel === 2)
    return () => document.documentElement.classList.remove('is-discreet')
  }, [privacyLevel])
  const mainRef = useRef<HTMLElement>(null)
  const first = useRef(true)

  // Al cambiar de pantalla: foco al título (lectores de pantalla) y scroll arriba o a la sección pedida.
  useEffect(() => {
    if (first.current) {
      // Primera carga (o recién terminada la configuración): empezar arriba, sin mover el foco.
      first.current = false
      window.scrollTo({ top: 0 })
      return
    }
    const section = route.query.get('seccion')
    let frame = 0
    let tries = 0
    const settle = () => {
      // Ids antiguos de Ajustes (p. ej. «reset-title» en un marcador) siguen llegando a su sección.
      const target = section ? document.getElementById(settingsSection(section)?.id ?? section) : null
      if (target) {
        target.scrollIntoView()
        return
      }
      // Las pantallas que se cargan aparte pueden tardar unos instantes en aparecer.
      if (section && tries++ < 60) {
        frame = requestAnimationFrame(settle)
        return
      }
      const title = document.getElementById('page-title')
      if (!title && tries++ < 60) {
        frame = requestAnimationFrame(settle)
        return
      }
      window.scrollTo({ top: 0 })
      // Si la pantalla ya enfocó un campo (autoFocus), se respeta; si no, el foco va al título.
      const active = document.activeElement
      if (active instanceof HTMLElement && active.matches('input, select, textarea') && mainRef.current?.contains(active)) return
      title?.focus({ preventScroll: true })
    }
    frame = requestAnimationFrame(settle)
    return () => cancelAnimationFrame(frame)
  }, [route.path, route.query])

  // Hoja «¿Qué quieres registrar?» (única entrada para registrar). Se guarda la ruta en la que se
  // abrió: al cambiar de pantalla (p. ej. al elegir «Gasto») deja de estar abierta sin un efecto.
  const [addOpenAt, setAddOpenAt] = useState<string | null>(null)
  const addOpen = addOpenAt === route.path
  const setAddOpen = (open: boolean) => setAddOpenAt(open ? route.path : null)

  if (state.phase !== 'ready' || !state.data) return null
  const data = state.data
  const top = route.segments[0] ?? ''
  const adding = route.segments[0] === 'movimientos' && route.segments[1] === 'nuevo'

  return (
    <div className="shell">
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault()
          mainRef.current?.focus()
        }}
      >
        {t('shell.skip')}
      </a>
      {state.storage === 'memory' && <MemoryWarning />}
      {data.isDemo && (
        <div className="banner banner--demo" role="note">
          <Icon name="info" size={18} />
          <span className="banner__text">
            <strong>{t('shell.demoShort')}</strong> <span className="banner__extra">{t('shell.demoText')}</span>
          </span>
          <a className="btn btn--small btn--inverse banner__action" href={href('/ajustes?seccion=reinicio')}>
            {t('shell.leaveDemoShort')}
          </a>
        </div>
      )}
      {state.unsaved && <SaveProblemBanner error={state.save.state === 'error' ? state.save.error : 'unknown'} />}
      {state.externalChange && !state.unsaved && (
        <div className="banner banner--info" role="status">
          <Icon name="info" size={18} />
          <span>{t('shell.externalChange')}</span>
          <button type="button" className="btn btn--small btn--inverse" onClick={() => void getStore().reload()}>
            {t('shell.reload')}
          </button>
        </div>
      )}
      <header className="topbar">
        <a className="brand" href={href('/')}>
          <span className="brand__mark" aria-hidden="true">
            C
          </span>
          <span className="brand__name">Clara</span>
        </a>
        <SaveIndicator save={state.save} />
        <a className={`btn btn--ghost btn--icon topbar__search${top === 'buscar' ? ' is-active' : ''}`} href={href('/buscar')} aria-current={top === 'buscar' ? 'page' : undefined}>
          <Icon name="search" />
          <span className="sr-only">{t('search.title')}</span>
        </a>
        {/* Avatar → cuenta (C4/D3): iniciales si hay nombre; punto verde = invitado. */}
        <a className={`avatar${top === 'cuenta' ? ' is-active' : ''}`} href={href('/cuenta')} aria-label={data.profile.isGuest ? t('account.avatarGuest') : t('account.avatarNamed', { name: data.profile.displayName ?? data.profile.email ?? '' })} aria-current={top === 'cuenta' ? 'page' : undefined} data-testid="avatar">
          <span className="avatar__face" aria-hidden="true">
            {initials(data.profile.displayName ?? data.profile.email) ?? <Icon name="user" size={18} />}
          </span>
          {data.profile.isGuest && <span className="avatar__dot" aria-hidden="true" />}
        </a>
      </header>
      <div className="shell__body">
        <nav className="nav" aria-label={t('nav.aria')}>
          {NAV.map((item) => {
            const adding = route.segments[0] === 'movimientos' && route.segments[1] === 'nuevo'
            const active = item.add
              ? adding
              : !adding && (item.match === top || (item.match === 'analisis' && INSIGHTS_TOPS.has(top)) || (item.match === '' && (top === '' || top === 'alcanza' || top === 'pendientes')))
            const inner = (
              <>
                <span className="nav__icon">
                  <Icon name={item.icon} size={22} />
                </span>
                <span className="nav__label">{t(item.key)}</span>
              </>
            )
            if (item.add) {
              return (
                <button
                  key={item.path}
                  type="button"
                  className={`nav__item nav__item--add${active ? ' is-active' : ''}`}
                  onClick={() => setAddOpen(true)}
                  aria-haspopup="dialog"
                  aria-expanded={addOpen}
                  aria-current={active ? 'page' : undefined}
                  aria-keyshortcuts="N"
                >
                  {inner}
                </button>
              )
            }
            return (
              <a key={item.path} className={`nav__item${active ? ' is-active' : ''}`} href={href(item.path)} aria-current={active ? 'page' : undefined}>
                {inner}
              </a>
            )
          })}
        </nav>
        <AddSheet open={addOpen} onClose={() => setAddOpen(false)} returnTo={adding ? '/' : route.path} />
        <main className="main" id="main" ref={mainRef} tabIndex={-1}>
          <ScreenBoundary key={route.path}>
            <Suspense fallback={<ScreenSkeleton />}>
              <Screen route={route} />
            </Suspense>
          </ScreenBoundary>
        </main>
      </div>
    </div>
  )
}

/**
 * Si una pantalla no se puede cargar (p. ej. la app se actualizó en otra pestaña y sus
 * archivos ya no existen, o no hay conexión), se explica y se ofrece recargar en vez de
 * dejar la pantalla en blanco. Los datos no se tocan.
 */
class ScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    logError(error)
  }
  render() {
    return this.state.failed ? <ScreenFailed /> : this.props.children
  }
}

function ScreenFailed() {
  const { t } = useT()
  return (
    <div className="stack">
      <h1 id="page-title" tabIndex={-1}>
        {t('shell.screenFailed')}
      </h1>
      <p>{t('shell.screenFailedText')}</p>
      <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
        {t('shell.updateReload')}
      </button>
    </div>
  )
}

function Screen({ route }: { route: Route }) {
  const { t } = useT()
  const [a, b, c] = route.segments
  const key = route.path
  if (!a) return <Home key={key} />
  if (a === 'alcanza' && b === 'escenarios' && (c === 'nuevo' || c === 'editar')) return <ScenarioForm key={`${key}?${route.query.toString()}`} route={route} />
  if (a === 'alcanza' && b === 'faltante') return <ShortfallPlan key={`${key}?${route.query.toString()}`} route={route} />
  if (a === 'alcanza' && b === 'escenarios') return <Scenarios key={key} />
  if (a === 'alcanza') return <Afford key={key} />
  if (a === 'cambios') return <WhatChanged key={`${key}?${route.query.toString()}`} route={route} />
  if (a === 'analisis') return <Insights key={key} />
  if (a === 'pendientes') return <Inbox key={key} />
  if (a === 'revision') return <WeeklyReview key={`${key}?${route.query.toString()}`} route={route} />
  if (a === 'movimientos' && (b === 'nuevo' || b === 'editar')) return <MovementForm key={`${key}?${route.query.toString()}`} route={route} />
  if (a === 'movimientos' && b === 'importar') return <BankImport key={key} />
  if (a === 'movimientos' && b === 'distribuir' && c) return <IncomeDistributionScreen key={key} route={route} />
  if (a === 'movimientos' && b === 'papelera') return <Trash key={key} />
  if (a === 'movimientos' && b === 'favoritos') return <Favorites key={key} />
  if (a === 'movimientos' && b === 'plantillas' && (c === 'nueva' || c === 'editar')) return <TemplateForm key={`${key}?${route.query.toString()}`} route={route} />
  if (a === 'movimientos' && b === 'plantillas') return <Templates key={key} />
  if (a === 'conciliar') return <Reconcile key={`${key}?${route.query.toString()}`} route={route} />
  if (a === 'movimientos') return <Movements key={`${key}?${route.query.toString()}`} route={route} />
  if (a === 'plan' && b === 'programado' && (c === 'nuevo' || c === 'editar')) return <ScheduleForm key={`${key}?${route.query.toString()}`} route={route} />
  if (a === 'plan' && b === 'metas' && (c === 'nueva' || c === 'editar')) return <GoalForm key={`${key}?${route.query.toString()}`} route={route} />
  if (a === 'plan' && b === 'periodos' && (c === 'nuevo' || c === 'editar')) return <PeriodBudgetForm key={key} route={route} />
  if (a === 'plan' && b === 'periodos' && c) return <PeriodBudgetDetail key={key} route={route} />
  if (a === 'plan' && b === 'planes' && (c === 'nuevo' || c === 'editar')) return <PlanForm key={`${key}?${route.query.toString()}`} route={route} />
  if (a === 'plan' && b === 'planes' && c) return <PlanDetail key={key} route={route} />
  if (a === 'plan') return <Plan key={key} route={route} />
  if (a === 'ajustes' && b === 'historial') return <History key={key} />
  if (a === 'ajustes' && b === 'categorias') return <Categories key={key} />
  if (a === 'galeria') return <Gallery key={key} />
  if (a === 'asistente') return <Assistant key={`${key}?${route.query.toString()}`} route={route} />
  if (a === 'estadisticas') return <Statistics key={`${key}?${route.query.toString()}`} route={route} />
  if (a === 'legal') return <Legal key={key} route={route} />
  if (a === 'cuenta') return <Account key={key} />
  if (a === 'pro') return <Pro key={key} />
  if (a === 'ajustes') return <Settings key={`${key}/${b ?? ''}`} route={route} />
  if (a === 'buscar') return <Search key={`${key}?${route.query.toString()}`} route={route} />
  return (
    <div className="stack">
      <h1 id="page-title" tabIndex={-1}>
        {t('shell.notFound')}
      </h1>
      <a className="btn btn--primary" href={href('/')}>
        {t('nav.home')}
      </a>
    </div>
  )
}
