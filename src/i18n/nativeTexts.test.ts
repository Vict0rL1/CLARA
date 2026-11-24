import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Language } from '../domain/types'
import { nativeTextsLoader } from '../platform/texts'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { createTranslator, setNativeTexts, translate, type MessageKey } from './index'
import { loadNativeTexts, NATIVE_OWN_PREFIX, overridesOf } from './nativeTexts'
import nativeEn from './packs/nativeApp.en.json'
import nativeEs from './packs/nativeApp.es.json'
import nativeFr from './packs/nativeApp.fr.json'
import nativePt from './packs/nativeApp.pt.json'
import { pt } from './pt'

const PACKS: Record<Language, Record<string, string>> = { es: nativeEs, en: nativeEn, pt: nativePt, fr: nativeFr }
const MAIN: Record<Language, Record<string, string>> = { es, en, pt, fr }
const LANGUAGES: Language[] = ['es', 'en', 'pt', 'fr']
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

afterEach(() => {
  for (const language of LANGUAGES) setNativeTexts(language, null)
})

describe('textos de la app de iPhone (decisión 164): el paquete', () => {
  it('cada clave es propia (`nativeApp.*`) o existe en el diccionario principal: ninguna sustitución apunta a la nada', () => {
    expect(NATIVE_OWN_PREFIX).toBe('nativeApp.')
    const unknown = Object.keys(nativeEs).filter((key) => !key.startsWith(NATIVE_OWN_PREFIX) && !(key in es))
    expect(unknown).toEqual([])
    // Y al revés: una clave propia nunca pisa una de la interfaz.
    expect(Object.keys(nativeEs).filter((key) => key.startsWith(NATIVE_OWN_PREFIX) && key in es)).toEqual([])
    // Lo que se aplica como sustitución son exactamente las que existen en la interfaz.
    expect(Object.keys(overridesOf(nativeEs)).every((key) => key in es)).toBe(true)
  })

  it('una sustitución usa los mismos parámetros que el texto de la web, en los cuatro idiomas', () => {
    const different: string[] = []
    for (const language of LANGUAGES) {
      for (const [key, text] of Object.entries(overridesOf(PACKS[language]))) {
        if (placeholders(text).join() !== placeholders(MAIN[language][key]!).join()) different.push(`${language}:${key}`)
      }
    }
    expect(different).toEqual([])
  })

  it('ninguna sustitución habla ya del navegador ni de pestañas; Safari solo donde se explica de dónde traer los datos', () => {
    const browser: Record<Language, RegExp> = { es: /navegador|pestaña/i, en: /browser|\btabs?\b/i, pt: /navegador|\babas?\b/i, fr: /navigateur|onglet/i }
    const mentions: string[] = []
    for (const language of LANGUAGES) {
      for (const [key, text] of Object.entries(PACKS[language])) {
        if (browser[language].test(text)) mentions.push(`${language}:${key}`)
        if (/safari/i.test(text) && !['welcome.restore.hint', 'nativeApp.data.text', 'nativeApp.bring.step1'].includes(key)) mentions.push(`${language}:${key} (Safari)`)
      }
    }
    expect(mentions).toEqual([])
  })

  it('ningún texto queda vacío ni igual al de la web (una sustitución que no cambia nada sobra)', () => {
    const useless: string[] = []
    for (const language of LANGUAGES) {
      for (const [key, text] of Object.entries(PACKS[language])) {
        if (text.trim() === '' || text === MAIN[language][key]) useless.push(`${language}:${key}`)
      }
    }
    expect(useless).toEqual([])
  })
})

describe('textos de la app de iPhone: cómo se aplican', () => {
  it('sin textos de la app (el navegador) todo sale del diccionario de siempre', () => {
    expect(translate('es', 'install.title')).toBe('Instalar Clara')
    expect(translate('es', 'settings.storage.local')).toBe(es['settings.storage.local'])
  })

  it('con ellos, la clave sustituida sale de la app; las demás, de la interfaz', () => {
    setNativeTexts('es', overridesOf(nativeEs))
    expect(translate('es', 'install.title')).toBe('Clara en este iPhone')
    expect(translate('es', 'settings.storage.local')).toBe('Tus datos se guardan solo en este iPhone, dentro de la app Clara.')
    expect(translate('es', 'settings.backup.export')).toBe(es['settings.backup.export'])
    // Los parámetros se rellenan igual.
    expect(translate('es', 'data.row.preMigration.ok', { version: 15 })).toBe('Copia previa a la migración al esquema 15, conservada en la app')
    // El traductor de las pantallas pasa por el mismo sitio.
    expect(createTranslator('es').t('safety.step2')).toBe('Haz la primera copia')
  })

  it('cada idioma por separado: los textos de la app en español nunca salen en otro idioma', () => {
    setNativeTexts('es', overridesOf(nativeEs))
    expect(translate('es', 'install.title')).toBe('Clara en este iPhone')
    // El inglés no está cargado en esta prueba: cae al diccionario de siempre, no a la sustitución en español.
    expect(translate('en', 'install.title')).toBe(es['install.title'])
    setNativeTexts('en', overridesOf(nativeEn))
    expect(translate('en', 'install.title')).toBe('Clara on this iPhone')
  })

  it('las claves propias de la sección no entran en las sustituciones', () => {
    const overrides = overridesOf(nativeEs)
    expect(Object.keys(overrides).some((key) => key.startsWith('nativeApp.'))).toBe(false)
    expect(Object.keys(overrides).length).toBeGreaterThan(40)
    setNativeTexts('es', overrides)
    // Pedida por error como texto de la interfaz, una clave propia sigue sin existir ahí.
    expect(translate('es', 'nativeApp.intro' as MessageKey)).toBe('nativeApp.intro')
  })
})

describe('textos de la app de iPhone: la carga', () => {
  it('devuelve las sustituciones del idioma pedido', async () => {
    const texts = await loadNativeTexts('fr', async () => ({ pack: nativeFr, language: 'fr' }))
    expect(texts?.['install.title']).toBe('Clara sur cet iPhone')
    expect(texts && 'nativeApp.intro' in texts).toBe(false)
  })

  it('si el idioma pedido no cargó y llegó el español de respaldo, no se sustituye nada', async () => {
    expect(await loadNativeTexts('fr', async () => ({ pack: nativeEs, language: 'es' }))).toBeNull()
  })

  it('si el paquete no carga, no hay sustituciones (se ve el texto de la web) y nada falla', async () => {
    expect(
      await loadNativeTexts('es', async () => {
        throw new Error('packTimeout')
      }),
    ).toBeNull()
  })

  it('en el navegador no hay cargador: no se pide nada', () => {
    expect(nativeTextsLoader(false)).toBeNull()
    expect(typeof nativeTextsLoader(true)).toBe('function')
  })
})

/** Todos los `.ts`/`.tsx` bajo una carpeta. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('textos de la app de iPhone: fuera del JS inicial', () => {
  it('`nativeTexts.ts` solo se carga con import(): nadie lo importa de forma estática', () => {
    const root = join(import.meta.dirname, '..')
    const eager = sources(root)
      .filter((path) => !path.endsWith('.test.ts'))
      .filter((path) => /from\s+['"][^'"]*\/nativeTexts['"]/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(root, path).split(sep).join('/'))
    expect(eager).toEqual([])
  })
})
