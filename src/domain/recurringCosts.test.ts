import { describe, expect, it } from 'vitest'
import { recurringCosts, recurringWindow } from './recurringCosts'
import { baseData, bill, ctx, income } from '../test/fixtures'

/** Hoy = 2026-09-28; ventana = 2026-09-28 … 2027-09-27 (365 días). */
describe('pagos recurrentes: cuánto cuestan en los próximos 12 meses', () => {
  it('la ventana es de hoy al día antes de la misma fecha dentro de 12 meses', () => {
    expect(recurringWindow('2026-09-28')).toEqual({ from: '2026-09-28', to: '2027-09-27' })
    // 31 de enero → 30 de enero del año siguiente; 29-feb (bisiesto) → 27-feb del siguiente.
    expect(recurringWindow('2027-01-31')).toEqual({ from: '2027-01-31', to: '2028-01-30' })
    expect(recurringWindow('2028-02-29')).toEqual({ from: '2028-02-29', to: '2029-02-27' })
  })

  it('se cuentan las ocurrencias reales del calendario, no «semanal × 52 / 12»', () => {
    const d = baseData({
      schedules: [
        bill('2026-10-05', 1000, { id: 'monthly', name: 'Internet', frequency: 'monthly' }),
        // Semanal desde hoy: días 0, 7, …, 364 de la ventana = 53 veces (no 52).
        bill(ctx.today, 500, { id: 'weekly', name: 'Lavandería', frequency: 'weekly' }),
        bill('2027-03-01', 12000, { id: 'yearly', name: 'Seguro', frequency: 'yearly' }),
        // Dos veces al mes (15 y 31 → último día del mes corto): oct-2026…ago-2027 = 22, más el 15-sep-2027;
        // el 30-sep-2027 queda fuera de la ventana → 23.
        bill('2026-10-15', 300, { id: 'twice', name: 'Gimnasio', frequency: 'semimonthly', secondDay: 31 }),
      ],
    })
    const r = recurringCosts(d, ctx.today)
    const by = Object.fromEntries(r.items.map((i) => [i.schedule.id, [i.occurrences, i.totalMinor]]))
    expect(by).toEqual({ monthly: [12, 12000], weekly: [53, 26500], yearly: [1, 12000], twice: [23, 6900] })
    expect(r.totalMinor).toBe(12000 + 26500 + 12000 + 6900)
    expect(r.monthlyMinor).toBe(Math.floor(57400 / 12))
    // Orden: mayor total primero; a igualdad, por nombre.
    expect(r.items.map((i) => i.schedule.id)).toEqual(['weekly', 'monthly', 'yearly', 'twice'])
  })

  it('respeta fecha de fin, omitidas, inicio en el pasado y el último día del mes', () => {
    const d = baseData({
      schedules: [
        bill('2026-10-05', 1000, { id: 'ends', frequency: 'monthly', endDate: '2026-12-31' }),
        bill('2026-10-05', 1000, { id: 'skips', frequency: 'monthly', skippedDates: ['2026-11-05', '2027-01-05'] }),
        // Empezó el 31-ene: 30-sep, 31-oct, …, 31-ago; el 30-sep-2027 queda fuera de la ventana.
        bill('2026-01-31', 1000, { id: 'past', frequency: 'monthly' }),
      ],
    })
    const by = Object.fromEntries(recurringCosts(d, ctx.today).items.map((i) => [i.schedule.id, i.occurrences]))
    expect(by).toEqual({ ends: 3, skips: 10, past: 12 })
  })

  it('no cuenta pagos únicos, ingresos ni programados en pausa (estos se dicen aparte)', () => {
    const d = baseData({
      schedules: [
        bill('2026-10-05', 1000, { id: 'once', frequency: 'once' }),
        bill('2026-10-05', 1000, { id: 'paused', frequency: 'monthly', paused: true }),
        income('2026-10-01', 150000, { id: 'pay', frequency: 'monthly' }),
        bill('2026-10-05', 2000, { id: 'rent', frequency: 'monthly', amountIsEstimate: true }),
        // Terminó antes de hoy: sin ocurrencias, no aparece.
        bill('2026-01-05', 2000, { id: 'old', frequency: 'monthly', endDate: '2026-06-30' }),
      ],
    })
    const r = recurringCosts(d, ctx.today)
    expect(r.items.map((i) => i.schedule.id)).toEqual(['rent'])
    expect(r.pausedCount).toBe(1)
    expect(r.hasEstimates).toBe(true)
    const incomes = recurringCosts(d, ctx.today, 'income')
    expect(incomes.items.map((i) => [i.schedule.id, i.occurrences, i.totalMinor])).toEqual([['pay', 12, 1_800_000]])
    expect(incomes.monthlyMinor).toBe(150000)
  })

  it('sin programados recurrentes todo es 0 (nunca se divide entre cero)', () => {
    const r = recurringCosts(baseData(), ctx.today)
    expect(r).toMatchObject({ items: [], totalMinor: 0, monthlyMinor: 0, hasEstimates: false, pausedCount: 0 })
  })
})
