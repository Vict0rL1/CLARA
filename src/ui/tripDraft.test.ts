import { describe, expect, it } from 'vitest'
import { tripDraftFrom, tripFromDraft, type TripDraft } from './tripDraft'

const draft = (d: Partial<TripDraft> = {}): TripDraft => ({
  on: true,
  currencies: ['JPY', 'KRW'],
  local: 'JPY',
  rates: { JPY: { rate: '0,0092', date: '2026-09-25' }, KRW: { rate: '', date: '2026-09-25' } },
  fee: '2,5',
  ...d,
})

describe('modo viaje: de lo escrito a TripSettings', () => {
  it('en francés lee la coma decimal; una tasa vacía es «sin tasa» (nunca una inventada)', () => {
    expect(tripFromDraft(draft(), ',', 'fr-CA')).toEqual({
      ok: true,
      trip: { currencies: ['JPY', 'KRW'], localCurrency: 'JPY', rates: [{ currency: 'JPY', rate: '0.0092', date: '2026-09-25' }], feeBps: 250 },
    })
  })

  it('apagado es null; sin monedas, una tasa que no se lee o una comisión mala no pasan', () => {
    expect(tripFromDraft(draft({ on: false }), '.', 'es-MX')).toEqual({ ok: true, trip: null })
    expect(tripFromDraft(draft({ currencies: [] }), '.', 'es-MX')).toMatchObject({ ok: false, noCurrencies: true })
    // En es-MX la coma no es decimal en una tasa: «0,0092» no se lee (nunca se adivina). La comisión usa el lector de
    // porcentajes de siempre, que sí acepta «2,5».
    expect(tripFromDraft(draft(), '.', 'es-MX')).toMatchObject({ ok: false, badRates: ['JPY'], badFee: false })
    expect(tripFromDraft(draft({ rates: {}, fee: '120' }), ',', 'fr-CA')).toMatchObject({ ok: false, badRates: [], badFee: true })
    expect(tripFromDraft(draft({ rates: { JPY: { rate: 'abc', date: '2026-09-25' } }, fee: '' }), '.', 'es-MX')).toMatchObject({ ok: false, badRates: ['JPY'], badFee: false })
  })

  it('una moneda local que ya no está en el viaje se quita; sin comisión no se guarda feeBps', () => {
    expect(tripFromDraft(draft({ local: 'CNY', rates: {}, fee: '' }), ',', 'fr-CA')).toEqual({ ok: true, trip: { currencies: ['JPY', 'KRW'], rates: [] } })
  })

  it('lo guardado vuelve al formulario con el separador del idioma', () => {
    expect(tripDraftFrom({ currencies: ['JPY'], localCurrency: 'JPY', rates: [{ currency: 'JPY', rate: '0.0092', date: '2026-09-25' }], feeBps: 250 }, ',', 'fr-CA')).toEqual({
      on: true,
      currencies: ['JPY'],
      local: 'JPY',
      rates: { JPY: { rate: '0,0092', date: '2026-09-25' } },
      fee: '2,50',
    })
    expect(tripDraftFrom(undefined, '.', 'es-MX')).toEqual({ on: false, currencies: [], local: '', rates: {}, fee: '' })
  })
})
