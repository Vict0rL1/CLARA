/**
 * Bandeja de pendientes (ver docs/FORMULAS.md §24).
 *
 * Los avisos NO se guardan: se calculan cada vez a partir de los datos, con un id estable
 * (el mismo problema produce siempre el mismo id, así nunca aparece dos veces). Solo se
 * guarda lo que decide la persona:
 *  - Posponer hasta una fecha: el aviso vuelve solo; nunca cambia cifras.
 *  - Descartar («está bien así», «son distintos»): se recuerda junto con una huella de los
 *    datos relevantes; si esos datos cambian, el aviso vuelve a aparecer.
 * Resolver el problema (categorizar, registrar el pago, verificar el saldo…) hace que el
 * aviso deje de calcularse.
 */
import { categoriesForKind } from './categories'
import { addDays, daysBetween, localDateInTimeZone } from './dates'
import { distributionIncomeState } from './incomeDistribution'
import { findSettlement, openItemsUntil, type PlanItem } from './planItems'
import { lastVerified, reconciliationsFor, reconciliationState } from './reconcile'
import { planProgress } from './plans'
import { normalizeText, RULE_PATTERN_MIN, ruleMatchesText } from './rules'
import { cardSummary } from './cards'
import { overstatedAutoConfirms } from './scheduledJobs'
import { goalProgress, goalSavedMinor } from './goals'
import { detectRecurring, type DetectedFrequency } from './recurringDetect'
import type { OpContext, OpResult } from './operations'
import type { AppData, InboxState, LocalDate, Transaction } from './types'

/** `suggestion` (Clara 2.0 fase 3): no es un problema; solo una propuesta que la persona acepta o descarta. */
export type InboxKind = 'uncategorized' | 'overdue' | 'duplicate' | 'balance' | 'attention' | 'integrity' | 'suggestion'

export const INBOX_KINDS: readonly InboxKind[] = ['overdue', 'balance', 'attention', 'duplicate', 'uncategorized', 'integrity', 'suggestion']

export type InboxReason =
  | 'otherCategory'
  | 'overdueExpense'
  | 'overdueIncome'
  | 'possibleDuplicate'
  | 'neverVerified'
  | 'verifiedLongAgo'
  | 'verificationNeedsReview'
  | 'reserveForSettledBill'
  | 'distributionIncomeChanged'
  | 'distributionIncomeMissing'
  | 'cardNearLimit'
  | 'cardOverLimit'
  | 'goalPastDue'
  | 'planOverLimit'
  | 'ruleCategoryUnavailable'
  | 'ruleUnused'
  | 'autoConfirmOverstated'
  | 'recurringCandidate'

export interface InboxItem {
  /** Estable: el mismo problema siempre tiene el mismo id. */
  id: string
  kind: InboxKind
  reason: InboxReason
  /** Datos relevantes: si cambian, un descarte deja de aplicarse. */
  fingerprint: string
  date?: LocalDate
  amountMinor?: number
  txIds?: string[]
  accountId?: string
  goalId?: string
  categoryId?: string
  planId?: string
  ruleId?: string
  distributionId?: string
  planItem?: PlanItem
  /** Fechas para explicar el porqué (p. ej. último movimiento vs. última verificación). */
  lastMovementDate?: LocalDate | null
  verifiedDate?: LocalDate | null
  /** Sugerencias: nombre propuesto, cadencia y cuántas veces se vio. */
  label?: string
  frequency?: DetectedFrequency
  count?: number
  canDismiss: boolean
}

export interface InboxView {
  active: InboxItem[]
  snoozed: (InboxItem & { until: LocalDate })[]
  /** Descartados cuyo motivo sigue igual (se pueden recuperar). */
  dismissed: InboxItem[]
  /** Hay más posibles duplicados sin revisar de los que se muestran: al revisar estos aparecen los siguientes. */
  moreDuplicates: boolean
}

/** Cada cuántos días conviene volver a verificar el saldo de una cuenta. */
export const VERIFY_EVERY_DAYS = 30
/** Ventana para posibles duplicados (mismo importe y cuenta). */
export const DUPLICATE_WINDOW_DAYS = 3
/**
 * Tope de parejas SIN REVISAR por grupo (mismo tipo, cuenta e importe). Más allá no son duplicados sueltos que alguien
 * vaya a revisar uno a uno sino un volcado masivo, y la lista crecía al cuadrado: 5 000 movimientos iguales el mismo
 * día eran 12,5 millones de avisos y la pestaña se quedaba sin memoria (auditoría del 2026-10-29, QA27-03b). Las
 * parejas ya revisadas (descartadas o pospuestas) no ocupan sitio: al revisar las mostradas aparecen las siguientes
 * (auditoría del 2026-11-02, prioridad 2).
 */
export const DUPLICATE_PAIRS_PER_GROUP = 50

const CATCH_ALL = new Set(['other_expense', 'other_income'])

function txKey(t: Transaction): string {
  return [t.kind, t.accountId, t.amountMinor, t.date, normalizeText(t.note ?? '')].join('|')
}

/** v15: un movimiento «Por revisar» ya está arriba de la bandeja con su categoría; aquí no se repite hasta revisarlo. */
function uncategorized(data: AppData): InboxItem[] {
  return data.transactions
    .filter((t) => t.status === 'realized' && (t.kind === 'expense' || t.kind === 'income') && !t.splits?.length && t.categoryId && CATCH_ALL.has(t.categoryId) && !t.review?.needed)
    .map((t) => ({
      id: `cat:${t.id}`,
      kind: 'uncategorized' as const,
      reason: 'otherCategory' as const,
      fingerprint: `${t.categoryId}|${t.amountMinor}|${normalizeText(t.note ?? '')}`,
      date: t.date,
      amountMinor: t.amountMinor,
      txIds: [t.id],
      canDismiss: true,
    }))
}

function overdue(data: AppData, today: LocalDate): InboxItem[] {
  return openItemsUntil(data, today, addDays(today, -1))
    .filter((i) => i.state === 'overdue' && i.direction !== 'transfer')
    .map((i) => ({
      id: `due:${i.key}`,
      kind: 'overdue' as const,
      reason: i.direction === 'income' ? ('overdueIncome' as const) : ('overdueExpense' as const),
      fingerprint: `${i.key}|${i.amountMinor}`,
      date: i.date,
      amountMinor: i.amountMinor,
      planItem: i,
      canDismiss: false,
    }))
}

/** Id estable y huella de una pareja de posibles duplicados (los dos ordenados por id). */
const duplicateIdentity = (a: Transaction, b: Transaction): Pick<InboxItem, 'id' | 'fingerprint'> => ({ id: `dup:${a.id}:${b.id}`, fingerprint: `${txKey(a)}~${txKey(b)}` })

/** ¿La pareja ya se revisó (descartada con la misma huella, o pospuesta hasta después de hoy)? */
export type ReviewedPredicate = (item: Pick<InboxItem, 'id' | 'fingerprint'>) => boolean

export interface DuplicateScan {
  /** Parejas en orden fijo (fecha, id): las sin revisar hasta el tope por grupo y las revisadas que se cruzaron por el camino. */
  pairs: [Transaction, Transaction][]
  /** Algún grupo tiene más parejas sin revisar de las que caben en el tope: la revisión no está completa. */
  truncated: boolean
  /**
   * Trabajo hecho: parejas consideradas (notas compatibles, dentro de la ventana y no de la misma ocurrencia del
   * calendario), revisadas o no, incluida la que declara el tope. Acotado por las parejas ya revisadas más el tope por
   * grupo, nunca por el cuadrado del grupo (auditoría del 2026-11-04, F4); las pruebas lo afirman con cifras exactas en
   * vez de con un cronómetro. Los tramos de movimientos del mismo programado se saltan de una vez (revisión, R6).
   */
  examined: number
}

/**
 * Para una lista de posiciones, el índice del siguiente elemento cuyo programado (`scheduleId`) es distinto: un tramo
 * de cobros o pagos del mismo programado se salta en un solo paso en vez de uno a uno (revisión de la auditoría del
 * 2026-11-04, R6: 3 000 cuotas parciales de una misma factura el mismo día eran 4,5 millones de comparaciones).
 */
function nextOtherSchedule(positions: readonly number[], list: readonly Transaction[]): number[] {
  const next = new Array<number>(positions.length)
  for (let k = positions.length - 1; k >= 0; k--) {
    const here = list[positions[k]!]!.scheduleId
    const after = k + 1 < positions.length ? list[positions[k + 1]!]!.scheduleId : undefined
    next[k] = k + 1 < positions.length && after === here ? next[k + 1]! : k + 1
  }
  return next
}

/** Primer índice de `sorted` (ascendente) con valor mayor que `x`: búsqueda binaria. */
function firstAfter(sorted: readonly number[], x: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid]! > x) hi = mid
    else lo = mid + 1
  }
  return lo
}

/** ¿Pueden ser duplicados? Realizados, del mismo tipo (gasto, ingreso o devolución), cuenta e importe. */
const eligibleForDuplicates = (t: Transaction): boolean => t.status === 'realized' && (t.kind === 'expense' || t.kind === 'income' || t.kind === 'refund')

/**
 * Posibles duplicados: dos movimientos realizados del mismo tipo, cuenta e importe, a
 * ±3 días, cuyas notas coinciden (o alguna falta). Nunca se consideran:
 *  - transferencias (los dos lados son UN registro) ni ajustes de conciliación;
 *  - las líneas de una compra dividida (son el mismo movimiento);
 *  - cobros o pagos de la misma ocurrencia del calendario (parciales deliberados).
 *
 * El recorrido va por grupo (tipo, cuenta e importe) y en orden fijo (fecha, id), así que las parejas y sus ids son
 * siempre los mismos. El tope por grupo cuenta solo parejas SIN revisar: una ya descartada («Son distintos», misma
 * huella) o pospuesta hasta una fecha futura se lista para poder recuperarla pero no ocupa sitio, de modo que revisar
 * las primeras deja ver las siguientes (auditoría del 2026-11-02, prioridad 2: antes el tope se aplicaba antes de
 * descontar lo revisado y 50 parejas antiguas ya descartadas impedían ofrecer una pareja nueva para siempre). Un grupo
 * con más parejas sin revisar que el tope se declara (`truncated`): nunca se da la revisión por completa.
 *
 * Los candidatos de cada movimiento salen de un índice por nota (auditoría del 2026-11-04, F4): con nota, los
 * siguientes con la misma nota y los de nota vacía (mezclados por posición, así el orden es el mismo de siempre); sin
 * nota, todos los siguientes. Solo se examinan parejas que COINCIDEN, de modo que el trabajo queda acotado por las
 * revisadas más el tope por grupo: 5 000 movimientos iguales el mismo día con 50 parejas de nota igual y el resto con
 * notas únicas examinaban 12,5 millones de candidatos (≈ 4 s); ahora examinan 50. Mismas parejas, mismo orden, mismos
 * ids, mismas exclusiones.
 */
export function scanDuplicates(data: Pick<AppData, 'transactions'>, reviewed?: ReviewedPredicate): DuplicateScan {
  const groups = new Map<string, Transaction[]>()
  for (const t of data.transactions) {
    if (!eligibleForDuplicates(t)) continue
    const key = `${t.kind}|${t.accountId}|${t.amountMinor}`
    const list = groups.get(key)
    if (list) list.push(t)
    else groups.set(key, [t])
  }
  const pairs: [Transaction, Transaction][] = []
  let truncated = false
  let examined = 0
  for (const list of groups.values()) {
    if (list.length < 2) continue
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1))
    // La nota se normaliza una vez por movimiento, no una vez por pareja.
    const notes = list.map((t) => normalizeText(t.note ?? ''))
    // Índice: posiciones (ya en orden fecha, id) de cada nota, y las de nota vacía.
    const byNote = new Map<string, number[]>()
    const blank: number[] = []
    notes.forEach((n, i) => {
      if (!n) blank.push(i)
      else {
        const positions = byNote.get(n)
        if (positions) positions.push(i)
        else byNote.set(n, [i])
      }
    })
    // Saltos sobre tramos del mismo programado, por lista de candidatos (todas las posiciones, cada nota, la vacía).
    const all = list.map((_, i) => i)
    const skipAll = nextOtherSchedule(all, list)
    const skipBlank = nextOtherSchedule(blank, list)
    const skipByNote = new Map<string, number[]>()
    let unreviewed = 0
    outer: for (let i = 0; i < list.length; i++) {
      const a = list[i]!
      const na = notes[i]!
      // Candidatos j > i, en orden de posición: misma nota y nota vacía (dos listas ordenadas que se mezclan), o todos
      // los siguientes si `a` no tiene nota (cualquiera coincide).
      const same = na ? byNote.get(na)! : null
      let skipSame: number[] | undefined
      if (same) {
        skipSame = skipByNote.get(na)
        if (!skipSame) {
          skipSame = nextOtherSchedule(same, list)
          skipByNote.set(na, skipSame)
        }
      }
      let p = same ? firstAfter(same, i) : i + 1
      let q = same ? firstAfter(blank, i) : blank.length
      for (;;) {
        let j: number
        // De la misma ocurrencia del calendario (mismo programado): nunca pareja. El tramo entero se salta de una vez;
        // las posiciones son crecientes, así que saltar no adelanta a ningún candidato que tocara antes.
        if (a.scheduleId) {
          if (same === null) {
            if (p < list.length && list[p]!.scheduleId === a.scheduleId) p = skipAll[p]!
          } else {
            if (p < same.length && list[same[p]!]!.scheduleId === a.scheduleId) p = skipSame![p]!
            if (q < blank.length && list[blank[q]!]!.scheduleId === a.scheduleId) q = skipBlank[q]!
          }
        }
        if (same === null) {
          if (p >= list.length) break
          j = p++
        } else {
          const sj = p < same.length ? same[p]! : Number.POSITIVE_INFINITY
          const bj = q < blank.length ? blank[q]! : Number.POSITIVE_INFINITY
          if (sj === Number.POSITIVE_INFINITY && bj === Number.POSITIVE_INFINITY) break
          if (sj < bj) {
            j = sj
            p++
          } else {
            j = bj
            q++
          }
        }
        const b = list[j]!
        if (daysBetween(a.date, b.date) > DUPLICATE_WINDOW_DAYS) break
        // Tras los saltos, `b` nunca es del mismo programado que `a` (cada lista salta su tramo antes de elegir).
        examined++
        const pair: [Transaction, Transaction] = a.id < b.id ? [a, b] : [b, a]
        if (reviewed?.(duplicateIdentity(pair[0], pair[1]))) {
          pairs.push(pair)
          continue
        }
        if (unreviewed >= DUPLICATE_PAIRS_PER_GROUP) {
          truncated = true
          break outer
        }
        pairs.push(pair)
        unreviewed++
      }
    }
  }
  return { pairs, truncated, examined }
}

/**
 * ¿`a` y `b` (con `a.id < b.id`) forman hoy una pareja de posibles duplicados? La misma regla que el recorrido, para
 * reconstruir una pareja ya revisada sin recorrer su grupo (auditoría del 2026-11-04, F5).
 */
function isDuplicatePair(a: Transaction, b: Transaction): boolean {
  if (!(a.id < b.id) || !eligibleForDuplicates(a) || !eligibleForDuplicates(b)) return false
  if (a.kind !== b.kind || a.accountId !== b.accountId || a.amountMinor !== b.amountMinor) return false
  if (Math.abs(daysBetween(a.date, b.date)) > DUPLICATE_WINDOW_DAYS) return false
  if (a.scheduleId && a.scheduleId === b.scheduleId) return false
  const na = normalizeText(a.note ?? '')
  const nb = normalizeText(b.note ?? '')
  return !(na && nb && na !== nb)
}

/**
 * La pareja a la que apunta una decisión guardada (`dup:<a>:<b>`), si los dos movimientos existen y siguen siendo
 * posibles duplicados; `null` si no (se borró o cambió alguno). Los ids de movimiento pueden llevar «:», así que se
 * prueban todas las particiones. Nunca borra la decisión.
 */
export function duplicatePairFromDecision(id: string, byId: ReadonlyMap<string, Transaction>): [Transaction, Transaction] | null {
  if (!id.startsWith('dup:')) return null
  const rest = id.slice(4)
  for (let k = rest.indexOf(':'); k !== -1; k = rest.indexOf(':', k + 1)) {
    const a = byId.get(rest.slice(0, k))
    const b = byId.get(rest.slice(k + 1))
    if (a && b && isDuplicatePair(a, b)) return [a, b]
  }
  return null
}

/** Las parejas con el tope aplicado a todas (sin saber cuáles están revisadas); la bandeja usa `scanDuplicates`. */
export function possibleDuplicates(data: Pick<AppData, 'transactions'>): [Transaction, Transaction][] {
  return scanDuplicates(data).pairs
}

const duplicateItem = (a: Transaction, b: Transaction): InboxItem => ({
  ...duplicateIdentity(a, b),
  kind: 'duplicate',
  reason: 'possibleDuplicate',
  date: a.date > b.date ? a.date : b.date,
  amountMinor: a.amountMinor,
  txIds: [a.id, b.id],
  accountId: a.accountId,
  canDismiss: true,
})

function duplicates(data: AppData, reviewed?: ReviewedPredicate): { items: InboxItem[]; truncated: boolean } {
  const scan = scanDuplicates(data, reviewed)
  return { items: scan.pairs.map(([a, b]) => duplicateItem(a, b)), truncated: scan.truncated }
}

function balances(data: AppData, today: LocalDate): InboxItem[] {
  const items: InboxItem[] = []
  for (const account of data.accounts.filter((a) => !a.archived && (a.includeInBudget || a.kind === 'credit'))) {
    const lastMovementDate = data.transactions
      .filter((t) => t.status === 'realized' && (t.accountId === account.id || t.toAccountId === account.id))
      .reduce<LocalDate | null>((max, t) => (max === null || t.date > max ? t.date : max), null)
    const latest = reconciliationsFor(data, account.id)[0]
    const verified = lastVerified(data, account.id)
    const base = { kind: 'balance' as const, accountId: account.id, lastMovementDate, verifiedDate: verified?.date ?? null, canDismiss: false }
    if (latest && (reconciliationState(data, latest) === 'needsReview' || (latest.resolution === 'unresolved' && reconciliationState(data, latest) === 'ok'))) {
      items.push({ ...base, id: `bal:${account.id}:review`, reason: 'verificationNeedsReview', fingerprint: `${latest.id}|${latest.fingerprint}`, date: latest.date })
    } else if (!verified) {
      items.push({ ...base, id: `bal:${account.id}:never`, reason: 'neverVerified', fingerprint: 'none' })
    } else if (daysBetween(verified.date, today) > VERIFY_EVERY_DAYS) {
      items.push({ ...base, id: `bal:${account.id}:old`, reason: 'verifiedLongAgo', fingerprint: verified.id, date: verified.date })
    }
  }
  return items
}

/** Días sin coincidencias (y de antigüedad mínima) para considerar que una regla no se usa. */
export const RULE_UNUSED_DAYS = 90

/** Uso de la tarjeta a partir del cual se avisa (90 %), comparado con enteros. */
export const CARD_NEAR_LIMIT_PERCENT = 90

/**
 * Atención: tarjetas cerca o por encima del límite y metas cuya fecha pasó sin
 * completarse. Un aviso «cerca del límite» descartado vuelve si se supera el límite.
 */
function attention(data: AppData, today: LocalDate): InboxItem[] {
  const items: InboxItem[] = []
  for (const account of data.accounts.filter((a) => a.kind === 'credit')) {
    const c = cardSummary(data, account, today)
    if (c.limitMinor === null || c.limitMinor <= 0) continue
    const base = { kind: 'attention' as const, accountId: account.id, amountMinor: c.debtMinor }
    if (c.overLimit) {
      items.push({ ...base, id: `card:${account.id}:over`, reason: 'cardOverLimit', fingerprint: 'over', canDismiss: false })
    } else if (c.debtMinor * 100 >= c.limitMinor * CARD_NEAR_LIMIT_PERCENT) {
      items.push({ ...base, id: `card:${account.id}:near`, reason: 'cardNearLimit', fingerprint: `near|${c.limitMinor}`, canDismiss: true })
    }
  }
  for (const g of data.goals) {
    // Los gastos planificados tienen su propio aviso de vencido en Metas.
    if (g.kind === 'expense' || !g.targetDate || g.targetDate >= today) continue
    const remaining = goalProgress(g).remainingMinor
    if (remaining <= 0) continue
    items.push({
      id: `goal:${g.id}:${g.targetDate}`,
      kind: 'attention',
      reason: 'goalPastDue',
      fingerprint: `${g.targetDate}|${g.targetMinor}`,
      date: g.targetDate,
      amountMinor: remaining,
      goalId: g.id,
      canDismiss: true,
    })
  }
  // Planes de gasto superados en su ciclo en curso (mismo cálculo que la pantalla Planes:
  // gasto neto, con las líneas de las compras divididas). Un aviso por plan y ciclo.
  for (const plan of data.plans) {
    if (plan.status !== 'active') continue
    const p = planProgress(data, plan, today)
    if (p.state !== 'over' || !p.cycle) continue
    items.push({
      id: `plan:${plan.id}:${p.cycle.start}`,
      kind: 'attention',
      reason: 'planOverLimit',
      fingerprint: `${p.limitMinor}`,
      date: p.cycle.start,
      amountMinor: p.spentMinor - p.limitMinor,
      planId: plan.id,
      ...(plan.categoryIds.length === 1 ? { categoryId: plan.categoryIds[0] } : {}),
      canDismiss: true,
    })
  }
  items.push(...ruleItems(data, today))
  return items
}

/**
 * Reglas de categoría que no hacen nada:
 *  - su categoría está archivada o ya no existe (la regla se ignora sin avisar);
 *  - llevan al menos 90 días creadas y ningún movimiento realizado de los últimos 90 días
 *    contiene su texto. La fecha de creación (marca de tiempo) se pasa a la zona horaria.
 * Solo se sugiere revisarlas; nunca se borran solas.
 */
function ruleItems(data: AppData, today: LocalDate): InboxItem[] {
  const items: InboxItem[] = []
  const usable = { expense: categoriesForKind('expense', data.categories, { prefs: data.categoryPrefs }), income: categoriesForKind('income', data.categories, { prefs: data.categoryPrefs }) }
  const since = addDays(today, -RULE_UNUSED_DAYS)
  const notes = data.transactions
    .filter((t) => t.status === 'realized' && t.kind !== 'transfer' && t.kind !== 'adjustment' && t.note)
    .map((t) => ({ kind: t.kind === 'income' ? 'income' : 'expense', date: t.date, text: normalizeText(t.note!) }))
  for (const rule of data.categoryRules) {
    const base = { kind: 'attention' as const, ruleId: rule.id, categoryId: rule.categoryId, canDismiss: true }
    if (!usable[rule.kind].includes(rule.categoryId)) {
      items.push({ ...base, id: `rule:${rule.id}:category`, reason: 'ruleCategoryUnavailable', fingerprint: rule.categoryId })
      continue
    }
    const pattern = normalizeText(rule.pattern)
    if (pattern.length < RULE_PATTERN_MIN) continue
    const created = localDateInTimeZone(new Date(rule.createdAt), data.settings.timeZone)
    if (daysBetween(created, today) < RULE_UNUSED_DAYS) continue
    // Mismo criterio que al proponer categorías (texto tal cual o clave de comercio, fase 2).
    const matches = notes.filter((n) => n.kind === rule.kind && ruleMatchesText(n.text, rule.pattern))
    if (matches.some((n) => n.date >= since && n.date <= today)) continue
    const last = matches.reduce<LocalDate | null>((max, n) => (max === null || n.date > max ? n.date : max), null)
    items.push({ ...base, id: `rule:${rule.id}:unused`, reason: 'ruleUnused', fingerprint: `${pattern}|${rule.categoryId}`, lastMovementDate: last })
  }
  return items
}

function integrity(data: AppData): InboxItem[] {
  const items: InboxItem[] = []
  // Un gasto planificado vinculado a un pago que ya se registró sigue con dinero apartado:
  // ese dinero se estaría descontando dos veces (por el pago y por la reserva).
  for (const g of data.goals) {
    const link = g.kind === 'expense' && !g.plan?.paidAt ? g.plan?.link : undefined
    if (!link || g.fundedFrom !== 'budget') continue
    const saved = goalSavedMinor(g)
    const settled = findSettlement(data, link.scheduleId, link.occurrenceDate)
    if (settled && saved > 0) {
      items.push({
        id: `int:goal:${g.id}:${link.occurrenceDate}`,
        kind: 'integrity',
        reason: 'reserveForSettledBill',
        fingerprint: `${settled.id}|${saved}`,
        date: link.occurrenceDate,
        amountMinor: saved,
        goalId: g.id,
        txIds: [settled.id],
        canDismiss: false,
      })
    }
  }
  // QA-02: la confirmación automática registró el importe completo después de un cobro parcial
  // (datos anteriores a la corrección). Se señala el movimiento sobrante; nada se corrige solo.
  for (const o of overstatedAutoConfirms(data)) {
    items.push({
      id: `int:auto:${o.finalTxId}`,
      kind: 'integrity',
      reason: 'autoConfirmOverstated',
      fingerprint: `${o.finalTxId}|${o.excessMinor}|${o.partialTxIds.join(',')}`,
      date: o.occurrenceDate,
      amountMinor: o.excessMinor,
      txIds: [o.finalTxId, ...o.partialTxIds],
      canDismiss: true,
    })
  }
  for (const d of data.incomeDistributions) {
    if (d.undoneAt) continue
    const state = distributionIncomeState(data, d)
    if (state.status === 'ok') continue
    items.push({
      id: `int:dist:${d.id}`,
      kind: 'integrity',
      reason: state.status === 'missing' ? 'distributionIncomeMissing' : 'distributionIncomeChanged',
      fingerprint: state.fingerprint,
      amountMinor: d.incomeAmountMinor,
      distributionId: d.id,
      txIds: [d.incomeTxId],
      canDismiss: true,
    })
  }
  return items
}

/**
 * Pagos que parecen fijos y no están programados (`recurringDetect.ts`). La huella es el propio
 * comercio, importe y cadencia: descartarla la oculta aunque lleguen más pagos iguales.
 */
function suggestions(data: AppData, today: LocalDate): InboxItem[] {
  return detectRecurring(data, today).map((c) => ({
    id: `sug:recurring:${c.key}:${c.amountMinor}:${c.frequency}`,
    kind: 'suggestion',
    reason: 'recurringCandidate',
    fingerprint: `${c.key}|${c.amountMinor}|${c.frequency}`,
    date: c.nextDate,
    amountMinor: c.amountMinor,
    txIds: c.txIds,
    accountId: c.accountId,
    categoryId: c.categoryId,
    label: c.label,
    frequency: c.frequency,
    count: c.dates.length,
    canDismiss: true,
  }))
}

/**
 * Todos los pendientes calculados (sin aplicar posponer/descartar), y si quedan más posibles duplicados de los que
 * caben. `reviewed` solo sirve para que las parejas ya revisadas no ocupen sitio en el tope de duplicados.
 */
export function computeInboxDetailed(data: AppData, today: LocalDate, reviewed?: ReviewedPredicate): { items: InboxItem[]; moreDuplicates: boolean } {
  const dup = duplicates(data, reviewed)
  return {
    items: [...overdue(data, today), ...balances(data, today), ...attention(data, today), ...dup.items, ...uncategorized(data), ...integrity(data), ...suggestions(data, today)],
    moreDuplicates: dup.truncated,
  }
}

/** Todos los pendientes calculados (sin aplicar posponer/descartar). */
export function computeInbox(data: AppData, today: LocalDate, reviewed?: ReviewedPredicate): InboxItem[] {
  return computeInboxDetailed(data, today, reviewed).items
}

/**
 * Parejas de posibles duplicados ya revisadas (descartadas con la misma huella, o pospuestas hasta después de hoy) a las
 * que el recorrido no llegó: se reconstruyen desde las decisiones guardadas, validando que los dos movimientos existen,
 * siguen formando pareja y, si fue un descarte, que la huella sigue igual (auditoría del 2026-11-04, F5: antes una
 * pareja descartada o pospuesta desaparecía de «Descartados»/«Pospuestos» en cuanto 12 movimientos iguales ocho días
 * antes llenaban el tope del grupo, y recuperarla exigía revisar antes 66 parejas ajenas). Orden fijo (fecha, id);
 * una decisión que ya no apunta a nada se ignora aquí y nunca se borra.
 */
function reviewedDuplicatesBeyondScan(
  data: AppData,
  today: LocalDate,
  seen: ReadonlySet<string>,
  dismissedAt: ReadonlyMap<string, string>,
  snoozedUntil: ReadonlyMap<string, LocalDate>,
): InboxItem[] {
  // Desde los mismos mapas con los que la vista clasifica (el último registro de un id manda), así una pareja
  // reconstruida cae siempre en la lista que le corresponde (revisión, R7: con ids repetidos caía en «activos» y el
  // grupo pasaba del tope).
  const decisions = [...[...dismissedAt].map(([id, fingerprint]) => ({ id, fingerprint: fingerprint as string | null })), ...[...snoozedUntil].filter(([, until]) => until > today).map(([id]) => ({ id, fingerprint: null }))]
  const pending = decisions.filter((d) => d.id.startsWith('dup:') && !seen.has(d.id))
  if (pending.length === 0) return []
  const byId = new Map(data.transactions.map((t) => [t.id, t]))
  const out = new Map<string, InboxItem>()
  for (const d of pending) {
    if (out.has(d.id)) continue
    const pair = duplicatePairFromDecision(d.id, byId)
    if (!pair) continue
    const item = duplicateItem(pair[0], pair[1])
    if (d.fingerprint !== null && d.fingerprint !== item.fingerprint) continue
    out.set(item.id, item)
  }
  return [...out.values()].sort((x, y) => (x.date! < y.date! ? -1 : x.date! > y.date! ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
}

export function inboxView(data: AppData, today: LocalDate): InboxView {
  const snoozedUntil = new Map(data.inbox.snoozed.map((s) => [s.id, s.until]))
  const dismissedAt = new Map(data.inbox.dismissed.map((d) => [d.id, d.fingerprint]))
  const reviewed: ReviewedPredicate = (item) => dismissedAt.get(item.id) === item.fingerprint || (snoozedUntil.get(item.id) ?? '') > today
  const computed = computeInboxDetailed(data, today, reviewed)
  const moreDuplicates = computed.moreDuplicates
  // Las reconstruidas van justo después de las parejas del recorrido, en el orden de siempre de los tipos (R8).
  const rebuilt = reviewedDuplicatesBeyondScan(data, today, new Set(computed.items.map((i) => i.id)), dismissedAt, snoozedUntil)
  const after = computed.items.findIndex((i) => i.kind === 'uncategorized' || i.kind === 'integrity' || i.kind === 'suggestion')
  const cut = after === -1 ? computed.items.length : after
  const items = [...computed.items.slice(0, cut), ...rebuilt, ...computed.items.slice(cut)]
  const view: InboxView = { active: [], snoozed: [], dismissed: [], moreDuplicates }
  for (const item of items) {
    if (item.canDismiss && dismissedAt.get(item.id) === item.fingerprint) view.dismissed.push(item)
    else {
      const until = snoozedUntil.get(item.id)
      if (until && until > today) view.snoozed.push({ ...item, until })
      else view.active.push(item)
    }
  }
  return view
}

/* ------------------------------------------------------------------ */
/* Decisiones de la persona (solo cambian `inbox`, nunca cifras)        */
/* ------------------------------------------------------------------ */

const touchInbox = (data: AppData, inbox: InboxState, now: string): AppData => ({ ...data, inbox, updatedAt: now })

/** Pospone hasta `until` (fecha futura). Al llegar esa fecha el aviso vuelve si sigue el problema. */
export function snoozeInboxItem(data: AppData, id: string, until: LocalDate, ctx: OpContext): OpResult<null> {
  if (until <= ctx.today) return { ok: false, issues: [{ path: 'until', code: 'dateInPast' }] }
  const snoozed = [...data.inbox.snoozed.filter((s) => s.id !== id && s.until > ctx.today), { id, until, at: ctx.now }]
  return { ok: true, data: touchInbox(data, { ...data.inbox, snoozed }, ctx.now), value: null }
}

export function unsnoozeInboxItem(data: AppData, id: string, ctx: OpContext): OpResult<null> {
  if (!data.inbox.snoozed.some((s) => s.id === id)) return { ok: true, data, value: null, unchanged: true }
  return { ok: true, data: touchInbox(data, { ...data.inbox, snoozed: data.inbox.snoozed.filter((s) => s.id !== id) }, ctx.now), value: null }
}

/** «Está bien así» / «Son distintos»: se recuerda mientras los datos relevantes no cambien. */
export function dismissInboxItem(data: AppData, item: Pick<InboxItem, 'id' | 'fingerprint' | 'canDismiss'>, ctx: OpContext): OpResult<null> {
  if (!item.canDismiss) return { ok: false, issues: [{ path: 'id', code: 'invalidValue' }] }
  const dismissed = [...data.inbox.dismissed.filter((d) => d.id !== item.id), { id: item.id, fingerprint: item.fingerprint, at: ctx.now }]
  return { ok: true, data: touchInbox(data, { ...data.inbox, dismissed }, ctx.now), value: null }
}

export function undismissInboxItem(data: AppData, id: string, ctx: OpContext): OpResult<null> {
  if (!data.inbox.dismissed.some((d) => d.id === id)) return { ok: true, data, value: null, unchanged: true }
  return { ok: true, data: touchInbox(data, { ...data.inbox, dismissed: data.inbox.dismissed.filter((d) => d.id !== id) }, ctx.now), value: null }
}
