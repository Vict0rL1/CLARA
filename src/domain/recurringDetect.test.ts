import { describe, expect, it } from 'vitest'
import { dismissInboxItem, inboxView } from './inbox'
import { detectRecurring } from './recurringDetect'
import type { Transaction } from './types'
import { baseData, bill, ctx, tx } from '../test/fixtures'

/** Hoy = 2026-09-28. */
const pay = (id: string, date: string, note: string, amountMinor = 1599, extra: Partial<Transaction> = {}) => tx({ id, date, note, amountMinor, categoryId: 'subscriptions', ...extra })
const netflix = (amountMinor = 1599) => [
  pay('n1', '2026-06-15', 'PAYPAL *NETFLIX.COM 4029', amountMinor),
  pay('n2', '2026-07-15', 'NETFLIX.COM 8812', amountMinor),
  pay('n3', '2026-08-15', 'Netflix.com', amountMinor),
  pay('n4', '2026-09-15', 'PAYPAL *NETFLIX.COM 7731', amountMinor),
]

describe('pagos que parecen fijos y no están programados', () => {
  it('cuatro pagos mensuales iguales del mismo comercio (escrito de varias formas) se proponen como «cada mes»', () => {
    const [c, ...rest] = detectRecurring(baseData({ transactions: netflix() }), ctx.today)
    expect(rest).toEqual([])
    expect(c).toMatchObject({ key: 'netflix com', label: 'NETFLIX COM', amountMinor: 1599, frequency: 'monthly', categoryId: 'subscriptions', nextDate: '2026-10-15', txIds: ['n1', 'n2', 'n3', 'n4'] })
  })

  it('cada 2 semanas con 3 pagos; cada semana necesita 4', () => {
    const biweekly = ['2026-08-31', '2026-09-14', '2026-09-28'].map((d, i) => pay(`b${i}`, d, 'Guardería Sol', 25000))
    expect(detectRecurring(baseData({ transactions: biweekly }), ctx.today).map((c) => [c.frequency, c.nextDate])).toEqual([['biweekly', '2026-10-12']])
    const three = ['2026-09-14', '2026-09-21', '2026-09-28'].map((d, i) => pay(`w${i}`, d, 'Clase de yoga', 1500))
    expect(detectRecurring(baseData({ transactions: three }), ctx.today)).toEqual([])
    const four = [pay('w9', '2026-09-07', 'Clase de yoga', 1500), ...three]
    expect(detectRecurring(baseData({ transactions: four }), ctx.today).map((c) => [c.frequency, c.nextDate])).toEqual([['weekly', '2026-10-05']])
  })

  it('no se propone con importes distintos, fechas irregulares, un pago reciente que falta o dos el mismo día', () => {
    const none = (txs: Transaction[]) => expect(detectRecurring(baseData({ transactions: txs }), ctx.today)).toEqual([])
    none([...netflix().slice(0, 2), ...netflix(1699).slice(2)])
    none([pay('i1', '2026-07-01', 'Gimnasio'), pay('i2', '2026-07-20', 'Gimnasio'), pay('i3', '2026-09-15', 'Gimnasio')])
    // Último pago hace 75 días: ya no parece activo.
    none([pay('s1', '2026-05-15', 'Revista'), pay('s2', '2026-06-15', 'Revista'), pay('s3', '2026-07-15', 'Revista')])
    none([pay('d1', '2026-08-15', 'Seguro'), pay('d2', '2026-08-15', 'Seguro'), pay('d3', '2026-09-15', 'Seguro')])
    // Solo números o un texto demasiado corto: no hay comercio que proponer.
    none([pay('x1', '2026-07-15', '4029'), pay('x2', '2026-08-15', '4029'), pay('x3', '2026-09-15', '4029')])
  })

  it('no se propone lo que ya está vinculado a un programado ni lo que ya tiene uno parecido', () => {
    const link = (ids: string[]) => netflix().map((t) => (ids.includes(t.id) ? { ...t, scheduleId: 'sch', occurrenceDate: t.date } : t))
    // El pago vinculado no cuenta; los otros tres siguen siendo mensuales y activos.
    expect(detectRecurring(baseData({ transactions: link(['n1']) }), ctx.today).map((c) => c.txIds)).toEqual([['n2', 'n3', 'n4']])
    // Si el vinculado era el último, lo que queda sin vincular terminó el 15-ago (44 días): ya no parece activo.
    expect(detectRecurring(baseData({ transactions: link(['n4']) }), ctx.today)).toEqual([])
    expect(detectRecurring(baseData({ transactions: link(['n1', 'n2', 'n3', 'n4']) }), ctx.today)).toEqual([])
    const byName = baseData({ transactions: netflix(), schedules: [bill('2026-10-15', 1599, { name: 'Netflix', frequency: 'monthly', categoryId: 'entertainment' })] })
    expect(detectRecurring(byName, ctx.today)).toEqual([])
    const byCategory = baseData({ transactions: netflix(), schedules: [bill('2026-10-15', 1599, { name: 'Streaming', frequency: 'monthly', categoryId: 'subscriptions' })] })
    expect(detectRecurring(byCategory, ctx.today)).toEqual([])
    // Uno que ya terminó no cubre los pagos que siguen llegando.
    const ended = baseData({ transactions: netflix(), schedules: [bill('2026-05-15', 1599, { name: 'Netflix', frequency: 'monthly', endDate: '2026-09-01' })] })
    expect(detectRecurring(ended, ctx.today)).toHaveLength(1)
    // Mismo importe pero otro nombre, otra categoría o un pago único: sí se propone.
    const other = baseData({ transactions: netflix(), schedules: [bill('2026-10-15', 1599, { name: 'Música', frequency: 'once', categoryId: 'subscriptions' })] })
    expect(detectRecurring(other, ctx.today)).toHaveLength(1)
  })

  it('la próxima fecha nunca es anterior a hoy', () => {
    const late = [pay('l1', '2026-06-20', 'Agua'), pay('l2', '2026-07-20', 'Agua'), pay('l3', '2026-08-20', 'Agua')]
    expect(detectRecurring(baseData({ transactions: late }), ctx.today)[0]!.nextDate).toBe('2026-10-20')
  })

  it('en la bandeja es una sugerencia con id estable: descartarla se recuerda aunque llegue otro pago igual', () => {
    const d = baseData({ transactions: netflix() })
    const [item] = inboxView(d, ctx.today).active.filter((i) => i.kind === 'suggestion')
    expect(item).toMatchObject({ id: 'sug:recurring:netflix com:1599:monthly', reason: 'recurringCandidate', label: 'NETFLIX COM', frequency: 'monthly', count: 4, date: '2026-10-15', amountMinor: 1599, canDismiss: true })
    const r = dismissInboxItem(d, item!, ctx)
    if (!r.ok) throw new Error('dismiss')
    const next = { ...r.data, transactions: [...r.data.transactions, pay('n5', '2026-10-15', 'NETFLIX.COM 1100')] }
    const view = inboxView(next, '2026-10-16')
    expect(view.active.filter((i) => i.kind === 'suggestion')).toEqual([])
    expect(view.dismissed.map((i) => i.id)).toEqual(['sug:recurring:netflix com:1599:monthly'])
  })
})
