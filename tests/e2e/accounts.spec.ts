import { expect, test } from '@playwright/test'
import { available, go, reloadWhenSaved, startDemo } from './helpers'

/**
 * Etapa 1 del programa: Ajustes › Cuentas con patrimonio neto explicado, orden que vale en todas
 * las listas, y archivar sin perder historial ni saldo (FORMULAS §0 y §4; decisión 147).
 */
const money = (text: string) => Number(text.replace('−', '-').replace(/[^0-9.-]/g, ''))

test('cuentas: patrimonio neto cuadrado y explicado; el orden se recuerda y llega a los selectores', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes/cuentas')
  const net = page.getByTestId('net-position')
  // Lo que cuenta para el presupuesto es la misma cifra «En cuentas» de Inicio.
  await expect(net.getByTestId('net-budget')).toHaveText('$901.57')
  const assets = money((await net.getByTestId('net-assets').textContent())!)
  const liabilities = money((await net.getByTestId('net-liabilities').textContent())!)
  const worth = money((await net.getByTestId('net-worth').textContent())!)
  expect(liabilities).toBeLessThanOrEqual(0)
  expect(Math.round((assets + liabilities) * 100)).toBe(Math.round(worth * 100))
  await net.locator('summary').click()
  await expect(net).toContainText('Suma de los saldos de las cuentas no archivadas')

  // Orden: «Bajar» intercambia, se guarda y manda en el selector del formulario.
  const rows = page.getByTestId('accounts-active').locator('.account-row')
  await expect(rows).toHaveCount(3)
  const first = (await rows.first().getAttribute('data-account-name'))!
  const second = (await rows.nth(1).getAttribute('data-account-name'))!
  await page.getByRole('button', { name: `Bajar: ${first}` }).click()
  await expect(rows.first()).toHaveAttribute('data-account-name', second)
  await expect(rows.nth(1)).toHaveAttribute('data-account-name', first)
  // El orden se ve al instante; se recarga cuando la app confirma que está guardado (punto 14).
  await reloadWhenSaved(page)
  await expect(page.getByTestId('accounts-active').locator('.account-row').first()).toHaveAttribute('data-account-name', second)
  await go(page, '/movimientos/nuevo')
  await expect(page.getByLabel('Cuenta', { exact: true }).locator('option').first()).toHaveText(second)
})

test('cuentas: archivar conserva historial y saldo, saca la cuenta de los selectores y del disponible; restaurar la devuelve', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes/cuentas')
  await page.getByRole('button', { name: 'Agregar cuenta' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nueva cuenta' })
  await dialog.getByLabel('Nombre').fill('Cuenta vieja')
  await dialog.getByLabel('Saldo actual').fill('40')
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Cuenta guardada')).toBeVisible()
  await expect(page.getByTestId('net-budget')).toHaveText('$941.57')
  await expect(await available(page)).toHaveText('$176.78')

  // Un gasto en esa cuenta: historial que debe conservarse.
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe').fill('15')
  await page.getByLabel('Cuenta', { exact: true }).selectOption({ label: 'Cuenta vieja' })
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(await available(page)).toHaveText('$161.78')

  // Archivar: avisa del saldo, pide confirmación y la cuenta deja de contar.
  await go(page, '/ajustes/cuentas')
  const row = page.locator('.account-row[data-account-name="Cuenta vieja"]')
  const id = (await row.getAttribute('data-testid'))!.replace('account-', '')
  await page.getByRole('button', { name: 'Archivar: Cuenta vieja' }).click()
  const confirm = page.getByRole('dialog', { name: '¿Archivar «Cuenta vieja»?' })
  await expect(confirm.getByText('Tiene saldo $25.00')).toBeVisible()
  await confirm.getByRole('button', { name: 'Archivar', exact: true }).click()
  await expect(page.getByText('Cuenta archivada')).toBeVisible()
  await expect(page.getByTestId('accounts-active').locator('.account-row[data-account-name="Cuenta vieja"]')).toHaveCount(0)
  const archived = page.getByTestId('archived-accounts')
  await expect(archived.locator('summary')).toContainText('Cuentas archivadas · 1')
  await archived.locator('summary').click()
  await expect(archived.locator('.account-row[data-account-name="Cuenta vieja"]')).toContainText('$25.00')
  await expect(page.getByTestId('net-archived')).toHaveText('$25.00')
  await expect(page.getByTestId('net-budget')).toHaveText('$901.57')
  await expect(await available(page)).toHaveText('$136.78')

  // No se ofrece para registrar; su historial sigue en Movimientos y el filtro la marca.
  await go(page, '/movimientos/nuevo')
  await expect(page.getByLabel('Cuenta', { exact: true }).locator('option', { hasText: 'Cuenta vieja' })).toHaveCount(0)
  await go(page, `/movimientos?cuenta=${id}`)
  await expect(page.getByTestId('active-filters')).toContainText('Cuenta vieja (archivada)')
  await expect(page.locator('.summary-line')).toContainText('1 movimiento')

  // Restaurar: vuelve a la lista y al disponible, con todo lo que tenía.
  await go(page, '/ajustes/cuentas')
  await page.getByTestId('archived-accounts').locator('summary').click()
  await page.getByRole('button', { name: 'Restaurar: Cuenta vieja' }).click()
  await expect(page.getByText('Cuenta restaurada')).toBeVisible()
  await expect(page.getByTestId('accounts-active').locator('.account-row[data-account-name="Cuenta vieja"]')).toContainText('$25.00')
  await expect(await available(page)).toHaveText('$161.78')
})

test('cuentas: no se archiva una cuenta con pagos programados activos; archivar «Efectivo» descuenta justo su saldo', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes/cuentas')
  await page.getByRole('button', { name: 'Archivar: Cuenta de cheques' }).click()
  const confirm = page.getByRole('dialog', { name: '¿Archivar «Cuenta de cheques»?' })
  await confirm.getByRole('button', { name: 'Archivar', exact: true }).click()
  await expect(confirm.getByRole('alert')).toContainText('pagos programados activos')
  await confirm.getByRole('button', { name: 'Cancelar' }).click()
  await expect(page.getByTestId('accounts-active').locator('.account-row[data-account-name="Cuenta de cheques"]')).toHaveCount(1)

  const cash = money((await page.locator('.account-row[data-account-name="Efectivo"] .item__amount').textContent())!)
  await page.getByRole('button', { name: 'Archivar: Efectivo' }).click()
  await page.getByRole('dialog', { name: '¿Archivar «Efectivo»?' }).getByRole('button', { name: 'Archivar', exact: true }).click()
  await expect(page.getByText('Cuenta archivada')).toBeVisible()
  await expect(await available(page)).toHaveText(`$${(136.78 - cash).toFixed(2)}`)
})
