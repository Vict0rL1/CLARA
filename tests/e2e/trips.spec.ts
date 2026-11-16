import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { PeriodBudget, Transaction } from '../../src/domain/types'
import { baseData } from '../../src/test/fixtures'
import { expectNoHorizontalScroll, go, seedStoredData, storedData } from './helpers'

/**
 * Fase 3: modo viaje de punta a punta. Hoy 28-sep. Viaje «Asia» del 25-sep al 4-oct, 500,00 $, yen a 0,0092 (25-sep),
 * won sin tasa, comisión 2,5 %. A mano: ¥1 200 × 0,0092 × 1,025 = 11,316 → 11,32 $; 4 días transcurridos →
 * ⌊11,32 / 4⌋ = 2,83 $ por día.
 */
const stored = async (page: Parameters<typeof storedData>[0]) => JSON.parse((await storedData(page))!) as { transactions: Transaction[]; periodBudgets: PeriodBudget[] }
const toast = (page: Parameters<typeof storedData>[0], message: string) => page.locator('.toast:not(.toast--held)', { hasText: message })

test('viaje: se crea con sus monedas y tasas, un gasto en yenes entra convertido y la vista lo cuenta por moneda', async ({ page }) => {
  await seedStoredData(page, baseData())
  await go(page, '/plan/periodos/nuevo')
  await page.getByRole('radio', { name: 'Viaje' }).check()
  await page.getByLabel('Nombre').fill('Asia')
  await page.getByLabel('Desde').fill('2026-09-25')
  await page.getByLabel('Hasta (incluido)').fill('2026-10-04')
  await page.getByLabel('Asignado').fill('500')
  const fields = page.getByTestId('trip-fields')
  await fields.getByRole('switch', { name: 'Modo viaje' }).click()
  await page.getByLabel('Añadir una moneda').selectOption('JPY')
  await page.getByLabel('Añadir una moneda').selectOption('KRW')
  // La primera que se añade queda como moneda local.
  await expect(page.getByLabel('Moneda local actual')).toHaveValue('JPY')
  await page.getByLabel('Tasa de JPY: CAD por 1 JPY').fill('0.0092')
  await page.getByLabel('Fecha de la tasa de JPY').fill('2026-09-25')
  await page.getByLabel('Comisión de la tarjeta en el extranjero (%)').fill('2.5')
  // Una coma en es-MX no es un decimal: no se adivina y no se guarda.
  await page.getByLabel('Tasa de KRW: CAD por 1 KRW').fill('0,00098')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(fields.locator('.field__error')).toContainText('Escribe la tasa como un número exacto')
  expect((await stored(page)).periodBudgets).toEqual([])
  await page.getByLabel('Tasa de KRW: CAD por 1 KRW').fill('')
  await expectNoHorizontalScroll(page, 'formulario de viaje')
  expect((await new AxeBuilder({ page }).include('[data-testid="trip-fields"]').analyze()).violations).toEqual([])
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(toast(page, 'Presupuesto guardado')).toBeVisible()

  const card = page.getByTestId('trip-card')
  await expect(card).toContainText('Aún no hay gastos asociados a este viaje.')
  await expect(page.getByTestId('trip-rates')).toContainText('JPY: 0.0092 CAD del 25 sep')
  await expect(page.getByTestId('trip-rates')).toContainText('KRW: sin tasa')
  await expect(page.getByTestId('trip-rates')).toContainText('Comisión de la tarjeta: 2.5 %')
  let data = await stored(page)
  expect(data.periodBudgets[0]).toMatchObject({
    name: 'Asia',
    template: 'trip',
    trip: { currencies: ['JPY', 'KRW'], localCurrency: 'JPY', rates: [{ currency: 'JPY', rate: '0.0092', date: '2026-09-25' }], feeBps: 250 },
  })
  const tripId = data.periodBudgets[0]!.id

  // Un gasto en yenes desde el formulario: la tasa y la comisión del viaje se proponen y se asocia al viaje.
  await go(page, '/movimientos/nuevo')
  await page.getByTestId('foreign-amount').getByRole('switch', { name: 'Pagado en otra moneda' }).click()
  await page.getByLabel('Importe en JPY').fill('1200')
  await expect(page.getByTestId('foreign-result')).toContainText('= $11.32')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(toast(page, 'Movimiento guardado')).toBeVisible()

  await go(page, `/plan/periodos/${tripId}`)
  await expect(page.getByTestId('trip-currencies')).toContainText('¥1,200 JPY')
  await expect(page.getByTestId('trip-currencies')).toContainText('$11.32')
  await expect(page.getByTestId('trip-total')).toHaveText('Total en CAD: $11.32')
  await expect(page.getByTestId('trip-per-day')).toContainText('Gastado por día: $2.83')
  await expect(page.getByTestId('trip-per-day')).toContainText('$11.32 en 4 días, hacia abajo.')
  await expectNoHorizontalScroll(page, 'vista del viaje')
  expect((await new AxeBuilder({ page }).include('[data-testid="trip-card"]').analyze()).violations).toEqual([])

  // «Ahora estás en»: cambia la moneda local sin tocar nada registrado.
  await card.getByLabel('Ahora estás en').selectOption('KRW')
  await expect(toast(page, 'Moneda local: KRW')).toBeVisible()
  data = await stored(page)
  expect(data.periodBudgets[0]!.trip!.localCurrency).toBe('KRW')
  expect(data.transactions[0]).toMatchObject({ amountMinor: 1132, original: { currency: 'JPY', rate: '0.0092' } })
})
