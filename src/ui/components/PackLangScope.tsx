/**
 * Ámbito del texto de un paquete diferido (`usePack`). Con el idioma pedido no hace nada especial. Con el respaldo en
 * español, TODO lo que hay dentro sale en español y va marcado con `lang="es"`: los textos de la interfaz que se
 * piden dentro (también los de los componentes hijos, que leen el traductor del contexto) usan el mismo traductor en
 * español, así nada queda en un idioma con la marca de otro (revisión de la auditoría del 2026-11-04, B3). La cabecera
 * y el aviso de respaldo (`PackNotice`) van fuera, en el idioma de la interfaz. Las fechas y cifras siguen el formato
 * de Ajustes.
 */
import { useMemo, type ReactNode } from 'react'
import { I18nContext, useT } from '../../i18n'

export function PackLangScope({ fallback, children }: { fallback: boolean; children: ReactNode }) {
  const ui = useT()
  const spanish = useMemo(() => ui.inLanguage('es'), [ui])
  if (!fallback) {
    return (
      <div className="stack" data-testid="pack-content">
        {children}
      </div>
    )
  }
  return (
    <div className="stack" lang="es" data-testid="pack-content">
      <I18nContext.Provider value={spanish}>{children}</I18nContext.Provider>
    </div>
  )
}
