/**
 * Biometría del bloqueo según dónde corre Clara. En el navegador: WebAuthn (`webauthn.ts`), como siempre. En la app de
 * iPhone: Face ID o Touch ID del sistema (`platform/biometric.ts`, decisión 165).
 *
 * En los dos casos lo que se guarda en `LockConfig.credentialId` es solo una referencia: en la web, el id de la
 * credencial; en la app, una marca fija (no hay credencial que guardar: el sistema reconoce a la persona). Una
 * referencia de un sitio no vale en el otro: nunca se ofrece un botón que no podría verificar.
 */
import { isNativeIOS } from '../../platform'
import { loadNativeBiometric, type NativeBiometricLoader } from '../../platform/biometric'
import { platformAuthenticatorAvailable, registerBiometric, verifyBiometric, webAuthnAvailable } from './webauthn'

/** Lo que se guarda como `credentialId` cuando la biometría es la del sistema (app de iPhone). */
export const NATIVE_CREDENTIAL_ID = 'native:device-biometrics'

export interface LockBiometrics {
  /** ¿Se puede activar la biometría aquí y ahora? */
  available(): Promise<boolean>
  /** Activa la biometría: devuelve la referencia que se guarda, o `null` si no se pudo o se canceló. `reason`: el texto que ve la persona. */
  register(reason: string): Promise<string | null>
  /** ¿Esta referencia guardada se puede verificar aquí? (Decide si la pantalla de bloqueo enseña el botón.) */
  canVerify(credentialId: string | undefined): boolean
  /** Pide la biometría. Solo `true` si el sistema confirmó a la persona. */
  verify(credentialId: string, reason: string): Promise<boolean>
}

export const webBiometrics: LockBiometrics = {
  available: platformAuthenticatorAvailable,
  register: () => registerBiometric('Clara'),
  canVerify: (credentialId) => !!credentialId && credentialId !== NATIVE_CREDENTIAL_ID && webAuthnAvailable(),
  verify: (credentialId) => (credentialId === NATIVE_CREDENTIAL_ID ? Promise.resolve(false) : verifyBiometric(credentialId)),
}

export function nativeBiometrics(load: NativeBiometricLoader = loadNativeBiometric): LockBiometrics {
  return {
    available: async () => (await (await load())?.available()) === true,
    // Se pide una vez al activar: la persona comprueba que funciona y iOS pregunta ahí por el permiso de Face ID.
    register: async (reason) => ((await (await load())?.authenticate(reason)) === true ? NATIVE_CREDENTIAL_ID : null),
    canVerify: (credentialId) => credentialId === NATIVE_CREDENTIAL_ID,
    verify: async (credentialId, reason) => credentialId === NATIVE_CREDENTIAL_ID && (await (await load())?.authenticate(reason)) === true,
  }
}

export function lockBiometrics(native: boolean = isNativeIOS()): LockBiometrics {
  return native ? nativeBiometrics() : webBiometrics
}
