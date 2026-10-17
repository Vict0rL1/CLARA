/**
 * Auditoría independiente del PR #15 (cabeza 819eaa9, base a23b135): reproducción y contrato de QA-05 (deshacer una partición devuelve también plantillas, escenarios y aplazamientos).
 * Datos sintéticos, fechas fijas; falla sobre 819eaa9 y fija el contrato corregido. QA-03 (= STAT-01) y QA-04
 * (= CUR-02) están en `qaV2.test.ts` y `tests/e2e/qa-v2.spec.ts`; la aceptación de navegador en `tests/e2e/qa-pr15.spec.ts`.
 */
import { describe, expect, it } from 'vitest'
import { recordHistory, revertEntry } from './history'
import { saveTransaction, type ScheduleDraft } from './operations'
import { saveScheduleFrom } from './scheduleFrom'
import type { AppData, Schedule } from './types'
import { validateAppData } from '../storage/backup'
import { baseData, bill, ctx, EARLIER, NOW, tx } from '../test/fixtures'

/** El borrador que manda el formulario al partir «desde una fecha» cambiando SOLO el importe (con la fecha propuesta). */
function amountOnly(s: Schedule, startDate: string, amountMinor: number): ScheduleDraft {
  const { createdAt: _c, updatedAt: _u, currency: _cur, skippedDates: _k, ...rest } = s
  return { ...rest, id: 'next', startDate, amountMinor }
}
const at = (today: string) => ({ today, now: `${today}T12:00:00.000Z` })
const split = (d: AppData, id: string, draft: ScheduleDraft, today: string) => {
  const r = saveScheduleFrom(d, id, draft, at(today))
  if (!r.ok) throw new Error(`split: ${JSON.stringify(r.issues)}`)
  return r
}

describe('QA-05 · deshacer una partición devuelve también plantillas, escenarios y aplazamientos', () => {
  const rent = bill('2026-06-01', 65000, { id: 'old', name: 'Renta', frequency: 'monthly', categoryId: 'housing' })
  const seed = (): AppData =>
    baseData({
      schedules: [rent],
      templates: [{ id: 't', name: 'Quincena', kind: 'distribution', lines: [{ target: { kind: 'payment', scheduleId: 'old' }, amount: { mode: 'fixed', amountMinor: 65000 } }], createdAt: EARLIER, updatedAt: EARLIER }],
      scenarios: [{ id: 'sc', name: 'Si sube', changes: [{ type: 'scheduleAmount', scheduleId: 'old', newAmountMinor: 72000 }], baseFingerprint: 'x', createdAt: EARLIER, updatedAt: EARLIER }],
      inbox: { snoozed: [{ id: 'due:schedule:old:2026-10-01', until: '2026-10-20', at: EARLIER }], dismissed: [] },
    })
  const splitAndRecord = (d: AppData) => recordHistory(d, split(d, 'old', amountOnly(rent, '2026-10-01', 70000), ctx.today).data, NOW)
  const persisted = (d: AppData): AppData => JSON.parse(JSON.stringify(d)) as AppData
  /** A qué programado apunta la línea de la plantilla de distribución. */
  const paymentTarget = (d: AppData) => {
    const t = d.templates[0]!
    return t.kind === 'distribution' ? t.lines[0]!.target : null
  }

  it('partir → guardar → recargar → revertir: no queda ninguna referencia a la serie nueva y todo vuelve exactamente a como estaba', () => {
    const d = seed()
    const after = splitAndRecord(d)
    expect(paymentTarget(after)).toEqual({ kind: 'payment', scheduleId: 'next' })
    expect(after.scenarios[0]!.changes[0]).toMatchObject({ scheduleId: 'next' })
    expect(after.inbox.snoozed[0]!.id).toBe('due:schedule:next:2026-10-01')
    const entry = after.history.at(-1)!
    const back = revertEntry(persisted(after), entry.id, ctx)
    if (!back.ok) throw new Error(JSON.stringify(back.issues))
    expect(back.data.schedules).toEqual(d.schedules)
    expect(back.data.templates).toEqual(d.templates)
    expect(back.data.scenarios).toEqual(d.scenarios)
    expect(back.data.inbox).toEqual(d.inbox)
    expect(validateAppData(persisted(back.data)).ok).toBe(true)
  })

  it('un cambio posterior en una plantilla afectada impide revertir con un conflicto claro y sin cambios parciales', () => {
    const after = splitAndRecord(seed())
    const entry = after.history.at(-1)!
    const edited: AppData = { ...after, templates: [{ ...after.templates[0]!, name: 'Quincena (editada)', updatedAt: NOW }] }
    const tracked = recordHistory(after, edited, NOW)
    expect(revertEntry(tracked, entry.id, ctx)).toMatchObject({ ok: false, issues: [{ path: 'history', code: 'revertConflict' }] })
    expect(tracked.schedules.map((s) => s.id)).toEqual(['old', 'next'])
    expect(tracked.templates[0]!.name).toBe('Quincena (editada)')
  })

  it('un cambio posterior que no toca lo partido sobrevive a revertir', () => {
    const after = splitAndRecord(seed())
    const entry = after.history.at(-1)!
    const added = saveTransaction(after, tx({ id: 'cafe', date: ctx.today, amountMinor: 450 }), ctx)
    if (!added.ok) throw new Error(JSON.stringify(added.issues))
    const back = revertEntry(recordHistory(after, added.data, NOW), entry.id, ctx)
    if (!back.ok) throw new Error(JSON.stringify(back.issues))
    expect(back.data.transactions.map((t) => t.id)).toEqual(['cafe'])
    expect(back.data.schedules.map((s) => s.id)).toEqual(['old'])
    expect(paymentTarget(back.data)).toEqual({ kind: 'payment', scheduleId: 'old' })
  })
})
