/**
 * Háptica (§7.9 · pulido): `navigator.vibrate` donde existe (Android). En iOS Safari no hay API y
 * no se simula nada (decisión 15). Dentro de la app de iPhone, el motor háptico del sistema (decisión 166).
 * Solo se dispara tras acciones de la persona, nunca sola, y nunca con «reducir movimiento».
 */
import { isNativeIOS, nativeServices, type NativeServices } from '../platform'

export type HapticKind = Parameters<NonNullable<NativeServices['haptic']>>[0]


const PATTERNS: Record<HapticKind, number | number[]> = { tick: 8, success: [10, 40, 12], warning: [20, 60, 20], error: [30, 50, 30, 50, 30] }

export function hapticsAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function haptic(kind: HapticKind, native: boolean = isNativeIOS()): boolean {
  if (!native && !hapticsAvailable()) return false
  try {
    // Con «reducir movimiento» activo tampoco se vibra: es la señal más cercana que da el sistema.
    if (reducedMotion()) return false
    if (native) {
      // Lo deja `main.tsx` al arrancar dentro de la app (`platform/system.ts`, diferido); hasta entonces, nada.
      const play = nativeServices().haptic
      if (!play) return false
      play(kind)
      return true
    }
    return navigator.vibrate(PATTERNS[kind])
  } catch {
    return false
  }
}
