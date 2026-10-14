/**
 * Secciones de Ajustes: una sola lista que usan el índice, los enlaces profundos
 * (`#/ajustes?seccion=<id>`, `#/ajustes/<id>`) y la búsqueda. El `id` es también el id del
 * elemento al que se desplaza la página (el título de la tarjeta).
 */
import type { MessageKey } from '../../../i18n'
import type { IconName } from '../../components/iconPaths'

export type SettingsGroup = 'general' | 'expenses' | 'data' | 'help'
export const SETTINGS_GROUPS: readonly SettingsGroup[] = ['general', 'expenses', 'data', 'help']

export interface SettingsSection {
  id: string
  titleKey: MessageKey
  group: SettingsGroup
  icon: IconName
  /** Pantalla propia (en vez de una tarjeta dentro de Ajustes). */
  href?: string
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'formato', titleKey: 'settings.format.title', group: 'general', icon: 'globe' },
  { id: 'personalizar', titleKey: 'personalize.title', group: 'general', icon: 'sliders' },
  { id: 'instalar', titleKey: 'install.title', group: 'general', icon: 'phone' },
  { id: 'cuentas', titleKey: 'settings.toc.accounts', group: 'expenses', icon: 'wallet' },
  { id: 'categorias', titleKey: 'settings.toc.categories', group: 'expenses', icon: 'tag', href: '/ajustes/categorias' },
  { id: 'reglas', titleKey: 'rules.title', group: 'expenses', icon: 'sparkles' },
  { id: 'favoritos', titleKey: 'favorites.title', group: 'expenses', icon: 'star', href: '/movimientos/favoritos' },
  { id: 'etiquetas', titleKey: 'tags.title', group: 'expenses', icon: 'tag' },
  { id: 'programados', titleKey: 'scheduled.title', group: 'expenses', icon: 'calendar' },
  { id: 'safe-to-spend', titleKey: 'safe.title', group: 'expenses', icon: 'shield' },
  { id: 'datos', titleKey: 'settings.toc.data', group: 'data', icon: 'shield' },
  { id: 'copias-locales', titleKey: 'localBackup.title', group: 'data', icon: 'clock' },
  { id: 'copia', titleKey: 'settings.toc.backup', group: 'data', icon: 'download' },
  { id: 'bloqueo', titleKey: 'lock.sectionTitle', group: 'data', icon: 'lock' },
  { id: 'exportar', titleKey: 'export.title', group: 'data', icon: 'upload' },
  { id: 'notificaciones', titleKey: 'settings.notifications.title', group: 'data', icon: 'bell' },
  { id: 'asistente', titleKey: 'assistantSettings.title', group: 'data', icon: 'sparkles' },
  { id: 'reinicio', titleKey: 'settings.toc.reset', group: 'data', icon: 'refund' },
  { id: 'formulas', titleKey: 'settings.toc.formulas', group: 'help', icon: 'info' },
  // Teclado e iPhone en una sola fila: el índice cabe en 3 pantallas a 320 px (C3).
  { id: 'atajos', titleKey: 'settings.shortcuts.indexTitle', group: 'help', icon: 'list' },
  { id: 'legal', titleKey: 'legal.title', group: 'help', icon: 'shield' },
  { id: 'acerca', titleKey: 'settings.toc.about', group: 'help', icon: 'info' },
  { id: 'comentarios', titleKey: 'feedback.title', group: 'help', icon: 'pencil' },
  { id: 'galeria', titleKey: 'settings.toc.gallery', group: 'help', icon: 'film', href: '/galeria' },
]

export const GROUP_TITLE_KEY: Record<SettingsGroup, MessageKey> = {
  general: 'settings.group.general',
  expenses: 'settings.group.expenses',
  data: 'settings.group.data',
  help: 'settings.group.help',
}

/** Ids antiguos que siguen en enlaces guardados o marcadores. */
// «Almacenamiento» vive dentro de «Datos y recuperación» desde la etapa 4; sus enlaces siguen llegando.
const LEGACY_IDS: Record<string, string> = { 'reset-title': 'reinicio', 'format-title': 'formato', 'storage-title': 'datos', almacenamiento: 'datos', 'shortcuts-title': 'atajos', 'atajos-iphone': 'atajos', 'about-title': 'acerca', 'notifications-title': 'notificaciones' }

export function settingsSection(id: string | null | undefined): SettingsSection | undefined {
  if (!id) return undefined
  const resolved = LEGACY_IDS[id] ?? id
  return SETTINGS_SECTIONS.find((s) => s.id === resolved)
}
