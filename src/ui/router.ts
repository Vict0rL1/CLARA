/**
 * Enrutador mínimo basado en el hash (#/ruta). No necesita servidor ni
 * configuración especial, y funciona igual al instalar la app como PWA.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface Route {
  path: string
  segments: string[]
  query: URLSearchParams
}

function readRoute(): Route {
  const hash = window.location.hash.replace(/^#/, '') || '/'
  const [rawPath = '/', rawQuery = ''] = hash.split('?')
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
  return { path, segments: path.split('/').filter(Boolean), query: new URLSearchParams(rawQuery) }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const onChange = () => setRoute(readRoute())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(to: string, options: { replace?: boolean } = {}) {
  const target = `#${to}`
  if (options.replace) window.location.replace(target)
  else window.location.hash = to
}

/**
 * Cambia la dirección SIN navegar (sin `hashchange`): la pantalla no se vuelve a montar ni mueve el foco o el
 * desplazamiento. Para que la dirección refleje un valor que la pantalla ya muestra y sobreviva a recargar o
 * a compartir el enlace (p. ej. las fechas de un periodo personalizado mientras se escriben, STAT-01).
 */
export function replaceRouteQuietly(to: string) {
  window.history.replaceState(window.history.state, '', `#${to}`)
}

export function href(to: string): string {
  return `#${to}`
}

export function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v))
  const s = q.toString()
  return s ? `${path}?${s}` : path
}

/**
 * Navegar al terminar una operación asíncrona (p. ej. guardar), pero SOLO si la pantalla que
 * la inició sigue abierta. Si la persona ya se fue a otra sección mientras se guardaba, se
 * respeta su navegación en vez de devolverla al formulario.
 */
export function useNavigateIfStillHere() {
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  return useCallback((to: string, options?: { replace?: boolean }) => {
    if (mounted.current) navigate(to, options)
  }, [])
}

/** Navega solo si la dirección sigue siendo la del momento del clic (la persona no se fue a otra parte). */
export function navigateIfStillAt(fromHash: string, to: string) {
  if (window.location.hash === fromHash) navigate(to)
}
