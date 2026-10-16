/**
 * Gráficos en SVG sin librerías. Reglas (guía de visualización):
 * marcas finas, cuadrícula tenue y sólida, etiquetas selectivas, texto en
 * colores de texto (nunca en el color de la serie) y una alternativa en texto/tabla.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { ProjectionResult } from '../../domain/projection'
import { useT } from '../../i18n'
import type { Formatter } from '../format'
import { planItemName } from '../labels'
import { Icon } from './Icon'

/* ------------------------------------------------------------------ */
/* Barra de composición: ¿en qué se va tu saldo?                        */
/* ------------------------------------------------------------------ */

/** En modo privado los gráficos no se dibujan: sus proporciones también revelan importes. */
function HiddenChart() {
  const { t } = useT()
  return (
    <p className="note note--icon chart-hidden" data-testid="chart-hidden">
      <Icon name="lock" size={16} /> {t('privacy.chartHidden')}
    </p>
  )
}

export function CompositionBar(props: Parameters<typeof CompositionBarInner>[0]) {
  return props.fmt.privacy ? <HiddenChart /> : <CompositionBarInner {...props} />
}

function CompositionBarInner({
  spendableMinor,
  reservedMinor,
  goalsMinor,
  bufferMinor = 0,
  availableMinor,
  fmt,
}: {
  spendableMinor: number
  reservedMinor: number
  goalsMinor: number
  /** Colchón de seguridad (Clara 2.0 §10); solo aparece si es mayor que 0. */
  bufferMinor?: number
  availableMinor: number
  fmt: Formatter
}) {
  const { t } = useT()
  const free = Math.max(0, availableMinor)
  const shortage = Math.max(0, -availableMinor)
  const total = reservedMinor + goalsMinor + bufferMinor + free
  const segments = [
    { key: 'reserved', label: t('home.composition.reserved'), value: reservedMinor, cls: 'series-1' },
    { key: 'goals', label: t('home.composition.goals'), value: goalsMinor, cls: 'series-2' },
    ...(bufferMinor > 0 ? [{ key: 'buffer', label: t('home.composition.buffer'), value: bufferMinor, cls: 'series-buffer' }] : []),
    { key: 'free', label: t('home.composition.free'), value: free, cls: 'series-3' },
  ]
  const summary = t(bufferMinor > 0 ? 'home.composition.ariaBuffer' : 'home.composition.aria', {
    balance: fmt.money(spendableMinor),
    reserved: fmt.money(reservedMinor),
    goals: fmt.money(goalsMinor),
    buffer: fmt.money(bufferMinor),
    free: fmt.money(availableMinor),
  })
  // Si faltan fondos, se marca hasta dónde llega el saldo real.
  const balanceMark = shortage > 0 && total > 0 ? Math.max(0, Math.min(1, spendableMinor / total)) : null

  return (
    <figure className="composition">
      <figcaption className="composition__title">{t('home.composition.titleWithBalance', { balance: fmt.money(spendableMinor) })}</figcaption>
      {total > 0 ? (
        <div className="composition__bar" role="img" aria-label={summary}>
          {segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <span
                key={s.key}
                className={`composition__seg ${s.cls}`}
                style={{ flexGrow: s.value, flexBasis: 0 }}
                data-tip={`${s.label}: ${fmt.money(s.value)}`}
              />
            ))}
          {balanceMark !== null && <span className="composition__mark" style={{ left: `${balanceMark * 100}%` }} aria-hidden="true" />}
        </div>
      ) : (
        <p className="note">{t('home.composition.empty')}</p>
      )}
      <ul className="legend">
        {segments.map((s) => (
          <li key={s.key}>
            <span className={`legend__swatch ${s.cls}`} aria-hidden="true" />
            <span className="legend__label">{s.label}</span>
            <span className="legend__value">{fmt.money(s.value)}</span>
          </li>
        ))}
        {shortage > 0 && (
          <li className="legend__shortage">
            <span className="legend__swatch legend__swatch--mark" aria-hidden="true" />
            <span className="legend__label">{t('home.composition.shortage')}</span>
            <span className="legend__value">{fmt.money(shortage)}</span>
          </li>
        )}
      </ul>
    </figure>
  )
}

/* ------------------------------------------------------------------ */
/* Proyección de saldo                                                 */
/* ------------------------------------------------------------------ */

function useElementWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(Math.max(260, Math.round(el.getBoundingClientRect().width)))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

/** Marcas "redondas" para el eje Y (1, 2, 2.5, 5 × 10^n), en unidades menores. */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) max = min + 100
  const span = max - min
  const raw = span / count
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw
  const start = Math.floor(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v))
  return ticks
}

export function ProjectionChart(props: { projection: ProjectionResult; fmt: Formatter; today: string }) {
  return props.fmt.privacy ? <HiddenChart /> : <ProjectionChartInner {...props} />
}

function ProjectionChartInner({ projection, fmt, today }: { projection: ProjectionResult; fmt: Formatter; today: string }) {
  const { t } = useT()
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const scrubRef = useRef<HTMLInputElement>(null)
  const height = 240
  const m = { top: 20, right: 16, bottom: 30, left: 64 }
  const innerW = width - m.left - m.right
  const innerH = height - m.top - m.bottom
  const days = projection.days
  // El primer punto es el saldo real de hoy (antes de lo previsto para hoy).
  const points = useMemo(() => [{ date: today, value: projection.startMinor, real: true }, ...days.map((d) => ({ date: d.date, value: d.endMinor, real: false }))], [days, projection.startMinor, today])

  const values = points.map((p) => p.value)
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values))
  const yMin = ticks[0]!
  const yMax = ticks[ticks.length - 1]!
  const x = (i: number) => m.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * innerW)
  const y = (v: number) => m.top + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`
  const lowestIndex = points.reduce((best, p, i) => (p.value < points[best]!.value ? i : best), 0)
  const hasNegative = values.some((v) => v < 0)
  const xTickEvery = width < 420 ? 14 : 7

  const setFromPointer = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const rel = (e.clientX - rect.left) / rect.width
    setActive(Math.max(0, Math.min(points.length - 1, Math.round(rel * (points.length - 1)))))
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') setActive(null)
  }

  const activePoint = active !== null ? points[active] : null
  const activeDay = active !== null && active > 0 ? days[active - 1] : null
  const tooltipLeft = active !== null ? Math.min(Math.max(x(active), 90), width - 90) : 0

  const label = (i: number, text: string, anchor: 'start' | 'end' | 'middle' = 'start', dy = -10) => (
    <text x={x(i)} y={y(points[i]!.value) + dy} textAnchor={anchor} className="chart__label">
      {text}
    </text>
  )

  return (
    <figure className="chart">
      <div className="chart__legend" aria-hidden="true">
        <span className="chart__key">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <circle cx="6" cy="6" r="4" className="chart__dot" />
          </svg>
          {t('projection.chart.realKey')}
        </span>
        <span className="chart__key">
          <svg width="24" height="12" viewBox="0 0 24 12">
            <line x1="0" y1="6" x2="24" y2="6" className="chart__line" />
          </svg>
          {t('projection.chart.projectedKey')}
        </span>
      </div>
      <div ref={ref} className="chart__frame">
        <svg width={width} height={height} role="img" aria-label={t('projection.chart.aria', { lowest: fmt.money(projection.lowest.minor), date: fmt.date(projection.lowest.date) })}>
          {hasNegative && <rect x={m.left} y={y(0)} width={innerW} height={Math.max(0, y(yMin) - y(0))} className="chart__negative" />}
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={m.left} x2={width - m.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? 'chart__zero' : 'chart__grid'} />
              <text x={m.left - 8} y={y(tick) + 4} textAnchor="end" className="chart__tick">
                {fmt.money(tick).replace(/[.,]00(?=\D*$)/, '')}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            i > 0 && (i - 1) % xTickEvery === 0 ? (
              <text key={p.date + i} x={x(i)} y={height - 8} textAnchor="middle" className="chart__tick">
                {fmt.date(p.date, { compact: true, today })}
              </text>
            ) : null,
          )}
          {hasNegative && (
            <text x={m.left + 6} y={Math.min(y(0) + 16, height - m.bottom - 4)} textAnchor="start" className="chart__label chart__label--critical">
              {t('projection.chart.negativeZone')}
            </text>
          )}
          <path d={areaPath} className="chart__area" />
          <path d={linePath} className="chart__line" />
          <circle cx={x(0)} cy={y(points[0]!.value)} r={5} className="chart__dot" />
          {label(0, t('projection.chart.todayLabel', { amount: fmt.money(points[0]!.value) }), 'start', -12)}
          {lowestIndex > 0 && (
            <>
              <circle cx={x(lowestIndex)} cy={y(points[lowestIndex]!.value)} r={5} className={points[lowestIndex]!.value < 0 ? 'chart__dot chart__dot--critical' : 'chart__dot'} />
              {label(
                lowestIndex,
                t('projection.chart.lowestLabel', { amount: fmt.money(points[lowestIndex]!.value) }),
                lowestIndex > points.length * 0.7 ? 'end' : 'middle',
                points[lowestIndex]!.value < 0 ? 20 : -12,
              )}
            </>
          )}
          {activePoint && active !== null && (
            <g aria-hidden="true">
              <line x1={x(active)} x2={x(active)} y1={m.top} y2={height - m.bottom} className="chart__crosshair" />
              <circle cx={x(active)} cy={y(activePoint.value)} r={5} className="chart__dot" />
            </g>
          )}
          <rect
            x={m.left}
            y={m.top}
            width={innerW}
            height={innerH}
            className="chart__hit"
            aria-hidden="true"
            onPointerMove={setFromPointer}
            onPointerDown={setFromPointer}
            onPointerLeave={() => {
              if (document.activeElement !== scrubRef.current) setActive(null)
            }}
          />
        </svg>
        {activePoint && active !== null && (
          <div className="chart__tooltip" style={{ left: tooltipLeft }} aria-hidden="true">
            <p className="chart__tooltip-value">{fmt.money(activePoint.value)}</p>
            <p className="chart__tooltip-date">
              {fmt.date(activePoint.date, { weekday: true })} · {activePoint.real ? t('projection.chart.real') : t('projection.chart.projected')}
            </p>
            {activeDay && activeDay.events.length > 0 && (
              <ul>
                {activeDay.events.slice(0, 4).map((e) => (
                  <li key={e.key}>
                    {planItemName(e, t)}: {fmt.money(e.budgetEffectMinor, { sign: true })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <label className="chart__scrub">
        <span className="chart__scrub-label">{t('projection.chart.sliderLabel')}</span>
        <input
          ref={scrubRef}
          type="range"
          min={0}
          max={points.length - 1}
          step={1}
          value={active ?? 0}
          aria-valuetext={`${fmt.date((activePoint ?? points[0]!).date)}: ${fmt.money((activePoint ?? points[0]!).value)}`}
          onChange={(e) => setActive(Number(e.target.value))}
          onFocus={() => setActive((cur) => cur ?? 0)}
          onBlur={() => setActive(null)}
          onKeyDown={onKey}
        />
      </label>
    </figure>
  )
}
