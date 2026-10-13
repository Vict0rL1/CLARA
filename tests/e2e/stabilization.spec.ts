import { expect, test } from '@playwright/test'
import { go, startDemo, storedData } from './helpers'

/**
 * Regresiones de navegador de la auditoría posterior (2026-10-12/13) sobre `e7c9d87`. Cada prueba
 * reproduce el recorrido que fallaba y fija el contrato; los ids son los del informe.
 */
type Stored = { transactions: { id: string; amountMinor: number; currency: string; note?: string }[] }
const txs = async (page: import('@playwright/test').Page) => (JSON.parse((await storedData(page)) ?? '{}') as Stored).transactions ?? []

test('AS-01 · «café USD 10» en un presupuesto CAD se bloquea con el motivo; al escribirlo en CAD se guarda y sobrevive a recargar', async ({ page }) => {
  await startDemo(page)
  const before = (await txs(page)).length
  await go(page, '/asistente')
  await page.getByLabel('Texto').fill('café USD 10')
  await page.getByRole('button', { name: 'Analizar' }).click()
  const line = page.getByTestId('assistant-preview').locator('.assistant__line').first()
  // El importe conserva la moneda escrita y el campo explica por qué no vale.
  await expect(line.getByLabel('Importe')).toHaveValue('10.00 USD')
  await expect(line.getByText('El importe está en USD; este presupuesto usa CAD. No se convierte.')).toBeVisible()
  await expect(line.getByTestId('review-currency')).toContainText('Escribiste USD; este presupuesto usa CAD')
  await expect(page.getByTestId('assistant-currency-blocked')).toBeVisible()
  const register = page.getByRole('button', { name: 'Registrar 1 movimiento' })
  await expect(register).toBeDisabled()
  expect((await txs(page)).length).toBe(before)

  // La persona lo escribe en CAD: se puede registrar y queda en CAD tras recargar.
  await line.getByLabel('Importe').fill('10')
  await expect(page.getByTestId('assistant-currency-blocked')).toHaveCount(0)
  await register.click()
  await expect(page.getByText('1 movimiento registrado').first()).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
  const saved = (await txs(page)).filter((t) => t.note === 'café')
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({ amountMinor: 1000, currency: 'CAD' })
})

test('AS-01 · la misma moneda sigue funcionando: «café 10 CAD» se registra sin aviso', async ({ page }) => {
  await startDemo(page)
  await go(page, '/asistente')
  await page.getByLabel('Texto').fill('café 10 CAD')
  await page.getByRole('button', { name: 'Analizar' }).click()
  const line = page.getByTestId('assistant-preview').locator('.assistant__line').first()
  await expect(line.getByLabel('Importe')).toHaveValue('10.00')
  await expect(page.getByTestId('assistant-currency-blocked')).toHaveCount(0)
  await page.getByRole('button', { name: 'Registrar 1 movimiento' }).click()
  await expect(page.getByText('1 movimiento registrado').first()).toBeVisible()
})
