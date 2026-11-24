/**
 * Estadísticas › «Gastado por moneda» (Fase 3): solo si en el periodo hay algo pagado en otra moneda. Textos en el
 * paquete diferido `fx`. Las cifras salen de `spentByCurrency` (`domain/trips.ts`); las demás tarjetas siguen usando el
 * importe en la moneda del presupuesto.
 */
import type { TripCurrencyLine } from '../domain/trips'
import { PackBody } from './components/PackBody'
import { usePackT } from './components/packTexts'
import { useFormat } from './format'

export function StatsCurrencyCard({ lines, budget }: { lines: readonly TripCurrencyLine[]; budget: string }) {
  return (
    <section className="card" aria-labelledby="stats-currency-title" data-testid="stats-currency">
      <PackBody name="fx">
        <Body lines={lines} budget={budget} />
      </PackBody>
    </section>
  )
}

function Body({ lines, budget }: { lines: readonly TripCurrencyLine[]; budget: string }) {
  const { t, tn } = usePackT()
  const fmt = useFormat()
  return (
    <>
      <h2 id="stats-currency-title" className="section-title">
        {t('fx.stats.title')}
      </h2>
      <p className="note">{t('fx.stats.intro', { budget })}</p>
      <ul className="item-list">
        {lines.map((line) => (
          <li key={line.currency} className="item">
            <span className="item__main">
              <span className="item__title">{line.originalMinor === null ? `${line.currency} · ${t('fx.stats.noFigure')}` : fmt.moneyIn(line.originalMinor, line.currency)}</span>
              <span className="item__meta">{tn('fx.stats.count', line.count)}</span>
            </span>
            <span className="item__side">
              <span className="item__amount">{line.convertedMinor === null ? t('fx.stats.noFigure') : fmt.money(line.convertedMinor)}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}
