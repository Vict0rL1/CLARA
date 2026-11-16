import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BOC_CURRENCIES, bocConversion, bocKey, bocObservationsUrl, bocResultFinal, bocSeries, bocWindow, parseBocObservations, pickBocRate, type BocRate } from './boc'
import { isSupportedCurrency } from './money'
import type { CurrencyCode } from './types'

/** Respuestas REALES de Valet guardadas el 2026-11-16 (`docs/BOC-VALET.md`). */
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./__fixtures__/boc/${name}`, import.meta.url), 'utf8'))
const JPY = fixture('FXJPYCAD-2026-11-04_2026-11-10.json')
const USD = fixture('FXUSDCAD-2025-12-22_2026-01-05.json')
const NOT_FOUND = fixture('FXXXXCAD-404.json')
const EMPTY = fixture('FXUSDCAD-2026-11-07_2026-11-08-empty.json')
const VND = fixture('FXVNDCAD-2026-10-30_2026-11-09-discontinued.json')

const read = (json: unknown, series: string): BocRate[] => {
  const r = parseBocObservations(json, series)
  if (!r.ok) throw new Error(r.error)
  return r.observations
}

describe('Banco de Canadá: qué se pide', () => {
  it('solo con presupuesto en CAD y solo series que publica el banco', () => {
    expect(bocSeries('CAD', 'JPY')).toBe('FXJPYCAD')
    expect(bocSeries('CAD', 'USD')).toBe('FXUSDCAD')
    expect(bocSeries('USD', 'JPY')).toBeNull()
    expect(bocSeries('CAD', 'CAD')).toBeNull()
    // La corona danesa la admite Clara pero el banco no la publica; el rublo lo publica pero Clara no lo admite.
    expect(bocSeries('CAD', 'DKK')).toBeNull()
    expect(bocSeries('CAD', 'RUB')).toBeNull()
    expect(bocSeries('CAD', 'jpy')).toBeNull()
    for (const c of BOC_CURRENCIES) expect(isSupportedCurrency(c)).toBe(true)
    expect(BOC_CURRENCIES).toHaveLength(26)
  })

  it('la dirección lleva la serie y dos fechas: nada de la persona', () => {
    expect(bocObservationsUrl('FXJPYCAD', '2026-11-10')).toBe('https://www.bankofcanada.ca/valet/observations/FXJPYCAD/json?start_date=2026-10-31&end_date=2026-11-10')
    // El banco exige inicio < fin («The End date must be greater than the Start date»).
    const w = bocWindow('2026-03-01')
    expect(w).toEqual({ start: '2026-02-19', end: '2026-03-01' })
    expect(w.start < w.end).toBe(true)
  })

  it('las respuestas guardadas son «dólares canadienses por 1 unidad»: la misma dirección que la tasa de Clara', () => {
    const unit = (json: unknown, s: string) => (json as { seriesDetail: Record<string, { metadata: { unit: string } }> }).seriesDetail[s]!.metadata.unit
    expect(unit(JPY, 'FXJPYCAD')).toBe('Canadian dollars per Japanese yen')
    expect(unit(USD, 'FXUSDCAD')).toBe('Canadian dollars per US dollar')
  })
})

describe('Banco de Canadá: leer la respuesta', () => {
  it('el valor es TEXTO exacto y se guarda en forma canónica (sin ceros de sobra)', () => {
    expect(read(JPY, 'FXJPYCAD')).toEqual([
      { rateDate: '2026-11-04', rate: '0.00881' },
      { rateDate: '2026-11-05', rate: '0.00886' },
      { rateDate: '2026-11-06', rate: '0.00891' },
      { rateDate: '2026-11-09', rate: '0.00894' },
      { rateDate: '2026-11-10', rate: '0.00894' },
    ])
    expect(read(USD, 'FXUSDCAD').map((o) => o.rate)).toEqual(['1.3748', '1.3705', '1.3674', '1.3686', '1.3693', '1.3706', '1.3737', '1.3768'])
  })

  it('una serie que no existe es «notFound»; una lista vacía no es un error', () => {
    expect(parseBocObservations(NOT_FOUND, 'FXXXXCAD')).toEqual({ ok: false, error: 'notFound' })
    expect(parseBocObservations(EMPTY, 'FXUSDCAD')).toEqual({ ok: true, observations: [] })
    expect(parseBocObservations(VND, 'FXVNDCAD')).toEqual({ ok: true, observations: [] })
  })

  it('una respuesta mal formada no da ninguna tasa (aunque otras observaciones estén bien)', () => {
    const base = { seriesDetail: { FXUSDCAD: {} } }
    const ok = { d: '2026-11-10', FXUSDCAD: { v: '1.4000' } }
    const bad = (v: unknown) => parseBocObservations({ ...base, observations: [ok, { d: '2026-11-11', FXUSDCAD: { v } }] }, 'FXUSDCAD')
    for (const v of [1.4, '1,4', '1e-3', '-1.4', '0', '0.0000', '', ' 1.4', 'NaN', null]) expect(bad(v)).toEqual({ ok: false, error: 'malformed' })
    expect(parseBocObservations({ ...base, observations: [{ d: '2026-02-30', FXUSDCAD: { v: '1.4' } }] }, 'FXUSDCAD')).toEqual({ ok: false, error: 'malformed' })
    expect(parseBocObservations({ observations: [ok] }, 'FXUSDCAD')).toEqual({ ok: false, error: 'malformed' })
    expect(parseBocObservations({ ...base, observations: 'x' }, 'FXUSDCAD')).toEqual({ ok: false, error: 'malformed' })
    // La respuesta de otra serie no vale para esta.
    expect(parseBocObservations(JPY, 'FXUSDCAD')).toEqual({ ok: false, error: 'malformed' })
    for (const json of [null, 'texto', [], 42]) expect(parseBocObservations(json, 'FXUSDCAD')).toEqual({ ok: false, error: 'malformed' })
    // Una observación sin valor de esta serie se salta (respuestas de varias series).
    expect(parseBocObservations({ ...base, observations: [ok, { d: '2026-11-11', FXEURCAD: { v: '1.6' } }] }, 'FXUSDCAD')).toEqual({ ok: true, observations: [{ rateDate: '2026-11-10', rate: '1.4' }] })
  })
})

describe('Banco de Canadá: el último día hábil publicado ≤ la fecha del gasto', () => {
  const jpy = read(JPY, 'FXJPYCAD')
  const usd = read(USD, 'FXUSDCAD')

  it('fin de semana: la del viernes', () => {
    expect(pickBocRate(jpy, '2026-11-07')).toEqual({ rateDate: '2026-11-06', rate: '0.00891' })
    expect(pickBocRate(jpy, '2026-11-08')).toEqual({ rateDate: '2026-11-06', rate: '0.00891' })
    expect(pickBocRate(jpy, '2026-11-09')).toEqual({ rateDate: '2026-11-09', rate: '0.00894' })
  })

  it('festivos: Navidad y el 26 → la del 24; Año Nuevo → la del 31', () => {
    expect(pickBocRate(usd, '2025-12-25')?.rateDate).toBe('2025-12-24')
    expect(pickBocRate(usd, '2025-12-28')).toEqual({ rateDate: '2025-12-24', rate: '1.3674' })
    expect(pickBocRate(usd, '2026-01-01')).toEqual({ rateDate: '2025-12-31', rate: '1.3706' })
  })

  it('antes del primer dato no hay tasa; nunca una posterior a la fecha del gasto', () => {
    expect(pickBocRate(jpy, '2026-11-03')).toBeNull()
    expect(pickBocRate(usd, '2025-12-21')).toBeNull()
    expect(pickBocRate([], '2026-11-10')).toBeNull()
  })

  it('una observación de más de 10 días antes no vale (serie que ya no se publica)', () => {
    const old: BocRate[] = [{ rateDate: '2026-10-30', rate: '0.000056' }]
    expect(pickBocRate(old, '2026-11-09')).toEqual(old[0])
    expect(pickBocRate(old, '2026-11-10')).toBeNull()
  })

  it('no depende del orden de la lista', () => {
    expect(pickBocRate([...jpy].reverse(), '2026-11-08')?.rateDate).toBe('2026-11-06')
  })

  it('lo definitivo (para la caché): la tasa del mismo día, o una fecha de hace dos días o más', () => {
    const today = '2026-11-16'
    expect(bocResultFinal('2026-11-10', { rateDate: '2026-11-10', rate: '0.00894' }, today)).toBe(true)
    expect(bocResultFinal('2026-11-16', { rateDate: '2026-11-16', rate: '0.009' }, today)).toBe(true)
    // Hoy y ayer la del día puede publicarse aún.
    expect(bocResultFinal('2026-11-16', { rateDate: '2026-11-13', rate: '0.009' }, today)).toBe(false)
    expect(bocResultFinal('2026-11-15', null, today)).toBe(false)
    expect(bocResultFinal('2026-11-14', { rateDate: '2026-11-13', rate: '0.009' }, today)).toBe(true)
    expect(bocResultFinal('2026-11-14', null, today)).toBe(true)
  })
})

describe('Banco de Canadá: la conversión (cifras calculadas a mano)', () => {
  const jpy = read(JPY, 'FXJPYCAD')
  const usd = read(USD, 'FXUSDCAD')
  const yen = (minor: number) => ({ currency: 'JPY' as CurrencyCode, minor })

  it('¥1 200 el domingo 8-nov con la del viernes 0.00891 = 10,692 → 10,69 $', () => {
    const r = bocConversion(yen(1200), 'CAD' as CurrencyCode, pickBocRate(jpy, '2026-11-08')!)
    expect(r).toEqual({ amountMinor: 1069, original: { currency: 'JPY', amountMinor: 1200, rate: '0.00891', rateDate: '2026-11-06', rateSource: 'boc' } })
  })

  it('¥1 200 el 10-nov a 0.00894 = 10,728 → 10,73 $; con 2,5 % de comisión 10,9962 → 11,00 $ (un solo redondeo)', () => {
    const rate = pickBocRate(jpy, '2026-11-10')!
    expect(bocConversion(yen(1200), 'CAD' as CurrencyCode, rate)?.amountMinor).toBe(1073)
    const fee = bocConversion(yen(1200), 'CAD' as CurrencyCode, rate, 250)
    expect(fee?.amountMinor).toBe(1100)
    expect(fee?.original).toEqual({ currency: 'JPY', amountMinor: 1200, rate: '0.00894', rateDate: '2026-11-10', rateSource: 'boc', feeBps: 250 })
  })

  it('US$25,00 el 1-ene con la del 31-dic 1.3706 = 34,265 → 34,27 $ (la mitad, hacia arriba)', () => {
    const r = bocConversion({ currency: 'USD' as CurrencyCode, minor: 2500 }, 'CAD' as CurrencyCode, pickBocRate(usd, '2026-01-01')!)
    expect(r?.amountMinor).toBe(3427)
    expect(r?.original.rateDate).toBe('2025-12-31')
  })

  it('sin presupuesto en CAD o con un importe que no llega a medio céntimo: nada', () => {
    const rate = pickBocRate(jpy, '2026-11-10')!
    expect(bocConversion(yen(1200), 'USD' as CurrencyCode, rate)).toBeNull()
    expect(bocConversion({ currency: 'VND' as CurrencyCode, minor: 50 }, 'CAD' as CurrencyCode, { rate: '0.000056', rateDate: '2019-12-31' })).toBeNull()
  })

  it('la clave de una tasa ya pedida', () => {
    expect(bocKey('JPY', '2026-11-10')).toBe('JPY|2026-11-10')
  })
})
