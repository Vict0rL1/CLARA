import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * Guardas del proyecto de iPhone que se pueden comprobar sin Xcode (este entorno no compila Swift). No dicen que el
 * Swift compile: evitan los olvidos que solo se verían al abrir Xcode o en el iPhone.
 */
const IOS = join(__dirname, '..', '..', 'ios')
const APP = join(IOS, 'App', 'App')
const WIDGETS = join(IOS, 'ClaraWidgetsSources')
const LANGS = ['es', 'pt', 'fr'] as const

type XcStrings = { sourceLanguage: string; strings: Record<string, { localizations?: Record<string, { stringUnit?: { state?: string; value?: string } }> }> }
const readStrings = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as XcStrings
const swiftFiles = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.swift'))

/** Los textos que el sistema enseña (títulos, descripciones, respuestas, etiquetas), como claves de `.xcstrings`. */
function visibleStrings(source: string): string[] {
  const out = new Set<string>()
  const literal = String.raw`"((?:[^"\\]|\\.)*)"`
  const contexts = [
    String.raw`LocalizedStringResource\s*=\s*`,
    String.raw`@Parameter\(title:\s*`,
    String.raw`IntentDescription\(`,
    String.raw`needsValueError\(`,
    String.raw`\.result\(dialog:\s*`,
    String.raw`shortTitle:\s*`,
    String.raw`TypeDisplayRepresentation\(name:\s*`,
    String.raw`DisplayRepresentation\(title:\s*`,
    String.raw`Label\(`,
    String.raw`\.displayName\(`,
    String.raw`\.description\(`,
  ]
  for (const c of contexts) for (const m of source.matchAll(new RegExp(c + literal, 'g'))) out.add(m[1]!.replace(/\\\([^)]*\)/g, '%@'))
  return [...out]
}

/** Las frases de Siri (`phrases: [...]`), como claves de `AppShortcuts.xcstrings`. */
function phrases(source: string): string[] {
  return [...source.matchAll(/"((?:[^"\\]|\\.)*\\\(\.applicationName\)(?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!.replace(/\\\(\.applicationName\)/g, '${applicationName}'))
}

function expectTranslated(strings: XcStrings, keys: readonly string[], where: string) {
  for (const key of keys) {
    const entry = strings.strings[key]
    expect(entry, `${where}: falta «${key}»`).toBeDefined()
    for (const lang of LANGS) expect(entry?.localizations?.[lang]?.stringUnit?.value?.trim(), `${where}: «${key}» sin ${lang}`).toBeTruthy()
  }
}

describe('proyecto de iPhone (sin Xcode)', () => {
  it('cada archivo Swift de la app está en el proyecto y en la fase de compilación de la app', () => {
    const pbx = readFileSync(join(IOS, 'App', 'App.xcodeproj', 'project.pbxproj'), 'utf8')
    for (const file of swiftFiles(APP)) {
      expect(pbx, file).toContain(`/* ${file} */ = {isa = PBXFileReference;`)
      expect(pbx, file).toContain(`/* ${file} in Sources */ = {isa = PBXBuildFile;`)
    }
    // Las fuentes de la extensión (`ios/ClaraWidgetsSources/`) entran en el proyecto cuando se crea la extensión en
    // Xcode (docs/IOS-NATIVE.md, «Fase 4»); hasta entonces no están y no afectan a la compilación de la app.
  })

  it('cada texto visible de las acciones y del control tiene su traducción en es, pt y fr', () => {
    const app = readStrings(join(APP, 'Localizable.xcstrings'))
    for (const file of swiftFiles(APP)) expectTranslated(app, visibleStrings(readFileSync(join(APP, file), 'utf8')), file)
    // El control vive en la extensión, que tiene sus propios textos; la acción compartida también se traduce allí.
    const widgets = readStrings(join(WIDGETS, 'Localizable.xcstrings'))
    for (const file of [...swiftFiles(WIDGETS).map((f) => join(WIDGETS, f)), join(APP, 'ClaraOpenIntent.swift')]) expectTranslated(widgets, visibleStrings(readFileSync(file, 'utf8')), file)
  })

  it('cada frase de Siri lleva el nombre de la app y está traducida', () => {
    const shortcuts = readStrings(join(APP, 'AppShortcuts.xcstrings'))
    const source = readFileSync(join(APP, 'ClaraShortcuts.swift'), 'utf8')
    const found = phrases(source)
    expect(found.length).toBeGreaterThanOrEqual(4)
    expectTranslated(shortcuts, found, 'ClaraShortcuts.swift')
    for (const key of Object.keys(shortcuts.strings)) {
      expect(key).toContain('${applicationName}')
      for (const lang of LANGS) expect(shortcuts.strings[key]!.localizations![lang]!.stringUnit!.value).toContain('${applicationName}')
    }
  })

  it('cada texto de permiso del Info.plist está en InfoPlist.xcstrings en en, es, pt y fr (y está en el proyecto)', () => {
    const plist = readFileSync(join(APP, 'Info.plist'), 'utf8')
    const keys = [...plist.matchAll(/<key>(NS\w+UsageDescription)<\/key>/g)].map((m) => m[1]!)
    expect(keys).toEqual(expect.arrayContaining(['NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription', 'NSFaceIDUsageDescription']))
    const strings = readStrings(join(APP, 'InfoPlist.xcstrings'))
    for (const key of keys) for (const lang of ['en', ...LANGS]) expect(strings.strings[key]?.localizations?.[lang]?.stringUnit?.value?.trim(), `${key} ${lang}`).toBeTruthy()
    const pbx = readFileSync(join(IOS, 'App', 'App.xcodeproj', 'project.pbxproj'), 'utf8')
    expect(pbx).toContain('/* InfoPlist.xcstrings in Resources */ = {isa = PBXBuildFile;')
  })

  it('cada plugin propio está registrado en la vista de Clara', () => {
    const scene = readFileSync(join(APP, 'SceneDelegate.swift'), 'utf8')
    const plugins = swiftFiles(APP)
      .map((f) => /@objc\((Clara\w+Plugin)\)/.exec(readFileSync(join(APP, f), 'utf8'))?.[1])
      .filter((name): name is string => !!name)
    expect(plugins.length).toBeGreaterThanOrEqual(7)
    for (const name of plugins) expect(scene, name).toContain(`registerPluginInstance(${name}())`)
  })

  it('solo un proveedor de frases de Siri en la app (Apple admite uno)', () => {
    const providers = swiftFiles(APP).filter((f) => /:\s*AppShortcutsProvider\b/.test(readFileSync(join(APP, f), 'utf8')))
    expect(providers).toEqual(['ClaraShortcuts.swift'])
  })
})
