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

/**
 * Servicios nativos que `main.tsx` carga con `import()` una sola vez dentro de la app y deja registrados aquí. Así las
 * pantallas los usan sin hacer su propio `import()` (cada uno añadiría al JS inicial el ayudante de precarga de
 * Vite). Mientras no han llegado, o en el navegador, no hay ninguno y cada pantalla hace lo de siempre.
 */
export interface NativeServices {
  /** Vibración del motor háptico de iOS (`system.ts`). */
  haptic?: (kind: 'tick' | 'success' | 'warning' | 'error') => void
  /** Escribe el archivo y abre la hoja Compartir (`files.ts`). `cancelled`: se cerró sin elegir; otro fallo, se lanza. */
  shareTextFile?: (filename: string, text: string) => Promise<'shared' | 'cancelled'>
  /** «Probar» de la captura automática (`state/captureSync.ts`): `true` si la prueba llegó a «Por revisar». */
  captureTest?: (merchant: string) => Promise<boolean>
}

const services: NativeServices = {}

export function provideNativeServices(provided: NativeServices): void {
  Object.assign(services, provided)
}

export function nativeServices(): Readonly<NativeServices> {
  return services
}
