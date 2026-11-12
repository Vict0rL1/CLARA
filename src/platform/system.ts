/**
 * Tacto del sistema en la app de iPhone (Fase 1, bloque 5; decisión 166): vibración háptica nativa y barra de estado que
 * sigue el tema de Clara. `main.tsx` pide este archivo y `native/system.ts` (los plugins oficiales `@capacitor/haptics`
 * y `@capacitor/status-bar`) con `import()` solo dentro de la app, y deja la vibración en `provideNativeServices`. Aquí
 * no hay ningún `import()`: así ningún trozo nuevo arrastra el ayudante de precarga de Vite al JS inicial.
 */
export type HapticKind = 'tick' | 'success' | 'warning' | 'error'

/** Qué pide cada tipo al motor háptico de iOS (nombres de `@capacitor/haptics`). */
export type NativeHapticCall = { method: 'notification'; type: 'SUCCESS' | 'WARNING' | 'ERROR' } | { method: 'impact'; style: 'LIGHT' }

export function nativeHapticCall(kind: HapticKind): NativeHapticCall {
  if (kind === 'success') return { method: 'notification', type: 'SUCCESS' }
  if (kind === 'warning') return { method: 'notification', type: 'WARNING' }
  if (kind === 'error') return { method: 'notification', type: 'ERROR' }
  return { method: 'impact', style: 'LIGHT' }
}

/** Lo que hace falta del lado nativo (`native/system.ts`, con los plugins oficiales; en las pruebas, un doble). */
export interface NativeSystem {
  playHaptic(call: NativeHapticCall): Promise<void>
  setStatusBarDark(dark: boolean): Promise<void>
}

/** Vibración nativa (solo dentro de la app). No espera ni lanza: si falla, simplemente no vibra. */
export function nativeHaptic(native: NativeSystem, kind: HapticKind): void {
  void native.playHaptic(nativeHapticCall(kind)).catch(() => {})
}

/**
 * ¿Se ve Clara en oscuro? Mismo criterio que `styles.css`: `data-theme="dark"` siempre; sin atributo («Sistema»),
 * lo que diga el dispositivo; `data-theme="light"` nunca.
 */
export function resolvedDark(theme: string | null, systemDark: boolean): boolean {
  return theme === 'dark' || (theme !== 'light' && systemDark)
}

/**
 * Dentro de la app, la barra de estado (hora, batería) sigue el tema de Clara: texto claro sobre el tema oscuro y
 * oscuro sobre el claro, también cuando el tema de Clara no coincide con el del iPhone.
 */
export function followThemeInStatusBar(native: NativeSystem): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
  let last: boolean | null = null
  const apply = () => {
    const dark = resolvedDark(root.getAttribute('data-theme'), media?.matches === true)
    if (dark === last) return
    last = dark
    void native.setStatusBarDark(dark).catch(() => {})
  }
  apply()
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['data-theme'] })
  media?.addEventListener('change', apply)
}
