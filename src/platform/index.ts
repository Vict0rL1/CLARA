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
import type { LocalBackupStore } from '../storage/autoBackup'
import type { DeviceAi, DeviceDictation, DeviceReceipts } from './nativeAssistant'

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
  /** Copias locales en archivos de la app, no en el WebView (`storage/nativeLocalBackups.ts`, decisión 173). */
  localBackups?: LocalBackupStore
  /** Copia ya los ajustes de este dispositivo al archivo de la app (`deviceMirror.ts`); tras cambiar el bloqueo. */
  saveDeviceSettings?: () => Promise<boolean>
  /** Dictado en el iPhone, sin enviar el audio (`nativeAssistant.ts`, Fase 5). */
  dictation?: DeviceDictation
  /** Texto de recibos leído en el iPhone (Vision) y cámara de documentos (`nativeAssistant.ts`, Fase 5). */
  receipts?: DeviceReceipts
  /** La IA de Apple Intelligence que corre en el iPhone, opcional (`nativeAssistant.ts`, Fase 5). */
  deviceAi?: DeviceAi
}

let services: Readonly<NativeServices> = {}
const listeners = new Set<() => void>()

/** Cada llamada deja un objeto nuevo y avisa: una pantalla abierta antes de que llegaran se entera (`subscribeNativeServices`). */
export function provideNativeServices(provided: NativeServices): void {
  services = { ...services, ...provided }
  for (const listener of [...listeners]) listener()
}

export function nativeServices(): Readonly<NativeServices> {
  return services
}

/** Para `useSyncExternalStore`: avisa cuando llegan servicios nuevos. Devuelve cómo dejar de escuchar. */
export function subscribeNativeServices(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
