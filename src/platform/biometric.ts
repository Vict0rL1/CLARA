/**
 * Face ID o Touch ID del sistema para el bloqueo de Clara (decisión 165). Solo existe dentro de la app de iPhone; en el
 * navegador el bloqueo sigue usando WebAuthn (`ui/lock/webauthn.ts`), como siempre. Aquí solo está la carga diferida:
 * el plugin y su adaptador (`nativeBiometric.ts`, `native/biometric.ts`) no van en el JS inicial.
 */
import type { NativeBiometric } from './nativeBiometric'

export type { NativeBiometric }

/** El lado nativo, o `null` si esta compilación de la app no lleva el plugin (o no se pudo cargar). */
export type NativeBiometricLoader = () => Promise<NativeBiometric | null>

export const loadNativeBiometric: NativeBiometricLoader = async () => {
  try {
    const native = await import('./native/biometric')
    return native.nativeBiometricAvailable() ? native.createNativeBiometric() : null
  } catch {
    return null
  }
}
