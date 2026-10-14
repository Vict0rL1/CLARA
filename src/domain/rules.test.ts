import { describe, expect, it } from 'vitest'
import { deleteCategory, deleteCategoryRule, restoreCategoryRule, saveCategoryRule, setCategoryArchived } from './operations'
import { matchCategoryRule, normalizeText } from './rules'
import type { CategoryRule, CustomCategory } from './types'
import { baseData, ctx, EARLIER, NOW } from '../test/fixtures'

const rule = (pattern: string, categoryId: string, overrides: Partial<CategoryRule> = {}): CategoryRule => ({
  id: `r-${pattern}`,
  pattern,
  kind: 'expense',
  categoryId,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
})

describe('reglas de categoría', () => {
  it('normaliza mayúsculas, acentos y espacios', () => {
    expect(normalizeText('  CAFÉ   Central ')).toBe('cafe central')
  })

  it('coincide por «contiene», sin distinguir acentos ni mayúsculas', () => {
    const rules = [rule('café', 'dining')]
    expect(matchCategoryRule('TIM HORTONS CAFE #123', 'expense', rules)?.categoryId).toBe('dining')
    expect(matchCategoryRule('Supermercado', 'expense', rules)).toBeUndefined()
  })

  it('gana la más específica (texto más largo); si empatan, la más antigua', () => {
    const rules = [rule('uber', 'transport'), rule('uber eats', 'dining'), rule('eats', 'groceries', { createdAt: EARLIER }), rule('ubers', 'shopping')]
    expect(matchCategoryRule('UBER EATS Toronto', 'expense', rules)?.categoryId).toBe('dining')
    expect(matchCategoryRule('Uber trip', 'expense', rules)?.categoryId).toBe('transport')
    const tie = [rule('abc', 'shopping'), rule('xyz', 'health', { createdAt: EARLIER })]
    expect(matchCategoryRule('abc xyz', 'expense', tie)?.categoryId).toBe('health')
  })

  it('respeta el tipo: una regla de gasto no aplica a ingresos; devoluciones usan las de gasto', () => {
    const rules = [rule('amazon', 'shopping'), rule('nomina', 'salary', { kind: 'income' })]
    expect(matchCategoryRule('Amazon', 'income', rules)).toBeUndefined()
    expect(matchCategoryRule('Amazon', 'refund', rules)?.categoryId).toBe('shopping')
    expect(matchCategoryRule('NÓMINA SEPT', 'income', rules)?.categoryId).toBe('salary')
    expect(matchCategoryRule('Amazon', 'transfer', rules)).toBeUndefined()
  })

  it('ignora reglas cuya categoría está archivada', () => {
    const custom: CustomCategory[] = [{ id: 'c_pets', name: 'Mascotas', kind: 'expense', archived: true, createdAt: NOW, updatedAt: NOW }]
    expect(matchCategoryRule('Pet store', 'expense', [rule('pet', 'c_pets')], custom)).toBeUndefined()
  })
})

describe('operaciones de reglas', () => {
  it('crea, valida y no duplica el mismo texto para el mismo tipo', () => {
    const r1 = saveCategoryRule(baseData(), { id: 'r1', pattern: '  Walmart ', kind: 'expense', categoryId: 'groceries' }, ctx)
    if (!r1.ok) throw new Error('save')
    expect(r1.value.pattern).toBe('Walmart')
    const dup = saveCategoryRule(r1.data, { id: 'r2', pattern: 'WALMART', kind: 'expense', categoryId: 'shopping' }, ctx)
    expect(dup.ok ? [] : dup.issues.map((i) => i.code)).toEqual(['duplicateRule'])
    // El mismo texto para ingresos sí se permite.
    expect(saveCategoryRule(r1.data, { id: 'r3', pattern: 'walmart', kind: 'income', categoryId: 'other_income' }, ctx).ok).toBe(true)
  })

  it('rechaza textos cortos y categorías de otro tipo', () => {
    const short = saveCategoryRule(baseData(), { id: 'r1', pattern: 'a', kind: 'expense', categoryId: 'groceries' }, ctx)
    expect(short.ok ? [] : short.issues.map((i) => i.code)).toEqual(['patternTooShort'])
    const wrong = saveCategoryRule(baseData(), { id: 'r1', pattern: 'nomina', kind: 'expense', categoryId: 'salary' }, ctx)
    expect(wrong.ok ? [] : wrong.issues.map((i) => i.code)).toEqual(['invalidCategory'])
  })

  it('guardar igual dos veces no cambia nada; eliminar y deshacer conserva el id', () => {
    const r = saveCategoryRule(baseData(), { id: 'r1', pattern: 'metro', kind: 'expense', categoryId: 'transport' }, ctx)
    if (!r.ok) throw new Error('save')
    expect(saveCategoryRule(r.data, { id: 'r1', pattern: 'metro', kind: 'expense', categoryId: 'transport' }, ctx)).toMatchObject({ unchanged: true })
    const del = deleteCategoryRule(r.data, 'r1', ctx)
    if (!del.ok) throw new Error('delete')
    expect(del.data.categoryRules).toEqual([])
    const back = restoreCategoryRule(del.data, del.value, ctx)
    expect(back.ok && back.data.categoryRules).toEqual([r.value])
  })

  it('al eliminar una categoría personalizada sin uso, se quitan sus reglas', () => {
    const cat: CustomCategory = { id: 'c_pets', name: 'Mascotas', kind: 'expense', archived: false, createdAt: NOW, updatedAt: NOW }
    const data = baseData({ categories: [cat], categoryRules: [rule('pet', 'c_pets')] })
    const archived = setCategoryArchived(data, 'c_pets', true, ctx)
    expect(archived.ok && archived.data.categoryRules).toHaveLength(1)
    const del = deleteCategory(data, 'c_pets', ctx)
    expect(del.ok && del.data.categoryRules).toEqual([])
  })
})

describe('reglas explicadas (etapa 2)', () => {
  const rule = (id: string, pattern: string, categoryId: string, createdAt = '2026-09-01T00:00:00.000Z', kind: 'expense' | 'income' = 'expense') => ({ id, pattern, kind, categoryId, createdAt, updatedAt: createdAt })

  it('explica por qué gana una regla: única, la más larga o la más antigua', async () => {
    const { explainRuleMatch } = await import('./rules')
    const uber = rule('a', 'uber', 'transport')
    const eats = rule('b', 'uber eats', 'dining')
    const eats2 = rule('c', 'Uber Eats', 'groceries', '2026-09-02T00:00:00.000Z')
    expect(explainRuleMatch('viaje en uber', 'expense', [uber, eats])).toMatchObject({ rule: { id: 'a' }, reason: 'only', competitors: [] })
    expect(explainRuleMatch('pedido uber eats', 'expense', [uber, eats])).toMatchObject({ rule: { id: 'b' }, reason: 'longest', competitors: [{ id: 'a' }] })
    expect(explainRuleMatch('pedido uber eats', 'expense', [eats2, eats, uber])).toMatchObject({ rule: { id: 'b' }, reason: 'oldest' })
    expect(explainRuleMatch('taxi', 'expense', [uber, eats])).toBeUndefined()
  })

  it('lista los conflictos (patrón contenido o igual con otra categoría) y quién gana', async () => {
    const { ruleConflicts } = await import('./rules')
    const uber = rule('a', 'uber', 'transport')
    const eats = rule('b', 'uber eats', 'dining')
    const same = rule('c', 'UBER', 'groceries', '2026-09-05T00:00:00.000Z')
    const income = rule('d', 'uber', 'salary', '2026-09-01T00:00:00.000Z', 'income')
    const conflicts = ruleConflicts([uber, eats, same, income])
    expect(conflicts.map((c) => [c.winner.id, c.loser.id, c.reason])).toEqual([
      ['a', 'c', 'older'],
      ['b', 'a', 'longer'],
      ['b', 'c', 'longer'],
    ])
    // Misma categoría: no es conflicto.
    expect(ruleConflicts([uber, rule('e', 'uber eats', 'transport')])).toEqual([])
  })

  it('previsualiza una regla sobre lo ya registrado sin cambiarlo', async () => {
    const { previewRule } = await import('./rules')
    const { baseData, tx } = await import('../test/fixtures')
    const d = baseData({
      transactions: [
        tx({ id: 't1', kind: 'expense', note: 'Uber al trabajo', categoryId: 'transport', date: '2026-09-20' }),
        tx({ id: 't2', kind: 'expense', merchant: 'Uber Eats', categoryId: 'dining', date: '2026-09-25' }),
        tx({ id: 't3', kind: 'income', note: 'uber', categoryId: 'salary', date: '2026-09-26' }),
      ],
    })
    const p = previewRule(d, 'uber', 'expense', 'transport')
    expect(p).toMatchObject({ total: 2, withOtherCategory: 1 })
    expect(p.sample.map((t) => t.id)).toEqual(['t2', 't1'])
    expect(previewRule(d, 'u', 'expense', 'transport').total).toBe(0)
    expect(d.transactions.map((t) => t.categoryId)).toEqual(['transport', 'dining', 'salary'])
  })
})
