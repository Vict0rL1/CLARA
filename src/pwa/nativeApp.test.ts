import { describe, expect, it } from 'vitest'
import { installMode } from '../ui/install'
import { isNativeApp } from './nativeApp'

describe('app de iPhone (cáscara nativa): cómo se reconoce', () => {
  it('en el navegador no hay puente nativo: no es la app de iPhone', () => {
    expect(isNativeApp(undefined)).toBe(false)
    expect(isNativeApp({})).toBe(false)
    expect(isNativeApp({ Capacitor: {} })).toBe(false)
  })

  it('con el puente nativo de Capacitor sí lo es', () => {
    expect(isNativeApp({ Capacitor: { isNativePlatform: () => true } })).toBe(true)
  })

  it('la versión web de Capacitor (sin plataforma nativa) no cuenta, ni un puente que falla', () => {
    expect(isNativeApp({ Capacitor: { isNativePlatform: () => false } })).toBe(false)
    expect(
      isNativeApp({
        Capacitor: {
          isNativePlatform: () => {
            throw new Error('puente roto')
          },
        },
      }),
    ).toBe(false)
    // Un valor que no es exactamente `true` no basta.
    expect(isNativeApp({ Capacitor: { isNativePlatform: (() => 'ios') as unknown as () => boolean } })).toBe(false)
  })

  it('dentro de la app de iPhone no se enseñan los pasos de «Agregar a inicio»: cuenta como instalada', () => {
    const native = isNativeApp({ Capacitor: { isNativePlatform: () => true } })
    expect(installMode({ standalone: native, ios: true, canPrompt: false })).toBe('installed')
  })
})
