/**
 * Qué ofrece ESTE iPhone al asistente (Fase 5, decisiones 187–189): dictado en el teléfono, recibos con Vision y la
 * cámara de documentos, la IA de Apple Intelligence, y el paquete de textos `device`. En el navegador no hay servicios
 * nativos: `active` es `false` y no se pide el paquete. Lo que se enseña sale de lo que el iPhone RESPONDE
 * (`availability`), nunca de suponerlo. Los componentes que lo dicen están en `deviceAssistant.tsx`.
 */
import { useEffect, useMemo, useState } from 'react'
import { useT, type Params } from '../i18n'
import { usePack, type PackState } from '../i18n/packs'
import type { DevicePackKey } from '../i18n/packs/packKeys'
import type { DeviceAiAvailability, DictationAvailability } from '../platform/nativeAssistant'
import { useDeviceAiEnabled } from '../state/deviceAiSetting'
import { useNativeServices } from './useNativeServices'

export type DeviceText = (key: DevicePackKey, params?: Params) => string

export interface DeviceAssistant {
  /** ¿Hay algún servicio del iPhone? En el navegador, `false`. */
  active: boolean
  pack: PackState
  /** El traductor del paquete cuando ya cargó; antes (o si falla), `null` y no se enseña ningún texto del iPhone. */
  text: DeviceText | null
  fallback: boolean
  /** `null`: aún se está preguntando (o no hay dictado nativo). */
  voice: DictationAvailability | null
  scanner: boolean
  ai: DeviceAiAvailability | null
  /** La persona encendió «Usar la IA de este iPhone» (de este dispositivo). */
  aiEnabled: boolean
  /** La IA se usa al analizar: disponible en este iPhone y encendida. */
  aiReady: boolean
}

export function useDeviceAssistant(): DeviceAssistant {
  const { language } = useT()
  const native = useNativeServices()
  const active = !!(native.dictation || native.receipts || native.deviceAi)
  const pack = usePack('device', active)
  const [voice, setVoice] = useState<DictationAvailability | null>(null)
  const [scanner, setScanner] = useState(false)
  const [ai, setAi] = useState<DeviceAiAvailability | null>(null)
  const aiEnabled = useDeviceAiEnabled()

  useEffect(() => {
    const dictation = native.dictation
    if (!dictation) return
    let alive = true
    void dictation.availability(language).then((a) => alive && setVoice(a))
    return () => {
      alive = false
    }
  }, [native.dictation, language])
  useEffect(() => {
    const receipts = native.receipts
    if (!receipts) return
    let alive = true
    void receipts.scanner().then((s) => alive && setScanner(s))
    return () => {
      alive = false
    }
  }, [native.receipts])
  useEffect(() => {
    const deviceAi = native.deviceAi
    if (!deviceAi) return
    let alive = true
    void deviceAi.availability(language).then((a) => alive && setAi(a))
    return () => {
      alive = false
    }
  }, [native.deviceAi, language])

  const text = useMemo<DeviceText | null>(() => (pack.status === 'ready' ? (key, params) => pack.t(key, params) : null), [pack])
  return {
    active,
    pack,
    text,
    fallback: pack.status === 'ready' && pack.fallback,
    voice: native.dictation ? voice : null,
    scanner: !!native.receipts && scanner,
    ai: native.deviceAi ? ai : null,
    aiEnabled,
    aiReady: !!native.deviceAi && ai?.available === true && aiEnabled,
  }
}
