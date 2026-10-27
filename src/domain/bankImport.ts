/**
 * Importar movimientos desde un archivo CSV descargado del banco.
 *
 * Todo ocurre en el dispositivo: el archivo no se envía a ningún sitio.
 * Nada se guarda hasta que la persona revisa la vista previa y confirma.
 *
 * Duplicados (ver docs/FORMULAS.md §11):
 * - Cada fila recibe una huella `importRef`. Con referencia del banco (columna opcional):
 *   cuenta + referencia + fecha + importe con signo. Sin ella: cuenta + fecha + importe con signo +
 *   descripción normalizada COMPLETA + nº de repetición dentro del archivo. Si ya existe un
 *   movimiento con alguna de las dos huellas, la fila es un duplicado EXACTO y no se importa
 *   (importar dos veces el mismo archivo, o un extracto que se solapa, no crea nada nuevo).
 * - Antes la huella cortaba la descripción en 80 caracteres: dos filas distintas que empezaban igual
 *   chocaban y la segunda se omitía en silencio. Las huellas antiguas se siguen reconociendo: un
 *   movimiento importado con la misma cuenta, fecha, importe y los mismos 80 primeros caracteres es
 *   duplicado si su nota es idéntica a la descripción completa y POSIBLE duplicado si no lo es.
 * - Si hay un movimiento realizado de la misma cuenta, el mismo tipo y el mismo
 *   importe con fecha a ±3 días (y sin huella de importación), la fila es un
 *   POSIBLE duplicado: se muestra desmarcada para que la persona decida.
 * - Más de `MAX_IMPORT_ROWS` filas: se analizan las primeras y la vista previa da el número exacto de
 *   filas que quedan fuera (y cuáles); confirmar exige reconocerlo.
 */
import { addDays, isValidLocalDate, toLocalDate, daysInMonth } from './dates'
import { MAX_AMOUNT_MINOR, parseMoney, stripCurrencyMark } from './money'
import { normalizeText } from './rules'
import type { Account, AppData, LocalDate, Transaction } from './types'

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024
export const MAX_IMPORT_ROWS = 5000
export const POSSIBLE_DUPLICATE_WINDOW_DAYS = 3
const DESCRIPTION_MAX = 200
const REFERENCE_MAX = 100
/** Caracteres de la descripción que usaban las huellas anteriores (se siguen reconociendo). */
export const LEGACY_DESCRIPTION_CHARS = 80

/* ------------------------------------------------------------------ */
/* Lectura del CSV                                                     */
/* ------------------------------------------------------------------ */

export type CsvDelimiter = ',' | ';' | '\t'

/** Elige el separador que aparece más veces fuera de comillas en las primeras líneas. */
export function detectDelimiter(text: string): CsvDelimiter {
  const sample = text.slice(0, 4000)
  const counts: Record<CsvDelimiter, number> = { ',': 0, ';': 0, '\t': 0 }
  let inQuotes = false
  for (const ch of sample) {
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && (ch === ',' || ch === ';' || ch === '\t')) counts[ch]++
  }
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t'
  return counts[';'] > counts[','] ? ';' : ','
}

/**
 * Convierte el texto en filas de celdas. Admite comillas dobles (con "" como
 * comilla escapada), saltos de línea dentro de comillas, CRLF y BOM inicial.
 * Las filas totalmente vacías se descartan.
 */
export function parseCsv(input: string, delimiter: CsvDelimiter = detectDelimiter(input)): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  const pushRow = () => {
    row.push(cell)
    if (row.some((c) => c.trim() !== '')) rows.push(row.map((c) => c.trim()))
    row = []
    cell = ''
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else inQuotes = false
      } else cell += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      pushRow()
    } else cell += ch
  }
  if (cell !== '' || row.length) pushRow()
  return rows
}

/* ------------------------------------------------------------------ */
/* Columnas                                                            */
/* ------------------------------------------------------------------ */

export interface ColumnMapping {
  date: number
  description: number
  /** Una sola columna con signo (−gasto, +ingreso)… */
  amount?: number
  /** …o dos columnas: cargos (gastos) y abonos (ingresos). */
  debit?: number
  credit?: number
  /** Columna con el código de moneda de cada fila (QA-05): se valida contra la del presupuesto. */
  currency?: number
  /** Columna con la referencia del banco (número de operación): identifica cada movimiento. */
  reference?: number
}

const HEADER_HINTS: Record<'date' | 'description' | 'amount' | 'debit' | 'credit' | 'currency' | 'reference', RegExp> = {
  date: /^(fecha|date|fecha de operaci[oó]n|transaction date|posted date|posting date|date de l'op[ée]ration)/i,
  description: /(descripci[oó]n|concepto|description|detalle|details|memo|payee|libell[ée]|merchant|comercio|narrative)/i,
  amount: /^(importe|monto|amount|montant|cantidad|valor)/i,
  debit: /(cargo|d[ée]bito|debit|withdrawal|retiro|salida|egreso|money out|paid out)/i,
  credit: /(abono|cr[ée]dito|credit|deposit|dep[oó]sito|entrada|ingreso|money in|paid in)/i,
  currency: /^(moneda|currency|devise|divisa|ccy|cur\.?|iso|c[oó]digo de moneda|currency code)$/i,
  // Solo cabeceras exactas: una columna «Referencia» que en realidad es la descripción no se toma sola.
  reference: /^(referencia|reference|ref\.?|r[ée]f[ée]rence|refer[eê]ncia|id|transaction id|id de (la )?transacci[oó]n|id de operaci[oó]n|n[uú]mero de operaci[oó]n|n[ºo°]\.? de operaci[oó]n|fitid|identifiant)$/i,
}

function findColumn(header: string[], hint: RegExp, taken: Set<number>): number | undefined {
  const idx = header.findIndex((h, i) => !taken.has(i) && hint.test(h))
  return idx >= 0 ? idx : undefined
}

/**
 * Propone columnas a partir de la cabecera. Devuelve `null` si no reconoce al menos
 * fecha e importe (la persona las elige a mano).
 */
export function guessMapping(header: string[]): ColumnMapping | null {
  const taken = new Set<number>()
  const take = (i: number | undefined) => {
    if (i !== undefined) taken.add(i)
    return i
  }
  const date = take(findColumn(header, HEADER_HINTS.date, taken))
  const amount = take(findColumn(header, HEADER_HINTS.amount, taken))
  const debit = amount === undefined ? take(findColumn(header, HEADER_HINTS.debit, taken)) : undefined
  const credit = amount === undefined ? take(findColumn(header, HEADER_HINTS.credit, taken)) : undefined
  const currency = take(findColumn(header, HEADER_HINTS.currency, taken))
  const description = take(findColumn(header, HEADER_HINTS.description, taken))
  const reference = take(findColumn(header, HEADER_HINTS.reference, taken))
  if (date === undefined) return null
  if (amount === undefined && (debit === undefined || credit === undefined)) return null
  const fallbackDescription = header.findIndex((_, i) => !taken.has(i))
  return {
    date,
    description: description ?? (fallbackDescription >= 0 ? fallbackDescription : date),
    ...(amount !== undefined ? { amount } : { debit, credit }),
    ...(currency !== undefined ? { currency } : {}),
    ...(reference !== undefined ? { reference } : {}),
  }
}

/** ¿Parece una cabecera? (ninguna celda es una fecha ni un importe). */
export function looksLikeHeader(row: string[]): boolean {
  return row.every((c) => c === '' || (parseBankDate(c, 'ymd') === null && parseBankDate(c, 'dmy') === null && !/^[-−+]?[$€£]?\s?\d[\d.,\s]*$/.test(c)))
}

/* ------------------------------------------------------------------ */
/* Fechas                                                              */
/* ------------------------------------------------------------------ */

/** Orden de día/mes en el archivo. AAAA-MM-DD se reconoce siempre. */
export type BankDateFormat = 'ymd' | 'dmy' | 'mdy'

const MONTHS: Record<string, number> = {
  jan: 1, ene: 1, feb: 2, mar: 3, apr: 4, abr: 4, may: 5, jun: 6, jul: 7,
  aug: 8, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dec: 12, dic: 12,
}

function safeDate(y: number, m: number, d: number): LocalDate | null {
  if (y < 100) y += 2000
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2999 || d > daysInMonth(y, m)) return null
  const date = toLocalDate(y, m, d)
  return isValidLocalDate(date) ? date : null
}

/**
 * Lee una fecha del banco. Acepta '2026-09-28', '2026/09/28', '20260928',
 * '28/09/2026' o '09/28/2026' (según `format`), con '/', '-' o '.', y '28 Sep 2026'.
 */
export function parseBankDate(value: string, format: BankDateFormat): LocalDate | null {
  const s = value.trim().replace(/[T\s]\d{1,2}:\d{2}.*$/, '')
  const nums = (m: RegExpExecArray) => m.slice(1).map((x) => Number(x))
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  if (m) {
    const [y = 0, mo = 0, d = 0] = nums(m)
    return safeDate(y, mo, d)
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s)
  if (m) {
    const [a = 0, b = 0, y = 0] = nums(m)
    return format === 'mdy' ? safeDate(y, a, b) : safeDate(y, b, a)
  }
  m = /^(\d{1,2})[\s-]([a-zA-Z]{3})[a-zA-Z]*\.?[\s-](\d{2}|\d{4})$/.exec(s)
  if (m) {
    const month = MONTHS[(m[2] ?? '').toLowerCase()]
    return month ? safeDate(Number(m[3]), month, Number(m[1])) : null
  }
  return null
}

/**
 * Formatos de fecha con los que TODAS las fechas de la columna son válidas.
 * Si quedan 'dmy' y 'mdy' (por ejemplo, todas con día ≤ 12), la persona elige.
 */
export function possibleDateFormats(values: string[]): BankDateFormat[] {
  const formats: BankDateFormat[] = ['dmy', 'mdy']
  const nonEmpty = values.filter((v) => v.trim() !== '')
  if (nonEmpty.length && nonEmpty.every((v) => /^\d{4}/.test(v.trim()) || /[a-zA-Z]{3}/.test(v))) {
    return nonEmpty.every((v) => parseBankDate(v, 'ymd') !== null) ? ['ymd'] : []
  }
  return formats.filter((f) => nonEmpty.every((v) => parseBankDate(v, f) !== null))
}

/* ------------------------------------------------------------------ */
/* Vista previa                                                        */
/* ------------------------------------------------------------------ */

export interface ImportOptions {
  accountId: string
  mapping: ColumnMapping
  hasHeader: boolean
  dateFormat: BankDateFormat
  /** Algunos bancos (sobre todo tarjetas) muestran las compras en positivo. */
  invertSign: boolean
  /** Formato numérico de Ajustes (decide "1,234" vs "1.234"). */
  locale: string
  today: LocalDate
  /**
   * Moneda declarada para TODO el archivo (QA-05), si la persona la indica. Distinta de la del
   * presupuesto → ninguna fila se importa: Clara no convierte.
   */
  fileCurrency?: string
}

/** `currency`: la fila (o el archivo) está en otra moneda, o en una desconocida; nunca se asume la del presupuesto. */
export type ImportRowError = 'date' | 'amount' | 'zero' | 'future' | 'tooLarge' | 'currency' | 'currencyConflict'

/**
 * - trashed: el movimiento de esa fila está en la papelera → no se importa (se restaura desde la papelera).
 * - purged: se importó antes y se eliminó definitivamente → se ofrece desmarcada.
 */
export type ImportRowStatus = 'new' | 'duplicate' | 'possibleDuplicate' | 'trashed' | 'purged' | 'error'

export interface ImportRow {
  /** Número de fila en el archivo (empezando en 1, contando la cabecera). */
  line: number
  status: ImportRowStatus
  error?: ImportRowError
  date?: LocalDate
  kind?: 'income' | 'expense'
  amountMinor?: number
  description: string
  importRef?: string
  /** Movimiento existente que coincide (duplicado exacto o posible). */
  matchId?: string
  /** Fecha anterior o igual a la del saldo de referencia de la cuenta. */
  anchorRelation?: 'before' | 'sameDay' | 'after'
  /** Moneda escrita en la fila (columna propia, código o símbolo junto al importe), si la hubo. */
  currency?: string
  /** `currencyConflict` (QA V2): la otra moneda escrita en el mismo importe («-USD 10 CAD» → USD y CAD). */
  otherCurrency?: string
  /**
   * Parece el pago de una tarjeta (§8): dinero que entra en una tarjeta («PAYMENT - THANK YOU») o que
   * sale de un banco hacia una tarjeta («PAGO TARJETA VISA»). Un pago de tarjeta no es ingreso ni gasto
   * (la compra ya fue el gasto): se ofrece desmarcado para registrarlo como transferencia.
   */
  cardPaymentHint?: CardPaymentHint
}

export type CardPaymentHint = 'toCard' | 'fromBank'

/** Palabras (ya sin acentos ni mayúsculas) que señalan un pago recibido en el extracto de una tarjeta. */
const CARD_PAYMENT_IN = /\b(pago|payment|paiement|reglement|pagamento|abono|thank you|gracias|merci|obrigado|transfer|transferencia|virement)\b/
/** Palabras de tarjeta y de pago que, juntas en el extracto de un banco, señalan el pago de una tarjeta. */
const CARD_WORDS = /\b(tarjeta|card|carte|cartao|visa|mastercard|master card|amex|american express|credito|credit)\b/
const PAY_WORDS = /\b(pago|payment|paiement|pagamento|reglement|abono|transfer|transferencia|virement)\b/

/**
 * ¿Parece esta fila el pago de una tarjeta? Solo una pista: nunca cambia el tipo ni el importe. En
 * una tarjeta, dinero que entra con palabras de pago; en un banco (si hay alguna tarjeta en Clara),
 * dinero que sale con palabras de tarjeta y de pago.
 */
export function looksLikeCardPayment(description: string, kind: 'income' | 'expense', importingKind: Account['kind'], hasCreditAccount: boolean): CardPaymentHint | undefined {
  const d = normalizeText(description)
  if (importingKind === 'credit') return kind === 'income' && CARD_PAYMENT_IN.test(d) ? 'toCard' : undefined
  if (!hasCreditAccount) return undefined
  return kind === 'expense' && CARD_WORDS.test(d) && PAY_WORDS.test(d) ? 'fromBank' : undefined
}

export interface ImportPreview {
  rows: ImportRow[]
  counts: Record<ImportRowStatus, number>
  tooManyRows: boolean
  /** Filas de datos del archivo (sin cabecera). */
  totalRows: number
  /** Filas que NO se analizan ni se importan (más allá de `MAX_IMPORT_ROWS`); 0 si caben todas. */
  omittedRows: number
  /** Primera y última línea del archivo que quedan fuera (contando la cabecera), si las hay. */
  omittedLines?: { from: number; to: number }
}

/**
 * Qué filas quedan fuera de una vista previa (cuántas y cuáles), o `null` si caben todas. Reconocer
 * las filas omitidas vale solo para esta firma: otro archivo, otro contenido o leer la primera fila
 * de otra forma la cambian y hay que reconocerlo de nuevo (RT-03).
 */
export function omissionSignature(preview: Pick<ImportPreview, 'totalRows' | 'omittedRows' | 'omittedLines'>): string | null {
  if (preview.omittedRows <= 0) return null
  return `${preview.totalRows}:${preview.omittedRows}:${preview.omittedLines?.from ?? ''}-${preview.omittedLines?.to ?? ''}`
}

/** Descripción normalizada de las huellas anteriores (80 caracteres como máximo). */
export function normalizeDescription(value: string): string {
  return normalizeText(value).slice(0, LEGACY_DESCRIPTION_CHARS)
}

/** Referencia del banco: espacios simples, sin los de los extremos, 100 caracteres como máximo. */
function normalizeReference(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, REFERENCE_MAX)
}

const signedOf = (tx: Transaction) => (tx.kind === 'income' ? tx.amountMinor : -tx.amountMinor)
const prefixKeyOf = (accountId: string, date: string, signed: number, description: string) => `${accountId}|${date}|${signed}|${normalizeDescription(description)}`
const isBankRef = (ref: string | undefined) => !!ref && ref.includes('|ref|')

type AmountRead = { ok: true; value: number; currency?: string } | { ok: false; error: ImportRowError; currency?: string; otherCurrency?: string }

function signedAmount(cells: string[], mapping: ColumnMapping, currency: string, locale: string): AmountRead {
  // Columna de moneda (QA-05): un código distinto del presupuesto, o desconocido, no se importa.
  let explicit: string | undefined
  if (mapping.currency !== undefined) {
    const raw = (cells[mapping.currency] ?? '').trim().toUpperCase()
    if (raw !== '') {
      if (raw !== currency) return { ok: false, error: 'currency', currency: raw }
      explicit = raw
    }
  }
  const read = (i: number | undefined): { ok: true; minor: number; empty: boolean; currency?: string } | { ok: false; error: ImportRowError; currency?: string; otherCurrency?: string } => {
    const raw = (i === undefined ? '' : (cells[i] ?? '')).replace(/^\((.*)\)$/, '-$1')
    if (raw.trim() === '') return { ok: true, minor: 0, empty: true }
    const r = parseMoney(raw.replace(/^\+/, ''), currency, locale, { allowNegative: true, allowZero: true })
    if (r.ok) {
      const mark = stripCurrencyMark(raw).mark
      return { ok: true, minor: r.minor, empty: false, ...(mark && 'code' in mark ? { currency: mark.code } : {}) }
    }
    if (r.error === 'currencyMismatch' || r.error === 'unknownCurrency') return { ok: false, error: 'currency', currency: r.found }
    // QA V2 (CUR-02): «-USD 10 CAD», «€10 CAD»: dos monedas que se contradicen; nunca se importa como ninguna.
    if (r.error === 'currencyConflict') return { ok: false, error: 'currencyConflict', currency: r.found, otherCurrency: r.other }
    return { ok: false, error: r.error === 'tooLarge' ? 'tooLarge' : 'amount' }
  }
  if (mapping.amount !== undefined) {
    const r = read(mapping.amount)
    if (!r.ok) return r
    if (r.empty) return { ok: false, error: 'amount' }
    return { ok: true, value: r.minor, currency: r.currency ?? explicit }
  }
  const debit = read(mapping.debit)
  const credit = read(mapping.credit)
  if (!debit.ok) return debit
  if (!credit.ok) return credit
  if (debit.empty && credit.empty) return { ok: false, error: 'amount' }
  // Los cargos pueden venir con o sin signo: siempre restan.
  return { ok: true, value: Math.abs(credit.minor) - Math.abs(debit.minor), currency: debit.currency ?? credit.currency ?? explicit }
}

/**
 * Analiza el archivo SIN tocar los datos: cada fila queda como nueva, duplicada,
 * posible duplicado o con error.
 */
export function previewImport(table: string[][], data: AppData, options: ImportOptions): ImportPreview {
  const account = data.accounts.find((a) => a.id === options.accountId)
  const hasCreditAccount = data.accounts.some((a) => a.kind === 'credit')
  const body = options.hasHeader ? table.slice(1) : table
  const tooManyRows = body.length > MAX_IMPORT_ROWS
  const limited = body.slice(0, MAX_IMPORT_ROWS)
  const omittedRows = Math.max(0, body.length - MAX_IMPORT_ROWS)
  const headerLines = options.hasHeader ? 1 : 0
  const currency = data.settings.currency

  const existingRefs = new Map<string, string>()
  for (const tx of data.transactions) if (tx.importRef) existingRefs.set(tx.importRef, tx.id)
  const trashedRefs = new Map<string, string>()
  for (const e of data.trash) if (e.transaction.importRef) trashedRefs.set(e.transaction.importRef, e.id)
  const purgedRefs = new Set(data.purgedImportRefs)
  // Importados antes (también los de la papelera), por cuenta + fecha + importe + 80 primeros caracteres.
  const byPrefix = new Map<string, { tx: Transaction; trashId?: string }[]>()
  const addPrefix = (tx: Transaction, trashId?: string) => {
    if (!tx.importRef || (tx.kind !== 'income' && tx.kind !== 'expense')) return
    const key = prefixKeyOf(tx.accountId, tx.date, signedOf(tx), tx.note ?? '')
    const list = byPrefix.get(key) ?? []
    list.push({ tx, ...(trashId ? { trashId } : {}) })
    byPrefix.set(key, list)
  }
  for (const tx of data.transactions) addPrefix(tx)
  for (const e of data.trash) addPrefix(e.transaction, e.id)
  const usedImported = new Set<string>()
  // Candidatos a posible duplicado: movimientos realizados de la cuenta registrados a mano.
  const candidates = data.transactions.filter(
    (tx) => tx.status === 'realized' && !tx.importRef && tx.accountId === options.accountId && (tx.kind === 'income' || tx.kind === 'expense'),
  )
  const usedCandidates = new Set<string>()
  const repeats = new Map<string, number>()
  const count = (key: string) => {
    const n = (repeats.get(key) ?? 0) + 1
    repeats.set(key, n)
    return n
  }

  const rows: ImportRow[] = limited.map((cells, i) => {
    const line = i + 1 + headerLines
    const description = (cells[options.mapping.description] ?? '').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX)
    const date = parseBankDate(cells[options.mapping.date] ?? '', options.dateFormat)
    if (!date) return { line, status: 'error', error: 'date', description }
    if (options.fileCurrency && options.fileCurrency.toUpperCase() !== currency) return { line, status: 'error', error: 'currency', date, description, currency: options.fileCurrency.toUpperCase() }
    const amount = signedAmount(cells, options.mapping, currency, options.locale)
    if (!amount.ok) return { line, status: 'error', error: amount.error, date, description, ...(amount.currency ? { currency: amount.currency } : {}), ...(amount.otherCurrency ? { otherCurrency: amount.otherCurrency } : {}) }
    const signed = options.invertSign ? -amount.value : amount.value
    if (signed === 0) return { line, status: 'error', error: 'zero', date, description }
    const amountMinor = Math.abs(signed)
    if (amountMinor > MAX_AMOUNT_MINOR) return { line, status: 'error', error: 'tooLarge', date, description }
    if (date > options.today) return { line, status: 'error', error: 'future', date, description }
    const kind = signed > 0 ? 'income' : 'expense'

    // Huellas: por contenido completo (siempre) y por referencia del banco (si la hay).
    const full = normalizeText(description)
    const contentKey = `${options.accountId}|${date}|${signed}|${full}`
    const contentRef = `${contentKey}|${count(contentKey)}`
    const reference = options.mapping.reference !== undefined ? normalizeReference(cells[options.mapping.reference]) : ''
    const bankKey = reference ? `${options.accountId}|ref|${reference}|${date}|${signed}` : ''
    const bankRef = bankKey ? `${bankKey}|${count(`bank:${bankKey}`)}` : undefined
    const prefixKey = prefixKeyOf(options.accountId, date, signed, description)
    const legacyRef = `${prefixKey}|${count(`legacy:${prefixKey}`)}`
    const importRef = bankRef ?? contentRef
    const refs = bankRef ? [bankRef, contentRef] : [contentRef]
    const anchorRelation = !account ? undefined : date < account.anchor.date ? 'before' : date === account.anchor.date ? 'sameDay' : 'after'
    const cardPaymentHint = looksLikeCardPayment(description, kind, account?.kind ?? 'bank', hasCreditAccount)
    const base = { line, date, kind, amountMinor, description, importRef, anchorRelation, ...(amount.currency ? { currency: amount.currency } : {}), ...(cardPaymentHint ? { cardPaymentHint } : {}) } as const

    const exact = refs.map((r) => existingRefs.get(r)).find(Boolean)
    if (exact) {
      usedImported.add(exact)
      return { ...base, status: 'duplicate', matchId: exact }
    }
    const trashed = refs.map((r) => trashedRefs.get(r)).find(Boolean)
    if (trashed) return { ...base, status: 'trashed', matchId: trashed }
    if (refs.some((r) => purgedRefs.has(r))) return { ...base, status: 'purged' }
    // Importados antes con los mismos 80 primeros caracteres (huellas antiguas o descripciones que
    // empiezan igual). Una fila con referencia del banco no se compara con otra que tenía otra
    // referencia: si fueran el mismo movimiento, su huella ya habría coincidido.
    const sharing = (byPrefix.get(prefixKey) ?? []).filter((m) => !usedImported.has(m.tx.id) && !(bankRef && isBankRef(m.tx.importRef)))
    const same = sharing.find((m) => normalizeText(m.tx.note ?? '') === full)
    if (same) {
      usedImported.add(same.tx.id)
      return same.trashId ? { ...base, status: 'trashed', matchId: same.trashId } : { ...base, status: 'duplicate', matchId: same.tx.id }
    }
    const similar = sharing[0]
    if (similar) {
      usedImported.add(similar.tx.id)
      return { ...base, status: 'possibleDuplicate', matchId: similar.tx.id }
    }
    // Huella antigua de 80 caracteres (por ejemplo, la nota se editó después): no se puede comprobar
    // el contenido, así que se ofrece desmarcada en lugar de importarla otra vez sin avisar.
    const legacy = existingRefs.get(legacyRef) ?? trashedRefs.get(legacyRef)
    if (legacy && !usedImported.has(legacy)) {
      usedImported.add(legacy)
      return { ...base, status: 'possibleDuplicate', matchId: legacy }
    }
    if (purgedRefs.has(legacyRef)) return { ...base, status: 'purged' }
    const match = candidates.find(
      (tx) =>
        !usedCandidates.has(tx.id) &&
        tx.kind === kind &&
        tx.amountMinor === amountMinor &&
        tx.date >= addDays(date, -POSSIBLE_DUPLICATE_WINDOW_DAYS) &&
        tx.date <= addDays(date, POSSIBLE_DUPLICATE_WINDOW_DAYS),
    )
    if (match) {
      usedCandidates.add(match.id)
      return { ...base, status: 'possibleDuplicate', matchId: match.id }
    }
    return { ...base, status: 'new' }
  })

  const counts: Record<ImportRowStatus, number> = { new: 0, duplicate: 0, possibleDuplicate: 0, trashed: 0, purged: 0, error: 0 }
  for (const r of rows) counts[r.status]++
  return {
    rows,
    counts,
    tooManyRows,
    totalRows: body.length,
    omittedRows,
    ...(omittedRows > 0 ? { omittedLines: { from: MAX_IMPORT_ROWS + 1 + headerLines, to: body.length + headerLines } } : {}),
  }
}

/** Filas que se ofrecen marcadas por defecto: solo las nuevas que no parecen pagos de tarjeta. */
export function defaultSelection(preview: ImportPreview): Set<number> {
  return new Set(preview.rows.filter((r) => r.status === 'new' && !r.cardPaymentHint).map((r) => r.line))
}

export function isImportable(row: ImportRow): row is ImportRow & Required<Pick<ImportRow, 'date' | 'kind' | 'amountMinor' | 'importRef'>> {
  return row.status !== 'error' && row.status !== 'duplicate' && row.status !== 'trashed' && !!row.date && !!row.kind && !!row.amountMinor && !!row.importRef
}
