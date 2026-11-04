/**
 * Libro mayor (Clara 2.0 §3, §28): secuencias aleatorias pero reproducibles de operaciones reales
 * (ingresos, gastos, devoluciones, transferencias —también el pago de una tarjeta—, previstos,
 * realizar, editar, eliminar, restaurar y apartados de metas). Tras CADA paso se comprueba el efecto
 * exacto esperado sobre el saldo total, el gasto y el ingreso del mes y el disponible, y que los datos
 * siguen siendo válidos. Una semilla que falla se puede repetir sola.
 */
import { describe, expect, it } from 'vitest'
import { allAccountBalances } from './balances'
import { computeBudget } from './budget'
import { periodSummary } from './insights'
import { allocateToGoal, deleteTransaction, realizePlanned, restoreFromTrash, saveTransaction, type TransactionDraft } from './operations'
import type { AppData, Transaction } from './types'
import { validateAppData } from '../storage/backup'
import { account, baseData, ctx, goal } from '../test/fixtures'

/** Generador determinista (mulberry32). */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ANCHOR = { date: '2026-09-01', setAt: '2026-09-01T12:00:00.000Z' }
const BUDGET = new Set(['main', 'cash'])

function start(): AppData {
  return baseData({
    accounts: [
      account({ id: 'main', name: 'Cheques', kind: 'bank', includeInBudget: true, anchor: { amountMinor: 500000, ...ANCHOR } }),
      account({ id: 'cash', name: 'Efectivo', kind: 'cash', includeInBudget: true, anchor: { amountMinor: 20000, ...ANCHOR } }),
      account({ id: 'savings', name: 'Ahorro', kind: 'savings', includeInBudget: false, anchor: { amountMinor: 100000, ...ANCHOR } }),
      account({ id: 'card', name: 'Tarjeta', kind: 'credit', includeInBudget: false, anchor: { amountMinor: -30000, ...ANCHOR } }),
    ],
    goals: [goal({ id: 'g1', name: 'Viaje', targetMinor: 10_000_000, fundedFrom: 'budget' })],
  })
}

interface Measure {
  total: number
  spending: number
  income: number
  available: number
}

function measure(d: AppData): Measure {
  const month = periodSummary(d, '2026-09-01', '2026-09-30')
  return {
    total: allAccountBalances(d).reduce((sum, b) => sum + b.balanceMinor, 0),
    spending: month.netSpendingMinor,
    income: month.incomeMinor,
    available: computeBudget(d, ctx.today).availableMinor,
  }
}

/** Efecto esperado de un movimiento REALIZADO (fechado después del saldo de referencia). */
function effect(tx: Pick<Transaction, 'kind' | 'amountMinor' | 'accountId' | 'toAccountId'>): Measure {
  const x = tx.amountMinor
  const inBudget = BUDGET.has(tx.accountId)
  switch (tx.kind) {
    case 'expense':
      return { total: -x, spending: x, income: 0, available: inBudget ? -x : 0 }
    case 'income':
      return { total: x, spending: 0, income: x, available: inBudget ? x : 0 }
    case 'refund':
      return { total: x, spending: -x, income: 0, available: inBudget ? x : 0 }
    case 'transfer': {
      const toBudget = BUDGET.has(tx.toAccountId!)
      return { total: 0, spending: 0, income: 0, available: (toBudget ? x : 0) - (inBudget ? x : 0) }
    }
    default:
      throw new Error(`sin modelo para ${tx.kind}`)
  }
}

const add = (m: Measure, e: Measure, sign = 1): Measure => ({
  total: m.total + sign * e.total,
  spending: m.spending + sign * e.spending,
  income: m.income + sign * e.income,
  available: m.available + sign * e.available,
})

type Step = { name: string; next: AppData; expect: Partial<Measure> }

function step(d: AppData, r: () => number, n: number): Step | null {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!
  const amount = 1 + Math.floor(r() * 50_000)
  const day = 2 + Math.floor(r() * 27)
  const date = `2026-09-${String(day).padStart(2, '0')}`
  const id = `tx_${n}`
  const accountIds = ['main', 'cash', 'savings', 'card']
  const before = measure(d)
  const realized = d.transactions.filter((t) => t.status === 'realized' && t.kind !== 'adjustment')
  const save = (draft: TransactionDraft) => saveTransaction(d, draft, ctx)
  switch (pick(['expense', 'income', 'refund', 'transfer', 'cardPayment', 'planned', 'realize', 'edit', 'delete', 'restore', 'allocate'] as const)) {
    case 'expense':
    case 'income':
    case 'refund': {
      const kind = pick(['expense', 'income', 'refund'] as const)
      const draft = { id, kind, status: 'realized' as const, amountMinor: amount, date, accountId: pick(accountIds), categoryId: kind === 'income' ? 'salary' : 'dining' }
      const r2 = save(draft)
      return r2.ok ? { name: `${kind} ${amount} ${draft.accountId}`, next: r2.data, expect: add(before, effect(draft)) } : null
    }
    case 'transfer': {
      const from = pick(accountIds)
      const to = pick(accountIds.filter((a) => a !== from))
      const draft = { id, kind: 'transfer' as const, status: 'realized' as const, amountMinor: amount, date, accountId: from, toAccountId: to }
      const r2 = save(draft)
      return r2.ok ? { name: `transfer ${amount} ${from}→${to}`, next: r2.data, expect: add(before, effect(draft)) } : null
    }
    case 'cardPayment': {
      // Pagar la tarjeta es una transferencia banco → tarjeta: nunca un gasto ni un ingreso.
      const draft = { id, kind: 'transfer' as const, status: 'realized' as const, amountMinor: amount, date, accountId: 'main', toAccountId: 'card' }
      const r2 = save(draft)
      return r2.ok ? { name: `cardPayment ${amount}`, next: r2.data, expect: { ...add(before, effect(draft)), spending: before.spending, income: before.income } } : null
    }
    case 'planned': {
      const r2 = save({ id, kind: 'expense', status: 'planned', amountMinor: amount, date: '2026-10-05', accountId: pick(accountIds), categoryId: 'dining' })
      // Un previsto nunca cambia saldos ni el gasto realizado.
      return r2.ok ? { name: `planned ${amount}`, next: r2.data, expect: { total: before.total, spending: before.spending, income: before.income } } : null
    }
    case 'realize': {
      const planned = d.transactions.filter((t) => t.status === 'planned')
      if (planned.length === 0) return null
      const p = pick(planned)
      const r2 = realizePlanned(d, p.id, { date: ctx.today }, ctx)
      if (!r2.ok) return null
      const e = effect(p)
      return { name: `realize ${p.id}`, next: r2.data, expect: { total: before.total + e.total, spending: before.spending + e.spending, income: before.income + e.income } }
    }
    case 'edit': {
      const editable = realized.filter((t) => t.kind !== 'transfer' || t.toAccountId)
      if (editable.length === 0) return null
      const old = pick(editable)
      const { createdAt: _c, updatedAt: _u, currency: _cur, realizedAt: _r, receiptUri: _rec, ...rest } = old
      const draft = { ...rest, amountMinor: amount }
      const r2 = save(draft)
      return r2.ok ? { name: `edit ${old.id} ${old.amountMinor}→${amount}`, next: r2.data, expect: add(add(before, effect(old), -1), effect(draft)) } : null
    }
    case 'delete': {
      const any = d.transactions.filter((t) => t.kind !== 'adjustment')
      if (any.length === 0) return null
      const t = pick(any)
      const r2 = deleteTransaction(d, t.id, ctx)
      if (!r2.ok) return null
      // Lo que va a la papelera deja de contar; un previsto nunca contó en saldos ni en el gasto.
      const expect = t.status === 'realized' ? add(before, effect(t), -1) : { total: before.total, spending: before.spending, income: before.income }
      return { name: `delete ${t.id}`, next: r2.data, expect }
    }
    case 'restore': {
      if (d.trash.length === 0) return null
      const entry = pick(d.trash)
      const r2 = restoreFromTrash(d, entry.id, ctx)
      if (!r2.ok) return null
      const t = r2.data.transactions.find((x) => x.id === entry.transaction.id)!
      const expect = t.status === 'realized' ? add(before, effect(t)) : { total: before.total, spending: before.spending, income: before.income }
      return { name: `restore ${t.id}`, next: r2.data, expect }
    }
    case 'allocate': {
      const r2 = allocateToGoal(d, { goalId: 'g1', amountMinor: Math.min(amount, 5_000) }, ctx)
      if (!r2.ok) return null
      // Apartar para una meta no es un gasto ni mueve dinero: solo baja el disponible.
      return { name: `allocate ${r2.value.amountMinor}`, next: r2.data, expect: { ...before, available: before.available - r2.value.amountMinor } }
    }
  }
}

describe('Libro mayor · propiedades sobre secuencias aleatorias de operaciones reales', () => {
  it('cada operación cambia saldos, gasto, ingreso y disponible exactamente lo esperado, y los datos siguen siendo válidos', () => {
    let steps = 0
    for (let seed = 1; seed <= 120; seed++) {
      const r = rng(seed)
      let d = start()
      for (let n = 0; n < 40; n++) {
        const s = step(d, r, n)
        if (!s) continue
        const got = measure(s.next)
        const label = `semilla ${seed}, paso ${n}: ${s.name}`
        for (const k of Object.keys(s.expect) as (keyof Measure)[]) expect(got[k], `${label} · ${k}`).toBe(s.expect[k])
        expect(validateAppData(JSON.parse(JSON.stringify(s.next))).ok, label).toBe(true)
        // Ningún id aparece a la vez en movimientos y en la papelera.
        const live = new Set(s.next.transactions.map((t) => t.id))
        expect(s.next.trash.some((e) => live.has(e.transaction.id)), label).toBe(false)
        d = s.next
        steps++
      }
    }
    expect(steps).toBeGreaterThan(3000)
  })

  it('las transferencias (y el pago de la tarjeta) nunca son ingresos ni gastos, en ningún orden', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(1000 + seed)
      let d = start()
      for (let n = 0; n < 25; n++) {
        const accountIds = ['main', 'cash', 'savings', 'card']
        const from = accountIds[Math.floor(r() * 4)]!
        const to = accountIds.filter((a) => a !== from)[Math.floor(r() * 3)]!
        const res = saveTransaction(d, { id: `t_${n}`, kind: 'transfer', status: 'realized', amountMinor: 1 + Math.floor(r() * 90_000), date: '2026-09-15', accountId: from, toAccountId: to }, ctx)
        if (!res.ok) continue
        d = res.data
      }
      const m = measure(d)
      expect(m.spending, `semilla ${seed}`).toBe(0)
      expect(m.income, `semilla ${seed}`).toBe(0)
      expect(m.total, `semilla ${seed}`).toBe(measure(start()).total)
    }
  })
})
