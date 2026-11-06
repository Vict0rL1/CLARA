/**
 * Galería de componentes (`/galeria`): muestra tokens, tipografía y todos los componentes base en
 * el tema activo (claro, oscuro o sistema). No lee ni modifica datos financieros; solo usa los
 * ajustes de formato para los ejemplos de dinero. Sirve para revisar diseño y accesibilidad.
 */
import { useState } from 'react'
import { useT } from '../../i18n'
import { usePack } from '../../i18n/packs'
import { CATEGORY_COLOR_LIST, EXPENSE_CATEGORY_IDS, INCOME_CATEGORY_IDS, systemCategoryMeta } from '../../domain/categories'
import { formatDate, formatMoney, formatRelativeDate } from '../../domain/formatters'
import { useData } from '../../state/store'
import { useToday } from '../../state/hooks'
import { BottomSheet, CategoryChip, CoachMark, FAB, ListRow, MonthNavigator, PrimaryButton, ProgressBar, SearchBar, SecondaryButton, Skeleton, TextButton, TimePickerRow, Toggle } from '../components/base'
import { Alert, Badge, Card, EmptyState, PageHeader, StatTile } from '../components/common'
import { PackNotice } from '../components/PackNotice'
import { ConfirmDialog } from '../components/Dialog'
import { CheckboxField, MoneyField, Segmented, SelectField, TextField } from '../components/fields'
import { Icon } from '../components/Icon'
import { CATEGORY_ICON_NAMES } from '../components/iconPaths'
import { createFormatter, DATE_LOCALE } from '../format'
import { href } from '../router'
import { useThemePreference } from '../theme'
import { useToast } from '../components/toastContext'

const TOKENS = ['bg', 'bg-elevated', 'card', 'text-primary', 'text-secondary', 'text-muted', 'accent', 'accent-teal', 'income', 'expense', 'warning', 'info', 'pro'] as const

export function Gallery() {
  const { t, language } = useT()
  // Sus textos son un paquete diferido: hasta que está listo solo se dibujan la cabecera y el estado de carga (ninguna
  // clave a la vista); si no carga, se dice y se puede reintentar.
  const pack = usePack('gallery')
  const data = useData()
  const today = useToday()
  const [theme, setTheme] = useThemePreference()
  const toast = useToast()
  const [sheet, setSheet] = useState(false)
  const [dialog, setDialog] = useState(false)
  const [on, setOn] = useState(true)
  const [query, setQuery] = useState('')
  const [time, setTime] = useState('20:00')
  const [money, setMoney] = useState('')
  const [coach, setCoach] = useState(true)
  const [privacy, setPrivacy] = useState(false)
  const fmt = createFormatter(data.settings)
  const locale = data.settings.numberLocale
  const dateLocale = DATE_LOCALE[language]
  const currency = data.settings.currency
  const sample = 1234567

  if (pack.status !== 'ready') {
    return (
      <div className="stack gallery">
        <PageHeader title={t('settings.toc.gallery')} back={{ href: href('/ajustes'), label: t('common.back') }} />
        <Card>
          <PackNotice state={pack} />
        </Card>
      </div>
    )
  }
  const g = pack.t
  // Con el español de respaldo, los textos del paquete llevan `lang="es"` (auditoría del 2026-11-04, F3); la cabecera
  // y la barra siguen en el idioma de la interfaz.
  const packLang = pack.fallback ? 'es' : undefined
  return (
    <div className="stack gallery">
      <PageHeader title={g('gallery.title')} back={{ href: href('/ajustes'), label: t('common.back') }} titleLang={packLang} />
      <PackNotice state={pack} />
      <div className="stack" lang={packLang} data-testid="pack-content">
        <p className="muted">{g('gallery.intro')}</p>

        <Card labelledBy="g-tokens">
          <h2 id="g-tokens" className="card__title">
            {g('gallery.section.tokens')}
          </h2>
          <Segmented
            legend={t('settings.theme.label')}
            name="gallery-theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'system', label: t('settings.theme.system') },
              { value: 'light', label: t('settings.theme.light') },
              { value: 'dark', label: t('settings.theme.dark') },
            ]}
          />
          <div className="gallery__grid">
            {TOKENS.map((name) => (
              <div key={name} className="gallery__swatch">
                <div className="gallery__swatch-color" style={{ background: `var(--${name})` }} />
                <code>--{name}</code>
              </div>
            ))}
          </div>
          <div className="gallery__row">
            {CATEGORY_COLOR_LIST.map((c) => (
              <span key={c} className={`cat-dot cat-dot--${c}`} title={c}>
                <Icon name="tag" size={16} />
              </span>
            ))}
          </div>
        </Card>

        <Card labelledBy="g-type">
          <h2 id="g-type" className="card__title">
            {g('gallery.section.typography')}
          </h2>
          <p style={{ fontSize: 'var(--font-display)', fontWeight: 700, lineHeight: 1.1 }}>{fmt.money(sample)}</p>
          <p style={{ fontSize: 'var(--font-h1)', fontWeight: 700 }}>{g('gallery.h1')}</p>
          <p style={{ fontSize: 'var(--font-h2)', fontWeight: 600 }}>{g('gallery.h2')}</p>
          <p style={{ fontSize: 'var(--font-h3)', fontWeight: 600 }}>{g('gallery.h3')}</p>
          <p>{g('gallery.body')}</p>
          <p className="muted" style={{ fontSize: 'var(--font-caption)' }}>
            {g('gallery.caption')}
          </p>
          <p className="coach__step">{g('gallery.overline')}</p>
        </Card>

        <Card labelledBy="g-buttons">
          <h2 id="g-buttons" className="card__title">
            {g('gallery.section.buttons')}
          </h2>
          <div className="gallery__row">
            <PrimaryButton icon="plus">{t('home.addMovement')}</PrimaryButton>
            <SecondaryButton icon="search">{t('search.title')}</SecondaryButton>
            <TextButton>{t('common.cancel')}</TextButton>
            <PrimaryButton disabled>{t('common.saving')}</PrimaryButton>
            <button type="button" className="btn btn--danger">
              {t('common.delete')}
            </button>
            <span className="fab fab--inline" aria-hidden="true">
              <Icon name="plus" size={24} />
            </span>
          </div>
          <div className="gallery__row">
            <Badge tone="good" icon="checkCircle">
              {t('state.paid')}
            </Badge>
            <Badge tone="warning" icon="alert">
              {t('state.pending')}
            </Badge>
            <Badge tone="critical" icon="alert">
              {t('state.overdue')}
            </Badge>
            <Badge tone="info" icon="info">
              {t('state.estimate')}
            </Badge>
            <Badge tone="neutral">{t('state.skipped')}</Badge>
          </div>
        </Card>

        <Card labelledBy="g-fields">
          <h2 id="g-fields" className="card__title">
            {g('gallery.section.fields')}
          </h2>
          <SearchBar value={query} onChange={setQuery} label={g('gallery.search')} placeholder={t('search.placeholder')} clearLabel={g('gallery.clear')} />
          <MoneyField label={t('fields.amount')} value={money} onChange={setMoney} fmt={fmt} big hint={t('money.placeholder', { sep: fmt.decimalSeparator })} />
          <TextField label={t('fields.name')} placeholder={t('scheduleForm.namePlaceholderExpense')} hint={t('movementForm.noteHint', { max: 120 })} />
          <TextField label={t('fields.date')} type="date" error={t('issue.invalidDate')} defaultValue="" />
          <SelectField label={t('fields.frequency')} options={[{ value: 'monthly', label: t('frequency.monthly') }, { value: 'weekly', label: t('frequency.weekly') }]} defaultValue="monthly" />
          <Segmented legend={t('fields.kind')} name="gallery-kind" value="expense" onChange={() => {}} options={[{ value: 'expense', label: t('txKind.expense') }, { value: 'income', label: t('txKind.income') }, { value: 'transfer', label: t('txKind.transfer') }]} />
          <CheckboxField label={t('scheduleForm.estimate')} hint={t('scheduleForm.estimateHint')} checked onChange={() => {}} />
          <Toggle checked={on} onChange={setOn} label={g('gallery.toggle')} hint={g('gallery.toggleHint')} />
          <TimePickerRow label={g('gallery.time')} value={time} onChange={setTime} hint={g('gallery.timeHint')} />
        </Card>

        <Card labelledBy="g-lists">
          <h2 id="g-lists" className="card__title">
            {g('gallery.section.lists')}
          </h2>
          <MonthNavigator label={fmt.monthYear(today)} onPrev={() => {}} onNext={() => {}} prevLabel={g('gallery.prev')} nextLabel={g('gallery.nextMonth')} onToday={() => {}} todayLabel={g('gallery.today')} />
          <div>
            <ListRow icon="basket" color="green" title={g('gallery.sampleRow')} subtitle={g('gallery.sampleSub')} value={fmt.money(-4250)} valueTone="expense" chevron onClick={() => {}} />
            <ListRow icon="briefcase" color="emerald" title={g('gallery.sampleIncome')} subtitle={formatRelativeDate(today, today, dateLocale)} value={fmt.money(250000, { sign: true })} valueTone="income" badge={<Badge tone="good" icon="checkCircle">{t('state.received')}</Badge>} />
            <ListRow icon="repeat" color="violet" title={t('category.subscriptions')} subtitle={t('frequency.monthly')} value={fmt.money(-1599)} valueTone="expense" />
          </div>
          <div className="gallery__row">
            <CategoryChip label={t('category.groceries')} icon="basket" color="green" selected onClick={() => {}} count={12} />
            <CategoryChip label={t('category.transport')} icon="bus" color="cyan" onClick={() => {}} count={3} />
            <CategoryChip label={t('category.health')} icon="heart" color="red" />
          </div>
        </Card>

        <Card labelledBy="g-feedback">
          <h2 id="g-feedback" className="card__title">
            {g('gallery.section.feedback')}
          </h2>
          <ProgressBar fraction={0.45} state="ok" label={g('gallery.progress')} valueText={`${fmt.money(4500)} / ${fmt.money(10000)}`} stateText={g('gallery.state.ok')} />
          <ProgressBar fraction={0.86} state="warning" label={g('gallery.progress')} valueText={`${fmt.money(8600)} / ${fmt.money(10000)}`} stateText={g('gallery.state.warning')} />
          <ProgressBar fraction={1.2} state="exceeded" label={g('gallery.progress')} valueText={`${fmt.money(12000)} / ${fmt.money(10000)}`} stateText={g('gallery.state.exceeded')} />
          <ProgressBar fraction={1} state="complete" label={g('gallery.progress')} valueText={`${fmt.money(10000)} / ${fmt.money(10000)}`} stateText={g('gallery.state.complete')} />
          <div className="gallery__row">
            <StatTile label={t('summary.income')} value={fmt.money(250000)} hint={fmt.percent(0.12)} />
            <StatTile label={t('summary.spending')} value={fmt.money(132050)} hint={fmt.percent(-0.04)} />
          </div>
          <Alert tone="info" title={g('gallery.alertTitle')}>
            {g('gallery.alertText')}
          </Alert>
          <Alert tone="warning" title={g('gallery.state.warning')} />
          <Alert tone="critical" title={g('gallery.state.exceeded')} />
          <Alert tone="good" title={g('gallery.state.complete')} />
          <EmptyState icon="sparkles" title={g('gallery.emptyTitle')} text={g('gallery.emptyText')} action={<SecondaryButton small icon="plus">{g('gallery.emptyAction')}</SecondaryButton>} />
          <p className="muted">{g('gallery.skeleton')}</p>
          <Skeleton lines={3} />
          {coach && (
            <CoachMark step={1} total={3} title={g('gallery.coachTitle')} onNext={() => setCoach(false)} onDismiss={() => setCoach(false)} nextLabel={g('gallery.next')} dismissLabel={g('gallery.skip')}>
              {g('gallery.coachText')}
            </CoachMark>
          )}
        </Card>

        <Card labelledBy="g-money">
          <h2 id="g-money" className="card__title">
            {g('gallery.section.money')}
          </h2>
          <Toggle checked={privacy} onChange={setPrivacy} label={g('gallery.privacy')} />
          <ul className="gallery__list">
            <li>
              <code>{currency}</code> · {formatMoney(sample, currency, locale, { privacy })}
            </li>
            <li>
              {g('gallery.compact')} · {formatMoney(sample, currency, locale, { privacy, compact: true })}
            </li>
            <li>{formatMoney(-sample, currency, locale, { privacy, signDisplay: 'always' })}</li>
            {(
              [
                ['COP', 25000, 'es-CO'],
                ['MXN', 50000, 'es-MX'],
                ['CAD', 50000, 'en-CA'],
                ['EUR', 50000, 'fr-FR'],
                ['BRL', 50000, 'pt-BR'],
              ] as const
            ).map(([code, minor, loc]) => (
              <li key={code}>
                <code>{code}</code> · {formatMoney(minor, code, loc, { privacy })}
              </li>
            ))}
            <li>
              {formatDate(today, dateLocale, 'long', { weekday: true })} · {formatDate(today, dateLocale, 'short')} · {formatDate(today, dateLocale, 'iso')}
            </li>
          </ul>
        </Card>

        <Card labelledBy="g-icons">
          <h2 id="g-icons" className="card__title">
            {g('gallery.section.icons')} ({CATEGORY_ICON_NAMES.length})
          </h2>
          <div className="gallery__row">
            {[...EXPENSE_CATEGORY_IDS, ...INCOME_CATEGORY_IDS].map((id) => {
              const meta = systemCategoryMeta(id)!
              return <CategoryChip key={id} label={t(`category.${id}`)} icon={meta.icon} color={meta.color} />
            })}
          </div>
          <div className="gallery__icons">
            {CATEGORY_ICON_NAMES.map((name) => (
              <span key={name} className="gallery__icon" title={name}>
                <Icon name={name} size={20} />
              </span>
            ))}
          </div>
        </Card>

        <Card labelledBy="g-overlays">
          <h2 id="g-overlays" className="card__title">
            {g('gallery.section.overlays')}
          </h2>
          <div className="gallery__row">
            <SecondaryButton onClick={() => setSheet(true)}>{g('gallery.openSheet')}</SecondaryButton>
            <SecondaryButton onClick={() => setDialog(true)}>{g('gallery.openDialog')}</SecondaryButton>
            <SecondaryButton onClick={() => toast({ message: g('gallery.toastText'), tone: 'good' })}>{g('gallery.toast')}</SecondaryButton>
          </div>
        </Card>

        <BottomSheet open={sheet} onClose={() => setSheet(false)} title={g('gallery.sheetTitle')} footer={<PrimaryButton onClick={() => setSheet(false)}>{t('common.close')}</PrimaryButton>}>
          <p>{g('gallery.sheetText')}</p>
          <ListRow icon="basket" color="green" title={g('gallery.sampleRow')} value={fmt.money(-4250)} onClick={() => setSheet(false)} chevron />
          <ListRow icon="briefcase" color="emerald" title={g('gallery.sampleIncome')} value={fmt.money(250000)} onClick={() => setSheet(false)} chevron />
        </BottomSheet>
        <ConfirmDialog open={dialog} title={g('gallery.dialogTitle')} confirmLabel={g('gallery.confirm')} onConfirm={() => setDialog(false)} onCancel={() => setDialog(false)}>
          <p>{g('gallery.dialogText')}</p>
        </ConfirmDialog>
      </div>
      <FAB label={t('home.addMovement')} href={href('/movimientos/nuevo')} />
    </div>
  )
}
