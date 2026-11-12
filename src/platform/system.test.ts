import { describe, expect, it } from 'vitest'
import { nativeHapticCall, resolvedDark } from './system'

describe('tacto del sistema en la app de iPhone (decisión 166)', () => {
  it('cada vibración pide lo que corresponde al motor háptico de iOS', () => {
    expect(nativeHapticCall('success')).toEqual({ method: 'notification', type: 'SUCCESS' })
    expect(nativeHapticCall('warning')).toEqual({ method: 'notification', type: 'WARNING' })
    expect(nativeHapticCall('error')).toEqual({ method: 'notification', type: 'ERROR' })
    expect(nativeHapticCall('tick')).toEqual({ method: 'impact', style: 'LIGHT' })
  })

  it('la barra de estado sigue el tema de Clara, no solo el del iPhone (mismo criterio que styles.css)', () => {
    // Oscuro elegido en Clara: oscuro aunque el iPhone esté en claro.
    expect(resolvedDark('dark', false)).toBe(true)
    // Claro elegido en Clara: claro aunque el iPhone esté en oscuro.
    expect(resolvedDark('light', true)).toBe(false)
    // «Sistema» (sin atributo): lo que diga el iPhone.
    expect(resolvedDark(null, true)).toBe(true)
    expect(resolvedDark(null, false)).toBe(false)
  })
})
