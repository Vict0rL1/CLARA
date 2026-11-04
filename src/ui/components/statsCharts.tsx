/**
 * Gráficos de Estadísticas (§7.6) en SVG sin librerías: donut por categoría, barras agrupadas de
 * varios periodos con tooltip, tendencia acumulada (dos series) y saldo futuro con banda.
 * Cada uno tiene texto accesible y una tabla alternativa; en modo privado no se dibujan.
 */
import { useId, useState, type ReactNode } from 'react'
import { CategoryIcon } from './CategoryIcon'
import type { CategoryShare, FutureBalance, SeriesPoint, TrendPoint } from '../../domain/statistics'
import { idealAt, type GoalTrajectory } from '../../domain/goalChart'
import { daysBetween } from '../../domain/dates'
import type { CategoryColor } from '../../domain/types'
import { useT } from '../../i18n'
import type { Formatter } from '../format'
import { pickAxisLabels } from './axisLabels'
import { Icon } from './Icon'
import { signedScale } from '../chartScale'

function HiddenChart() {
  const { t } = useT()
  return (
    <p className="note note--icon chart-hidden" data-testid="chart-hidden">
      <Icon name="lock" size={16} /> {t('privacy.chartHidden')}
    </p>
  )
}

function TableToggle({ children }: { children: ReactNode }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn--ghost btn--small" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? t('stats.hideTable') : t('stats.showTable')}
      </button>
      {open && children}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Donut por categoría                                                 */
/* ------------------------------------------------------------------ */

export function CategoryDonut({ categories, total, fmt, label, color, icon, onSelect }: { icon?: (id: string) => string; categories: CategoryShare[]; total: number; fmt: Formatter; label: (id: string) => string; color: (id: string) => CategoryColor; onSelect?: (id: string) => void }) {
  const { t } = useT()
  if (fmt.privacy) return <HiddenChart />
  const R = 42
  const C = 2 * Math.PI * R
  let offset = 0
  const top = categories.slice(0, 8)
  const rest = categories.slice(8)
  const restMinor = rest.reduce((s, c) => s + c.netMinor, 0)
  const slices = [...top.map((c) => ({ id: c.categoryId, minor: c.netMinor, color: color(c.categoryId), name: label(c.categoryId) })), ...(restMinor > 0 ? [{ id: '__rest', minor: restMinor, color: 'blue' as CategoryColor, name: t('stats.otherCategories') }] : [])]
  return (
    <div className="donut">
      <svg viewBox="0 0 120 120" className="donut__svg" role="img" aria-label={t('stats.donutAria', { total: fmt.money(total), count: categories.length })}>
        {slices.map((s) => {
          const len = total > 0 ? (s.minor / total) * C : 0
          const el = <circle key={s.id} className={`donut__slice cat-dot--${s.color}`} cx="60" cy="60" r={R} fill="none" strokeWidth="14" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)" />
          offset += len
          return el
        })}
        <text x="60" y="57" textAnchor="middle" className="donut__total">
          {fmt.money(total)}
        </text>
        <text x="60" y="72" textAnchor="middle" className="donut__sub">
          {t('stats.expensesShort')}
        </text>
      </svg>
      <ul className="donut__list">
        {categories.map((c) => (
          <li key={c.categoryId}>
            <button type="button" className="donut__row" onClick={() => onSelect?.(c.categoryId)}>
              <CategoryIcon icon={icon ? icon(c.categoryId) : 'tag'} color={color(c.categoryId)} />
              <span className="donut__name">{label(c.categoryId)}</span>
              <span className="donut__amount">{fmt.money(c.netMinor)}</span>
              <span className="donut__pct">{c.percent} %</span>
              <span className="donut__bar" aria-hidden="true">
                <span className={`donut__fill cat-dot--${color(c.categoryId)}`} style={{ width: `${Math.max(2, c.percent)}%` }} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Barras agrupadas: ingresos vs gastos                                */
/* ------------------------------------------------------------------ */

export function IncomeExpenseBars({ series, fmt, label, axisLabel, currentStart, onOpen }: { series: SeriesPoint[]; fmt: Formatter; label: (p: SeriesPoint) => string; axisLabel?: (p: SeriesPoint) => string | readonly string[]; currentStart?: string; onOpen?: (p: SeriesPoint) => void }) {
  const { t } = useT()
  const [active, setActive] = useState<number | null>(series.length - 1)
  const id = useId()
  if (fmt.privacy) return <HiddenChart />
  const W = 320
  const H = 156
  const pad = { l: 8, r: 8, t: 12, b: 26 }
  // Eje con signo: el gasto neto (gastos − devoluciones) puede ser negativo; su barra baja del cero en
  // lugar de tener una altura negativa (que el navegador no dibuja) y la tabla muestra la misma cifra.
  const { y, bar } = signedScale(series.flatMap((p) => [p.incomeMinor, p.expensesMinor]), pad.t, H - pad.b)
  const anyNegative = series.some((p) => p.expensesMinor < 0 || p.incomeMinor < 0)
  const group = (W - pad.l - pad.r) / Math.max(1, series.length)
  const bw = Math.max(6, Math.min(22, group * 0.32))
  // F-05: la etiqueta visible de cada punto según lo que cabe en su hueco (una forma más corta o una de cada k); la
  // completa (`label`) sigue en el nombre accesible, el tooltip y la tabla.
  const axisForms = series.map((p) => {
    const forms = (axisLabel ?? label)(p)
    return typeof forms === 'string' ? [forms] : forms
  })
  const shownAxis = pickAxisLabels(axisForms, group)
  const sel = active !== null ? series[active] : undefined
  return (
    <div className="bars">
      <svg viewBox={`0 0 ${W} ${H}`} className="bars__svg" role="group" aria-label={t('stats.barsAria', { count: series.length })}>
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="chart__axis" />
        {series.map((p, i) => {
          const cx = pad.l + group * i + group / 2
          return (
            <g key={p.range.start} className={`bars__group${active === i ? ' is-active' : ''}`}>
              <rect x={cx - bw - 1} {...bar(p.incomeMinor)} width={bw} className="bars__bar series-3" rx="2" />
              <rect x={cx + 1} {...bar(p.expensesMinor)} width={bw} className={`bars__bar series-2${p.expensesMinor < 0 ? ' bars__bar--negative' : ''}`} rx="2" data-value={p.expensesMinor} />
              {shownAxis[i] !== null && (
                <text x={cx} y={H - 7} textAnchor="middle" className="stats-axis">
                  {shownAxis[i]}
                </text>
              )}
              {/* Zona de toque de todo el grupo: un elemento con caja propia para teclado y lectores. */}
              <rect x={cx - group / 2} y={pad.t} width={group} height={H - pad.t} className="bars__hit" tabIndex={0} role="button" aria-label={`${label(p)}: ${t('stats.income')} ${fmt.money(p.incomeMinor)} · ${t('stats.expenses')} ${fmt.money(p.expensesMinor)}`} aria-describedby={`${id}-tip`} onClick={() => setActive(i)} onFocus={() => setActive(i)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive(i) } }} />
            </g>
          )
        })}
      </svg>
      {anyNegative && (
        <p className="note bars__note" data-testid="bars-negative-note">
          <Icon name="info" size={14} /> {t('stats.netNegative')}
        </p>
      )}
      <p className="bars__tip" id={`${id}-tip`} aria-live="polite" data-testid="bars-tooltip">
        {sel ? `${label(sel)} — ${t('stats.income')} ${fmt.money(sel.incomeMinor)} · ${t('stats.expenses')} ${fmt.money(sel.expensesMinor)}` : ''}
      </p>
      {sel && onOpen && sel.range.start !== currentStart && (
        <button type="button" className="btn btn--ghost btn--small bars__open" onClick={() => onOpen(sel)} data-testid="bars-open">
          {t('stats.openPeriod', { label: label(sel) })}
        </button>
      )}
      <ul className="legend" aria-hidden="true">
        <li>
          <span className="legend__swatch series-3" /> {t('stats.income')}
        </li>
        <li>
          <span className="legend__swatch series-2" /> {t('stats.expenses')}
        </li>
      </ul>
      <TableToggle>
        <table className="data-table">
          <caption className="sr-only">{t('stats.barsTitle')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('stats.period')}</th>
              <th scope="col">{t('stats.income')}</th>
              <th scope="col">{t('stats.expenses')}</th>
            </tr>
          </thead>
          <tbody>
            {series.map((p) => (
              <tr key={p.range.start}>
                <td>{label(p)}</td>
                <td className="num">{fmt.money(p.incomeMinor)}</td>
                <td className="num">{fmt.money(p.expensesMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableToggle>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Tendencia acumulada                                                 */
/* ------------------------------------------------------------------ */

export function TrendLines({ trend, fmt, today }: { trend: TrendPoint[]; fmt: Formatter; today: string }) {
  const { t } = useT()
  if (fmt.privacy) return <HiddenChart />
  const W = 320
  const H = 140
  const pad = { l: 8, r: 8, t: 10, b: 18 }
  // Acumulado neto: con devoluciones puede bajar de cero; el eje lo incluye para no dibujar fuera.
  const { y } = signedScale(trend.flatMap((p) => [p.currentMinor ?? 0, p.previousMinor ?? 0]), pad.t, H - pad.b)
  const x = (i: number) => pad.l + (trend.length === 1 ? 0 : (i * (W - pad.l - pad.r)) / (trend.length - 1))
  const negative = trend.some((p) => (p.currentMinor ?? 0) < 0 || (p.previousMinor ?? 0) < 0)
  const line = (pick: (p: TrendPoint) => number | null) => trend.map((p, i) => (pick(p) === null ? null : `${x(i).toFixed(1)},${y(pick(p)!).toFixed(1)}`)).filter((s) => s !== null).join(' ')
  const lastCur = [...trend].reverse().find((p) => p.currentMinor !== null)
  const lastPrev = [...trend].reverse().find((p) => p.previousMinor !== null)
  return (
    <div className="trend">
      <svg viewBox={`0 0 ${W} ${H}`} className="trend__svg" role="img" aria-label={t('stats.trendAria', { current: fmt.money(lastCur?.currentMinor ?? 0), previous: fmt.money(lastPrev?.previousMinor ?? 0) })}>
        {negative && <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="chart__axis" />}
        <polyline points={line((p) => p.previousMinor)} fill="none" className="trend__prev" />
        <polyline points={line((p) => p.currentMinor)} fill="none" className="trend__cur" />
      </svg>
      <ul className="legend" aria-hidden="true">
        <li>
          <span className="legend__swatch series-1" /> {t('stats.thisPeriod')}
        </li>
        <li>
          <span className="legend__swatch legend__swatch--ideal" /> {t('stats.previousPeriod')}
        </li>
      </ul>
      <TableToggle>
        <table className="data-table">
          <caption className="sr-only">{t('stats.trendTitle')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('stats.day')}</th>
              <th scope="col">{t('stats.thisPeriod')}</th>
              <th scope="col">{t('stats.previousPeriod')}</th>
            </tr>
          </thead>
          <tbody>
            {trend
              .filter((p) => p.currentMinor !== null || p.previousMinor !== null)
              .map((p) => (
                <tr key={p.day}>
                  <td>{fmt.date(p.date, { compact: true, today })}</td>
                  <td className="num">{p.currentMinor === null ? '—' : fmt.money(p.currentMinor)}</td>
                  <td className="num">{p.previousMinor === null ? '—' : fmt.money(p.previousMinor)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </TableToggle>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Saldo futuro a 90 días con banda                                    */
/* ------------------------------------------------------------------ */

export function FutureBalanceChart({ future, fmt, today }: { future: FutureBalance; fmt: Formatter; today: string }) {
  const { t } = useT()
  const [active, setActive] = useState(3)
  if (fmt.privacy) return <HiddenChart />
  const W = 320
  const H = 160
  const pad = { l: 8, r: 8, t: 12, b: 22 }
  const all = future.points.flatMap((p) => [p.optimisticMinor, p.pessimisticMinor])
  const max = Math.max(1, ...all)
  const min = Math.min(0, ...all)
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, future.points.length - 1)
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - min) / (max - min || 1))
  const upper = future.points.map((p, i) => `${x(i).toFixed(1)},${y(p.optimisticMinor).toFixed(1)}`)
  const lower = [...future.points].reverse().map((p, i) => `${x(future.points.length - 1 - i).toFixed(1)},${y(p.pessimisticMinor).toFixed(1)}`)
  const base = future.points.map((p, i) => `${x(i).toFixed(1)},${y(p.baseMinor).toFixed(1)}`).join(' ')
  const markIndex = [0, 30, 60, 90].map((d) => Math.min(d, future.points.length - 1))
  const sel = future.marks[active] ?? future.marks[future.marks.length - 1]!
  const markLabel = (i: number) => (i === 0 ? t('stats.today') : t('stats.inDays', { days: [0, 30, 60, 90][i] ?? 0 }))
  return (
    <div className="future">
      <svg viewBox={`0 0 ${W} ${H}`} className="future__svg" role="group" aria-label={t('stats.futureAria', { amount: fmt.money(future.marks[3]!.baseMinor), low: fmt.money(future.marks[3]!.pessimisticMinor), high: fmt.money(future.marks[3]!.optimisticMinor) })}>
        <polygon points={[...upper, ...lower].join(' ')} className="future__band" />
        {min < 0 && <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="chart__axis chart__axis--zero" />}
        <polyline points={base} fill="none" className="future__line" />
        {markIndex.map((idx, i) => (
          <g key={idx} className={`future__mark${active === i ? ' is-active' : ''}`}>
            <circle cx={x(idx)} cy={y(future.points[idx]!.baseMinor)} r="9" className="future__hit" tabIndex={0} role="button" aria-label={`${markLabel(i)}: ${fmt.money(future.points[idx]!.baseMinor)}`} onClick={() => setActive(i)} onFocus={() => setActive(i)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive(i) } }} />
            <circle cx={x(idx)} cy={y(future.points[idx]!.baseMinor)} r="5" className="future__dot" />
            <text x={x(idx)} y={H - 6} textAnchor={i === 0 ? 'start' : i === 3 ? 'end' : 'middle'} className="stats-axis">
              {markLabel(i)}
            </text>
          </g>
        ))}
      </svg>
      <p className="bars__tip" aria-live="polite" data-testid="future-tooltip">
        {t('stats.futureTip', { label: markLabel(active), amount: fmt.money(sel.baseMinor), low: fmt.money(sel.pessimisticMinor), high: fmt.money(sel.optimisticMinor) })}
      </p>
      <TableToggle>
        <table className="data-table">
          <caption className="sr-only">{t('stats.futureTitle')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('fields.date')}</th>
              <th scope="col">{t('stats.pessimistic')}</th>
              <th scope="col">{t('stats.base')}</th>
              <th scope="col">{t('stats.optimistic')}</th>
            </tr>
          </thead>
          <tbody>
            {future.marks.map((m, i) => (
              <tr key={m.date}>
                <td>{markLabel(i)} · {fmt.date(m.date, { compact: true, today })}</td>
                <td className="num">{fmt.money(m.pessimisticMinor)}</td>
                <td className="num">{fmt.money(m.baseMinor)}</td>
                <td className="num">{fmt.money(m.optimisticMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableToggle>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Meta: acumulado frente a la recta ideal (D7)                        */
/* ------------------------------------------------------------------ */

export function GoalChart({ trajectory, fmt, today }: { trajectory: GoalTrajectory; fmt: Formatter; today: string }) {
  const { t } = useT()
  if (fmt.privacy) return <HiddenChart />
  const W = 320
  const H = 120
  const pad = { l: 8, r: 8, t: 10, b: 18 }
  const end = trajectory.end && trajectory.end > today ? trajectory.end : today
  const span = Math.max(1, daysBetween(trajectory.start, end))
  const max = Math.max(1, trajectory.targetMinor, ...trajectory.points.map((p) => p.savedMinor))
  const x = (date: string) => pad.l + ((W - pad.l - pad.r) * Math.min(span, Math.max(0, daysBetween(trajectory.start, date)))) / span
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max)
  const saved = trajectory.points.map((p) => `${x(p.date).toFixed(1)},${y(p.savedMinor).toFixed(1)}`).join(' ')
  const ideal = trajectory.end ? `${x(trajectory.start).toFixed(1)},${y(0).toFixed(1)} ${x(trajectory.end).toFixed(1)},${y(trajectory.targetMinor).toFixed(1)}` : null
  const last = trajectory.points[trajectory.points.length - 1]!
  return (
    <div className="trend goal-chart" data-testid="goal-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="trend__svg" role="img" aria-label={t('goals.chartAria', { saved: fmt.money(last.savedMinor), target: fmt.money(trajectory.targetMinor), ideal: fmt.money(idealAt(trajectory, today)) })}>
        {ideal && <polyline points={ideal} fill="none" className="trend__prev" />}
        <polyline points={saved} fill="none" className="trend__cur" />
        <line x1={x(today)} x2={x(today)} y1={pad.t} y2={H - pad.b} className="goal-chart__today" />
      </svg>
      <ul className="legend" aria-hidden="true">
        <li>
          <span className="legend__swatch series-1" /> {t('goals.chartSaved')}
        </li>
        {ideal && (
          <li>
            <span className="legend__swatch legend__swatch--ideal" /> {t('goals.chartIdeal')}
          </li>
        )}
      </ul>
      <TableToggle>
        <table className="data-table">
          <caption className="sr-only">{t('goals.chartTitle')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('goals.chartDate')}</th>
              <th scope="col">{t('goals.chartSaved')}</th>
              {ideal && <th scope="col">{t('goals.chartIdeal')}</th>}
            </tr>
          </thead>
          <tbody>
            {trajectory.points.map((p) => (
              <tr key={p.date}>
                <td>{fmt.date(p.date, { compact: true, today })}</td>
                <td className="num">{fmt.money(p.savedMinor)}</td>
                {ideal && <td className="num">{fmt.money(idealAt(trajectory, p.date))}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </TableToggle>
    </div>
  )
}
