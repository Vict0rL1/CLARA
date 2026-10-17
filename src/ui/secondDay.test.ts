import { describe, expect, it } from 'vitest'
import { secondDayError, secondDayFrom } from './secondDay'

describe('segundo día del formulario «dos veces al mes»', () => {
  it('vacío = 15 días después (o antes) del día que fija la serie; escrito = tal cual; sin fecha, 0', () => {
    expect(secondDayFrom('2026-06-01', '')).toBe(16)
    expect(secondDayFrom('2026-06-20', '')).toBe(5)
    expect(secondDayFrom('2026-06-01', '20')).toBe(20)
    expect(secondDayFrom('', '')).toBe(0)
  })

  it('la validación es la del dominio (≥ 7 días entre los dos días) y usa la fecha que fija la serie, no el límite', () => {
    expect(secondDayError('2026-06-01', '5')).toBe(true)
    expect(secondDayError('2026-06-01', '20')).toBe(false)
    // Un tramo partido el 20-oct de una serie fijada el día 1 sigue siendo «1 y 20» (QA-01): válido.
    expect(secondDayError('2026-08-01', '20')).toBe(false)
    expect(secondDayError('nope', '20')).toBe(false)
  })
})
