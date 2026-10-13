/**
 * Regresiones de la auditoría posterior (2026-10-12/13) sobre `e7c9d87`: cada bloque reproduce el
 * fallo descrito con datos sintéticos y fija el contrato. Ids: AS-01, FIN-01, FIN-02/03, REC-01,
 * REC-02 y los de la fase 2.
 */
import { describe, expect, it } from 'vitest'
import { saveConfirmedEntries } from './assistant'
import { parseText } from './parser'
import { reviewProposal } from './review'
import { createDemoData } from '../demo/demoData'
import { todayInTimeZone } from './dates'

const NOW = new Date('2026-09-28T12:00:00-04:00')
const TZ = 'America/Toronto'
export function demo() {
  const data = createDemoData({ now: NOW, timeZone: TZ })
  const today = todayInTimeZone(TZ, NOW)
  return { data, today, ctx: { today, now: NOW.toISOString() } }
}
const parseCtx = (today: string, currency = 'CAD') => ({ today, currency, language: 'es' as const, categories: [{ id: 'dining', kind: 'expense' as const }, { id: 'other_expense', kind: 'expense' as const }, { id: 'salary', kind: 'income' as const }] })

describe('AS-01 · el asistente nunca guarda otra moneda como la del presupuesto', () => {
  it('el parser conserva la moneda escrita (prefijo, sufijo y símbolos) y la quita de la descripción', () => {
    const today = '2026-09-28'
    for (const [text, foreign] of [
      ['coffee USD 10', 'USD'],
      ['coffee 10 USD', 'USD'],
      ['café 10 usd', 'USD'],
      ['café €10', '€'],
      ['café 10 EUR', 'EUR'],
      ['taxi US$ 12', 'USD'],
    ] as const) {
      const [e] = parseText(text, parseCtx(today))
      expect(e!.amountMinor, text).toBe(text.includes('12') ? 1200 : 1000)
      expect(e!.foreignCurrency, text).toBe(foreign)
      expect(e!.description.toUpperCase(), text).not.toContain(foreign.toUpperCase())
    }
  })

  it('la misma moneda (o un «$» que puede ser la del presupuesto) no se marca', () => {
    const today = '2026-09-28'
    for (const text of ['café 10', 'café $10', 'café 10 CAD', 'café CAD 10', 'café C$ 10', 'café 10 for two']) {
      const [e] = parseText(text, parseCtx(today))
      expect(e!.foreignCurrency, text).toBeUndefined()
      expect(e!.amountMinor, text).toBe(1000)
    }
  })

  it('la revisión bloquea la propuesta con la moneda escrita y no pide importe aparte', () => {
    const { data, today } = demo()
    const account = data.accounts[0]!.id
    const r = reviewProposal(data, { id: 'p_usd', source: 'ai_text', kind: 'expense', amountMinor: null, writtenCurrency: 'USD', date: today, accountId: account, categoryId: 'dining' }, today)
    expect(r.ok).toBe(false)
    expect(r.issues.map((i) => i.code)).toEqual(['writtenCurrency'])
    expect(r.issues[0]!.params).toEqual({ found: 'USD', expected: 'CAD' })
    const same = reviewProposal(data, { id: 'p_cad', source: 'ai_text', kind: 'expense', amountMinor: 1000, writtenCurrency: 'CAD', date: today, accountId: account, categoryId: 'dining' }, today)
    expect(same.ok).toBe(true)
  })

  it('guardar rechaza todo el lote si una entrada trae otra moneda (todo o nada)', () => {
    const { data, ctx, today } = demo()
    const account = data.accounts[0]!.id
    const entries = [
      { id: 'e1', kind: 'expense' as const, amountMinor: 450, date: today, accountId: account, categoryId: 'dining', source: 'ai_text' as const },
      { id: 'e2', kind: 'expense' as const, amountMinor: 1000, date: today, accountId: account, categoryId: 'dining', source: 'ai_text' as const, writtenCurrency: 'USD' },
    ]
    const r = saveConfirmedEntries(data, entries, ctx)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues[0]).toMatchObject({ path: 'entries[1].amountMinor', code: 'writtenCurrency' })
    const ok = saveConfirmedEntries(data, [entries[0]!, { ...entries[1]!, writtenCurrency: 'CAD' }], ctx)
    expect(ok.ok).toBe(true)
  })
})
