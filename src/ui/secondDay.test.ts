import { describe, expect, it } from 'vitest'
import { bill } from '../test/fixtures'
import { secondDayDraft, secondDayError, secondDayForScope } from './secondDay'

/** «Dos veces al mes» los días 15 y 30, desde junio. Hoy = 28-sep: «desde» propone el 30-sep. */
const twice = bill('2026-06-15', 1000, { id: 'tw', frequency: 'semimonthly', secondDay: 30 })

describe('segundo día al cambiar «a todas las fechas» ↔ «desde una fecha» (SCH-01)', () => {
  it('desde el 30 (el segundo día): el tramo nuevo empieza el 30 con segundo día 15, no 30 y 30', () => {
    const open = secondDayDraft('30')
    const from = secondDayForScope(open, twice, 'from', '2026-09-30')
    expect(from).toEqual({ text: '15', original: '30', auto: '15' })
    expect(secondDayError('2026-09-30', from.text)).toBe(false)
    // Lo que había antes del cambio quedaba bloqueado: los dos días serían el 30.
    expect(secondDayError('2026-09-30', open.text)).toBe(true)
    // Volver a «todas las fechas» devuelve el original.
    expect(secondDayForScope(from, twice, 'all', '2026-06-15')).toEqual({ text: '30', original: '30', auto: null })
  })

  it('cambiar la fecha «desde» vuelve a calcularlo mientras la persona no lo toque', () => {
    let d = secondDayForScope(secondDayDraft('30'), twice, 'from', '2026-09-30')
    d = secondDayForScope(d, twice, 'from', '2026-10-15')
    expect(d).toEqual({ text: '30', original: '30', auto: '30' })
    // Una fecha que no es de la serie: el valor original y la validación normal (la persona cambia los días).
    d = secondDayForScope(d, twice, 'from', '2026-10-05')
    expect(d).toEqual({ text: '30', original: '30', auto: null })
    d = secondDayForScope(d, twice, 'from', '2026-10-30')
    expect(d.text).toBe('15')
  })

  it('lo que la persona escribió (o dejó a medias) se respeta y pasa por la validación normal', () => {
    const typed = secondDayForScope({ ...secondDayForScope(secondDayDraft('30'), twice, 'from', '2026-09-30'), text: '22' }, twice, 'from', '2026-10-15')
    expect(typed).toEqual({ text: '22', original: '30', auto: null })
    expect(secondDayForScope(typed, twice, 'all', '2026-06-15').text).toBe('22')
    const cleared = secondDayForScope({ text: '', original: '30', auto: '15' }, twice, 'from', '2026-10-15')
    expect(cleared).toEqual({ text: '', original: '30', auto: null })
  })

  it('segundo día implícito (vacío = 15 días después): al partir se escribe el que conserva los días', () => {
    const implicit = bill('2026-06-01', 1000, { id: 'im', frequency: 'semimonthly' })
    const d = secondDayForScope(secondDayDraft(''), implicit, 'from', '2026-10-16')
    // Desde el 16 el vacío daría 31 (16 + 15): se escribe 1 para seguir el 1 y el 16.
    expect(d).toEqual({ text: '1', original: '', auto: '1' })
    expect(secondDayForScope(d, implicit, 'all', '2026-06-01')).toEqual({ text: '', original: '', auto: null })
  })

  it('un programado que no es «dos veces al mes», o uno nuevo, no cambia nada', () => {
    const monthly = bill('2026-06-15', 1000, { frequency: 'monthly' })
    expect(secondDayForScope(secondDayDraft(''), monthly, 'from', '2026-10-15')).toEqual({ text: '', original: '', auto: null })
    expect(secondDayForScope(secondDayDraft('20'), undefined, 'from', '2026-10-15')).toEqual({ text: '20', original: '20', auto: null })
  })
})
