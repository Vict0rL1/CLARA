/**
 * Auditoría independiente del PR #15 (cabeza 819eaa9, base a23b135): reproducción y contrato de QA-02 (el colchón de seguridad es un importe guardado: bloquea cambiar la moneda).
 * Datos sintéticos, fechas fijas; falla sobre 819eaa9 y fija el contrato corregido. QA-03 (= STAT-01) y QA-04
 * (= CUR-02) están en `qaV2.test.ts` y `tests/e2e/qa-v2.spec.ts`; la aceptación de navegador en `tests/e2e/qa-pr15.spec.ts`.
 */
import { describe, expect, it } from 'vitest'
import { computeBudget } from './budget'
import { canChangeCurrency, monetaryRecords } from './currencyChange'
import { revertEntry } from './historyRevert'
import { changeCurrency } from './operations'
import type { AppData, HistoryEntry } from './types'
import { account, baseData, ctx, EARLIER, TODAY } from '../test/fixtures'

describe('QA-02 · el colchón de seguridad es un importe guardado: bloquea cambiar la moneda', () => {
  const withBuffer = (bufferMinor: number, currency = 'CAD'): AppData => {
    const b = baseData({ accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 0, date: TODAY, setAt: EARLIER } })] })
    return { ...b, settings: { ...b.settings, currency, safeToSpend: { ...b.settings.safeToSpend, bufferMinor } } }
  }

  it('con colchón 10 000 y nada más: CAD→JPY, JPY→CAD y CAD→USD se rechazan sin tocar nada; con colchón 0 se puede', () => {
    const d = withBuffer(10000)
    expect(monetaryRecords(d)).toEqual(['safeToSpendBuffer'])
    expect(canChangeCurrency(d)).toBe(false)
    for (const [from, to] of [
      ['CAD', 'JPY'],
      ['JPY', 'CAD'],
      ['CAD', 'USD'],
    ] as const) {
      const data = withBuffer(10000, from)
      expect(changeCurrency(data, to, ctx), `${from}→${to}`).toMatchObject({ ok: false, issues: [{ path: 'currency', code: 'currencyMismatch', params: { expected: from } }] })
      expect(data.settings).toMatchObject({ currency: from, safeToSpend: { bufferMinor: 10000 } })
      expect(computeBudget(data, TODAY).safetyBufferMinor).toBe(10000)
    }
    expect(changeCurrency(withBuffer(0), 'JPY', ctx).ok).toBe(true)
  })

  it('deshacer un cambio de moneda anterior (entrada sin `safeToSpend`, como las de antes de v13) no reinterpreta un colchón guardado después', () => {
    const d = withBuffer(5000, 'MXN')
    const settings = { timeZone: d.settings.timeZone, fallbackHorizonDays: null }
    const entry: HistoryEntry = { id: 'e1', at: EARLIER, source: 'app', changes: [{ collection: 'settings', id: 'settings', before: { currency: 'CAD', ...settings }, after: { currency: 'MXN', ...settings } }] }
    const tracked: AppData = { ...d, history: [entry] }
    expect(revertEntry(tracked, 'e1', ctx)).toMatchObject({ ok: false, issues: [{ code: 'currencyMismatch', params: { expected: 'MXN' } }] })
    expect(tracked.settings).toMatchObject({ currency: 'MXN', safeToSpend: { bufferMinor: 5000 } })
  })
})
