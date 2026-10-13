import { expect, test, type Page } from '@playwright/test'
import { available, go, startDemo } from './helpers'

async function editCoffee(page: Page, amount: string) {
  await go(page, '/movimientos')
  await page.getByRole('searchbox', { name: 'Buscar' }).fill('café')
  await page.locator('a.item').filter({ hasText: 'Café' }).filter({ hasNotText: 'pan' }).first().click()
  await page.getByLabel('Importe').fill(amount)
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Editar movimiento' })).toHaveCount(0)
}

test('historial: muestra antes y después, revierte y explica conflictos', async ({ page }) => {
  await startDemo(page)
  await expect(await available(page)).toHaveText('$136.78')
  await editCoffee(page, '10')
  await expect(await available(page)).toHaveText('$131.03')

  await go(page, '/ajustes/datos')
  await page.getByRole('link', { name: 'Historial de cambios' }).click()
  await expect(page.getByRole('heading', { name: 'Historial de cambios' })).toBeVisible()
  await expect(page.getByText('no es una prueba inalterable')).toBeVisible()
  const latest = page.locator('.history-entry').first()
  await expect(latest).toContainText('Editado: Café')
  await expect(latest).toContainText('Importe: $4.25 → $10.00')

  // Revertir pide confirmación y devuelve el importe anterior.
  await latest.getByRole('button', { name: 'Revertir' }).click()
  const dialog = page.getByRole('dialog', { name: '¿Revertir este cambio?' })
  await dialog.getByRole('button', { name: 'Revertir' }).click()
  await expect(page.getByText('Cambio revertido')).toBeVisible()
  await expect(page.locator('.history-entry').first()).toContainText('Reversión')
  await expect(page.locator('.history-entry').nth(1)).toContainText('Revertido')
  await expect(await available(page)).toHaveText('$136.78')

  // Dos ediciones seguidas: la primera ya no se puede revertir sin pisar la segunda.
  await editCoffee(page, '6')
  await editCoffee(page, '7')
  await go(page, '/ajustes/historial')
  const older = page.locator('.history-entry').nth(1)
  await expect(older).toContainText('Importe: $4.25 → $6.00')
  await expect(older.getByRole('button', { name: 'Revertir' })).toHaveCount(0)
  await expect(older).toContainText('1 registro cambió después')

  // Tras recargar, el historial sigue ahí.
  await page.reload()
  await expect(page.locator('.history-entry').first()).toContainText('Importe: $6.00 → $7.00')
})
