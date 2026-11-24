import { expect, test } from '@playwright/test'
import type { PeriodBudget, Transaction } from '../../src/domain/types'
import { baseData, EARLIER } from '../../src/test/fixtures'
import { available, expectNoHorizontalScroll, go, seedStoredData, storedData } from './helpers'

/**
 * Fase 3: el asistente durante un viaje. Viaje «Asia» (25-sep → 4-oct) con el yen a 0,0092 y 2,5 % de comisión; el won
 * es del viaje pero sin tasa. A mano: ¥1 200 × 0,0092 × 1,025 = 11,316 → 11,32 $ (1 000,00 − 11,32 = 988,68).
 */
const trip: PeriodBudget = {
  id: 'asia',
  name: 'Asia',
  template: 'trip',
  startDate: '2026-09-25',
  endDate: '2026-10-04',
  allocatedMinor: 50000,
  currency: 'CAD',
  txIds: [],
  archived: false,
  trip: { currencies: ['JPY', 'KRW'], localCurrency: 'JPY', rates: [{ currency: 'JPY', rate: '0.0092', date: '2026-09-25' }], feeBps: 250 },
  createdAt: EARLIER,
  updatedAt: EARLIER,
}

test('asistente en un viaje: una línea en yenes se convierte con la tasa del viaje; en wones (sin tasa) sigue bloqueada', async ({ page }) => {
  await seedStoredData(page, baseData({ periodBudgets: [trip] }))
  await go(page, '/asistente')
  await page.getByLabel('Texto').fill('ramen JPY 1200\nbibimbap KRW 15000')
  await page.getByRole('button', { name: 'Analizar' }).click()
  const lines = page.getByTestId('assistant-preview').locator('.assistant__line')
  await expect(lines).toHaveCount(2)
  await expect(lines.first().getByTestId('assistant-trip-rate')).toHaveText('¥1,200 JPY con la tasa del viaje «Asia» (0.0092 del 25 sep) y 2.5 % de comisión: $11.32.')
  await expect(lines.nth(1).getByTestId('assistant-trip-rate')).toHaveCount(0)
  await expect(page.getByTestId('assistant-currency-blocked')).toContainText('1 línea está en otra moneda')
  await expectNoHorizontalScroll(page, 'asistente en un viaje')

  await lines.nth(1).getByRole('button', { name: 'Quitar esta línea' }).click()
  await expect(page.getByTestId('assistant-currency-blocked')).toHaveCount(0)
  await page.getByRole('button', { name: 'Registrar 1 movimiento' }).click()
  await expect(page.getByText('1 movimiento registrado').first()).toBeVisible()
  await expect(await available(page)).toHaveText('$988.68')
  const saved = (JSON.parse((await storedData(page))!) as { transactions: Transaction[] }).transactions
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({ amountMinor: 1132, note: 'ramen', original: { currency: 'JPY', amountMinor: 1200, rate: '0.0092', rateDate: '2026-09-25', rateSource: 'manual', feeBps: 250 } })
})
