/**
 * Textos de la app de iPhone (decisión 164). El paquete diferido `nativeApp` lleva dos clases de claves:
 *  - las que EXISTEN en el diccionario principal (p. ej. `settings.storage.local`): dentro de la app sustituyen al
 *    texto de la web, que habla del navegador, de Safari o de pestañas;
 *  - las propias (`nativeApp.*`): las lee la sección «Clara en este iPhone» con `usePack`, como cualquier paquete.
 *
 * Este módulo solo se carga dentro de la app (`src/platform/`): en el navegador no se pide nada. Solo se sustituye con
 * el paquete del MISMO idioma: si el pedido no carga, el respaldo en español no se aplica (un texto de la interfaz
 * nunca sale en otro idioma) y se sigue viendo el de la web.
 */
import type { Language } from '../domain/types'
import { loadPack } from './packs'

/** Prefijo de las claves propias de la sección «Clara en este iPhone». */
export const NATIVE_OWN_PREFIX = 'nativeApp.'

/**
 * Las claves del paquete que sustituyen a una del diccionario principal: todas menos las propias. Una prueba exige que
 * cada una exista en el diccionario principal (`nativeTexts.test.ts`), así aquí no hace falta cargarlo para filtrar.
 */
export function overridesOf(pack: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(pack).filter(([key]) => !key.startsWith(NATIVE_OWN_PREFIX)))
}

export async function loadNativeTexts(language: Language, load: typeof loadPack = loadPack): Promise<Record<string, string> | null> {
  try {
    const loaded = await load('nativeApp', language)
    return loaded.language === language ? overridesOf(loaded.pack) : null
  } catch {
    return null
  }
}
