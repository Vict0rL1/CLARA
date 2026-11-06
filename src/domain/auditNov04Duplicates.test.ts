/**
 * Auditoría independiente del 2026-11-04 sobre `f8d6da0` (F4 y F5), con datos sintéticos.
 *
 * F4 · trabajo del recorrido de duplicados: 5 000 movimientos iguales el mismo día, con 50 parejas de nota igual entre
 * los 100 primeros y notas únicas después, examinaban 12 497 500 candidatos (≈ 4 s; el tope de 50 nunca se alcanzaba
 * porque ninguna pareja más coincidía). Los candidatos salen ahora de un índice por nota: se examinan solo parejas que
 * coinciden, así que el trabajo queda acotado por las revisadas más el tope por grupo. Mismas parejas, mismo orden,
 * mismos ids y mismas exclusiones que el recorrido de siempre (una referencia cuadrática lo comprueba con ledgers de
 * semilla fija), y el oráculo de progreso de 435 parejas sigue en pie.
 *
 * F5 · lo revisado se recupera: una pareja descartada o pospuesta desaparecía de «Descartados»/«Pospuestos» en cuanto 12
 * movimientos iguales ocho días antes llenaban el tope del grupo (66 parejas > 50) y el recorrido nunca llegaba a
 * ella; recuperarla exigía revisar antes 66 parejas ajenas. Ahora se reconstruye desde la decisión guardada, validando
 * movimientos, pareja, huella y vencimiento; nunca se borra una decisión.
 */
import { describe, expect, it } from 'vitest'
import { daysBetween } from './dates'
import { DUPLICATE_PAIRS_PER_GROUP, DUPLICATE_WINDOW_DAYS, computeInbox, dismissInboxItem, duplicatePairFromDecision, inboxView, possibleDuplicates, scanDuplicates, snoozeInboxItem, undismissInboxItem, unsnoozeInboxItem, type ReviewedPredicate } from './inbox'
import { normalizeText } from './text'
import type { AppData, Transaction } from './types'
import { account, baseData, tx } from '../test/fixtures'

const TODAY = '2026-11-04'
const at = (today: string) => ({ today, now: `${today}T12:00:00.000Z` })
const anchor = (amountMinor: number, date: string) => ({ amountMinor, date, setAt: `${date}T12:00:00.000Z` })
const main = () => account({ id: 'main', name: 'Principal', anchor: anchor(100000, '2026-01-01') })
const persisted = (d: AppData): AppData => JSON.parse(JSON.stringify(d)) as AppData
const ok = <T,>(r: { ok: true; data: AppData; value: T } | { ok: false; issues: unknown[] }): AppData => {
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.data
}
const isoDay = (base: string, offset: number) => {
  const d = new Date(`${base}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
const ids = (pairs: [Transaction, Transaction][]) => pairs.map(([a, b]) => `${a.id}:${b.id}`)

/** La reproducción: 5 000 iguales el mismo día; 50 parejas de nota igual entre los 100 primeros; notas únicas después. */
const fiveThousand = (): AppData =>
  baseData({
    accounts: [main()],
    transactions: Array.from({ length: 5000 }, (_, i) => tx({ id: `t${String(i).padStart(4, '0')}`, date: TODAY, amountMinor: 1000, note: i < 100 ? `nota ${Math.floor(i / 2)}` : `única ${i}` })),
  })

const txKey = (t: Transaction) => [t.kind, t.accountId, t.amountMinor, t.date, normalizeText(t.note ?? '')].join('|')

/**
 * El recorrido de siempre (cuadrático), tal cual estaba, como referencia de parejas, orden y tope; con la huella real de
 * cada pareja y la cuenta de parejas consideradas (dentro de la ventana, notas compatibles, no de la misma ocurrencia),
 * que es exactamente el trabajo que el recorrido indexado debe hacer.
 */
function reference(data: Pick<AppData, 'transactions'>, reviewed?: ReviewedPredicate): { ids: string[]; truncated: boolean; considered: number } {
  const groups = new Map<string, Transaction[]>()
  for (const t of data.transactions) {
    if (t.status !== 'realized' || (t.kind !== 'expense' && t.kind !== 'income' && t.kind !== 'refund')) continue
    const key = `${t.kind}|${t.accountId}|${t.amountMinor}`
    const list = groups.get(key)
    if (list) list.push(t)
    else groups.set(key, [t])
  }
  const out: string[] = []
  let truncated = false
  let considered = 0
  for (const list of groups.values()) {
    if (list.length < 2) continue
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1))
    let unreviewed = 0
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!
        const b = list[j]!
        if (daysBetween(a.date, b.date) > DUPLICATE_WINDOW_DAYS) break
        if (a.scheduleId && a.scheduleId === b.scheduleId) continue
        const na = normalizeText(a.note ?? '')
        const nb = normalizeText(b.note ?? '')
        if (na && nb && na !== nb) continue
        const pair = a.id < b.id ? [a, b] : [b, a]
        const id = `dup:${pair[0]!.id}:${pair[1]!.id}`
        considered++
        if (reviewed?.({ id, fingerprint: `${txKey(pair[0]!)}~${txKey(pair[1]!)}` })) {
          out.push(`${pair[0]!.id}:${pair[1]!.id}`)
          continue
        }
        if (unreviewed >= DUPLICATE_PAIRS_PER_GROUP) {
          truncated = true
          break outer
        }
        out.push(`${pair[0]!.id}:${pair[1]!.id}`)
        unreviewed++
      }
    }
  }
  return { ids: out, truncated, considered }
}

/** Generador determinista (mulberry32). */
const prng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

describe('Auditoría 2026-11-04 · F4: el recorrido de duplicados está acotado', () => {
  it('la reproducción: 5 000 iguales el mismo día con 50 parejas de nota igual → 50 parejas, no truncado y solo 50 candidatos examinados (antes 12 497 500)', () => {
    const scan = scanDuplicates(fiveThousand(), () => false)
    expect(scan.pairs).toHaveLength(50)
    expect(scan.truncated).toBe(false)
    expect(scan.examined).toBe(50)
    expect(ids(scan.pairs).slice(0, 3)).toEqual(['t0000:t0001', 't0002:t0003', 't0004:t0005'])
    // La bandeja entera con esos datos: 50 avisos de duplicado y nada de «hay más».
    const view = inboxView(fiveThousand(), TODAY)
    expect(view.active.filter((i) => i.kind === 'duplicate')).toHaveLength(50)
    expect(view.moreDuplicates).toBe(false)
  })

  it('el trabajo con notas vacías también está acotado: 5 000 sin nota el mismo día → 50 parejas, truncado, 51 examinados; con revisadas, las revisadas más 51', () => {
    const blank = baseData({ accounts: [main()], transactions: Array.from({ length: 5000 }, (_, i) => tx({ id: `b${String(i).padStart(4, '0')}`, date: TODAY, amountMinor: 700 })) })
    const scan = scanDuplicates(blank, () => false)
    expect(scan.pairs).toHaveLength(DUPLICATE_PAIRS_PER_GROUP)
    expect(scan.truncated).toBe(true)
    expect(scan.examined).toBe(DUPLICATE_PAIRS_PER_GROUP + 1)
    // 300 parejas ya revisadas (las primeras del recorrido): se listan sin ocupar sitio y el trabajo es 300 + 51.
    const reviewedIds = new Set<string>()
    const probe = scanDuplicates(blank, (item) => {
      if (reviewedIds.size < 300) reviewedIds.add(item.id)
      return reviewedIds.has(item.id)
    })
    expect(probe.pairs).toHaveLength(300 + DUPLICATE_PAIRS_PER_GROUP)
    expect(probe.truncated).toBe(true)
    expect(probe.examined).toBe(300 + DUPLICATE_PAIRS_PER_GROUP + 1)
  })

  it('mismas parejas, mismo orden, mismos ids y mismo tope que el recorrido de siempre, en ledgers de semilla fija con notas iguales, vacías y distintas, ventana, misma ocurrencia, cuentas y tipos distintos, con y sin revisadas', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = prng(seed)
      const n = 40 + Math.floor(r() * 120)
      const notes = ['', 'Café', 'café', 'Super', 'Luz', 'Taxi']
      const transactions = Array.from({ length: n }, (_, i) => {
        const kind = r() < 0.75 ? 'expense' : r() < 0.5 ? 'income' : 'refund'
        return tx({
          id: `s${seed}-${String(i).padStart(3, '0')}`,
          kind,
          status: r() < 0.9 ? 'realized' : 'planned',
          date: isoDay('2026-10-20', Math.floor(r() * 12)),
          amountMinor: [1000, 1000, 1000, 2500, 700][Math.floor(r() * 5)]!,
          accountId: r() < 0.85 ? 'main' : 'other',
          categoryId: kind === 'income' ? 'salary' : 'groceries',
          note: notes[Math.floor(r() * notes.length)],
          ...(r() < 0.15 ? { scheduleId: r() < 0.5 ? 'r1' : 'r2', occurrenceDate: '2026-10-20' } : {}),
        })
      })
      const d = baseData({ accounts: [main(), account({ id: 'other', name: 'Otra' })], transactions })
      // Revisadas con su huella real, y algunas con una huella que ya no coincide (no cuentan como revisadas).
      const byTx = new Map(d.transactions.map((t) => [t.id, t]))
      const decided = reference(d).ids.filter(() => r() < 0.4).map((s) => {
        const [a, b] = s.split(':').map((id) => byTx.get(id)!) as [Transaction, Transaction]
        return `dup:${s}|${r() < 0.25 ? 'huella vieja' : `${txKey(a)}~${txKey(b)}`}`
      })
      const reviewedSet = new Set(decided)
      const reviewed: ReviewedPredicate = (item) => reviewedSet.has(`${item.id}|${item.fingerprint}`)
      for (const pred of [undefined, reviewed]) {
        const scan = scanDuplicates(d, pred)
        const ref = reference(d, pred)
        expect(ids(scan.pairs), `semilla ${seed}`).toEqual(ref.ids)
        expect(scan.truncated, `semilla ${seed}`).toBe(ref.truncated)
        // El trabajo es exactamente el de las parejas que coinciden: nunca un candidato de otra nota ni de la misma ocurrencia.
        expect(scan.examined, `semilla ${seed}`).toBe(ref.considered)
      }
      expect(ids(possibleDuplicates(d))).toEqual(reference(d).ids)
    }
  })

  it('el oráculo de progreso de 435 parejas: 30 iguales → 435 parejas distintas en 9 tandas de a lo sumo 50, cada id una sola vez y «hay más» hasta la última', () => {
    let d = baseData({ accounts: [main()], transactions: Array.from({ length: 30 }, (_, i) => tx({ id: `o${String(i).padStart(2, '0')}`, date: TODAY, amountMinor: 425, note: 'Café' })) })
    const seen = new Set<string>()
    const rounds: number[] = []
    for (let round = 0; round < 20; round++) {
      const view = inboxView(d, TODAY)
      const active = view.active.filter((i) => i.kind === 'duplicate')
      if (active.length === 0) {
        expect(view.moreDuplicates).toBe(false)
        break
      }
      expect(active.length).toBeLessThanOrEqual(DUPLICATE_PAIRS_PER_GROUP)
      expect(view.moreDuplicates).toBe(round < 8)
      for (const item of active) {
        expect(seen.has(item.id), item.id).toBe(false)
        seen.add(item.id)
        d = ok(dismissInboxItem(d, item, at(TODAY)))
      }
      rounds.push(active.length)
    }
    expect(rounds).toEqual([50, 50, 50, 50, 50, 50, 50, 50, 35])
    expect(seen.size).toBe(435)
    expect(inboxView(d, TODAY).dismissed).toHaveLength(435)
    expect(computeInbox(d, TODAY).filter((i) => i.kind === 'duplicate')).toHaveLength(DUPLICATE_PAIRS_PER_GROUP)
  })

  it('la ventana y las exclusiones siguen: a 3 días sí y a 4 no; nota vacía con cualquiera; misma ocurrencia, otro tipo u otra cuenta nunca; devoluciones entre sí', () => {
    const d = baseData({
      accounts: [main(), account({ id: 'other', name: 'Otra' })],
      transactions: [
        tx({ id: 'a', date: '2026-11-01', amountMinor: 1000, note: 'Café' }),
        tx({ id: 'b', date: '2026-11-04', amountMinor: 1000, note: 'Café' }),
        tx({ id: 'c', date: '2026-11-05', amountMinor: 1000, note: 'Café' }),
        tx({ id: 'd', date: '2026-11-04', amountMinor: 1000 }),
        tx({ id: 'e', date: '2026-11-04', amountMinor: 1000, note: 'Otra cosa' }),
        tx({ id: 'f', date: '2026-11-04', amountMinor: 1000, note: 'Café', accountId: 'other' }),
        tx({ id: 'g', date: '2026-11-04', amountMinor: 1000, note: 'Café', kind: 'income', categoryId: 'salary' }),
        tx({ id: 'h', date: '2026-11-04', amountMinor: 1000, note: 'Café', scheduleId: 'r', occurrenceDate: '2026-11-04' }),
        tx({ id: 'i', date: '2026-11-04', amountMinor: 1000, note: 'Café', scheduleId: 'r', occurrenceDate: '2026-11-04', partialSettlement: true }),
        tx({ id: 'j', date: '2026-11-04', amountMinor: 900, note: 'Devolución', kind: 'refund' }),
        tx({ id: 'k', date: '2026-11-05', amountMinor: 900, note: 'Devolución', kind: 'refund' }),
      ],
    })
    expect(ids(possibleDuplicates(d))).toEqual(reference(d).ids)
    const pairs = ids(possibleDuplicates(d))
    expect(pairs).toContain('a:b')
    expect(pairs).not.toContain('a:c')
    expect(pairs).toContain('b:d')
    expect(pairs).toContain('d:e')
    expect(pairs).not.toContain('b:e')
    expect(pairs).not.toContain('b:f')
    expect(pairs).not.toContain('b:g')
    expect(pairs).not.toContain('h:i')
    expect(pairs).toContain('b:h')
    expect(pairs).toContain('j:k')
  })
})

/** F5: pareja de hoy (p1, p2) con 12 movimientos iguales ocho días antes (66 parejas, más que el tope). */
function crowded(): { data: AppData; item: { id: string; fingerprint: string; canDismiss: boolean } } {
  const pair = [tx({ id: 'p1', date: TODAY, amountMinor: 425, note: 'Café' }), tx({ id: 'p2', date: TODAY, amountMinor: 425, note: 'Café' })]
  const alone = baseData({ accounts: [main()], transactions: pair })
  const item = computeInbox(alone, TODAY).find((i) => i.id === 'dup:p1:p2')!
  const earlier = Array.from({ length: 12 }, (_, i) => tx({ id: `e${String(i).padStart(2, '0')}`, date: isoDay(TODAY, -8), amountMinor: 425, note: 'Café' }))
  return { data: { ...alone, transactions: [...earlier, ...pair] }, item }
}
const dupIds = (items: { id: string }[]) => items.filter((i) => i.id.startsWith('dup:')).map((i) => i.id)

describe('Auditoría 2026-11-04 · F5: lo revisado se recupera aunque el tope del grupo esté lleno', () => {
  it('la reproducción: la pareja descartada sigue en «Descartados» (y tras recargar) aunque el recorrido no llegue a ella; las 66 ajenas no hace falta revisarlas', () => {
    const { data, item } = crowded()
    const dismissed = ok(dismissInboxItem(data, item, at(TODAY)))
    for (const d of [dismissed, persisted(dismissed)]) {
      const view = inboxView(d, TODAY)
      expect(view.moreDuplicates).toBe(true)
      expect(view.active.filter((i) => i.kind === 'duplicate')).toHaveLength(DUPLICATE_PAIRS_PER_GROUP)
      expect(dupIds(view.active)).not.toContain('dup:p1:p2')
      expect(dupIds(view.dismissed)).toEqual(['dup:p1:p2'])
      expect(view.dismissed[0]).toMatchObject({ kind: 'duplicate', reason: 'possibleDuplicate', txIds: ['p1', 'p2'], amountMinor: 425, date: TODAY, fingerprint: item.fingerprint, canDismiss: true })
      // El recorrido de la bandeja en bruto sigue sin llegar a ella (ni falta): la decisión queda guardada tal cual.
      expect(dupIds(computeInbox(d, TODAY))).not.toContain('dup:p1:p2')
      expect(d.inbox.dismissed).toEqual([{ id: 'dup:p1:p2', fingerprint: item.fingerprint, at: `${TODAY}T12:00:00.000Z` }])
    }
  })

  it('pospuesta hasta dentro de una semana: en «Pospuestos» con su fecha; vencida: ya no (vuelve a ser una pareja sin revisar, contada en «hay más»)', () => {
    const { data, item } = crowded()
    const snoozed = ok(snoozeInboxItem(data, item.id, isoDay(TODAY, 7), at(TODAY)))
    const view = inboxView(persisted(snoozed), TODAY)
    expect(view.snoozed.map((i) => [i.id, i.until])).toEqual([['dup:p1:p2', isoDay(TODAY, 7)]])
    expect(dupIds(view.dismissed)).toEqual([])
    const later = inboxView(snoozed, isoDay(TODAY, 7))
    expect(later.snoozed).toEqual([])
    expect(dupIds(later.active)).not.toContain('dup:p1:p2')
    expect(later.moreDuplicates).toBe(true)
    expect(snoozed.inbox.snoozed).toHaveLength(1)
  })

  it('una decisión cuyo movimiento cambió (huella distinta) o se borró no se lista como revisada, y la decisión no se borra', () => {
    const { data, item } = crowded()
    const dismissed = ok(dismissInboxItem(data, item, at(TODAY)))
    const edited = { ...dismissed, transactions: dismissed.transactions.map((t) => (t.id === 'p2' ? { ...t, note: 'Café con leche' } : t)) }
    const v1 = inboxView(edited, TODAY)
    expect(dupIds(v1.dismissed)).toEqual([])
    expect(edited.inbox.dismissed).toHaveLength(1)
    // Con otra nota ya no son pareja (ninguna está vacía y no coinciden): tampoco aparece como activa.
    expect(dupIds(v1.active)).not.toContain('dup:p1:p2')
    const deleted = { ...dismissed, transactions: dismissed.transactions.filter((t) => t.id !== 'p1'), trash: [{ id: 'p1', transaction: dismissed.transactions.find((t) => t.id === 'p1')!, deletedAt: `${TODAY}T13:00:00.000Z`, unlinkedRefundIds: [] }] }
    const v2 = inboxView(deleted, TODAY)
    expect(dupIds(v2.dismissed)).toEqual([])
    expect(deleted.inbox.dismissed).toHaveLength(1)
    // Si cambia solo el importe de los dos (misma huella no: la huella lleva el importe), tampoco se lista.
    const amount = { ...dismissed, transactions: dismissed.transactions.map((t) => (t.id === 'p1' || t.id === 'p2' ? { ...t, amountMinor: 426 } : t)) }
    expect(dupIds(inboxView(amount, TODAY).dismissed)).toEqual([])
  })

  it('«Volver a mostrar» y «Mostrar ahora» quitan la decisión: la pareja vuelve a ser sin revisar (y cuenta en «hay más» mientras el grupo siga lleno)', () => {
    const { data, item } = crowded()
    const dismissed = ok(dismissInboxItem(data, item, at(TODAY)))
    const restored = ok(undismissInboxItem(dismissed, item.id, at(TODAY)))
    expect(restored.inbox.dismissed).toEqual([])
    const view = inboxView(restored, TODAY)
    expect(dupIds(view.dismissed)).toEqual([])
    expect(view.moreDuplicates).toBe(true)
    const snoozed = ok(snoozeInboxItem(data, item.id, isoDay(TODAY, 7), at(TODAY)))
    const shown = ok(unsnoozeInboxItem(snoozed, item.id, at(TODAY)))
    expect(shown.inbox.snoozed).toEqual([])
    expect(inboxView(shown, TODAY).snoozed).toEqual([])
    // Sin las 12 anteriores, la pareja restaurada vuelve a estar activa: nada se perdió.
    const quiet = { ...restored, transactions: restored.transactions.filter((t) => !t.id.startsWith('e')) }
    expect(dupIds(inboxView(quiet, TODAY).active)).toEqual(['dup:p1:p2'])
  })

  it('la reconstrucción desde el id: ids con «:» dentro, decisiones que no son de duplicados o que apuntan a ids inexistentes, y parejas que ya no lo son', () => {
    const a = tx({ id: 'x:1', date: TODAY, amountMinor: 500, note: 'Pan' })
    const b = tx({ id: 'x:2', date: isoDay(TODAY, 3), amountMinor: 500 })
    const c = tx({ id: 'y', date: isoDay(TODAY, 4), amountMinor: 500, note: 'Pan' })
    const byId = new Map([a, b, c].map((t) => [t.id, t]))
    expect(duplicatePairFromDecision('dup:x:1:x:2', byId)?.map((t) => t.id)).toEqual(['x:1', 'x:2'])
    expect(duplicatePairFromDecision('dup:x:1:y', byId)).toBeNull()
    expect(duplicatePairFromDecision('dup:x:2:x:1', byId)).toBeNull()
    expect(duplicatePairFromDecision('dup:x:1:nadie', byId)).toBeNull()
    expect(duplicatePairFromDecision('cat:x:1', byId)).toBeNull()
    expect(duplicatePairFromDecision('dup:', byId)).toBeNull()
    // En la vista: una decisión ajena o rota se ignora sin tocar las demás.
    const { data, item } = crowded()
    const messy = { ...data, inbox: { snoozed: [{ id: 'dup:p1:nadie', until: isoDay(TODAY, 7), at: `${TODAY}T12:00:00.000Z` }], dismissed: [{ id: item.id, fingerprint: item.fingerprint, at: `${TODAY}T12:00:00.000Z` }, { id: 'dup:zz:yy', fingerprint: 'x', at: `${TODAY}T12:00:00.000Z` }] } }
    const view = inboxView(persisted(messy), TODAY)
    expect(dupIds(view.dismissed)).toEqual(['dup:p1:p2'])
    expect(view.snoozed).toEqual([])
  })
})
