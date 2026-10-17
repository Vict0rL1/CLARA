/**
 * Operaciones que cambian los datos. Son funciones puras: reciben el estado,
 * devuelven un estado NUEVO (o errores) y nunca tocan el almacenamiento.
 *
 * Idempotencia: cada registro tiene un id generado al abrir el formulario.
 * Guardar dos veces el mismo id actualiza el registro; no crea duplicados.
 */
import { isBudgetAccount } from './balances'
import { computeBudget } from './budget'
import { defaultCollectionsV9, defaultSettingsV9 } from './defaults'
import { addDays, isValidLocalDate } from './dates'
import { goalProgress } from './goals'
import { newId } from './ids'
import { canChangeCurrency } from './currencyChange'
import { isSupportedCurrency, sumMinor } from './money'
import { findSettlement } from './planItems'
import { balanceAtDate, reconciliationFingerprint } from './reconcile'
import { defaultSecondDay } from './recurrence'
import type {
  Account,
  AllocationReason,
  AppData,
  SplitLine,
  CardDetails,
  CategoryRule,
  CurrencyCode,
  CustomCategory,
  Favorite,
  Goal,
  GoalAllocation,
  LocalDate,
  Reconciliation,
  ReconciliationResolution,
  Schedule,
  Settings,
  Timestamp,
  Transaction,
  TrashEntry,
} from './types'
import { SCHEMA_VERSION, type BudgetPeriodType, type TransactionSource } from './types'
import { applyOnboardingCategories } from './categoryOps'
import { defaultOnboardingCategoryIds } from './categories'
import {
  validateAccount,
  validateCategory,
  validateCategoryRule,
  validateFavorite,
  validateGoal,
  validateReconciliation,
  validateSchedule,
  validateSettings,
  validateTransaction,
  type Issue,
} from './validation'

export type OpResult<T = undefined> =
  | { ok: true; data: AppData; value: T; unchanged?: boolean }
  | { ok: false; issues: Issue[] }

export interface OpContext {
  today: LocalDate
  now: Timestamp
}

function fail(issues: Issue[]): { ok: false; issues: Issue[] } {
  return { ok: false, issues }
}

export function touch(data: AppData, now: Timestamp): AppData {
  return { ...data, updatedAt: now }
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id)
  if (idx === -1) return [...list, item]
  const copy = list.slice()
  copy[idx] = item
  return copy
}

/* ------------------------------------------------------------------ */
/* Movimientos                                                         */
/* ------------------------------------------------------------------ */

export type TransactionDraft = Omit<Transaction, 'createdAt' | 'updatedAt' | 'currency' | 'realizedAt' | 'receiptUri'> & {
  /** Foto del recibo (data URL comprimida). `null` quita la existente; ausente la conserva. */
  receiptUri?: string | null
  /**
   * Solo si la fecha coincide con la del saldo de referencia: el movimiento ya
   * estaba incluido en el saldo escrito, así que no debe volver a restarse.
   */
  alreadyInBalance?: boolean
}

function cleanText(value: string | undefined): string | undefined {
  const t = value?.trim()
  return t ? t : undefined
}

/**
 * Crea o actualiza un movimiento. Conserva `createdAt` y, si ya estaba realizado,
 * `realizedAt` (salvo que cambie la marca "ya incluido en el saldo").
 */
export function saveTransaction(data: AppData, draft: TransactionDraft, ctx: OpContext): OpResult<Transaction> {
  // Solo gastos (y devoluciones de compras divididas) se reparten entre categorías.
  if (draft.splits?.length && draft.kind !== 'expense' && draft.kind !== 'refund') return fail([{ path: 'splits', code: 'invalidValue' }])
  const existing = data.transactions.find((t) => t.id === draft.id)
  const account = data.accounts.find((a) => a.id === draft.accountId)
  let realizedAt: Timestamp | undefined
  if (draft.status === 'realized') {
    const anchor = account?.anchor
    const sameDayAsAnchor = !!anchor && draft.date === anchor.date
    const previous = existing?.status === 'realized' ? existing.realizedAt : undefined
    // FIN-01: quien no decide la marca (vincular con un programado, recategorizar en lote, etiquetas,
    // aplazar…) no puede cambiar si el movimiento ya estaba incluido en el saldo escrito. Solo se
    // conserva si siguen iguales la cuenta y la fecha; un `false` explícito (el formulario) sí lo aplica.
    const keptInBalance =
      sameDayAsAnchor &&
      draft.alreadyInBalance === undefined &&
      existing?.status === 'realized' &&
      existing.accountId === draft.accountId &&
      existing.date === draft.date &&
      (existing.realizedAt ?? existing.createdAt) <= anchor.setAt
    if (keptInBalance) {
      realizedAt = previous
    } else if (sameDayAsAnchor && draft.alreadyInBalance) {
      // Ya estaba en el saldo escrito: se fecha en el mismo instante del saldo → no se vuelve a aplicar.
      realizedAt = anchor.setAt
    } else if (sameDayAsAnchor) {
      // Debe aplicarse: el instante tiene que ser posterior al del saldo.
      realizedAt = previous && previous > anchor.setAt ? previous : ctx.now
    } else {
      realizedAt = previous ?? ctx.now
    }
  }
  const tx: Transaction = {
    id: draft.id,
    kind: draft.kind,
    status: draft.status,
    amountMinor: draft.amountMinor,
    currency: data.settings.currency,
    date: draft.date,
    accountId: draft.accountId,
    ...(draft.kind === 'transfer'
      ? { toAccountId: draft.toAccountId }
      : draft.kind === 'adjustment'
        ? {
            adjustmentDirection: draft.adjustmentDirection,
            ...((draft.reconciliationId ?? existing?.reconciliationId) ? { reconciliationId: draft.reconciliationId ?? existing?.reconciliationId } : {}),
          }
        : draft.splits?.length && (draft.kind === 'expense' || draft.kind === 'refund')
          ? { categoryId: draft.splits[0]!.categoryId, splits: draft.splits.map(({ note, ...l }) => (cleanText(note) ? { ...l, note: cleanText(note) } : l)) }
          : { categoryId: draft.categoryId }),
    ...(draft.kind === 'refund' && draft.refundOfId ? { refundOfId: draft.refundOfId } : {}),
    ...(cleanText(draft.note) ? { note: cleanText(draft.note) } : {}),
    // v9: comercio, etiquetas y origen (se conservan al editar si el formulario no los manda).
    ...(cleanText(draft.merchant ?? existing?.merchant) ? { merchant: cleanText(draft.merchant ?? existing?.merchant) } : {}),
    ...((draft.tagIds ?? existing?.tagIds)?.length ? { tagIds: draft.tagIds ?? existing?.tagIds } : {}),
    ...((draft.source ?? existing?.source) ? { source: draft.source ?? existing?.source } : {}),
    ...((draft.favoriteId ?? existing?.favoriteId) ? { favoriteId: draft.favoriteId ?? existing?.favoriteId } : {}),
    ...(draft.receiptUri === null ? {} : (draft.receiptUri ?? existing?.receiptUri) ? { receiptUri: draft.receiptUri ?? existing?.receiptUri } : {}),
    ...(draft.scheduleId ? { scheduleId: draft.scheduleId, occurrenceDate: draft.occurrenceDate } : {}),
    ...(draft.scheduleId && draft.partialSettlement ? { partialSettlement: true } : {}),
    ...(realizedAt ? { realizedAt } : {}),
    // La huella de importación se conserva al editar (evita reimportar la misma fila).
    ...((draft.importRef ?? existing?.importRef) ? { importRef: draft.importRef ?? existing?.importRef } : {}),
    createdAt: existing?.createdAt ?? ctx.now,
    updatedAt: ctx.now,
  }
  const issues = validateTransaction(tx, { data, today: ctx.today })
  if (issues.length) return fail(issues)
  // Una cuenta archivada conserva lo que ya tiene, pero no recibe registros nuevos ni cambios de cuenta hacia ella.
  for (const path of ['accountId', 'toAccountId'] as const) {
    const id = tx[path]
    if (id && id !== existing?.[path] && data.accounts.find((a) => a.id === id)?.archived) return fail([{ path, code: 'accountArchived' }])
  }
  const transactions = upsert(data.transactions, tx)
  // Las devoluciones ya vinculadas deben seguir siendo válidas (importe y reparto por categorías).
  if (existing) {
    const after = { ...data, transactions }
    const broken = transactions.some((r) => r.kind === 'refund' && r.refundOfId === tx.id && validateTransaction(r, { data: after }).length > 0)
    if (broken) return fail([{ path: tx.splits ? 'splits' : 'amountMinor', code: 'refundExceeds', params: { remainingMinor: 0 } }])
  }
  return { ok: true, data: touch({ ...data, transactions }, ctx.now), value: tx }
}

/* ------------------------------------------------------------------ */
/* Papelera                                                            */
/* ------------------------------------------------------------------ */

/** Envía varios movimientos a la papelera en una sola operación (todos o ninguno). */
export function trashTransactions(data: AppData, ids: readonly string[], ctx: OpContext): OpResult<TrashEntry[]> {
  let next = data
  const entries: TrashEntry[] = []
  for (const id of ids) {
    const r = deleteTransaction(next, id, ctx)
    if (!r.ok) return r
    next = r.data
    entries.push(r.value)
  }
  if (entries.length === 0) return fail([{ path: 'ids', code: 'required' }])
  return { ok: true, data: next, value: entries }
}

/* ------------------------------------------------------------------ */

/**
 * Envía un movimiento a la papelera (ver docs/FORMULAS.md §12). Sale de
 * `transactions`, así que deja de contar en saldos, presupuesto, proyección y
 * reportes. Una transferencia es un solo registro: se van sus dos lados a la vez.
 *
 * Las devoluciones vinculadas a un gasto eliminado conservan su importe (el dinero
 * sí volvió) pero pierden el vínculo; se guarda la lista para recuperarlo al restaurar.
 */
export function deleteTransaction(data: AppData, id: string, ctx: OpContext): OpResult<TrashEntry> {
  const tx = data.transactions.find((t) => t.id === id)
  if (!tx) {
    const already = data.trash.find((e) => e.id === id)
    if (already) return { ok: true, data, value: already, unchanged: true }
    return fail([{ path: 'id', code: 'notFound' }])
  }
  const unlinkedRefundIds: string[] = []
  const unlinkedRefundSplits: Record<string, SplitLine[]> = {}
  const transactions = data.transactions
    .filter((t) => t.id !== id)
    .map((t) => {
      if (t.refundOfId !== id) return t
      unlinkedRefundIds.push(t.id)
      // Sin la compra original, el reparto por categorías no se puede comprobar: se guarda aparte.
      if (t.splits?.length) unlinkedRefundSplits[t.id] = t.splits
      const { refundOfId: _removed, splits: _splits, ...rest } = t
      return { ...rest, updatedAt: ctx.now }
    })
  const entry: TrashEntry = {
    id,
    deletedAt: ctx.now,
    transaction: tx,
    unlinkedRefundIds,
    ...(Object.keys(unlinkedRefundSplits).length ? { unlinkedRefundSplits } : {}),
  }
  return {
    ok: true,
    data: touch({ ...data, transactions, trash: [...data.trash.filter((e) => e.id !== id), entry] }, ctx.now),
    value: entry,
  }
}

export interface RestoreResult {
  tx: Transaction
  /** Devoluciones que recuperaron el vínculo con este gasto. */
  relinkedRefundIds: string[]
  /** La devolución restaurada ya no se pudo vincular a su gasto (eliminado o sin saldo por devolver). */
  refundLinkDropped: boolean
}

/**
 * Restaura varios movimientos de la papelera en una sola operación: todo o nada. Si alguno no
 * puede volver (p. ej. su ocurrencia ya se pagó con otro movimiento), no se restaura ninguno.
 */
export function restoreFromTrashMany(data: AppData, ids: readonly string[], ctx: OpContext): OpResult<RestoreResult[]> {
  let next = data
  const values: RestoreResult[] = []
  let unchanged = true
  for (const id of ids) {
    const r = restoreFromTrash(next, id, ctx)
    if (!r.ok) return r
    if (!r.unchanged) unchanged = false
    next = r.data
    values.push(r.value)
  }
  return unchanged ? { ok: true, data, value: values, unchanged: true } : { ok: true, data: next, value: values }
}

/**
 * Restaura un movimiento de la papelera con el mismo id (idempotente).
 *
 * Nunca deja referencias rotas ni cuenta dinero dos veces:
 *  - Si liquidaba un pago del calendario que ya se liquidó con otro movimiento, NO se
 *    restaura (`occurrenceAlreadySettled`): habría dos pagos del mismo recibo.
 *  - Una devolución cuyo gasto ya no existe (o no admite más devoluciones) se
 *    restaura sin vínculo; el dinero devuelto sigue contando.
 *  - Las devoluciones que se desvincularon al eliminarlo se vuelven a vincular si
 *    siguen existiendo, sin vínculo y sin superar el importe del gasto.
 */
export function restoreFromTrash(data: AppData, id: string, ctx: OpContext): OpResult<RestoreResult> {
  const entry = data.trash.find((e) => e.id === id)
  if (!entry) {
    const live = data.transactions.find((t) => t.id === id)
    if (live) return { ok: true, data, value: { tx: live, relinkedRefundIds: [], refundLinkDropped: false }, unchanged: true }
    return fail([{ path: 'id', code: 'notFound' }])
  }
  let tx: Transaction = entry.transaction
  if (data.transactions.some((t) => t.id === tx.id)) return fail([{ path: 'id', code: 'restoreConflict' }])

  if (tx.status === 'realized' && tx.scheduleId && tx.occurrenceDate) {
    const others = data.transactions.filter(
      (t) => t.status === 'realized' && t.scheduleId === tx.scheduleId && t.occurrenceDate === tx.occurrenceDate,
    )
    // Una liquidación final ya existe, o esta era final y ya hay otras: restaurarla duplicaría el pago.
    if (others.some((t) => !t.partialSettlement) || (!tx.partialSettlement && others.length > 0)) {
      return fail([{ path: 'id', code: 'occurrenceAlreadySettled', params: { date: tx.occurrenceDate } }])
    }
  }

  let refundLinkDropped = false
  if (tx.refundOfId) {
    const probe = validateTransaction(tx, { data }).some((i) => i.path === 'refundOfId' || i.path.startsWith('splits') || i.code === 'refundExceeds')
    if (probe) {
      const { refundOfId: _dropped, splits: _splits, ...rest } = tx
      tx = { ...rest, updatedAt: ctx.now }
      refundLinkDropped = true
    }
  }

  const issues = validateTransaction(tx, { data })
  if (issues.length) return fail(issues)

  // Vuelve a vincular devoluciones, sin superar el importe del gasto restaurado.
  const relinkedRefundIds: string[] = []
  let refundedSoFar = 0
  const transactions = data.transactions.map((t) => {
    if (tx.kind !== 'expense' || !entry.unlinkedRefundIds.includes(t.id)) return t
    if (t.kind !== 'refund' || t.refundOfId !== undefined || refundedSoFar + t.amountMinor > tx.amountMinor) return t
    refundedSoFar += t.amountMinor
    relinkedRefundIds.push(t.id)
    // Recupera su reparto por categorías si sigue siendo coherente con la compra.
    const splits = entry.unlinkedRefundSplits?.[t.id]
    const relinked: Transaction = { ...t, refundOfId: tx.id, updatedAt: ctx.now }
    if (splits && tx.splits?.length && t.categoryId === splits[0]!.categoryId) {
      const withSplits = { ...relinked, splits }
      if (validateTransaction(withSplits, { data: { ...data, transactions: [...data.transactions, tx] } }).length === 0) return withSplits
    }
    return relinked
  })

  return {
    ok: true,
    data: touch({ ...data, transactions: [...transactions, tx], trash: data.trash.filter((e) => e.id !== id) }, ctx.now),
    value: { tx, relinkedRefundIds, refundLinkDropped },
  }
}

/**
 * Elimina definitivamente de la papelera (uno, varios o todos). Solo se conserva la
 * huella de importación (sin importes ni descripciones) para que reimportar el mismo
 * CSV ofrezca esas filas desmarcadas en vez de volver a crearlas sin avisar.
 */
export function purgeTrash(data: AppData, ids: string[] | 'all', ctx: OpContext): OpResult<{ purged: number }> {
  const selected = ids === 'all' ? data.trash : data.trash.filter((e) => ids.includes(e.id))
  if (selected.length === 0) return { ok: true, data, value: { purged: 0 }, unchanged: true }
  const purgedIds = new Set(selected.map((e) => e.id))
  const refs = new Set(data.purgedImportRefs)
  for (const e of selected) if (e.transaction.importRef) refs.add(e.transaction.importRef)
  return {
    ok: true,
    data: touch(
      {
        ...data,
        trash: data.trash.filter((e) => !purgedIds.has(e.id)),
        purgedImportRefs: [...refs],
        // Lo eliminado definitivamente deja de figurar en los presupuestos por periodo.
        periodBudgets: data.periodBudgets.map((b) => (b.txIds.some((t) => purgedIds.has(t)) ? { ...b, txIds: b.txIds.filter((t) => !purgedIds.has(t)) } : b)),
      },
      ctx.now,
    ),
    value: { purged: selected.length },
  }
}

/** Deshacer una edición: vuelve a dejar exactamente la versión anterior del registro. */
export function revertTransaction(data: AppData, previous: Transaction, ctx: OpContext): OpResult<Transaction> {
  return { ok: true, data: touch({ ...data, transactions: upsert(data.transactions, previous) }, ctx.now), value: previous }
}

/** Convierte un movimiento previsto en realizado (sin crear otro registro). */
export function realizePlanned(
  data: AppData,
  id: string,
  input: { date: LocalDate; amountMinor?: number; alreadyInBalance?: boolean },
  ctx: OpContext,
): OpResult<Transaction> {
  const tx = data.transactions.find((t) => t.id === id)
  if (!tx) return fail([{ path: 'id', code: 'notFound' }])
  if (tx.status === 'realized') return { ok: true, data, value: tx, unchanged: true }
  return saveTransaction(
    data,
    { ...tx, status: 'realized', date: input.date, amountMinor: input.amountMinor ?? tx.amountMinor, alreadyInBalance: input.alreadyInBalance },
    ctx,
  )
}

export interface ImportInput {
  /** Ids generados al abrir la vista previa: confirmar dos veces no duplica. */
  items: (Pick<Transaction, 'id' | 'kind' | 'amountMinor' | 'date' | 'accountId' | 'categoryId' | 'note' | 'scheduleId' | 'occurrenceDate'> & { importRef: string })[]
  /** Filas del mismo día que el saldo de referencia: ¿ya estaban incluidas en él? */
  sameDayAlreadyInBalance: boolean
}

/**
 * Importa movimientos realizados de un archivo del banco. Todo o nada: si una fila
 * no es válida, no se aplica ninguna. Las filas cuya huella ya existe (en movimientos
 * o en la papelera) se omiten. Las huellas eliminadas definitivamente solo se importan
 * si la interfaz las envía (la persona las marcó a propósito).
 */
export function importTransactions(data: AppData, input: ImportInput, ctx: OpContext): OpResult<{ ids: string[] }> {
  let next = data
  const ids: string[] = []
  const issues: Issue[] = []
  // Las filas cuyo movimiento está en la papelera nunca se reimportan: se restauran desde la papelera.
  const refs = new Set([...data.transactions.map((t) => t.importRef), ...data.trash.map((e) => e.transaction.importRef)].filter(Boolean))
  input.items.forEach((item, i) => {
    if (refs.has(item.importRef) || next.transactions.some((t) => t.id === item.id)) return
    refs.add(item.importRef)
    const r = saveTransaction(next, { ...item, status: 'realized', alreadyInBalance: input.sameDayAlreadyInBalance }, ctx)
    if (!r.ok) {
      issues.push(...r.issues.map((issue) => ({ ...issue, path: `items[${i}].${issue.path}` })))
      return
    }
    next = r.data
    ids.push(item.id)
  })
  if (issues.length) return fail(issues)
  if (!ids.length) return { ok: true, data, value: { ids }, unchanged: true }
  return { ok: true, data: next, value: { ids } }
}

/** Deshacer una importación: quita exactamente los movimientos creados. */
export function removeTransactions(data: AppData, ids: string[], ctx: OpContext): OpResult<{ removed: number }> {
  const set = new Set(ids)
  const transactions = data.transactions.filter((t) => !set.has(t.id))
  const removed = data.transactions.length - transactions.length
  if (!removed) return { ok: true, data, value: { removed }, unchanged: true }
  return { ok: true, data: touch({ ...data, transactions }, ctx.now), value: { removed } }
}

/* ------------------------------------------------------------------ */
/* Pagos e ingresos programados                                        */
/* ------------------------------------------------------------------ */

export type ScheduleDraft = Omit<Schedule, 'createdAt' | 'updatedAt' | 'currency' | 'skippedDates'> & { skippedDates?: LocalDate[] }

export function saveSchedule(data: AppData, draft: ScheduleDraft, ctx: OpContext): OpResult<Schedule> {
  const existing = data.schedules.find((s) => s.id === draft.id)
  const schedule: Schedule = {
    id: draft.id,
    name: draft.name.trim(),
    kind: draft.kind,
    amountMinor: draft.amountMinor,
    amountIsEstimate: draft.amountIsEstimate,
    // El rango se valida también si llega en un gasto (y se rechaza): no se descarta en silencio.
    ...(draft.range ? { range: { minMinor: draft.range.minMinor, extraMinor: draft.range.extraMinor } } : {}),
    currency: data.settings.currency,
    accountId: draft.accountId,
    categoryId: draft.categoryId,
    frequency: draft.frequency,
    // v9: intervalo personalizado, confirmación automática y pausa (el formulario los manda explícitos).
    ...(draft.frequency === 'custom' && draft.intervalDays !== undefined ? { intervalDays: draft.intervalDays } : {}),
    // v13: dos veces al mes; sin segundo día explícito, 15 días después (o antes) del primero.
    ...(draft.frequency === 'semimonthly' ? { secondDay: draft.secondDay ?? defaultSecondDay(draft.anchorDate ?? draft.startDate) } : {}),
    // v14: la fecha que fija la serie cuando `startDate` es solo el límite (un tramo partido sin cambiar la regla).
    ...(draft.frequency !== 'once' && draft.anchorDate && draft.anchorDate !== draft.startDate ? { anchorDate: draft.anchorDate } : {}),
    ...(draft.autoConfirm ? { autoConfirm: true } : {}),
    ...(draft.paused ? { paused: true } : {}),
    startDate: draft.startDate,
    ...(draft.frequency !== 'once' && draft.endDate ? { endDate: draft.endDate } : {}),
    reminderDaysBefore: draft.reminderDaysBefore,
    skippedDates: draft.skippedDates ?? existing?.skippedDates ?? [],
    ...(cleanText(draft.note) ? { note: cleanText(draft.note) } : {}),
    createdAt: existing?.createdAt ?? ctx.now,
    updatedAt: ctx.now,
  }
  const issues = validateSchedule(schedule, { data })
  if (issues.length) return fail(issues)
  if (schedule.accountId !== existing?.accountId && data.accounts.find((a) => a.id === schedule.accountId)?.archived) {
    return fail([{ path: 'accountId', code: 'accountArchived' }])
  }
  return { ok: true, data: touch({ ...data, schedules: upsert(data.schedules, schedule) }, ctx.now), value: schedule }
}

export function deleteSchedule(data: AppData, id: string, ctx: OpContext): OpResult<Schedule> {
  const schedule = data.schedules.find((s) => s.id === id)
  if (!schedule) return fail([{ path: 'id', code: 'notFound' }])
  // Los movimientos ya realizados se conservan: son historia real. Los gastos planificados
  // vinculados pierden el vínculo (siguen con su fecha y su dinero apartado).
  const goals = data.goals.map((g) => {
    if (g.plan?.link?.scheduleId !== id) return g
    const { link: _removed, ...plan } = g.plan
    return { ...g, plan, updatedAt: ctx.now }
  })
  return { ok: true, data: touch({ ...data, schedules: data.schedules.filter((s) => s.id !== id), goals }, ctx.now), value: schedule }
}

export function restoreSchedule(data: AppData, schedule: Schedule, ctx: OpContext): OpResult<Schedule> {
  if (data.schedules.some((s) => s.id === schedule.id)) return { ok: true, data, value: schedule, unchanged: true }
  return { ok: true, data: touch({ ...data, schedules: [...data.schedules, schedule] }, ctx.now), value: schedule }
}

export interface MarkOccurrenceInput {
  scheduleId: string
  occurrenceDate: LocalDate
  /** Importe real (puede diferir del previsto). */
  amountMinor: number
  /** Fecha real del pago/cobro (no futura). */
  date: LocalDate
  accountId?: string
  alreadyInBalance?: boolean
  /** Id generado al abrir el diálogo, para que un doble clic no duplique. */
  txId?: string
  /**
   * Cobro o pago PARCIAL: el importe es menor que lo que falta y todavía se espera el
   * resto (la ocurrencia sigue abierta por la diferencia). Si es `false` o no se
   * indica, la ocurrencia se da por terminada con el importe real.
   */
  expectRemainder?: boolean
  /** Desde el formulario de movimientos: categoría y nota elegidas (por defecto, las del programado). */
  categoryId?: string
  note?: string
  /** Origen del registro (`scheduled` cuando lo confirma la app sola). */
  source?: TransactionSource
}

/** Lo que falta por recibir o pagar de una ocurrencia (esperado − parciales ya registrados). */
export function occurrenceRemaining(data: AppData, scheduleId: string, occurrenceDate: LocalDate): number {
  const schedule = data.schedules.find((s) => s.id === scheduleId)
  if (!schedule) return 0
  const partials = data.transactions.filter(
    (t) => t.status === 'realized' && t.scheduleId === scheduleId && t.occurrenceDate === occurrenceDate && t.partialSettlement,
  )
  return Math.max(0, schedule.amountMinor - sumMinor(partials.map((t) => t.amountMinor)))
}

/**
 * Marca una ocurrencia como pagada/recibida creando UN movimiento realizado
 * vinculado. Si ya está cerrada, no hace nada: nunca se descuenta dos veces.
 * Un cobro parcial (`expectRemainder`) deja la ocurrencia abierta por la diferencia.
 */
export function markOccurrence(data: AppData, input: MarkOccurrenceInput, ctx: OpContext): OpResult<Transaction> {
  const schedule = data.schedules.find((s) => s.id === input.scheduleId)
  if (!schedule) return fail([{ path: 'scheduleId', code: 'notFound' }])
  const existing = findSettlement(data, input.scheduleId, input.occurrenceDate)
  if (existing) return { ok: true, data, value: existing, unchanged: true }
  const byId = input.txId ? data.transactions.find((t) => t.id === input.txId) : undefined
  if (byId) return { ok: true, data, value: byId, unchanged: true }
  if (input.expectRemainder && input.amountMinor >= occurrenceRemaining(data, input.scheduleId, input.occurrenceDate)) {
    // Si llega todo lo que faltaba (o más), no queda nada pendiente: no puede ser parcial.
    return fail([{ path: 'expectRemainder', code: 'invalidValue' }])
  }
  const withoutSkip = schedule.skippedDates.includes(input.occurrenceDate)
    ? { ...data, schedules: upsert(data.schedules, { ...schedule, skippedDates: schedule.skippedDates.filter((d) => d !== input.occurrenceDate) }) }
    : data
  return saveTransaction(
    withoutSkip,
    {
      id: input.txId ?? newId(),
      kind: schedule.kind,
      status: 'realized',
      amountMinor: input.amountMinor,
      date: input.date,
      accountId: input.accountId ?? schedule.accountId,
      categoryId: input.categoryId ?? schedule.categoryId,
      note: input.note?.trim() ? input.note : schedule.name,
      scheduleId: schedule.id,
      occurrenceDate: input.occurrenceDate,
      ...(input.expectRemainder ? { partialSettlement: true } : {}),
      ...(input.source ? { source: input.source } : {}),
      alreadyInBalance: input.alreadyInBalance,
    },
    ctx,
  )
}

/**
 * Da por terminada una ocurrencia con cobros parciales sin esperar el resto: el último
 * parcial pasa a ser la liquidación final (no se crea ningún movimiento nuevo).
 */
export function closeOccurrence(data: AppData, scheduleId: string, occurrenceDate: LocalDate, ctx: OpContext): OpResult<Transaction> {
  if (findSettlement(data, scheduleId, occurrenceDate)) {
    return { ok: true, data, value: findSettlement(data, scheduleId, occurrenceDate)!, unchanged: true }
  }
  const partials = data.transactions
    .filter((t) => t.status === 'realized' && t.scheduleId === scheduleId && t.occurrenceDate === occurrenceDate && t.partialSettlement)
    .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? -1 : 1) : a.date < b.date ? -1 : 1))
  const last = partials[partials.length - 1]
  if (!last) return fail([{ path: 'occurrenceDate', code: 'notFound' }])
  const { partialSettlement: _closed, ...rest } = last
  const closed: Transaction = { ...rest, updatedAt: ctx.now }
  return { ok: true, data: touch({ ...data, transactions: upsert(data.transactions, closed) }, ctx.now), value: closed }
}

export function setOccurrenceSkipped(data: AppData, scheduleId: string, date: LocalDate, skipped: boolean, ctx: OpContext): OpResult<Schedule> {
  const schedule = data.schedules.find((s) => s.id === scheduleId)
  if (!schedule) return fail([{ path: 'scheduleId', code: 'notFound' }])
  if (!isValidLocalDate(date)) return fail([{ path: 'date', code: 'invalidDate' }])
  const has = schedule.skippedDates.includes(date)
  if (has === skipped) return { ok: true, data, value: schedule, unchanged: true }
  const skippedDates = skipped ? [...schedule.skippedDates, date].sort() : schedule.skippedDates.filter((d) => d !== date)
  const updated = { ...schedule, skippedDates, updatedAt: ctx.now }
  return { ok: true, data: touch({ ...data, schedules: upsert(data.schedules, updated) }, ctx.now), value: updated }
}

/* ------------------------------------------------------------------ */
/* Metas                                                               */
/* ------------------------------------------------------------------ */

export type GoalDraft = Omit<Goal, 'createdAt' | 'updatedAt' | 'currency' | 'allocations'>

export function saveGoal(data: AppData, draft: GoalDraft, ctx: OpContext): OpResult<Goal> {
  const existing = data.goals.find((g) => g.id === draft.id)
  const goal: Goal = {
    id: draft.id,
    name: draft.name.trim(),
    kind: draft.kind,
    targetMinor: draft.targetMinor,
    ...(draft.targetDate ? { targetDate: draft.targetDate } : {}),
    currency: data.settings.currency,
    fundedFrom: draft.fundedFrom,
    allocations: existing?.allocations ?? [],
    ...(draft.icon ? { icon: draft.icon } : {}),
    ...(draft.color ? { color: draft.color } : {}),
    ...(draft.contribution ? { contribution: draft.contribution } : {}),
    // Gasto planificado: se conserva el historial de periodos pagados al editar.
    ...(draft.kind === 'expense'
      ? { plan: { ...(existing?.plan ?? {}), ...(draft.plan ?? {}), history: existing?.plan?.history ?? draft.plan?.history ?? [] } }
      : {}),
    createdAt: existing?.createdAt ?? ctx.now,
    updatedAt: ctx.now,
  }
  const issues = validateGoal(goal, { data })
  if (issues.length) return fail(issues)
  // Cambiar a 'budget' una meta con dinero apartado también debe caber en el dinero libre.
  if (existing && existing.fundedFrom === 'external' && goal.fundedFrom === 'budget') {
    const saved = goalProgress(existing).savedMinor
    const free = Math.max(0, computeBudget(data, ctx.today).availableMinor)
    if (saved > free) return fail([{ path: 'fundedFrom', code: 'exceedsFreeMoney', params: { freeMinor: free } }])
  }
  return { ok: true, data: touch({ ...data, goals: upsert(data.goals, goal) }, ctx.now), value: goal }
}

export function deleteGoal(data: AppData, id: string, ctx: OpContext): OpResult<Goal> {
  const goal = data.goals.find((g) => g.id === id)
  if (!goal) return fail([{ path: 'id', code: 'notFound' }])
  // Un presupuesto por periodo que usaba esta meta como reserva se queda sin reserva.
  const periodBudgets = data.periodBudgets.map((b) => {
    if (b.goalId !== id) return b
    const { goalId: _removed, ...rest } = b
    return { ...rest, updatedAt: ctx.now }
  })
  return { ok: true, data: touch({ ...data, goals: data.goals.filter((g) => g.id !== id), periodBudgets }, ctx.now), value: goal }
}

export function restoreGoal(data: AppData, goal: Goal, ctx: OpContext): OpResult<Goal> {
  if (data.goals.some((g) => g.id === goal.id)) return { ok: true, data, value: goal, unchanged: true }
  return { ok: true, data: touch({ ...data, goals: [...data.goals, goal] }, ctx.now), value: goal }
}

/**
 * Aparta (+) o libera (−) dinero de una meta. Reglas contra la doble reserva:
 *  - Metas del presupuesto: no se puede apartar más que el disponible libre
 *    (saldo − pagos reservados − otros apartados).
 *  - No se aparta más de lo que le falta a la meta.
 *  - No se libera más de lo apartado.
 */
/**
 * Cuánto se puede apartar hoy en una meta del presupuesto sin usar dos veces el mismo dinero.
 * Normalmente = dinero libre. Si la meta cubre un pago del calendario que YA está reservado
 * (gasto planificado vinculado), esa parte no cuesta nada: solo cambia de «reservado para el
 * pago» a «apartado en la meta». Se calcula probando el apartado completo:
 *   costo(x) = max(0, x − parteNeutral)  →  máximo = min(falta, parteNeutral + libre).
 */
export function maxBudgetAllocation(data: AppData, goal: Goal, today: LocalDate): number {
  const { remainingMinor } = goalProgress(goal)
  if (remainingMinor <= 0) return 0
  const before = computeBudget(data, today).availableMinor
  const probe: Goal = { ...goal, allocations: [...goal.allocations, { id: '__probe__', amountMinor: remainingMinor, date: today, createdAt: goal.updatedAt }] }
  const after = computeBudget({ ...data, goals: data.goals.map((g) => (g.id === goal.id ? probe : g)) }, today).availableMinor
  const neutral = Math.max(0, remainingMinor - (before - after))
  return Math.min(remainingMinor, neutral + Math.max(0, before))
}

export function allocateToGoal(
  data: AppData,
  input: { goalId: string; amountMinor: number; allocationId?: string; reason?: AllocationReason; distributionId?: string },
  ctx: OpContext,
): OpResult<GoalAllocation> {
  const goal = data.goals.find((g) => g.id === input.goalId)
  if (!goal) return fail([{ path: 'goalId', code: 'notFound' }])
  const allocationId = input.allocationId ?? newId()
  const dup = goal.allocations.find((a) => a.id === allocationId)
  if (dup) return { ok: true, data, value: dup, unchanged: true }
  const amount = input.amountMinor
  if (!Number.isSafeInteger(amount) || amount === 0) return fail([{ path: 'amountMinor', code: 'invalidAmount' }])
  const { savedMinor, remainingMinor } = goalProgress(goal)
  if (amount > 0) {
    if (amount > remainingMinor) return fail([{ path: 'amountMinor', code: 'exceedsRemaining', params: { remainingMinor } }])
    if (goal.fundedFrom === 'budget') {
      const free = maxBudgetAllocation(data, goal, ctx.today)
      if (amount > free) return fail([{ path: 'amountMinor', code: 'exceedsFreeMoney', params: { freeMinor: free } }])
    }
  } else if (-amount > savedMinor) {
    return fail([{ path: 'amountMinor', code: 'exceedsSaved', params: { savedMinor } }])
  }
  const allocation: GoalAllocation = {
    id: allocationId,
    amountMinor: amount,
    date: ctx.today,
    createdAt: ctx.now,
    reason: input.reason ?? (amount > 0 ? 'contribution' : 'release'),
    ...(input.distributionId ? { distributionId: input.distributionId } : {}),
  }
  const updated: Goal = { ...goal, allocations: [...goal.allocations, allocation], updatedAt: ctx.now }
  return { ok: true, data: touch({ ...data, goals: upsert(data.goals, updated) }, ctx.now), value: allocation }
}

/* ------------------------------------------------------------------ */
/* Cuentas y saldo                                                     */
/* ------------------------------------------------------------------ */

export interface SettleOnUpdate {
  scheduleId?: string
  plannedTxId?: string
  occurrenceDate: LocalDate
  amountMinor: number
}

/**
 * Registra un nuevo saldo de referencia. Opcionalmente marca como pagados
 * (ya incluidos en ese saldo) pagos vencidos: se crean con `realizedAt = setAt`
 * para que NO vuelvan a restarse.
 */
export function updateAccountBalance(
  data: AppData,
  input: { accountId: string; amountMinor: number; date: LocalDate; settle?: SettleOnUpdate[] },
  ctx: OpContext,
): OpResult<Account> {
  const account = data.accounts.find((a) => a.id === input.accountId)
  if (!account) return fail([{ path: 'accountId', code: 'notFound' }])
  if (input.date > ctx.today) return fail([{ path: 'date', code: 'realizedInFuture' }])
  const updated: Account = { ...account, anchor: { amountMinor: input.amountMinor, date: input.date, setAt: ctx.now }, updatedAt: ctx.now }
  const issues = validateAccount(updated)
  if (issues.length) return fail(issues)
  let next: AppData = { ...data, accounts: upsert(data.accounts, updated) }
  for (const s of input.settle ?? []) {
    const date = s.occurrenceDate <= input.date ? s.occurrenceDate : input.date
    let r: OpResult<Transaction>
    if (s.scheduleId) {
      r = markOccurrence(next, { scheduleId: s.scheduleId, occurrenceDate: s.occurrenceDate, amountMinor: s.amountMinor, date, accountId: account.id, alreadyInBalance: true }, ctx)
    } else if (s.plannedTxId) {
      r = realizePlanned(next, s.plannedTxId, { date, alreadyInBalance: true }, ctx)
    } else continue
    if (!r.ok) return r
    next = r.data
  }
  return { ok: true, data: touch(next, ctx.now), value: updated }
}

export type AccountDraft = Pick<Account, 'id' | 'name' | 'kind' | 'includeInBudget' | 'card' | 'institution'> & {
  /** Solo al crear. */
  openingBalanceMinor?: number
  openingDate?: LocalDate
}

export function saveAccount(data: AppData, draft: AccountDraft, ctx: OpContext): OpResult<Account> {
  const existing = data.accounts.find((a) => a.id === draft.id)
  const account: Account = {
    id: draft.id,
    name: draft.name.trim(),
    kind: draft.kind,
    includeInBudget: draft.includeInBudget,
    ...(draft.kind === 'credit' && draft.card ? { card: cleanCard(draft.card) } : {}),
    ...(cleanText(draft.institution) ? { institution: cleanText(draft.institution) } : {}),
    anchor: existing?.anchor ?? { amountMinor: draft.openingBalanceMinor ?? 0, date: draft.openingDate ?? ctx.today, setAt: ctx.now },
    // v11: archivar y ordenar tienen sus propias operaciones; editar conserva ambos. Una cuenta nueva va al final.
    ...(existing?.archived ? { archived: true } : {}),
    order: existing?.order ?? nextAccountOrder(data.accounts),
    createdAt: existing?.createdAt ?? ctx.now,
    updatedAt: ctx.now,
  }
  const issues = validateAccount(account)
  if (issues.length) return fail(issues)
  // Cambiar una cuenta a tarjeta (o al revés) cambiaría el sentido de su saldo: se crea otra cuenta.
  if (existing && existing.kind !== account.kind && (existing.kind === 'credit' || account.kind === 'credit')) {
    return fail([{ path: 'kind', code: 'creditKindChange' }])
  }
  const accounts = upsert(data.accounts, account)
  if (!accounts.some(isBudgetAccount)) return fail([{ path: 'includeInBudget', code: 'lastBudgetAccount' }])
  return { ok: true, data: touch({ ...data, accounts }, ctx.now), value: account }
}

function nextAccountOrder(accounts: readonly Account[]): number {
  return accounts.length === 0 ? 0 : Math.max(...accounts.map((a, i) => a.order ?? i)) + 1
}

/**
 * Archivar conserva la cuenta, su saldo y todo su historial; solo deja de ofrecerse y de contar.
 * No se archiva la última cuenta del presupuesto ni una con pagos programados activos (se piden
 * mover o terminar antes). Un saldo distinto de cero no lo impide: la interfaz lo avisa.
 */
export function setAccountArchived(data: AppData, id: string, archived: boolean, ctx: OpContext): OpResult<Account> {
  const account = data.accounts.find((a) => a.id === id)
  if (!account) return fail([{ path: 'id', code: 'notFound' }])
  if (!!account.archived === archived) return { ok: true, data, value: account, unchanged: true }
  if (archived) {
    if (!data.accounts.some((a) => a.id !== id && isBudgetAccount(a))) return fail([{ path: 'id', code: 'lastBudgetAccount' }])
    const active = data.schedules.filter((s) => s.accountId === id && !s.paused && (!s.endDate || s.endDate >= ctx.today))
    if (active.length) return fail([{ path: 'id', code: 'accountHasSchedules', params: { count: active.length } }])
  }
  const updated: Account = { ...account, archived, updatedAt: ctx.now }
  if (!archived) delete updated.archived
  return { ok: true, data: touch({ ...data, accounts: upsert(data.accounts, updated) }, ctx.now), value: updated }
}

/** Nuevo orden de TODAS las cuentas (ids, sin repetir ni faltar). Solo cambia `order`. */
export function reorderAccounts(data: AppData, orderedIds: readonly string[], ctx: OpContext): OpResult<Account[]> {
  const ids = new Set(orderedIds)
  if (ids.size !== orderedIds.length || ids.size !== data.accounts.length || data.accounts.some((a) => !ids.has(a.id))) {
    return fail([{ path: 'orderedIds', code: 'invalidValue' }])
  }
  const position = new Map(orderedIds.map((id, i) => [id, i]))
  const changed = data.accounts.filter((a) => a.order !== position.get(a.id))
  if (changed.length === 0) return { ok: true, data, value: data.accounts, unchanged: true }
  const accounts = data.accounts.map((a) => (a.order === position.get(a.id) ? a : { ...a, order: position.get(a.id)!, updatedAt: ctx.now }))
  return { ok: true, data: touch({ ...data, accounts }, ctx.now), value: accounts }
}

/** Quita campos vacíos de los datos de tarjeta. */
function cleanCard(card: CardDetails): CardDetails {
  const out: CardDetails = {}
  for (const [k, v] of Object.entries(card) as [keyof CardDetails, number | undefined][]) if (v !== undefined) out[k] = v
  return out
}

export function deleteAccount(data: AppData, id: string, ctx: OpContext): OpResult<Account> {
  const account = data.accounts.find((a) => a.id === id)
  if (!account) return fail([{ path: 'id', code: 'notFound' }])
  // También cuentan los movimientos de la papelera: si no, restaurarlos dejaría una cuenta inexistente.
  const usesAccount = (t: Transaction) => t.accountId === id || t.toAccountId === id
  const used =
    data.transactions.some(usesAccount) || data.trash.some((e) => usesAccount(e.transaction)) || data.schedules.some((s) => s.accountId === id)
  if (used) return fail([{ path: 'id', code: 'accountInUse' }])
  const accounts = data.accounts.filter((a) => a.id !== id)
  if (!accounts.some(isBudgetAccount)) return fail([{ path: 'id', code: 'lastBudgetAccount' }])
  // Las conciliaciones de una cuenta eliminada ya no tienen sentido. Los favoritos se
  // conservan: al usarlos, el formulario pide elegir otra cuenta.
  const reconciliations = data.reconciliations.filter((r) => r.accountId !== id)
  return { ok: true, data: touch({ ...data, accounts, reconciliations }, ctx.now), value: account }
}

/* ------------------------------------------------------------------ */
/* Categorías personalizadas                                           */
/* ------------------------------------------------------------------ */

export type CategoryDraft = Pick<CustomCategory, 'id' | 'name' | 'kind'>

export function saveCategory(data: AppData, draft: CategoryDraft, ctx: OpContext): OpResult<CustomCategory> {
  const existing = data.categories.find((c) => c.id === draft.id)
  // El tipo no cambia después de crearla: los movimientos que la usan dependen de él.
  const category: CustomCategory = {
    id: draft.id,
    name: draft.name.trim(),
    kind: existing?.kind ?? draft.kind,
    archived: existing?.archived ?? false,
    createdAt: existing?.createdAt ?? ctx.now,
    updatedAt: ctx.now,
  }
  const issues = validateCategory(category, data.categories)
  if (issues.length) return fail(issues)
  return { ok: true, data: touch({ ...data, categories: upsert(data.categories, category) }, ctx.now), value: category }
}

export function setCategoryArchived(data: AppData, id: string, archived: boolean, ctx: OpContext): OpResult<CustomCategory> {
  const category = data.categories.find((c) => c.id === id)
  if (!category) return fail([{ path: 'id', code: 'notFound' }])
  if (category.archived === archived) return { ok: true, data, value: category, unchanged: true }
  const updated = { ...category, archived, updatedAt: ctx.now }
  return { ok: true, data: touch({ ...data, categories: upsert(data.categories, updated) }, ctx.now), value: updated }
}

/** Solo se elimina si ningún movimiento ni programado la usa; si no, se archiva. */
export function deleteCategory(data: AppData, id: string, ctx: OpContext): OpResult<CustomCategory> {
  const category = data.categories.find((c) => c.id === id)
  if (!category) return fail([{ path: 'id', code: 'notFound' }])
  const used =
    data.transactions.some((t) => t.categoryId === id) ||
    data.trash.some((e) => e.transaction.categoryId === id) ||
    data.schedules.some((s) => s.categoryId === id)
  if (used) return fail([{ path: 'id', code: 'categoryInUse' }])
  return {
    ok: true,
    data: touch(
      {
        ...data,
        categories: data.categories.filter((c) => c.id !== id),
        categoryLimits: data.categoryLimits.filter((l) => l.categoryId !== id),
        categoryRules: data.categoryRules.filter((r) => r.categoryId !== id),
        // Un plan solo para esta categoría desaparece; uno de varias la pierde (vacío significaría «todas»).
        plans: data.plans.filter((p) => !(p.categoryIds.length === 1 && p.categoryIds[0] === id)).map((p) => (p.categoryIds.includes(id) ? { ...p, categoryIds: p.categoryIds.filter((c) => c !== id), updatedAt: ctx.now } : p)),
      },
      ctx.now,
    ),
    value: category,
  }
}

/* ------------------------------------------------------------------ */
/* Reglas de categoría                                                 */
/* ------------------------------------------------------------------ */

export type CategoryRuleDraft = Pick<CategoryRule, 'id' | 'pattern' | 'kind' | 'categoryId'>

export function saveCategoryRule(data: AppData, draft: CategoryRuleDraft, ctx: OpContext): OpResult<CategoryRule> {
  const existing = data.categoryRules.find((r) => r.id === draft.id)
  const rule: CategoryRule = {
    id: draft.id,
    pattern: draft.pattern.replace(/\s+/g, ' ').trim(),
    kind: draft.kind,
    categoryId: draft.categoryId,
    createdAt: existing?.createdAt ?? ctx.now,
    updatedAt: ctx.now,
  }
  if (existing && existing.pattern === rule.pattern && existing.kind === rule.kind && existing.categoryId === rule.categoryId) {
    return { ok: true, data, value: existing, unchanged: true }
  }
  const issues = validateCategoryRule(rule, data.categoryRules, data.categories)
  if (issues.length) return fail(issues)
  return { ok: true, data: touch({ ...data, categoryRules: upsert(data.categoryRules, rule) }, ctx.now), value: rule }
}

/** Varias reglas en una operación (las correcciones aceptadas en la revisión del asistente): todo o nada. */
export function saveCategoryRules(data: AppData, drafts: readonly CategoryRuleDraft[], ctx: OpContext): OpResult<CategoryRule[]> {
  let next = data
  const saved: CategoryRule[] = []
  for (const [i, draft] of drafts.entries()) {
    const r = saveCategoryRule(next, draft, ctx)
    if (!r.ok) return fail(r.issues.map((issue) => ({ ...issue, path: `rules[${i}].${issue.path}` })))
    next = r.data
    saved.push(r.value)
  }
  return { ok: true, data: next, value: saved }
}

/** Deshacer varias reglas recién guardadas (por id); las que ya no estén se ignoran. */
export function deleteCategoryRules(data: AppData, ids: readonly string[], ctx: OpContext): OpResult<CategoryRule[]> {
  const removed = data.categoryRules.filter((r) => ids.includes(r.id))
  if (removed.length === 0) return { ok: true, data, value: [], unchanged: true }
  return { ok: true, data: touch({ ...data, categoryRules: data.categoryRules.filter((r) => !ids.includes(r.id)) }, ctx.now), value: removed }
}

export function deleteCategoryRule(data: AppData, id: string, ctx: OpContext): OpResult<CategoryRule> {
  const rule = data.categoryRules.find((r) => r.id === id)
  if (!rule) return fail([{ path: 'id', code: 'notFound' }])
  return { ok: true, data: touch({ ...data, categoryRules: data.categoryRules.filter((r) => r.id !== id) }, ctx.now), value: rule }
}

/** Deshacer: vuelve a poner la misma regla (mismo id). */
export function restoreCategoryRule(data: AppData, rule: CategoryRule, ctx: OpContext): OpResult<CategoryRule> {
  if (data.categoryRules.some((r) => r.id === rule.id)) return { ok: true, data, value: rule, unchanged: true }
  return { ok: true, data: touch({ ...data, categoryRules: [...data.categoryRules, rule] }, ctx.now), value: rule }
}

/* ------------------------------------------------------------------ */
/* Conciliación                                                        */
/* ------------------------------------------------------------------ */

export interface ReconcileInput {
  /** Id generado al abrir el formulario (guardar dos veces no duplica). */
  id: string
  accountId: string
  date: LocalDate
  /** Saldo observado. En tarjetas, la deuda en negativo. */
  observedMinor: number
  /**
   * matched: no hay diferencia. unresolved: se guarda la diferencia para revisarla.
   * adjusted: se crea un AJUSTE explícito por la diferencia (confirmado por la persona).
   */
  resolution: ReconciliationResolution
  reason?: string
  /** Id del ajuste, generado al abrir la confirmación. */
  adjustmentTxId?: string
}

/**
 * Registra una conciliación. Nunca cambia el saldo de referencia ni crea ajustes por
 * su cuenta: el ajuste solo existe si la persona lo pide (`adjusted`), con fecha,
 * motivo y vínculo a esta conciliación. El ajuste corrige el saldo sin contar como
 * ingreso ni gasto.
 */
export function reconcileAccount(data: AppData, input: ReconcileInput, ctx: OpContext): OpResult<{ reconciliation: Reconciliation; adjustment?: Transaction }> {
  const already = data.reconciliations.find((r) => r.id === input.id)
  if (already) {
    const adj = already.adjustmentTxId ? data.transactions.find((t) => t.id === already.adjustmentTxId) : undefined
    return { ok: true, data, value: { reconciliation: already, adjustment: adj }, unchanged: true }
  }
  const account = data.accounts.find((a) => a.id === input.accountId)
  if (!account) return fail([{ path: 'accountId', code: 'unknownAccount' }])
  if (!isValidLocalDate(input.date)) return fail([{ path: 'date', code: 'invalidDate' }])
  if (input.date > ctx.today) return fail([{ path: 'date', code: 'realizedInFuture' }])
  const computedMinor = balanceAtDate(data, account, input.date)
  if (computedMinor === null) return fail([{ path: 'date', code: 'beforeAnchor', params: { date: account.anchor.date } }])
  if (!Number.isSafeInteger(input.observedMinor)) return fail([{ path: 'observedMinor', code: 'invalidAmount' }])
  const differenceMinor = input.observedMinor - computedMinor
  const reason = cleanText(input.reason)

  if (input.resolution === 'matched' && differenceMinor !== 0) {
    return fail([{ path: 'resolution', code: 'differenceNotZero', params: { differenceMinor } }])
  }
  // Sin diferencia no hay nada que resolver: se registra como coincidente.
  const resolution: ReconciliationResolution = differenceMinor === 0 ? 'matched' : input.resolution

  let next = data
  let adjustment: Transaction | undefined
  if (resolution === 'adjusted') {
    if (!reason) return fail([{ path: 'reason', code: 'reasonRequired' }])
    const r = saveTransaction(
      data,
      {
        id: input.adjustmentTxId ?? newId(),
        kind: 'adjustment',
        status: 'realized',
        amountMinor: Math.abs(differenceMinor),
        date: input.date,
        accountId: account.id,
        adjustmentDirection: differenceMinor > 0 ? 'increase' : 'decrease',
        reconciliationId: input.id,
        note: reason,
      },
      ctx,
    )
    if (!r.ok) return r
    next = r.data
    adjustment = r.value
  }

  const reconciliation: Reconciliation = {
    id: input.id,
    accountId: account.id,
    date: input.date,
    observedMinor: input.observedMinor,
    computedMinor,
    differenceMinor,
    resolution,
    ...(adjustment ? { adjustmentTxId: adjustment.id } : {}),
    ...(reason ? { reason } : {}),
    // La huella incluye el ajuste recién creado: lo que se concilió es el estado final.
    fingerprint: reconciliationFingerprint(next, account, input.date),
    createdAt: ctx.now,
    updatedAt: ctx.now,
  }
  const issues = validateReconciliation(reconciliation, { data: next })
  if (issues.length) return fail(issues)
  return { ok: true, data: touch({ ...next, reconciliations: [...next.reconciliations, reconciliation] }, ctx.now), value: { reconciliation, adjustment } }
}

/* ------------------------------------------------------------------ */
/* Favoritos (plantillas; nunca registran movimientos por sí solos)    */
/* ------------------------------------------------------------------ */

export type FavoriteDraft = Pick<Favorite, 'id' | 'name' | 'kind' | 'accountId' | 'categoryId' | 'amountMinor' | 'note'>

/** Posiciones consecutivas 0, 1, 2… respetando el orden actual. */
function normalizeOrder(list: Favorite[]): Favorite[] {
  return [...list].sort((a, b) => a.order - b.order).map((f, i) => (f.order === i ? f : { ...f, order: i }))
}

/** Crea o actualiza (mismo id = mismo favorito: pulsar dos veces no duplica). */
export function saveFavorite(data: AppData, draft: FavoriteDraft, ctx: OpContext): OpResult<Favorite> {
  const existing = data.favorites.find((f) => f.id === draft.id)
  const favorite: Favorite = {
    id: draft.id,
    name: draft.name.trim(),
    kind: draft.kind,
    accountId: draft.accountId,
    categoryId: draft.categoryId,
    ...(draft.amountMinor !== undefined ? { amountMinor: draft.amountMinor } : {}),
    ...(cleanText(draft.note) ? { note: cleanText(draft.note) } : {}),
    order: existing?.order ?? data.favorites.reduce((max, f) => Math.max(max, f.order + 1), 0),
    createdAt: existing?.createdAt ?? ctx.now,
    updatedAt: ctx.now,
  }
  if (existing && sameFavorite(existing, favorite)) return { ok: true, data, value: existing, unchanged: true }
  const issues = validateFavorite(favorite, { data, checkReferences: true })
  if (issues.length) return fail(issues)
  return { ok: true, data: touch({ ...data, favorites: normalizeOrder(upsert(data.favorites, favorite)) }, ctx.now), value: favorite }
}

function sameFavorite(a: Favorite, b: Favorite): boolean {
  return (
    a.name === b.name && a.kind === b.kind && a.accountId === b.accountId && a.categoryId === b.categoryId && a.amountMinor === b.amountMinor && a.note === b.note
  )
}

export function deleteFavorite(data: AppData, id: string, ctx: OpContext): OpResult<Favorite> {
  const favorite = data.favorites.find((f) => f.id === id)
  if (!favorite) return fail([{ path: 'id', code: 'notFound' }])
  return { ok: true, data: touch({ ...data, favorites: normalizeOrder(data.favorites.filter((f) => f.id !== id)) }, ctx.now), value: favorite }
}

/** Deshacer: vuelve a su posición. */
export function restoreFavorite(data: AppData, favorite: Favorite, ctx: OpContext): OpResult<Favorite> {
  if (data.favorites.some((f) => f.id === favorite.id)) return { ok: true, data, value: favorite, unchanged: true }
  const shifted = data.favorites.map((f) => (f.order >= favorite.order ? { ...f, order: f.order + 1 } : f))
  return { ok: true, data: touch({ ...data, favorites: normalizeOrder([...shifted, favorite]) }, ctx.now), value: favorite }
}

/** Sube (−1) o baja (+1) un favorito una posición. */
export function moveFavorite(data: AppData, id: string, direction: -1 | 1, ctx: OpContext): OpResult<Favorite[]> {
  const list = normalizeOrder(data.favorites)
  const index = list.findIndex((f) => f.id === id)
  if (index === -1) return fail([{ path: 'id', code: 'notFound' }])
  const target = index + direction
  if (target < 0 || target >= list.length) return { ok: true, data, value: list, unchanged: true }
  const reordered = list.slice()
  ;[reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!]
  const favorites = reordered.map((f, i) => (f.order === i ? f : { ...f, order: i, updatedAt: ctx.now }))
  return { ok: true, data: touch({ ...data, favorites }, ctx.now), value: favorites }
}

/* ------------------------------------------------------------------ */
/* Ajustes                                                             */
/* ------------------------------------------------------------------ */

/**
 * Cambiar la moneda del presupuesto (§7.7). Solo sin registros con importe: los importes
 * guardados no se convierten (no hay tipo de cambio) y cambiar la etiqueta cambiaría su
 * significado. Con registros se rechaza con `currencyMismatch` y la interfaz explica la vía
 * (exportar y empezar un presupuesto nuevo).
 */
export function changeCurrency(data: AppData, currency: CurrencyCode, ctx: OpContext): OpResult<Settings> {
  if (!isSupportedCurrency(currency)) return fail([{ path: 'currency', code: 'invalidValue' }])
  if (currency === data.settings.currency) return { ok: true, data, value: data.settings, unchanged: true }
  // QA-01: cualquier importe guardado (saldos de referencia incluidos) se reinterpretaría en la otra
  // moneda; la lista de lo que cuenta vive en `currencyChange.ts` y es la misma que usa Ajustes.
  if (!canChangeCurrency(data)) return fail([{ path: 'currency', code: 'currencyMismatch', params: { expected: data.settings.currency } }])
  const settings: Settings = { ...data.settings, currency }
  const issues = validateSettings(settings)
  if (issues.length) return fail(issues)
  return { ok: true, data: touch({ ...data, settings }, ctx.now), value: settings }
}

export function updateSettings(data: AppData, patch: Partial<Omit<Settings, 'currency'>>, ctx: OpContext): OpResult<Settings> {
  const settings: Settings = { ...data.settings, ...patch }
  const issues = validateSettings(settings)
  if (issues.length) return fail(issues)
  return { ok: true, data: touch({ ...data, settings }, ctx.now), value: settings }
}

/* ------------------------------------------------------------------ */
/* Configuración inicial                                               */
/* ------------------------------------------------------------------ */

export interface SetupInput {
  currency: string
  timeZone: string
  numberLocale: Settings['numberLocale']
  language: Settings['language']
  accountName: string
  balanceMinor: number
  balanceDate: LocalDate
  income:
    | { name: string; amountMinor: number; date: LocalDate; frequency: Schedule['frequency']; isEstimate: boolean; secondDay?: number }
    | null
  /** Si no hay ingreso: horizonte en días. */
  fallbackHorizonDays: number | null
  bills: { name: string; amountMinor: number; date: LocalDate; frequency: Schedule['frequency']; secondDay?: number }[]
  /** `name` llega traducido desde la interfaz (p. ej. «Reserva de emergencia»). */
  reserve: { amountMinor: number; fundedFrom: Goal['fundedFrom']; name: string } | null
  /** Categorías del sistema elegidas en el onboarding (§7.1); si falta, quedan las propuestas por defecto. */
  categoryIds?: readonly string[]
  /** Periodo del presupuesto (§7.1); por defecto mensual en instalaciones nuevas. */
  periodType?: BudgetPeriodType
}

export function createInitialData(input: SetupInput, ctx: OpContext): OpResult<AppData> {
  const accountId = newId()
  let data: AppData = {
    schemaVersion: SCHEMA_VERSION,
    budgetId: newId(),
    isDemo: false,
    settings: {
      currency: input.currency,
      numberLocale: input.numberLocale,
      dateStyle: 'medium',
      timeZone: input.timeZone,
      language: input.language,
      fallbackHorizonDays: input.income ? null : input.fallbackHorizonDays,
      weeklyReview: true,
      ...defaultSettingsV9({ periodType: input.periodType ?? 'month', onboardingDone: true }),
    },
    accounts: [],
    transactions: [],
    schedules: [],
    goals: [],
    categories: [],
    ...defaultCollectionsV9(),
    categoryLimits: [],
    categoryRules: [],
    trash: [],
    purgedImportRefs: [],
    favorites: [],
    reconciliations: [],
    backup: { reminder: 'weekly' },
    periodBudgets: [],
    scenarios: [],
    inbox: { snoozed: [], dismissed: [] },
    incomeDistributions: [],
    templates: [],
    history: [],
    historyStartedAt: ctx.now,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    revision: 0,
  }
  const settingsIssues = validateSettings(data.settings, 'settings.')
  if (settingsIssues.length) return fail(settingsIssues)

  const chosen = applyOnboardingCategories(data, input.categoryIds ?? defaultOnboardingCategoryIds(), ctx)
  if (!chosen.ok) return fail(chosen.issues)
  data = chosen.data

  const account: Account = {
    id: accountId,
    name: input.accountName.trim(),
    kind: 'bank',
    includeInBudget: true,
    anchor: { amountMinor: input.balanceMinor, date: input.balanceDate, setAt: ctx.now },
    createdAt: ctx.now,
    updatedAt: ctx.now,
  }
  if (input.balanceDate > ctx.today) return fail([{ path: 'balanceDate', code: 'realizedInFuture' }])
  const accIssues = validateAccount(account)
  if (accIssues.length) return fail(accIssues)
  data = { ...data, accounts: [account] }

  if (input.income) {
    const r = saveSchedule(
      data,
      {
        id: newId(),
        name: input.income.name,
        kind: 'income',
        amountMinor: input.income.amountMinor,
        amountIsEstimate: input.income.isEstimate,
        accountId,
        categoryId: 'salary',
        frequency: input.income.frequency,
        ...(input.income.frequency === 'semimonthly' && input.income.secondDay !== undefined ? { secondDay: input.income.secondDay } : {}),
        startDate: input.income.date,
        reminderDaysBefore: 0,
      },
      ctx,
    )
    if (!r.ok) return fail(r.issues.map((i) => ({ ...i, path: `income.${i.path}` })))
    data = r.data
  }

  for (const [i, bill] of input.bills.entries()) {
    const r = saveSchedule(
      data,
      {
        id: newId(),
        name: bill.name,
        kind: 'expense',
        amountMinor: bill.amountMinor,
        amountIsEstimate: false,
        accountId,
        categoryId: 'other_expense',
        frequency: bill.frequency,
        ...(bill.frequency === 'semimonthly' && bill.secondDay !== undefined ? { secondDay: bill.secondDay } : {}),
        startDate: bill.date,
        reminderDaysBefore: 2,
      },
      ctx,
    )
    if (!r.ok) return fail(r.issues.map((x) => ({ ...x, path: `bills[${i}].${x.path}` })))
    data = r.data
  }

  if (input.reserve && input.reserve.amountMinor > 0) {
    const goalId = newId()
    const goal: Goal = {
      id: goalId,
      name: input.reserve.name,
      kind: 'emergency',
      targetMinor: input.reserve.amountMinor,
      currency: input.currency,
      fundedFrom: input.reserve.fundedFrom,
      // La reserva inicial se registra tal cual; si supera el dinero libre, Inicio lo advierte.
      allocations: [{ id: newId(), amountMinor: input.reserve.amountMinor, date: ctx.today, createdAt: ctx.now }],
      createdAt: ctx.now,
      updatedAt: ctx.now,
    }
    const issues = validateGoal(goal, { data })
    if (issues.length) return fail(issues.map((x) => ({ ...x, path: `reserve.${x.path}` })))
    data = { ...data, goals: [goal] }
  }

  return { ok: true, data, value: data }
}

/** Fecha por defecto para un pago real: la de la ocurrencia si ya pasó, si no hoy. */
export function defaultPaymentDate(occurrenceDate: LocalDate, today: LocalDate): LocalDate {
  return occurrenceDate <= today ? occurrenceDate : today
}

/** Primer día disponible para un horizonte elegido (utilidad para la interfaz). */
export function horizonEnd(today: LocalDate, days: number): LocalDate {
  return addDays(today, days)
}
