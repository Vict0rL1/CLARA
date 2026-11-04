/**
 * Auditoría independiente del 2026-11-02 sobre `420c700` (prioridad 1, defecto financiero): deshacer una reparación
 * en el sitio (mismo id, 28-mar → 31-mar) con un gasto planificado creado DESPUÉS y vinculado al 31-mar dejaba el
 * vínculo apuntando a una fecha que ya no existía: la factura del 28-mar volvía a reservarse y el apartado del gasto
 * planificado seguía reservado; la misma factura contaba dos veces (980 → 560 disponibles). El estado roto sobrevivía
 * a recargar, validar y exportar/importar. Ahora toda referencia a una ocurrencia (vínculo de un gasto planificado,
 * aplazamiento) que hoy resuelve y tras revertir no resolvería —tramo eliminado, u otra fecha de siempre, regla,
 * inicio o fin bajo el mismo id— impide revertir, sin tocar nada, y el historial dice qué registro es. Datos sintéticos.
 */
import { describe, expect, it } from 'vitest'
import { computeBudget } from './budget'
import { recordHistory } from './history'
import { canRevert, revertDependents, revertEntry } from './historyRevert'
import { snoozeInboxItem } from './inbox'
import { saveSchedule, type ScheduleDraft } from './operations'
import { savePlannedExpense } from './plannedExpenses'
import { repairSplit } from './splitRepair'
import type { AppData, HistoryEntry, Schedule } from './types'
import { backupText, parseBackup, validateAppData } from '../storage/backup'
import { account, baseData, bill } from '../test/fixtures'

const persisted = (d: AppData): AppData => JSON.parse(JSON.stringify(d)) as AppData
const at = (today: string) => ({ today, now: `${today}T12:00:00.000Z` })
const roundTrip = (d: AppData, today: string): AppData => {
  const r = parseBackup(backupText(persisted(d), new Date(`${today}T12:00:00.000Z`), 'test'))
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.data
}
const figures = (d: AppData, today: string) => {
  const b = computeBudget(d, today)
  return { available: b.availableMinor, reserved: b.reservedTotalMinor, goals: b.goalsReservedMinor }
}
const lastEntry = (d: AppData): HistoryEntry => d.history.at(-1)!
const ok = <T,>(r: { ok: true; data: AppData; value: T } | { ok: false; issues: unknown[] }): AppData => {
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.data
}
const draftOf = (s: Schedule, over: Partial<ScheduleDraft>): ScheduleDraft => {
  const { createdAt: _c, updatedAt: _u, currency: _cur, skippedDates: _k, ...rest } = s
  return { ...rest, ...over }
}

/** Factura «Internet» del 31 partida el 28-feb por una versión anterior; enero y febrero OMITIDOS; horizonte de 30 días. */
const fixture = (): AppData => {
  const d = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 140000, date: '2026-03-01', setAt: '2026-03-01T12:00:00.000Z' } })],
    schedules: [
      bill('2026-01-31', 42000, { id: 'b1', name: 'Internet', frequency: 'monthly', endDate: '2026-02-27', skippedDates: ['2026-01-31'] }),
      bill('2026-02-28', 42000, { id: 'b2', name: 'Internet', frequency: 'monthly', skippedDates: ['2026-02-28'] }),
    ],
  })
  return { ...d, settings: { ...d.settings, fallbackHorizonDays: 30 } }
}

/** Repara `b2` en el sitio el 20-mar (28-mar → 31-mar) y después crea el gasto planificado vinculado al 31-mar con 420 apartados. */
function repairedAndFunded() {
  const d = fixture()
  const repaired = recordHistory(d, ok(repairSplit(d, 'b2', at('2026-03-20'), 'b3')), at('2026-03-20').now)
  expect(repaired.schedules.map((s) => s.id)).toEqual(['b1', 'b2'])
  expect(repaired.schedules.find((s) => s.id === 'b2')).toMatchObject({ anchorDate: '2026-01-31', skippedDates: ['2026-02-28'] })
  const entry = lastEntry(repaired)
  const funded = recordHistory(
    repaired,
    ok(savePlannedExpense(repaired, { id: 'g1', name: 'Internet de marzo', targetMinor: 42000, dueDate: '2026-03-31', fundedFrom: 'budget', link: { scheduleId: 'b2', occurrenceDate: '2026-03-31' }, initialReservedMinor: 42000 }, at('2026-03-20'))),
    at('2026-03-20').now,
  )
  return { d, entry, funded }
}

const expectRefused = (data: AppData, entry: HistoryEntry, today: string, dependent: Record<string, unknown>) => {
  const before = JSON.stringify(data)
  expect(canRevert(data, entry, today)).toBe('dependents')
  expect(revertDependents(data, entry, today)).toMatchObject([dependent])
  expect(revertEntry(data, entry.id, at(today))).toMatchObject({ ok: false, issues: [{ path: 'history', code: 'revertDependents', params: { count: 1 } }] })
  expect(JSON.stringify(data)).toBe(before)
}

describe('Auditoría 2026-11-02 · P1: revertir una reparación con un gasto planificado vinculado a la fecha corregida', () => {
  it('la reproducción: 1 400 de saldo, factura de 420, apartado de 420 vinculado al 31-mar → 980 disponibles; revertir se rechaza por el gasto planificado y sigue en 980 (antes: 560, la misma factura dos veces)', () => {
    const { entry, funded } = repairedAndFunded()
    expect(figures(funded, '2026-03-20')).toEqual({ available: 98000, reserved: 0, goals: 42000 })
    expect(funded.goals.find((g) => g.id === 'g1')?.plan?.link).toEqual({ scheduleId: 'b2', occurrenceDate: '2026-03-31' })
    expectRefused(funded, entry, '2026-03-20', { kind: 'goal', id: 'g1', name: 'Internet de marzo', scheduleId: 'b2', occurrenceDate: '2026-03-31' })
    expect(figures(funded, '2026-03-20').available).toBe(98000)
    // Tras recargar y tras exportar e importar: mismas cifras, mismo vínculo, misma negativa.
    for (const again of [persisted(funded), roundTrip(funded, '2026-03-20')]) {
      expect(validateAppData(again).ok).toBe(true)
      expect(figures(again, '2026-03-20')).toEqual({ available: 98000, reserved: 0, goals: 42000 })
      expectRefused(again, again.history.find((e) => e.id === entry.id)!, '2026-03-20', { kind: 'goal', id: 'g1', occurrenceDate: '2026-03-31' })
    }
  })

  it('sin el gasto planificado (o con su vínculo retirado) la reparación se sigue pudiendo revertir, y las fechas vuelven al 28', () => {
    const { entry, funded } = repairedAndFunded()
    const unlinked = recordHistory(
      funded,
      ok(savePlannedExpense(funded, { id: 'g1', name: 'Internet de marzo', targetMinor: 42000, dueDate: '2026-03-31', fundedFrom: 'budget' }, at('2026-03-21'))),
      at('2026-03-21').now,
    )
    expect(unlinked.goals.find((g) => g.id === 'g1')?.plan?.link).toBeUndefined()
    expect(canRevert(unlinked, entry, '2026-03-21')).toBe('ok')
    const back = revertEntry(unlinked, entry.id, at('2026-03-21'))
    if (!back.ok) throw new Error(JSON.stringify(back.issues))
    expect(back.data.schedules.find((s) => s.id === 'b2')?.anchorDate).toBeUndefined()
    expect(validateAppData(persisted(back.data)).ok).toBe(true)
    // Sin vínculo, el apartado y la factura del 28 son dos cosas distintas y las dos cuentan: 1 400 − 420 − 420.
    expect(figures(back.data, '2026-03-21')).toEqual({ available: 56000, reserved: 42000, goals: 42000 })
  })

  it('una referencia solo por id (plantilla de distribución) no bloquea revertir una reparación en el sitio: el programado sigue existiendo', () => {
    const { entry, funded } = repairedAndFunded()
    const withTemplate: AppData = {
      ...funded,
      goals: funded.goals.map((g) => (g.id === 'g1' ? { ...g, plan: { ...g.plan!, link: undefined } } : g)),
      templates: [{ id: 'tpl', kind: 'distribution', name: 'Quincena', lines: [{ target: { kind: 'payment', scheduleId: 'b2' }, amountMinor: 42000 }], rounding: 'lastLine', createdAt: funded.updatedAt, updatedAt: funded.updatedAt } as never],
    }
    expect(canRevert(withTemplate, entry, '2026-03-20')).toBe('ok')
  })

  describe('la misma clase de omisión en otras ediciones del programado (mismo id): fin, inicio y regla', () => {
    /** Programado del 31 con `over` aplicado como estado inicial; la entrada lo edita a `edited`; después se vincula un gasto planificado a `linkDate`. */
    const edited = (initial: Partial<Schedule>, edit: Partial<ScheduleDraft>, linkDate: string) => {
      const d0 = fixture()
      const d: AppData = { ...d0, schedules: [{ ...bill('2026-01-31', 42000, { id: 'b', name: 'Internet', frequency: 'monthly' }), ...initial }] }
      const s = d.schedules[0]!
      const changed = recordHistory(d, ok(saveSchedule(d, draftOf(s, edit), at('2026-03-20'))), at('2026-03-20').now)
      const entry = lastEntry(changed)
      const funded = recordHistory(
        changed,
        ok(savePlannedExpense(changed, { id: 'g', name: 'Internet', targetMinor: 42000, dueDate: linkDate, fundedFrom: 'budget', link: { scheduleId: 'b', occurrenceDate: linkDate }, initialReservedMinor: 42000 }, at('2026-03-20'))),
        at('2026-03-20').now,
      )
      return { entry, funded }
    }

    it('fin: la entrada quitó una fecha de fin anterior al 31-mar; con un vínculo al 31-mar no se revierte', () => {
      const { entry, funded } = edited({ endDate: '2026-03-15' }, { endDate: undefined }, '2026-03-31')
      expectRefused(funded, entry, '2026-03-20', { kind: 'goal', id: 'g', occurrenceDate: '2026-03-31' })
    })

    it('inicio: la entrada adelantó el inicio del 30-abr al 31-ene; con un vínculo al 31-mar no se revierte', () => {
      const { entry, funded } = edited({ startDate: '2026-04-30' }, { startDate: '2026-01-31' }, '2026-03-31')
      expectRefused(funded, entry, '2026-03-20', { kind: 'goal', id: 'g', occurrenceDate: '2026-03-31' })
    })

    it('regla: la entrada pasó de mensual a «dos veces al mes» (31 y 15); con un vínculo al 15-abr (solo existe con la regla nueva) no se revierte', () => {
      const { entry, funded } = edited({}, { frequency: 'semimonthly', secondDay: 15 }, '2026-04-15')
      expectRefused(funded, entry, '2026-03-20', { kind: 'goal', id: 'g', occurrenceDate: '2026-04-15' })
    })

    it('una edición que conserva la fecha vinculada (importe) se sigue pudiendo revertir', () => {
      const { entry, funded } = edited({}, { amountMinor: 45000 }, '2026-03-31')
      expect(canRevert(funded, entry, '2026-03-20')).toBe('ok')
    })
  })

  it('un aplazamiento del aviso del 31-mar (creado después de reparar) también bloquea revertir mientras no caduque; caducado, no (R5)', () => {
    const { entry, funded } = repairedAndFunded()
    const unlinked: AppData = { ...funded, goals: [] }
    expect(canRevert(unlinked, entry, '2026-04-02')).toBe('ok')
    const snoozed = recordHistory(unlinked, ok(snoozeInboxItem(unlinked, 'due:schedule:b2:2026-03-31', '2026-04-09', at('2026-04-02'))), at('2026-04-02').now)
    expectRefused(snoozed, entry, '2026-04-02', { kind: 'snooze', id: 'due:schedule:b2:2026-03-31', scheduleId: 'b2', occurrenceDate: '2026-03-31' })
    expect(canRevert(snoozed, entry, '2026-04-09')).toBe('ok')
  })
})
