import { describe, expect, it } from 'vitest'
import { linesFromObservations, OCR_OBSERVATIONS_MAX, readObservations } from './ocrLines'

/** Un trozo como lo da Vision: origen abajo a la izquierda, de 0 a 1. */
const obs = (text: string, x: number, top: number, width = 0.2, height = 0.03) => ({ text, x, y: 1 - top - height, width, height })

describe('linesFromObservations', () => {
  it('junta los trozos de la misma fila de izquierda a derecha y ordena las filas de arriba abajo', () => {
    const lines = linesFromObservations([
      obs('12.50', 0.7, 0.801),
      obs('TOTAL', 0.1, 0.8),
      obs('CAFÉ CENTRAL', 0.2, 0.05, 0.6),
      obs('2026-11-24', 0.1, 0.12),
      obs('Gracias', 0.3, 0.95),
    ])
    expect(lines).toEqual(['CAFÉ CENTRAL', '2026-11-24', 'TOTAL 12.50', 'Gracias'])
  })

  it('dos filas cercanas que no se solapan siguen separadas', () => {
    expect(linesFromObservations([obs('SUBTOTAL 11.00', 0.1, 0.5), obs('TAX 1.50', 0.1, 0.54)])).toEqual(['SUBTOTAL 11.00', 'TAX 1.50'])
  })

  it('una fila ligeramente torcida (el centro cae dentro de la altura) sigue siendo una', () => {
    expect(linesFromObservations([obs('TOTAL', 0.1, 0.6), obs('$4.25', 0.75, 0.615)])).toEqual(['TOTAL $4.25'])
  })

  it('sin trozos no hay líneas', () => {
    expect(linesFromObservations([])).toEqual([])
  })
})

describe('readObservations', () => {
  it('se queda con los trozos válidos y limpia los espacios', () => {
    expect(readObservations([{ text: '  TOTAL   12.50 ', x: 0.1, y: 0.2, width: 0.5, height: 0.03 }])).toEqual([{ text: 'TOTAL 12.50', x: 0.1, y: 0.2, width: 0.5, height: 0.03 }])
  })

  it('ignora lo que no tiene la forma esperada; nunca lanza', () => {
    expect(readObservations(null)).toEqual([])
    expect(readObservations('texto')).toEqual([])
    expect(
      readObservations([null, 3, { text: '', x: 0, y: 0, width: 1, height: 1 }, { text: 'x', x: 'a', y: 0, width: 1, height: 1 }, { text: 'x', x: 0, y: 0, width: 1, height: 0 }, { text: 'x', x: 2, y: 0, width: 1, height: 1 }]),
    ).toEqual([])
  })

  it('lee como mucho OCR_OBSERVATIONS_MAX trozos', () => {
    const many = Array.from({ length: OCR_OBSERVATIONS_MAX + 10 }, (_, i) => ({ text: `l${i}`, x: 0, y: 0.5, width: 0.1, height: 0.01 }))
    expect(readObservations(many)).toHaveLength(OCR_OBSERVATIONS_MAX)
  })
})
