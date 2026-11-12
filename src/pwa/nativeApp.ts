/**
 * ¿Clara corre dentro de su app de iPhone (la cáscara nativa de Capacitor, carpeta `ios/`)?
 *
 * El puente nativo deja `window.Capacitor` antes de que cargue la página. No se importa `@capacitor/core`: la app
 * web no lo necesita para saberlo y así el JS inicial no crece. En el navegador (pestaña o pantalla de inicio) ese
 * objeto no existe y la respuesta es `false`. Solo decide qué se EXPLICA (instalar, uso sin conexión); nunca cambia
 * cifras ni datos.
 */
type CapacitorGlobal = { isNativePlatform?: () => boolean }
type WithCapacitor = { Capacitor?: CapacitorGlobal }

export function isNativeApp(win: WithCapacitor | undefined = typeof window === 'undefined' ? undefined : (window as unknown as WithCapacitor)): boolean {
  try {
    return win?.Capacitor?.isNativePlatform?.() === true
  } catch {
    return false
  }
}
