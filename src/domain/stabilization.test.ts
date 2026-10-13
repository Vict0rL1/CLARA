/**
 * Regresiones de la auditoría posterior (2026-10-12/13) sobre `e7c9d87`: cada bloque reproduce el
 * fallo descrito con datos sintéticos y fija el contrato. Ids: AS-01, FIN-01, FIN-02/03, REC-01,
 * REC-02 y los de la fase 2.
 */
import { describe, expect, it } from 'vitest'
import { saveConfirmedEntries } from './assistant'
import { parseText } from './parser'
import { reviewProposal, reviewProposals, type Proposal } from './review'
import { explainRuleMatch } from './rules'
import type { CategoryRule } from './types'
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

/* ------------------------------------------------------------------ */
/* FIN-02/03                                                           */
/* ------------------------------------------------------------------ */
import { closeDuePlans, planBaseMinor, savePlan } from './plans'
import { MAX_AMOUNT_MINOR } from './money'
import { baseData, tx as fixtureTx } from '../test/fixtures'
import type { Plan } from './types'

const carriedPlan = (over: Partial<Plan> = {}): Plan => ({
  id: 'p1', kind: 'limit', name: 'Comida', categoryIds: ['dining'], amountMinor: 35000, currency: 'CAD', periodType: 'month',
  startDate: '2026-09-01', endDate: '2026-09-30', recurring: true, status: 'active', alertAt80: true, alertAt100: true,
  rollover: 'carry', carriedMinor: 5000, createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z', ...over,
})
const draftOf = (p: Plan, amountMinor: number, rollover = p.rollover) => ({ id: p.id, name: p.name, categoryIds: p.categoryIds, amountMinor, periodType: p.periodType, recurring: p.recurring, alertAt80: p.alertAt80, alertAt100: p.alertAt100, rollover })
const editCtx = { today: '2026-09-15', now: '2026-09-15T12:00:00.000Z' }
const valid = (data: AppData) => {
  const r = validateAppData(JSON.parse(JSON.stringify(data)))
  return r.ok ? true : r.issues
}
/** Cierra `cycles` meses seguidos (1-oct, 1-nov…) y devuelve los límites renovados. */
function renewMany(data: AppData, cycles: number): { data: AppData; plans: Plan[] } {
  let d = data
  const out: Plan[] = []
  for (let i = 1; i <= cycles; i++) {
    const today = `2026-${String(9 + i).padStart(2, '0')}-02`
    const r = closeDuePlans(d, { today, now: `${today}T12:00:00.000Z` })
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    d = r.data
    out.push(...r.value.renewed)
  }
  return { data: d, plans: out }
}

describe('FIN-02/03 · el arrastre nunca produce límites inválidos', () => {
  it('editar por debajo de lo arrastrado quita el arrastre y el importe pasa a ser la base; varias renovaciones siguen siendo válidas', () => {
    const d = baseData({ plans: [carriedPlan()] })
    const r = savePlan(d, draftOf(carriedPlan(), 3000), editCtx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.amountMinor).toBe(3000)
    expect(r.value.carriedMinor).toBeUndefined()
    expect(planBaseMinor(r.value)).toBe(3000)
    expect(valid(r.data)).toBe(true)
    // Sin rollover: la base vuelve cada ciclo; con arrastre suma lo no gastado. Siempre ≥ 0 y válido.
    for (const rollover of ['none', 'carry'] as const) {
      const start = savePlan(d, draftOf(carriedPlan(), 3000, rollover), editCtx)
      if (!start.ok) throw new Error('edit')
      const { data, plans } = renewMany(start.data, 3)
      expect(plans).toHaveLength(3)
      for (const p of plans) {
        expect(p.amountMinor).toBeGreaterThanOrEqual(0)
        expect(planBaseMinor(p)).toBe(3000)
      }
      expect(rollover === 'carry' ? plans.map((p) => p.amountMinor) : plans.map((p) => p.amountMinor)).toEqual(rollover === 'carry' ? [6000, 9000, 12000] : [3000, 3000, 3000])
      expect(valid(data)).toBe(true)
    }
  })

  it('editar por encima de lo arrastrado conserva el arrastre; con arrastre negativo también', () => {
    const keep = savePlan(baseData({ plans: [carriedPlan()] }), draftOf(carriedPlan(), 6000), editCtx)
    expect(keep.ok && keep.value).toMatchObject({ amountMinor: 6000, carriedMinor: 5000 })
    const negative = carriedPlan({ amountMinor: 0, carriedMinor: -30000 })
    const r = savePlan(baseData({ plans: [negative] }), draftOf(negative, 5000), editCtx)
    expect(r.ok && r.value).toMatchObject({ amountMinor: 5000, carriedMinor: -30000 })
    expect(r.ok && planBaseMinor(r.value)).toBe(35000)
  })

  it('un límite base por encima del máximo se rechaza al editar', () => {
    const p = carriedPlan({ amountMinor: 0, carriedMinor: -100 })
    const r = savePlan(baseData({ plans: [p] }), draftOf(p, MAX_AMOUNT_MINOR), editCtx)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.issues.map((i) => i.code)).toContain('amountTooLarge')
  })

  it('renovar un límite máximo con arrastre no pasa del máximo y el resultado valida en todos los ciclos', () => {
    const p = carriedPlan({ amountMinor: MAX_AMOUNT_MINOR - 10, carriedMinor: undefined })
    const { data, plans } = renewMany(baseData({ plans: [p] }), 3)
    for (const q of plans) {
      expect(q.amountMinor).toBeLessThanOrEqual(MAX_AMOUNT_MINOR)
      expect(Math.abs(q.carriedMinor ?? 0)).toBeLessThanOrEqual(MAX_AMOUNT_MINOR)
    }
    expect(plans[0]).toMatchObject({ amountMinor: MAX_AMOUNT_MINOR, carriedMinor: 10 })
    expect(valid(data)).toBe(true)
  })

  it('datos guardados con una base negativa (antes del arreglo) se renuevan con una base válida', () => {
    for (const rollover of ['none', 'carry'] as const) {
      const legacy = carriedPlan({ amountMinor: 3000, carriedMinor: 5000, rollover })
      const spent = baseData({ plans: [legacy], transactions: [fixtureTx({ id: 't1', kind: 'expense', categoryId: 'dining', amountMinor: 1000, date: '2026-09-10' })] })
      const { data, plans } = renewMany(spent, 2)
      for (const q of plans) expect(q.amountMinor).toBeGreaterThanOrEqual(0)
      expect(valid(data)).toBe(true)
    }
  })
})

/* ------------------------------------------------------------------ */
/* REC-02                                                              */
/* ------------------------------------------------------------------ */
import { backupText, parseBackup } from '../storage/backup'
import { recordVerification } from './backupReminder'

describe('REC-02 · los metadatos de una copia se validan antes de darla por buena', () => {
  const file = (patch: Record<string, unknown>) => {
    const { data } = demo()
    const parsed = JSON.parse(backupText(data, NOW, '1.0.0-test'))
    return JSON.stringify({ ...parsed, ...patch })
  }

  it('una fecha de exportación que no es fecha es un error del archivo, no un éxito', () => {
    const r = parseBackup(file({ exportedAt: 'not-a-date' }))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.issues[0]).toMatchObject({ path: 'exportedAt', code: 'invalidExportDate', params: { found: 'not-a-date' } })
    for (const bad of [12345, true, {}, '2026-13-45T99:00:00Z']) expect(parseBackup(file({ exportedAt: bad })).ok, String(bad)).toBe(false)
  })

  it('las formas antiguas siguen valiendo: sin fecha, con `null` o con una fecha ISO válida', () => {
    for (const ok of [{ exportedAt: undefined }, { exportedAt: null }, { exportedAt: '2026-09-28T16:00:00.000Z' }]) {
      const r = parseBackup(file(ok))
      expect(r.ok, JSON.stringify(ok)).toBe(true)
    }
    expect(parseBackup(file({ exportedAt: null })).ok && (parseBackup(file({ exportedAt: null })) as { exportedAt: string | null }).exportedAt).toBeNull()
  })

  it('verificar nunca guarda una fecha inválida (y lo guardado sigue cargando)', () => {
    const { data, ctx } = demo()
    const bad = recordVerification(data, { budgetId: data.budgetId, exportedAt: 'not-a-date' }, ctx)
    expect(bad.ok).toBe(false)
    const good = recordVerification(data, { budgetId: data.budgetId, exportedAt: '2026-09-28T16:00:00.000Z' }, ctx)
    expect(good.ok).toBe(true)
    if (!good.ok) return
    expect(validateAppData(JSON.parse(JSON.stringify(good.data))).ok).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* 6 · Historial tras recargar                                         */
/* ------------------------------------------------------------------ */
import { canRevert, recordHistory, revertEntry, sameValue } from './history'
import { saveAccount, saveGoal, saveSchedule } from './operations'

describe('6 · revertir tras recargar: el orden de las claves no es un cambio', () => {
  /** Como `AppStore.commit` + recargar: historial registrado y datos reconstruidos por la validación. */
  const commitAndReload = (prev: AppData, next: AppData) => reload(recordHistory(prev, next, '2026-09-28T16:00:00.000Z'))

  it('sameValue ignora el orden de las claves y las claves `undefined`, y distingue cambios reales', () => {
    expect(sameValue({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true)
    expect(sameValue({ a: 1, x: undefined }, { a: 1 })).toBe(true)
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false)
    expect(sameValue([1, 2], [2, 1])).toBe(false)
    expect(sameValue({ a: null }, { a: undefined })).toBe(false)
  })

  it('un gasto recién guardado se puede revertir después de recargar y el saldo vuelve al de antes', () => {
    const { data, ctx } = demo()
    const main = data.accounts[0]!
    // Como el formulario: con origen y comercio (sus claves se guardan antes que `realizedAt`).
    const saved = saveTransaction(data, { id: 'tx_nuevo', kind: 'expense', status: 'realized', amountMinor: 1234, date: ctx.today, accountId: main.id, categoryId: 'dining', note: 'cena', merchant: 'Bistró', source: 'manual' }, ctx)
    if (!saved.ok) throw new Error('save')
    const reloaded = commitAndReload(data, saved.data)
    const entry = reloaded.history[reloaded.history.length - 1]!
    // La recarga sí reordena las claves: sin la comparación estructural esto era «conflicto».
    const stored = reloaded.transactions.find((t) => t.id === 'tx_nuevo')!
    expect(JSON.stringify(stored)).not.toBe(JSON.stringify(entry.changes[0]!.after))
    expect(canRevert(reloaded, entry)).toBe('ok')
    const r = revertEntry(reloaded, entry.id, ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.transactions.some((t) => t.id === 'tx_nuevo')).toBe(false)
    expect(accountBalance(r.data, main.id)).toBe(accountBalance(data, main.id))
  })

  it('editar un gasto, una cuenta, una meta y un programado: revertibles tras recargar; un cambio real posterior sigue bloqueando', () => {
    const { data, ctx } = demo()
    const tx = data.transactions.find((t) => t.status === 'realized' && t.kind === 'expense')!
    const edits: [string, (d: AppData) => AppData][] = [
      ['movimiento', (d) => { const r = saveTransaction(d, { ...tx, amountMinor: tx.amountMinor + 100, source: 'manual' }, ctx); if (!r.ok) throw new Error('tx'); return r.data }],
      ['cuenta', (d) => { const r = saveAccount(d, { ...d.accounts[0]!, name: 'Cuenta renombrada' }, ctx); if (!r.ok) throw new Error('acc ' + JSON.stringify(r.issues)); return r.data }],
      ['meta', (d) => { const g = d.goals[0]!; const r = saveGoal(d, { ...g, name: 'Meta renombrada' }, ctx); if (!r.ok) throw new Error('goal ' + JSON.stringify(r.issues)); return r.data }],
      ['programado', (d) => { const s = d.schedules[0]!; const r = saveSchedule(d, { ...s, name: 'Programado renombrado' }, ctx); if (!r.ok) throw new Error('sched ' + JSON.stringify(r.issues)); return r.data }],
    ]
    for (const [label, edit] of edits) {
      const reloaded = commitAndReload(data, edit(data))
      const entry = reloaded.history[reloaded.history.length - 1]!
      expect(canRevert(reloaded, entry), label).toBe('ok')
    }
    // Conflicto real: el mismo movimiento cambia otra vez después → no se revierte el primero.
    const first = commitAndReload(data, edits[0]![1](data))
    const entry = first.history[first.history.length - 1]!
    const again = saveTransaction(first, { ...first.transactions.find((t) => t.id === tx.id)!, amountMinor: tx.amountMinor + 999 }, ctx)
    if (!again.ok) throw new Error('again')
    const second = commitAndReload(first, again.data)
    expect(canRevert(second, entry)).toBe('conflict')
  })
})

describe('7 · reglas y revisión del asistente: una sola regla y efectos exactos', () => {
  const rule = (id: string, pattern: string, categoryId: string, createdAt: string): CategoryRule => ({ id, pattern, kind: 'expense', categoryId, createdAt, updatedAt: createdAt })
  const cats = [
    { id: 'transport', kind: 'expense' as const },
    { id: 'dining', kind: 'expense' as const },
    { id: 'groceries', kind: 'expense' as const },
    { id: 'salary', kind: 'income' as const },
  ]
  const ctxWith = (rules: CategoryRule[]) => ({ today: '2026-09-28', currency: 'CAD', language: 'es' as const, categories: cats, rules })

  it('«uber» y después «uber eats»: el asistente y la explicación eligen comida (el patrón más largo)', () => {
    const rules = [rule('r1', 'uber', 'transport', '2026-01-01T00:00:00.000Z'), rule('r2', 'uber eats', 'dining', '2026-02-01T00:00:00.000Z')]
    const [eats] = parseText('uber eats 25', ctxWith(rules))
    expect(eats).toMatchObject({ categoryId: 'dining', amountMinor: 2500 })
    expect(eats!.hints).toContain('categoryRule')
    expect(explainRuleMatch('uber eats', 'expense', rules)?.rule.id).toBe('r2')
    const [ride] = parseText('uber 12', ctxWith(rules))
    expect(ride!.categoryId).toBe('transport')
    // El orden de la lista no cambia nada.
    expect(parseText('uber eats 25', ctxWith([...rules].reverse()))[0]!.categoryId).toBe('dining')
  })

  it('a igual longitud gana la más antigua en los dos sitios, aunque la lista venga en otro orden', () => {
    const rules = [rule('new', 'market', 'groceries', '2026-05-01T00:00:00.000Z'), rule('old', 'market', 'dining', '2026-01-01T00:00:00.000Z')]
    expect(parseText('market 30', ctxWith(rules))[0]!.categoryId).toBe('dining')
    expect(explainRuleMatch('market', 'expense', rules)).toMatchObject({ rule: { id: 'old' }, reason: 'oldest' })
    // Un patrón por debajo del mínimo nunca coincide (antes, «» o «a» coincidía con todo en el asistente).
    expect(parseText('pan 3', ctxWith([rule('short', 'p', 'transport', '2026-01-01T00:00:00.000Z')]))[0]!.hints).not.toContain('categoryRule')
  })

  it('cero, negativo y con decimales en unidades menores: la revisión los marca inválidos, igual que al guardar', () => {
    const { data, ctx } = demo()
    const accountId = data.accounts[0]!.id
    for (const amountMinor of [0, -500, 12.5]) {
      const r = reviewProposal(data, { id: `p${amountMinor}`, source: 'ai_text', kind: 'expense', amountMinor, date: ctx.today, accountId, categoryId: 'dining' }, ctx.today)
      expect(r.ok, String(amountMinor)).toBe(false)
      expect(r.effectMinor, String(amountMinor)).toBe(0)
      const reviewCodes = r.issues.filter((i) => i.path === 'amountMinor').map((i) => i.code)
      const saved = saveTransaction(data, { id: 'x', kind: 'expense', status: 'realized', amountMinor, date: ctx.today, accountId, categoryId: 'dining' }, ctx)
      expect(saved.ok, String(amountMinor)).toBe(false)
      if (saved.ok) continue
      expect(reviewCodes, String(amountMinor)).toEqual(saved.issues.filter((i) => i.path === 'amountMinor').map((i) => i.code))
    }
  })

  it('un pago vinculado a un recibo ya reservado baja el saldo pero no lo disponible; sin vincular, sí', () => {
    const { data, ctx } = demo()
    const accountId = data.accounts[0]!.id
    const before = computeBudget(data, ctx.today).availableMinor
    const pay = (linkToSchedule: boolean): Proposal => ({ id: 'luz', source: 'ai_text', kind: 'expense', amountMinor: 4280, date: ctx.today, accountId, categoryId: 'utilities', linkToSchedule })
    const linked = reviewProposals(data, [pay(true)], ctx.today, { now: ctx.now })
    expect(linked.reviews[0]!.scheduleMatch?.date).toBe('2026-09-27')
    expect(linked.reviews[0]).toMatchObject({ ok: true, effectMinor: -4280, availableEffectMinor: 0 })
    expect(linked.available).toEqual({ beforeMinor: before, afterMinor: before })
    // Lo simulado es lo que pasa al guardar de verdad.
    const saved = saveConfirmedEntries(data, [{ id: 'luz', kind: 'expense', amountMinor: 4280, date: ctx.today, accountId, categoryId: 'utilities', source: 'ai_text', scheduleId: linked.reviews[0]!.scheduleMatch!.sourceId, occurrenceDate: '2026-09-27' }], ctx)
    expect(saved.ok && computeBudget(saved.data, ctx.today).availableMinor).toBe(before)
    const unlinked = reviewProposals(data, [pay(false)], ctx.today, { now: ctx.now })
    expect(unlinked.reviews[0]!.availableEffectMinor).toBeUndefined()
    expect(unlinked.available).toEqual({ beforeMinor: before, afterMinor: before - 4280 })
  })

  it('un ingreso con fecha futura no cambia el saldo de hoy ni sube lo disponible', () => {
    const { data, ctx } = demo()
    const accountId = data.accounts[0]!.id
    const before = computeBudget(data, ctx.today).availableMinor
    const s = reviewProposals(data, [{ id: 'bonus', source: 'ai_text', kind: 'income', amountMinor: 50000, date: '2026-10-05', accountId, categoryId: 'salary' }], ctx.today, { now: ctx.now })
    expect(s.reviews[0]).toMatchObject({ ok: true, planned: true, effectMinor: 0 })
    expect(s.totalEffectMinor).toBe(0)
    expect(s.available!.afterMinor).toBeLessThanOrEqual(before)
    expect(s.available!.afterMinor).toBe(before)
  })
})

/* ------------------------------------------------------------------ */
import { analysisItems, type Because } from './analysis'
import { account as fixtureAccount, bill as fixtureBill, income as fixtureIncome, TODAY as FIX_TODAY } from '../test/fixtures'
import { signedScale } from '../ui/chartScale'

/** La ecuación de «¿Cómo se calculó?» cuadra con sus operandos: a ± b ± … = resultado. */
function equationHolds(because: Because[]): boolean {
  const eq = because.findIndex((b) => b.op === '=')
  if (eq < 0) return true
  let acc = 0
  because.slice(0, eq).forEach((b, i) => {
    const v = b.value as number
    acc = i === 0 || b.op === '+' ? acc + v : acc - v
  })
  return acc === because[eq]!.value
}

describe('8 · análisis y estadísticas: explicaciones que cuadran y gráficos con signo', () => {
  const withBalance = (amountMinor: number, extra: Partial<AppData> = {}) =>
    baseData({ accounts: [fixtureAccount({ id: 'main', anchor: { amountMinor, date: FIX_TODAY, setAt: '2026-09-28T13:00:00.000Z' } })], ...extra })

  it('un ingreso y un pago el mismo día se muestran en bruto (+100 y −150), no neteados (0 y −50)', () => {
    const data = withBalance(3000, { schedules: [fixtureIncome('2026-10-02', 10000, { id: 'in' }), fixtureBill('2026-10-02', 15000, { id: 'out' })] })
    const shortfall = analysisItems(data, FIX_TODAY).find((i) => i.id === 'shortfall')!
    expect(shortfall.params).toMatchObject({ date: '2026-10-02', amount: -2000 })
    const v = Object.fromEntries(shortfall.because.map((b) => [b.id, b.value]))
    expect(v).toEqual({ startBalance: 3000, inflowsUntil: 10000, outflowsUntil: 15000, balanceOn: -2000 })
    expect(equationHolds(shortfall.because)).toBe(true)
  })

  it('si el saldo de hoy ya es negativo, el aviso dice ese saldo negativo aunque hoy entre un ingreso', () => {
    const data = withBalance(-5000, { schedules: [fixtureIncome(FIX_TODAY, 10000, { id: 'in' })] })
    const shortfall = analysisItems(data, FIX_TODAY).find((i) => i.id === 'shortfall')!
    expect(shortfall.params).toMatchObject({ date: FIX_TODAY, amount: -5000 })
    expect(shortfall.because).toEqual([{ id: 'startBalance', kind: 'money', value: -5000, op: '=' }])
  })

  it('límite superado: límite − gastado = restante (negativo), con los operandos en ese orden', () => {
    const plan = carriedPlan({ amountMinor: 10000, rollover: undefined, carriedMinor: undefined })
    const data = withBalance(100000, { plans: [plan], transactions: [fixtureTx({ id: 't1', amountMinor: 12000, categoryId: 'dining', date: FIX_TODAY })] })
    const over = analysisItems(data, FIX_TODAY).find((i) => i.id === 'limitOver')!
    expect(over.because.map((b) => [b.id, b.value, b.op ?? ''])).toEqual([
      ['limit', 10000, ''],
      ['spent', 12000, '−'],
      ['remaining', -2000, '='],
    ])
    expect(equationHolds(over.because)).toBe(true)
    expect(over.params.remaining).toBe(2000)
  })

  it('conciliar: el pago del mismo día de una ocurrencia es para esa ocurrencia, aunque otra anterior también esté en la ventana', () => {
    const data = withBalance(100000, {
      schedules: [fixtureBill('2026-09-26', 4000, { id: 'early', name: 'Gimnasio' }), fixtureBill(FIX_TODAY, 4000, { id: 'exact', name: 'Internet' })],
      transactions: [fixtureTx({ id: 'pay', amountMinor: 4000, categoryId: 'utilities', date: FIX_TODAY })],
    })
    const s = unlinkedSettlements(data, FIX_TODAY)
    expect(s.map((x) => [x.item.sourceId, x.transaction.id, x.distanceDays])).toEqual([['exact', 'pay', 0]])
    // Con dos pagos, cada uno va a su ocurrencia (la del 26 recibe el suyo del 26).
    const two = { ...data, transactions: [...data.transactions, fixtureTx({ id: 'pay26', amountMinor: 4000, categoryId: 'utilities', date: '2026-09-26' })] }
    expect(unlinkedSettlements(two, FIX_TODAY).map((x) => [x.item.sourceId, x.transaction.id])).toEqual([
      ['early', 'pay26'],
      ['exact', 'pay'],
    ])
  })

  it('escala con signo: alturas nunca negativas, el cero dentro del eje y la barra negativa baja del cero', () => {
    const { y, bar } = signedScale([123810, -75682], 12, 130)
    expect(y(0)).toBeGreaterThan(12)
    expect(y(0)).toBeLessThan(130)
    const income = bar(123810)
    const refund = bar(-75682)
    expect(income.height).toBeGreaterThan(0)
    expect(refund.height).toBeGreaterThan(0)
    expect(refund.y).toBeCloseTo(y(0))
    expect(refund.y + refund.height).toBeCloseTo(130)
    expect(income.height / refund.height).toBeCloseTo(123810 / 75682)
    // Sin negativos, el cero es la base del eje (igual que antes).
    expect(signedScale([500, 0], 12, 130).y(0)).toBe(130)
  })
})

/* ------------------------------------------------------------------ */
import { CALENDAR_PROJECTION_MAX_DAYS, dayBalance, projectBalance } from './projection'
import { addDays } from './dates'

describe('9 · calendario: más allá de la proyección no hay cifra', () => {
  it('dentro del límite da el cierre del día; después, «fuera de la proyección» con la última fecha calculada', () => {
    const data = baseData({ schedules: [fixtureBill(addDays(FIX_TODAY, 430), 99900, { id: 'late' })] })
    const p = projectBalance(data, FIX_TODAY, { days: CALENDAR_PROJECTION_MAX_DAYS })
    const last = addDays(FIX_TODAY, CALENDAR_PROJECTION_MAX_DAYS - 1)
    expect(dayBalance(p, last)).toEqual({ state: 'projected', endMinor: p.endMinor })
    // El día 431 tiene un pago grande: no se puede presentar el saldo del día 400 como si fuera el suyo.
    expect(dayBalance(p, addDays(FIX_TODAY, 430))).toEqual({ state: 'beyond', lastDate: last })
    expect(dayBalance(p, addDays(FIX_TODAY, -1))).toEqual({ state: 'past' })
    expect(dayBalance(p, FIX_TODAY)).toMatchObject({ state: 'projected' })
  })
})

/* ------------------------------------------------------------------ */
import { defaultSelection, isImportable, MAX_IMPORT_ROWS, previewImport, type ImportOptions, type ImportPreview } from './bankImport'
import { deleteTransaction, importTransactions } from './operations'

describe('10 · CSV: identidad completa de cada fila, revisión de posibles duplicados y filas que quedan fuera', () => {
  const P = 'COMPRA TARJETA 4521 SUPERMERCADO EL AHORRO SUCURSAL CENTRO AVENIDA PRINCIPAL 1234 C'
  const A = `${P} REF 0001 CAJA 3`
  const B = `${P} REF 0002 CAJA 7`
  const opts = (over: Partial<ImportOptions> = {}): ImportOptions => ({ accountId: 'main', mapping: { date: 0, description: 1, amount: 2 }, hasHeader: false, dateFormat: 'ymd', invertSign: false, locale: 'en-CA', today: FIX_TODAY, ...over })
  let importSeq = 0
  /** Importa lo que la vista previa marca por defecto (como la pantalla), con ids nuevos. */
  function importDefault(d: AppData, table: string[][], o = opts()): { preview: ImportPreview; data: AppData } {
    const preview = previewImport(table, d, o)
    const chosen = defaultSelection(preview)
    const items = preview.rows
      .filter((r) => chosen.has(r.line) && isImportable(r))
      .map((r) => ({ id: `imp-${++importSeq}`, kind: r.kind!, amountMinor: r.amountMinor!, date: r.date!, accountId: 'main', categoryId: r.kind === 'income' ? 'other_income' : 'other_expense', note: r.description, importRef: r.importRef! }))
    if (items.length === 0) return { preview, data: d }
    const res = importTransactions(d, { items, sameDayAlreadyInBalance: false }, ctx())
    if (!res.ok) throw new Error(JSON.stringify(res.issues))
    return { preview, data: res.data }
  }
  const ctx = () => ({ today: FIX_TODAY, now: '2026-09-28T16:00:00.000Z' })
  const statuses = (p: ImportPreview) => p.rows.map((r) => r.status)

  it('dos filas distintas que comparten los 80 primeros caracteres ya no chocan: la segunda es «posible duplicado», nunca se omite en silencio', () => {
    expect(A.slice(0, 80)).toBe(B.slice(0, 80))
    const first = importDefault(baseData(), [['2026-09-20', A, '-45.10']])
    expect(first.data.transactions).toHaveLength(1)
    const second = previewImport([['2026-09-20', B, '-45.10']], first.data, opts())
    expect(statuses(second)).toEqual(['possibleDuplicate'])
    expect(second.rows[0]!.matchId).toBe(first.data.transactions[0]!.id)
    // Con las dos en el extracto siguiente: A es duplicado exacto (ya cuenta para lo importado) y B,
    // que no tiene contrapartida, es nueva y se ofrece marcada. Antes B era «duplicado» y se omitía.
    const both = previewImport([['2026-09-20', A, '-45.10'], ['2026-09-20', B, '-45.10']], first.data, opts())
    expect(statuses(both)).toEqual(['duplicate', 'new'])
    expect([...defaultSelection(both)]).toEqual([2])
  })

  it('repetir, reordenar o solapar un extracto no crea nada dos veces; dos compras idénticas del mismo día cuentan como dos', () => {
    const file = [
      ['2026-09-20', 'CAFE CENTRAL', '-4.50'],
      ['2026-09-20', 'CAFE CENTRAL', '-4.50'],
      ['2026-09-21', A, '-45.10'],
      ['2026-09-21', B, '-45.10'],
      ['2026-09-22', 'NOMINA', '1200.00'],
    ]
    const first = importDefault(baseData(), file)
    expect(first.data.transactions).toHaveLength(5)
    expect(statuses(previewImport(file, first.data, opts()))).toEqual(['duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate'])
    expect(statuses(previewImport([...file].reverse(), first.data, opts()))).toEqual(['duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate'])
    // Extracto que se solapa: las 3 últimas filas + una nueva.
    const overlap = previewImport([...file.slice(2), ['2026-09-23', 'FARMACIA', '-12.00']], first.data, opts())
    expect(statuses(overlap)).toEqual(['duplicate', 'duplicate', 'duplicate', 'new'])
  })

  it('las huellas antiguas (80 caracteres) se siguen reconociendo: misma nota → duplicado; nota editada → posible duplicado; en la papelera → papelera', () => {
    const legacy = (id: string, note: string, n = 1) => fixtureTx({ id, kind: 'expense', amountMinor: 4510, date: '2026-09-20', categoryId: 'other_expense', note, importRef: `main|2026-09-20|-4510|${note.toLowerCase().slice(0, 80)}|${n}` })
    const d = baseData({ transactions: [legacy('old-a', A)] })
    expect(statuses(previewImport([['2026-09-20', A, '-45.10']], d, opts()))).toEqual(['duplicate'])
    expect(statuses(previewImport([['2026-09-20', B, '-45.10']], d, opts()))).toEqual(['possibleDuplicate'])
    const edited = baseData({ transactions: [{ ...legacy('old-a', A), note: 'Súper' }] })
    expect(statuses(previewImport([['2026-09-20', A, '-45.10']], edited, opts()))).toEqual(['possibleDuplicate'])
    const trashed = deleteTransaction(d, 'old-a', ctx())
    expect(trashed.ok).toBe(true)
    if (!trashed.ok) return
    expect(statuses(previewImport([['2026-09-20', A, '-45.10']], trashed.data, opts()))).toEqual(['trashed'])
  })

  it('con referencia del banco: filas idénticas con referencias distintas son distintas, y reimportar con o sin la columna no duplica', () => {
    const withRef = opts({ mapping: { date: 0, description: 1, amount: 2, reference: 3 } })
    const file = [
      ['2026-09-20', 'CAFE CENTRAL', '-4.50', 'TX-1'],
      ['2026-09-20', 'CAFE CENTRAL', '-4.50', 'TX-2'],
    ]
    const first = importDefault(baseData(), file, withRef)
    expect(first.data.transactions.map((t) => t.importRef)).toEqual(['main|ref|TX-1|2026-09-20|-450|1', 'main|ref|TX-2|2026-09-20|-450|1'])
    // El extracto siguiente trae solo TX-2 (en primer lugar): duplicado de TX-2, no de TX-1.
    const next = previewImport([['2026-09-20', 'CAFE CENTRAL', '-4.50', 'TX-2'], ['2026-09-20', 'CAFE CENTRAL', '-4.50', 'TX-3']], first.data, withRef)
    const tx2 = first.data.transactions.find((t) => t.importRef?.includes('|TX-2|'))!.id
    expect(next.rows.map((r) => [r.status, r.matchId])).toEqual([
      ['duplicate', tx2],
      ['new', undefined],
    ])
    // Sin la columna de referencia, el mismo archivo se reconoce por la nota: nada nuevo.
    expect(statuses(previewImport(file, first.data, opts()))).toEqual(['duplicate', 'duplicate'])
  })

  it('más de 5,000 filas: número exacto de filas fuera y sus líneas; ninguna de ellas aparece en la vista previa', () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 37 }, (_, i) => ['2026-09-20', `Fila ${i + 1}`, '-1.00'])
    const p = previewImport([['Fecha', 'Concepto', 'Importe'], ...rows], baseData(), opts({ hasHeader: true }))
    expect(p).toMatchObject({ tooManyRows: true, totalRows: MAX_IMPORT_ROWS + 37, omittedRows: 37, omittedLines: { from: MAX_IMPORT_ROWS + 2, to: MAX_IMPORT_ROWS + 38 } })
    expect(p.rows).toHaveLength(MAX_IMPORT_ROWS)
    expect(p.rows[p.rows.length - 1]!.description).toBe(`Fila ${MAX_IMPORT_ROWS}`)
    const small = previewImport(rows.slice(0, 3), baseData(), opts())
    expect(small).toMatchObject({ tooManyRows: false, totalRows: 3, omittedRows: 0 })
    expect(small.omittedLines).toBeUndefined()
  })
})
