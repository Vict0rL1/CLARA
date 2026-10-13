import { useEffect, type RefObject } from 'react'

/**
 * `--nav-h` = alto real de la barra inferior (sin el área segura). Con el texto al 200 % la barra pasa a
 * dos filas en lugar de salirse de la pantalla; el relleno inferior del contenido, el desplazamiento al
 * enfocar y la hoja de agregar usan esta variable, así que nada queda tapado. En escritorio la barra es
 * lateral (no fija abajo) y se deja el valor de la hoja de estilos.
 */
export function useNavHeightVar(ref: RefObject<HTMLElement | null>, mounted: boolean) {
  useEffect(() => {
    const nav = ref.current
    if (!mounted || !nav) return
    const root = document.documentElement
    const update = () => {
      const cs = getComputedStyle(nav)
      if (cs.position !== 'fixed') {
        root.style.removeProperty('--nav-h')
        return
      }
      const safe = Math.max(0, parseFloat(cs.paddingBottom) - 4)
      root.style.setProperty('--nav-h', `${Math.ceil(nav.getBoundingClientRect().height - safe)}px`)
    }
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(nav)
    window.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
      root.style.removeProperty('--nav-h')
    }
  }, [ref, mounted])
}
