/**
 * Contrato del plugin local `ClaraCaptures` (`ios/App/App/ClaraCapturesPlugin.swift`) y su adaptador (Fase 2,
 * decisión 169). No importa Capacitor: así se prueba con un doble. Solo lo usa `native/captures.ts`, que se carga con
 * `import()` dentro de la app. Transporta texto: qué significa cada línea lo decide `domain/captureQueue.ts`.
 */

/** Lo que responde el lado nativo. */
export interface ClaraCapturesPlugin {
  read(): Promise<{ text?: unknown }>
  remove(options: { ids: string[] }): Promise<{ removed?: unknown }>
  appendTest(options: { rawAmount: string; currencyHint: string; merchant: string }): Promise<{ captureId?: unknown }>
  addListener(event: 'capturesAdded', listener: () => void): Promise<{ remove: () => Promise<void> }>
}

export const CLARA_CAPTURES_PLUGIN = 'ClaraCaptures'

/** La cola tal como la usa la web. */
export interface CaptureQueuePort {
  /** Todo lo que espera, tal cual. Lanza si no se pudo leer (nunca se confunde con «no hay nada»). */
  read(): Promise<string>
  /** Quita esos pagos de la cola. Solo se llama después de haberlos guardado. */
  remove(ids: readonly string[]): Promise<void>
  /** Escribe un pago de prueba por el mismo camino que la acción de Atajos. Devuelve su id. */
  appendTest(input: { rawAmount: string; currencyHint: string; merchant: string }): Promise<string>
  /** Avisa cuando la acción anota un pago con la app abierta. Devuelve cómo dejar de escuchar. */
  onAdded(listener: () => void): () => void
}

export function captureQueueFromPlugin(plugin: ClaraCapturesPlugin): CaptureQueuePort {
  return {
    read: async () => {
      const { text } = await plugin.read()
      if (typeof text !== 'string') throw new Error('capture queue unavailable')
      return text
    },
    remove: async (ids) => {
      if (ids.length > 0) await plugin.remove({ ids: [...ids] })
    },
    appendTest: async (input) => {
      const { captureId } = await plugin.appendTest(input)
      if (typeof captureId !== 'string' || captureId === '') throw new Error('capture test not written')
      return captureId
    },
    onAdded: (listener) => {
      let handle: { remove: () => Promise<void> } | null = null
      let stopped = false
      void plugin.addListener('capturesAdded', listener).then(
        (h) => {
          if (stopped) void h.remove()
          else handle = h
        },
        () => {},
      )
      return () => {
        stopped = true
        void handle?.remove()
      }
    },
  }
}
