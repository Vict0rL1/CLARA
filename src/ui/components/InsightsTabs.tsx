/** Pestañas del destino «Análisis» (etapa 4): avisos, estadísticas, revisión semanal y ¿qué cambió? */
import { useT } from '../../i18n'
import { Icon, type IconName } from './Icon'
import { href } from '../router'

export type InsightsTab = 'avisos' | 'estadisticas' | 'revision' | 'cambios'

const TABS: { id: InsightsTab; path: string; key: 'insights.tab.overview' | 'insights.tab.stats' | 'insights.tab.weekly' | 'insights.tab.changes'; icon: IconName }[] = [
  { id: 'avisos', path: '/analisis', key: 'insights.tab.overview', icon: 'sparkles' },
  { id: 'estadisticas', path: '/estadisticas', key: 'insights.tab.stats', icon: 'chart' },
  { id: 'revision', path: '/revision', key: 'insights.tab.weekly', icon: 'calendar' },
  { id: 'cambios', path: '/cambios', key: 'insights.tab.changes', icon: 'trend' },
]

export function InsightsTabs({ active }: { active: InsightsTab }) {
  const { t } = useT()
  return (
    <nav className="tabs" aria-label={t('insights.tabsAria')} data-testid="insights-tabs">
      {TABS.map((x) => (
        <a key={x.id} className={`tabs__tab${active === x.id ? ' is-active' : ''}`} href={href(x.path)} aria-current={active === x.id ? 'page' : undefined}>
          <Icon name={x.icon} size={18} />
          {t(x.key)}
        </a>
      ))}
    </nav>
  )
}
