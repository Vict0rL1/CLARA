/**
 * Reemplazar todos los datos (importar una copia o restaurar una copia local) con un «Deshacer»
 * seguro (REC-01). Deshacer solo vuelve a lo anterior si nada cambió desde el reemplazo: lo que se
 * ve tiene que seguir en la revisión que dejó EL PROPIO reemplazo, fijada al aplicarlo y no al
 * terminar de guardarse (RT-02): un gasto, una tarea automática o cualquier cambio posterior —aunque
 * su escritura siga pendiente— la invalida. Entonces deshacer se niega en vez de borrar ese
 * trabajo; lo anterior sigue en la copia local «Antes de restaurar» cuando el navegador la pudo guardar.
 */
import type { AppData } from '../domain/types'
import { getStore, type AppStore } from './store'

export type UndoReplaceResult = 'undone' | 'stale' | 'failed'

export interface ReplaceResult {
  ok: boolean
  undo: () => Promise<UndoReplaceResult>
}

export async function replaceWithUndo(next: AppData, store: AppStore = getStore()): Promise<ReplaceResult> {
  const previous = store.data
  const { ok, revision } = await store.commitTracked(next, { source: 'replace' })
  return {
    ok,
    undo: async () => {
      const current = store.data
      if (!ok || !previous || !current || revision === null || current.revision !== revision) return 'stale'
      return (await store.commit(previous, { source: 'replace' })) ? 'undone' : 'failed'
    },
  }
}
