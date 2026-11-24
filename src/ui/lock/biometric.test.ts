import { describe, expect, it } from 'vitest'
import { nativeBiometricFromPlugin, type ClaraBiometricPlugin, type NativeBiometric } from '../../platform/nativeBiometric'
import { lockBiometrics, nativeBiometrics, NATIVE_CREDENTIAL_ID, webBiometrics } from './biometric'

/** Doble del plugin `ClaraBiometric`: responde lo que se le diga y anota con qué texto se pidió. */
function fakePlugin(answers: { availability?: unknown; authenticate?: unknown; fail?: boolean }) {
  const reasons: string[] = []
  const plugin = {
    availability: async () => {
      if (answers.fail) throw new Error('puente roto')
      return answers.availability
    },
    authenticate: async ({ reason }: { reason: string }) => {
      reasons.push(reason)
      if (answers.fail) throw new Error('puente roto')
      return answers.authenticate
    },
  } as unknown as ClaraBiometricPlugin
  return { plugin, reasons }
}

const native = (answers: Parameters<typeof fakePlugin>[0]) => {
  const { plugin, reasons } = fakePlugin(answers)
  return { biometrics: nativeBiometrics(async () => nativeBiometricFromPlugin(plugin)), reasons }
}

describe('Face ID / Touch ID en la app de iPhone (decisión 165): el adaptador del plugin', () => {
  it('solo «disponible: sí» cuenta como disponible', async () => {
    expect(await nativeBiometricFromPlugin(fakePlugin({ availability: { available: true, type: 'faceID' } }).plugin).available()).toBe(true)
    for (const answer of [{ available: false, reason: 'notEnrolled' }, {}, { available: 'yes' }, null, undefined]) {
      expect(await nativeBiometricFromPlugin(fakePlugin({ availability: answer }).plugin).available(), JSON.stringify(answer)).toBe(false)
    }
  })

  it('solo «ok: sí» desbloquea: cancelar, fallar, una respuesta incompleta o un plugin que lanza son «no»', async () => {
    expect(await nativeBiometricFromPlugin(fakePlugin({ authenticate: { ok: true } }).plugin).authenticate('Desbloquear')).toBe(true)
    for (const answer of [{ ok: false, reason: 'cancelled' }, { ok: false, reason: 'lockout' }, {}, { ok: 1 }, { ok: 'true' }, null, undefined]) {
      expect(await nativeBiometricFromPlugin(fakePlugin({ authenticate: answer }).plugin).authenticate('Desbloquear'), JSON.stringify(answer)).toBe(false)
    }
    const broken = nativeBiometricFromPlugin(fakePlugin({ fail: true }).plugin)
    expect(await broken.available()).toBe(false)
    expect(await broken.authenticate('Desbloquear')).toBe(false)
  })
})

describe('biometría del bloqueo dentro de la app', () => {
  it('activar pide la biometría una vez con el texto dado y guarda la marca del sistema, no una credencial', async () => {
    const { biometrics, reasons } = native({ availability: { available: true }, authenticate: { ok: true } })
    expect(await biometrics.available()).toBe(true)
    expect(await biometrics.register('Desbloquear Clara')).toBe(NATIVE_CREDENTIAL_ID)
    expect(reasons).toEqual(['Desbloquear Clara'])
  })

  it('si la persona cancela al activar, no se guarda nada', async () => {
    const { biometrics } = native({ availability: { available: true }, authenticate: { ok: false, reason: 'cancelled' } })
    expect(await biometrics.register('Desbloquear Clara')).toBeNull()
  })

  it('desbloquea solo con la marca del sistema y con un «sí» del sistema', async () => {
    const yes = native({ authenticate: { ok: true } })
    expect(yes.biometrics.canVerify(NATIVE_CREDENTIAL_ID)).toBe(true)
    expect(await yes.biometrics.verify(NATIVE_CREDENTIAL_ID, 'Desbloquear')).toBe(true)
    const no = native({ authenticate: { ok: false, reason: 'failed' } })
    expect(await no.biometrics.verify(NATIVE_CREDENTIAL_ID, 'Desbloquear')).toBe(false)
  })

  it('una credencial de WebAuthn guardada (datos traídos de la web) no vale en la app: ni botón ni petición al sistema', async () => {
    const { biometrics, reasons } = native({ authenticate: { ok: true } })
    expect(biometrics.canVerify('AbCdEf0123')).toBe(false)
    expect(biometrics.canVerify(undefined)).toBe(false)
    expect(await biometrics.verify('AbCdEf0123', 'Desbloquear')).toBe(false)
    expect(reasons).toEqual([])
  })

  it('sin el plugin en la compilación: no disponible, no se activa y no desbloquea', async () => {
    const biometrics = nativeBiometrics(async () => null)
    expect(await biometrics.available()).toBe(false)
    expect(await biometrics.register('Desbloquear')).toBeNull()
    expect(await biometrics.verify(NATIVE_CREDENTIAL_ID, 'Desbloquear')).toBe(false)
  })

  it('el lado nativo que responde de más (objeto raro) tampoco desbloquea', async () => {
    const odd = { available: async () => 'sí', authenticate: async () => 1 } as unknown as NativeBiometric
    const biometrics = nativeBiometrics(async () => odd)
    expect(await biometrics.available()).toBe(false)
    expect(await biometrics.verify(NATIVE_CREDENTIAL_ID, 'Desbloquear')).toBe(false)
  })
})

describe('biometría del bloqueo en el navegador: lo de siempre', () => {
  it('la marca del sistema (de la app) no vale en la web: ni botón ni verificación', async () => {
    expect(webBiometrics.canVerify(NATIVE_CREDENTIAL_ID)).toBe(false)
    expect(webBiometrics.canVerify(undefined)).toBe(false)
    expect(await webBiometrics.verify(NATIVE_CREDENTIAL_ID, 'Desbloquear')).toBe(false)
  })

  it('fuera de la app se usa WebAuthn; dentro, el sistema', () => {
    expect(lockBiometrics(false)).toBe(webBiometrics)
    expect(lockBiometrics(true)).not.toBe(webBiometrics)
    // En las pruebas (Node) no hay WebAuthn: no disponible y sin botón, sin lanzar.
    expect(webBiometrics.canVerify('AbCdEf0123')).toBe(false)
  })
})
