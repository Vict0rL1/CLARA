/**
 * Contrato del plugin local `ClaraBiometric` (`ios/App/App/ClaraBiometricPlugin.swift`) y su adaptador (decisión 165).
 * No importa Capacitor: así se prueba con un doble. Solo lo usa `native/biometric.ts`, que se carga con `import()`
 * dentro de la app; la interfaz lo pide a través de `biometric.ts`.
 */

/** Lo que responde el lado nativo. `reason` (si no se pudo): `cancelled`, `fallback`, `lockout`, `notAvailable`, `notEnrolled`, `passcodeNotSet` o `failed`. */
export interface ClaraBiometricPlugin {
  availability(): Promise<{ available?: boolean; type?: string; reason?: string }>
  authenticate(options: { reason: string }): Promise<{ ok?: boolean; reason?: string }>
}

export const CLARA_BIOMETRIC_PLUGIN = 'ClaraBiometric'

export interface NativeBiometric {
  /** ¿Hay Face ID o Touch ID configurado y utilizable ahora? */
  available(): Promise<boolean>
  /** Pide la biometría con ese texto. Solo es `true` si el sistema confirmó a la persona. */
  authenticate(reason: string): Promise<boolean>
}

/**
 * Adapta el plugin. Cualquier respuesta que no sea exactamente «sí» cuenta como «no»: una respuesta incompleta, un
 * rechazo o un plugin que falla nunca desbloquean.
 */
export function nativeBiometricFromPlugin(plugin: ClaraBiometricPlugin): NativeBiometric {
  return {
    available: async () => {
      try {
        return (await plugin.availability()).available === true
      } catch {
        return false
      }
    },
    authenticate: async (reason) => {
      try {
        return (await plugin.authenticate({ reason })).ok === true
      } catch {
        return false
      }
    },
  }
}
