/**
 * Auditoría independiente del 2026-11-02 sobre `420c700` (prioridad 2, regresión): el tope de 50 parejas de posibles
 * duplicados por grupo (QA27-03b) se aplicaba ANTES de descontar lo ya descartado o pospuesto, así que 50 parejas
 * antiguas ya revisadas agotaban el sitio y una pareja nueva del mismo importe y cuenta no se ofrecía nunca (pasaba en
 * `54f9b69`, fallaba en `420c700`). Ahora el tope cuenta solo parejas sin revisar, los ids y huellas no cambian, lo
 * revisado sigue listado para recuperarlo, un grupo con más parejas de las que caben se declara y el recorrido sigue
 * acotado. La completitud se comprueba contra un cálculo independiente de las parejas esperadas. Datos sintéticos.
 */
import { describe, expect, it } from 'vitest'
import { daysBetween } from './dates'
import { DUPLICATE_PAIRS_PER_GROUP, DUPLICATE_WINDOW_DAYS, computeInbox, dismissInboxItem, inboxView, possibleDuplicates, scanDuplicates, snoozeInboxItem } from './inbox'
import { saveTransaction } from './operations'
import { normalizeText } from './text'
import type { AppData, Transaction } from './types'
import { account, baseData, tx } from '../test/fixtures'

const at = (today: string) => ({ today, now: `${today}T12:00:00.000Z` })
const TODAY = '2026-09-28'
const persisted = (d: AppData): AppData => JSON.parse(JSON.stringify(d)) as AppData
const ok = <T,>(r: { ok: true; data: AppData; value: T } | { ok: false; issues: unknown[] }): AppData => {
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.data
}
const main = () => account({ id: 'main', name: 'Principal', anchor: { amountMinor: 100000, date: '2026-01-01', setAt: '2026-01-01T12:00:00.000Z' } })
const isoDay = (base: string, offset: number) => {
  const d = new Date(`${base}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
const activeDup = (d: AppData, today = TODAY) => inboxView(d, today).active.filter((i) => i.kind === 'duplicate').map((i) => i.id)
const dismissAllActive = (d: AppData, today = TODAY): AppData => {
  let next = d
  for (const item of inboxView(next, today).active.filter((i) => i.kind === 'duplicate')) next = ok(dismissInboxItem(next, item, at(today)))
  return next
}

/** 50 parejas históricas de café a 4,25 (cada pareja el mismo día, parejas a cuatro días), todas descartadas con «Son distintos». */
function historical(): AppData {
  const pairs = Array.from({ length: 50 }, (_, k) => [
    tx({ id: `h${String(k).padStart(2, '0')}a`, date: isoDay('2026-01-02', 4 * k), amountMinor: 425, kind: 'expense', status: 'realized', categoryId: 'dining', note: 'Café' }),
    tx({ id: `h${String(k).padStart(2, '0')}b`, date: isoDay('2026-01-02', 4 * k), amountMinor: 425, kind: 'expense', status: 'realized', categoryId: 'dining', note: 'Café' }),
  ]).flat()
  const d = baseData({ accounts: [main()], transactions: pairs })
  expect(activeDup(d)).toHaveLength(50)
  const dismissed = dismissAllActive(d)
  expect(activeDup(dismissed)).toEqual([])
  expect(dismissed.inbox.dismissed).toHaveLength(50)
  return dismissed
}
const newCoffee = (d: AppData, id: string, date = TODAY): AppData =>
  ok(saveTransaction(d, { id, kind: 'expense', status: 'realized', amountMinor: 425, date, accountId: 'main', categoryId: 'dining', note: 'Café' }, at(TODAY)))

describe('Auditoría 2026-11-02 · P2: la revisión de duplicados no se agota con lo ya revisado', () => {
  it('la reproducción: 50 parejas históricas descartadas y dos cafés nuevos de 4,25 el mismo día → la pareja nueva se ofrece (antes: nunca), y «Son distintos» la cierra', () => {
    let d = historical()
    d = newCoffee(newCoffee(d, 'new1'), 'new2')
    expect(d.transactions.filter((t) => t.id.startsWith('new'))).toHaveLength(2)
    const view = inboxView(d, TODAY)
    expect(activeDup(d)).toEqual(['dup:new1:new2'])
    expect(view.moreDuplicates).toBe(false)
    // Lo descartado sigue listado para poder recuperarlo, y nada cambió de id.
    expect(view.dismissed.filter((i) => i.kind === 'duplicate')).toHaveLength(50)
    expect(view.dismissed.every((i) => d.inbox.dismissed.some((x) => x.id === i.id && x.fingerprint === i.fingerprint))).toBe(true)
    // Tras recargar, lo mismo; tras descartar la nueva, nada pendiente.
    expect(activeDup(persisted(d))).toEqual(['dup:new1:new2'])
    const closed = ok(dismissInboxItem(d, view.active.find((i) => i.id === 'dup:new1:new2')!, at(TODAY)))
    expect(activeDup(closed)).toEqual([])
    expect(activeDup(persisted(closed))).toEqual([])
  })

  it('parejas pospuestas tampoco agotan el tope; cuando el aplazamiento vence vuelven a contar', () => {
    const pairs = Array.from({ length: 50 }, (_, k) => [
      tx({ id: `s${String(k).padStart(2, '0')}a`, date: isoDay('2026-01-02', 4 * k), amountMinor: 425, kind: 'expense', status: 'realized', categoryId: 'dining' }),
      tx({ id: `s${String(k).padStart(2, '0')}b`, date: isoDay('2026-01-02', 4 * k), amountMinor: 425, kind: 'expense', status: 'realized', categoryId: 'dining' }),
    ]).flat()
    let d = baseData({ accounts: [main()], transactions: pairs })
    for (const item of inboxView(d, TODAY).active.filter((i) => i.kind === 'duplicate')) d = ok(snoozeInboxItem(d, item.id, '2026-10-05', at(TODAY)))
    expect(inboxView(d, TODAY).snoozed.filter((i) => i.kind === 'duplicate')).toHaveLength(50)
    d = newCoffee(newCoffee(d, 'new1'), 'new2')
    expect(activeDup(d)).toEqual(['dup:new1:new2'])
    // Al vencer los aplazamientos (5-oct), las 50 vuelven a ser activas y la nueva sigue ahí: 51 > 50 ⇒ se declara que hay más.
    const later = inboxView(d, '2026-10-05')
    expect(later.active.filter((i) => i.kind === 'duplicate')).toHaveLength(DUPLICATE_PAIRS_PER_GROUP)
    expect(later.moreDuplicates).toBe(true)
  })

  it('editar un movimiento descartado cambia su huella y la pareja vuelve a preguntar; con nota distinta deja de ser pareja', () => {
    const d = historical()
    const h07b = d.transactions.find((t) => t.id === 'h07b')!
    // Quitar la nota: sigue siendo pareja (una nota vacía no descarta) pero la huella ya no es la descartada.
    const cleared = ok(saveTransaction(d, { ...h07b, note: undefined }, at(TODAY)))
    expect(activeDup(cleared)).toEqual(['dup:h07a:h07b'])
    const renamed = ok(saveTransaction(d, { ...h07b, note: 'Panadería' }, at(TODAY)))
    expect(activeDup(renamed)).toEqual([])
    // Moverla un día la acerca a la pareja siguiente (a 3 días): vuelve a preguntar por ella y por las dos nuevas combinaciones.
    const moved = ok(saveTransaction(d, { ...h07b, date: isoDay(h07b.date, 1) }, at(TODAY)))
    expect(activeDup(moved)).toEqual(['dup:h07a:h07b', 'dup:h07b:h08a', 'dup:h07b:h08b'])
  })

  it('exclusiones intactas: transferencias, ajustes, compras divididas y cuotas parciales de la misma ocurrencia nunca son parejas', () => {
    const d = baseData({
      accounts: [main(), account({ id: 'sav', name: 'Ahorro', includeInBudget: false, anchor: { amountMinor: 0, date: '2026-01-01', setAt: '2026-01-01T12:00:00.000Z' } })],
      transactions: [
        tx({ id: 't1', kind: 'transfer', categoryId: undefined, toAccountId: 'sav', amountMinor: 5000, date: TODAY }),
        tx({ id: 't2', kind: 'transfer', categoryId: undefined, toAccountId: 'sav', amountMinor: 5000, date: TODAY }),
        tx({ id: 'adj1', kind: 'adjustment', categoryId: undefined, amountMinor: 700, date: TODAY }),
        tx({ id: 'adj2', kind: 'adjustment', categoryId: undefined, amountMinor: 700, date: TODAY }),
        tx({ id: 'sp1', amountMinor: 1000, categoryId: 'groceries', date: TODAY, splits: [{ id: 'l1', categoryId: 'groceries', amountMinor: 500 }, { id: 'l2', categoryId: 'dining', amountMinor: 500 }] }),
        tx({ id: 'p1', amountMinor: 5000, date: TODAY, scheduleId: 'r', occurrenceDate: '2026-09-20', partialSettlement: true }),
        tx({ id: 'p2', amountMinor: 5000, date: TODAY, scheduleId: 'r', occurrenceDate: '2026-09-20' }),
      ],
    })
    expect(possibleDuplicates(d)).toEqual([])
    expect(scanDuplicates(d, () => false)).toEqual({ pairs: [], truncated: false })
  })

  it('5 000 gastos y 5 000 devoluciones iguales el mismo día siguen acotados: 50 parejas por grupo, las mismas de siempre, se declara que hay más y tarda menos de un segundo', () => {
    const many = (prefix: string, date: string, kind: 'expense' | 'refund') => Array.from({ length: 5000 }, (_, i) => tx({ id: `${prefix}${String(i).padStart(4, '0')}`, date, amountMinor: 987654321000, kind, status: 'realized', categoryId: 'groceries' }))
    const d = baseData({ accounts: [main()], transactions: [...many('e', '2026-09-10', 'expense'), ...many('r', '2026-10-10', 'refund')] })
    const t0 = performance.now()
    const view = inboxView(d, '2026-10-27')
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(1000)
    expect(view.active.filter((i) => i.kind === 'duplicate')).toHaveLength(2 * DUPLICATE_PAIRS_PER_GROUP)
    expect(view.moreDuplicates).toBe(true)
    expect(possibleDuplicates(d).slice(0, 3).map(([a, b]) => [a.id, b.id])).toEqual([['e0000', 'e0001'], ['e0000', 'e0002'], ['e0000', 'e0003']])
    // Descartar las 50 del primer grupo deja ver las 50 siguientes, distintas, en el mismo tiempo acotado.
    let next = d
    for (const item of view.active.filter((i) => i.kind === 'duplicate' && i.txIds![0]!.startsWith('e'))) next = ok(dismissInboxItem(next, item, at('2026-10-27')))
    const t1 = performance.now()
    const again = inboxView(next, '2026-10-27')
    expect(performance.now() - t1).toBeLessThan(1000)
    const shown = again.active.filter((i) => i.kind === 'duplicate' && i.txIds![0]!.startsWith('e')).map((i) => i.id)
    expect(shown).toHaveLength(DUPLICATE_PAIRS_PER_GROUP)
    expect(shown.some((id) => next.inbox.dismissed.some((x) => x.id === id))).toBe(false)
    expect(again.moreDuplicates).toBe(true)
  })

  describe('completitud frente a un cálculo independiente de las parejas esperadas', () => {
    /** Generador determinista (mulberry32) para que el caso sea reproducible. */
    const rng = (seed: number) => () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    /** Las mismas reglas que la bandeja, escritas aparte y sin tope: todas las parejas de cada grupo, en cualquier orden. */
    const expectedPairs = (transactions: Transaction[]): Set<string> => {
      const out = new Set<string>()
      const eligible = transactions.filter((t) => t.status === 'realized' && (t.kind === 'expense' || t.kind === 'income' || t.kind === 'refund'))
      for (const a of eligible)
        for (const b of eligible) {
          if (a.id >= b.id) continue
          if (a.kind !== b.kind || a.accountId !== b.accountId || a.amountMinor !== b.amountMinor) continue
          if (Math.abs(daysBetween(a.date, b.date)) > DUPLICATE_WINDOW_DAYS) continue
          if (a.scheduleId && a.scheduleId === b.scheduleId) continue
          const na = normalizeText(a.note ?? '')
          const nb = normalizeText(b.note ?? '')
          if (na && nb && na !== nb) continue
          out.add(`dup:${a.id}:${b.id}`)
        }
      return out
    }
    const random = (seed: number, count: number, amounts: number[]): AppData => {
      const r = rng(seed)
      const notes = ['Café', 'cafe', 'Panadería', undefined, undefined]
      const transactions = Array.from({ length: count }, (_, i) =>
        tx({
          id: `r${String(i).padStart(3, '0')}`,
          date: isoDay('2026-09-01', Math.floor(r() * 20)),
          amountMinor: amounts[Math.floor(r() * amounts.length)]!,
          kind: r() < 0.85 ? 'expense' : 'refund',
          status: 'realized',
          categoryId: 'dining',
          accountId: r() < 0.8 ? 'main' : 'cash',
          note: notes[Math.floor(r() * notes.length)],
        }),
      )
      return baseData({ accounts: [main(), account({ id: 'cash', name: 'Efectivo', anchor: { amountMinor: 0, date: '2026-01-01', setAt: '2026-01-01T12:00:00.000Z' } })], transactions })
    }

    it('sin tope alcanzado: lo que ofrece la bandeja es exactamente el conjunto esperado, y tras descartar una parte, exactamente el resto', () => {
      for (const seed of [1, 2, 3]) {
        const d = random(seed, 48, [425, 1200, 999, 7500, 300, 64])
        const expected = expectedPairs(d.transactions)
        expect(expected.size).toBeGreaterThan(5)
        const view = inboxView(d, TODAY)
        expect(view.moreDuplicates).toBe(false)
        expect(new Set(activeDup(d))).toEqual(expected)
        // Descartar una de cada tres (determinista) deja activas exactamente las demás; las descartadas siguen listadas.
        let next = d
        const toDismiss = view.active.filter((i, k) => i.kind === 'duplicate' && k % 3 === 0)
        for (const item of toDismiss) next = ok(dismissInboxItem(next, item, at(TODAY)))
        const after = inboxView(next, TODAY)
        const remaining = new Set([...expected].filter((id) => !toDismiss.some((i) => i.id === id)))
        expect(new Set(activeDup(next))).toEqual(remaining)
        expect(new Set(after.dismissed.map((i) => i.id))).toEqual(new Set(toDismiss.map((i) => i.id)))
        expect(new Set(activeDup(persisted(next)))).toEqual(remaining)
      }
    })

    it('con un grupo que supera el tope (12 iguales el mismo día = 66 parejas): se declara, y revisando por tandas se alcanza cada pareja esperada exactamente una vez', () => {
      const same = Array.from({ length: 12 }, (_, i) => tx({ id: `q${String(i).padStart(2, '0')}`, date: TODAY, amountMinor: 425, kind: 'expense', status: 'realized', categoryId: 'dining' }))
      let d = baseData({ accounts: [main()], transactions: same })
      const expected = expectedPairs(d.transactions)
      expect(expected.size).toBe(66)
      const first = inboxView(d, TODAY)
      expect(first.active.filter((i) => i.kind === 'duplicate')).toHaveLength(DUPLICATE_PAIRS_PER_GROUP)
      expect(first.moreDuplicates).toBe(true)
      const reviewed = new Set<string>()
      for (let round = 0; round < 5; round++) {
        const view = inboxView(d, TODAY)
        const batch = view.active.filter((i) => i.kind === 'duplicate')
        if (batch.length === 0) break
        for (const item of batch) {
          expect(reviewed.has(item.id)).toBe(false)
          reviewed.add(item.id)
          d = ok(dismissInboxItem(d, item, at(TODAY)))
        }
      }
      expect(reviewed).toEqual(expected)
      const done = inboxView(d, TODAY)
      expect(done.active.filter((i) => i.kind === 'duplicate')).toEqual([])
      expect(done.moreDuplicates).toBe(false)
      expect(done.dismissed.filter((i) => i.kind === 'duplicate')).toHaveLength(66)
      // `computeInbox` sin predicado sigue aplicando el tope a todas (lo que se usa para sembrar pruebas), no cambia.
      expect(computeInbox(d, TODAY).filter((i) => i.kind === 'duplicate')).toHaveLength(DUPLICATE_PAIRS_PER_GROUP)
    })
  })
})
