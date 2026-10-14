/**
 * Componentes base de Clara v2 (§4 del master prompt) que no existían: hoja inferior,
 * interruptor, pista guiada, botón flotante, esqueleto, barra de búsqueda, fila de hora, chip de
 * categoría, fila de lista, barra de progreso por estado y navegador de meses.
 *
 * Reglas: cada estado lleva icono + texto (nunca solo color), objetivos táctiles ≥ 44 px,
 * textos siempre por i18n (los recibe quien los usa) y sin dependencias externas.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useT } from '../../i18n'
import { Icon, type IconName } from './Icon'
import { CategoryIcon } from './CategoryIcon'
import { haptic } from '../haptics'
import type { CategoryColor } from '../../domain/types'

/* ---------- Botones ---------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName; small?: boolean; large?: boolean }

function classes(variant: string, { small, large, className }: ButtonProps): string {
  return ['btn', `btn--${variant}`, small && 'btn--small', large && 'btn--large', className].filter(Boolean).join(' ')
}

function ButtonBody({ icon, children }: Pick<ButtonProps, 'icon' | 'children'>) {
  return (
    <>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </>
  )
}

export function PrimaryButton({ icon, small, large, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={classes('primary', { small, large, className })} {...rest}>
      <ButtonBody icon={icon}>{children}</ButtonBody>
    </button>
  )
}

export function SecondaryButton({ icon, small, large, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={classes('secondary', { small, large, className })} {...rest}>
      <ButtonBody icon={icon}>{children}</ButtonBody>
    </button>
  )
}

export function TextButton({ icon, small, large, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={classes('ghost', { small, large, className })} {...rest}>
      <ButtonBody icon={icon}>{children}</ButtonBody>
    </button>
  )
}

/* ---------- Hoja inferior ---------- */

/**
 * Hoja que sube desde abajo (220 ms, §4) sobre <dialog>: atrapa el foco, Escape y el fondo la
 * cierran y el foco vuelve al botón que la abrió. En escritorio se centra como un diálogo.
 */
export function BottomSheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const { t } = useT()
  // E4: quien abrió la hoja recupera el foco al cerrarla (Esc, ✕, fondo o deslizar hacia abajo).
  const opener = useRef<HTMLElement | null>(null)
  // E4: deslizar hacia abajo desde el asa o la cabecera cierra la hoja (más de 80 px).
  const drag = useRef<number | null>(null)
  const [dragY, setDragY] = useState(0)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
      dialog.showModal()
    }
    if (!open && dialog.open) {
      dialog.close()
      const el = opener.current
      opener.current = null
      if (el && el.isConnected && !dialog.contains(el)) el.focus()
    }
  }, [open])

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const cancel = (e: Event) => {
      e.preventDefault()
      onClose()
    }
    dialog.addEventListener('cancel', cancel)
    return () => dialog.removeEventListener('cancel', cancel)
  }, [onClose])

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      {open && (
        <div className={`sheet__panel${dragY > 0 ? ' is-dragging' : ''}`} style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}>
          <div
            className="sheet__drag"
            onPointerDown={(e) => {
              if (e.pointerType === 'mouse' || (e.target as HTMLElement).closest('button')) return
              drag.current = e.clientY
            }}
            onPointerMove={(e) => {
              if (drag.current === null) return
              setDragY(Math.max(0, e.clientY - drag.current))
            }}
            onPointerUp={() => {
              if (drag.current === null) return
              drag.current = null
              const shouldClose = dragY > 80
              setDragY(0)
              if (shouldClose) onClose()
            }}
            onPointerCancel={() => {
              drag.current = null
              setDragY(0)
            }}
          >
            <div className="sheet__grip" aria-hidden="true" />
            <div className="sheet__header">
              <h2 id={titleId} className="sheet__title">
                {title}
              </h2>
              <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label={t('common.close')}>
                <Icon name="x" />
              </button>
            </div>
          </div>
          <div className="sheet__body">{children}</div>
          {footer && <div className="sheet__footer">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}

/* ---------- Interruptor ---------- */

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; hint?: ReactNode; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="toggle-row">
      <div className="toggle-row__text">
        <span className="toggle-row__label" id={`${id}-label`}>
          {label}
        </span>
        {hint && (
          <span className="field__hint" id={`${id}-hint`}>
            {hint}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`toggle${checked ? ' is-on' : ''}`}
        onClick={() => onChange(!checked)}
        disabled={disabled}
      >
        <span className="toggle__knob" aria-hidden="true">
          {checked && <Icon name="check" size={12} />}
        </span>
      </button>
    </div>
  )
}

/* ---------- Pista guiada (coach mark) ---------- */

export function CoachMark({ step, total, title, children, onNext, onDismiss, nextLabel, dismissLabel }: { step: number; total: number; title: string; children: ReactNode; onNext: () => void; onDismiss: () => void; nextLabel: string; dismissLabel: string }) {
  const { t } = useT()
  return (
    <div className="coach" role="dialog" aria-label={title}>
      <p className="coach__step">{t('gallery.coachStep', { step, total })}</p>
      <p className="coach__title">{title}</p>
      <div className="coach__text">{children}</div>
      <div className="coach__actions">
        <TextButton small onClick={onDismiss}>
          {dismissLabel}
        </TextButton>
        <PrimaryButton small onClick={onNext}>
          {nextLabel}
        </PrimaryButton>
      </div>
    </div>
  )
}

/* ---------- Botón flotante ---------- */

export function FAB({ label, icon = 'plus', onClick, href }: { label: string; icon?: IconName; onClick?: () => void; href?: string }) {
  const content = <Icon name={icon} size={24} />
  if (href) {
    return (
      <a className="fab" href={href} aria-label={label} title={label}>
        {content}
      </a>
    )
  }
  return (
    <button type="button" className="fab" onClick={onClick} aria-label={label} title={label}>
      {content}
    </button>
  )
}

/* ---------- Esqueleto ---------- */

/** Marcador de carga: invisible para lectores de pantalla; quien lo usa anuncia «Cargando…». */
export function Skeleton({ lines = 3, height }: { lines?: number; height?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton__line" style={{ width: `${100 - (i % 3) * 18}%`, ...(height ? { height } : {}) }} />
      ))}
    </div>
  )
}

/* ---------- Barra de búsqueda ---------- */

export function SearchBar({ value, onChange, label, placeholder, hint, clearLabel, autoFocus }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; /** Descripción accesible (qué se puede buscar); no ocupa sitio en pantalla. */ hint?: string; clearLabel: string; autoFocus?: boolean }) {
  const id = useId()
  return (
    <div className="searchbar" role="search">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="sr-only">
          {hint}
        </p>
      )}
      <Icon name="search" className="searchbar__icon" />
      <input id={id} type="search" className="input searchbar__input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-describedby={hint ? `${id}-hint` : undefined} autoFocus={autoFocus} autoComplete="off" enterKeyHint="search" />
      {value && (
        <button type="button" className="btn btn--ghost btn--icon searchbar__clear" onClick={() => onChange('')} aria-label={clearLabel}>
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  )
}

/* ---------- Fila de hora ---------- */

export function TimePickerRow({ label, value, onChange, hint, disabled }: { label: string; value: string; onChange: (v: string) => void; hint?: ReactNode; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="list-row list-row--field">
      <label htmlFor={id} className="list-row__main">
        <span className="list-row__title">{label}</span>
        {hint && <span className="list-row__subtitle">{hint}</span>}
      </label>
      <input id={id} type="time" className="input input--small" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    </div>
  )
}

/* ---------- Chip de categoría ---------- */

export function CategoryChip({ label, icon, color, selected, onClick, count }: { label: string; icon: IconName | string; color: CategoryColor; selected?: boolean; onClick?: () => void; count?: number }) {
  const inner = (
    <>
      <CategoryIcon icon={icon} color={color} />
      <span className="cat-chip__label">{label}</span>
      {count !== undefined && <span className="cat-chip__count">{count}</span>}
      {selected && <Icon name="check" size={14} className="cat-chip__check" />}
    </>
  )
  if (!onClick) return <span className={`cat-chip${selected ? ' is-selected' : ''}`}>{inner}</span>
  return (
    <button type="button" className={`cat-chip${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={onClick}>
      {inner}
    </button>
  )
}

/* ---------- Fila de lista ---------- */

export function ListRow({ icon, color, title, subtitle, value, valueTone, href, onClick, badge, chevron }: { icon?: IconName | string; color?: CategoryColor; title: ReactNode; subtitle?: ReactNode; value?: ReactNode; valueTone?: 'income' | 'expense' | 'neutral'; href?: string; onClick?: () => void; badge?: ReactNode; chevron?: boolean }) {
  const body = (
    <>
      {icon && <CategoryIcon icon={icon} color={color} />}
      <span className="list-row__main">
        <span className="list-row__title">{title}</span>
        {subtitle && <span className="list-row__subtitle">{subtitle}</span>}
        {badge}
      </span>
      {value !== undefined && <span className={`list-row__value${valueTone ? ` list-row__value--${valueTone}` : ''}`}>{value}</span>}
      {chevron && <Icon name="chevronRight" size={18} className="list-row__chevron" />}
    </>
  )
  if (href) {
    return (
      <a className="list-row list-row--link" href={href}>
        {body}
      </a>
    )
  }
  if (onClick) {
    return (
      <button type="button" className="list-row list-row--link" onClick={onClick}>
        {body}
      </button>
    )
  }
  return <div className="list-row">{body}</div>
}

/* ---------- Barra de progreso por estado ---------- */

export type ProgressState = 'ok' | 'warning' | 'exceeded' | 'complete'

const PROGRESS_ICON: Record<ProgressState, IconName> = { ok: 'checkCircle', warning: 'alert', exceeded: 'alert', complete: 'checkCircle' }

/** Barra con estado (§6: ok < 80 %, aviso 80–100 %, excedido > 100 %) y texto visible. */
export function ProgressBar({ fraction, state, label, valueText, stateText }: { fraction: number; state: ProgressState; label: string; valueText: string; stateText: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100)
  return (
    <div className={`progress progress--${state}`}>
      <div className="progress__track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${valueText} · ${stateText}`}>
        <div className="progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="progress__text">
        <span>{valueText}</span>
        <span className="progress__state">
          <Icon name={PROGRESS_ICON[state]} size={14} />
          {stateText}
        </span>
      </p>
    </div>
  )
}

/* ---------- Navegador de meses / periodos ---------- */

export function MonthNavigator({ label, onPrev, onNext, prevLabel, nextLabel, nextDisabled, onToday, todayLabel }: { label: string; onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string; nextDisabled?: boolean; onToday?: () => void; todayLabel?: string }) {
  return (
    <div className="month-nav">
      <button type="button" className="btn btn--ghost btn--icon" onClick={onPrev} aria-label={prevLabel}>
        <Icon name="chevronLeft" />
      </button>
      <p className="month-nav__label" aria-live="polite">
        {label}
      </p>
      <button type="button" className="btn btn--ghost btn--icon" onClick={onNext} aria-label={nextLabel} disabled={nextDisabled}>
        <Icon name="chevronRight" />
      </button>
      {onToday && todayLabel && (
        <TextButton small onClick={onToday}>
          {todayLabel}
        </TextButton>
      )}
    </div>
  )
}

/* ---------- Fila deslizable ---------- */

/**
 * Deslizar a la izquierda revela una acción (p. ej. eliminar). La misma acción está siempre
 * disponible por teclado y lector de pantalla como botón visible al enfocar la fila.
 */
export function SwipeRow({
  children,
  actionLabel,
  onAction,
  icon = 'trash',
  secondary,
}: {
  children: ReactNode
  actionLabel: string
  onAction: () => void
  icon?: IconName
  /** Acción al deslizar a la derecha (D4: editar). Con teclado, enfocar la fila revela ambos botones. */
  secondary?: { label: string; onAction: () => void; icon?: IconName }
}) {
  const startX = useRef<number | null>(null)
  const [offset, setOffset] = useState(0)
  // Desplazamiento en vivo: un gesto rápido puede soltar antes de que React pinte el último movimiento;
  // decidir con el estado de ese render dejaba la fila cerrada (y su botón tapado por el contenido).
  const liveOffset = useRef(0)
  // 'focus' (teclado o lector de pantalla) muestra las acciones sin desplazar la fila.
  const [open, setOpen] = useState<false | 'left' | 'right' | 'focus'>(false)
  const WIDTH = 88
  const shift = open === 'left' ? -WIDTH : open === 'right' ? WIDTH : open === 'focus' ? (secondary ? 0 : -WIDTH) : offset
  return (
    <div
      className={`swipe${open ? ` is-open is-open-${open}` : ''}`}
      // Con teclado o lector de pantalla: enfocar la fila revela la acción sin gesto.
      onFocus={() => setOpen('focus')}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <div
        className="swipe__content"
        style={{ transform: `translateX(${shift}px)` }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') return
          startX.current = e.clientX
        }}
        onPointerMove={(e) => {
          if (startX.current === null) return
          const dx = e.clientX - startX.current
          const base = open === 'left' ? dx - WIDTH : open === 'right' ? dx + WIDTH : dx
          liveOffset.current = Math.max(-WIDTH, Math.min(secondary ? WIDTH : 0, base))
          setOffset(liveOffset.current)
        }}
        onPointerUp={() => {
          const final = liveOffset.current
          if (Math.abs(final) > WIDTH / 2) haptic('tick')
          if (startX.current === null) return
          startX.current = null
          liveOffset.current = 0
          setOpen(final < -WIDTH / 2 ? 'left' : secondary && final > WIDTH / 2 ? 'right' : false)
          setOffset(0)
        }}
        onPointerCancel={() => {
          startX.current = null
          liveOffset.current = 0
          setOffset(0)
        }}
      >
        {children}
      </div>
      {secondary && (
        <button type="button" className="swipe__action swipe__action--secondary" onClick={secondary.onAction} aria-label={secondary.label}>
          <Icon name={secondary.icon ?? 'edit'} size={20} />
        </button>
      )}
      <button type="button" className="swipe__action" onClick={onAction} aria-label={actionLabel}>
        <Icon name={icon} size={20} />
      </button>
    </div>
  )
}

/* ---------- Cifra principal (count-up) ---------- */

/**
 * Muestra SIEMPRE el importe final de inmediato: un conteo animado retrasaría la cifra que la persona
 * necesita leer. Al cambiar de valor, un fundido de 160 ms (`.is-updated`) señala el cambio; con
 * «reducir movimiento» no hay ninguna animación.
 */
export function CountUp({ valueMinor, format, animate = true }: { valueMinor: number; format: (minor: number) => string; animate?: boolean }) {
  const previous = useRef<number | null>(null)
  const [updated, setUpdated] = useState(false)
  useEffect(() => {
    const from = previous.current
    previous.current = valueMinor
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (from === null || !animate || reduced || from === valueMinor) return
    setUpdated(true)
    const timer = window.setTimeout(() => setUpdated(false), 200)
    return () => window.clearTimeout(timer)
  }, [valueMinor, animate])
  return <span className={updated ? 'count-up is-updated' : 'count-up'}>{format(valueMinor)}</span>
}

/* ---------- Esqueleto de pantalla (carga diferida) ---------- */

export function ScreenSkeleton() {
  return (
    <div className="stack screen-skeleton" aria-busy="true" aria-hidden="true">
      <Skeleton lines={1} height={28} />
      <Skeleton lines={4} />
      <Skeleton lines={3} />
    </div>
  )
}
