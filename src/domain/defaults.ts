/**
 * Valores predeterminados del formato v9 (§5 del master prompt). Los usan la configuración
 * inicial, los datos de demostración, los sintéticos, las pruebas y la migración v8 → v9.
 */
import type { AppData, NotificationSettings, SafeToSpendSettings, Settings, UserProfile } from './types'

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  scheduledAlerts: false,
  dailyReminder: false,
  dailyReminderTime: '20:00',
  dailySummary: false,
  dailySummaryTime: '21:00',
  quietHours: false,
  quietFrom: '22:00',
  quietTo: '08:00',
  planAlerts: false,
}

export const DEFAULT_SAFE_TO_SPEND: SafeToSpendSettings = {
  showOnHome: true,
  granularity: 'day',
  subtractScheduled: true,
  subtractGoalContributions: true,
  bufferMinor: 0,
}

export const GUEST_PROFILE: UserProfile = { id: 'guest', isGuest: true }

export type SettingsV9Fields = Pick<
  Settings,
  'budgetPeriod' | 'carryOverBalance' | 'safeToSpend' | 'notifications' | 'biometricLock' | 'onboardingDone' | 'toursSeen' | 'proStatus' | 'aiUsage'
>

/**
 * Campos de ajustes nuevos en v9. `untilIncome` conserva la fórmula original de Clara para los
 * datos existentes; el onboarding nuevo propone «mensual» (decisión 7).
 */
export function defaultSettingsV9(options: { periodType?: Settings['budgetPeriod']['type']; onboardingDone?: boolean } = {}): SettingsV9Fields {
  return {
    budgetPeriod: { type: options.periodType ?? 'untilIncome', weekStartsOn: 1 },
    carryOverBalance: true,
    safeToSpend: { ...DEFAULT_SAFE_TO_SPEND },
    notifications: { ...DEFAULT_NOTIFICATIONS },
    biometricLock: false,
    onboardingDone: options.onboardingDone ?? true,
    toursSeen: [],
    proStatus: { active: false },
    aiUsage: { month: '', count: 0 },
  }
}

export type CollectionsV9 = Pick<AppData, 'categoryPrefs' | 'categoryGroups' | 'tags' | 'plans' | 'profile'>

export function defaultCollectionsV9(): CollectionsV9 {
  return { categoryPrefs: {}, categoryGroups: [], tags: [], plans: [], profile: { ...GUEST_PROFILE } }
}
