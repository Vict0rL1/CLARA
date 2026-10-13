/**
 * Almacenamiento y privacidad: dónde viven los datos, guardado persistente y la copia del origen
 * (localStorage antes de IndexedDB). Desde la etapa 4 forma parte del centro de datos y recuperación;
 * el enlace antiguo `/ajustes/almacenamiento` sigue llegando aquí.
 */
import { useState } from 'react'
import { useT } from '../../../i18n'
import { usePwaState } from '../../../pwa/register'
import { getStore, useAppState } from '../../../state/store'
import { IndexedDbRepository } from '../../../storage/indexedDbRepository'
import { downloadText } from '../../backupActions'
import { Alert, Card } from '../../components/common'
import { ConfirmDialog } from '../../components/Dialog'
import { Icon } from '../../components/Icon'
import { useToast } from '../../components/toastContext'
import { usePersistStatus } from '../../persist'
import { href } from '../../router'

export function StorageCard() {
  const { t } = useT()
  const state = useAppState()
  const pwa = usePwaState()
  return (
    <Card labelledBy="almacenamiento">
      <h2 id="almacenamiento" className="card__title">
        {t('settings.storage.title')}
      </h2>
      {state.phase === 'ready' && state.storage === 'memory' && <Alert tone="critical" title={t('shell.memoryTitle')}>{t('shell.memoryText')}</Alert>}
      <ul className="bullets">
        <li>{t('settings.storage.local')}</li>
        {getStore().backend !== 'memory' && <li data-testid="storage-backend">{t(getStore().backend === 'indexeddb' ? 'settings.storage.backend.indexeddb' : 'settings.storage.backend.localStorage')}</li>}
        <li>{t('settings.storage.lost')}</li>
        <li>{t('settings.storage.noSync')}</li>
        <li>{t('settings.storage.eviction')}</li>
        <li>{t('settings.storage.notEncrypted')}</li>
        <li>{t(pwa.offlineReady ? 'settings.storage.offlineReady' : 'settings.storage.offlineNotReady')}</li>
        <li>{t('settings.storage.noAccount')}</li>
        <li>{t('settings.storage.noBank')}</li>
        <li>{t('settings.storage.noAi')}</li>
      </ul>
      <PersistentStorage />
      <OriginCopy />
      <p className="note">{t('history.openHint')}</p>
      <a className="btn btn--secondary" href={href('/ajustes/historial')}>
        <Icon name="clock" size={18} />
        {t('history.open')}
      </a>
    </Card>
  )
}

function PersistentStorage() {
  const { t } = useT()
  const { status, request } = usePersistStatus()
  if (status === 'checking') return null
  return (
    <div className="stack-sm" data-testid="persist-storage">
      <p>
        <Icon name={status === 'granted' ? 'check' : 'info'} size={16} /> {t(`settings.storage.persist.${status}` as 'settings.storage.persist.granted')}
      </p>
      {status === 'notGranted' && (
        <button type="button" className="btn btn--secondary" onClick={() => void request()}>
          {t('settings.storage.persist.request')}
        </button>
      )}
    </div>
  )
}

/**
 * Copia de los datos tal como estaban en localStorage antes de pasar a IndexedDB. Se conserva
 * hasta que la persona decida eliminarla (no se borra sola).
 */
function OriginCopy() {
  const { t } = useT()
  const toast = useToast()
  const [copy, setCopy] = useState(() => IndexedDbRepository.readOriginCopy())
  const [confirming, setConfirming] = useState(false)
  if (!copy) return null
  return (
    <div className="stack-sm" data-testid="origin-copy">
      <p>
        <Icon name="info" size={16} /> {t('settings.storage.originCopy', { size: (copy.length / 1024 / 1024).toFixed(2) })}
      </p>
      <div className="button-row">
        <button type="button" className="btn btn--secondary btn--small" onClick={() => downloadText('clara-datos-anteriores-a-indexeddb.json', copy)}>
          <Icon name="download" size={16} />
          {t('settings.storage.originDownload')}
        </button>
        <button type="button" className="btn btn--danger-ghost btn--small" onClick={() => setConfirming(true)}>
          {t('settings.storage.originDelete')}
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        title={t('settings.storage.originDeleteTitle')}
        confirmLabel={t('settings.storage.originDelete')}
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          IndexedDbRepository.deleteOriginCopy()
          setCopy(null)
          setConfirming(false)
          toast({ message: t('settings.storage.originDeleted'), tone: 'good' })
        }}
      >
        <p>{t('settings.storage.originDeleteText')}</p>
      </ConfirmDialog>
    </div>
  )
}
