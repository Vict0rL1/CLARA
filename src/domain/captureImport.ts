/**
 * Importar capturas automáticas (Fase 2 nativa, decisión 169). La acción de Atajos deja cada pago en la cola
 * (`captureQueue.ts` la lee); aquí se decide qué pasa con cada uno, siempre igual y sin adivinar:
 *
 * - Ya leída (su id está en `captures.processed`, en un movimiento, en la papelera o en una propuesta): se salta. Es lo
 *   que hace la importación idempotente: abrir la app dos veces, o que la cola no se haya vaciado, no duplica nada.
 * - En la moneda del presupuesto, con «Guardar automáticamente» y sin parecerse a otro: **movimiento real** (gasto
 *   realizado) marcado «Por revisar» (`review.reason = 'auto_capture'`). Cuenta en todas las cifras desde ya; es la
 *   excepción a «nada se guarda sin confirmar» que trae la Fase 2 (CLAUDE.md).
 * - La prueba de Ajustes (`test`) siempre es propuesta, nunca se registra y no cuenta como posible duplicado.
 * - En otra moneda durante un viaje en curso con una tasa escrita para ella (Fase 3, decisión 177; un «¥» suelto solo si
 *   la moneda local del viaje lo resuelve): también **movimiento real** «Por revisar» (`review.reason = 'currency'`),
 *   convertido con ESA tasa y la comisión del viaje (`original`, `fx.ts`) y asociado al viaje.
 * - Sin tasa del viaje, con la del Banco de Canadá si quien llama la trae ya pedida (`options.boc`, decisión 181: la pide
 *   `state/captureSync.ts` antes, solo con el interruptor encendido y presupuesto en CAD; aquí no hay red): igual, con
 *   `rateSource: 'boc'` y la fecha de la observación; se asocia al viaje solo si la moneda es del viaje. Nunca otra tasa.
 * - Si no: **propuesta**, que no cuenta en ninguna cifra hasta que la persona la registra. Motivos: otra moneda sin tasa
 *   o «¥» sin resolver (`currency`; nunca se inventa una tasa), importe sin entender (`unparsed`), mismo importe y comercio que otro gasto
 *   realizado o captura de menos de 2 minutos antes o después (`duplicate`: la automatización puede dispararse dos veces
 *   o la persona ya lo anotó a mano), o «Guardar automáticamente» apagado (`auto_capture`). Un gasto que llevaría los
 *   importes más allá de la cota de exactitud (`exactRange.ts`) tampoco se crea: queda como propuesta.
 *
 * La cuenta sale de la tarjeta que dio Wallet (`settings.capture.cardAccounts`), si no de la cuenta por defecto, y si
 * no de la primera cuenta activa del presupuesto. La fecha es la del pago en la zona horaria del presupuesto (nunca
 * posterior a hoy). La categoría, la que propondría el formulario para ese comercio (regla, aprendido, diccionario) o
 * «Otros gastos».
 *
 * Todo o nada: o entran todas las capturas nuevas de la cola, o ninguna. Lo que no cabe (ya hay
 * `CAPTURE_PROPOSALS_MAX` propuestas) o no tiene cuenta posible (ninguna cuenta activa) se queda en la cola sin marcar
 * como leído (`deferred`) y se lee la próxima vez: nunca se descarta.
 */
import { activeAccounts } from './balances'
import { bocConversion, bocKey, bocSeries, type BocRate } from './boc'
import { BANK_ALERT_PATTERNS, readBankAlert, unknownAlertLabel, type BankAlertPattern } from './bankAlert'
import { readCaptureAmount, type CaptureAmount, type CaptureRecord } from './captureQueue'
import { localDateInTimeZone } from './dates'
import { convertToBudget, parseRate, rateToText } from './fx'
import { rateFromAmounts } from './fxAdjust'
import { parseMoney, stripCurrencyMark } from './money'
import { activeTrip, resolveAmbiguous, tripRate } from './trips'
import { EXACT_RANGE_MAX_MINOR, exactRangeIssue, exceedsExactRange, signedMagnitudes } from './exactRange'
import { merchantKey } from './merchants'
import type { OpContext, OpResult } from './operations'
import { suggestCategoryForMerchant } from './shortcutLink'
import { normalizeText } from './text'
import type { AppData, CaptureOrigin, CaptureProposal, CaptureState, CurrencyCode, LocalDate, OriginalAmount, PeriodBudget, ReviewReason, Transaction, TransactionSource, TxReview } from './types'
import { CAPTURE_CARDS_MAX, CAPTURE_PROCESSED_MAX, CAPTURE_PROPOSALS_MAX, validateTransaction } from './validation'

/** Dos cargos del mismo importe y comercio a esta distancia o menos se tratan como posible duplicado. */
export const CAPTURE_DUPLICATE_WINDOW_MS = 2 * 60 * 1000
/** Categoría de un gasto capturado cuando no hay ninguna mejor. */
export const CAPTURE_FALLBACK_CATEGORY = 'other_expense'

export interface CaptureImportSummary {
  /** Movimientos creados (sus ids son los de la captura), marcados «Por revisar». */
  saved: string[]
  /** Capturas que quedaron como propuesta. */
  proposed: string[]
  /** Ya leídas antes (o repetidas en el mismo lote): no se tocan. */
  skipped: string[]
  /** No cupieron o no tenían cuenta: siguen en la cola y se leerán la próxima vez. */
  deferred: string[]
  /** Ids que el lado nativo puede quitar ya de la cola: lo guardado, lo propuesto y lo saltado. Nunca lo aplazado. */
  ack: string[]
}

const EMPTY_STATE: CaptureState = { processed: [], proposals: [] }

const SOURCE: Record<CaptureOrigin, TransactionSource> = { apple_pay: 'apple_pay', bank_text: 'bank_text', siri: 'siri', notification: 'bank_text' }

/**
 * La cuenta para una tarjeta: la asignada, la de por defecto o la primera activa (primero las del presupuesto, en el
 * orden de la persona). Nunca una archivada ni una que ya no existe. `undefined` si no hay ninguna cuenta activa.
 */
export function accountForCard(data: Pick<AppData, 'accounts' | 'settings'>, card: string | undefined): string | undefined {
  const usable = (id: string | undefined): id is string => !!id && data.accounts.some((a) => a.id === id && !a.archived)
  const capture = data.settings.capture
  if (card && capture) {
    const key = normalizeText(card)
    const mapped = capture.cardAccounts.find((m) => normalizeText(m.card) === key)
    if (mapped && usable(mapped.accountId)) return mapped.accountId
  }
  if (usable(capture?.defaultAccountId)) return capture.defaultAccountId
  const active = activeAccounts(data.accounts)
  return (active.find((a) => a.includeInBudget) ?? active[0])?.id
}

/** ¿Ya se leyó esta captura? Por la lista de leídas, o porque hay un movimiento, una entrada de papelera o una propuesta suya. */
export function captureKnown(data: AppData, captureId: string): boolean {
  const state = data.captures ?? EMPTY_STATE
  return (
    state.processed.some((p) => p.id === captureId) ||
    state.proposals.some((p) => p.captureId === captureId) ||
    data.transactions.some((t) => t.id === captureId || t.captureId === captureId) ||
    data.trash.some((e) => e.id === captureId || e.transaction.captureId === captureId)
  )
}

/** Un gasto con el que una captura podría ser el mismo pago. */
interface Charge {
  txId?: string
  amountMinor: number
  at: number
  merchant: string
}

/** Sin comercio en alguno de los dos no se puede descartar que sea el mismo pago. */
const sameMerchant = (a: string, b: string) => a === '' || b === '' || a === b

function similarCharge(charges: readonly Charge[], amountMinor: number, at: number, merchant: string): Charge | undefined {
  return charges.find((c) => c.amountMinor === amountMinor && Math.abs(c.at - at) <= CAPTURE_DUPLICATE_WINDOW_MS && sameMerchant(c.merchant, merchant))
}

/** Gastos realizados (cuándo se pagaron, o si no cuándo se anotaron) y propuestas en la moneda del presupuesto. */
function chargesOf(data: AppData): Charge[] {
  const out: Charge[] = []
  for (const t of data.transactions) {
    if (t.kind !== 'expense' || t.status !== 'realized') continue
    const at = Date.parse(t.realizedAt ?? t.createdAt)
    if (!Number.isNaN(at)) out.push({ txId: t.id, amountMinor: t.amountMinor, at, merchant: merchantKey(t.merchant ?? '') })
  }
  for (const p of data.captures?.proposals ?? []) {
    if (p.amount.kind === 'budget' && !p.test) out.push({ amountMinor: p.amount.minor, at: Date.parse(p.capturedAt), merchant: merchantKey(p.merchant ?? '') })
  }
  return out
}

/**
 * Un importe en otra moneda que se puede leer: el de la captura, o un «¥» suelto que la moneda local del viaje resuelve
 * (el texto se vuelve a leer en esa moneda: el yen no tiene decimales y el yuan sí).
 */
export function foreignAmount(amount: CaptureAmount, trip: PeriodBudget | undefined, numberLocale: string): { currency: CurrencyCode; minor: number } | undefined {
  if (amount.kind === 'foreign') return { currency: amount.currency, minor: amount.minor }
  if (amount.kind !== 'ambiguous') return undefined
  const currency = resolveAmbiguous(trip?.trip, amount.candidates)
  if (!currency) return undefined
  const parsed = parseMoney(stripCurrencyMark(amount.text.replace(/[\u00a0\u202f]/g, ' ')).text, currency, numberLocale)
  return parsed.ok ? { currency, minor: parsed.minor } : undefined
}

/** La conversión con la tasa del viaje en curso ese día, si hay una escrita para esa moneda. Nunca otra. */
function tripConversion(data: AppData, foreign: { currency: CurrencyCode; minor: number } | undefined, trip: PeriodBudget | undefined): { amountMinor: number; original: OriginalAmount } | undefined {
  if (!foreign || !trip?.trip) return undefined
  const rate = tripRate(trip.trip, foreign.currency)
  if (!rate) return undefined
  const feeBps = trip.trip.feeBps ?? 0
  const amountMinor = convertToBudget(foreign.minor, foreign.currency, data.settings.currency, rate.rate, feeBps)
  if (amountMinor === null) return undefined
  return {
    amountMinor,
    original: { currency: foreign.currency, amountMinor: foreign.minor, rate: rate.rate, rateDate: rate.date, rateSource: 'manual', ...(feeBps > 0 ? { feeBps } : {}) },
  }
}

/** Añade movimientos a viajes (solo ids, como «Asociar»); los que ya estaban no se repiten. */
function linkToTrips(data: AppData, links: ReadonlyMap<string, string[]>, now: string): AppData {
  if (links.size === 0) return data
  const periodBudgets = data.periodBudgets.map((b) => {
    const ids = links.get(b.id)?.filter((id) => !b.txIds.includes(id))
    return ids?.length ? { ...b, txIds: [...b.txIds, ...ids], updatedAt: now } : b
  })
  return { ...data, periodBudgets }
}

/** Lo que la importación puede recibir ya calculado fuera (es síncrona y no pide nada a la red). */
export interface CaptureImportOptions {
  /** Tasas del Banco de Canadá ya pedidas, por `bocKey(moneda, fecha del pago)`. */
  boc?: ReadonlyMap<string, BocRate>
  /** Formatos de aviso conocidos (por defecto `BANK_ALERT_PATTERNS`; las pruebas pasan los suyos). */
  alertPatterns?: readonly BankAlertPattern[]
}

/**
 * Qué dice una captura (Fase 4, decisión 183): el importe y, de un aviso de texto con un formato conocido, también el
 * comercio y la tarjeta (lo que diga el propio registro manda). Un aviso de texto sin formato conocido es un importe
 * sin entender, nunca se adivina: se enseña la sugerencia (el único importe con su moneda) o el principio del texto.
 */
export function readCapture(record: CaptureRecord, settings: { currency: string; numberLocale: string }, patterns: readonly BankAlertPattern[] = BANK_ALERT_PATTERNS): { amount: CaptureAmount; merchant?: string; card?: string } {
  const base = { ...(record.merchant ? { merchant: record.merchant } : {}), ...(record.card ? { card: record.card } : {}) }
  if (record.rawAmount !== undefined) return { amount: readCaptureAmount({ rawAmount: record.rawAmount, ...(record.currencyHint ? { currencyHint: record.currencyHint } : {}) }, settings), ...base }
  const alert = readBankAlert(record.rawText ?? '', settings, patterns)
  if (alert.kind === 'known') {
    const merchant = record.merchant ?? alert.merchant
    const card = record.card ?? alert.card
    return { amount: alert.amount, ...(merchant ? { merchant } : {}), ...(card ? { card } : {}) }
  }
  return { amount: { kind: 'unreadable', text: unknownAlertLabel(record.rawText ?? '', alert.guess?.text ?? null) }, ...base }
}

/**
 * Las tasas del Banco de Canadá que harían falta para estas capturas: las nuevas (no leídas), que no son la prueba, en
 * otra moneda que se lee y sin tasa del viaje, con presupuesto en CAD y serie publicada. Una por (moneda, fecha).
 */
export function bocRatesNeeded(data: AppData, records: readonly CaptureRecord[], ctx: OpContext, options: Pick<CaptureImportOptions, 'alertPatterns'> = {}): { currency: CurrencyCode; date: LocalDate }[] {
  const out = new Map<string, { currency: CurrencyCode; date: LocalDate }>()
  for (const record of records) {
    if (record.test || captureKnown(data, record.captureId)) continue
    const date = captureDate(record, data, ctx)
    const trip = activeTrip(data, date)
    const foreign = foreignAmount(readCapture(record, data.settings, options.alertPatterns).amount, trip, data.settings.numberLocale)
    if (!foreign || tripRate(trip?.trip, foreign.currency) || !bocSeries(data.settings.currency, foreign.currency)) continue
    out.set(bocKey(foreign.currency, date), { currency: foreign.currency, date })
  }
  return [...out.values()]
}

/** La fecha de un pago en la zona horaria del presupuesto; un reloj desfasado no la deja en el futuro. */
function captureDate(record: CaptureRecord, data: AppData, ctx: OpContext): LocalDate {
  const paidOn = localDateInTimeZone(new Date(Date.parse(record.createdAt)), data.settings.timeZone)
  return paidOn > ctx.today ? ctx.today : paidOn
}

export function importCaptures(data: AppData, records: readonly CaptureRecord[], ctx: OpContext, options: CaptureImportOptions = {}): OpResult<CaptureImportSummary> {
  const summary: CaptureImportSummary = { saved: [], proposed: [], skipped: [], deferred: [], ack: [] }
  const state = data.captures ?? EMPTY_STATE
  const autoSave = data.settings.capture?.autoSave ?? true
  const charges = chargesOf(data)
  // Lo que ya sale, para no pasar de la cota con los gastos nuevos (un gasto solo suma a lo que sale).
  let outflowMinor = signedMagnitudes(data).outflowMinor
  const newTxs: Transaction[] = []
  const newProposals: CaptureProposal[] = []
  const tripLinks = new Map<string, string[]>()
  const seen = new Set<string>()
  let room = CAPTURE_PROPOSALS_MAX - state.proposals.length

  for (const record of records) {
    if (seen.has(record.captureId) || captureKnown(data, record.captureId)) {
      summary.skipped.push(record.captureId)
      summary.ack.push(record.captureId)
      continue
    }
    const what = readCapture(record, data.settings, options.alertPatterns)
    const accountId = accountForCard(data, what.card)
    if (!accountId) {
      summary.deferred.push(record.captureId)
      continue
    }
    const read = what.amount
    const at = Date.parse(record.createdAt)
    // Un reloj o una zona horaria desfasados no pueden dejar un gasto realizado en el futuro.
    const date = captureDate(record, data, ctx)
    // Fase 3: el viaje en curso el día del pago (la prueba de Ajustes nunca usa uno).
    const trip = record.test ? undefined : activeTrip(data, date)
    const foreign = foreignAmount(read, trip, data.settings.numberLocale)
    // Un «¥» que el viaje resolvió se guarda ya como esa moneda, también si queda como propuesta.
    const amount: CaptureAmount = read.kind === 'ambiguous' && foreign ? { kind: 'foreign', ...foreign } : read
    const tripConv = tripConversion(data, foreign, trip)
    const bocRate = !tripConv && foreign ? options.boc?.get(bocKey(foreign.currency, date)) : undefined
    const conversion = tripConv ?? (bocRate && foreign ? (bocConversion(foreign, data.settings.currency, bocRate, trip?.trip?.feeBps ?? 0) ?? undefined) : undefined)
    // Lo convirtió el viaje (su tasa) o es una moneda del viaje: se asocia a él.
    const linkTrip = conversion && trip?.trip && (tripConv || trip.trip.currencies.includes(conversion.original.currency)) ? trip : undefined
    const budgetMinor = amount.kind === 'budget' ? amount.minor : conversion?.amountMinor
    const merchant = merchantKey(what.merchant ?? '')
    const categoryId = (what.merchant && suggestCategoryForMerchant(what.merchant, 'expense', data)) || CAPTURE_FALLBACK_CATEGORY
    const similar = budgetMinor !== undefined ? similarCharge(charges, budgetMinor, at, merchant) : undefined
    const reason: ReviewReason | null = record.test
      ? 'auto_capture'
      : amount.kind === 'unreadable'
        ? 'unparsed'
        : budgetMinor === undefined
          ? 'currency'
          : similar
            ? 'duplicate'
            : !autoSave || outflowMinor + budgetMinor > EXACT_RANGE_MAX_MINOR
              ? 'auto_capture'
              : null

    if (reason === null && budgetMinor !== undefined) {
      seen.add(record.captureId)
      const tx: Transaction = {
        id: record.captureId,
        kind: 'expense',
        status: 'realized',
        amountMinor: budgetMinor,
        currency: data.settings.currency,
        ...(conversion ? { original: conversion.original } : {}),
        date,
        accountId,
        categoryId,
        ...(what.merchant ? { merchant: what.merchant } : {}),
        source: SOURCE[record.origin],
        captureId: record.captureId,
        review: { needed: true, reason: conversion ? 'currency' : 'auto_capture', ...(record.rawText ? { rawText: record.rawText } : {}), ...(what.card ? { card: what.card } : {}) },
        // Pagado cuando avisó el sistema: si el saldo de referencia se escribió después, ya lo incluía.
        realizedAt: record.createdAt,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      }
      newTxs.push(tx)
      if (linkTrip) tripLinks.set(linkTrip.id, [...(tripLinks.get(linkTrip.id) ?? []), tx.id])
      outflowMinor += budgetMinor
      charges.push({ txId: tx.id, amountMinor: tx.amountMinor, at, merchant })
      summary.saved.push(tx.id)
      summary.ack.push(tx.id)
      continue
    }
    if (room <= 0) {
      summary.deferred.push(record.captureId)
      continue
    }
    room -= 1
    seen.add(record.captureId)
    newProposals.push({
      captureId: record.captureId,
      capturedAt: record.createdAt,
      origin: record.origin,
      reason: reason ?? 'auto_capture',
      amount,
      ...(what.merchant ? { merchant: what.merchant } : {}),
      ...(what.card ? { card: what.card } : {}),
      accountId,
      date,
      categoryId,
      ...(similar?.txId ? { similarTxId: similar.txId } : {}),
      ...(record.rawText ? { rawText: record.rawText } : {}),
      ...(record.test ? { test: true as const } : {}),
      receivedAt: ctx.now,
    })
    if (amount.kind === 'budget' && !record.test) charges.push({ amountMinor: amount.minor, at, merchant })
    summary.proposed.push(record.captureId)
    summary.ack.push(record.captureId)
  }

  if (newTxs.length === 0 && newProposals.length === 0) return { ok: true, data, value: summary, unchanged: true }
  const transactions = [...data.transactions, ...newTxs]
  const after = linkToTrips({ ...data, transactions }, tripLinks, ctx.now)
  for (const tx of newTxs) {
    const issues = validateTransaction(tx, { data: after, today: ctx.today })
    if (issues.length) return { ok: false, issues }
  }
  const read = [...summary.saved, ...summary.proposed].map((id) => ({ id, at: ctx.now }))
  const captures: CaptureState = {
    processed: [...state.processed, ...read].slice(-CAPTURE_PROCESSED_MAX),
    proposals: [...state.proposals, ...newProposals],
  }
  return { ok: true, data: { ...after, captures, updatedAt: ctx.now }, value: summary }
}

/** «Está bien»: quita la marca «Por revisar» (y con ella el texto original) de esos movimientos. Nada más cambia. */
export function confirmReviews(data: AppData, ids: readonly string[], ctx: OpContext): OpResult<string[]> {
  const wanted = new Set(ids)
  const confirmed: string[] = []
  const transactions = data.transactions.map((t) => {
    if (!wanted.has(t.id) || !t.review) return t
    confirmed.push(t.id)
    const { review: _review, ...rest } = t
    return { ...rest, updatedAt: ctx.now }
  })
  if (confirmed.length === 0) return { ok: true, data, value: [], unchanged: true }
  return { ok: true, data: { ...data, transactions, updatedAt: ctx.now }, value: confirmed }
}

/** ¿Ya hay cuenta para esa tarjeta? (Sin distinguir mayúsculas ni acentos, como al importar.) */
export function cardIsMapped(data: Pick<AppData, 'settings'>, card: string): boolean {
  const key = normalizeText(card)
  return (data.settings.capture?.cardAccounts ?? []).some((m) => normalizeText(m.card) === key)
}

/**
 * «Tarjeta nueva»: la primera vez que llega un pago de una tarjeta sin cuenta asignada, la persona elige su cuenta. Se
 * guarda en Ajustes › Captura automática y los pagos de esa tarjeta que aún esperan revisión (movimientos «Por revisar»
 * y propuestas) pasan a esa cuenta. Lo ya revisado no cambia. Todo o nada.
 */
export function assignCardAccount(data: AppData, card: string, accountId: string, ctx: OpContext): OpResult<{ moved: string[] }> {
  const name = card.replace(/\s+/g, ' ').trim()
  if (!name || name.length > 64) return { ok: false, issues: [{ path: 'card', code: 'invalidValue' }] }
  if (!data.accounts.some((a) => a.id === accountId && !a.archived)) return { ok: false, issues: [{ path: 'accountId', code: 'unknownAccount' }] }
  const key = normalizeText(name)
  const capture = data.settings.capture ?? { autoSave: true, cardAccounts: [] }
  const cardAccounts = [...capture.cardAccounts.filter((m) => normalizeText(m.card) !== key), { card: name, accountId }]
  if (cardAccounts.length > CAPTURE_CARDS_MAX) return { ok: false, issues: [{ path: 'settings.capture.cardAccounts', code: 'tooMany', params: { max: CAPTURE_CARDS_MAX } }] }
  const moved: string[] = []
  const transactions = data.transactions.map((t) => {
    if (!t.review?.needed || !t.review.card || normalizeText(t.review.card) !== key || t.accountId === accountId) return t
    moved.push(t.id)
    return { ...t, accountId, updatedAt: ctx.now }
  })
  const state = data.captures ?? EMPTY_STATE
  const proposals = state.proposals.map((p) => {
    if (!p.card || normalizeText(p.card) !== key || p.accountId === accountId) return p
    moved.push(p.captureId)
    return { ...p, accountId }
  })
  const next: AppData = { ...data, transactions, captures: { ...state, proposals }, settings: { ...data.settings, capture: { ...capture, cardAccounts } }, updatedAt: ctx.now }
  for (const id of moved) {
    const tx = transactions.find((t) => t.id === id)
    if (!tx) continue
    const issues = validateTransaction(tx, { data: next, today: ctx.today })
    if (issues.length) return { ok: false, issues }
  }
  return { ok: true, data: next, value: { moved } }
}

/** Deshacer «Está bien»: vuelve a poner la marca que tenían, solo en los que siguen existiendo y no la tienen. */
export function reopenReviews(data: AppData, items: readonly { id: string; review: TxReview }[], ctx: OpContext): OpResult<string[]> {
  const byId = new Map(items.map((i) => [i.id, i.review]))
  const reopened: string[] = []
  const transactions = data.transactions.map((t) => {
    const review = byId.get(t.id)
    if (!review || t.review) return t
    reopened.push(t.id)
    return { ...t, review, updatedAt: ctx.now }
  })
  if (reopened.length === 0) return { ok: true, data, value: [], unchanged: true }
  return { ok: true, data: { ...data, transactions, updatedAt: ctx.now }, value: reopened }
}

/** «Descartar»: quita propuestas. Su id queda entre las leídas, así que no vuelven aunque sigan en la cola. */
export function dismissProposals(data: AppData, captureIds: readonly string[], ctx: OpContext): OpResult<string[]> {
  const wanted = new Set(captureIds)
  const state = data.captures ?? EMPTY_STATE
  const removed = state.proposals.filter((p) => wanted.has(p.captureId)).map((p) => p.captureId)
  if (removed.length === 0) return { ok: true, data, value: [], unchanged: true }
  const gone = new Set(removed)
  const processed = [...state.processed.filter((p) => !gone.has(p.id)), ...removed.map((id) => ({ id, at: ctx.now }))].slice(-CAPTURE_PROCESSED_MAX)
  const proposals = state.proposals.filter((p) => !gone.has(p.captureId))
  return { ok: true, data: { ...data, captures: { processed, proposals }, updatedAt: ctx.now }, value: removed }
}

/**
 * Deshacer «Descartar»: vuelve a poner esas propuestas, salvo las que ya se registraron por otro camino o ya están.
 * Si no caben todas (tope de propuestas), no se pone ninguna.
 */
export function restoreProposals(data: AppData, proposals: readonly CaptureProposal[], ctx: OpContext): OpResult<string[]> {
  const state = data.captures ?? EMPTY_STATE
  const back = proposals.filter(
    (p) =>
      !state.proposals.some((q) => q.captureId === p.captureId) &&
      !data.transactions.some((t) => t.id === p.captureId || t.captureId === p.captureId) &&
      !data.trash.some((e) => e.id === p.captureId || e.transaction.captureId === p.captureId),
  )
  if (back.length === 0) return { ok: true, data, value: [], unchanged: true }
  if (state.proposals.length + back.length > CAPTURE_PROPOSALS_MAX) return { ok: false, issues: [{ path: 'captures.proposals', code: 'tooMany', params: { max: CAPTURE_PROPOSALS_MAX } }] }
  return { ok: true, data: { ...data, captures: { ...state, proposals: [...state.proposals, ...back] }, updatedAt: ctx.now }, value: back.map((p) => p.captureId) }
}

/** Cómo se registra una propuesta en otra moneda: con lo que cobró el banco, o con una tasa (escrita o la del viaje). */
export type RegisterWith = number | { rate: string; rateDate: LocalDate; feeBps?: number; rateSource?: 'manual' | 'boc' }

/**
 * «Registrar»: convierte una propuesta en un gasto real, ya revisado (la persona lo acaba de mirar), con la hora del
 * pago. Una en la moneda del presupuesto usa su importe. Una en otra moneda (o con un «¥» que la moneda local del viaje
 * resuelve) se registra con lo que cobró el banco en la moneda del presupuesto (`with` = importe; la tasa queda como la
 * fracción exacta entre los dos, «cargo real») o con una tasa (`with` = tasa, fecha y comisión): en ambos casos guarda
 * `original`. Un «¥» sin resolver o un importe sin entender solo con el importe escrito, sin `original`. Clara nunca
 * elige una tasa ni una moneda. Si la moneda es del viaje en curso ese día, el gasto se asocia a ese viaje.
 */
export function registerProposal(data: AppData, captureId: string, ctx: OpContext, how?: RegisterWith): OpResult<Transaction> {
  const proposal = data.captures?.proposals.find((p) => p.captureId === captureId)
  if (!proposal) return { ok: false, issues: [{ path: 'captureId', code: 'notFound' }] }
  // La prueba de Ajustes nunca se convierte en un gasto.
  if (proposal.test) return { ok: false, issues: [{ path: 'captureId', code: 'invalidValue' }] }
  const trip = activeTrip(data, proposal.date)
  const foreign = foreignAmount(proposal.amount, trip, data.settings.numberLocale)
  let minor: number | undefined
  let original: OriginalAmount | undefined
  if (typeof how === 'object') {
    if (!foreign) return { ok: false, issues: [{ path: 'rate', code: 'invalidValue' }] }
    const feeBps = how.feeBps ?? 0
    const converted = convertToBudget(foreign.minor, foreign.currency, data.settings.currency, how.rate, feeBps)
    if (converted === null) return { ok: false, issues: [{ path: 'rate', code: 'invalidValue' }] }
    minor = converted
    original = { currency: foreign.currency, amountMinor: foreign.minor, rate: rateToText(parseRate(how.rate)!), rateDate: how.rateDate, rateSource: how.rateSource === 'boc' ? 'boc' : 'manual', ...(feeBps > 0 ? { feeBps } : {}) }
  } else {
    minor = how ?? (proposal.amount.kind === 'budget' ? proposal.amount.minor : undefined)
    const rate = how !== undefined && foreign ? rateFromAmounts(how, data.settings.currency, foreign.minor, foreign.currency) : null
    if (rate && foreign) original = { currency: foreign.currency, amountMinor: foreign.minor, rate, rateDate: proposal.date, rateSource: 'card_actual' }
  }
  if (minor === undefined) return { ok: false, issues: [{ path: 'amountMinor', code: 'currencyMismatch', params: { expected: data.settings.currency } }] }
  if (data.transactions.some((t) => t.id === captureId) || data.trash.some((e) => e.id === captureId)) {
    return { ok: false, issues: [{ path: 'captureId', code: 'duplicateId' }] }
  }
  const usable = data.accounts.some((a) => a.id === proposal.accountId && !a.archived)
  const accountId = usable ? proposal.accountId : accountForCard(data, proposal.card)
  if (!accountId) return { ok: false, issues: [{ path: 'accountId', code: 'unknownAccount' }] }
  const tx: Transaction = {
    id: captureId,
    kind: 'expense',
    status: 'realized',
    amountMinor: minor,
    currency: data.settings.currency,
    ...(original ? { original } : {}),
    date: proposal.date > ctx.today ? ctx.today : proposal.date,
    accountId,
    categoryId: proposal.categoryId ?? CAPTURE_FALLBACK_CATEGORY,
    ...(proposal.merchant ? { merchant: proposal.merchant } : {}),
    source: SOURCE[proposal.origin],
    captureId,
    realizedAt: proposal.capturedAt,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  }
  const transactions = [...data.transactions, tx]
  const issues = validateTransaction(tx, { data: { ...data, transactions }, today: ctx.today })
  if (issues.length) return { ok: false, issues }
  if (exceedsExactRange({ accounts: data.accounts, transactions, trash: data.trash })) return { ok: false, issues: [exactRangeIssue()] }
  const state = data.captures ?? EMPTY_STATE
  const proposals = state.proposals.filter((p) => p.captureId !== captureId)
  const links = new Map<string, string[]>(original && trip?.trip?.currencies.includes(original.currency) ? [[trip.id, [tx.id]]] : [])
  return { ok: true, data: linkToTrips({ ...data, transactions, captures: { ...state, proposals }, updatedAt: ctx.now }, links, ctx.now), value: tx }
}
