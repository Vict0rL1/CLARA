import { useState } from 'react'
import { backupStatus } from '../domain/backupReminder'
import { useT } from '../i18n'
import { isNativeIOS } from '../platform'
import { useToday } from '../state/hooks'
import { useData } from '../state/store'
import { useExportBackup } from './backupActions'
import { Card } from './components/common'
import { Icon } from './components/Icon'
import { usePersistStatus } from './persist'

/**
 * K3 · «Protege tus datos», una vez por dispositivo: pedir al navegador que conserve los datos y
 * hacer la primera copia (con la hoja de compartir si existe, K1). Cada paso dice su resultado tal
 * cual; el recordatorio de copias sigue igual. Dentro de la app de iPhone solo queda la copia.
 */
export function SafetyCard({ onClose }: { onClose: () => void }) {
  const { t } = useT()
  const data = useData()
  const today = useToday()
  const { status, request } = usePersistStatus()
  const exportBackup = useExportBackup()
  const [exporting, setExporting] = useState(false)
  const exported = !backupStatus(data, today).neverExported
  const native = isNativeIOS()
  return (
    <Card labelledBy="safety-title">
      <div className="stack-sm" data-testid="safety-card">
        <h2 id="safety-title" className="card__title">
          <Icon name="shield" size={18} /> {t('safety.title')}
        </h2>
        <p>{t('safety.text')}</p>
        {/* En la app de iPhone los datos van en un archivo propio: no hay nada que pedirle al navegador (decisión 164). */}
        {!native && <h3 className="section-title">{t('safety.step1')}</h3>}
        {!native && status !== 'checking' && (
          <p data-testid="safety-persist" data-status={status}>
            <Icon name={status === 'granted' ? 'check' : 'info'} size={16} /> {t(`settings.storage.persist.${status}` as 'settings.storage.persist.granted')}
          </p>
        )}
        {!native && status === 'notGranted' && (
          <div className="button-row">
            <button type="button" className="btn btn--secondary" onClick={() => void request()}>
              {t('settings.storage.persist.request')}
            </button>
          </div>
        )}
        <h3 className="section-title">{t('safety.step2')}</h3>
        <p data-testid="safety-backup" data-done={exported ? 'yes' : 'no'}>
          <Icon name={exported ? 'check' : 'info'} size={16} /> {t(exported ? 'safety.backupDone' : 'safety.backupNotYet')}
        </p>
        {!exported && (
          <div className="button-row">
            <button
              type="button"
              className="btn btn--primary"
              disabled={exporting}
              onClick={async () => {
                setExporting(true)
                await exportBackup()
                setExporting(false)
              }}
            >
              <Icon name="download" />
              {t('settings.backup.export')}
            </button>
          </div>
        )}
        <p className="note">{t('safety.reminder')}</p>
        <div className="button-row">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            {t(exported || (!native && status === 'granted') ? 'safety.done' : 'safety.later')}
          </button>
        </div>
      </div>
    </Card>
  )
}
