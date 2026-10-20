/**
 * Auditoría independiente de seguimiento (cabeza 46fe617, fuentes = d28de42): reproducción y contrato de F-01.
 * Datos sintéticos, fechas fijas. Los artefactos de la auditoría no estaban disponibles: cada caso se reproduce
 * aquí a partir de su descripción.
 */
import { describe, expect, it } from 'vitest'
import { recordHistory, revertEntry } from './history'
import { snoozeInboxItem } from './inbox'
import { saveScheduleFrom } from './scheduleFrom'
import { type ScheduleDraft } from './operations'
import type { AppData, Schedule } from './types'
import { HISTORY_COLLECTIONS, INBOX_ID_MAX, isValidHistoryChangeId, validateHistory } from './validation'
import type { HistoryEntry } from './types'
import { backupText, parseBackup, validateAppData } from '../storage/backup'
import { account, baseData, bill, NOW } from '../test/fixtures'

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

