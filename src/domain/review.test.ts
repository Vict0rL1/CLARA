import { describe, expect, it } from 'vitest'
import { saveConfirmedEntries } from './assistant'
import { saveCategoryRule, saveTransaction } from './operations'
import { reviewProposal, reviewProposals, type Proposal } from './review'
import { account, baseData, bill, ctx, tx, TODAY } from '../test/fixtures'

/** Etapa 2: una sola revisión para CSV, texto, voz y foto (misma validación, duplicados, programados, efecto y regla). */
const proposal = (over: Partial<Proposal> = {}): Proposal => ({ id: over.id ?? 'p1', source: 'ai_text', kind: 'expense', amountMinor: 4500, date: TODAY, accountId: 'main', categoryId: 'dining', ...over })

describe('revisión de propuestas', () => {
  it('valida como el formulario y señala la cuenta archivada o el importe que falta', () => {
    const d = baseData({ accounts: [account({ id: 'main', name: 'Principal' }), account({ id: 'old', archived: true })] })
    expect(reviewProposal(d, proposal(), TODAY)).toMatchObject({ ok: true, issues: [], alreadySaved: false, duplicates: [], effectMinor: -4500 })
    expect(reviewProposal(d, proposal({ amountMinor: null }), TODAY).issues).toEqual([{ path: 'amountMinor', code: 'required' }])
    expect(reviewProposal(d, proposal({ accountId: 'old' }), TODAY).issues).toEqual([{ path: 'accountId', code: 'accountArchived' }])
    expect(reviewProposal(d, proposal({ accountId: 'nope' }), TODAY).issues[0]).toMatchObject({ path: 'accountId', code: 'unknownAccount' })
    expect(reviewProposal(d, proposal({ categoryId: 'salary' }), TODAY).issues[0]).toMatchObject({ path: 'categoryId', code: 'invalidCategory' })
    // Una propuesta futura es un movimiento previsto: no se vincula con programados abiertos ni cuenta como duplicado.
    const future = reviewProposal(d, proposal({ date: '2026-10-20' }), TODAY)
    expect(future.ok).toBe(true)
    expect(future.scheduleMatch).toBeUndefined()
  })

  it('detecta posibles duplicados con la misma regla del formulario y marca lo ya guardado', () => {
    const d = baseData({ transactions: [tx({ id: 't1', kind: 'expense', amountMinor: 4500, date: TODAY, note: 'Café' })] })
    const r = reviewProposal(d, proposal({ note: 'café' }), TODAY)
    expect(r.duplicates.map((t) => t.id)).toEqual(['t1'])
    expect(reviewProposal(d, proposal({ id: 't1' }), TODAY).alreadySaved).toBe(true)
    expect(reviewProposal(d, proposal({ amountMinor: 4600 }), TODAY).duplicates).toEqual([])
  })

  it('encuentra el pago programado abierto por importe igual o por categoría y fecha; explica la regla', () => {
    const d0 = baseData({ schedules: [bill('2026-10-01', 65000, { id: 'rent', name: 'Renta', categoryId: 'housing' })] })
    const withRule = saveCategoryRule(d0, { id: 'r1', pattern: 'renta', kind: 'expense', categoryId: 'housing' }, ctx)
    expect(withRule.ok).toBe(true)
    if (!withRule.ok) return
    const d = withRule.data
    const byAmount = reviewProposal(d, proposal({ amountMinor: 65000, categoryId: 'housing', description: 'Renta octubre' }), TODAY)
    expect(byAmount.scheduleMatch).toMatchObject({ sourceId: 'rent', date: '2026-10-01' })
    expect(byAmount.rule).toMatchObject({ rule: { id: 'r1' }, reason: 'only', competitors: [] })
    // Misma categoría y fecha (una ocurrencia que vence hoy, pagada hoy con otro importe).
    const dueToday = baseData({ schedules: [bill(TODAY, 4200, { id: 'power', name: 'Luz', categoryId: 'utilities' })] })
    expect(reviewProposal(dueToday, proposal({ amountMinor: 1000, categoryId: 'utilities' }), TODAY).scheduleMatch?.sourceId).toBe('power')
    expect(reviewProposal(dueToday, proposal({ amountMinor: 1000, categoryId: 'dining' }), TODAY).scheduleMatch).toBeUndefined()
    expect(reviewProposal(d, proposal({ amountMinor: 1000, categoryId: 'housing' }), TODAY).scheduleMatch).toBeUndefined()
    // La regla solo se cita si la categoría propuesta es la suya.
    expect(reviewProposal(d, proposal({ categoryId: 'dining', description: 'Renta' }), TODAY).rule).toBeUndefined()
  })

  it('resume efecto y recuentos de un lote', () => {
    const d = baseData({ transactions: [tx({ id: 't1', kind: 'expense', amountMinor: 4500, date: TODAY })] })
    const s = reviewProposals(d, [proposal(), proposal({ id: 'p2', kind: 'income', amountMinor: 10000, categoryId: 'salary' }), proposal({ id: 'p3', amountMinor: null })], TODAY)
    expect(s.totalEffectMinor).toBe(-4500 + 10000)
    expect(s.counts).toEqual({ ok: 2, issues: 1, duplicates: 1, scheduleMatches: 0, alreadySaved: 0 })
  })

  it('reintentar una confirmación con los mismos ids no duplica nada; vincular liquida la ocurrencia', () => {
    const d = baseData({ schedules: [bill('2026-10-01', 65000, { id: 'rent', name: 'Renta', categoryId: 'housing' })] })
    const entry = { id: 'e1', kind: 'expense' as const, amountMinor: 65000, date: TODAY, accountId: 'main', categoryId: 'housing', source: 'ai_text' as const, scheduleId: 'rent', occurrenceDate: '2026-10-01' }
    const first = saveConfirmedEntries(d, [entry], ctx)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const again = saveConfirmedEntries(first.data, [entry], ctx)
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.data.transactions.length).toBe(1)
    expect(again.data.transactions[0]).toMatchObject({ scheduleId: 'rent', occurrenceDate: '2026-10-01' })
    // La ocurrencia ya no está abierta: una nueva propuesta igual no la vuelve a proponer.
    expect(reviewProposal(again.data, proposal({ id: 'p9', amountMinor: 65000, categoryId: 'housing' }), TODAY).scheduleMatch).toBeUndefined()
    // Y un registro manual con el mismo id tampoco crea otro.
    const manual = saveTransaction(again.data, { id: 'e1', kind: 'expense', status: 'realized', amountMinor: 65000, date: TODAY, accountId: 'main', categoryId: 'housing' }, ctx)
    expect(manual.ok && manual.data.transactions.length).toBe(1)
  })
})
