import { describe, expect, it } from 'vitest'
import { suggestPlanAmount } from './planSuggestion'
import type { Transaction } from './types'
import { account, baseData, ctx, tx } from '../test/fixtures'

/** Hoy = 2026-09-28: el mes en curso (septiembre) nunca cuenta; los completos son junio, julio y agosto. */
const spend = (id: string, date: string, amountMinor: number, categoryId = 'groceries', extra: Partial<Transaction> = {}) => tx({ id, date, amountMinor, categoryId, ...extra })
const history = (aug = 35000) => [
  spend('jun', '2026-06-03', 30000),
  spend('jul', '2026-07-10', 45000),
  tx({ id: 'ref', kind: 'refund', date: '2026-07-12', amountMinor: 5000, categoryId: 'groceries' }),
  spend('aug', '2026-08-20', aug),
  // Lo de este mes no cuenta (el ciclo no ha terminado).
  spend('sep', '2026-09-05', 99900),
  // Otra categoría y una transferencia.
  spend('din', '2026-08-02', 12000, 'dining'),
  tx({ id: 'tr', kind: 'transfer', date: '2026-08-03', amountMinor: 50000, categoryId: undefined, toAccountId: 'main' }),
]
const groceries = { categoryIds: ['groceries'], periodType: 'month' as const }
/** Datos de alguien que empezó a usar Clara (saldo de referencia) en `since`. */
const started = (since: string, transactions: Transaction[]) =>
  baseData({ accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 100000, date: since, setAt: `${since}T12:00:00.000Z` } })], transactions })

describe('sugerir el importe de un límite a partir de lo gastado', () => {
  it('mediana de los 3 meses completos (gasto neto, sin transferencias ni el mes en curso), redondeada hacia arriba', () => {
    const s = suggestPlanAmount(started('2026-06-01', history()), groceries, ctx.today)
    expect(s?.cycles.map((c) => [c.start, c.end, c.spentMinor])).toEqual([
      ['2026-06-01', '2026-06-30', 30000],
      ['2026-07-01', '2026-07-31', 40000],
      ['2026-08-01', '2026-08-31', 35000],
    ])
    expect(s).toMatchObject({ medianMinor: 35000, amountMinor: 35000 })
    // Céntimos: se redondea hacia arriba a un dólar entero (350.50 → 351).
    expect(suggestPlanAmount(started('2026-06-01', history(35050)), groceries, ctx.today)).toMatchObject({ medianMinor: 35050, amountMinor: 35100 })
    // Un mes raro no arrastra la propuesta (mediana, no media).
    expect(suggestPlanAmount(started('2026-06-01', history(300000)), groceries, ctx.today)).toMatchObject({ medianMinor: 40000, amountMinor: 40000 })
  })

  it('sin categorías es todo el gasto; las compras divididas cuentan solo sus líneas', () => {
    const all = suggestPlanAmount(started('2026-06-01', history()), { categoryIds: [], periodType: 'month' }, ctx.today)
    expect(all?.cycles.map((c) => c.spentMinor)).toEqual([30000, 40000, 47000])
    const split = spend('split', '2026-08-25', 10000, 'groceries', {
      splits: [
        { id: 'a', categoryId: 'groceries', amountMinor: 6000 },
        { id: 'b', categoryId: 'dining', amountMinor: 4000 },
      ],
    })
    const s = suggestPlanAmount(started('2026-06-01', [...history(), split]), groceries, ctx.today)
    expect(s?.cycles.at(-1)?.spentMinor).toBe(41000)
  })

  it('solo meses en los que ya se usaba Clara; con menos de 2, no hay sugerencia', () => {
    // Empezó el 5-jul: julio está incompleto, solo cuenta agosto → nada.
    const fromJul = history().filter((t) => t.date >= '2026-07-01')
    expect(suggestPlanAmount(started('2026-07-05', fromJul), groceries, ctx.today)).toBeNull()
    // Empezó el 1-jul: julio y agosto → media de los dos, redondeada hacia arriba.
    expect(suggestPlanAmount(started('2026-07-01', fromJul), groceries, ctx.today)).toMatchObject({ medianMinor: 37500, amountMinor: 37500 })
    // Sin saldo de referencia antiguo, cuenta desde el primer movimiento (3-jun): junio queda fuera.
    expect(suggestPlanAmount(baseData({ transactions: history() }), groceries, ctx.today)?.cycles.map((c) => c.start)).toEqual(['2026-07-01', '2026-08-01'])
    expect(suggestPlanAmount(baseData(), groceries, ctx.today)).toBeNull()
  })

  it('nada que sugerir sin gasto, para un periodo personalizado o «hasta el próximo ingreso»', () => {
    const d = started('2026-06-01', history())
    expect(suggestPlanAmount(d, { categoryIds: ['transport'], periodType: 'month' }, ctx.today)).toBeNull()
    expect(suggestPlanAmount(d, { categoryIds: ['groceries'], periodType: 'custom' }, ctx.today)).toBeNull()
    expect(suggestPlanAmount(d, { categoryIds: ['groceries'], periodType: 'untilIncome' }, ctx.today)).toBeNull()
  })

  it('por semana usa las 3 semanas completas anteriores; en yenes redondea al yen', () => {
    const weeks = [spend('w1', '2026-09-08', 2000), spend('w2', '2026-09-15', 3000), spend('w3', '2026-09-22', 2500), spend('w0', '2026-09-01', 9000)]
    const s = suggestPlanAmount(started('2026-09-01', weeks), { categoryIds: ['groceries'], periodType: 'week' }, ctx.today)
    // Semanas de lunes a domingo: 31-ago empieza antes del primer movimiento (1-sep) y no cuenta.
    expect(s?.cycles.map((c) => [c.start, c.spentMinor])).toEqual([
      ['2026-09-07', 2000],
      ['2026-09-14', 3000],
      ['2026-09-21', 2500],
    ])
    expect(s?.amountMinor).toBe(2500)
    const yen = started('2026-06-01', history().map((t) => ({ ...t, currency: 'JPY' })))
    const jp = suggestPlanAmount({ ...yen, settings: { ...yen.settings, currency: 'JPY' } }, groceries, ctx.today)
    expect(jp).toMatchObject({ medianMinor: 35000, amountMinor: 35000 })
  })
})
