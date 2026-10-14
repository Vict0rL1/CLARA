/**
 * Centro de datos y recuperación (etapa 4): un solo sitio que dice dónde están los datos, qué los
 * protege y en qué orden recuperarlos. El cálculo es `domain/recovery.ts`; aquí solo se recogen los
 * datos que únicamente el navegador conoce (motor, copias locales, clave previa a migración, errores).
 */
import { recoveryStatus, type RecoveryRow, type RecoveryState, type RecoveryStep } from '../../../domain/recovery'
import { SCHEMA_VERSION } from '../../../domain/types'
import { useT, type MessageKey } from '../../../i18n'
import { PRE_MIGRATION_KEY_PREFIX } from '../../../storage/localStorageRepository'
import { usePwaState } from '../../../pwa/register'
import { useToday } from '../../../state/hooks'
import { getStore, useData } from '../../../state/store'
import { useExportBackup } from '../../backupActions'
import { Alert, Card, type Tone } from '../../components/common'
import { Icon, type IconName } from '../../components/Icon'
import { readErrors } from '../../errorLog'
import { useFormat } from '../../format'
import { href } from '../../router'
import { useLocalBackupList } from '../../useAutoBackup'
import { StorageCard } from './StorageCard'
import { downloadText } from '../../backupActions'

const TONE: Record<RecoveryState, Tone> = { ok: 'good', info: 'info', warn: 'warning', critical: 'critical' }
const ICON: Record<RecoveryState, IconName> = { ok: 'checkCircle', info: 'info', warn: 'alert', critical: 'alert' }

const PRE_MIGRATION_KEY = `${PRE_MIGRATION_KEY_PREFIX}${SCHEMA_VERSION}`

function readPreMigrationCopy(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(PRE_MIGRATION_KEY)
  } catch {
    return null
  }
}

export function DataCenterSection() {
  const { t, tn } = useT()
  const fmt = useFormat()
  const data = useData()
  const today = useToday()
  const pwa = usePwaState()
  const exportData = useExportBackup()
  const { list, available } = useLocalBackupList()
  const localCopies = !available ? null : { count: list?.length ?? 0, lastCreatedAt: list?.[0]?.createdAt ?? null }
  const preMigration = readPreMigrationCopy()
  const status = recoveryStatus({ data, today, backend: getStore().backend, localCopies, preMigrationCopy: preMigration !== null, errorCount: readErrors().length, offlineReady: pwa.offlineReady })
  // Descarga el texto exacto anterior a la migración (ROLLBACK.md); no modifica nada.
  const downloadPreMigration = () => {
    if (preMigration !== null) downloadText(`clara-datos-antes-de-v${SCHEMA_VERSION}.json`, preMigration)
  }

  const rowText = (r: RecoveryRow): string => {
    const p = r.params
    const when = (iso: unknown) => (iso ? fmt.timestamp(String(iso)) : '—')
    switch (r.id) {
      case 'saving':
        return r.state === 'critical' ? t('data.row.saving.critical') : t('data.row.saving.ok', { backend: t(`data.backend.${String(p.backend)}` as MessageKey) })
      case 'export':
        return p.demo ? t('data.row.export.demo') : r.state === 'critical' ? t('data.row.export.critical') : t(r.state === 'warn' ? 'data.row.export.warn' : 'data.row.export.ok', { when: when(p.lastExport) })
      case 'verified':
        return data.isDemo ? t('data.row.verified.demo') : r.state === 'warn' ? t('data.row.verified.warn') : t(r.state === 'info' ? 'data.row.verified.info' : 'data.row.verified.ok', { when: when(p.lastVerified) })
      case 'localCopies':
        return r.state === 'warn' ? t('data.row.localCopies.warn') : r.state === 'info' ? t('data.row.localCopies.info') : tn('data.row.localCopies.ok', Number(p.count), { when: when(p.last) })
      case 'preMigration':
        return r.state === 'ok' ? t('data.row.preMigration.ok', { version: Number(p.version) }) : t('data.row.preMigration.info')
      case 'schema':
        return t('data.row.schema', { version: Number(p.version) })
      case 'records':
        return t('data.row.records', { transactions: Number(p.transactions), accounts: Number(p.accounts), schedules: Number(p.schedules), goals: Number(p.goals) })
      case 'trash':
        return r.state === 'ok' ? t('data.row.trash.ok') : tn('data.row.trash.info', Number(p.count))
      case 'history':
        return tn('data.row.history', Number(p.count))
      case 'errors':
        return r.state === 'ok' ? t('data.row.errors.ok') : tn('data.row.errors.info', Number(p.count))
      case 'offline':
        return t(r.state === 'ok' ? 'data.row.offline.ok' : 'data.row.offline.info')
    }
  }
  const stepText = (s: RecoveryStep): string => t(`data.step.${s.id}`, { version: Number(s.params.version ?? data.schemaVersion) })

  return (
    <div className="stack">
      <Card labelledBy="datos">
        <h2 id="datos" className="card__title">
          {t('settings.toc.data')}
        </h2>
        <p>{t('data.intro')}</p>
        <Alert tone={TONE[status.overall]} icon={ICON[status.overall]} title={t(`data.overall.${status.overall}`)} role="status" />
        <h3 className="field__label">{t('data.rows.title')}</h3>
        <ul className="data-rows" data-testid="data-rows">
          {status.rows.map((r) => (
            <li key={r.id} className={`data-row data-row--${r.state}`} data-testid={`data-row-${r.id}`} data-state={r.state}>
              <Icon name={ICON[r.state]} size={18} className="data-row__icon" />
              {r.href ? (
                <a className="data-row__text" href={href(r.href)}>
                  {rowText(r)}
                </a>
              ) : (
                <span className="data-row__text">{rowText(r)}</span>
              )}
            </li>
          ))}
        </ul>
        <div className="button-row">
          <button type="button" className="btn btn--primary" onClick={() => void exportData()}>
            <Icon name="download" />
            {t('data.actions.export')}
          </button>
          <a className="btn btn--secondary" href={href('/ajustes/copia')}>
            <Icon name="shield" />
            {t('data.actions.backup')}
          </a>
        </div>
      </Card>
      <Card labelledBy="data-steps-title">
        <h2 id="data-steps-title" className="card__title">
          {t('data.steps.title')}
        </h2>
        <ol className="data-steps" data-testid="data-steps">
          {status.steps.map((s) => (
            <li key={s.id} className={s.available ? '' : 'muted'} data-available={s.available ? 'true' : 'false'}>
              {!s.available ? (
                `${stepText(s)} · ${t('data.step.unavailable')}`
              ) : s.href ? (
                <a href={href(s.href)}>{stepText(s)}</a>
              ) : (
                <>
                  {stepText(s)}{' '}
                  <button type="button" className="btn btn--secondary btn--small" onClick={downloadPreMigration}>
                    <Icon name="download" size={16} />
                    {t('data.preMigration.download')}
                  </button>
                </>
              )}
            </li>
          ))}
        </ol>
        <p className="note">{t('data.limits')}</p>
      </Card>
      <StorageCard />
    </div>
  )
}
