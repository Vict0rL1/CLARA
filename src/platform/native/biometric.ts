/**
 * Solo dentro de la app de iPhone (se carga con `import()` desde `platform/biometric.ts`): registra el plugin nativo de
 * biometría. Es de los pocos archivos que importan Capacitor (decisión 152).
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import { CLARA_BIOMETRIC_PLUGIN, nativeBiometricFromPlugin, type ClaraBiometricPlugin, type NativeBiometric } from '../nativeBiometric'

/** ¿Está el plugin en esta compilación de la app? (Lo publica el puente nativo al arrancar.) */
export function nativeBiometricAvailable(): boolean {
  return Capacitor.isPluginAvailable(CLARA_BIOMETRIC_PLUGIN)
}

export function createNativeBiometric(): NativeBiometric {
  return nativeBiometricFromPlugin(registerPlugin<ClaraBiometricPlugin>(CLARA_BIOMETRIC_PLUGIN))
}
