/**
 * Validación de registros. Se usa al guardar desde formularios y al importar
 * copias de seguridad (datos no confiables). Los mensajes visibles se buscan
 * en i18n con la clave `issue.<code>`.
 */
import { txIndex } from './txIndex'
import { categoriesForKind, isCustomCategoryId, isExpenseCategory } from './categories'
import { isValidLocalDate, isValidTimeZone, isValidTimestamp } from './dates'
import { isValidId } from './ids'
import { MAX_AMOUNT_MINOR, isMinorAmount, isSupportedCurrency, sumMinor } from './money'
import { normalizeText, RULE_PATTERN_MAX, RULE_PATTERN_MIN } from './rules'
import { MAX_SPLIT_LINES, refundableByCategory, splitDifference } from './splits'
import type {
  HistoryCollection,
  HistoryEntry,
  HistorySource,
  Template,
  Account,
  AppData,
  BackupState,
  CategoryLimit,
  CategoryRule,
  CustomCategory,
  Favorite,
  Goal,
  IncomeDistribution,
  IncomeRange,
  InboxState,
  PeriodBudget,
  Plan,
  PlannedExpense,
  Reconciliation,
  SavedScenario,
  Schedule,
  Settings,
  Transaction,
  TrashEntry,
  CategoryGroup,
  CategoryPref,
  Tag,
  UserProfile,
} from './types'

export type IssueCode =
  | 'required'
  | 'invalidId'
  | 'duplicateId'
  | 'invalidValue'
  | 'invalidDate'
  | 'invalidTimestamp'
  | 'invalidAmount'
  | 'amountNotPositive'
  | 'amountTooLarge'
  | 'currencyMismatch'
  | 'unsupportedCurrency'
  | 'unknownAccount'
  | 'sameAccount'
  | 'invalidCategory'
  | 'realizedInFuture'
  | 'refundTargetInvalid'
  | 'refundExceeds'
  | 'textTooLong'
  | 'endBeforeStart'
  | 'invalidTimeZone'
  | 'exceedsFreeMoney'
  | 'exceedsRemaining'
  | 'exceedsSaved'
  | 'accountInUse'
  | 'accountArchived'
  | 'accountHasSchedules'
  | 'lastBudgetAccount'
  | 'lastCategoryOfKind'
  | 'creditKindChange'
  | 'duplicateName'
  | 'categoryInUse'
  | 'duplicateRule'
  | 'splitMismatch'
  | 'splitTooFew'
  | 'distributionExceeds'
  | 'distributionConflict'
  | 'incomeNotRealized'
  | 'patternTooShort'
  | 'notFound'
  | 'rangeOrder'
  | 'occurrenceAlreadySettled'
  | 'restoreConflict'
  | 'favoriteAccountMissing'
  | 'favoriteCategoryMissing'
  | 'beforeAnchor'
  | 'differenceNotZero'
  | 'nothingToAdjust'
  | 'reasonRequired'
  | 'notABackupOfThisBudget'
  | 'tooMany'
  | 'dateInPast'
  | 'percentOver100'
  | 'templateExceedsTotal'
  | 'templateUnavailable'
  | 'revertConflict'
  | 'alreadyReverted'
  | 'notRevertible'

export interface Issue {
  /** Campo afectado, por ejemplo 'amountMinor' o 'transactions[3].date'. */
  path: string
  code: IssueCode
  params?: Record<string, string | number>
}

export const LIMITS = {
  nameMax: 60,
  noteMax: 200,
  reminderMaxDays: 30,
  horizonMaxDays: 90,
} as const

export const TX_KINDS = ['income', 'expense', 'transfer', 'refund', 'adjustment'] as const
export const TX_STATUSES = ['planned', 'realized'] as const
export const ACCOUNT_KINDS = ['bank', 'cash', 'savings', 'credit', 'other'] as const
export const FREQUENCIES = ['once', 'daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom'] as const
export const NUMBER_LOCALES = ['es-MX', 'es-ES', 'es-CO', 'en-CA', 'en-US', 'fr-CA', 'fr-FR', 'pt-BR'] as const
export const DATE_STYLES = ['short', 'medium', 'iso'] as const
export const LANGUAGES = ['es', 'en', 'pt', 'fr'] as const
export const BUDGET_PERIOD_TYPES = ['week', 'biweek', 'month', 'quarter', 'semester', 'year', 'custom', 'untilIncome'] as const
export const CATEGORY_COLORS = ['emerald', 'green', 'lime', 'yellow', 'amber', 'orange', 'red', 'rose', 'pink', 'purple', 'violet', 'indigo', 'blue', 'sky', 'cyan', 'teal'] as const
export const TX_SOURCES = ['manual', 'ai_text', 'voice', 'photo', 'scheduled', 'common', 'shortcut', 'import'] as const
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/
/** Nombres de iconos: letras, números y guiones (se validan por forma; la interfaz tiene un icono de reserva). */
const ICON_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

function checkName(value: unknown, path: string, issues: Issue[], max: number = LIMITS.nameMax) {
  if (typeof value !== 'string' || value.trim() === '') issues.push({ path, code: 'required' })
  else if (value.length > max) issues.push({ path, code: 'textTooLong', params: { max } })
}

function checkOptionalText(value: unknown, path: string, issues: Issue[], max: number = LIMITS.noteMax) {
  if (value === undefined) return
  if (typeof value !== 'string') issues.push({ path, code: 'invalidValue' })
  else if (value.length > max) issues.push({ path, code: 'textTooLong', params: { max } })
}

function checkPositiveAmount(value: unknown, path: string, issues: Issue[]) {
  if (!isMinorAmount(value)) issues.push({ path, code: 'invalidAmount' })
  else if (value <= 0) issues.push({ path, code: 'amountNotPositive' })
  else if (value > MAX_AMOUNT_MINOR) issues.push({ path, code: 'amountTooLarge' })
}

function checkDate(value: unknown, path: string, issues: Issue[]) {
  if (!isValidLocalDate(value)) issues.push({ path, code: 'invalidDate' })
}

function checkTimestamps(value: { createdAt?: unknown; updatedAt?: unknown }, prefix: string, issues: Issue[]) {
  if (!isValidTimestamp(value.createdAt)) issues.push({ path: `${prefix}createdAt`, code: 'invalidTimestamp' })
  if (!isValidTimestamp(value.updatedAt)) issues.push({ path: `${prefix}updatedAt`, code: 'invalidTimestamp' })
}

export interface ValidationContext {
  data: Pick<AppData, 'accounts' | 'transactions' | 'settings'> & { categories?: CustomCategory[] }
  /** Si se indica, un movimiento realizado no puede tener fecha posterior. */
  today?: string
  prefix?: string
}

export function validateSettings(s: Settings, prefix = ''): Issue[] {
  const issues: Issue[] = []
  if (!isSupportedCurrency(s.currency as string)) issues.push({ path: `${prefix}currency`, code: 'unsupportedCurrency' })
  if (!isOneOf(NUMBER_LOCALES, s.numberLocale)) issues.push({ path: `${prefix}numberLocale`, code: 'invalidValue' })
  if (!isOneOf(DATE_STYLES, s.dateStyle)) issues.push({ path: `${prefix}dateStyle`, code: 'invalidValue' })
  if (!isValidTimeZone(s.timeZone)) issues.push({ path: `${prefix}timeZone`, code: 'invalidTimeZone' })
  if (!isOneOf(LANGUAGES, s.language)) issues.push({ path: `${prefix}language`, code: 'invalidValue' })
  const h = s.fallbackHorizonDays
  if (h !== null && !(Number.isInteger(h) && h >= 1 && h <= LIMITS.horizonMaxDays)) {
    issues.push({ path: `${prefix}fallbackHorizonDays`, code: 'invalidValue' })
  }
  if (s.weeklyReview !== undefined && typeof s.weeklyReview !== 'boolean') issues.push({ path: `${prefix}weeklyReview`, code: 'invalidValue' })
  // v9
  const bp = s.budgetPeriod
  if (!bp || typeof bp !== 'object') issues.push({ path: `${prefix}budgetPeriod`, code: 'required' })
  else {
    if (!isOneOf(BUDGET_PERIOD_TYPES, bp.type)) issues.push({ path: `${prefix}budgetPeriod.type`, code: 'invalidValue' })
    if (!Number.isInteger(bp.weekStartsOn) || bp.weekStartsOn < 0 || bp.weekStartsOn > 6) issues.push({ path: `${prefix}budgetPeriod.weekStartsOn`, code: 'invalidValue' })
    if (bp.customStart !== undefined) checkDate(bp.customStart, `${prefix}budgetPeriod.customStart`, issues)
    if (bp.customEnd !== undefined) checkDate(bp.customEnd, `${prefix}budgetPeriod.customEnd`, issues)
    if (bp.type === 'custom') {
      if (!isValidLocalDate(bp.customStart) || !isValidLocalDate(bp.customEnd)) issues.push({ path: `${prefix}budgetPeriod.customStart`, code: 'required' })
      else if (bp.customEnd < bp.customStart) issues.push({ path: `${prefix}budgetPeriod.customEnd`, code: 'endBeforeStart' })
    }
  }
  if (typeof s.carryOverBalance !== 'boolean') issues.push({ path: `${prefix}carryOverBalance`, code: 'invalidValue' })
  const sts = s.safeToSpend
  if (!sts || typeof sts !== 'object') issues.push({ path: `${prefix}safeToSpend`, code: 'required' })
  else {
    for (const k of ['showOnHome', 'subtractScheduled', 'subtractGoalContributions'] as const) {
      if (typeof sts[k] !== 'boolean') issues.push({ path: `${prefix}safeToSpend.${k}`, code: 'invalidValue' })
    }
    if (!isOneOf(['day', 'week', 'period'] as const, sts.granularity)) issues.push({ path: `${prefix}safeToSpend.granularity`, code: 'invalidValue' })
  }
  const n = s.notifications
  if (!n || typeof n !== 'object') issues.push({ path: `${prefix}notifications`, code: 'required' })
  else {
    for (const k of ['scheduledAlerts', 'dailyReminder', 'dailySummary', 'quietHours', 'planAlerts'] as const) {
      if (typeof n[k] !== 'boolean') issues.push({ path: `${prefix}notifications.${k}`, code: 'invalidValue' })
    }
    for (const k of ['dailyReminderTime', 'dailySummaryTime', 'quietFrom', 'quietTo'] as const) {
      if (typeof n[k] !== 'string' || !CLOCK_TIME.test(n[k])) issues.push({ path: `${prefix}notifications.${k}`, code: 'invalidValue' })
    }
  }
  for (const k of ['biometricLock', 'onboardingDone'] as const) {
    if (typeof s[k] !== 'boolean') issues.push({ path: `${prefix}${k}`, code: 'invalidValue' })
  }
  if (!Array.isArray(s.toursSeen) || !s.toursSeen.every((t) => typeof t === 'string' && t.length <= 40) || s.toursSeen.length > 100) {
    issues.push({ path: `${prefix}toursSeen`, code: 'invalidValue' })
  }
  const pro = s.proStatus
  if (!pro || typeof pro !== 'object' || typeof pro.active !== 'boolean') issues.push({ path: `${prefix}proStatus`, code: 'invalidValue' })
  else {
    if (pro.plan !== undefined && pro.plan !== 'monthly' && pro.plan !== 'annual') issues.push({ path: `${prefix}proStatus.plan`, code: 'invalidValue' })
    if (pro.expiresAt !== undefined && !isValidTimestamp(pro.expiresAt)) issues.push({ path: `${prefix}proStatus.expiresAt`, code: 'invalidTimestamp' })
  }
  const ai = s.aiUsage
  if (!ai || typeof ai !== 'object' || typeof ai.month !== 'string' || !Number.isInteger(ai.count) || ai.count < 0) {
    issues.push({ path: `${prefix}aiUsage`, code: 'invalidValue' })
  }
  return issues
}

export function validateProfile(p: UserProfile, prefix = 'profile.'): Issue[] {
  const issues: Issue[] = []
  if (!p || typeof p !== 'object') return [{ path: 'profile', code: 'required' }]
  if (typeof p.id !== 'string' || p.id.length === 0 || p.id.length > 128) issues.push({ path: `${prefix}id`, code: 'invalidId' })
  if (typeof p.isGuest !== 'boolean') issues.push({ path: `${prefix}isGuest`, code: 'invalidValue' })
  if (p.provider !== undefined && p.provider !== 'google' && p.provider !== 'apple') issues.push({ path: `${prefix}provider`, code: 'invalidValue' })
  checkOptionalText(p.email, `${prefix}email`, issues)
  checkOptionalText(p.displayName, `${prefix}displayName`, issues)
  checkOptionalText(p.avatarUrl, `${prefix}avatarUrl`, issues, 2048)
  return issues
}

/** Campos opcionales de categoría (v9): grupo, icono, color y orden. */
function checkCategoryLook(c: { groupId?: unknown; icon?: unknown; color?: unknown; sortOrder?: unknown }, prefix: string, issues: Issue[]) {
  if (c.groupId !== undefined && (typeof c.groupId !== 'string' || c.groupId.length === 0 || c.groupId.length > 64)) issues.push({ path: `${prefix}groupId`, code: 'invalidValue' })
  if (c.icon !== undefined && (typeof c.icon !== 'string' || !ICON_NAME.test(c.icon))) issues.push({ path: `${prefix}icon`, code: 'invalidValue' })
  if (c.color !== undefined && !isOneOf(CATEGORY_COLORS, c.color)) issues.push({ path: `${prefix}color`, code: 'invalidValue' })
  if (c.sortOrder !== undefined && (typeof c.sortOrder !== 'number' || !Number.isInteger(c.sortOrder) || c.sortOrder < 0)) issues.push({ path: `${prefix}sortOrder`, code: 'invalidValue' })
}

export function validateCategoryPrefs(prefs: Record<string, CategoryPref>, prefix = 'categoryPrefs'): Issue[] {
  const issues: Issue[] = []
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return [{ path: prefix, code: 'invalidValue' }]
  const entries = Object.entries(prefs)
  if (entries.length > 500) return [{ path: prefix, code: 'tooMany', params: { max: 500 } }]
  for (const [id, pref] of entries) {
    const p = `${prefix}.${id}.`
    if (!pref || typeof pref !== 'object') {
      issues.push({ path: `${prefix}.${id}`, code: 'invalidValue' })
      continue
    }
    if (pref.name !== undefined) checkName(pref.name, `${p}name`, issues, 40)
    if (pref.archived !== undefined && typeof pref.archived !== 'boolean') issues.push({ path: `${p}archived`, code: 'invalidValue' })
    checkCategoryLook(pref, p, issues)
  }
  return issues
}

export function validateCategoryGroup(g: CategoryGroup, all: readonly CategoryGroup[], prefix = ''): Issue[] {
  const issues: Issue[] = []
  if (!isValidId(g.id)) issues.push({ path: `${prefix}id`, code: 'invalidId' })
  if (g.nameKey === undefined) checkName(g.name, `${prefix}name`, issues, 40)
  else if (typeof g.nameKey !== 'string' || g.nameKey.length > 80) issues.push({ path: `${prefix}nameKey`, code: 'invalidValue' })
  if (!isOneOf(CATEGORY_COLORS, g.color)) issues.push({ path: `${prefix}color`, code: 'invalidValue' })
  if (!Number.isInteger(g.sortOrder) || g.sortOrder < 0) issues.push({ path: `${prefix}sortOrder`, code: 'invalidValue' })
  if (typeof g.name === 'string') {
    const norm = g.name.trim().toLocaleLowerCase()
    if (all.some((o) => o.id !== g.id && typeof o.name === 'string' && o.name.trim().toLocaleLowerCase() === norm)) issues.push({ path: `${prefix}name`, code: 'duplicateName' })
  }
  if (g.createdAt !== undefined || g.updatedAt !== undefined) checkTimestamps(g, prefix, issues)
  return issues
}

export function validateTag(tag: Tag, all: readonly Tag[], prefix = ''): Issue[] {
  const issues: Issue[] = []
  if (!isValidId(tag.id)) issues.push({ path: `${prefix}id`, code: 'invalidId' })
  checkName(tag.name, `${prefix}name`, issues, 30)
  if (!isOneOf(CATEGORY_COLORS, tag.color)) issues.push({ path: `${prefix}color`, code: 'invalidValue' })
  if (typeof tag.name === 'string') {
    const norm = tag.name.trim().toLocaleLowerCase()
    if (all.some((o) => o.id !== tag.id && o.name.trim().toLocaleLowerCase() === norm)) issues.push({ path: `${prefix}name`, code: 'duplicateName' })
  }
  checkTimestamps(tag, prefix, issues)
  return issues
}

function checkTagIds(value: unknown, path: string, issues: Issue[]) {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length > 20 || !value.every(isValidId) || new Set(value).size !== value.length) issues.push({ path, code: 'invalidValue' })
}

export function validatePlan(plan: Plan, ctx: { data: Pick<AppData, 'settings'> & { categories?: CustomCategory[] }; prefix?: string }): Issue[] {
  const p = ctx.prefix ?? ''
  const issues: Issue[] = []
  if (!isValidId(plan.id)) issues.push({ path: `${p}id`, code: 'invalidId' })
  if (plan.kind !== 'limit') issues.push({ path: `${p}kind`, code: 'invalidValue' })
  // El nombre es opcional (vacío = se muestran las categorías), pero no puede ser otra cosa que texto.
  if (typeof plan.name !== 'string') issues.push({ path: `${p}name`, code: 'required' })
  else if (plan.name.length > LIMITS.nameMax) issues.push({ path: `${p}name`, code: 'textTooLong', params: { max: LIMITS.nameMax } })
  if (plan.previousPlanId !== undefined && !isValidId(plan.previousPlanId)) issues.push({ path: `${p}previousPlanId`, code: 'invalidId' })
  const valid = categoriesForKind('expense', ctx.data.categories ?? [], { includeArchived: true })
  if (!Array.isArray(plan.categoryIds) || plan.categoryIds.length > 50 || !plan.categoryIds.every((c: unknown) => typeof c === 'string' && valid.includes(c))) {
    issues.push({ path: `${p}categoryIds`, code: 'invalidCategory' })
  }
  checkPositiveAmount(plan.amountMinor, `${p}amountMinor`, issues)
  if (plan.currency !== ctx.data.settings.currency) issues.push({ path: `${p}currency`, code: 'currencyMismatch', params: { expected: ctx.data.settings.currency } })
  if (!isOneOf(BUDGET_PERIOD_TYPES, plan.periodType) || plan.periodType === 'untilIncome') issues.push({ path: `${p}periodType`, code: 'invalidValue' })
  if (plan.startDate !== undefined) checkDate(plan.startDate, `${p}startDate`, issues)
  if (plan.endDate !== undefined) checkDate(plan.endDate, `${p}endDate`, issues)
  if (isValidLocalDate(plan.startDate) && isValidLocalDate(plan.endDate) && plan.endDate < plan.startDate) issues.push({ path: `${p}endDate`, code: 'endBeforeStart' })
  if (plan.periodType === 'custom' && (!isValidLocalDate(plan.startDate) || !isValidLocalDate(plan.endDate))) issues.push({ path: `${p}startDate`, code: 'required' })
  if (typeof plan.recurring !== 'boolean') issues.push({ path: `${p}recurring`, code: 'invalidValue' })
  if (!isOneOf(['active', 'completed', 'paused'] as const, plan.status)) issues.push({ path: `${p}status`, code: 'invalidValue' })
  for (const k of ['alertAt80', 'alertAt100'] as const) if (typeof plan[k] !== 'boolean') issues.push({ path: `${p}${k}`, code: 'invalidValue' })
  if (plan.result !== undefined) {
    const r = plan.result
    if (!r || typeof r !== 'object' || !isMinorAmount(r.spentMinor) || typeof r.achieved !== 'boolean' || !isMinorAmount(r.deltaMinor) || !isValidTimestamp(r.closedAt)) {
      issues.push({ path: `${p}result`, code: 'invalidValue' })
    }
  }
  checkTimestamps(plan, p, issues)
  return issues
}

export function validateAccount(a: Account, prefix = ''): Issue[] {
  const issues: Issue[] = []
  if (!isValidId(a.id)) issues.push({ path: `${prefix}id`, code: 'invalidId' })
  checkName(a.name, `${prefix}name`, issues, 40)
  if (!isOneOf(ACCOUNT_KINDS, a.kind)) issues.push({ path: `${prefix}kind`, code: 'invalidValue' })
  if (typeof a.includeInBudget !== 'boolean') issues.push({ path: `${prefix}includeInBudget`, code: 'invalidValue' })
  // v11: opcionales; si vienen, con su tipo (la migración solo rellena lo ausente).
  if (a.archived !== undefined && typeof a.archived !== 'boolean') issues.push({ path: `${prefix}archived`, code: 'invalidValue' })
  if (a.order !== undefined && !(Number.isInteger(a.order) && a.order >= 0)) issues.push({ path: `${prefix}order`, code: 'invalidValue' })
  if (!a.anchor || typeof a.anchor !== 'object') {
    issues.push({ path: `${prefix}anchor`, code: 'required' })
  } else {
    if (!isMinorAmount(a.anchor.amountMinor)) issues.push({ path: `${prefix}anchor.amountMinor`, code: 'invalidAmount' })
    else if (Math.abs(a.anchor.amountMinor) > MAX_AMOUNT_MINOR) issues.push({ path: `${prefix}anchor.amountMinor`, code: 'amountTooLarge' })
    checkDate(a.anchor.date, `${prefix}anchor.date`, issues)
    if (!isValidTimestamp(a.anchor.setAt)) issues.push({ path: `${prefix}anchor.setAt`, code: 'invalidTimestamp' })
  }
  if (a.card !== undefined) {
    const c = a.card
    if (!c || typeof c !== 'object' || a.kind !== 'credit') {
      issues.push({ path: `${prefix}card`, code: 'invalidValue' })
    } else {
      if (c.limitMinor !== undefined) checkPositiveAmount(c.limitMinor, `${prefix}card.limitMinor`, issues)
      const intIn = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max
      if (c.aprBps !== undefined && !intIn(c.aprBps, 0, 10000)) issues.push({ path: `${prefix}card.aprBps`, code: 'invalidValue' })
      if (c.minPaymentBps !== undefined && !intIn(c.minPaymentBps, 0, 10000)) issues.push({ path: `${prefix}card.minPaymentBps`, code: 'invalidValue' })
      if (c.statementDay !== undefined && !intIn(c.statementDay, 1, 31)) issues.push({ path: `${prefix}card.statementDay`, code: 'invalidValue' })
      if (c.dueDay !== undefined && !intIn(c.dueDay, 1, 31)) issues.push({ path: `${prefix}card.dueDay`, code: 'invalidValue' })
      if (c.minPaymentFloorMinor !== undefined && !(isMinorAmount(c.minPaymentFloorMinor) && c.minPaymentFloorMinor >= 0 && c.minPaymentFloorMinor <= MAX_AMOUNT_MINOR)) {
        issues.push({ path: `${prefix}card.minPaymentFloorMinor`, code: 'invalidAmount' })
      }
    }
  }
  checkTimestamps(a, prefix, issues)
  return issues
}

export function validateCategory(c: CustomCategory, all: readonly CustomCategory[], prefix = ''): Issue[] {
  const issues: Issue[] = []
  if (!isValidId(c.id) || !c.id.startsWith('c_')) issues.push({ path: `${prefix}id`, code: 'invalidId' })
  checkName(c.name, `${prefix}name`, issues, 40)
  if (c.kind !== 'expense' && c.kind !== 'income') issues.push({ path: `${prefix}kind`, code: 'invalidValue' })
  if (typeof c.archived !== 'boolean') issues.push({ path: `${prefix}archived`, code: 'invalidValue' })
  checkCategoryLook(c, prefix, issues)
  if (typeof c.name === 'string') {
    const norm = c.name.trim().toLocaleLowerCase()
    if (all.some((o) => o.id !== c.id && o.kind === c.kind && o.name.trim().toLocaleLowerCase() === norm)) {
      issues.push({ path: `${prefix}name`, code: 'duplicateName' })
    }
  }
  checkTimestamps(c, prefix, issues)
  return issues
}

export function validateCategoryLimit(l: CategoryLimit, custom: readonly CustomCategory[], prefix = ''): Issue[] {
  const issues: Issue[] = []
  if (typeof l.categoryId !== 'string' || !categoriesForKind('expense', custom, { includeArchived: true }).includes(l.categoryId)) {
    issues.push({ path: `${prefix}categoryId`, code: 'invalidCategory' })
  }
  checkPositiveAmount(l.monthlyLimitMinor, `${prefix}monthlyLimitMinor`, issues)
  return issues
}

export function validateCategoryRule(r: CategoryRule, all: readonly CategoryRule[], custom: readonly CustomCategory[], prefix = ''): Issue[] {
  const issues: Issue[] = []
  if (!isValidId(r.id)) issues.push({ path: `${prefix}id`, code: 'invalidId' })
  checkName(r.pattern, `${prefix}pattern`, issues, RULE_PATTERN_MAX)
  const kindOk = r.kind === 'expense' || r.kind === 'income'
  if (!kindOk) issues.push({ path: `${prefix}kind`, code: 'invalidValue' })
  if (typeof r.pattern === 'string' && r.pattern.trim() !== '') {
    const norm = normalizeText(r.pattern)
    if (norm.length < RULE_PATTERN_MIN) issues.push({ path: `${prefix}pattern`, code: 'patternTooShort', params: { min: RULE_PATTERN_MIN } })
    else if (all.some((o) => o.id !== r.id && o.kind === r.kind && normalizeText(o.pattern) === norm)) {
      issues.push({ path: `${prefix}pattern`, code: 'duplicateRule' })
    }
  }
  if (kindOk && (typeof r.categoryId !== 'string' || !categoriesForKind(r.kind, custom, { includeArchived: true }).includes(r.categoryId))) {
    issues.push({ path: `${prefix}categoryId`, code: 'invalidCategory' })
  }
  checkTimestamps(r, prefix, issues)
  return issues
}

export function validateTransaction(tx: Transaction, ctx: ValidationContext): Issue[] {
  const p = ctx.prefix ?? ''
  const issues: Issue[] = []
  const { data } = ctx
  if (!isValidId(tx.id)) issues.push({ path: `${p}id`, code: 'invalidId' })
  if (!isOneOf(TX_KINDS, tx.kind)) issues.push({ path: `${p}kind`, code: 'invalidValue' })
  if (!isOneOf(TX_STATUSES, tx.status)) issues.push({ path: `${p}status`, code: 'invalidValue' })
  checkPositiveAmount(tx.amountMinor, `${p}amountMinor`, issues)
  if (tx.currency !== data.settings.currency) {
    issues.push({ path: `${p}currency`, code: 'currencyMismatch', params: { expected: data.settings.currency } })
  }
  checkDate(tx.date, `${p}date`, issues)
  if (!data.accounts.some((a) => a.id === tx.accountId)) issues.push({ path: `${p}accountId`, code: 'unknownAccount' })

  if (tx.kind === 'transfer') {
    if (!tx.toAccountId || !data.accounts.some((a) => a.id === tx.toAccountId)) {
      issues.push({ path: `${p}toAccountId`, code: 'unknownAccount' })
    } else if (tx.toAccountId === tx.accountId) {
      issues.push({ path: `${p}toAccountId`, code: 'sameAccount' })
    }
    if (tx.categoryId !== undefined) issues.push({ path: `${p}categoryId`, code: 'invalidCategory' })
  } else if (tx.kind === 'adjustment') {
    // Un ajuste corrige el saldo de una sola cuenta: sin categoría, destino ni vínculos de pago.
    if (tx.status !== 'realized') issues.push({ path: `${p}status`, code: 'invalidValue' })
    if (tx.adjustmentDirection !== 'increase' && tx.adjustmentDirection !== 'decrease') {
      issues.push({ path: `${p}adjustmentDirection`, code: 'invalidValue' })
    }
    if (tx.toAccountId !== undefined) issues.push({ path: `${p}toAccountId`, code: 'invalidValue' })
    if (tx.categoryId !== undefined) issues.push({ path: `${p}categoryId`, code: 'invalidCategory' })
    if (tx.scheduleId !== undefined || tx.refundOfId !== undefined) issues.push({ path: `${p}kind`, code: 'invalidValue' })
    if (tx.reconciliationId !== undefined && !isValidId(tx.reconciliationId)) issues.push({ path: `${p}reconciliationId`, code: 'invalidId' })
  } else if (isOneOf(TX_KINDS, tx.kind)) {
    if (tx.toAccountId !== undefined) issues.push({ path: `${p}toAccountId`, code: 'invalidValue' })
    if (!tx.categoryId || !categoriesForKind(tx.kind, ctx.data.categories, { includeArchived: true }).includes(tx.categoryId)) {
      issues.push({ path: `${p}categoryId`, code: 'invalidCategory' })
    }
  }
  if (tx.kind !== 'adjustment' && (tx.adjustmentDirection !== undefined || tx.reconciliationId !== undefined)) {
    issues.push({ path: `${p}adjustmentDirection`, code: 'invalidValue' })
  }
  if (tx.partialSettlement !== undefined && (tx.partialSettlement !== true || tx.scheduleId === undefined || tx.status !== 'realized')) {
    issues.push({ path: `${p}partialSettlement`, code: 'invalidValue' })
  }

  if (tx.status === 'realized' && ctx.today && isValidLocalDate(tx.date) && tx.date > ctx.today) {
    issues.push({ path: `${p}date`, code: 'realizedInFuture' })
  }

  if (tx.refundOfId !== undefined) {
    const index = txIndex(data.transactions)
    const original = index.byId.get(tx.refundOfId)
    if (tx.kind !== 'refund' || !original || original.kind !== 'expense' || original.id === tx.id) {
      issues.push({ path: `${p}refundOfId`, code: 'refundTargetInvalid' })
    } else if (isMinorAmount(tx.amountMinor)) {
      const otherRefunds = sumMinor(
        (index.refundsOf.get(original.id) ?? []).filter((t) => t.id !== tx.id).map((t) => t.amountMinor),
      )
      const remaining = original.amountMinor - otherRefunds
      if (tx.amountMinor > remaining) {
        issues.push({ path: `${p}amountMinor`, code: 'refundExceeds', params: { remainingMinor: Math.max(0, remaining) } })
      }
    }
  }

  if ((tx.scheduleId === undefined) !== (tx.occurrenceDate === undefined)) {
    issues.push({ path: `${p}occurrenceDate`, code: 'invalidValue' })
  }
  if (tx.scheduleId !== undefined && !isValidId(tx.scheduleId)) issues.push({ path: `${p}scheduleId`, code: 'invalidId' })
  if (tx.occurrenceDate !== undefined) checkDate(tx.occurrenceDate, `${p}occurrenceDate`, issues)
  if (tx.realizedAt !== undefined && !isValidTimestamp(tx.realizedAt)) issues.push({ path: `${p}realizedAt`, code: 'invalidTimestamp' })
  if (tx.splits !== undefined) issues.push(...validateSplits(tx, ctx))
  checkOptionalText(tx.note, `${p}note`, issues)
  checkOptionalText(tx.importRef, `${p}importRef`, issues, 200)
  // v9
  checkOptionalText(tx.merchant, `${p}merchant`, issues, 80)
  checkTagIds(tx.tagIds, `${p}tagIds`, issues)
  if (tx.favoriteId !== undefined && !isValidId(tx.favoriteId)) issues.push({ path: `${p}favoriteId`, code: 'invalidId' })
  if (tx.source !== undefined && !isOneOf(TX_SOURCES, tx.source)) issues.push({ path: `${p}source`, code: 'invalidValue' })
  checkOptionalText(tx.receiptUri, `${p}receiptUri`, issues, 2_000_000)
  for (const k of ['lat', 'lng'] as const) {
    if (tx[k] !== undefined && (typeof tx[k] !== 'number' || !Number.isFinite(tx[k]) || Math.abs(tx[k]) > (k === 'lat' ? 90 : 180))) issues.push({ path: `${p}${k}`, code: 'invalidValue' })
  }
  if (tx.isInitialBalance !== undefined && typeof tx.isInitialBalance !== 'boolean') issues.push({ path: `${p}isInitialBalance`, code: 'invalidValue' })
  checkTimestamps(tx, p, issues)
  return issues
}

export function validateSchedule(s: Schedule, ctx: ValidationContext): Issue[] {
  const p = ctx.prefix ?? ''
  const issues: Issue[] = []
  if (!isValidId(s.id)) issues.push({ path: `${p}id`, code: 'invalidId' })
  checkName(s.name, `${p}name`, issues)
  if (s.kind !== 'income' && s.kind !== 'expense') issues.push({ path: `${p}kind`, code: 'invalidValue' })
  checkPositiveAmount(s.amountMinor, `${p}amountMinor`, issues)
  if (typeof s.amountIsEstimate !== 'boolean') issues.push({ path: `${p}amountIsEstimate`, code: 'invalidValue' })
  if (s.range !== undefined) {
    const r = s.range as Partial<IncomeRange> | null
    if (s.kind !== 'income' || !r || typeof r !== 'object') {
      issues.push({ path: `${p}range`, code: 'invalidValue' })
    } else {
      // 0 ≤ mínimo ≤ esperado ≤ extra (todo en enteros).
      if (!isMinorAmount(r.minMinor) || r.minMinor < 0) issues.push({ path: `${p}range.minMinor`, code: 'invalidAmount' })
      if (!isMinorAmount(r.extraMinor) || r.extraMinor < 0) issues.push({ path: `${p}range.extraMinor`, code: 'invalidAmount' })
      else if (r.extraMinor > MAX_AMOUNT_MINOR) issues.push({ path: `${p}range.extraMinor`, code: 'amountTooLarge' })
      if (isMinorAmount(r.minMinor) && isMinorAmount(s.amountMinor) && r.minMinor > s.amountMinor) {
        issues.push({ path: `${p}range.minMinor`, code: 'rangeOrder' })
      }
      if (isMinorAmount(r.extraMinor) && isMinorAmount(s.amountMinor) && r.extraMinor < s.amountMinor) {
        issues.push({ path: `${p}range.extraMinor`, code: 'rangeOrder' })
      }
    }
  }
  if (s.currency !== ctx.data.settings.currency) {
    issues.push({ path: `${p}currency`, code: 'currencyMismatch', params: { expected: ctx.data.settings.currency } })
  }
  if (!ctx.data.accounts.some((a) => a.id === s.accountId)) issues.push({ path: `${p}accountId`, code: 'unknownAccount' })
  if (s.kind === 'income' || s.kind === 'expense') {
    if (!s.categoryId || !categoriesForKind(s.kind, ctx.data.categories, { includeArchived: true }).includes(s.categoryId)) issues.push({ path: `${p}categoryId`, code: 'invalidCategory' })
  }
  if (!isOneOf(FREQUENCIES, s.frequency)) issues.push({ path: `${p}frequency`, code: 'invalidValue' })
  if (s.frequency === 'custom' && !(Number.isInteger(s.intervalDays) && (s.intervalDays as number) >= 1 && (s.intervalDays as number) <= 366)) {
    issues.push({ path: `${p}intervalDays`, code: 'invalidValue' })
  } else if (s.intervalDays !== undefined && (!Number.isInteger(s.intervalDays) || s.intervalDays < 1)) issues.push({ path: `${p}intervalDays`, code: 'invalidValue' })
  for (const k of ['autoConfirm', 'paused'] as const) if (s[k] !== undefined && typeof s[k] !== 'boolean') issues.push({ path: `${p}${k}`, code: 'invalidValue' })
  checkDate(s.startDate, `${p}startDate`, issues)
  if (s.endDate !== undefined) {
    checkDate(s.endDate, `${p}endDate`, issues)
    if (isValidLocalDate(s.endDate) && isValidLocalDate(s.startDate) && s.endDate < s.startDate) {
      issues.push({ path: `${p}endDate`, code: 'endBeforeStart' })
    }
  }
  if (!Number.isInteger(s.reminderDaysBefore) || s.reminderDaysBefore < 0 || s.reminderDaysBefore > LIMITS.reminderMaxDays) {
    issues.push({ path: `${p}reminderDaysBefore`, code: 'invalidValue' })
  }
  if (!Array.isArray(s.skippedDates) || !s.skippedDates.every(isValidLocalDate)) {
    issues.push({ path: `${p}skippedDates`, code: 'invalidDate' })
  }
  checkOptionalText(s.note, `${p}note`, issues)
  checkTimestamps(s, p, issues)
  return issues
}

export function validateGoal(g: Goal, ctx: Pick<ValidationContext, 'data' | 'prefix'>): Issue[] {
  const p = ctx.prefix ?? ''
  const issues: Issue[] = []
  if (!isValidId(g.id)) issues.push({ path: `${p}id`, code: 'invalidId' })
  checkName(g.name, `${p}name`, issues)
  if (g.kind !== 'goal' && g.kind !== 'emergency' && g.kind !== 'expense') issues.push({ path: `${p}kind`, code: 'invalidValue' })
  checkCategoryLook({ icon: g.icon, color: g.color }, p, issues)
  if (g.contribution !== undefined) {
    const c = g.contribution
    if (!c || typeof c !== 'object' || !isMinorAmount(c.amountMinor) || c.amountMinor <= 0 || !isOneOf(['weekly', 'biweekly', 'monthly'] as const, c.frequency)) {
      issues.push({ path: `${p}contribution`, code: 'invalidValue' })
    }
  }
  // Un gasto planificado necesita fecha de vencimiento; las demás metas no llevan `plan`.
  if (g.kind === 'expense') {
    if (g.targetDate === undefined) issues.push({ path: `${p}targetDate`, code: 'required' })
    issues.push(...validatePlannedExpense(g.plan, `${p}plan.`))
  } else if (g.plan !== undefined) {
    issues.push({ path: `${p}plan`, code: 'invalidValue' })
  }
  checkPositiveAmount(g.targetMinor, `${p}targetMinor`, issues)
  if (g.targetDate !== undefined) checkDate(g.targetDate, `${p}targetDate`, issues)
  if (g.currency !== ctx.data.settings.currency) {
    issues.push({ path: `${p}currency`, code: 'currencyMismatch', params: { expected: ctx.data.settings.currency } })
  }
  if (g.fundedFrom !== 'budget' && g.fundedFrom !== 'external') issues.push({ path: `${p}fundedFrom`, code: 'invalidValue' })
  if (!Array.isArray(g.allocations)) {
    issues.push({ path: `${p}allocations`, code: 'invalidValue' })
  } else {
    const ids = new Set<string>()
    g.allocations.forEach((a, i) => {
      const ap = `${p}allocations[${i}].`
      if (!a || typeof a !== 'object') {
        issues.push({ path: `${p}allocations[${i}]`, code: 'invalidValue' })
        return
      }
      if (!isValidId(a.id)) issues.push({ path: `${ap}id`, code: 'invalidId' })
      else if (ids.has(a.id)) issues.push({ path: `${ap}id`, code: 'duplicateId' })
      else ids.add(a.id)
      if (!isMinorAmount(a.amountMinor) || a.amountMinor === 0) issues.push({ path: `${ap}amountMinor`, code: 'invalidAmount' })
      else if (Math.abs(a.amountMinor) > MAX_AMOUNT_MINOR) issues.push({ path: `${ap}amountMinor`, code: 'amountTooLarge' })
      checkDate(a.date, `${ap}date`, issues)
      if (!isValidTimestamp(a.createdAt)) issues.push({ path: `${ap}createdAt`, code: 'invalidTimestamp' })
      if (a.reason !== undefined && !isOneOf(ALLOCATION_REASONS, a.reason)) issues.push({ path: `${ap}reason`, code: 'invalidValue' })
      if (a.distributionId !== undefined && !isValidId(a.distributionId)) issues.push({ path: `${ap}distributionId`, code: 'invalidId' })
    })
    if (issues.length === 0) {
      const saved = sumMinor(g.allocations.map((a) => a.amountMinor))
      if (saved < 0) issues.push({ path: `${p}allocations`, code: 'exceedsSaved' })
    }
  }
  checkTimestamps(g, p, issues)
  return issues
}

/**
 * Movimiento en la papelera: se valida su ESTRUCTURA (tipos, importes, moneda,
 * cuentas existentes). Los vínculos con otros movimientos (devolución → gasto) se
 * vuelven a comprobar al restaurar, porque pueden haber cambiado mientras tanto.
 */
/**
 * Líneas de una compra dividida (o reparto de una devolución): solo gastos y devoluciones,
 * suma EXACTA en centavos, categorías de gasto válidas y `categoryId` = la de la 1.ª línea.
 * Una devolución repartida no puede superar lo pendiente de devolver en cada categoría.
 */
function validateSplits(tx: Transaction, ctx: ValidationContext): Issue[] {
  const p = ctx.prefix ?? ''
  const issues: Issue[] = []
  const lines = tx.splits
  if (!Array.isArray(lines) || lines.length > MAX_SPLIT_LINES || (tx.kind !== 'expense' && tx.kind !== 'refund')) {
    return [{ path: `${p}splits`, code: 'invalidValue' }]
  }
  if (tx.kind === 'expense' ? lines.length < 2 : lines.length < 1) return [{ path: `${p}splits`, code: 'splitTooFew' }]
  const valid = categoriesForKind('expense', ctx.data.categories, { includeArchived: true })
  const ids = new Set<string>()
  lines.forEach((l, i) => {
    const lp = `${p}splits[${i}].`
    if (!l || typeof l !== 'object') return void issues.push({ path: `${p}splits[${i}]`, code: 'invalidValue' })
    if (!isValidId(l.id) || ids.has(l.id)) issues.push({ path: `${lp}id`, code: 'invalidId' })
    ids.add(l.id)
    if (!valid.includes(l.categoryId)) issues.push({ path: `${lp}categoryId`, code: 'invalidCategory' })
    checkPositiveAmount(l.amountMinor, `${lp}amountMinor`, issues)
    checkOptionalText(l.note, `${lp}note`, issues)
  })
  if (issues.length) return issues
  const diff = splitDifference(tx.amountMinor, lines)
  if (diff !== 0) issues.push({ path: `${p}splits`, code: 'splitMismatch', params: { differenceMinor: diff } })
  if (tx.categoryId !== lines[0]!.categoryId) issues.push({ path: `${p}categoryId`, code: 'invalidCategory' })
  if (tx.kind === 'refund') {
    const original = tx.refundOfId ? txIndex(ctx.data.transactions).byId.get(tx.refundOfId) : undefined
    if (!original || !original.splits?.length) return [...issues, { path: `${p}splits`, code: 'invalidValue' }]
    const pending = refundableByCategory(ctx.data, original, tx.id)
    const byCategory = new Map<string, number>()
    for (const l of lines) byCategory.set(l.categoryId, (byCategory.get(l.categoryId) ?? 0) + l.amountMinor)
    lines.forEach((l, i) => {
      const room = pending.get(l.categoryId)
      if (room === undefined) issues.push({ path: `${p}splits[${i}].categoryId`, code: 'invalidCategory' })
      else if (byCategory.get(l.categoryId)! > room) issues.push({ path: `${p}splits[${i}].amountMinor`, code: 'refundExceeds', params: { remainingMinor: Math.max(0, room) } })
    })
  }
  return issues
}

const INBOX_MAX = 5000

export function validateInbox(inbox: InboxState, prefix = 'inbox.'): Issue[] {
  const issues: Issue[] = []
  if (!inbox || typeof inbox !== 'object' || !Array.isArray(inbox.snoozed) || !Array.isArray(inbox.dismissed)) return [{ path: prefix.slice(0, -1), code: 'invalidValue' }]
  if (inbox.snoozed.length > INBOX_MAX || inbox.dismissed.length > INBOX_MAX) issues.push({ path: prefix.slice(0, -1), code: 'tooMany', params: { max: INBOX_MAX } })
  inbox.snoozed.forEach((s, i) => {
    if (!s || typeof s.id !== 'string' || s.id.length === 0 || s.id.length > 300) issues.push({ path: `${prefix}snoozed[${i}].id`, code: 'invalidId' })
    checkDate(s?.until, `${prefix}snoozed[${i}].until`, issues)
    if (!isValidTimestamp(s?.at)) issues.push({ path: `${prefix}snoozed[${i}].at`, code: 'invalidTimestamp' })
  })
  inbox.dismissed.forEach((d, i) => {
    if (!d || typeof d.id !== 'string' || d.id.length === 0 || d.id.length > 300) issues.push({ path: `${prefix}dismissed[${i}].id`, code: 'invalidId' })
    if (typeof d?.fingerprint !== 'string' || d.fingerprint.length > 500) issues.push({ path: `${prefix}dismissed[${i}].fingerprint`, code: 'invalidValue' })
    if (!isValidTimestamp(d?.at)) issues.push({ path: `${prefix}dismissed[${i}].at`, code: 'invalidTimestamp' })
  })
  return issues
}

export function validateIncomeDistribution(d: IncomeDistribution, prefix = ''): Issue[] {
  const issues: Issue[] = []
  if (!isValidId(d.id)) issues.push({ path: `${prefix}id`, code: 'invalidId' })
  if (!isValidId(d.incomeTxId)) issues.push({ path: `${prefix}incomeTxId`, code: 'invalidId' })
  if (typeof d.incomeFingerprint !== 'string' || d.incomeFingerprint.length === 0 || d.incomeFingerprint.length > 200) issues.push({ path: `${prefix}incomeFingerprint`, code: 'invalidValue' })
  checkPositiveAmount(d.incomeAmountMinor, `${prefix}incomeAmountMinor`, issues)
  if (!Array.isArray(d.lines) || d.lines.length > 100) {
    issues.push({ path: `${prefix}lines`, code: 'invalidValue' })
  } else {
    d.lines.forEach((l, i) => {
      const lp = `${prefix}lines[${i}].`
      if (!l || typeof l !== 'object' || (l.kind !== 'payment' && l.kind !== 'goal')) return void issues.push({ path: `${prefix}lines[${i}]`, code: 'invalidValue' })
      if (!isValidId(l.goalId)) issues.push({ path: `${lp}goalId`, code: 'invalidId' })
      if (!isValidId(l.allocationId)) issues.push({ path: `${lp}allocationId`, code: 'invalidId' })
      checkPositiveAmount(l.amountMinor, `${lp}amountMinor`, issues)
      if (typeof l.createdGoal !== 'boolean') issues.push({ path: `${lp}createdGoal`, code: 'invalidValue' })
      if (l.scheduleId !== undefined && !isValidId(l.scheduleId)) issues.push({ path: `${lp}scheduleId`, code: 'invalidId' })
      if (l.occurrenceDate !== undefined) checkDate(l.occurrenceDate, `${lp}occurrenceDate`, issues)
    })
    if (isMinorAmount(d.incomeAmountMinor) && d.lines.every((l) => isMinorAmount(l?.amountMinor)) && sumMinor(d.lines.map((l) => l.amountMinor)) > d.incomeAmountMinor) {
      issues.push({ path: `${prefix}lines`, code: 'distributionExceeds' })
    }
  }
  if (!isValidTimestamp(d.createdAt)) issues.push({ path: `${prefix}createdAt`, code: 'invalidTimestamp' })
  if (d.undoneAt !== undefined && !isValidTimestamp(d.undoneAt)) issues.push({ path: `${prefix}undoneAt`, code: 'invalidTimestamp' })
  return issues
}

export function validateTrashEntry(e: TrashEntry, ctx: ValidationContext): Issue[] {
  const p = ctx.prefix ?? ''
  const issues: Issue[] = []
  if (!e || typeof e !== 'object' || !e.transaction || typeof e.transaction !== 'object') {
    return [{ path: `${p}transaction`, code: 'required' }]
  }
  if (!isValidId(e.id) || e.id !== e.transaction.id) issues.push({ path: `${p}id`, code: 'invalidId' })
  if (!isValidTimestamp(e.deletedAt)) issues.push({ path: `${p}deletedAt`, code: 'invalidTimestamp' })
  if (!Array.isArray(e.unlinkedRefundIds) || !e.unlinkedRefundIds.every(isValidId)) {
    issues.push({ path: `${p}unlinkedRefundIds`, code: 'invalidId' })
  }
  const { refundOfId, ...structural } = e.transaction
  if (refundOfId !== undefined && !isValidId(refundOfId)) issues.push({ path: `${p}transaction.refundOfId`, code: 'invalidId' })
  // El reparto de una devolución depende de su compra (que puede no existir): solo su estructura.
  if (structural.kind === 'refund' && structural.splits) {
    const { splits, ...rest } = structural
    issues.push(...validateTransaction(rest as Transaction, { data: { ...ctx.data, transactions: [] }, prefix: `${p}transaction.` }))
    if (!Array.isArray(splits) || splits.length === 0 || splits.length > MAX_SPLIT_LINES || !splits.every((l) => l && isMinorAmount(l.amountMinor) && l.amountMinor > 0) || splitDifference(structural.amountMinor, splits) !== 0) {
      issues.push({ path: `${p}transaction.splits`, code: 'invalidValue' })
    }
  } else {
    issues.push(...validateTransaction(structural as Transaction, { data: { ...ctx.data, transactions: [] }, prefix: `${p}transaction.` }))
  }
  if (e.unlinkedRefundSplits !== undefined) {
    const ok =
      typeof e.unlinkedRefundSplits === 'object' &&
      e.unlinkedRefundSplits !== null &&
      Object.entries(e.unlinkedRefundSplits).every(
        ([id, lines]) => isValidId(id) && Array.isArray(lines) && lines.length > 0 && lines.length <= MAX_SPLIT_LINES && lines.every((l) => l && isValidId(l.id) && typeof l.categoryId === 'string' && isMinorAmount(l.amountMinor) && l.amountMinor > 0),
      )
    if (!ok) issues.push({ path: `${p}unlinkedRefundSplits`, code: 'invalidValue' })
  }
  return issues
}

export const FAVORITE_NAME_MAX = 40

/**
 * Favorito. Con `checkReferences` (al guardar desde la app) exige que la cuenta y la
 * categoría existan y estén activas; en una copia se aceptan referencias a cuentas
 * o categorías que ya no existen (el formulario pedirá elegir otras).
 */
export function validateFavorite(
  f: Favorite,
  ctx: { data: Pick<AppData, 'accounts' | 'categories' | 'categoryPrefs'>; prefix?: string; checkReferences?: boolean },
): Issue[] {
  const p = ctx.prefix ?? ''
  const issues: Issue[] = []
  if (!isValidId(f.id)) issues.push({ path: `${p}id`, code: 'invalidId' })
  checkName(f.name, `${p}name`, issues, FAVORITE_NAME_MAX)
  const kindOk = f.kind === 'expense' || f.kind === 'income'
  if (!kindOk) issues.push({ path: `${p}kind`, code: 'invalidValue' })
  if (f.amountMinor !== undefined) checkPositiveAmount(f.amountMinor, `${p}amountMinor`, issues)
  checkOptionalText(f.note, `${p}note`, issues)
  if (!Number.isInteger(f.order) || f.order < 0) issues.push({ path: `${p}order`, code: 'invalidValue' })
  if (f.usageCount !== undefined && (!Number.isInteger(f.usageCount) || f.usageCount < 0)) issues.push({ path: `${p}usageCount`, code: 'invalidValue' })
  if (f.lastUsedAt !== undefined && !isValidTimestamp(f.lastUsedAt)) issues.push({ path: `${p}lastUsedAt`, code: 'invalidTimestamp' })
  checkTagIds(f.tagIds, `${p}tagIds`, issues)
  if (!isValidId(f.accountId)) issues.push({ path: `${p}accountId`, code: 'unknownAccount' })
  if (typeof f.categoryId !== 'string' || f.categoryId === '') issues.push({ path: `${p}categoryId`, code: 'invalidCategory' })
  if (ctx.checkReferences && kindOk) {
    if (!ctx.data.accounts.some((a) => a.id === f.accountId)) issues.push({ path: `${p}accountId`, code: 'favoriteAccountMissing' })
    if (!categoriesForKind(f.kind, ctx.data.categories, { prefs: ctx.data.categoryPrefs }).includes(f.categoryId)) issues.push({ path: `${p}categoryId`, code: 'favoriteCategoryMissing' })
  }
  checkTimestamps(f, p, issues)
  return issues
}

export const RECONCILIATION_RESOLUTIONS = ['matched', 'adjusted', 'unresolved'] as const

export function validateReconciliation(r: Reconciliation, ctx: { data: Pick<AppData, 'accounts'>; prefix?: string }): Issue[] {
  const p = ctx.prefix ?? ''
  const issues: Issue[] = []
  if (!isValidId(r.id)) issues.push({ path: `${p}id`, code: 'invalidId' })
  if (!ctx.data.accounts.some((a) => a.id === r.accountId)) issues.push({ path: `${p}accountId`, code: 'unknownAccount' })
  checkDate(r.date, `${p}date`, issues)
  for (const key of ['observedMinor', 'computedMinor', 'differenceMinor'] as const) {
    const v = r[key]
    if (!isMinorAmount(v)) issues.push({ path: `${p}${key}`, code: 'invalidAmount' })
    else if (Math.abs(v) > MAX_AMOUNT_MINOR) issues.push({ path: `${p}${key}`, code: 'amountTooLarge' })
  }
  if (isMinorAmount(r.observedMinor) && isMinorAmount(r.computedMinor) && r.differenceMinor !== r.observedMinor - r.computedMinor) {
    issues.push({ path: `${p}differenceMinor`, code: 'invalidValue' })
  }
  if (!isOneOf(RECONCILIATION_RESOLUTIONS, r.resolution)) issues.push({ path: `${p}resolution`, code: 'invalidValue' })
  if (r.resolution === 'matched' && r.differenceMinor !== 0) issues.push({ path: `${p}resolution`, code: 'differenceNotZero' })
  if (r.resolution === 'adjusted' ? !isValidId(r.adjustmentTxId) : r.adjustmentTxId !== undefined) {
    issues.push({ path: `${p}adjustmentTxId`, code: 'invalidId' })
  }
  checkOptionalText(r.reason, `${p}reason`, issues)
  if (typeof r.fingerprint !== 'string' || r.fingerprint.length === 0 || r.fingerprint.length > 64) {
    issues.push({ path: `${p}fingerprint`, code: 'invalidValue' })
  }
  checkTimestamps(r, p, issues)
  return issues
}

export const BACKUP_REMINDERS = ['weekly', 'monthly', 'off'] as const

export function validateBackupState(b: BackupState, prefix = ''): Issue[] {
  const issues: Issue[] = []
  if (!b || typeof b !== 'object') return [{ path: `${prefix}`, code: 'required' }]
  if (!isOneOf(BACKUP_REMINDERS, b.reminder)) issues.push({ path: `${prefix}reminder`, code: 'invalidValue' })
  for (const key of ['lastExportAt', 'lastExportDataAt', 'lastVerifiedAt', 'verifiedExportedAt'] as const) {
    if (b[key] !== undefined && !isValidTimestamp(b[key])) issues.push({ path: `${prefix}${key}`, code: 'invalidTimestamp' })
  }
  if (b.snoozedUntil !== undefined) checkDate(b.snoozedUntil, `${prefix}snoozedUntil`, issues)
  return issues
}

export const ALLOCATION_REASONS = ['contribution', 'release', 'payment', 'carry'] as const
export const REPEAT_MONTHS_MAX = 24

function validatePlannedExpense(plan: PlannedExpense | undefined, p: string): Issue[] {
  const issues: Issue[] = []
  if (!plan || typeof plan !== 'object') return [{ path: p.slice(0, -1), code: 'required' }]
  if (plan.repeatEveryMonths !== undefined && !(Number.isInteger(plan.repeatEveryMonths) && plan.repeatEveryMonths >= 1 && plan.repeatEveryMonths <= REPEAT_MONTHS_MAX)) {
    issues.push({ path: `${p}repeatEveryMonths`, code: 'invalidValue' })
  }
  if (plan.link !== undefined) {
    if (!plan.link || !isValidId(plan.link.scheduleId)) issues.push({ path: `${p}link.scheduleId`, code: 'invalidId' })
    checkDate(plan.link?.occurrenceDate, `${p}link.occurrenceDate`, issues)
  }
  if (plan.categoryId !== undefined && (typeof plan.categoryId !== 'string' || plan.categoryId === '')) issues.push({ path: `${p}categoryId`, code: 'invalidCategory' })
  if (plan.paidAt !== undefined && !isValidTimestamp(plan.paidAt)) issues.push({ path: `${p}paidAt`, code: 'invalidTimestamp' })
  if (!Array.isArray(plan.history)) {
    issues.push({ path: `${p}history`, code: 'invalidValue' })
  } else {
    plan.history.forEach((c, i) => {
      const cp = `${p}history[${i}].`
      if (!c || typeof c !== 'object') {
        issues.push({ path: `${p}history[${i}]`, code: 'invalidValue' })
        return
      }
      checkDate(c.dueDate, `${cp}dueDate`, issues)
      for (const key of ['targetMinor', 'reservedMinor', 'paidMinor'] as const) {
        if (!isMinorAmount(c[key]) || c[key] < 0 || c[key] > MAX_AMOUNT_MINOR) issues.push({ path: `${cp}${key}`, code: 'invalidAmount' })
      }
      if (!isValidId(c.txId)) issues.push({ path: `${cp}txId`, code: 'invalidId' })
      if (c.surplus !== 'none' && c.surplus !== 'release' && c.surplus !== 'carry') issues.push({ path: `${cp}surplus`, code: 'invalidValue' })
      if (!isValidTimestamp(c.paidAt)) issues.push({ path: `${cp}paidAt`, code: 'invalidTimestamp' })
    })
  }
  return issues
}

export const PERIOD_TEMPLATES = ['semester', 'trip', 'custom'] as const

export function validatePeriodBudget(b: PeriodBudget, ctx: { data: Pick<AppData, 'settings' | 'goals'>; prefix?: string }): Issue[] {
  const p = ctx.prefix ?? ''
  const issues: Issue[] = []
  if (!isValidId(b.id)) issues.push({ path: `${p}id`, code: 'invalidId' })
  checkName(b.name, `${p}name`, issues)
  if (!isOneOf(PERIOD_TEMPLATES, b.template)) issues.push({ path: `${p}template`, code: 'invalidValue' })
  checkDate(b.startDate, `${p}startDate`, issues)
  checkDate(b.endDate, `${p}endDate`, issues)
  if (isValidLocalDate(b.startDate) && isValidLocalDate(b.endDate) && b.endDate < b.startDate) issues.push({ path: `${p}endDate`, code: 'endBeforeStart' })
  checkPositiveAmount(b.allocatedMinor, `${p}allocatedMinor`, issues)
  if (b.currency !== ctx.data.settings.currency) {
    issues.push({ path: `${p}currency`, code: 'currencyMismatch', params: { expected: ctx.data.settings.currency } })
  }
  if (!Array.isArray(b.txIds) || !b.txIds.every(isValidId) || new Set(b.txIds).size !== b.txIds.length) {
    issues.push({ path: `${p}txIds`, code: 'invalidValue' })
  }
  if (b.goalId !== undefined && !ctx.data.goals.some((g) => g.id === b.goalId)) issues.push({ path: `${p}goalId`, code: 'notFound' })
  if (
    b.ruleCategoryIds !== undefined &&
    (!Array.isArray(b.ruleCategoryIds) ||
      b.ruleCategoryIds.length > 30 ||
      !b.ruleCategoryIds.every((c) => typeof c === 'string' && (isExpenseCategory(c) || (isCustomCategoryId(c) && isValidId(c)))) ||
      new Set(b.ruleCategoryIds).size !== b.ruleCategoryIds.length)
  ) {
    issues.push({ path: `${p}ruleCategoryIds`, code: 'invalidValue' })
  }
  if (typeof b.archived !== 'boolean') issues.push({ path: `${p}archived`, code: 'invalidValue' })
  checkOptionalText(b.note, `${p}note`, issues)
  checkTimestamps(b, p, issues)
  return issues
}

export const MAX_SCENARIO_CHANGES = 10

export function validateScenario(sc: SavedScenario, prefix = ''): Issue[] {
  const issues: Issue[] = []
  if (!isValidId(sc.id)) issues.push({ path: `${prefix}id`, code: 'invalidId' })
  checkName(sc.name, `${prefix}name`, issues)
  if (!Array.isArray(sc.changes) || sc.changes.length === 0 || sc.changes.length > MAX_SCENARIO_CHANGES) {
    issues.push({ path: `${prefix}changes`, code: 'invalidValue' })
  } else {
    sc.changes.forEach((c, i) => {
      const cp = `${prefix}changes[${i}].`
      if (!c || typeof c !== 'object') return void issues.push({ path: `${prefix}changes[${i}]`, code: 'invalidValue' })
      if (c.type === 'purchase' || c.type === 'income') {
        checkPositiveAmount(c.amountMinor, `${cp}amountMinor`, issues)
        checkDate(c.date, `${cp}date`, issues)
        checkOptionalText(c.note, `${cp}note`, issues)
        if (c.accountId !== undefined && !isValidId(c.accountId)) issues.push({ path: `${cp}accountId`, code: 'invalidId' })
      } else if (c.type === 'scheduleAmount') {
        if (!isValidId(c.scheduleId)) issues.push({ path: `${cp}scheduleId`, code: 'invalidId' })
        checkPositiveAmount(c.newAmountMinor, `${cp}newAmountMinor`, issues)
      } else {
        issues.push({ path: `${cp}type`, code: 'invalidValue' })
      }
    })
  }
  if (typeof sc.baseFingerprint !== 'string' || sc.baseFingerprint.length === 0 || sc.baseFingerprint.length > 64) {
    issues.push({ path: `${prefix}baseFingerprint`, code: 'invalidValue' })
  }
  checkTimestamps(sc, prefix, issues)
  return issues
}

/* ------------------------------------------------------------------ */
/* Plantillas e historial (v8)                                         */
/* ------------------------------------------------------------------ */

export const TEMPLATE_MAX_LINES = 20
export const TEMPLATES_MAX = 200

function checkTemplateAmount(a: unknown, path: string, issues: Issue[]) {
  const v = a as { mode?: unknown; amountMinor?: unknown; bps?: unknown } | null
  if (!v || typeof v !== 'object') return void issues.push({ path, code: 'invalidValue' })
  if (v.mode === 'fixed') checkPositiveAmount(v.amountMinor, `${path}.amountMinor`, issues)
  else if (v.mode === 'percent') {
    if (typeof v.bps !== 'number' || !Number.isSafeInteger(v.bps) || v.bps <= 0 || v.bps > 10000) issues.push({ path: `${path}.bps`, code: 'invalidValue' })
  } else issues.push({ path: `${path}.mode`, code: 'invalidValue' })
}

/**
 * Plantilla con nombre. Solo se valida la ESTRUCTURA: las categorías o metas a las que apunta
 * pueden archivarse o borrarse después; eso se detecta (y se explica) al usarla, nunca invalida
 * los datos guardados.
 */
export function validateTemplate(tpl: Template, prefix = ''): Issue[] {
  const issues: Issue[] = []
  if (!isValidId(tpl.id)) issues.push({ path: `${prefix}id`, code: 'invalidId' })
  if (typeof tpl.name !== 'string' || tpl.name.trim().length === 0) issues.push({ path: `${prefix}name`, code: 'required' })
  else if (tpl.name.length > LIMITS.nameMax) issues.push({ path: `${prefix}name`, code: 'textTooLong', params: { max: LIMITS.nameMax } })
  if (tpl.kind !== 'split' && tpl.kind !== 'distribution') issues.push({ path: `${prefix}kind`, code: 'invalidValue' })
  if (!Array.isArray(tpl.lines) || tpl.lines.length === 0 || tpl.lines.length > TEMPLATE_MAX_LINES) {
    issues.push({ path: `${prefix}lines`, code: 'invalidValue' })
  } else {
    let percent = 0
    tpl.lines.forEach((l, i) => {
      const lp = `${prefix}lines[${i}]`
      if (!l || typeof l !== 'object') return void issues.push({ path: lp, code: 'invalidValue' })
      checkTemplateAmount(l.amount, `${lp}.amount`, issues)
      if (l.amount?.mode === 'percent' && typeof l.amount.bps === 'number') percent += l.amount.bps
      if (tpl.kind === 'split') {
        const c = (l as { categoryId?: unknown }).categoryId
        if (typeof c !== 'string' || c.length === 0 || c.length > 64) issues.push({ path: `${lp}.categoryId`, code: 'invalidCategory' })
      } else {
        const t = (l as { target?: { kind?: unknown; goalId?: unknown; scheduleId?: unknown } }).target
        const ok = t && ((t.kind === 'goal' && isValidId(t.goalId)) || (t.kind === 'payment' && isValidId(t.scheduleId)))
        if (!ok) issues.push({ path: `${lp}.target`, code: 'invalidValue' })
      }
    })
    if (percent > 10000) issues.push({ path: `${prefix}lines`, code: 'percentOver100' })
  }
  if (!isValidTimestamp(tpl.createdAt)) issues.push({ path: `${prefix}createdAt`, code: 'invalidTimestamp' })
  if (!isValidTimestamp(tpl.updatedAt)) issues.push({ path: `${prefix}updatedAt`, code: 'invalidTimestamp' })
  return issues
}

export const HISTORY_COLLECTIONS: readonly HistoryCollection[] = ['accounts', 'transactions', 'schedules', 'goals', 'trash', 'reconciliations', 'incomeDistributions', 'periodBudgets', 'settings']
const HISTORY_SOURCES: readonly HistorySource[] = ['app', 'revert', 'plan', 'replace']
/** Margen de seguridad al importar (la app conserva como mucho HISTORY_MAX_ENTRIES). */
const HISTORY_IMPORT_MAX = 5000

/**
 * Entrada del historial. Las instantáneas (antes/después) no se validan a fondo: son valores
 * pasados. Revertir siempre vuelve a validar los datos completos antes de guardar.
 */
export function validateHistory(history: HistoryEntry[], prefix = 'history'): Issue[] {
  if (!Array.isArray(history)) return [{ path: prefix, code: 'invalidValue' }]
  if (history.length > HISTORY_IMPORT_MAX) return [{ path: prefix, code: 'tooMany', params: { max: HISTORY_IMPORT_MAX } }]
  const issues: Issue[] = []
  history.forEach((e, i) => {
    const p = `${prefix}[${i}].`
    if (!e || typeof e !== 'object') return void issues.push({ path: `${prefix}[${i}]`, code: 'invalidValue' })
    if (!isValidId(e.id)) issues.push({ path: `${p}id`, code: 'invalidId' })
    if (!isValidTimestamp(e.at)) issues.push({ path: `${p}at`, code: 'invalidTimestamp' })
    if (!HISTORY_SOURCES.includes(e.source)) issues.push({ path: `${p}source`, code: 'invalidValue' })
    if (e.revertOf !== undefined && !isValidId(e.revertOf)) issues.push({ path: `${p}revertOf`, code: 'invalidId' })
    if (!Array.isArray(e.changes)) return void issues.push({ path: `${p}changes`, code: 'invalidValue' })
    e.changes.forEach((c, j) => {
      const ok =
        c &&
        typeof c === 'object' &&
        HISTORY_COLLECTIONS.includes(c.collection) &&
        typeof c.id === 'string' &&
        c.id.length > 0 &&
        c.id.length <= 64 &&
        (c.before === null || typeof c.before === 'object') &&
        (c.after === null || typeof c.after === 'object')
      if (!ok) issues.push({ path: `${p}changes[${j}]`, code: 'invalidValue' })
    })
  })
  return issues
}
