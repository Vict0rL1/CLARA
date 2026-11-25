/**
 * Contrato del plugin local `ClaraLaunch` (`ios/App/App/ClaraLaunchPlugin.swift`) y qué hace la web con él (Fase 4,
 * decisión 185). No importa Capacitor: así se prueba con un doble. Solo lo usa `native/launch.ts`, que se carga con
 * `import()` dentro de la app.
 *
 * «Nuevo gasto en Clara» (Atajos, Siri, el botón de Acción, «Tocar atrás») y el control del Centro de control piden una
 * pantalla por su nombre. El Swift la guarda hasta que la web la recoge con `take()`: al arrancar (la acción pudo
 * ejecutarse antes de que la web cargara) y con el aviso `openScreen`. La ruta la decide la web; un nombre que no
 * conoce no abre nada.
 */

export interface ClaraLaunchPlugin {
  take(): Promise<{ screen?: unknown }>
  addListener(event: 'openScreen', listener: () => void): Promise<{ remove: () => Promise<void> }>
}

export const CLARA_LAUNCH_PLUGIN = 'ClaraLaunch'

/** Las pantallas que se pueden pedir desde fuera, con su ruta. Las mismas que `ClaraScreen` en Swift. */
export const LAUNCH_ROUTES: Readonly<Record<string, string>> = {
  // El formulario de siempre; nada se guarda hasta pulsar «Guardar».
  newExpense: '/movimientos/nuevo',
}

export function launchPath(screen: unknown): string | null {
  return typeof screen === 'string' && Object.prototype.hasOwnProperty.call(LAUNCH_ROUTES, screen) ? LAUNCH_ROUTES[screen]! : null
}

/**
 * Abre la pantalla pedida ahora (si la hay) y cada vez que llegue otra. Devuelve cómo dejar de escuchar. Un fallo del
 * plugin no rompe nada: simplemente no se abre la pantalla.
 */
export function followLaunchRequests(plugin: ClaraLaunchPlugin, open: (path: string) => void): () => void {
  let stopped = false
  const pull = async () => {
    try {
      const { screen } = await plugin.take()
      const path = launchPath(screen)
      if (path && !stopped) open(path)
    } catch {
      // Sin plugin o sin respuesta: no hay nada que abrir.
    }
  }
  let handle: { remove: () => Promise<void> } | null = null
  void plugin.addListener('openScreen', () => void pull()).then(
    (h) => {
      if (stopped) void h.remove()
      else handle = h
    },
    () => {},
  )
  void pull()
  return () => {
    stopped = true
    void handle?.remove()
  }
}
