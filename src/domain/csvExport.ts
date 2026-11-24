/**
 * Exportación CSV de movimientos (§7.4): una fila por movimiento, importes en unidades mayores
 * con punto decimal (formato neutro para hojas de cálculo), fechas ISO, UTF-8 con BOM para
 * Excel. Las etiquetas (categoría, cuenta, tipo) las resuelve quien llama, ya traducidas.
 */
import { minorToDecimalString } from './money'
import type { Category, Plan, RateSource, Transaction } from './types'

export interface CsvLabels {
  headers: readonly string[]
  kind: (tx: Transaction) => string
  status: (tx: Transaction) => string
  category: (tx: Transaction) => string
  account: (id: string | undefined) => string
  /** Origen del registro (manual, asistente, atajo…): columna final si se indica. */
  source?: (tx: Transaction) => string
  /**
   * Fase 3: con esto, seis columnas más tras el origen, con el importe en la moneda en que se pagó (`original`):
   * importe (mismo signo que el convertido), moneda, tasa exacta, fecha de la tasa, de dónde salió y comisión (%).
   * Vacías en los movimientos sin `original`.
   */
  rateSource?: (source: RateSource) => string
  /** Separador de columnas: «;» cuando el locale usa coma decimal (Excel lo espera así), «,» si no. */
  separator?: ',' | ';'
}

/** Claves de cabecera de las columnas de movimientos, en orden (las de `source` y `rateSource` al final). */
export const TX_CSV_COLUMNS = ['date', 'kind', 'status', 'amount', 'currency', 'category', 'account', 'toAccount', 'note', 'merchant', 'id', 'source'] as const
export const TX_CSV_ORIGINAL_COLUMNS = ['originalAmount', 'originalCurrency', 'rate', 'rateDate', 'rateSource', 'fee'] as const

/** Puntos básicos → porcentaje con punto decimal: 250 → «2.50». */
function bpsToPercent(bps: number): string {
  return `${Math.trunc(bps / 100)}.${String(bps % 100).padStart(2, '0')}`
}

/**
 * Columnas del importe original. La tasa va tal cual (exacta, con punto); una fracción del cargo real («1117/120000»)
 * lleva un apóstrofo delante para que la hoja de cálculo no la convierta en fecha.
 */
function originalCells(tx: Transaction, rateSource: (s: RateSource) => string): string[] {
  const o = tx.original
  if (!o) return ['', '', '', '', '', '']
  const sign = signedAmount(tx) < 0 ? -1 : 1
  return [minorToDecimalString(sign * o.amountMinor, o.currency), o.currency, o.rate.includes('/') ? `'${o.rate}` : o.rate, o.rateDate, safeText(rateSource(o.rateSource)), o.feeBps ? bpsToPercent(o.feeBps) : '']
}

/** Separador según el separador decimal del locale (§7.7 · Exportar datos). */
export function csvSeparatorFor(decimalSeparator: string): ',' | ';' {
  return decimalSeparator === ',' ? ';' : ','
}

function cell(value: string | number | undefined): string {
  const s = value === undefined ? '' : String(value)
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Texto que una hoja de cálculo ejecutaría como fórmula al abrir el CSV (QA-07): empieza por
 * «=», «+», «−», «@», tabulador o retorno de carro, con o sin espacios delante. Entrecomillarlo
 * no basta (Excel sigue evaluando `"=1+1"`).
 */
export const FORMULA_TRIGGER = /^[\s\u00a0]*[=+\-@\t\r]/

/**
 * Texto escrito por la persona (notas, comercios, nombres) listo para una hoja de cálculo: si
 * podría leerse como fórmula se antepone un apóstrofo, la convención de Excel, LibreOffice y
 * Sheets para «esto es texto». Fidelidad: una nota que empiece por «-» o «+» se verá con ese
 * apóstrofo delante; los importes no pasan por aquí (siguen siendo números con signo). Los
 * caracteres de control (salvo tabulador y saltos de línea, que se entrecomillan) se quitan.
 */
export function safeText(value: string | undefined): string {
  const s = (value ?? '').replace(/[^\P{Cc}\t\n\r]/gu, '')
  return FORMULA_TRIGGER.test(s) ? `'${s}` : s
}

/** Celda de texto libre: neutralizada y entrecomillada si hace falta. */
function textCell(value: string | undefined): string {
  return cell(safeText(value))
}

const BOM = '\uFEFF'

function table(headers: readonly string[], rows: readonly (readonly (string | number | undefined)[])[], sep: ',' | ';'): string {
  return [headers.map(cell).join(sep), ...rows.map((r) => r.map(cell).join(sep))].join('\r\n')
}

/** Signo según el efecto sobre la cuenta de origen: gasto y transferencia negativos; ingreso y devolución positivos. */
export function signedAmount(tx: Transaction): number {
  if (tx.kind === 'income' || tx.kind === 'refund') return tx.amountMinor
  if (tx.kind === 'adjustment') return tx.adjustmentDirection === 'increase' ? tx.amountMinor : -tx.amountMinor
  return -tx.amountMinor
}

export function transactionsToCsv(txs: readonly Transaction[], labels: CsvLabels): string {
  const sep = labels.separator ?? ','
  // Fechas, importes, monedas e ids son valores generados: van tal cual. El resto es texto de la
  // persona (o etiquetas que pueden serlo, como una categoría propia) y pasa por `safeText`.
  const rows = txs.map((tx) => [
    tx.date,
    safeText(labels.kind(tx)),
    safeText(labels.status(tx)),
    minorToDecimalString(signedAmount(tx), tx.currency),
    tx.currency,
    safeText(labels.category(tx)),
    safeText(labels.account(tx.accountId)),
    tx.kind === 'transfer' ? safeText(labels.account(tx.toAccountId)) : '',
    safeText(tx.note),
    safeText(tx.merchant),
    tx.id,
    ...(labels.source ? [safeText(labels.source(tx))] : []),
    ...(labels.rateSource ? originalCells(tx, labels.rateSource) : []),
  ])
  return `${BOM}${table(labels.headers, rows, sep)}\r\n`
}

export interface CategoryCsvLabels {
  headers: readonly string[]
  kind: (c: Category) => string
  group: (c: Category) => string
  name: (c: Category) => string
  yes: string
  no: string
  separator?: ',' | ';'
}

/** Categorías (del sistema y propias) con grupo, tipo, color, icono y estado. */
export function categoriesToCsv(categories: readonly Category[], labels: CategoryCsvLabels): string {
  const rows = categories.map((c) => [c.id, safeText(labels.name(c)), safeText(labels.kind(c)), safeText(labels.group(c)), c.color, c.icon, c.archived ? labels.yes : labels.no, c.isCustom ? labels.yes : labels.no])
  return `${BOM}${table(labels.headers, rows, labels.separator ?? ',')}\r\n`
}

export interface PlanCsvLabels {
  headers: readonly string[]
  name: (p: Plan) => string
  period: (p: Plan) => string
  status: (p: Plan) => string
  categories: (p: Plan) => string
  yes: string
  no: string
  separator?: ',' | ';'
}

/** Planes (límites) con su ciclo, importe, recurrencia y resultado si cerraron. */
export function plansToCsv(plans: readonly Plan[], labels: PlanCsvLabels): string {
  const rows = plans.map((p) => [
    p.id,
    safeText(labels.name(p)),
    safeText(labels.categories(p)),
    minorToDecimalString(p.amountMinor, p.currency),
    p.currency,
    safeText(labels.period(p)),
    p.startDate ?? '',
    p.endDate ?? '',
    p.recurring ? labels.yes : labels.no,
    safeText(labels.status(p)),
    p.result ? minorToDecimalString(p.result.spentMinor, p.currency) : '',
    p.result ? (p.result.achieved ? labels.yes : labels.no) : '',
  ])
  return `${BOM}${table(labels.headers, rows, labels.separator ?? ',')}\r\n`
}

/** Varias tablas en un solo archivo, separadas por una línea en blanco y un título. */
export function joinCsvSections(sections: readonly { title: string; csv: string }[]): string {
  return `${BOM}${sections.map((s) => `${textCell(s.title)}\r\n${s.csv.replace(BOM, '')}`).join('\r\n')}`
}
