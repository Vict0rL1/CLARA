/**
 * Cota de exactitud (`domain/exactRange.ts`): lo que entra y lo que sale (saldos de referencia, movimientos y papelera)
 * suman como mucho 2⁵³ − 1 cada lado.
 * Lo que la pasaría no se guarda ni se acepta; justo en la cota todo sigue siendo exacto y ninguna pantalla falla.
 * Datos sintéticos (≥ 9 008 movimientos de 10¹²: solo así se alcanza).
 */
import { describe, expect, it } from 'vitest'
import { analysisItems } from './analysis'
import { computeBudget } from './budget'
import { EXACT_RANGE_MAX_MINOR, exceedsExactRange, signedMagnitudes } from './exactRange'
import { heroFigures } from './heroFigures'
import { inboxView } from './inbox'
import { periodSummary } from './insights'
import { MAX_AMOUNT_MINOR } from './money'
import { deleteTransaction, importTransactions, markOccurrence, restoreFromTrash, saveAccount, saveTransaction, updateAccountBalance } from './operations'
import { estimateDailySpend } from './projection'
import { futureBalance, periodStats, statsRange, topMerchants } from './statistics'
import type { AppData } from './types'
import { weeklyReview } from './weeklyReview'
import { backupText, parseBackup, validateAppData } from '../storage/backup'
import { account, baseData, bill, tx } from '../test/fixtures'

const at = (today: string) => ({ today, now: `${today}T12:00:00.000Z` })
const X = MAX_AMOUNT_MINOR // 10¹²
const MAX = EXACT_RANGE_MAX_MINOR // 9 007 199 254 740 991
const REST = MAX - 9007 * X // 199 254 740 991: con 9 007 movimientos de 10¹² y uno de REST la suma es exactamente 2⁵³ − 1
const persisted = (d: AppData): AppData => JSON.parse(JSON.stringify(d)) as AppData

/** 9 007 gastos de 10¹² el 10-oct y uno de `rest` el 11-oct (saldo de referencia 0): magnitud = 9 007 × 10¹² + rest. */
function atTheEdge(rest = REST): AppData {
  return baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 0, date: '2026-08-01', setAt: '2026-08-01T12:00:00.000Z' } })],
    transactions: [
      ...Array.from({ length: 9007 }, (_, i) => tx({ id: `e${i}`, date: '2026-10-10', amountMinor: X, kind: 'expense', status: 'realized', categoryId: 'groceries', merchant: 'Mercado' })),
      tx({ id: 'rest', date: '2026-10-11', amountMinor: rest, kind: 'expense', status: 'realized', categoryId: 'groceries' }),
    ],
  })
}
const TODAY = '2026-10-22'

describe('cota de exactitud · las sumas por lado en coma flotante deciden exactamente en 2⁵³ − 1', () => {
  it('justo en la cota no se pasa; una unidad más sí; un saldo de referencia negativo suma al lado que sale y la papelera cuenta', () => {
    const edge = atTheEdge()
    expect(signedMagnitudes(edge)).toEqual({ inflowMinor: 0, outflowMinor: MAX })
    expect(exceedsExactRange(edge)).toBe(false)
    expect(exceedsExactRange(atTheEdge(REST + 1))).toBe(true)
    const withAnchor: AppData = { ...edge, accounts: [{ ...edge.accounts[0]!, anchor: { ...edge.accounts[0]!.anchor, amountMinor: -1 } }] }
    expect(exceedsExactRange(withAnchor)).toBe(true)
    const positiveAnchor: AppData = { ...edge, accounts: [{ ...edge.accounts[0]!, anchor: { ...edge.accounts[0]!.anchor, amountMinor: X } }] }
    expect(signedMagnitudes(positiveAnchor)).toEqual({ inflowMinor: X, outflowMinor: MAX })
    const trashed = deleteTransaction(edge, 'rest', at(TODAY))
    if (!trashed.ok) throw new Error(JSON.stringify(trashed.issues))
    expect(signedMagnitudes(trashed.data).outflowMinor).toBe(MAX)
  })

  it('cada lado por separado: los 5 000 gastos y 5 000 devoluciones de la auditoría (≈ 4,9 × 10¹⁵ por lado) entran; una transferencia cuenta en los dos lados; un ajuste según su sentido', () => {
    const audit = baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 0, date: '2026-08-01', setAt: '2026-08-01T12:00:00.000Z' } })],
      transactions: [
        ...Array.from({ length: 5000 }, (_, i) => tx({ id: `e${i}`, date: '2026-09-10', amountMinor: 987654321000, kind: 'expense', status: 'realized', categoryId: 'groceries' })),
        ...Array.from({ length: 5000 }, (_, i) => tx({ id: `r${i}`, date: '2026-10-10', amountMinor: 987654321000, kind: 'refund', status: 'realized', categoryId: 'groceries' })),
      ],
    })
    expect(signedMagnitudes(audit)).toEqual({ inflowMinor: 4938271605000000, outflowMinor: 4938271605000000 })
    expect(exceedsExactRange(audit)).toBe(false)
    const mixed = baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 0, date: '2026-08-01', setAt: '2026-08-01T12:00:00.000Z' } }), account({ id: 'save', name: 'Ahorro', includeInBudget: false, anchor: { amountMinor: 0, date: '2026-08-01', setAt: '2026-08-01T12:00:00.000Z' } })],
      transactions: [
        tx({ id: 't', kind: 'transfer', amountMinor: 700, date: '2026-10-10', accountId: 'main', toAccountId: 'save', status: 'realized' }),
        tx({ id: 'up', kind: 'adjustment', adjustmentDirection: 'increase', amountMinor: 50, date: '2026-10-10', accountId: 'main', status: 'realized' }),
        tx({ id: 'down', kind: 'adjustment', adjustmentDirection: 'decrease', amountMinor: 20, date: '2026-10-10', accountId: 'main', status: 'realized' }),
        tx({ id: 'inc', kind: 'income', amountMinor: 1000, date: '2026-10-10', accountId: 'main', status: 'realized', categoryId: 'salary' }),
        tx({ id: 'exp', kind: 'expense', amountMinor: 300, date: '2026-10-10', accountId: 'main', status: 'realized', categoryId: 'groceries' }),
      ],
    })
    expect(signedMagnitudes(mixed)).toEqual({ inflowMinor: 700 + 50 + 1000, outflowMinor: 700 + 20 + 300 })
  })

  it('9 008 gastos de 10¹² (la cifra de las revisiones) pasan de la cota; 9 007 no', () => {
    expect(exceedsExactRange(atTheEdge(X))).toBe(true)
    expect(exceedsExactRange(atTheEdge(0))).toBe(false)
  })
})

describe('cota de exactitud · ninguna operación la cruza y nada cambia al rechazar', () => {
  it('guardar un gasto de 1 unidad justo en la cota se rechaza (`amountsBeyondExactRange`); editar a menos, borrar y restaurar siguen permitidos', () => {
    const edge = atTheEdge()
    const r = saveTransaction(edge, { id: 'one', kind: 'expense', status: 'realized', amountMinor: 1, date: TODAY, accountId: 'main', categoryId: 'groceries' }, at(TODAY))
    expect(r.ok ? 'saved' : r.issues).toEqual([{ path: 'amountMinor', code: 'amountsBeyondExactRange' }])
    expect(JSON.stringify(edge)).toBe(JSON.stringify(atTheEdge()))
    const smaller = saveTransaction(edge, { ...edge.transactions.at(-1)!, amountMinor: REST - 5 }, at(TODAY))
    expect(smaller.ok).toBe(true)
    const deleted = deleteTransaction(edge, 'rest', at(TODAY))
    if (!deleted.ok) throw new Error(JSON.stringify(deleted.issues))
    // En la papelera sigue contando: restaurarlo no cambia la cota y se permite; guardar otro mientras tanto, no.
    expect(saveTransaction(deleted.data, { id: 'one', kind: 'expense', status: 'realized', amountMinor: 1, date: TODAY, accountId: 'main', categoryId: 'groceries' }, at(TODAY)).ok).toBe(false)
    expect(restoreFromTrash(deleted.data, 'rest', at(TODAY)).ok).toBe(true)
  })

  it('marcar pagado, importar del banco (todo o nada), un saldo de referencia negativo y una tarjeta nueva con deuda inicial también se rechazan', () => {
    const edge = { ...atTheEdge(REST - 10), schedules: [bill('2026-10-05', 20, { id: 'b', name: 'Agua', frequency: 'monthly', accountId: 'main' })] }
    expect(exceedsExactRange(edge)).toBe(false)
    const paid = markOccurrence(edge, { scheduleId: 'b', occurrenceDate: '2026-10-05', amountMinor: 20, date: '2026-10-05', txId: 'p' }, at(TODAY))
    expect(paid.ok ? 'paid' : paid.issues.map((i) => i.code)).toEqual(['amountsBeyondExactRange'])
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `row${i}`, kind: 'expense' as const, amountMinor: 5, date: '2026-10-12', accountId: 'main', categoryId: 'groceries', note: `fila ${i}`, importRef: `ref${i}` }))
    const imported = importTransactions(edge, { items: rows, sameDayAlreadyInBalance: false }, at(TODAY))
    expect(imported.ok ? 'imported' : imported.issues.map((i) => [i.path, i.code])).toEqual([['items[2].amountMinor', 'amountsBeyondExactRange']])
    expect(edge.transactions.some((t) => t.id.startsWith('row'))).toBe(false)
    // Un saldo de referencia negativo suma al lado que sale (ya a 10 de la cota); uno positivo va al otro lado y entra.
    const anchor = updateAccountBalance(edge, { accountId: 'main', amountMinor: -11, date: TODAY }, at(TODAY))
    expect(anchor.ok ? 'moved' : anchor.issues.map((i) => i.code)).toEqual(['amountsBeyondExactRange'])
    expect(updateAccountBalance(edge, { accountId: 'main', amountMinor: -10, date: TODAY }, at(TODAY)).ok).toBe(true)
    expect(updateAccountBalance(edge, { accountId: 'main', amountMinor: X, date: TODAY }, at(TODAY)).ok).toBe(true)
    const opened = saveAccount(edge, { id: 'cash', name: 'Efectivo', kind: 'credit', includeInBudget: true, openingBalanceMinor: -11 }, at(TODAY))
    expect(opened.ok ? 'created' : opened.issues).toEqual([{ path: 'openingBalanceMinor', code: 'amountsBeyondExactRange' }])
  })
})

describe('cota de exactitud · importar y cargar', () => {
  it('una copia que pasa de la cota se rechaza con un solo problema; una justo en la cota se acepta y sobrevive al viaje de ida y vuelta', () => {
    const over = validateAppData(persisted(atTheEdge(REST + 1)))
    expect(over.ok ? 'accepted' : over.issues).toEqual([{ path: 'transactions', code: 'amountsBeyondExactRange' }])
    const edge = validateAppData(persisted(atTheEdge()))
    expect(edge.ok).toBe(true)
    const again = parseBackup(backupText(atTheEdge(), new Date(`${TODAY}T12:00:00.000Z`), 'test'))
    expect(again.ok && again.data.transactions.length).toBe(9008)
  })

  it('las cifras de las revisiones (9 200 gastos impares de 987 654 321 001 con sus devoluciones; un saldo de más de 2⁵³) ya no entran', () => {
    const odd = baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 0, date: '2026-08-01', setAt: '2026-08-01T12:00:00.000Z' } })],
      transactions: [
        ...Array.from({ length: 9200 }, (_, i) => tx({ id: `o${i}`, date: '2026-10-10', amountMinor: 987654321001, kind: 'expense', status: 'realized', categoryId: 'groceries' })),
        ...Array.from({ length: 9200 }, (_, i) => tx({ id: `r${i}`, date: '2026-10-12', amountMinor: 987654321001, kind: 'refund', status: 'realized', categoryId: 'groceries' })),
      ],
    })
    expect(validateAppData(persisted(odd)).ok).toBe(false)
    const rich = baseData({ accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: X, date: '2026-08-01', setAt: '2026-08-01T12:00:00.000Z' } })], transactions: Array.from({ length: 9040 }, (_, i) => tx({ id: `i${i}`, date: '2026-10-10', amountMinor: X, kind: 'income', status: 'realized', categoryId: 'salary' })) })
    expect(validateAppData(persisted(rich)).ok).toBe(false)
  })
})

describe('cota de exactitud · con los datos más grandes que entran, todas las cifras son exactas y ninguna pantalla falla', () => {
  it('9 007 × 10¹² + el resto: resumen del periodo, héroe, disponible, Análisis, Estadísticas, Revisión semanal, bandeja, estimación y saldo futuro', () => {
    const edge = atTheEdge()
    const summary = periodSummary(edge, '2026-10-01', '2026-10-31')
    expect(summary.netSpendingMinor).toBe(MAX)
    expect(summary.categories[0]).toMatchObject({ categoryId: 'groceries', spentMinor: MAX, refundedMinor: 0, netMinor: MAX, count: 9008 })
    const budget = computeBudget(edge, TODAY)
    expect(budget.spendableMinor).toBe(-MAX)
    expect(heroFigures(edge, budget, TODAY)).toMatchObject({ expensesMinor: MAX, incomeMinor: 0, availablePct: 0 })
    expect(() => analysisItems(edge, TODAY)).not.toThrow()
    expect(periodStats(edge, 'month', statsRange('month', edge.settings, TODAY)).expensesMinor).toBe(MAX)
    expect(topMerchants(edge, statsRange('month', edge.settings, TODAY))[0]).toMatchObject({ label: 'Mercado', amountMinor: 9007 * X, count: 9007 })
    expect(weeklyReview(edge, '2026-10-19', TODAY).current.spendingMinor).toBe(0)
    expect(() => inboxView(edge, TODAY)).not.toThrow()
    expect(estimateDailySpend(edge, TODAY, 30).totalMinor).toBe(MAX)
    expect(futureBalance(edge, TODAY)).toMatchObject({ enough: false, reason: 'outOfRange' })
  })
})
