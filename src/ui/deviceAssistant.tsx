/**
 * El asistente en la app de iPhone (Fase 5, decisiones 187–189): los textos que explican qué ofrece ESTE iPhone
 * (`useDeviceAssistant`), del paquete diferido `device`. En el navegador `active` es `false` y no se dibuja nada.
 *
 * Lo que se enseña sale de lo que el iPhone RESPONDE (`availability`), nunca de suponerlo: un botón solo aparece si la
 * función está disponible, y si no, se dice por qué. `dt` es el traductor del paquete: sus claves son `DevicePackKey`
 * y `tsc` comprueba que existen en los cuatro idiomas (`packs/packKeys.ts`).
 */
import type { ParsedEntry } from '../domain/parser'
import { useT } from '../i18n'
import { setDeviceAiEnabled } from '../state/deviceAiSetting'
import { Badge } from './components/common'
import { Toggle } from './components/base'
import { PackLangScope } from './components/PackLangScope'
import { PackNotice } from './components/PackNotice'
import { useToast } from './components/toastContext'
import type { DeviceAssistant } from './useDeviceAssistant'

/** Debajo del campo del asistente: cómo se dicta en este iPhone, o por qué no se puede; y la IA, si está encendida. */
export function DeviceAssistantNotes({ device, voiceError, thinking }: { device: DeviceAssistant; voiceError: 'busy' | 'noOnDevice' | 'denied' | 'failed' | null; thinking: boolean }) {
  if (!device.active) return null
  if (!device.text) return device.pack.status === 'failed' ? <PackNotice state={device.pack} /> : null
  const dt = device.text
  return (
    <PackLangScope fallback={device.fallback}>
      <div data-testid="device-assistant-notes">
        {device.voice?.available === true && <p className="note">{dt('device.voice.hint')}</p>}
        {device.voice?.available === false && (
          <p className="note" data-testid="device-voice-unavailable">
            {dt(`device.voice.unavailable.${device.voice.reason}`)}
          </p>
        )}
        {voiceError && (
          <p className="field__error" role="alert" data-testid="device-voice-error">
            {dt(`device.voice.error.${voiceError}`)}
          </p>
        )}
        {device.scanner && <p className="note">{dt('device.scan.hint')}</p>}
        {device.aiReady && (
          <p className="note" data-testid="device-ai-on">
            {dt('device.ai.onNote')}
          </p>
        )}
        {thinking && (
          <p className="note" role="status" data-testid="device-ai-thinking">
            {dt('device.ai.thinking')}
          </p>
        )}
      </div>
    </PackLangScope>
  )
}

/** Qué pasó con la IA al analizar: lo propuso ella, o no respondió / propuso menos y se usó el analizador de siempre. */
export function DeviceAiOutcome({ device, outcome }: { device: DeviceAssistant; outcome: 'deviceAi' | 'aiFailed' | 'aiFewer' | null }) {
  if (!outcome || !device.text) return null
  const dt = device.text
  return (
    <PackLangScope fallback={device.fallback}>
      <p className="note" role="status" data-testid="device-ai-outcome" data-outcome={outcome}>
        {dt(outcome === 'deviceAi' ? 'device.ai.used' : outcome === 'aiFailed' ? 'device.ai.aiFailed' : 'device.ai.aiFewer')}
      </p>
    </PackLangScope>
  )
}

/** Lo que la IA puso en un recibo (total, fecha, comercio): la línea del recibo que citó para el total. */
export interface AiReceiptNotes {
  total?: string
  date?: boolean
  merchant?: boolean
}

/** En cada línea de la vista previa: la etiqueta «Sugerido por IA en tu iPhone» y qué campos hay que comprobar. */
export function DeviceLineNotes({ device, entry, receipt }: { device: DeviceAssistant; entry: ParsedEntry; receipt?: AiReceiptNotes }) {
  if (entry.suggestedBy !== 'deviceAi' || !device.text) return null
  const dt = device.text
  const notes: string[] = []
  if (entry.aiFields?.includes('amount')) notes.push(dt('device.ai.field.amount'))
  if (entry.aiFields?.includes('date')) notes.push(dt('device.ai.field.date'))
  if (receipt?.total) notes.push(dt('device.ai.receipt.total', { line: receipt.total }))
  if (receipt?.date) notes.push(dt('device.ai.receipt.date'))
  if (receipt?.merchant) notes.push(dt('device.ai.receipt.merchant'))
  return (
    <PackLangScope fallback={device.fallback}>
      <div className="stack-sm" data-testid="device-ai-line">
        <span>
          <Badge tone="info" icon="sparkles">
            {dt('device.ai.badge')}
          </Badge>
        </span>
        {notes.length > 0 && (
          <ul className="bullets assistant__hints">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>
    </PackLangScope>
  )
}

/**
 * Ajustes › Asistente en la app: qué hay de verdad en ESTE iPhone, y el interruptor de la IA solo si está disponible.
 * Mientras el iPhone no ha respondido, se dice que se está comprobando.
 */
export function DeviceAssistantStatus({ device }: { device: DeviceAssistant }) {
  const base = useT()
  const toast = useToast()
  if (!device.active) return null
  if (!device.text) return device.pack.status === 'failed' ? <PackNotice state={device.pack} /> : null
  const dt = device.text
  const change = (on: boolean) => {
    const ok = setDeviceAiEnabled(on)
    toast({ message: ok ? base.t('settings.saved') : dt('device.settings.aiSaveFailed'), tone: ok ? 'good' : 'critical' })
  }
  const checking = device.voice === null && device.ai === null
  return (
    <PackLangScope fallback={device.fallback}>
      <section className="stack-sm" aria-labelledby="device-assistant-title" data-testid="device-assistant-status">
        <h3 className="field__label" id="device-assistant-title">
          {dt('device.settings.title')}
        </h3>
        {checking && <p className="note">{dt('device.settings.checking')}</p>}
        <ul className="bullets">
          {device.voice && <li data-testid="device-status-voice">{device.voice.available ? dt('device.settings.voiceOn') : dt(`device.voice.unavailable.${device.voice.reason}`)}</li>}
          <li>{dt('device.settings.ocr')}</li>
          <li data-testid="device-status-scan">{dt(device.scanner ? 'device.settings.scanOn' : 'device.settings.scanOff')}</li>
          {device.ai && <li data-testid="device-status-ai">{device.ai.available ? dt('device.settings.aiOn') : dt(`device.settings.aiOff.${device.ai.reason}`)}</li>}
        </ul>
        {device.ai?.available === true && <Toggle checked={device.aiEnabled} onChange={change} label={dt('device.settings.aiToggle')} hint={dt('device.settings.aiToggleHint')} />}
      </section>
    </PackLangScope>
  )
}
