import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { EXPENSE_CATEGORY_IDS, INCOME_CATEGORY_IDS } from '../domain/categories'
import { ACCOUNT_KINDS, FREQUENCIES, NUMBER_LOCALES } from '../domain/validation'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { pt } from './pt'
import { pseudoLocalize } from './pseudo'
import { createTranslator, enablePseudoLocale, isLanguageLoaded, loadLanguage, translate } from './index'
import bankImportPack from './packs/bankImport.es.json'
import galleryPack from './packs/gallery.es.json'
import legalPack from './packs/legal.es.json'
import nativeAppPack from './packs/nativeApp.es.json'
import whatChangedPack from './packs/whatChanged.es.json'
import shortfallPack from './packs/shortfall.es.json'
import capturePack from './packs/capture.es.json'

const LANGS = { en, pt, fr } as const

const keys = new Set(Object.keys(es))
/** Las claves de los paquetes diferidos (`packs/*.json`, mismas en los cuatro idiomas por `packKeys.ts`). */
const packKeys = new Set([...Object.keys(legalPack), ...Object.keys(galleryPack), ...Object.keys(bankImportPack), ...Object.keys(nativeAppPack), ...Object.keys(whatChangedPack), ...Object.keys(shortfallPack), ...Object.keys(capturePack)])
const has = (k: string) => keys.has(k)

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [path] : []
  })
}

describe('textos (i18n)', () => {
  // Inglés, portugués y francés se cargan bajo demanda (decisión 55).
  beforeAll(async () => {
    await Promise.all((['en', 'pt', 'fr'] as const).map((l) => loadLanguage(l)))
  })

  it('carga bajo demanda: el español siempre está; los demás tras loadLanguage', () => {
    expect(isLanguageLoaded('es')).toBe(true)
    expect(isLanguageLoaded('en') && isLanguageLoaded('pt') && isLanguageLoaded('fr')).toBe(true)
  })

  it('tiene texto para cada valor dinámico', () => {
    const expected = [
      ...[...EXPENSE_CATEGORY_IDS, ...INCOME_CATEGORY_IDS].map((c) => `category.${c}`),
      ...FREQUENCIES.map((f) => `frequency.${f}`),
      ...['income', 'expense', 'transfer', 'refund'].map((k) => `txKind.${k}`),
      ...['income', 'expense', 'transfer', 'refund'].map((k) => `movementForm.kindHint.${k}`),
      ...['pending', 'overdue', 'paid', 'received', 'skipped'].map((s) => `state.${s}`),
      ...ACCOUNT_KINDS.map((k) => `accountKind.${k}`),
      ...NUMBER_LOCALES.map((l) => `settings.format.locale.${l}`),
      ...['fits', 'tight', 'onlyWithGoals', 'doesNotFit'].flatMap((v) => [`afford.verdict.${v}`, `afford.verdictText.${v}`]),
      ...['empty', 'invalid', 'tooManyDecimals', 'negativeNotAllowed', 'tooLarge', 'zero'].map((e) => `money.error.${e}`),
      ...['today', 'tomorrow', 'yesterday'].map((r) => `relative.${r}`),
    ]
    expect(expected.filter((k) => !has(k))).toEqual([])
  })

  it('tiene mensaje para cada código de validación', () => {
    const validation = readFileSync(join(__dirname, '../domain/validation.ts'), 'utf8')
    const union = validation.slice(validation.indexOf('export type IssueCode'), validation.indexOf('export interface Issue'))
    const codes = [...union.matchAll(/'(\w+)'/g)].map((m) => m[1])
    const backup = readFileSync(join(__dirname, '../storage/backup.ts'), 'utf8')
    const backupLine = backup.slice(backup.indexOf('export type BackupIssueCode'), backup.indexOf('\n', backup.indexOf('export type BackupIssueCode')))
    codes.push(...[...backupLine.matchAll(/'(\w+)'/g)].map((m) => m[1]))
    expect(codes.length).toBeGreaterThan(20)
    expect(codes.filter((c) => !has(`issue.${c}`))).toEqual([])
  })

  it('cada clave usada en el código existe (incluye singular y plural)', () => {
    const missing: string[] = []
    for (const file of sourceFiles(join(__dirname, '..'))) {
      const text = readFileSync(file, 'utf8')
      // Una clave de paquete solo vale en una pantalla que traduce con su paquete; en las demás saldría la clave tal cual.
      const withPack = /\busePack\(|\bpackTranslator\(/.test(text)
      const exists = (k: string) => has(k) || (withPack && packKeys.has(k))
      for (const m of text.matchAll(/\bt\('([\w.-]+)'/g)) if (!exists(m[1]!)) missing.push(`${file}: ${m[1]}`)
      for (const m of text.matchAll(/\btn\('([\w.-]+)'/g)) {
        for (const form of ['one', 'other']) if (!exists(`${m[1]}_${form}`)) missing.push(`${file}: ${m[1]}_${form}`)
      }
    }
    expect(missing).toEqual([])
  })

  it.each(Object.keys(LANGS))('%s: tiene todas las claves del español, ninguna extra y ninguna vacía', (lang) => {
    const dict = LANGS[lang as keyof typeof LANGS] as Record<string, string>
    expect(Object.keys(dict).filter((k) => !has(k))).toEqual([])
    expect([...keys].filter((k) => !(k in dict))).toEqual([])
    expect(Object.entries(dict).filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => k)).toEqual([])
    expect(Object.keys(dict).length).toBe(keys.size)
  })

  it.each(Object.keys(LANGS))('%s: las variables {x} coinciden con las del español', (lang) => {
    const dict = LANGS[lang as keyof typeof LANGS] as Record<string, string>
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const [k, v] of Object.entries(dict)) expect(vars(v), `${lang}: ${k}`).toEqual(vars(es[k as keyof typeof es]))
  })

  it('cada idioma tiene singular y plural para cada base _one/_other', () => {
    const bases = [...keys].filter((k) => k.endsWith('_one')).map((k) => k.slice(0, -4))
    for (const base of bases) {
      for (const dict of [es, en, pt, fr] as Record<string, string>[]) {
        expect(dict[`${base}_one`], base).toBeTruthy()
        expect(dict[`${base}_other`], base).toBeTruthy()
      }
    }
  })

  it('traduce y pluraliza en los cuatro idiomas', () => {
    expect(translate('es', 'common.save')).toBe('Guardar')
    expect(translate('en', 'common.save')).toBe('Save')
    expect(translate('pt', 'common.save')).toBe('Salvar')
    expect(translate('fr', 'common.save')).toBe('Enregistrer')
    expect(createTranslator('fr').tn('movements.count', 1)).toBe('1 opération')
    expect(createTranslator('pt').tn('movements.count', 2)).toBe('2 movimentos')
    expect(createTranslator('fr').tn('movements.count', 0)).toBe('0 opération')
  })

  it('pseudo-locale: marca el texto, conserva variables y se desactiva', () => {
    expect(pseudoLocalize('Guardar')).toBe('[Gúárdár~~~]')
    expect(pseudoLocalize('Faltan {amount}')).toMatch(/^\[Fáltáñ \{amount\}~+\]$/)
    enablePseudoLocale(true)
    try {
      expect(translate('en', 'goals.remaining', { amount: '5' })).toMatch(/^\[.*5.*\]$/)
      expect(translate('en', 'goals.remaining', { amount: '5' })).not.toContain('{amount}')
    } finally {
      enablePseudoLocale(false)
    }
    expect(translate('en', 'common.save')).toBe('Save')
  })
})

describe('UX-01 · la sección «Puedes gastar» se llama como la cifra de Inicio en cada idioma', () => {
  it('ningún diccionario deja «Safe to spend» como título de la sección; el título es el de la cifra', () => {
    for (const [lang, dict] of Object.entries({ es, ...LANGS })) {
      expect(dict['safe.title'], lang).toBe(dict['home.availableLabel'])
      if (lang !== 'en') expect(dict['safe.title'], lang).not.toMatch(/safe to spend/i)
    }
  })
})
