/** El traductor de un paquete diferido para los componentes dentro de `PackBody` (ver `PackBody.tsx`). */
import { createContext, useContext } from 'react'
import { useT, type Translator } from '../../i18n'
import type { PackTranslate, PackTranslatePlural } from '../../i18n/packs'

export const PackTexts = createContext<{ t: PackTranslate; tn: PackTranslatePlural } | null>(null)

/** Como `useT()`, pero también con las claves del paquete: las del paquete salen del paquete y el resto, de la interfaz. */
export function usePackT(): Omit<Translator, 't' | 'tn'> & { t: PackTranslate; tn: PackTranslatePlural } {
  const ui = useT()
  const pack = useContext(PackTexts)
  return { ...ui, t: pack?.t ?? (ui.t as PackTranslate), tn: pack?.tn ?? (ui.tn as PackTranslatePlural) }
}
