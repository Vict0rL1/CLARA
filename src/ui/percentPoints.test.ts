import { describe, expect, it } from 'vitest'
import { createFormatter } from './format'
import { baseData } from '../test/fixtures'

describe('fmt.percentPoints', () => {
  it('puntos enteros con espacio y signo propio en los cuatro idiomas; miles con el separador del idioma', () => {
    const base = baseData().settings
    for (const [language, numberLocale, big] of [['es', 'es-MX', '9,900 %'], ['en', 'en-CA', '9,900 %'], ['pt', 'pt-BR', '9.900 %'], ['fr', 'fr-CA', '9 900 %']] as const) {
      const fmt = createFormatter({ ...base, language, numberLocale })
      expect(fmt.percentPoints(200), language).toBe('200 %')
      expect(fmt.percentPoints(-9), language).toBe('-9 %')
      expect(fmt.percentPoints(0), language).toBe('0 %')
      expect(fmt.percentPoints(9900).replace(/[  ]/g, ' '), language).toBe(big)
    }
  })
})
