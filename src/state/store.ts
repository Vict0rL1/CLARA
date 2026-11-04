/**
 * Estado de la app en memoria + persistencia a través de un `DataRepository`.
 * No contiene reglas financieras: solo aplica los resultados de `domain/operations`.
 */
import { clearAllDrafts } from '../storage/drafts'
import { useSyncExternalStore } from 'react'
import { recordHistory, type HistoryMeta } from '../domain/history'
import type { AppData } from '../domain/types'
import type { ImportIssue } from '../storage/backup'
import { MemoryRepository } from '../storage/localStorageRepository'
import type { DataRepository, SaveErrorCode } from '../storage/repository'

export type SaveStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: number }
  | { state: 'error'; error: SaveErrorCode }

export type AppState =
  | { phase: 'loading' }
  | { phase: 'corrupt'; raw: string; issues: ImportIssue[] }
  | {
      phase: 'ready'
      data: AppData | null
      save: SaveStatus
      storage: DataRepository['kind']
      /** Otra pestaña guardó cambios más recientes. */
      externalChange: boolean
      /**
       * El último guardado falló: lo que se ve incluye cambios que NO están en el
       * almacenamiento (que conserva intacto el último estado guardado).
       */
      unsaved: boolean
    }

/** Resultado de un guardado: si llegó al almacenamiento y la revisión que dejó (`null` si no se aplicó). */
export interface CommitResult {
  ok: boolean
  revision: number | null
}

export class AppStore {
  private state: AppState = { phase: 'loading' }
  private listeners = new Set<() => void>()
  private repo: DataRepository
  private unsubscribeRepo: (() => void) | null = null

  constructor(repo: DataRepository) {
    this.repo = repo
  }

  getState = (): AppState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(state: AppState) {
    this.state = state
    for (const l of this.listeners) l()
  }

  async init(): Promise<void> {
    try {
      const result = await this.repo.load()
      this.unsubscribeRepo?.()
      this.unsubscribeRepo = this.repo.subscribe(() => this.onExternalChange())
      if (result.status === 'corrupt') {
        this.set({ phase: 'corrupt', raw: result.raw, issues: result.issues })
        return
      }
      this.set({
        phase: 'ready',
        data: result.status === 'ok' ? result.data : null,
        save: { state: 'idle' },
        storage: this.repo.kind,
        externalChange: false,
        unsaved: false,
      })
    } catch {
      // El navegador bloquea el almacenamiento: se trabaja solo en memoria y se avisa.
      this.repo = new MemoryRepository()
      this.set({ phase: 'ready', data: null, save: { state: 'idle' }, storage: 'memory', externalChange: false, unsaved: false })
    }
  }

  /** Hay cambios a la vista que no se pudieron guardar. */
  get hasUnsavedChanges(): boolean {
    return this.state.phase === 'ready' && this.state.unsaved
  }

  private onExternalChange() {
    if (this.state.phase === 'ready') this.set({ ...this.state, externalChange: true })
  }

  /** Vuelve a leer del almacenamiento (por ejemplo, tras cambios en otra pestaña). */
  async reload(): Promise<void> {
    this.set({ phase: 'loading' })
    await this.init()
  }

  /** Dónde se guardan los datos ahora mismo. */
  get backend(): NonNullable<DataRepository['backend']> {
    return this.repo.backend ?? (this.repo.kind === 'memory' ? 'memory' : 'localStorage')
  }

  get data(): AppData | null {
    return this.state.phase === 'ready' ? this.state.data : null
  }

  /**
   * Guarda un nuevo estado completo y registra en el historial lo que cambió (`meta.source`:
   * 'replace' para importar una copia o reiniciar). Devuelve si se pudo persistir.
   */
  async commit(next: AppData, meta: HistoryMeta = {}): Promise<boolean> {
    return (await this.commitTracked(next, meta)).ok
  }

  /**
   * Como `commit`, y además dice qué revisión dejó ESTE guardado. La revisión se fija al aplicar el
   * cambio, antes de esperar al almacenamiento: otro cambio que llegue mientras la escritura está
   * pendiente tendrá otra (mayor) y nunca se confunde con esta (RT-02).
   */
  async commitTracked(next: AppData, meta: HistoryMeta = {}): Promise<CommitResult> {
    if (this.state.phase !== 'ready') return { ok: false, revision: null }
    const previousRevision = this.state.data?.revision ?? 0
    const withHistory = recordHistory(this.state.data, next, new Date().toISOString(), meta)
    const data: AppData = { ...withHistory, revision: Math.max(previousRevision, next.revision) + 1 }
    this.set({ ...this.state, data, save: { state: 'saving' } })
    const result = await this.repo.save(data)
    if (this.state.phase !== 'ready') return { ok: result.ok, revision: data.revision }
    this.set({
      ...this.state,
      save: result.ok ? { state: 'saved', at: Date.now() } : { state: 'error', error: result.error },
      unsaved: !result.ok,
      // Un conflicto equivale a saber que otra pestaña cambió los datos.
      externalChange: this.state.externalChange || (!result.ok && result.error === 'conflict'),
    })
    return { ok: result.ok, revision: data.revision }
  }

  /** Vuelve a intentar guardar lo que se ve (tras liberar espacio, por ejemplo). */
  async retrySave(): Promise<boolean> {
    if (this.state.phase !== 'ready' || !this.state.data) return false
    return this.commit(this.state.data)
  }

  async clearAll(): Promise<void> {
    await this.repo.clear()
    // Los borradores de formularios también son datos de esta persona.
    clearAllDrafts()
    this.set({ phase: 'ready', data: null, save: { state: 'idle' }, storage: this.repo.kind, externalChange: false, unsaved: false })
  }

  /** Descarta datos dañados (tras ofrecer descargarlos) y vuelve a empezar. */
  async discardCorrupt(): Promise<void> {
    const repo = this.repo as DataRepository & { preserveCorrupt?: (raw: string, now: Date) => void }
    if (this.state.phase === 'corrupt') repo.preserveCorrupt?.(this.state.raw, new Date())
    await this.clearAll()
  }
}

let storeInstance: AppStore | null = null

export function setStore(store: AppStore) {
  storeInstance = store
}

export function getStore(): AppStore {
  if (!storeInstance) throw new Error('Store no inicializado')
  return storeInstance
}

export function useAppState(): AppState {
  const store = getStore()
  return useSyncExternalStore(store.subscribe, store.getState)
}

/** Datos actuales. Solo usar dentro de la app ya configurada. */
export function useData(): AppData {
  const state = useAppState()
  if (state.phase !== 'ready' || !state.data) throw new Error('No hay datos cargados')
  return state.data
}
