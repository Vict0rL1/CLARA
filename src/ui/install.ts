/**
 * Instalar Clara en la pantalla de inicio (K2). Solo usa lo que el navegador ofrece:
 * - iPhone/iPad: no hay botón posible; se explican los pasos de Safari y que la app instalada
 *   tiene sus propios datos, separados de Safari.
 * - Chrome/Edge (Android y escritorio): el evento `beforeinstallprompt` permite un botón real.
 * - En otro caso, instrucciones; nunca un botón que no haría nada.
 * Lo que se recuerda (tarjeta de Inicio descartada) es del dispositivo, no de los datos.
 */
import { useSyncExternalStore } from 'react'
import { daysBetween, localDateInTimeZone } from '../domain/dates'
import type { LocalDate } from '../domain/types'
import { isNativeApp } from '../pwa/nativeApp'

export type InstallMode = 'installed' | 'ios' | 'prompt' | 'manual'

export function isIos(nav: { userAgent: string; maxTouchPoints?: number }): boolean {
  if (/iPad|iPhone|iPod/.test(nav.userAgent)) return true
  // iPadOS se presenta como Mac de escritorio, pero con pantalla táctil.
  return /Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1
}

export function installMode(env: { standalone: boolean; ios: boolean; canPrompt: boolean }): InstallMode {
  if (env.standalone) return 'installed'
  if (env.ios) return 'ios'
  return env.canPrompt ? 'prompt' : 'manual'
}

/** Días naturales (en la zona horaria de la persona) desde que se creó el presupuesto. */
export function daysOfUse(createdAt: string, today: LocalDate, timeZone: string): number {
  return Math.max(0, daysBetween(localDateInTimeZone(new Date(createdAt), timeZone), today))
}

export const INSTALL_CARD_AFTER_DAYS = 3

export function showInstallCard(input: { mode: InstallMode; daysOfUse: number; dismissed: boolean; isDemo: boolean }): boolean {
  return input.mode !== 'installed' && !input.isDemo && !input.dismissed && input.daysOfUse >= INSTALL_CARD_AFTER_DAYS
}

/**
 * K3 · «Protege tus datos»: se pregunta una vez por dispositivo, justo después de la
 * configuración (el presupuesto se creó hoy) o al abrir por primera vez la app instalada.
 */
export function showSafetyCard(input: { isDemo: boolean; asked: boolean; daysOfUse: number; standalone: boolean }): boolean {
  return !input.isDemo && !input.asked && (input.daysOfUse === 0 || input.standalone)
}

/* ------------------------------------------------------------------ */
/* Navegador                                                           */
/* ------------------------------------------------------------------ */

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  // La app de iPhone (cáscara nativa) ya está instalada: nunca se enseñan los pasos de Safari ahí dentro.
  if (isNativeApp()) return true
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
}

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: InstallPromptEvent | null = null
let installedNow = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

/** Guarda el evento del navegador para ofrecer «Instalar» cuando la persona lo pida. */
export function captureInstallPrompt() {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as InstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installedNow = true
    notify()
  })
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred
  if (!event) return 'unavailable'
  await event.prompt()
  const { outcome } = await event.userChoice
  // El evento solo sirve una vez.
  deferred = null
  if (outcome === 'accepted') installedNow = true
  notify()
  return outcome
}

let snapshot = { canPrompt: false, installedNow: false }

/** Estado para la interfaz: modo de instalación de este navegador y si se acaba de instalar. */
export function useInstallMode(): { mode: InstallMode; installedNow: boolean } {
  const state = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => {
      if (snapshot.canPrompt !== !!deferred || snapshot.installedNow !== installedNow) snapshot = { canPrompt: !!deferred, installedNow }
      return snapshot
    },
  )
  const ios = typeof navigator !== 'undefined' && isIos(navigator)
  return { mode: installMode({ standalone: isStandalone(), ios, canPrompt: state.canPrompt }), installedNow: state.installedNow }
}

/* ------------------------------------------------------------------ */
/* Lo que recuerda este dispositivo                                    */
/* ------------------------------------------------------------------ */

export const DEVICE_KEY = 'clara.device.v1'

export interface DeviceFlags {
  /** La tarjeta «Instala Clara» de Inicio ya se cerró (solo sale una vez). */
  installCardDismissed?: boolean
  /** «Protege tus datos» ya se preguntó en este dispositivo (K3). */
  safetyAsked?: boolean
}

export function readDeviceFlags(): DeviceFlags {
  try {
    const raw = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? '{}') as unknown
    return raw && typeof raw === 'object' ? (raw as DeviceFlags) : {}
  } catch {
    return {}
  }
}

export function writeDeviceFlags(patch: DeviceFlags) {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify({ ...readDeviceFlags(), ...patch }))
  } catch {
    // Sin almacenamiento del dispositivo, la tarjeta podría volver a salir: nada más.
  }
}
