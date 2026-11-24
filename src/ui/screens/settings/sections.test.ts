import { describe, expect, it } from 'vitest'
import { es } from '../../../i18n/es'
import { GROUP_TITLE_KEY, SETTINGS_GROUPS, SETTINGS_SECTIONS, settingsSection } from './sections'

describe('secciones de Ajustes', () => {
  it('cada id existe una sola vez, con grupo válido y título en el diccionario', () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SETTINGS_SECTIONS) {
      expect(SETTINGS_GROUPS, s.id).toContain(s.group)
      expect(es[s.titleKey], `${s.id} → ${s.titleKey}`).toBeTruthy()
      expect(s.id).toMatch(/^[a-z-]+$/)
    }
    for (const g of SETTINGS_GROUPS) expect(es[GROUP_TITLE_KEY[g]]).toBeTruthy()
  })

  it('resuelve ids actuales y antiguos; lo desconocido no resuelve', () => {
    expect(settingsSection('copia')?.id).toBe('copia')
    expect(settingsSection('reset-title')?.id).toBe('reinicio')
    expect(settingsSection('notifications-title')?.id).toBe('notificaciones')
    expect(settingsSection('no-existe')).toBeUndefined()
    expect(settingsSection(null)).toBeUndefined()
  })

  it('«Captura automática» solo existe dentro de la app de iPhone', () => {
    expect(settingsSection('captura')).toBeUndefined()
    expect(settingsSection('captura', true)?.id).toBe('captura')
    expect(SETTINGS_SECTIONS.filter((s) => s.nativeOnly).map((s) => s.id)).toEqual(['captura'])
  })
})
