/** Ajustes › Bloqueo (§7.7): PIN del dispositivo y, si existe, biometría (WebAuthn en el navegador; Face ID o Touch ID en la app de iPhone). No cifra los datos. */
import { useEffect, useState } from 'react'
import { updateSettings } from '../../../domain/operations'
import { useT } from '../../../i18n'
import { useRun } from '../../../state/hooks'
import { Toggle } from '../../components/base'
import { Alert, Card } from '../../components/common'
import { Dialog } from '../../components/Dialog'
import { TextField } from '../../components/fields'
import { Icon } from '../../components/Icon'
import { useToast } from '../../components/toastContext'
import { createLockConfig, isValidPin, PIN_MAX, PIN_MIN, type LockConfig } from '../../lock/pin'
import { lockBiometrics } from '../../lock/biometric'
import type { LockState } from '../../lock/useLock'

export function LockSection({ lock }: { lock: LockState }) {
  const { t } = useT()
  const run = useRun()
  const toast = useToast()
  const [dialog, setDialog] = useState(false)
  const [biometricOk, setBiometricOk] = useState(false)
  // En el navegador, WebAuthn; en la app de iPhone, Face ID o Touch ID del sistema (decisión 165).
  const [biometrics] = useState(lockBiometrics)
  useEffect(() => {
    void biometrics.available().then(setBiometricOk)
  }, [biometrics])

  const apply = async (config: LockConfig | null) => {
    if (!lock.setConfig(config)) {
      toast({ message: t('lock.storageFailed'), tone: 'critical' })
      return false
    }
    await run((d, c) => updateSettings(d, { biometricLock: config !== null }, c))
    return true
  }

  const addBiometric = async () => {
    if (!lock.config) return
    const id = await biometrics.register(t('lock.unlock'))
    if (!id) {
      toast({ message: t('lock.biometricNotRegistered'), tone: 'critical' })
      return
    }
    await apply({ ...lock.config, credentialId: id })
    toast({ message: t('lock.biometricRegistered'), tone: 'good' })
  }

  return (
    <Card labelledBy="lock-title">
      <h2 id="bloqueo" className="card__title">
        <span id="lock-title">{t('lock.sectionTitle')}</span>
      </h2>
      <p className="note">{t('lock.sectionIntro')}</p>
      <Alert tone="neutral" icon="info" title={t('lock.notEncryption')} />
      <Toggle
        checked={lock.config !== null}
        onChange={(on) => {
          if (on) setDialog(true)
          else void apply(null).then((ok) => ok && toast({ message: t('lock.removed'), tone: 'info' }))
        }}
        label={t('lock.enable')}
        hint={t('lock.enableHint')}
      />
      {lock.config && (
        <div className="stack-sm">
          <button type="button" className="btn btn--secondary btn--small" onClick={() => setDialog(true)}>
            <Icon name="edit" size={16} />
            {t('lock.changePin')}
          </button>
          {biometricOk ? (
            biometrics.canVerify(lock.config.credentialId) ? (
              <p className="note note--icon">
                <Icon name="checkCircle" size={16} /> {t('lock.biometricOn')}
              </p>
            ) : (
              <button type="button" className="btn btn--secondary btn--small" onClick={() => void addBiometric()}>
                <Icon name="shield" size={16} />
                {t('lock.addBiometric')}
              </button>
            )
          ) : (
            <p className="note">{t('lock.biometricUnavailable')}</p>
          )}
        </div>
      )}
      {dialog && (
        <PinDialog
          onClose={() => setDialog(false)}
          onSave={async (pin) => {
            const config = await createLockConfig(pin)
            const ok = await apply({ ...config, ...(lock.config?.credentialId ? { credentialId: lock.config.credentialId } : {}) })
            if (ok) toast({ message: t('lock.pinSaved'), tone: 'good' })
            setDialog(false)
          }}
        />
      )}
    </Card>
  )
}

function PinDialog({ onClose, onSave }: { onClose: () => void; onSave: (pin: string) => Promise<void> }) {
  const { t } = useT()
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (!isValidPin(pin)) return setError(t('lock.pinInvalid', { min: PIN_MIN, max: PIN_MAX }))
    if (pin !== confirm) return setError(t('lock.pinMismatch'))
    await onSave(pin)
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('lock.pinTitle')}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary">
            {t('common.save')}
          </button>
        </>
      }
    >
      <p className="note">{t('lock.pinText')}</p>
      <TextField label={t('lock.pin')} type="password" inputMode="numeric" autoComplete="new-password" value={pin} maxLength={PIN_MAX} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoFocus />
      <TextField label={t('lock.pinConfirm')} type="password" inputMode="numeric" autoComplete="new-password" value={confirm} maxLength={PIN_MAX} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))} error={error} />
    </Dialog>
  )
}
