import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installMode } from '../ui/install'
import { isNativeIOS } from './index'

const ios = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }

describe('capa de plataforma: cómo se reconoce la app de iPhone', () => {
  it('en el navegador no hay puente nativo: no es la app de iPhone', () => {
    expect(isNativeIOS(undefined)).toBe(false)
    expect(isNativeIOS({})).toBe(false)
    expect(isNativeIOS({ Capacitor: {} })).toBe(false)
  })

  it('con el puente nativo de Capacitor en iOS sí lo es', () => {
    expect(isNativeIOS(ios)).toBe(true)
  })

  it('otra plataforma, la versión web de Capacitor o un puente que falla no cuentan', () => {
    expect(isNativeIOS({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } })).toBe(false)
    expect(isNativeIOS({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } })).toBe(false)
    expect(isNativeIOS({ Capacitor: { isNativePlatform: () => true } })).toBe(false)
    expect(
      isNativeIOS({
        Capacitor: {
          isNativePlatform: () => {
            throw new Error('puente roto')
          },
          getPlatform: () => 'ios',
        },
      }),
    ).toBe(false)
    // Un valor que no es exactamente `true` no basta.
    expect(isNativeIOS({ Capacitor: { isNativePlatform: (() => 'ios') as unknown as () => boolean, getPlatform: () => 'ios' } })).toBe(false)
  })

  it('dentro de la app de iPhone no se enseñan los pasos de «Agregar a inicio»: cuenta como instalada', () => {
    expect(installMode({ standalone: isNativeIOS(ios), ios: true, canPrompt: false })).toBe('installed')
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

describe('frontera de la capa de plataforma (decisión 152)', () => {
  const root = join(import.meta.dirname, '..')
  const files = sources(root).map((path) => ({ rel: relative(root, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }))
  const importsCapacitor = (text: string) => /from\s+['"]@capacitor\/|import\(\s*['"]@capacitor\//.test(text)

  it('ningún archivo fuera de src/platform/ importa Capacitor', () => {
    const outside = files.filter((f) => !f.rel.startsWith('platform/') && importsCapacitor(f.text)).map((f) => f.rel)
    expect(outside).toEqual([])
  })

  it('dentro de src/platform/, Capacitor solo se importa en native/ (lo que se carga con import() en la app)', () => {
    const eager = files.filter((f) => f.rel.startsWith('platform/') && !f.rel.startsWith('platform/native/') && !f.rel.endsWith('.test.ts') && importsCapacitor(f.text)).map((f) => f.rel)
    expect(eager).toEqual([])
  })

  it('nada importa de forma estática src/platform/native/: solo con import()', () => {
    const staticNative = files
      .filter((f) => !f.rel.startsWith('platform/native/') && !f.rel.endsWith('.test.ts') && /from\s+['"][^'"]*platform\/native\/|from\s+['"]\.\/native\//.test(f.text))
      .map((f) => f.rel)
    expect(staticNative).toEqual([])
  })
})
