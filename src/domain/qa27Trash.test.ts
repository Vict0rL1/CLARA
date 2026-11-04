/**
 * Revisión independiente de seguridad y almacenamiento de la pasada QA27 (F-1, P3): la guarda de QA27-01 (revertir no
 * deja un pago sin su fecha) se podía rodear por la papelera: pagar la fecha corregida → enviar el pago a la papelera →
 * revertir la reparación (permitido: en la papelera no liquida nada) → restaurar el pago, que volvía a apuntar a una
 * fecha que la serie ya no tiene: el 28-mar quedaba otra vez pendiente y el dinero contaba dos veces. Restaurar ahora
 * se rechaza (`occurrenceMissing`) mientras el programado exista sin esa fecha; un programado borrado sigue
 * conservando sus pagos. Datos sintéticos; fechas explícitas.
 */
import { describe, expect, it } from 'vitest'
import { computeBudget } from './budget'
import { recordHistory } from './history'
import { revertEntry } from './historyRevert'
import { deleteSchedule, deleteTransaction, markOccurrence, restoreFromTrash, restoreFromTrashMany, saveTransaction } from './operations'
import { driftedSplits, repairSplit } from './splitRepair'
import type { AppData } from './types'
import { account, baseData, bill, tx } from '../test/fixtures'

const at = (today: string) => ({ today, now: `${today}T12:00:00.000Z` })
const must = <T,>(r: { ok: true; data: AppData; value: T } | { ok: false; issues: unknown }) => {
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r
}
const available = (d: AppData, today: string) => computeBudget(d, today).availableMinor

describe('QA27 · revisión de seguridad F-1 (P3): restaurar desde la papelera no devuelve un pago a una fecha que la serie ya no tiene', () => {
  // «Luz» del 31 (420,00) partida el 28-feb por una versión anterior; enero y febrero pagados; saldo 1 400,00 el 1-mar;
  // horizonte de 7 días. Reparada en el sitio el 20-mar (el 28-feb pagado también es del 31) y el 31-mar pagado el 29-mar.
  const luz = (): AppData => {
    const d = baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 140000, date: '2026-03-01', setAt: '2026-03-01T12:00:00.000Z' } })],
      schedules: [bill('2026-01-31', 42000, { id: 'b1', name: 'Luz', frequency: 'monthly', endDate: '2026-02-27' }), bill('2026-02-28', 42000, { id: 'b2', name: 'Luz', frequency: 'monthly' })],
      transactions: [
        tx({ id: 'p-jan', kind: 'expense', amountMinor: 42000, date: '2026-01-31', categoryId: 'utilities', scheduleId: 'b1', occurrenceDate: '2026-01-31' }),
        tx({ id: 'p-feb', kind: 'expense', amountMinor: 42000, date: '2026-02-28', categoryId: 'utilities', scheduleId: 'b2', occurrenceDate: '2026-02-28' }),
      ],
    })
    return { ...d, settings: { ...d.settings, fallbackHorizonDays: 7 } }
  }
  const repairedAndPaid = () => {
    const d = luz()
    expect(driftedSplits(d, '2026-03-20').map((f) => f.scheduleId)).toEqual(['b2'])
    const r = must(repairSplit(d, 'b2', at('2026-03-20'), 'unused'))
    expect(r.value.id).toBe('b2')
    const repaired = recordHistory(d, r.data, at('2026-03-20').now)
    const repairEntry = repaired.history.at(-1)!
    const p = must(markOccurrence(repaired, { scheduleId: 'b2', occurrenceDate: '2026-03-31', date: '2026-03-29', amountMinor: 42000, txId: 'p-mar' }, at('2026-03-29')))
    const paid = recordHistory(repaired, p.data, at('2026-03-29').now)
    expect(available(paid, '2026-03-29')).toBe(98000)
    return { paid, repairEntry, paymentId: p.value.id }
  }

  it('pagar → papelera → revertir la reparación (permitido) → restaurar: se rechaza con `occurrenceMissing`, nada cambia; tras rehacer la reparación sí se restaura', () => {
    const { paid, repairEntry, paymentId } = repairedAndPaid()
    const trashed = recordHistory(paid, must(deleteTransaction(paid, paymentId, at('2026-03-30'))).data, at('2026-03-30').now)
    // Con el pago en la papelera no hay dependiente: revertir la reparación vuelve a contar el 28-mar.
    const reverted = recordHistory(trashed, must(revertEntry(trashed, repairEntry.id, at('2026-03-30'))).data, at('2026-03-30').now)
    expect(reverted.schedules.find((s) => s.id === 'b2')?.anchorDate).toBeUndefined()
    expect(available(reverted, '2026-03-30')).toBe(98000)
    const r = restoreFromTrash(reverted, paymentId, at('2026-03-30'))
    expect(r.ok ? 'restored' : r.issues).toEqual([{ path: 'id', code: 'occurrenceMissing', params: { date: '2026-03-31', name: 'Luz' } }])
    expect(restoreFromTrashMany(reverted, [paymentId], at('2026-03-30')).ok).toBe(false)
    // Rehacer la reparación (revertir la reversión) devuelve el 31-mar a la serie: ahora sí se restaura y liquida el 31-mar.
    const redone = must(revertEntry(reverted, reverted.history.at(-1)!.id, at('2026-03-30'))).data
    expect(redone.schedules.find((s) => s.id === 'b2')?.anchorDate).toBe('2026-01-31')
    const back = must(restoreFromTrash(redone, paymentId, at('2026-03-30')))
    expect(back.value.tx).toMatchObject({ id: paymentId, scheduleId: 'b2', occurrenceDate: '2026-03-31' })
    expect(available(back.data, '2026-03-30')).toBe(98000)
  })

  it('el estado que la guarda evita: el mismo pago en una serie sin esa fecha deja 560,00 disponibles con 420,00 pagados; con el pago vivo, revertir la reparación ya se rechazaba (QA27-01)', () => {
    const { paid, repairEntry, paymentId } = repairedAndPaid()
    const blocked = revertEntry(paid, repairEntry.id, at('2026-03-30'))
    expect(blocked.ok ? 'reverted' : blocked.issues.map((i) => i.code)).toEqual(['revertDependents'])
    const payment = paid.transactions.find((t) => t.id === paymentId)!
    const legacy = luz()
    const forged: AppData = { ...legacy, transactions: [...legacy.transactions, payment] }
    expect(available(forged, '2026-03-30')).toBe(56000)
  })

  it('un programado borrado conserva sus pagos: eliminar y restaurar ese pago sigue permitido (sin fecha que pueda contar dos veces)', () => {
    const { paid, paymentId } = repairedAndPaid()
    const gone = must(deleteSchedule(paid, 'b2', at('2026-04-01'))).data
    expect(gone.transactions.some((t) => t.id === paymentId)).toBe(true)
    const trashed = must(deleteTransaction(gone, paymentId, at('2026-04-01'))).data
    const back = must(restoreFromTrash(trashed, paymentId, at('2026-04-01')))
    expect(back.value.tx).toMatchObject({ id: paymentId, scheduleId: 'b2', occurrenceDate: '2026-03-31' })
  })

  it('todo o nada: restaurar varios con uno que ya no tiene fecha no restaura ninguno', () => {
    const { paid, repairEntry, paymentId } = repairedAndPaid()
    const extra = must(saveTransaction(paid, { id: 'coffee', kind: 'expense', amountMinor: 350, date: '2026-03-29', accountId: 'main', categoryId: 'groceries', status: 'realized' }, at('2026-03-29'))).data
    const trashedBoth = must(deleteTransaction(must(deleteTransaction(extra, paymentId, at('2026-03-30'))).data, 'coffee', at('2026-03-30'))).data
    const tracked = recordHistory(paid, trashedBoth, at('2026-03-30').now)
    const reverted = must(revertEntry(tracked, repairEntry.id, at('2026-03-30'))).data
    const r = restoreFromTrashMany(reverted, ['coffee', paymentId], at('2026-03-30'))
    expect(r.ok).toBe(false)
    expect(reverted.trash.map((e) => e.id).sort()).toEqual(['coffee', paymentId].sort())
  })
})
