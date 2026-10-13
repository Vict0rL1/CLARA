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

/* ------------------------------------------------------------------ */
/* FIN-01                                                              */
/* ------------------------------------------------------------------ */
import { accountBalance as balanceOf, netPosition } from './balances'
import { computeBudget } from './budget'
import { saveTransaction } from './operations'
import { linkSettlement, unlinkedSettlements } from './reconcileSchedules'
import { recategorizeTransactions } from './bulk'
import { validateAppData } from '../storage/backup'
import type { AppData } from './types'

/** Demo con un pago de la luz (42,80) anotado el día del saldo de referencia. */
function withSameDayPayment(alreadyInBalance: boolean) {
  const { data, today, ctx } = demo()
  const main = data.accounts[0]!
  const r = saveTransaction(data, { id: 'tx_luz', kind: 'expense', status: 'realized', amountMinor: 4280, date: main.anchor.date, accountId: main.id, categoryId: 'utilities', note: 'luz en ventanilla', alreadyInBalance }, ctx)
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return { data: r.data, today, ctx, main }
}
const accountBalance = (data: AppData, id: string) => balanceOf(data, data.accounts.find((a) => a.id === id)!).balanceMinor
const reload = (data: AppData): AppData => {
  const r = validateAppData(JSON.parse(JSON.stringify(data)))
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.data
}

describe('FIN-01 · vincular un pago ya registrado nunca cambia el saldo real', () => {
  for (const included of [true, false]) {
    it(`pago del día del saldo ${included ? 'ya incluido' : 'posterior al saldo'}: saldo y patrimonio iguales; el disponible solo libera la reserva`, () => {
      const { data, today, ctx, main } = withSameDayPayment(included)
      const proposals = unlinkedSettlements(data, today)
      const match = proposals.find((p) => p.transaction.id === 'tx_luz')!
      expect(match).toBeDefined()
      const before = { balance: accountBalance(data, main.id), net: netPosition(data).netMinor, available: computeBudget(data, today).availableMinor }
      const linked = linkSettlement(data, 'tx_luz', match.item.sourceId, match.item.date, ctx)
      expect(linked.ok).toBe(true)
      if (!linked.ok) return
      const tx = linked.data.transactions.find((t) => t.id === 'tx_luz')!
      expect(tx.realizedAt).toBe(data.transactions.find((t) => t.id === 'tx_luz')!.realizedAt)
      expect(accountBalance(linked.data, main.id)).toBe(before.balance)
      expect(netPosition(linked.data).netMinor).toBe(before.net)
      // La ocurrencia ya no se reserva: lo disponible sube exactamente lo reservado.
      expect(computeBudget(linked.data, today).availableMinor).toBe(before.available + 4280)
      // Idempotente y estable tras recargar (serializar + validar).
      const again = linkSettlement(linked.data, 'tx_luz', match.item.sourceId, match.item.date, ctx)
      expect(again.ok && again.unchanged).toBe(true)
      const reloaded = reload(linked.data)
      expect(accountBalance(reloaded, main.id)).toBe(before.balance)
      expect(computeBudget(reloaded, today).availableMinor).toBe(before.available + 4280)
    })
  }

  it('recategorizar en lote un pago ya incluido tampoco lo vuelve a restar', () => {
    const { data, ctx, main } = withSameDayPayment(true)
    const before = accountBalance(data, main.id)
    const r = recategorizeTransactions(data, ['tx_luz'], 'other_expense', ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(accountBalance(r.data, main.id)).toBe(before)
  })

  it('el formulario sigue pudiendo decidir: «no incluido» explícito sí lo aplica', () => {
    const { data, ctx, main } = withSameDayPayment(true)
    const before = accountBalance(data, main.id)
    const tx = data.transactions.find((t) => t.id === 'tx_luz')!
    const r = saveTransaction(data, { id: tx.id, kind: tx.kind, status: 'realized', amountMinor: tx.amountMinor, date: tx.date, accountId: tx.accountId, categoryId: tx.categoryId, alreadyInBalance: false }, ctx)
    expect(r.ok && accountBalance(r.data, main.id)).toBe(before - 4280)
  })
})
