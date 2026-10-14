/**
 * Exportar e importar conserva TODO: relaciones, papelera, compras divididas,
 * distribuciones, bandeja, presupuestos por periodo, escenarios, preferencias…
 * y las copias de todas las versiones admitidas (v1–v7) se pueden restaurar.
 */
import { describe, expect, it } from 'vitest'
import { createDemoData } from '../demo/demoData'
import { createSyntheticData } from '../test/synthetic'
import { snoozeInboxItem, dismissInboxItem, inboxView } from '../domain/inbox'
import { applyDistribution } from '../domain/incomeDistribution'
import { deleteTransaction, saveTransaction, type OpContext } from '../domain/operations'
import { savePeriodBudget, setTransactionPeriods } from '../domain/periodBudgets'
import { saveScenario } from '../domain/scenarios'
import { SCHEMA_VERSION, type AppData } from '../domain/types'
import { createBackup, parseBackup, validateAppData } from './backup'

const NOW = new Date('2026-09-28T16:00:00.000Z')
const ctx: OpContext = { today: '2026-09-28', now: NOW.toISOString() }

function ok<T>(r: { ok: true; data: AppData; value: T } | { ok: false; issues: unknown[] }) {
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r
}

/** Datos con todas las entidades y relaciones que existen en v7. */
function richData(): AppData {
  let d = createDemoData({ now: NOW, timeZone: 'America/Toronto' })
  const main = d.accounts.find((a) => a.includeInBudget)!.id
  const savingsGoal = d.goals.find((g) => g.kind !== 'expense')!
  // Compra dividida + devolución repartida.
  d = ok(saveTransaction(d, { id: 'split', kind: 'expense', status: 'realized', amountMinor: 12000, date: '2026-09-27', accountId: main, categoryId: 'groceries', note: 'Walmart', splits: [{ id: 'l1', categoryId: 'groceries', amountMinor: 9000 }, { id: 'l2', categoryId: 'housing', amountMinor: 3000, note: 'Focos' }] }, ctx)).data
  d = ok(saveTransaction(d, { id: 'refund', kind: 'refund', status: 'realized', amountMinor: 1000, date: '2026-09-28', accountId: main, categoryId: 'housing', refundOfId: 'split', splits: [{ id: 'r1', categoryId: 'housing', amountMinor: 1000 }] }, ctx)).data
  // A la papelera (con vínculo a otra compra).
  d = ok(saveTransaction(d, { id: 'gone', kind: 'expense', status: 'realized', amountMinor: 500, date: '2026-09-26', accountId: main, categoryId: 'dining', note: 'Café' }, ctx)).data
  d = ok(deleteTransaction(d, 'gone', ctx)).data
  // Ingreso distribuido.
  d = ok(saveTransaction(d, { id: 'bonus', kind: 'income', status: 'realized', amountMinor: 30000, date: '2026-09-28', accountId: main, categoryId: 'other_income', note: 'Bono' }, ctx)).data
  d = ok(applyDistribution(d, { distributionId: 'dist', incomeTxId: 'bonus', lines: [{ kind: 'goal', goalId: savingsGoal.id, amountMinor: 10000 }] }, ctx)).data
  // Presupuesto por periodo con movimiento asociado, escenario, decisiones de la bandeja.
  d = ok(savePeriodBudget(d, { id: 'trip', name: 'Viaje', template: 'trip', startDate: '2026-09-01', endDate: '2026-10-31', allocatedMinor: 50000, ruleCategoryIds: ['groceries'] }, ctx)).data
  d = ok(setTransactionPeriods(d, 'split', ['trip'], ctx)).data
  d = ok(saveScenario(d, { id: 'sc', name: 'Laptop', changes: [{ type: 'purchase', amountMinor: 80000, date: '2026-10-15', note: 'Laptop' }] }, ctx)).data
  const items = inboxView(d, ctx.today).active
  d = ok(snoozeInboxItem(d, items[0]!.id, '2026-10-05', ctx)).data
  const dismissible = inboxView(d, ctx.today).active.find((i) => i.canDismiss)
  if (dismissible) d = ok(dismissInboxItem(d, dismissible, ctx)).data
  return d
}

describe('copia completa: exportar → importar', () => {
  it('conserva cada entidad y relación exactamente', () => {
    const d = richData()
    expect(validateAppData(JSON.parse(JSON.stringify(d))).ok).toBe(true)
    // Comprobaciones de que el caso realmente contiene lo que dice.
    expect(d.trash).toHaveLength(1)
    expect(d.transactions.find((t) => t.id === 'split')!.splits).toHaveLength(2)
    expect(d.incomeDistributions).toHaveLength(1)
    expect(d.periodBudgets[0]!.txIds).toEqual(['split'])
    expect(d.scenarios).toHaveLength(1)
    expect(d.inbox.snoozed.length + d.inbox.dismissed.length).toBeGreaterThan(0)
    expect(d.categoryRules.length).toBeGreaterThan(0)
    expect(d.favorites.length).toBeGreaterThan(0)

    const r = parseBackup(JSON.stringify(createBackup(d, NOW, '0.1.0')))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data).toEqual(d)
  })

  it('una copia con un solo error no se importa (todo o nada) y se dice dónde', () => {
    const file = createBackup(richData(), NOW, '0.1.0') as unknown as { data: AppData }
    file.data.transactions.find((t) => t.id === 'split')!.splits![1]!.amountMinor = 2999 // ya no suma el total
    const r = parseBackup(JSON.stringify(file))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.some((i) => i.code === 'splitMismatch')).toBe(true)
  })
})

describe('copias de versiones anteriores', () => {
  /** Quita lo que no existía en la versión `v` (mismo criterio que las migraciones). */
  function asVersion(d: AppData, v: number): Record<string, unknown> {
    const raw: Record<string, unknown> = JSON.parse(JSON.stringify(d))
    raw.schemaVersion = v
    const txs = raw.transactions as Record<string, unknown>[]
    if (v < 7) {
      delete raw.inbox
      delete raw.incomeDistributions
      for (const t of txs) delete t.splits
      for (const g of raw.goals as { allocations: Record<string, unknown>[] }[]) for (const a of g.allocations) delete a.distributionId
    }
    if (v < 6) {
      delete raw.periodBudgets
      delete raw.scenarios
      delete (raw.settings as Record<string, unknown>).weeklyReview
    }
    if (v < 5) for (const k of ['trash', 'purgedImportRefs', 'favorites', 'reconciliations', 'backup']) delete raw[k]
    if (v < 4) delete raw.categoryRules
    if (v < 2) {
      delete raw.categories
      delete raw.categoryLimits
    }
    return raw
  }
  const base = () => createDemoData({ now: NOW, timeZone: 'America/Toronto' })

  for (const v of [1, 2, 3, 4, 5, 6, 7]) {
    it(`v${v}: se restaura en v${SCHEMA_VERSION} sin perder cuentas, movimientos, pagos ni metas`, () => {
      const d = base()
      const raw = asVersion(d, v)
      const file = JSON.stringify({ format: 'margen-backup', formatVersion: 1, exportedAt: NOW.toISOString(), app: 'Margen', appVersion: '0.1.0', data: raw })
      const r = parseBackup(file)
      expect(r.ok, JSON.stringify(!r.ok && r.issues)).toBe(true)
      if (!r.ok) return
      expect(r.data.schemaVersion).toBe(SCHEMA_VERSION)
      for (const key of ['accounts', 'transactions', 'schedules', 'goals', 'settings'] as const) {
        if (key === 'settings') expect(r.data.settings).toMatchObject({ ...d.settings, weeklyReview: true })
        // v11 rellena `archived` y `order` en las cuentas (solo lo ausente); el resto no cambia.
        else if (key === 'accounts') expect(r.data.accounts).toEqual(d.accounts.map((a, i) => ({ ...a, archived: false, order: i })))
        else expect(r.data[key]).toEqual(d[key])
      }
      // Lo que no existía se rellena vacío; lo que existía se conserva.
      expect(r.data.categoryRules).toEqual(v >= 4 ? d.categoryRules : [])
      expect(r.data.favorites).toEqual(v >= 5 ? d.favorites : [])
    })
  }
})

describe('copias grandes', () => {
  it('una copia exportada con 50.000 movimientos se puede restaurar íntegra (antes superaba el límite de 5 MB)', () => {
    const big = createSyntheticData({ movements: 50000, today: '2026-09-28' })
    const text = JSON.stringify(createBackup(big, NOW, '0.1.0'), null, 2)
    expect(text.length).toBeGreaterThan(5 * 1024 * 1024)
    const r = parseBackup(text)
    expect(r.ok, JSON.stringify(!r.ok && r.issues.slice(0, 3))).toBe(true)
    if (r.ok) expect(r.data.transactions).toHaveLength(big.transactions.length)
  }, 60_000)
})
