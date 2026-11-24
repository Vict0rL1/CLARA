/**
 * Lleva los pagos de la cola del iPhone a los datos (Fase 2, decisión 169). Solo dentro de la app: `main.tsx` lo carga
 * con `import()` junto con la cola nativa (`platform/native/captures.ts`).
 *
 * Cada lectura: leer la cola → `importCaptures` (las reglas están en el dominio) → guardar → y SOLO si se guardó,
 * pedir al iPhone que quite esas líneas. Si algo falla antes de guardar, la cola sigue igual y se intenta la próxima
 * vez: un pago nunca se pierde. Si falla quitar las líneas, la próxima lectura las salta porque ya se conocen.
 *
 * Cuándo: al tener datos, al volver la app a primer plano (evento `resume` de Capacitor y `visibilitychange`) y cuando
 * la acción anota un pago con la app abierta. Nunca con datos de demostración ni antes de crear el presupuesto: los
 * pagos esperan en la cola. Dos lecturas nunca corren a la vez; una pedida durante otra se hace justo después.
 */
import { importCaptures, type CaptureImportSummary } from '../domain/captureImport'
import { readCaptureQueue } from '../domain/captureQueue'
import { minorToDecimalString } from '../domain/money'
import type { Issue } from '../domain/validation'
import type { AppData } from '../domain/types'
import type { CaptureQueuePort } from '../platform/nativeCaptures'
import { makeContext } from './hooks'

export type CaptureSyncOutcome =
  | { status: 'imported'; summary: CaptureImportSummary }
  | { status: 'empty' }
  | { status: 'waiting'; reason: 'noData' | 'demo' }
  | { status: 'unavailable' }
  | { status: 'invalid'; issues: Issue[] }
  | { status: 'notSaved' }

/** Lo que hace falta del almacén (`AppStore`). */
export interface CaptureSyncStore {
  readonly data: AppData | null
  commit(next: AppData): Promise<boolean>
  subscribe(listener: () => void): () => void
}

export interface CaptureSync {
  sync(): Promise<CaptureSyncOutcome>
  /** «Probar» de Ajustes: escribe una prueba en la cola, la lee y dice si llegó a las propuestas. */
  test(merchant: string): Promise<boolean>
  /** Empieza a escuchar; devuelve cómo parar. */
  start(target: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>): () => void
}

export function createCaptureSync(port: CaptureQueuePort, store: CaptureSyncStore): CaptureSync {
  let running: Promise<CaptureSyncOutcome> | null = null
  let again = false

  const once = async (): Promise<CaptureSyncOutcome> => {
    const before = store.data
    if (!before) return { status: 'waiting', reason: 'noData' }
    if (before.isDemo) return { status: 'waiting', reason: 'demo' }
    let text: string
    try {
      text = await port.read()
    } catch {
      return { status: 'unavailable' }
    }
    const { records } = readCaptureQueue(text)
    if (records.length === 0) return { status: 'empty' }
    // Los datos de ahora (pudieron cambiar mientras se leía la cola); de aquí a `commit` no hay esperas.
    const data = store.data
    if (!data) return { status: 'waiting', reason: 'noData' }
    if (data.isDemo) return { status: 'waiting', reason: 'demo' }
    const result = importCaptures(data, records, makeContext(data.settings.timeZone))
    if (!result.ok) return { status: 'invalid', issues: result.issues }
    if (!result.unchanged && !(await store.commit(result.data))) return { status: 'notSaved' }
    await port.remove(result.value.ack).catch(() => {})
    return { status: 'imported', summary: result.value }
  }

  const sync = (): Promise<CaptureSyncOutcome> => {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      let outcome: CaptureSyncOutcome
      do {
        again = false
        outcome = await once()
      } while (again)
      return outcome
    })().finally(() => {
      running = null
    })
    return running
  }

  const test = async (merchant: string): Promise<boolean> => {
    const data = store.data
    if (!data || data.isDemo) return false
    let id: string
    try {
      id = await port.appendTest({ rawAmount: minorToDecimalString(1, data.settings.currency), currencyHint: data.settings.currency, merchant })
    } catch {
      return false
    }
    await sync()
    return store.data?.captures?.proposals.some((p) => p.captureId === id && p.test) ?? false
  }

  const start: CaptureSync['start'] = (target) => {
    const onResume = () => void sync()
    const onVisible = () => {
      if (target.visibilityState === 'visible') void sync()
    }
    target.addEventListener('resume', onResume)
    target.addEventListener('visibilitychange', onVisible)
    const stopAdded = port.onAdded(() => void sync())
    // En cuanto hay datos de verdad (al abrir, al crear el presupuesto o al salir de la demostración).
    let key = ''
    const onStore = () => {
      const data = store.data
      const next = data && !data.isDemo ? data.budgetId : ''
      if (next && next !== key) void sync()
      key = next
    }
    const stopStore = store.subscribe(onStore)
    onStore()
    return () => {
      target.removeEventListener('resume', onResume)
      target.removeEventListener('visibilitychange', onVisible)
      stopAdded()
      stopStore()
    }
  }

  return { sync, test, start }
}
