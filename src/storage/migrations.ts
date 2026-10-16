/**
 * Migraciones del formato guardado. Cada vez que cambie `SCHEMA_VERSION`,
 * añade aquí una función que convierta la versión anterior a la nueva.
 * Nunca se borra información sin una migración explícita y probada.
 */
import { colorForId } from '../domain/categories'
import { defaultCollectionsV9, defaultSettingsV9 } from '../domain/defaults'
import { isValidTimestamp } from '../domain/dates'
import { isMinorAmount } from '../domain/money'
import { SCHEMA_VERSION } from '../domain/types'

type Raw = Record<string, unknown>

export const MIGRATIONS: Record<number, (raw: Raw) => Raw> = {
  /** v1 → v2: categorías personalizadas (lista vacía). Los datos de tarjeta son opcionales. */
  1: (raw) => ({
    ...raw,
    schemaVersion: 2,
    categories: Array.isArray(raw.categories) ? raw.categories : [],
    categoryLimits: Array.isArray(raw.categoryLimits) ? raw.categoryLimits : [],
  }),
  /** v2 → v3: los movimientos pueden llevar `importRef` (opcional); no cambia nada existente. */
  2: (raw) => ({ ...raw, schemaVersion: 3 }),
  /** v3 → v4: reglas de categoría (lista vacía). */
  3: (raw) => ({ ...raw, schemaVersion: 4, categoryRules: Array.isArray(raw.categoryRules) ? raw.categoryRules : [] }),
  /**
   * v4 → v5: papelera, huellas de importación purgadas, favoritos, conciliaciones y
   * registro de copias (recordatorio semanal por defecto, sin exportaciones previas).
   * Los campos nuevos de movimientos y pagos programados son opcionales: nada existente cambia.
   */
  // Solo se rellenan los campos AUSENTES. Si existen con un formato incorrecto se
  // conservan tal cual para que la validación rechace el archivo: nunca se borran datos.
  4: (raw) => ({
    ...raw,
    schemaVersion: 5,
    trash: raw.trash ?? [],
    purgedImportRefs: raw.purgedImportRefs ?? [],
    favorites: raw.favorites ?? [],
    reconciliations: raw.reconciliations ?? [],
    backup: raw.backup ?? { reminder: 'weekly' },
  }),
  /**
   * v5 → v6: presupuestos por periodo, escenarios guardados y preferencia de revisión
   * semanal (activada). Las metas pueden llevar `plan` y los apartados `reason` (opcionales).
   */
  5: (raw) => ({
    ...raw,
    schemaVersion: 6,
    periodBudgets: raw.periodBudgets ?? [],
    scenarios: raw.scenarios ?? [],
    settings:
      raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings) && (raw.settings as Raw).weeklyReview === undefined
        ? { ...(raw.settings as Raw), weeklyReview: true }
        : raw.settings,
  }),
  /**
   * v6 → v7: bandeja de pendientes y distribuciones de ingresos. Las compras divididas
   * (`splits`) y `distributionId` son opcionales: los datos anteriores no cambian.
   */
  6: (raw) => ({
    ...raw,
    schemaVersion: 7,
    inbox: raw.inbox ?? { snoozed: [], dismissed: [] },
    incomeDistributions: raw.incomeDistributions ?? [],
  }),
  /**
   * v7 → v8: plantillas con nombre e historial local. No hay historial anterior: se empieza a
   * capturar desde esta versión (`historyStartedAt` = último guardado conocido).
   */
  7: (raw) => ({
    ...raw,
    schemaVersion: 8,
    templates: raw.templates ?? [],
    history: raw.history ?? [],
    historyStartedAt: raw.historyStartedAt ?? (typeof raw.updatedAt === 'string' ? raw.updatedAt : raw.createdAt),
  }),
  /**
   * v8 → v9 (Clara v2): periodo de presupuesto, arrastre, safe to spend, notificaciones, bloqueo,
   * onboarding, tours, Pro y uso de IA en ajustes; preferencias de categorías del sistema, grupos,
   * etiquetas, planes (límites) y perfil. Los datos existentes conservan su fórmula
   * (`untilIncome`) y se consideran ya configurados (`onboardingDone`). Solo se rellenan campos
   * ausentes; las categorías personalizadas reciben grupo, icono, color y orden por defecto.
   */
  8: (raw) => {
    const settings = raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings) ? (raw.settings as Raw) : null
    const defaults = defaultSettingsV9({ periodType: 'untilIncome', onboardingDone: true }) as unknown as Raw
    const categories = Array.isArray(raw.categories)
      ? raw.categories.map((c: unknown, i: number) =>
          c && typeof c === 'object' && !Array.isArray(c)
            ? {
                groupId: (c as Raw).kind === 'income' ? 'income' : 'other',
                icon: 'tag',
                color: colorForId(String((c as Raw).id ?? i)),
                sortOrder: 1000 + i,
                ...(c as Raw),
              }
            : c,
        )
      : raw.categories
    return {
      ...raw,
      schemaVersion: 9,
      settings: settings ? { ...defaults, ...settings } : raw.settings,
      categories,
      ...defaultCollectionsV9(),
      ...Object.fromEntries((['categoryPrefs', 'categoryGroups', 'tags', 'plans', 'profile'] as const).filter((k) => raw[k] !== undefined).map((k) => [k, raw[k]])),
    }
  },
  /**
   * v9 → v10: los límites mensuales por categoría (`categoryLimits`) pasan a ser planes
   * recurrentes mensuales (`plans`, kind 'limit') con alertas al 80 % y 100 %. Solo se convierten
   * los bien formados; los demás se conservan en `categoryLimits` para que la validación los
   * señale (nunca se borran). El ciclo (`startDate`/`endDate`) lo fija el primer cierre de planes
   * al abrir la app. Las metas pueden llevar `contribution` (opcional).
   */
  9: (raw) => {
    const limits = Array.isArray(raw.categoryLimits) ? raw.categoryLimits : []
    const plans = Array.isArray(raw.plans) ? raw.plans : []
    const settings = raw.settings && typeof raw.settings === 'object' ? (raw.settings as Raw) : {}
    const stamp = isValidTimestamp(raw.updatedAt) ? raw.updatedAt : '1970-01-01T00:00:00.000Z'
    const ok = (l: unknown): l is { categoryId: string; monthlyLimitMinor: number } =>
      !!l && typeof l === 'object' && !Array.isArray(l) && typeof (l as Raw).categoryId === 'string' && isMinorAmount((l as Raw).monthlyLimitMinor) && ((l as Raw).monthlyLimitMinor as number) > 0
    const converted = limits.filter(ok).map((l) => ({
      id: `limit_${l.categoryId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64),
      kind: 'limit',
      name: '',
      categoryIds: [l.categoryId],
      amountMinor: l.monthlyLimitMinor,
      currency: settings.currency,
      periodType: 'month',
      recurring: true,
      status: 'active',
      alertAt80: true,
      alertAt100: true,
      createdAt: stamp,
      updatedAt: stamp,
    }))
    const existing = new Set(plans.map((p: unknown) => (p && typeof p === 'object' ? (p as Raw).id : undefined)))
    return {
      ...raw,
      schemaVersion: 10,
      plans: [...plans, ...converted.filter((p) => !existing.has(p.id))],
      categoryLimits: limits.filter((l) => !ok(l)),
    }
  },
  // v10 → v11: cuentas con `archived` y `order`. Solo se rellena lo ausente: una cuenta ya
  // archivada u ordenada no cambia, y una entrada mal formada se conserva tal cual para que
  // la validación la señale (nunca se borra para resolver un error de esquema).
  10: (raw) => ({
    ...raw,
    schemaVersion: 11,
    ...(Array.isArray(raw.accounts)
      ? {
          accounts: raw.accounts.map((a: unknown, i: number) =>
            a && typeof a === 'object' && !Array.isArray(a)
              ? { ...(a as Raw), ...((a as Raw).archived === undefined ? { archived: false } : {}), ...((a as Raw).order === undefined ? { order: i } : {}) }
              : a,
          ),
        }
      : {}),
  }),
  // v11 → v12: planes con `rollover` ('none' = comportamiento de siempre). Solo se rellena lo
  // ausente; `carriedMinor` queda ausente (ningún plan existente arrastró nada).
  11: (raw) => ({
    ...raw,
    schemaVersion: 12,
    ...(Array.isArray(raw.plans)
      ? { plans: raw.plans.map((p: unknown) => (p && typeof p === 'object' && !Array.isArray(p) ? { ...(p as Raw), ...((p as Raw).rollover === undefined ? { rollover: 'none' } : {}) } : p)) }
      : {}),
  }),
  // v12 → v13 (Clara 2.0): colchón de seguridad del *safe to spend* (0 = lo de siempre). También admite
  // tipos de cuenta y frecuencias nuevos, que no necesitan relleno: una versión anterior verá «datos de
  // una versión más nueva» en vez de darlos por dañados. Solo se rellena lo ausente.
  12: (raw) => {
    const settings = raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings) ? (raw.settings as Raw) : null
    const sts = settings?.safeToSpend && typeof settings.safeToSpend === 'object' && !Array.isArray(settings.safeToSpend) ? (settings.safeToSpend as Raw) : null
    return {
      ...raw,
      schemaVersion: 13,
      ...(settings && sts && sts.bufferMinor === undefined ? { settings: { ...settings, safeToSpend: { ...sts, bufferMinor: 0 } } } : {}),
    }
  },
}

export function migrate(raw: Raw): Raw {
  let current = raw
  let version = Number(current.schemaVersion)
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) throw new Error(`Falta la migración desde la versión ${version}`)
    current = step(current)
    version = Number(current.schemaVersion)
  }
  return current
}
