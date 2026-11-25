/** Ajustes › Asistente (§8): proveedor en uso (local o remoto configurado al compilar), usos del mes y qué hace cada cosa. */
import { createAiProvider } from '../../../domain/aiProvider'
import { useT } from '../../../i18n'
import { useToday } from '../../../state/hooks'
import { useData } from '../../../state/store'
import { Card } from '../../components/common'
import { Icon } from '../../components/Icon'
import { DeviceAssistantStatus } from '../../deviceAssistant'
import { useDeviceAssistant } from '../../useDeviceAssistant'
import { ocrAvailable } from '../../ocr'
import { href } from '../../router'

const env = import.meta.env as { VITE_AI_ENDPOINT?: string; VITE_AI_KEY?: string }
const provider = createAiProvider(env)

function endpointHost(): string {
  try {
    return env.VITE_AI_ENDPOINT ? new URL(env.VITE_AI_ENDPOINT).host : ''
  } catch {
    return env.VITE_AI_ENDPOINT ?? ''
  }
}

export function AssistantSection() {
  const { t } = useT()
  const data = useData()
  const today = useToday()
  const usage = data.settings.aiUsage?.month === today.slice(0, 7) ? data.settings.aiUsage.count : 0
  const speech = typeof window !== 'undefined' && !!((window as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ?? (window as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition)
  // En la app de iPhone, el dictado y los recibos son los del teléfono: los dice «En este iPhone» (Fase 5).
  const device = useDeviceAssistant()
  return (
    <Card labelledBy="assistant-section-title">
      <h2 id="asistente" className="card__title">
        <span id="assistant-section-title">{t('assistantSettings.title')}</span>
      </h2>
      <ul className="bullets" data-testid="assistant-status">
        <li>{provider.id === 'remote' ? t('assistantSettings.remote', { host: endpointHost() }) : t('assistantSettings.local')}</li>
        {!device.active && <li>{t(speech ? 'assistantSettings.voiceOn' : 'assistantSettings.voiceOff')}</li>}
        {!device.active && <li>{t(ocrAvailable() ? 'assistantSettings.ocrOn' : 'assistantSettings.ocrOff')}</li>}
        <li>{t('assistantSettings.usage', { count: usage })}</li>
      </ul>
      <DeviceAssistantStatus device={device} />
      <p className="note">{t('assistantSettings.note')}</p>
      <a className="btn btn--secondary btn--small" href={href('/asistente?returnTo=/ajustes')}>
        <Icon name="sparkles" size={16} />
        {t('nav.assistant')}
      </a>
    </Card>
  )
}
