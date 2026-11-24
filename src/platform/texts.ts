/**
 * Textos de la app de iPhone (decisión 164): dentro de la app, los textos que hablan del navegador se sustituyen por
 * los de la app. El paquete y su cargador van en un trozo diferido que solo se pide ahí; en el navegador esto devuelve
 * `null` y no se pide nada.
 */
import type { NativeTextsLoader } from '../i18n'
import { isNativeIOS } from './index'

export function nativeTextsLoader(native: boolean = isNativeIOS()): NativeTextsLoader | null {
  if (!native) return null
  return (language) => import('../i18n/nativeTexts').then((m) => m.loadNativeTexts(language))
}
