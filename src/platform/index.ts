/**
 * Capa de plataforma: lo único de `src/` que sabe si Clara corre en el navegador o dentro de su app de iPhone
 * (la cáscara nativa de Capacitor, carpeta `ios/`).
 *
 * Reglas (decisión 152):
 * - Ningún import de Capacitor fuera de `src/platform/`. Dentro, solo en `src/platform/native/`, que se carga con
 *   `import()` cuando `isNativeIOS()` es verdadero: así el JS inicial de la web no crece y la PWA hace lo de siempre.
 * - Este archivo no importa nada de Capacitor: el puente nativo deja `window.Capacitor` antes de que cargue la página.
 * - La plataforma decide CÓMO se hace algo (guardar, vibrar, compartir) y qué se EXPLICA; nunca cambia cifras.
 */
type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string }
type WithCapacitor = { Capacitor?: CapacitorGlobal }

/** ¿Corre dentro de la app de iPhone? En el navegador (pestaña o pantalla de inicio) no hay puente y es `false`. */
export function isNativeIOS(win: WithCapacitor | undefined = typeof window === 'undefined' ? undefined : (window as unknown as WithCapacitor)): boolean {
  try {
    const cap = win?.Capacitor
    return cap?.isNativePlatform?.() === true && cap.getPlatform?.() === 'ios'
  } catch {
    return false
  }
}
