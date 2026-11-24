/**
 * El cuerpo de una pantalla cuyos textos están en un paquete diferido (`usePack`): mientras carga o si falla,
 * `PackNotice`; ya cargado, el contenido dentro de `PackLangScope`. Los componentes de dentro leen el traductor con
 * `usePackT()`: las claves del paquete salen del paquete y el resto, del traductor de la interfaz (`packTranslator`;
 * un texto de la interfaz nunca se traduce con el paquete). La cabecera de la pantalla va fuera, en el idioma de la
 * interfaz, como en las demás pantallas diferidas.
 */
import { useMemo, type ReactNode } from 'react'
import { useT } from '../../i18n'
import { packTranslator, usePack, type PackName } from '../../i18n/packs'
import { PackLangScope } from './PackLangScope'
import { PackNotice } from './PackNotice'
import { PackTexts } from './packTexts'

export function PackBody({ name, children }: { name: PackName; children: ReactNode }) {
  const pack = usePack(name)
  if (pack.status !== 'ready') return <PackNotice state={pack} />
  return (
    <PackLangScope fallback={pack.fallback}>
      <PackProvider texts={pack.texts} language={pack.language}>
        {children}
      </PackProvider>
    </PackLangScope>
  )
}

function PackProvider({ texts, language, children }: { texts: Record<string, string>; language: Parameters<typeof packTranslator>[1]; children: ReactNode }) {
  // Dentro de `PackLangScope`: con el respaldo en español, también el resto de los textos sale en español.
  const base = useT()
  const value = useMemo(() => packTranslator(texts, language, base), [texts, language, base])
  return <PackTexts.Provider value={value}>{children}</PackTexts.Provider>
}
