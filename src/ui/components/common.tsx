/**
 * Componentes pequeños y accesibles: avisos, insignias, tarjetas de cifras,
 * barras de progreso, estados vacíos y explicaciones desplegables.
 */
import type { ReactNode } from 'react'
import { useT } from '../../i18n'
import { Icon, type IconName } from './Icon'

export type Tone = 'info' | 'good' | 'warning' | 'critical' | 'neutral'

const TONE_ICON: Record<Tone, IconName> = {
  info: 'info',
  good: 'checkCircle',
  warning: 'alert',
  critical: 'alert',
  neutral: 'info',
}

/** Aviso con icono + título: nunca comunica solo con color. */
export function Alert({
  tone,
  title,
  children,
  actions,
  icon,
  role,
}: {
  tone: Tone
  title: string
  children?: ReactNode
  actions?: ReactNode
  icon?: IconName
  role?: 'status' | 'alert'
}) {
  return (
    <div className={`alert alert--${tone}`} role={role}>
      <Icon name={icon ?? TONE_ICON[tone]} className="alert__icon" />
      <div className="alert__body">
        <p className="alert__title">{title}</p>
        {children && <div className="alert__text">{children}</div>}
        {actions && <div className="alert__actions">{actions}</div>}
      </div>
    </div>
  )
}

export function Badge({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: IconName; children: ReactNode }) {
  return (
    <span className={`badge badge--${tone}`}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  )
}

export function Card({ children, className, labelledBy, as: As = 'section' }: { children: ReactNode; className?: string; labelledBy?: string; as?: 'section' | 'div' | 'article' }) {
  return (
    <As className={['card', className].filter(Boolean).join(' ')} aria-labelledby={labelledBy}>
      {children}
    </As>
  )
}

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <p className="stat__label">{label}</p>
      <p className="stat__value">{value}</p>
      {hint && <p className="stat__hint">{hint}</p>}
    </div>
  )
}

/** Barra de progreso con texto visible (el color no es el único indicador). */
/**
 * Arco de progreso (metas): anillo con extremos redondeados y el porcentaje en el centro; completa → ✓.
 * Mismo rol accesible que `Meter` (progressbar con texto de valor); el porcentaje visible llega ya
 * formateado por quien lo usa (`fmt.percent`), así respeta el idioma.
 */
export function ProgressArc({ fraction, label, valueText, text, complete, size = 48 }: { fraction: number; label: string; valueText: string; text: string; complete?: boolean; size?: number }) {
  const f = Math.min(1, Math.max(0, fraction))
  const pct = Math.round(f * 100)
  const stroke = 5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <span className={`arc${complete ? ' arc--complete' : ''}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={valueText} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
        <circle className="arc__track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle className="arc__fill" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} strokeDasharray={`${(c * f).toFixed(2)} ${c.toFixed(2)}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="arc__text" aria-hidden="true">
        {complete ? <Icon name="check" size={16} /> : text}
      </span>
    </span>
  )
}

export function Meter({ fraction, label, valueText }: { fraction: number; label: string; valueText: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100)
  return (
    <div className="meter">
      <div
        className="meter__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={valueText}
      >
        <div className="meter__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/**
 * Estado vacío común (E3): icono, título de una línea, como mucho una línea de texto y una acción.
 * `compact` para dentro de una tarjeta (menos aire, icono de 24 px).
 */
export function EmptyState({ icon, title, text, action, compact, testId }: { icon: IconName; title: string; text?: string; action?: ReactNode; compact?: boolean; testId?: string }) {
  return (
    <div className={`empty${compact ? ' empty--compact' : ''}`} data-testid={testId}>
      <Icon name={icon} size={compact ? 24 : 32} className="empty__icon" />
      <p className="empty__title">{title}</p>
      {text && <p className="empty__text">{text}</p>}
      {action}
    </div>
  )
}

/**
 * E6: una explicación larga reducida a una línea + «¿Por qué?» desplegable. La línea corta es la
 * que se lee siempre; el párrafo completo sigue disponible (y en los cuatro idiomas).
 */
export function Why({ short, children, className }: { short: string; children: ReactNode; className?: string }) {
  const { t } = useT()
  return (
    <div className={`why${className ? ` ${className}` : ''}`}>
      <p className="note why__short">{short}</p>
      <Explain className="explain--inline why__more" summary={t('common.why')} summaryShort={t('common.why')}>
        {children}
      </Explain>
    </div>
  )
}

/** "¿Cómo se calculó?": explicación desplegable nativa (accesible con teclado). */
export function Explain({ summary, summaryShort, children, className }: { summary?: string; /** Texto corto para pantallas estrechas; el nombre accesible sigue siendo el completo (G2). */ summaryShort?: string; children: ReactNode; className?: string }) {
  const { t } = useT()
  const label = summary ?? t('common.howCalculated')
  return (
    <details className={`explain${className ? ` ${className}` : ''}`}>
      <summary aria-label={summaryShort ? label : undefined}>
        <Icon name="info" size={16} />
        <span className="explain__summary-long">{label}</span>
        {summaryShort && (
          <span className="explain__summary-short" aria-hidden="true">
            {summaryShort}
          </span>
        )}
      </summary>
      <div className="explain__body">{children}</div>
    </details>
  )
}

/** Fila "concepto → importe" para explicaciones de cálculos. */
export function CalcRow({ label, value, op, strong }: { label: ReactNode; value: string; op?: '+' | '−' | '='; strong?: boolean }) {
  return (
    <div className={`calc-row${strong ? ' calc-row--strong' : ''}`}>
      <span className="calc-row__op" aria-hidden={op ? undefined : true}>{op ?? ''}</span>
      <span className="calc-row__label">{label}</span>
      <span className="calc-row__value">{value}</span>
    </div>
  )
}

export function PageHeader({ title, children, back }: { title: string; children?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="page-header">
      {back && (
        <a className="btn btn--ghost btn--icon-left page-header__back" href={back.href}>
          <Icon name="back" size={18} />
          {back.label}
        </a>
      )}
      <div className="page-header__row">
        <h1 id="page-title" tabIndex={-1}>
          {title}
        </h1>
        {children && <div className="page-header__actions">{children}</div>}
      </div>
    </div>
  )
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>
}
