/**
 * Solo dentro de la app de iPhone (`main.tsx` lo carga con `import()`): vibración y barra de estado con los plugins
 * oficiales `@capacitor/haptics` y `@capacitor/status-bar` (decisión 166). Es de los pocos archivos que importan
 * Capacitor (decisión 152).
 *
 * Los plugins se registran por su nombre (`registerPlugin`), como `ClaraStorage`, y de sus paquetes solo se usan los
 * TIPOS: el JS de cada paquete trae una versión web que se carga con `import()`, y eso sacaba al JS inicial de la web
 * el ayudante de precarga de Vite. Dentro de la app esa versión web no se usa nunca. Los valores (`'SUCCESS'`,
 * `'LIGHT'`, `'DARK'`) son los de los enums de los paquetes (8.x).
 */
import { registerPlugin } from '@capacitor/core'
import type { HapticsPlugin, ImpactStyle, NotificationType } from '@capacitor/haptics'
import type { StatusBarPlugin, Style } from '@capacitor/status-bar'
import type { NativeHapticCall, NativeSystem } from '../system'

const Haptics = registerPlugin<HapticsPlugin>('Haptics')
const StatusBar = registerPlugin<StatusBarPlugin>('StatusBar')

export function playHaptic(call: NativeHapticCall): Promise<void> {
  return call.method === 'notification'
    ? Haptics.notification({ type: call.type as NotificationType })
    : Haptics.impact({ style: call.style as ImpactStyle })
}

/** `DARK` = texto claro para fondos oscuros; `LIGHT` = texto oscuro para fondos claros (documentación del plugin). */
export function setStatusBarDark(dark: boolean): Promise<void> {
  return StatusBar.setStyle({ style: (dark ? 'DARK' : 'LIGHT') as Style })
}

export const nativeSystem: NativeSystem = { playHaptic, setStatusBarDark }
