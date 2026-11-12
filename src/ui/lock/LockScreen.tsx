/** Pantalla de bloqueo: PIN o biometría del dispositivo. Los datos no se muestran hasta desbloquear. */
import { useEffect, useState } from 'react'
import { useT } from '../../i18n'
import { Alert } from '../components/common'
import { Icon } from '../components/Icon'
import { verifyPin, PIN_MAX, type LockConfig } from './pin'
import { lockBiometrics } from './biometric'

export function LockScreen({ config, onUnlock }: { config: LockConfig; onUnlock: () => void }) {
  const { t } = useT()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [help, setHelp] = useState(false)
  // En el navegador, WebAuthn; en la app de iPhone, Face ID o Touch ID del sistema (decisión 165).
  const [biometrics] = useState(lockBiometrics)
  const biometric = biometrics.canVerify(config.credentialId)

  const submit = async () => {
    if (busy) return
    setBusy(true)
    const ok = await verifyPin(pin, config)
    setBusy(false)
    if (ok) onUnlock()
    else {
      setError(t('lock.wrongPin'))
      setPin('')
    }
  }
  const tryBiometric = async () => {
    if (!config.credentialId || busy) return
    setBusy(true)
    const ok = await biometrics.verify(config.credentialId, t('lock.unlock'))
    setBusy(false)
    if (ok) onUnlock()
    else setError(t('lock.biometricFailed'))
  }
  // Al abrir con biometría registrada se intenta directamente (el navegador pide la verificación).
  useEffect(() => {
    if (biometric) void tryBiometric()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="lock" data-testid="lock-screen">
      <form
        className="lock__card card"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <span className="lock__icon" aria-hidden="true">
          <Icon name="lock" size={32} />
        </span>
        <h1 id="page-title" className="lock__title">
          {t('lock.title')}
        </h1>
        <p className="note">{t('lock.text')}</p>
        <label className="field">
          <span className="field__label">{t('lock.pin')}</span>
          <input className="input lock__pin" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]*" maxLength={PIN_MAX} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} aria-invalid={error ? true : undefined} aria-describedby={error ? 'lock-error' : undefined} autoFocus />
        </label>
        {error && (
          <p className="field__error" id="lock-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary btn--large" disabled={busy || pin.length < 4}>
          {t('lock.unlock')}
        </button>
        {biometric && (
          <button type="button" className="btn btn--secondary btn--large" onClick={() => void tryBiometric()} disabled={busy}>
            <Icon name="shield" size={18} />
            {t('lock.useBiometric')}
          </button>
        )}
        <button type="button" className="btn btn--ghost btn--small" aria-expanded={help} onClick={() => setHelp((v) => !v)}>
          {t('lock.forgot')}
        </button>
        {help && (
          <Alert tone="info" title={t('lock.forgotTitle')}>
            {t('lock.forgotText')}
          </Alert>
        )}
      </form>
    </div>
  )
}
