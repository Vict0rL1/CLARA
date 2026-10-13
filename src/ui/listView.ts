/**
 * Vista recordada del historial (filtros, búsqueda, cuántas filas y posición). Vive en la
 * sesión de la pestaña y es solo presentación: nunca viaja en los datos ni en las copias.
 *
 * Regla: se recupera únicamente al VOLVER de una fila abierta desde la lista sin haber
 * guardado ni eliminado nada («Volver», atrás del navegador). Llegar al historial desde la
 * barra, un enlace o tras guardar o eliminar abre la lista limpia, como siempre.
 */
import type { SourceGroup } from '../domain/txFilters'
import type { TxKind, TxStatus } from '../domain/types'

export interface SavedListView {
  query: string
  kind: 'all' | TxKind
  status: 'all' | TxStatus
  accountId: string
  categoryIds: string[]
  tagIds: string[]
  from: string
  to: string
  amountMin: string
  amountMax: string
  source: 'all' | SourceGroup
  limit: number
  scrollY: number
  /** `true` entre abrir una fila y volver; cualquier guardado o eliminación lo apaga. */
  returning?: boolean
}

const viewKey = (budgetId: string) => `clara.movements.view:${budgetId}`

function readRaw(budgetId: string): SavedListView | null {
  try {
    const raw = sessionStorage.getItem(viewKey(budgetId))
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<SavedListView>
    return typeof v === 'object' && v !== null && typeof v.limit === 'number' ? (v as SavedListView) : null
  } catch {
    return null
  }
}

export function writeListView(budgetId: string, view: SavedListView) {
  try {
    sessionStorage.setItem(viewKey(budgetId), JSON.stringify(view))
  } catch {
    /* sin sesión (modo privado del navegador): no se recuerda y no pasa nada */
  }
}

/** Vista que debe recuperarse al montar la lista, o `null` si toca abrirla limpia. */
export function takeListView(budgetId: string): SavedListView | null {
  const saved = readRaw(budgetId)
  if (!saved?.returning) return null
  writeListView(budgetId, { ...saved, returning: false })
  return saved
}

/** Al guardar o eliminar desde el detalle: la próxima visita al historial empieza limpia. */
export function forgetListReturn(budgetId: string) {
  const saved = readRaw(budgetId)
  if (saved?.returning) writeListView(budgetId, { ...saved, returning: false })
}
