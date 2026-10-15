/**
 * Modelo de datos de Clara.
 *
 * Reglas clave (ver docs/FORMULAS.md):
 * - Todo importe se guarda como ENTERO en unidades menores (centavos para CAD).
 * - Las fechas de calendario (`LocalDate`) son texto 'AAAA-MM-DD' sin hora ni zona.
 * - Las marcas de tiempo (`Timestamp`) son ISO 8601 en UTC ('2026-09-28T14:05:00.000Z').
 * - Un presupuesto usa una sola moneda; cada registro guarda su moneda y se valida.
 */

/** Fecha de calendario 'AAAA-MM-DD' (sin hora ni zona horaria). */
export type LocalDate = string
/** Marca de tiempo ISO 8601 en UTC. */
export type Timestamp = string
/** Código ISO 4217, por ejemplo 'CAD'. */
export type CurrencyCode = string

export const SCHEMA_VERSION = 13 as const

/**
 * 'credit' = tarjeta de crédito: su saldo es una DEUDA y se guarda como número
 * negativo. Las compras son gastos de esa cuenta; el pago de la tarjeta es una
 * transferencia desde otra cuenta (nunca un gasto), así nada se cuenta dos veces.
 */
/** v13: `wallet` (monedero digital), `prepaid` (tarjeta prepagada) e `investment` (saldo de inversión escrito a mano; sin cotizaciones). */
export type AccountKind = 'bank' | 'cash' | 'savings' | 'credit' | 'wallet' | 'prepaid' | 'investment' | 'other'

/**
 * Saldo de referencia que el usuario escribe (por ejemplo, copiado de su banco).
 * Se considera que incluye todo lo ocurrido hasta `setAt` en la fecha `date`.
 */
export interface BalanceAnchor {
  /** Puede ser negativo (sobregiro). */
  amountMinor: number
  date: LocalDate
  setAt: Timestamp
}

/**
 * Datos opcionales de una tarjeta de crédito. Las cifras derivadas (pago mínimo,
 * intereses) son ESTIMACIONES para orientar; el banco manda.
 */
export interface CardDetails {
  /** Límite de crédito. */
  limitMinor?: number
  /** Tasa anual en puntos básicos (19,99 % = 1999). */
  aprBps?: number
  /** Día del mes de la fecha de corte (1–31; en meses cortos, el último día). */
  statementDay?: number
  /** Día del mes en que vence el pago (1–31; en meses cortos, el último día). */
  dueDay?: number
  /** Pago mínimo: porcentaje de la deuda en puntos básicos (3 % = 300). */
  minPaymentBps?: number
  /** Pago mínimo: importe fijo mínimo. */
  minPaymentFloorMinor?: number
}

export interface Account {
  id: string
  name: string
  kind: AccountKind
  /** Si es `true`, su saldo cuenta para "Disponible hasta el próximo ingreso". */
  includeInBudget: boolean
  anchor: BalanceAnchor
  /** Solo tarjetas de crédito. */
  card?: CardDetails
  /** v13 · Banco o emisor, solo como texto para reconocerla (nunca se conecta a nada). */
  institution?: string
  /**
   * v11. Archivada: conserva su historial y su saldo, pero no se ofrece para registrar ni
   * programar, y no cuenta para el presupuesto ni para el patrimonio. Se puede restaurar.
   */
  archived?: boolean
  /** v11. Posición en las listas (menor primero). La migración la rellena con el orden existente. */
  order?: number
  createdAt: Timestamp
  updatedAt: Timestamp
}

/**
 * 'adjustment' = ajuste de conciliación: corrige el saldo de UNA cuenta para que
 * coincida con el saldo observado en el banco. No es ingreso ni gasto: no aparece
 * en resúmenes de consumo ni en el promedio de gasto diario.
 */
export type TxKind = 'income' | 'expense' | 'transfer' | 'refund' | 'adjustment'
export type TxStatus = 'planned' | 'realized'
export type AdjustmentDirection = 'increase' | 'decrease'

export interface Transaction {
  id: string
  kind: TxKind
  status: TxStatus
  /** Siempre positivo; el tipo decide si suma o resta. */
  amountMinor: number
  currency: CurrencyCode
  date: LocalDate
  /** Cuenta de origen (o la única cuenta si no es transferencia). */
  accountId: string
  /** Solo transferencias: cuenta de destino. */
  toAccountId?: string
  /** Ingresos, gastos y devoluciones. */
  categoryId?: string
  /** Devoluciones: gasto original (opcional). */
  refundOfId?: string
  note?: string
  /** Si este movimiento liquida una ocurrencia de un pago programado. */
  scheduleId?: string
  occurrenceDate?: LocalDate
  /**
   * Momento en que el movimiento pasó a "realizado". Decide, junto con la fecha,
   * si ya estaba incluido en el saldo de referencia de la cuenta.
   */
  realizedAt?: Timestamp
  /**
   * Huella de la fila del archivo bancario de la que vino (cuenta + fecha + importe +
   * descripción + nº de repetición). Evita importar dos veces la misma fila.
   */
  importRef?: string
  /** Solo ajustes: si sube o baja el saldo de la cuenta (el importe siempre es positivo). */
  adjustmentDirection?: AdjustmentDirection
  /** Solo ajustes: conciliación que lo originó. */
  reconciliationId?: string
  /**
   * Solo liquidaciones de ocurrencias: `true` = pago o cobro parcial, todavía se espera
   * el resto. Una ocurrencia queda cerrada cuando tiene una liquidación NO parcial.
   */
  partialSettlement?: boolean
  /**
   * Compra dividida entre categorías (solo gastos) o reparto de una devolución entre las
   * categorías de la compra original. Son ASIGNACIONES del mismo movimiento: no afectan
   * al saldo por separado. Σ líneas = `amountMinor` exacto; `categoryId` = la de la 1.ª línea.
   */
  splits?: SplitLine[]
  /* ---- v9 (opcionales) ---- */
  /** Comercio o lugar (distinto de la nota). */
  merchant?: string
  tagIds?: string[]
  /** Entrada común (favorito) desde la que se rellenó el formulario; solo para contar usos. */
  favoriteId?: string
  /** Cómo se registró. Ausente en datos anteriores a v9 = manual. */
  source?: TransactionSource
  /** Recibo asociado (URL de datos o referencia al almacén de archivos). */
  receiptUri?: string
  lat?: number
  lng?: number
  /** Saldo inicial registrado en el onboarding como ingreso (editable después). */
  isInitialBalance?: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type TransactionSource = 'manual' | 'ai_text' | 'voice' | 'photo' | 'scheduled' | 'common' | 'shortcut' | 'import'

export interface SplitLine {
  id: string
  categoryId: string
  amountMinor: number
  note?: string
}

/** Rango de un ingreso variable. El importe esperado es `Schedule.amountMinor`. */
export interface IncomeRange {
  /** Mínimo estimado (≥ 0). También es una estimación, no una garantía. */
  minMinor: number
  /** Escenario extra u optimista (≥ esperado). */
  extraMinor: number
}

export type IncomeScenario = 'min' | 'expected' | 'extra'

/** v13: `semimonthly` = dos veces al mes (el día de `startDate` y `secondDay`). */
export type Frequency = 'once' | 'daily' | 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'
export type ScheduleKind = 'income' | 'expense'

/** Pago o ingreso programado (único o recurrente). */
export interface Schedule {
  id: string
  name: string
  kind: ScheduleKind
  amountMinor: number
  /** Importe aproximado (por ejemplo, ingresos variables). */
  amountIsEstimate: boolean
  /** Solo ingresos variables: mínimo y extra. `amountMinor` es el esperado. */
  range?: IncomeRange
  currency: CurrencyCode
  accountId: string
  categoryId?: string
  frequency: Frequency
  /** Primera fecha pendiente. También fija el día del mes para pagos mensuales. */
  startDate: LocalDate
  endDate?: LocalDate
  reminderDaysBefore: number
  /** Ocurrencias que el usuario decidió omitir. */
  skippedDates: LocalDate[]
  note?: string
  /* ---- v9 (opcionales) ---- */
  /** Solo `frequency: 'custom'`: cada N días. */
  intervalDays?: number
  /** v13 · Solo `frequency: 'semimonthly'`: el otro día del mes (1–31, a ≥ 7 días del de `startDate`). */
  secondDay?: number
  /**
   * `true`: la ocurrencia se registra sola al llegar su fecha (al abrir la app o a medianoche).
   * Ausente o `false`: queda «por confirmar» (nunca se registra sin confirmación).
   */
  autoConfirm?: boolean
  /** En pausa: no genera ocurrencias ni avisos hasta reanudar. */
  paused?: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}

/** Movimiento virtual de dinero hacia (+) o desde (−) una meta. No toca el banco. */
export interface GoalAllocation {
  id: string
  amountMinor: number
  date: LocalDate
  createdAt: Timestamp
  /**
   * Motivo (opcional; las copias antiguas no lo tienen):
   * contribution = aporte confirmado; release = liberado a mano;
   * payment = usado al pagar un gasto planificado; carry = sobrante que pasa al siguiente periodo.
   */
  reason?: AllocationReason
  /** Distribución de un ingreso que creó este apartado (v7, opcional). */
  distributionId?: string
}

export type AllocationReason = 'contribution' | 'release' | 'payment' | 'carry'

/** Un periodo ya pagado de un gasto planificado (historial). */
export interface PlannedExpenseCycle {
  dueDate: LocalDate
  targetMinor: number
  /** Lo que estaba apartado al pagar. */
  reservedMinor: number
  paidMinor: number
  /** Movimiento real del pago. */
  txId: string
  /** Qué se hizo con el sobrante (si lo hubo). */
  surplus: 'none' | 'release' | 'carry'
  paidAt: Timestamp
}

/** Datos extra de una meta de tipo «gasto planificado» (matrícula, seguro, regalos…). */
export interface PlannedExpense {
  /** Cada cuántos meses se repite (1–24). Sin valor = una sola vez. */
  repeatEveryMonths?: number
  /** Ocurrencia del calendario que este dinero cubrirá (opcional). */
  link?: { scheduleId: string; occurrenceDate: LocalDate }
  /** Categoría del gasto real al pagar. */
  categoryId?: string
  history: PlannedExpenseCycle[]
  /** Solo gastos de una vez: ya se pagó (queda como historial). */
  paidAt?: Timestamp
}

export type GoalFunding = 'budget' | 'external'

export interface Goal {
  id: string
  name: string
  /** 'expense' = gasto planificado (anual o poco frecuente): exige fecha de vencimiento. */
  kind: 'goal' | 'emergency' | 'expense'
  targetMinor: number
  /** En gastos planificados, la fecha de vencimiento del periodo actual. */
  targetDate?: LocalDate
  currency: CurrencyCode
  /**
   * 'budget': el dinero apartado está en cuentas del presupuesto y se descuenta del disponible.
   * 'external': el dinero está en otra cuenta fuera del presupuesto; solo se registra el progreso.
   */
  fundedFrom: GoalFunding
  allocations: GoalAllocation[]
  /** Solo `kind: 'expense'`. */
  plan?: PlannedExpense
  /* ---- v9 (opcionales) ---- */
  icon?: string
  color?: CategoryColor
  /* ---- v10 (opcional) ---- */
  /**
   * Aporte periódico sugerido. Es un recordatorio: «Aportar ahora» lo propone como importe y la
   * persona confirma. Nunca aparta dinero solo (los apartados son virtuales; ver decisión 33).
   */
  contribution?: GoalContribution
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type ContributionFrequency = 'weekly' | 'biweekly' | 'monthly'

export interface GoalContribution {
  amountMinor: number
  frequency: ContributionFrequency
}

/** Uno de los 16 colores de categoría (§4): el token CSS es `--cat-<color>`. */
export type CategoryColor =
  | 'emerald' | 'green' | 'lime' | 'yellow' | 'amber' | 'orange' | 'red' | 'rose'
  | 'pink' | 'purple' | 'violet' | 'indigo' | 'blue' | 'sky' | 'cyan' | 'teal'

/** Categoría creada por la persona. Las del sistema viven en `categories.ts` (+ `categoryPrefs`). */
export interface CustomCategory {
  /** Empieza por `c_` para no chocar nunca con una categoría del sistema. */
  id: string
  name: string
  kind: 'expense' | 'income'
  /** Archivada: no se ofrece en formularios, pero los movimientos antiguos la conservan. */
  archived: boolean
  /* ---- v9 (la migración los rellena; opcionales para datos y pruebas anteriores) ---- */
  groupId?: string
  icon?: string
  color?: CategoryColor
  sortOrder?: number
  createdAt: Timestamp
  updatedAt: Timestamp
}

/**
 * Categoría resuelta (del sistema o personalizada) con la forma de §5. Las del sistema se
 * traducen por `nameKey`; `name` es el nombre escrito por la persona (personalizadas o renombradas).
 */
export interface Category {
  id: string
  kind: 'expense' | 'income'
  nameKey?: string
  name?: string
  groupId: string
  icon: string
  color: CategoryColor
  isCustom: boolean
  archived: boolean
  sortOrder: number
}

/** Ajustes de la persona sobre una categoría DEL SISTEMA (renombrar, archivar, mover, reordenar). */
export interface CategoryPref {
  name?: string
  archived?: boolean
  groupId?: string
  icon?: string
  color?: CategoryColor
  sortOrder?: number
}

export interface CategoryGroup {
  id: string
  nameKey?: string
  name?: string
  color: CategoryColor
  sortOrder: number
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

export interface Tag {
  id: string
  name: string
  color: CategoryColor
  createdAt: Timestamp
  updatedAt: Timestamp
}

/* ------------------------------------------------------------------ */
/* Planes de gasto (límites) — v9                                      */
/* ------------------------------------------------------------------ */

export type BudgetPeriodType = 'week' | 'biweek' | 'month' | 'quarter' | 'semester' | 'year' | 'custom' | 'untilIncome'

export interface PlanResult {
  spentMinor: number
  achieved: boolean
  /** Positivo = quedó margen; negativo = se superó. */
  deltaMinor: number
  closedAt: Timestamp
}

/**
 * Límite de gasto para una o varias categorías (vacío = todas) en un periodo. Informativo:
 * no mueve dinero ni cambia el disponible. Las metas de ahorro son `Goal`.
 */
export interface Plan {
  id: string
  kind: 'limit'
  /** Puede estar vacío: la interfaz muestra entonces la(s) categoría(s). */
  name: string
  categoryIds: string[]
  amountMinor: number
  currency: CurrencyCode
  periodType: BudgetPeriodType
  /**
   * Ciclo en curso (ambos incluidos). Personalizados: fechas explícitas. Recurrentes: se fija al
   * crear y se renueva al cerrar; si falta (datos migrados), el primer cierre lo rellena con el
   * periodo que contiene «hoy».
   */
  startDate?: LocalDate
  endDate?: LocalDate
  recurring: boolean
  status: 'active' | 'completed' | 'paused'
  /** Plan del que se renovó (recurrencia) o se repitió; para el historial. */
  previousPlanId?: string
  alertAt80: boolean
  alertAt100: boolean
  result?: PlanResult
  /**
   * v12. Arrastre al renovar un plan recurrente: `none` = cada ciclo empieza con el límite base;
   * `carry` = lo no gastado se suma al límite del ciclo siguiente y lo excedido se resta (nunca
   * por debajo de 0). Es una regla de presupuesto, no de dinero: no cambia saldos ni el disponible.
   */
  rollover?: PlanRollover
  /** v12. Cuánto aportó el arrastre al límite de este ciclo (positivo o negativo); el límite base = `amountMinor − carriedMinor`. */
  carriedMinor?: number
  createdAt: Timestamp
  updatedAt: Timestamp
}

/** Límite mensual de gasto neto para una categoría (informativo: no cambia el disponible). */
export type PlanRollover = 'none' | 'carry'

export interface CategoryLimit {
  categoryId: string
  monthlyLimitMinor: number
}

/**
 * Regla de categoría: si la descripción contiene `pattern` (sin distinguir mayúsculas
 * ni acentos), se propone `categoryId`. Solo PROPONE: la persona puede cambiarla.
 */
export interface CategoryRule {
  id: string
  pattern: string
  kind: 'expense' | 'income'
  categoryId: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

/**
 * Movimiento en la papelera. Ya NO está en `transactions`, así que no participa en
 * saldos, presupuestos, proyecciones ni reportes. Una transferencia es un único
 * registro con sus dos lados, por lo que se elimina y restaura completa.
 */
export interface TrashEntry {
  /** Igual al id del movimiento. */
  id: string
  deletedAt: Timestamp
  transaction: Transaction
  /** Devoluciones que perdieron el vínculo con este gasto al eliminarlo (se recuperan al restaurar). */
  unlinkedRefundIds: string[]
  /** Reparto por categorías de esas devoluciones (se quita mientras el gasto está en la papelera). */
  unlinkedRefundSplits?: Record<string, SplitLine[]>
}

/** Plantilla de un gasto o ingreso frecuente. Nunca registra nada por sí sola. */
export interface Favorite {
  id: string
  name: string
  kind: 'expense' | 'income'
  /** Puede apuntar a una cuenta que ya no existe: el formulario pide elegir otra. */
  accountId: string
  categoryId: string
  amountMinor?: number
  note?: string
  /** Posición en la lista (0, 1, 2…). */
  order: number
  /* ---- v9 (opcionales) ---- */
  usageCount?: number
  lastUsedAt?: Timestamp
  tagIds?: string[]
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type ReconciliationResolution = 'matched' | 'adjusted' | 'unresolved'

/** Comparación entre el saldo de la app y el saldo observado en el banco o en efectivo. */
export interface Reconciliation {
  id: string
  accountId: string
  /** Fecha del saldo observado (fin de ese día). */
  date: LocalDate
  /** Saldo observado. En tarjetas, negativo = deuda. */
  observedMinor: number
  /** Saldo calculado por la app para esa fecha, ANTES de cualquier ajuste. */
  computedMinor: number
  /** observado − calculado. */
  differenceMinor: number
  resolution: ReconciliationResolution
  /** Solo si se resolvió con un ajuste. */
  adjustmentTxId?: string
  /** Motivo del ajuste o nota de la persona. */
  reason?: string
  /** Huella del saldo de referencia y los movimientos hasta `date` al conciliar (detecta cambios posteriores). */
  fingerprint: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type BackupReminder = 'weekly' | 'monthly' | 'off'

/**
 * Registro de copias de seguridad de ESTE dispositivo. Cambiarlo no cuenta como
 * "dato nuevo" (no modifica `AppData.updatedAt`).
 */
export interface BackupState {
  reminder: BackupReminder
  /** Cuándo se generó y se pidió al navegador descargar la última copia (no prueba que se guardara). */
  lastExportAt?: Timestamp
  /** `updatedAt` de los datos exportados: si los datos cambian después, hay cambios sin respaldar. */
  lastExportDataAt?: Timestamp
  /** Cuándo la persona eligió un archivo de copia y la app comprobó que es válido y de este presupuesto. */
  lastVerifiedAt?: Timestamp
  /** Fecha de exportación del archivo verificado. */
  verifiedExportedAt?: Timestamp
  /** No mostrar el recordatorio antes de esta fecha. */
  snoozedUntil?: LocalDate
}

export type NumberLocale = 'es-MX' | 'es-ES' | 'es-CO' | 'en-CA' | 'en-US' | 'fr-CA' | 'fr-FR' | 'pt-BR'
export type DateStyle = 'short' | 'medium' | 'iso'
export type Language = 'es' | 'en' | 'pt' | 'fr'

/** 0 = domingo … 6 = sábado. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/**
 * Periodo de presupuesto (§6). `untilIncome` es el modelo original de Clara (hasta el día
 * anterior al próximo ingreso programado) y se conserva como opción.
 */
export interface BudgetPeriodSettings {
  type: BudgetPeriodType
  weekStartsOn: Weekday
  customStart?: LocalDate
  customEnd?: LocalDate
}

export interface SafeToSpendSettings {
  showOnHome: boolean
  granularity: 'day' | 'week' | 'period'
  subtractScheduled: boolean
  subtractGoalContributions: boolean
  /**
   * v13. Colchón de seguridad (unidades menores, ≥ 0): dinero que la persona quiere dejar siempre sin
   * gastar. Se resta del disponible y del *safe to spend*; no es un gasto ni mueve dinero. 0 = sin colchón.
   */
  bufferMinor: number
}

/** Hora local `HH:MM`. */
export type ClockTime = string

export interface NotificationSettings {
  scheduledAlerts: boolean
  dailyReminder: boolean
  dailyReminderTime: ClockTime
  dailySummary: boolean
  dailySummaryTime: ClockTime
  quietHours: boolean
  quietFrom: ClockTime
  quietTo: ClockTime
  planAlerts: boolean
}

export interface ProStatus {
  active: boolean
  plan?: 'monthly' | 'annual'
  expiresAt?: Timestamp
}

/** Uso del asistente remoto en el mes (`AAAA-MM`); el parser local no cuenta. */
export interface AiUsage {
  month: string
  count: number
}

export interface Settings {
  currency: CurrencyCode
  numberLocale: NumberLocale
  dateStyle: DateStyle
  timeZone: string
  language: Language
  /** Horizonte (días) si no hay un próximo ingreso registrado. `null` = preguntar. */
  fallbackHorizonDays: number | null
  /** Mostrar la revisión semanal en Inicio (por defecto sí). */
  weeklyReview?: boolean
  /* ---- v9 ---- */
  budgetPeriod: BudgetPeriodSettings
  /** Arrastrar el saldo entre periodos (por defecto sí; Lukas no lo hace). */
  carryOverBalance: boolean
  safeToSpend: SafeToSpendSettings
  notifications: NotificationSettings
  biometricLock: boolean
  onboardingDone: boolean
  toursSeen: string[]
  proStatus: ProStatus
  aiUsage: AiUsage
}

export interface UserProfile {
  id: string
  isGuest: boolean
  provider?: 'google' | 'apple'
  email?: string
  displayName?: string
  avatarUrl?: string
}

export type PeriodTemplate = 'semester' | 'trip' | 'custom'

/**
 * Presupuesto para un periodo (semestre, viaje…). ASIGNAR no mueve ni reserva dinero:
 * es un límite para organizarse. Los movimientos se asocian por id (un movimiento puede
 * pertenecer a varios periodos sin duplicarse).
 */
export interface PeriodBudget {
  id: string
  name: string
  template: PeriodTemplate
  startDate: LocalDate
  endDate: LocalDate
  allocatedMinor: number
  currency: CurrencyCode
  /** Gastos y devoluciones asociados (ids de movimientos). */
  txIds: string[]
  /** Meta de presupuesto usada para reservar dinero para el periodo (opcional). */
  goalId?: string
  /**
   * Regla opcional: al registrar un gasto de estas categorías dentro de las fechas, el
   * formulario PROPONE asociarlo a este periodo (la persona puede desmarcarlo).
   */
  ruleCategoryIds?: string[]
  archived: boolean
  note?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

/** Un cambio simulado. Nunca se aplica a los datos reales. */
export type ScenarioChange =
  /** Compra simulada. Sin `accountId`, en la primera cuenta que cuenta para el presupuesto. */
  | { type: 'purchase'; amountMinor: number; date: LocalDate; note?: string; accountId?: string }
  | { type: 'scheduleAmount'; scheduleId: string; newAmountMinor: number }
  /** Ingreso hipotético: solo entra en la proyección, NUNCA en «Puedes gastar». */
  | { type: 'income'; amountMinor: number; date: LocalDate; note?: string; accountId?: string }

export interface SavedScenario {
  id: string
  name: string
  changes: ScenarioChange[]
  /** Huella de los datos reales cuando se guardó o revisó por última vez. */
  baseFingerprint: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

/**
 * Bandeja de pendientes: los avisos se CALCULAN a partir de los datos; aquí solo se guarda
 * lo que decidió la persona. `fingerprint` = datos relevantes al descartar: si cambian, el
 * aviso vuelve a aparecer. Posponer nunca cambia cifras.
 */
export interface InboxState {
  snoozed: { id: string; until: LocalDate; at: Timestamp }[]
  dismissed: { id: string; fingerprint: string; at: Timestamp }[]
}

export type DistributionLineKind = 'payment' | 'goal'

export interface IncomeDistributionLine {
  kind: DistributionLineKind
  goalId: string
  /** Apartado creado en la meta (mismo id en `goal.allocations`). */
  allocationId: string
  amountMinor: number
  /** La meta la creó esta distribución (pago vinculado). */
  createdGoal: boolean
  /** Solo pagos: ocurrencia del calendario cubierta. */
  scheduleId?: string
  occurrenceDate?: LocalDate
}

/** Reparto de un ingreso YA recibido entre pagos, metas y dinero libre. No mueve dinero. */
export interface IncomeDistribution {
  id: string
  incomeTxId: string
  /** Importe, fecha, cuenta y estado del ingreso al distribuirlo (para detectar cambios). */
  incomeFingerprint: string
  incomeAmountMinor: number
  lines: IncomeDistributionLine[]
  createdAt: Timestamp
  undoneAt?: Timestamp
}

export interface AppData {
  schemaVersion: typeof SCHEMA_VERSION
  /** Identificador único de este presupuesto (útil para sincronizar en el futuro). */
  budgetId: string
  isDemo: boolean
  settings: Settings
  accounts: Account[]
  transactions: Transaction[]
  schedules: Schedule[]
  goals: Goal[]
  categories: CustomCategory[]
  /* ---- v9 ---- */
  /** Ajustes sobre categorías del sistema, por id. */
  categoryPrefs: Record<string, CategoryPref>
  /** Grupos creados por la persona (los del sistema viven en `categories.ts`). */
  categoryGroups: CategoryGroup[]
  tags: Tag[]
  /** Límites de gasto (planes). Las metas de ahorro son `goals`. */
  plans: Plan[]
  profile: UserProfile
  categoryLimits: CategoryLimit[]
  categoryRules: CategoryRule[]
  /** Movimientos eliminados que aún se pueden restaurar. */
  trash: TrashEntry[]
  /**
   * Huellas de importación de movimientos eliminados definitivamente (sin datos
   * financieros). Al reimportar un CSV, esas filas se ofrecen desmarcadas.
   */
  purgedImportRefs: string[]
  favorites: Favorite[]
  reconciliations: Reconciliation[]
  backup: BackupState
  periodBudgets: PeriodBudget[]
  scenarios: SavedScenario[]
  inbox: InboxState
  incomeDistributions: IncomeDistribution[]
  /** Plantillas con nombre (compras divididas y distribución de ingresos). Nunca registran nada solas. */
  templates: Template[]
  /** Historial local de cambios financieros (ver domain/history.ts). No es un registro inviolable. */
  history: HistoryEntry[]
  /** Desde cuándo hay historial (inicio de su captura o la entrada más antigua conservada). */
  historyStartedAt: Timestamp
  createdAt: Timestamp
  updatedAt: Timestamp
  /** Aumenta en cada guardado. Sirve para detectar cambios en otra pestaña. */
  revision: number
}

/* ------------------------------------------------------------------ */
/* Historial local (v8)                                                */
/* ------------------------------------------------------------------ */

/** Colecciones con efecto financiero que se registran en el historial. */
export type HistoryCollection = 'accounts' | 'transactions' | 'schedules' | 'goals' | 'trash' | 'reconciliations' | 'incomeDistributions' | 'periodBudgets' | 'settings'

/** Un registro cambiado: valor anterior y nuevo (`null` = no existía / dejó de existir). */
export interface HistoryChange {
  collection: HistoryCollection
  id: string
  before: unknown
  after: unknown
}

/**
 * app = una operación normal; revert = deshacer otra entrada; plan = cambios aplicados desde el
 * plan ante faltantes; replace = se reemplazaron todos los datos (importar una copia, demo):
 * es un corte, el historial anterior no se puede revertir ni reconstruir más allá.
 */
export type HistorySource = 'app' | 'revert' | 'plan' | 'replace'

export interface HistoryEntry {
  id: string
  at: Timestamp
  source: HistorySource
  changes: HistoryChange[]
  /** Entrada que esta deshace (solo `revert`). */
  revertOf?: string
}

/* ------------------------------------------------------------------ */
/* Plantillas con nombre (v8)                                          */
/* ------------------------------------------------------------------ */

/** Importe fijo (unidades menores) o porcentaje en puntos básicos (10000 = 100 %). */
export type TemplateAmount = { mode: 'fixed'; amountMinor: number } | { mode: 'percent'; bps: number }

export interface SplitTemplateLine {
  categoryId: string
  amount: TemplateAmount
}

export interface DistributionTemplateLine {
  /** Meta (apartado) o pago programado (se resuelve a su próxima ocurrencia abierta). */
  target: { kind: 'goal'; goalId: string } | { kind: 'payment'; scheduleId: string }
  amount: TemplateAmount
}

export type Template =
  | { id: string; name: string; kind: 'split'; lines: SplitTemplateLine[]; createdAt: Timestamp; updatedAt: Timestamp }
  | { id: string; name: string; kind: 'distribution'; lines: DistributionTemplateLine[]; createdAt: Timestamp; updatedAt: Timestamp }
