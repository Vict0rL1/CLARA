/**
 * Clara 2.0 fase 2 · comercios: la misma tienda escrita de distintas formas en los extractos del banco
 * coincide con la misma regla y se agrupa en las estadísticas, sin cambiar nada de lo guardado.
 */
import { describe, expect, it } from 'vitest'
import { computeInbox } from './inbox'
import { merchantKey, merchantLabel } from './merchants'
import { explainRuleMatch, normalizeText, rankRuleMatches, ruleMatchesText, suggestRuleFromCorrection } from './rules'
import { topMerchants } from './statistics'
import type { CategoryRule } from './types'
import { baseData, ctx, tx } from '../test/fixtures'

const CREATED = '2026-01-10T12:00:00.000Z'
const rule = (id: string, pattern: string, categoryId: string): CategoryRule => ({ id, pattern, kind: 'expense', categoryId, createdAt: CREATED, updatedAt: CREATED })

describe('merchantKey / merchantLabel', () => {
  it('quita el prefijo del procesador, los signos y los códigos de referencia', () => {
    const cases: [string, string, string][] = [
      ['UBER *EATS 8XK2L TORONTO ON', 'uber eats toronto on', 'UBER EATS TORONTO ON'],
      ['SQ *CAFE CENTRAL', 'cafe central', 'CAFE CENTRAL'],
      ['TST* Pizzería Sol #1234', 'pizzeria sol', 'Pizzería Sol'],
      ['PAYPAL *NETFLIX.COM', 'netflix com', 'NETFLIX COM'],
      ['AMZN Mktp CA*2K3LZ', 'amzn mktp ca', 'AMZN Mktp CA'],
      ['7-ELEVEN 34512', '7 eleven', '7 ELEVEN'],
      ['Café del museo', 'cafe del museo', 'Café del museo'],
      ['A&W', 'a w', 'A W'],
      ['000123', '', ''],
      ['', '', ''],
    ]
    for (const [text, key, label] of cases) {
      expect(merchantKey(text), text).toBe(key)
      expect(merchantLabel(text), text).toBe(label)
    }
  })

  it('un «*» que no sigue a un prefijo conocido solo separa palabras', () => {
    expect(merchantKey('HOME*DEPOT 7021')).toBe('home depot')
    // Sin «*», «SQ» es una palabra más (p. ej. un comercio llamado así).
    expect(merchantKey('SQ FT FLOORING')).toBe('sq ft flooring')
  })
})

describe('reglas con claves de comercio', () => {
  const rules = [rule('r1', 'uber', 'transport'), rule('r2', 'Uber Eats', 'dining'), rule('r3', 'cafe central', 'dining'), rule('r4', 'netflix', 'subscriptions')]

  it('las variantes del extracto coinciden con la regla y gana la más específica', () => {
    expect(explainRuleMatch('UBER *EATS 8XK2L TORONTO', 'expense', rules)?.rule.id).toBe('r2')
    expect(explainRuleMatch('UBER *TRIP 99ZZ1', 'expense', rules)?.rule.id).toBe('r1')
    expect(explainRuleMatch('SQ *CAFE CENTRAL', 'expense', rules)?.rule.id).toBe('r3')
    expect(explainRuleMatch('PAYPAL *NETFLIX.COM 4029357733', 'expense', rules)?.rule.id).toBe('r4')
    // Antes «UBER *EATS» solo coincidía con «uber»: la categoría habría sido transporte.
    expect(explainRuleMatch('UBER *EATS 8XK2L TORONTO', 'expense', rules)?.competitors.map((r) => r.id)).toEqual(['r1'])
  })

  it('es un superconjunto: todo lo que coincidía tal cual sigue coincidiendo (500 textos aleatorios)', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const words = ['uber', 'eats', 'café', 'central', 'sq', '*', '#12', 'netflix', '.com', 'a&w', '7-eleven', 'super', 'mercado', '2k3lz', 'ole']
    const patterns = ['uber', 'uber eats', 'cafe', 'central', 'netflix', 'a&w', '7-eleven', 'super mercado', 'mercado', 'ole', '.com', '#12']
    for (let i = 0; i < 500; i++) {
      const text = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => words[Math.floor(rnd() * words.length)]).join(rnd() < 0.5 ? ' ' : '')
      const norm = normalizeText(text)
      for (const p of patterns) {
        if (norm.includes(normalizeText(p))) expect(ruleMatchesText(norm, p), `${text} ⊇ ${p}`).toBe(true)
      }
      const plain = rules.filter((r) => norm.includes(normalizeText(r.pattern))).map((r) => r.id)
      const now = rankRuleMatches(norm, rules).map((r) => r.id)
      for (const id of plain) expect(now, text).toContain(id)
    }
  })

  it('un patrón que se queda sin palabras (solo un código) solo coincide tal cual', () => {
    expect(ruleMatchesText(normalizeText('pago 4029 luz'), '4029')).toBe(true)
    expect(ruleMatchesText(normalizeText('pago 4030 luz'), '4029')).toBe(false)
  })

  it('al proponer recordar una corrección se propone el comercio sin el código', () => {
    const d = baseData({ categoryRules: [rule('r1', 'uber', 'transport')] })
    expect(suggestRuleFromCorrection(d, { note: 'UBER *EATS 8XK2L', kind: 'expense', categoryId: 'dining', previousCategoryId: 'transport' })).toEqual({ pattern: 'UBER EATS', kind: 'expense', categoryId: 'dining' })
  })
})

describe('bandeja y estadísticas con comercios', () => {
  it('una regla que solo coincide por clave de comercio no se marca «sin uso»', () => {
    const d = baseData({ categoryRules: [rule('r', 'uber eats', 'dining')], transactions: [tx({ id: 't', note: 'UBER *EATS 8XK2L', date: '2026-09-20', categoryId: 'dining' })] })
    expect(computeInbox(d, ctx.today).filter((i) => i.reason === 'ruleUnused')).toEqual([])
    const old = baseData({ categoryRules: [rule('r', 'uber eats', 'dining')], transactions: [tx({ id: 't', note: 'UBER *EATS 8XK2L', date: '2026-05-20', categoryId: 'dining' })] })
    expect(computeInbox(old, ctx.today).filter((i) => i.reason === 'ruleUnused').map((i) => i.lastMovementDate)).toEqual(['2026-05-20'])
  })

  it('«Top comercios» junta las variantes del mismo comercio y muestra la primera forma escrita', () => {
    const d = baseData({
      transactions: [
        tx({ id: 'a', note: 'UBER *EATS 8XK2L', amountMinor: 1500, date: '2026-09-10', categoryId: 'dining' }),
        tx({ id: 'b', note: 'UBER *EATS 9QQ1Z', amountMinor: 2500, date: '2026-09-12', categoryId: 'dining' }),
        tx({ id: 'c', merchant: 'Uber Eats', note: 'cena', amountMinor: 1000, date: '2026-09-14', categoryId: 'dining' }),
        tx({ id: 'd', note: 'Farmacia', amountMinor: 3000, date: '2026-09-15', categoryId: 'health' }),
      ],
    })
    const top = topMerchants(d, { start: '2026-09-01', end: '2026-09-30', period: null })
    expect(top.map((e) => [e.label, e.amountMinor, e.count])).toEqual([
      ['UBER *EATS 8XK2L', 5000, 3],
      ['Farmacia', 3000, 1],
    ])
  })
})
