import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { PeriodBudget, Transaction } from '../../src/domain/types'
import { baseData, EARLIER } from '../../src/test/fixtures'
import { available, expectNoHorizontalScroll, go, seedStoredData, storedData } from './helpers'

/**
 * Fase 3: «Pagado en otra moneda» en el formulario. Viaje «Asia» del 25-sep al 4-oct con el yen a 0,0092 (escrita el
 * 25-sep) y 2,5 % de comisión; sin tasa para el won. Hoy 28-sep. A mano:
 *   ¥1 200 × 0,0092 × 1,025 = 11,316 → 11,32 $ (1 000,00 − 11,32 = 988,68)
 *   El banco cobró 11,17 $: tasa del cargo real 1117/120000 ≈ 0,009308 (1 000,00 − 11,17 = 988,83)
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

const stored = async (page: Parameters<typeof storedData>[0]) => JSON.parse((await storedData(page))!) as { transactions: Transaction[]; periodBudgets: PeriodBudget[] }

test('otra moneda: con la tasa del viaje, ajustar al cargo real, sin tasa no se guarda y apagarlo la quita', async ({ page }) => {
  await seedStoredData(page, baseData({ periodBudgets: [trip] }))
  await go(page, '/movimientos/nuevo')
  const section = page.getByTestId('foreign-amount')
  await section.getByRole('switch', { name: 'Pagado en otra moneda' }).click()
  await expect(page.getByLabel('Moneda en que pagaste')).toHaveValue('JPY')
  await expect(page.getByLabel('Tasa: CAD por 1 JPY')).toHaveValue('0.0092')
  await expect(page.getByLabel('Comisión de la tarjeta (%)')).toHaveValue('2.50')
  await expect(section).toContainText('Es la tasa del viaje «Asia»')
  await page.getByLabel('Importe en JPY').fill('1200')
  await expect(page.getByTestId('foreign-result')).toHaveText('¥1,200 JPY × 0.0092 + 2.5 % de comisión = $11.32 Un solo redondeo, al céntimo más cercano.')
  await expectNoHorizontalScroll(page, 'otra moneda')
  expect((await new AxeBuilder({ page }).include('[data-testid="foreign-amount"]').analyze()).violations).toEqual([])
  // Se propone asociarlo al viaje (es una de sus monedas y está dentro de las fechas).
  await expect(page.locator('form')).toContainText('en 1 presupuesto por periodo')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(await available(page)).toHaveText('$988.68')
  let data = await stored(page)
  const yen = data.transactions[0]!
  expect(yen).toMatchObject({ amountMinor: 1132, original: { currency: 'JPY', amountMinor: 1200, rate: '0.0092', rateDate: '2026-09-25', rateSource: 'manual', feeBps: 250 } })
  expect(data.periodBudgets[0]!.txIds).toEqual([yen.id])

  // «Con lo que cobró el banco»: 11,17 $ manda y la tasa sale de las dos.
  await go(page, `/movimientos/editar/${yen.id}`)
  await expect(page.getByLabel('Importe en JPY')).toHaveValue('1200')
  await section.getByRole('radio', { name: 'Con lo que cobró el banco' }).check()
  await page.getByLabel('Lo que cobró el banco en CAD').fill('11.17')
  await expect(page.getByTestId('foreign-result')).toHaveText('Tasa del cargo real: ≈ 0.009308 CAD por 1 JPY.')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(await available(page)).toHaveText('$988.83')
  data = await stored(page)
  expect(data.transactions[0]).toMatchObject({ amountMinor: 1117, original: { currency: 'JPY', amountMinor: 1200, rate: '1117/120000', rateSource: 'card_actual' } })
  expect(data.transactions[0]!.original).not.toHaveProperty('feeBps')

  // Sin tasa para el won: no se inventa una; no se guarda nada.
  await go(page, '/movimientos/nuevo')
  await section.getByRole('switch', { name: 'Pagado en otra moneda' }).click()
  await page.getByLabel('Moneda en que pagaste').selectOption('KRW')
  await expect(page.getByLabel('Tasa: CAD por 1 KRW')).toHaveValue('')
  await page.getByLabel('Importe en KRW').fill('15000')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(section.locator('.field__error')).toContainText('Escribe la tasa como un número exacto')
  await expect(page.getByTestId('foreign-result')).toHaveCount(0)
  expect((await stored(page)).transactions).toHaveLength(1)
  // Con una tasa escrita a mano sí: ₩15 000 × 0,00098 × 1,025 = 15,0675 → 15,07 $.
  await page.getByLabel('Tasa: CAD por 1 KRW').fill('0.00098')
  await expect(page.getByTestId('foreign-result')).toContainText('= $15.07')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(await available(page)).toHaveText('$973.76')

  // Apagar la sección al editar: el importe queda en CAD y el original se quita.
  await go(page, `/movimientos/editar/${yen.id}`)
  await section.getByRole('switch', { name: 'Pagado en otra moneda' }).click()
  await expect(page.getByLabel('Importe', { exact: true })).toHaveValue('11.17')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.locator('#page-title')).not.toHaveText('Editar movimiento')
  data = await stored(page)
  expect(data.transactions.find((t) => t.id === yen.id)).not.toHaveProperty('original')
  expect(data.transactions.find((t) => t.id !== yen.id)).toMatchObject({ amountMinor: 1507, original: { currency: 'KRW', rate: '0.00098', rateDate: '2026-09-28', feeBps: 250 } })
})

test('duplicar un gasto en otra moneda copia también el original', async ({ page }) => {
  const yen = { id: 'yen', kind: 'expense' as const, status: 'realized' as const, amountMinor: 1132, currency: 'CAD' as const, date: '2026-09-26', accountId: 'main', categoryId: 'dining', note: 'Ramen', original: { currency: 'JPY' as const, amountMinor: 1200, rate: '0.0092', rateDate: '2026-09-25', rateSource: 'manual' as const, feeBps: 250 }, source: 'manual' as const, realizedAt: EARLIER, createdAt: EARLIER, updatedAt: EARLIER }
  await seedStoredData(page, baseData({ periodBudgets: [trip], transactions: [yen] }))
  await go(page, '/movimientos/nuevo?duplicar=yen')
  await expect(page.getByLabel('Importe en JPY')).toHaveValue('1200')
  await expect(page.getByTestId('foreign-result')).toContainText('= $11.32')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  // El original es anterior al saldo de referencia (ya incluido); la copia, de hoy, resta: 1 000,00 − 11,32.
  await expect(await available(page)).toHaveText('$988.68')
  const data = await stored(page)
  expect(data.transactions.filter((t) => t.original?.currency === 'JPY').map((t) => t.amountMinor)).toEqual([1132, 1132])
})
