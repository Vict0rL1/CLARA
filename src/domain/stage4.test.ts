import { describe, expect, it } from 'vitest'
import { createDemoData } from '../demo/demoData'
import { analysisItems } from './analysis'
import { todayInTimeZone } from './dates'
import { recoveryStatus } from './recovery'
import { saveTransaction } from './operations'
import { newId } from './ids'

const NOW = new Date('2026-09-28T12:00:00-04:00')
const TZ = 'America/Toronto'
const demo = () => {
  const data = createDemoData({ now: NOW, timeZone: TZ })
  return { data, today: todayInTimeZone(TZ, NOW), ctx: { today: todayInTimeZone(TZ, NOW), now: NOW.toISOString() } }
}

describe('análisis explicable (etapa 4)', () => {
  it('con la demo: luz vencida (42,80), meta «Laptop» por detrás; sin faltante ni aviso de copia; orden por gravedad e ids estables', () => {
    const { data, today } = demo()
    const items = analysisItems(data, today)
    const keys = items.map((i) => i.key)
    expect(keys[0]).toBe('overdueBills')
    const overdue = items[0]!
    expect(overdue.params).toMatchObject({ count: 1, total: 4280 })
    expect(overdue.because.find((b) => b.id === 'overdueTotal')?.value).toBe(4280)
    const laptop = data.goals.find((g) => g.name === 'Laptop para la escuela')!
    const behind = items.find((i) => i.key === `goalBehind:${laptop.id}`)!
    expect(behind.params).toMatchObject({ behind: 12000, ideal: 18000, saved: 6000 })
    expect(keys).not.toContain('shortfall')
    expect(keys).not.toContain('backupDue')
    // Mismo resultado al recalcular: nada se guarda ni depende del azar.
    expect(analysisItems(data, today).map((i) => i.key)).toEqual(keys)
    // Gravedad: critical < warning < info.
    const order = items.map((i) => i.severity)
    expect(order).toEqual([...order].sort((a, b) => ({ critical: 0, warning: 1, info: 2 })[a] - ({ critical: 0, warning: 1, info: 2 })[b]))
  })

  it('un gasto previsto grande produce «faltante» con el desglose que cuadra al céntimo', () => {
    const { data, today, ctx } = demo()
    const main = data.accounts[0]!
    const r = saveTransaction(data, { id: newId(), kind: 'expense', status: 'planned', amountMinor: 95000, date: '2026-10-05', accountId: main.id, categoryId: 'other_expense' }, ctx)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const item = analysisItems(r.data, today).find((i) => i.id === 'shortfall')!
    expect(item.severity).toBe('critical')
    expect(item.params.date).toBe('2026-10-05')
    const by = Object.fromEntries(item.because.map((b) => [b.id, b.value as number]))
    expect(by.startBalance! + by.inflowsUntil! - by.outflowsUntil!).toBe(by.balanceOn)
    expect(by.balanceOn).toBe(item.params.amount)
    expect(by.balanceOn).toBeLessThan(0)
  })

  it('la variación del gasto compara con el mismo tramo del mes anterior y calla si no hay datos', () => {
    const { data, today } = demo()
    // La demo empieza 40 días antes de hoy (19-ago): el tramo 1–28 de agosto no está completo → sin comparación.
    const items = analysisItems(data, today)
    expect(items.find((i) => i.id === 'spendingUp' || i.id === 'spendingDown')).toBeUndefined()
  })
})

describe('centro de datos y recuperación (etapa 4)', () => {
  it('demo: guardado ok, copia «demo», copias locales disponibles; el peor estado manda y los pasos siguen el orden', () => {
    const { data, today } = demo()
    const s = recoveryStatus({ data, today, backend: 'indexeddb', localCopies: { count: 2, lastCreatedAt: '2026-09-27T10:00:00.000Z' }, preMigrationCopy: true, errorCount: 0, offlineReady: true })
    const byId = Object.fromEntries(s.rows.map((r) => [r.id, r]))
    expect(byId.saving!.state).toBe('ok')
    expect(byId.export!.state).toBe('info')
    expect(byId.localCopies!.params.count).toBe(2)
    expect(byId.records!.params.transactions).toBe(data.transactions.length)
    expect(s.steps.map((x) => x.id)).toEqual(['export', 'localCopies', 'preMigration', 'trash', 'history'])
    expect(s.steps.find((x) => x.id === 'localCopies')!.available).toBe(true)
    expect(s.steps.find((x) => x.id === 'export')!.available).toBe(false)
    expect(s.overall).toBe('info')
  })

  it('datos reales nunca exportados y guardado en memoria: crítico; sin copias locales: aviso', () => {
    const { data, today } = demo()
    const real = { ...data, isDemo: false }
    const s = recoveryStatus({ data: real, today, backend: 'memory', localCopies: null, preMigrationCopy: false, errorCount: 3, offlineReady: false })
    const byId = Object.fromEntries(s.rows.map((r) => [r.id, r]))
    expect(byId.saving!.state).toBe('critical')
    expect(byId.export!.state).toBe('critical')
    expect(byId.localCopies!.state).toBe('warn')
    expect(byId.errors!.params.count).toBe(3)
    expect(s.overall).toBe('critical')
    expect(s.steps.every((x) => x.id === 'history' ? x.available === real.history.length > 0 : !x.available || x.id === 'trash')).toBe(true)
  })
})
