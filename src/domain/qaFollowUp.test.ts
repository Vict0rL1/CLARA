/**
 * Auditoría independiente de seguimiento (cabeza 46fe617, fuentes = d28de42): reproducción y contrato de F-01.
 * Datos sintéticos, fechas fijas. Los artefactos de la auditoría no estaban disponibles: cada caso se reproduce
 * aquí a partir de su descripción.
 */
import { describe, expect, it } from 'vitest'
import { canRevert, recordHistory, revertDependents, revertEntry } from './history'
import { snoozeInboxItem } from './inbox'
import { saveScheduleFrom } from './scheduleFrom'
import { type ScheduleDraft } from './operations'
import type { AppData, Schedule } from './types'
import { HISTORY_COLLECTIONS, INBOX_ID_MAX, isValidHistoryChangeId, validateHistory } from './validation'
import type { HistoryEntry } from './types'
import { backupText, parseBackup, validateAppData } from '../storage/backup'
import { computeBudget } from './budget'
import { dismissSplitRepair, driftedSplits, repairSplit } from './splitRepair'
import { occurrencesBetween } from './recurrence'
import { account, baseData, bill, EARLIER, goal, income, NOW } from '../test/fixtures'

const persisted = (d: AppData): AppData => JSON.parse(JSON.stringify(d)) as AppData
const idOf = (n: number) => 'a'.repeat(n)
function amountOnly(s: Schedule, startDate: string, amountMinor: number, id: string): ScheduleDraft {
  const { createdAt: _c, updatedAt: _u, currency: _cur, skippedDates: _k, ...rest } = s
  return { ...rest, id, startDate, amountMinor }
}
const at = (today: string) => ({ today, now: `${today}T12:00:00.000Z` })

describe('F-01 · un programado con un id largo (admitido hasta 64) y su aviso pospuesto: partirlo deja datos que SE GUARDAN y vuelven a cargar', () => {
  const seed = (oldId: string) =>
    baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 100000, date: '2026-09-01', setAt: '2026-09-01T12:00:00.000Z' } })],
      schedules: [bill('2026-06-01', 40000, { id: oldId, name: 'Luz', frequency: 'monthly' })],
      inbox: { snoozed: [{ id: `due:schedule:${oldId}:2026-10-01`, until: '2026-10-15', at: '2026-09-27T12:00:00.000Z' }], dismissed: [] },
    })

  for (const [oldLen, newLen] of [[64, 64], [47, 36], [41, 36], [40, 36], [36, 36]] as const) {
    it(`id anterior de ${oldLen} y nuevo de ${newLen}: partir → guardar → recargar → deshacer → recargar → exportar → reimportar`, () => {
      const d = seed(idOf(oldLen))
      expect(validateAppData(persisted(d)).ok).toBe(true)
      const r = saveScheduleFrom(d, idOf(oldLen), amountOnly(d.schedules[0]!, '2026-10-01', 42000, 'b'.repeat(newLen)), at('2026-09-28'))
      if (!r.ok) throw new Error(JSON.stringify(r.issues))
      const saved = recordHistory(d, r.data, NOW)
      expect(saved.inbox.snoozed.map((s) => s.id)).toEqual([`due:schedule:${'b'.repeat(newLen)}:2026-10-01`])
      // Lo que `AppStore` guarda tiene que poder leerse: validación entera, como al recargar.
      const reloaded = persisted(saved)
      const v = validateAppData(reloaded)
      expect(v.ok ? [] : v.issues, 'tras partir').toEqual([])
      // Deshacer desde el historial y volver a cargar.
      const back = revertEntry(reloaded, reloaded.history.at(-1)!.id, at('2026-09-28'))
      if (!back.ok) throw new Error(JSON.stringify(back.issues))
      const undone = persisted(recordHistory(reloaded, back.data, NOW, { source: 'revert', revertOf: reloaded.history.at(-1)!.id }))
      const v2 = validateAppData(undone)
      expect(v2.ok ? [] : v2.issues, 'tras deshacer').toEqual([])
      expect(undone.inbox.snoozed.map((s) => s.id)).toEqual([`due:schedule:${idOf(oldLen)}:2026-10-01`])
      // Exportar e importar la copia.
      const file = backupText(undone, new Date(NOW), 'test')
      const imported = parseBackup(file)
      expect(imported.ok ? [] : imported.issues, 'reimportar').toEqual([])
    })
  }

  it('posponer un aviso de un programado con id largo (sin partir) seguía siendo válido: el límite de 64 es solo de los ids de registros', () => {
    const d = baseData({ schedules: [bill('2026-06-01', 40000, { id: idOf(64), name: 'Luz', frequency: 'monthly' })] })
    const s = snoozeInboxItem(d, `due:schedule:${idOf(64)}:2026-10-01`, '2026-10-15', at('2026-09-28'))
    if (!s.ok) throw new Error('snooze')
    expect(validateAppData(persisted(s.data)).ok).toBe(true)
  })
})

describe('F-01 · contrato de id por colección del historial (el mismo que usa cada colección al guardarse)', () => {
  const entry = (collection: HistoryEntry['changes'][number]['collection'], id: string): HistoryEntry => ({
    id: 'h1',
    at: NOW,
    source: 'app',
    changes: [{ collection, id, before: null, after: { id } }],
  })
  for (const collection of HISTORY_COLLECTIONS) {
    const max = collection === 'inboxSnoozed' ? INBOX_ID_MAX : 64
    it(`${collection}: acepta ${max} caracteres y rechaza ${max + 1} (y el vacío)`, () => {
      expect(validateHistory([entry(collection, 'x'.repeat(max))])).toEqual([])
      expect(validateHistory([entry(collection, 'x'.repeat(max + 1))])).toEqual([{ path: 'history[0].changes[0]', code: 'invalidValue' }])
      expect(validateHistory([entry(collection, '')])).toEqual([{ path: 'history[0].changes[0]', code: 'invalidValue' }])
      expect(isValidHistoryChangeId(collection, 'x'.repeat(max))).toBe(true)
      expect(isValidHistoryChangeId(collection, 'x'.repeat(max + 1))).toBe(false)
    })
  }
  it('el id de un aviso pospuesto más largo posible (dup:<64>:<64>, 133) cabe en el contrato de la bandeja', () => {
    expect(isValidHistoryChangeId('inboxSnoozed', `dup:${'x'.repeat(64)}:${'y'.repeat(64)}`)).toBe(true)
  })
})

describe('F-01 · recuperación: lo que guardó la versión con el fallo (ids de aviso de 88 en el historial) vuelve a leerse tal cual', () => {
  it('una copia exportada por la versión anterior, con la partición en el historial, se importa sin cambios en sus datos', () => {
    const oldId = idOf(64)
    const d = baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 100000, date: '2026-09-01', setAt: '2026-09-01T12:00:00.000Z' } })],
      schedules: [bill('2026-06-01', 40000, { id: oldId, name: 'Luz', frequency: 'monthly' })],
      inbox: { snoozed: [{ id: `due:schedule:${oldId}:2026-10-01`, until: '2026-10-15', at: '2026-09-27T12:00:00.000Z' }], dismissed: [] },
    })
    const r = saveScheduleFrom(d, oldId, amountOnly(d.schedules[0]!, '2026-10-01', 42000, 'b'.repeat(36)), at('2026-09-28'))
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    // Exactamente lo que la versión anterior escribía (la escritura no validaba): historial con ids de aviso de 88 y 60.
    const written = persisted(recordHistory(d, r.data, NOW))
    expect(written.history[0]!.changes.filter((c) => c.collection === 'inboxSnoozed').map((c) => c.id.length).sort((a, b) => a - b)).toEqual([60, 88])
    const imported = parseBackup(backupText(written, new Date(NOW), '0.0.0-faulty'))
    expect(imported.ok ? [] : imported.issues).toEqual([])
    // Sin migración ni reparación: los datos eran correctos, solo la lectura los rechazaba.
    expect(imported.ok && imported.data).toEqual(written)
  })
})

describe('F-02 · deshacer no elimina un programado al que otros registros seguirían apuntando', () => {
  const rent = bill('2026-06-01', 65000, { id: 'old', name: 'Renta', frequency: 'monthly', categoryId: 'housing' })
  const seed = (): AppData =>
    baseData({
      schedules: [rent],
      templates: [{ id: 't', name: 'Quincena', kind: 'distribution', lines: [{ target: { kind: 'payment', scheduleId: 'old' }, amount: { mode: 'fixed', amountMinor: 65000 } }], createdAt: EARLIER, updatedAt: EARLIER }],
      scenarios: [{ id: 'sc', name: 'Si sube', changes: [{ type: 'scheduleAmount', scheduleId: 'old', newAmountMinor: 72000 }], baseFingerprint: 'x', createdAt: EARLIER, updatedAt: EARLIER }],
      inbox: { snoozed: [{ id: 'due:schedule:old:2026-10-01', until: '2026-10-20', at: EARLIER }], dismissed: [] },
    })
  const draft = (): ScheduleDraft => amountOnly(rent, '2026-10-01', 70000, 'next')
  const split = (d: AppData) => {
    const r = saveScheduleFrom(d, 'old', draft(), at('2026-09-28'))
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    return r.data
  }
  const ctx = at('2026-09-28')

  it('entrada antigua (esquema 13: solo instantáneas de programados): revertir se rechaza, se dice qué apunta a la serie que desaparecería y nada cambia', () => {
    const d = seed()
    const after = split(d)
    // Lo que 819eaa9 grababa: la partición sin las plantillas, escenarios ni aplazamientos que movió.
    const legacy: HistoryEntry = {
      id: 'h-legacy',
      at: NOW,
      source: 'app',
      changes: [
        { collection: 'schedules', id: 'old', before: d.schedules[0]!, after: after.schedules.find((s) => s.id === 'old')! },
        { collection: 'schedules', id: 'next', before: null, after: after.schedules.find((s) => s.id === 'next')! },
      ],
    }
    const stored = persisted({ ...after, history: [legacy] })
    const serialized = JSON.stringify(stored)
    expect(canRevert(stored, legacy, ctx.today)).toBe('dependents')
    expect(revertDependents(stored, legacy, ctx.today)).toEqual([
      { kind: 'template', id: 't', name: 'Quincena', scheduleId: 'next' },
      { kind: 'scenario', id: 'sc', name: 'Si sube', scheduleId: 'next' },
      { kind: 'snooze', id: 'due:schedule:next:2026-10-01', name: '2026-10-01', scheduleId: 'next' },
    ])
    expect(revertEntry(stored, 'h-legacy', ctx)).toEqual({ ok: false, issues: [{ path: 'history', code: 'revertDependents', params: { count: 3 } }] })
    expect(JSON.stringify(stored)).toBe(serialized)
  })

  it('una plantilla, un escenario o un gasto planificado creados DESPUÉS de una partición corregida (v14) también la bloquean; la de siempre (QA-05) sigue revirtiéndose', () => {
    const d = seed()
    const tracked = recordHistory(d, split(d), NOW)
    const entry = tracked.history.at(-1)!
    expect(canRevert(tracked, entry, ctx.today)).toBe('ok')
    const laterTemplate: AppData = { ...tracked, templates: [...tracked.templates, { id: 't2', name: 'Nueva', kind: 'distribution', lines: [{ target: { kind: 'payment', scheduleId: 'next' }, amount: { mode: 'fixed', amountMinor: 100 } }], createdAt: NOW, updatedAt: NOW }] }
    const withTemplate = recordHistory(tracked, laterTemplate, NOW)
    expect(canRevert(withTemplate, entry, ctx.today)).toBe('dependents')
    expect(revertDependents(withTemplate, entry, ctx.today)).toEqual([{ kind: 'template', id: 't2', name: 'Nueva', scheduleId: 'next' }])
    expect(revertEntry(withTemplate, entry.id, ctx)).toMatchObject({ ok: false, issues: [{ code: 'revertDependents', params: { count: 1 } }] })

    const laterGoal: AppData = {
      ...tracked,
      goals: [...tracked.goals, goal({ id: 'g', name: 'Seguro', kind: 'expense', targetMinor: 20000, targetDate: '2026-11-01', plan: { link: { scheduleId: 'next', occurrenceDate: '2026-11-01' }, history: [] } })],
    }
    expect(revertDependents(recordHistory(tracked, laterGoal, NOW), entry, ctx.today)).toMatchObject([{ kind: 'goal', id: 'g', name: 'Seguro' }])
  })

  it('una referencia que ya no resolvía antes no cuenta (semántica de destino ausente intacta) y una entrada que no elimina programados no calcula nada', () => {
    const base = seed()
    const d: AppData = { ...base, templates: [...base.templates, { id: 'ghost', name: 'Vieja', kind: 'distribution', lines: [{ target: { kind: 'payment', scheduleId: 'borrado' }, amount: { mode: 'fixed', amountMinor: 100 } }], createdAt: EARLIER, updatedAt: EARLIER }] }
    const tracked = recordHistory(d, split(d), NOW)
    const entry = tracked.history.at(-1)!
    expect(revertDependents(tracked, entry, ctx.today)).toEqual([])
    expect(canRevert(tracked, entry, ctx.today)).toBe('ok')
    // Un cambio de importe sin partir: la entrada no crea programados, así que no hay nada que evaluar.
    const edited = recordHistory(tracked, { ...tracked, schedules: tracked.schedules.map((s) => (s.id === 'next' ? { ...s, amountMinor: 71000, updatedAt: NOW } : s)) }, NOW)
    expect(revertDependents(edited, edited.history.at(-1)!, ctx.today)).toEqual([])
  })
})

describe('QA-01 histórico · particiones hechas por 819eaa9 (esquema 13, sin `anchorDate`): revisión y reparación confirmada', () => {
  const TODAY = '2026-03-15'
  const c = at(TODAY)
  /** La auditoría: saldo CAD 1 800, factura de 1 250 el 29-mar, sueldo mensual del 31 partido el 28-feb (el 31 movido) solo por importe. */
  const audit = (): AppData =>
    baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 180000, date: '2026-03-01', setAt: '2026-03-01T12:00:00.000Z' } })],
      schedules: [
        income('2026-01-31', 300000, { id: 'salary-old', name: 'Sueldo', frequency: 'monthly', endDate: '2026-02-27' }),
        income('2026-02-28', 320000, { id: 'salary-new', name: 'Sueldo', frequency: 'monthly' }),
        bill('2026-03-29', 125000, { id: 'bill', name: 'Seguro', frequency: 'once' }),
      ],
    })

  it('se detecta: hoy cuenta desde el 28 (28-mar, 28-abr, 28-may) y con la fecha de siempre sería 31-mar, 30-abr, 31-may', () => {
    const d = audit()
    expect(driftedSplits(d, TODAY)).toEqual([
      { scheduleId: 'salary-new', endedId: 'salary-old', name: 'Sueldo', anchor: '2026-01-31', startDate: '2026-02-28', current: ['2026-03-28', '2026-04-28', '2026-05-28'], proposed: ['2026-03-31', '2026-04-30', '2026-05-31'] },
    ])
    // El efecto financiero del deslizamiento (lo que vio la auditoría tras importar): horizonte 28-mar, nada reservado, 1 800 disponibles.
    const before = computeBudget(d, TODAY)
    expect([before.horizon?.endDate, before.reservedTotalMinor, before.availableMinor]).toEqual(['2026-03-28', 0, 180000])
  })

  it('reparar (confirmado) devuelve la fecha de siempre al tramo nuevo y nada más: horizonte 31-mar, 1 250 reservados, 550 disponibles; persiste en la copia', () => {
    const d = audit()
    const r = repairSplit(d, 'salary-new', c)
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.value).toMatchObject({ id: 'salary-new', anchorDate: '2026-01-31', startDate: '2026-02-28', amountMinor: 320000 })
    expect(r.data.schedules.find((s) => s.id === 'salary-old')).toEqual(d.schedules[0])
    expect(occurrencesBetween(r.value, TODAY, '2026-06-30')).toEqual(['2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30'])
    const after = computeBudget(r.data, TODAY)
    expect([after.horizon?.endDate, after.reservedTotalMinor, after.availableMinor]).toEqual(['2026-03-31', 125000, 55000])
    expect(driftedSplits(r.data, TODAY)).toEqual([])
    // Guardar, recargar, exportar y reimportar: la reparación se conserva y sigue validando.
    const stored = persisted(recordHistory(d, r.data, c.now))
    expect(validateAppData(stored).ok).toBe(true)
    const imported = parseBackup(backupText(stored, new Date(c.now), 'test'))
    expect(imported.ok && computeBudget(imported.data, TODAY).availableMinor).toBe(55000)
    // Es una edición normal del programado: se puede revertir desde el historial.
    const back = revertEntry(stored, stored.history.at(-1)!.id, c)
    expect(back.ok && back.data.schedules.find((s) => s.id === 'salary-new')?.anchorDate).toBeUndefined()
  })

  it('«Dejar como está» conserva el 28 a propósito, deja de proponerse (descarte con huella) y vuelve a proponerse solo si el tramo cambia de fechas', () => {
    const d = audit()
    const r = dismissSplitRepair(d, 'salary-new', c)
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.data.schedules).toEqual(d.schedules)
    expect(r.data.inbox.dismissed).toEqual([{ id: 'int:split:salary-new', fingerprint: '2026-02-28||2026-01-31', at: c.now }])
    expect(driftedSplits(r.data, TODAY)).toEqual([])
    expect(computeBudget(r.data, TODAY).horizon?.endDate).toBe('2026-03-28')
    expect(repairSplit(r.data, 'salary-new', c)).toMatchObject({ ok: false, issues: [{ code: 'notFound' }] })
    expect(validateAppData(persisted(r.data)).ok).toBe(true)
  })

  it('no se señalan: una partición hecha por v14 (con `anchorDate`), un reanclaje explícito en una fecha ajena a la serie, un tramo ya terminado ni una serie sin partir', () => {
    const d = audit()
    const fixed: AppData = { ...d, schedules: d.schedules.map((s) => (s.id === 'salary-new' ? { ...s, anchorDate: '2026-01-31' } : s)) }
    expect(driftedSplits(fixed, TODAY)).toEqual([])
    // Partida el 15-feb (no es fecha de la serie del 31): la persona cambió el día adrede.
    const explicit: AppData = { ...d, schedules: d.schedules.map((s) => (s.id === 'salary-old' ? { ...s, endDate: '2026-02-14' } : s.id === 'salary-new' ? { ...s, startDate: '2026-02-15' } : s)) }
    expect(driftedSplits(explicit, TODAY)).toEqual([])
    const ended: AppData = { ...d, schedules: d.schedules.map((s) => (s.id === 'salary-new' ? { ...s, endDate: '2026-03-01' } : s)) }
    expect(driftedSplits(ended, TODAY)).toEqual([])
    expect(driftedSplits(baseData({ schedules: [income('2026-01-31', 300000, { id: 'salary', name: 'Sueldo', frequency: 'monthly' })] }), TODAY)).toEqual([])
  })

  it('una cadena de particiones antiguas (31 → 28-feb → 28-abr) propone la fecha del primer tramo (el 31) para el último', () => {
    const d = audit()
    const chain: AppData = {
      ...d,
      schedules: [
        ...d.schedules.map((s) => (s.id === 'salary-new' ? { ...s, endDate: '2026-04-27' } : s)),
        income('2026-04-28', 330000, { id: 'salary-3', name: 'Sueldo', frequency: 'monthly' }),
      ],
    }
    const found = driftedSplits(chain, '2026-04-20')
    expect(found.map((f) => [f.scheduleId, f.anchor, f.proposed[0]])).toEqual([['salary-3', '2026-01-31', '2026-04-30']])
  })

  it('una partición nueva hecha hoy con la versión corregida no aparece nunca en la revisión', () => {
    const d = baseData({ schedules: [income('2026-01-31', 300000, { id: 'salary', name: 'Sueldo', frequency: 'monthly' })] })
    const r = saveScheduleFrom(d, 'salary', amountOnly(d.schedules[0]!, '2026-02-28', 320000, 'salary-2'), at('2026-02-20'))
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.data.schedules.find((s) => s.id === 'salary-2')?.anchorDate).toBe('2026-01-31')
    expect(driftedSplits(r.data, '2026-03-15')).toEqual([])
  })
})
