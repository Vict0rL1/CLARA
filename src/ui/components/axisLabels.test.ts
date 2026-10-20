import { describe, expect, it } from 'vitest'
import { estimateAxisTextWidth, pickAxisLabels } from './axisLabels'

/** Seis huecos de 320 − 16 de márgenes: lo que usa `IncomeExpenseBars`. */
const SLOT = (320 - 16) / 6

describe('etiquetas del eje por anchura de hueco (F-05)', () => {
  it('seis fechas completas con año (es, periodo personalizado del 1 al 31 de julio) no caben: se usa la forma corta y todas se ven', () => {
    const points = ['27 ene 2026', '27 feb 2026', '30 mar 2026', '30 abr 2026', '31 may 2026', '1 jul 2026'].map((full) => [full, full.replace(' 2026', '')])
    expect(points.every(([full]) => estimateAxisTextWidth(full!) > SLOT)).toBe(true)
    expect(pickAxisLabels(points, SLOT)).toEqual(['27 ene', '27 feb', '30 mar', '30 abr', '31 may', '1 jul'])
  })

  it('cuando la forma larga cabe (meses «sep», «oct»…) se conserva tal cual', () => {
    const months = ['abr', 'may', 'jun', 'jul', 'ago', 'sep'].map((m) => [m])
    expect(pickAxisLabels(months, SLOT)).toEqual(['abr', 'may', 'jun', 'jul', 'ago', 'sep'])
  })

  it('si ni la forma corta cabe, se dibuja una de cada k y la última (el periodo actual) siempre', () => {
    const wide = Array.from({ length: 6 }, (_, i) => [`etiqueta larguísima ${i}`])
    const shown = pickAxisLabels(wide, SLOT)
    expect(shown.at(-1)).toBe('etiqueta larguísima 5')
    expect(shown.filter((l) => l !== null).length).toBeLessThan(6)
    expect(shown.filter((l) => l !== null).length).toBeGreaterThan(0)
    // Las que se dibujan están separadas al menos `k` huecos: ninguna vecina directa cuando ninguna cabe.
    for (let i = 1; i < shown.length; i++) expect(shown[i] !== null && shown[i - 1] !== null).toBe(false)
  })

  it('en inglés y francés (año fuera por `today`) las seis fechas cortas caben en los seis huecos', () => {
    expect(pickAxisLabels(['Jan 27', 'Feb 27', 'Mar 30', 'Apr 30', 'May 31', 'Jul 1'].map((l) => [l]), SLOT).every((l) => l !== null)).toBe(true)
    expect(pickAxisLabels(['27 janv', '27 févr', '30 mars', '30 avr', '31 mai', '1 juil'].map((l) => [l]), SLOT).every((l) => l !== null)).toBe(true)
  })

  it('sin puntos no hay etiquetas y un hueco de 0 no divide entre cero', () => {
    expect(pickAxisLabels([], SLOT)).toEqual([])
    expect(pickAxisLabels([['a'], ['b']], 0)).toEqual([null, 'b'])
  })
})
