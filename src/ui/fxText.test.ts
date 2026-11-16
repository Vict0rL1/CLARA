import { describe, expect, it } from 'vitest'
import { feeLabel, rateLabel } from './fxText'

describe('fxText', () => {
  it('tasas con el separador del idioma y «≈» si no es exacta', () => {
    expect(rateLabel('0.0092', 'es-MX')).toBe('0.0092')
    expect(rateLabel('0.0092', 'fr-CA')).toBe('0,0092')
    expect(rateLabel('1117/120000', 'es-MX')).toBe('≈ 0.009308')
  })
  it('comisiones sin ceros de sobra', () => {
    expect(feeLabel(250, 'es-MX')).toBe('2.5')
    expect(feeLabel(250, 'fr-CA')).toBe('2,5')
    expect(feeLabel(1000, 'es-MX')).toBe('10')
    expect(feeLabel(25, 'es-MX')).toBe('0.25')
    expect(feeLabel(10000, 'es-MX')).toBe('100')
  })
})
