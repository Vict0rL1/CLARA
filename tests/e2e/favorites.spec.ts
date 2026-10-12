import { expect, test } from '@playwright/test'
import { available, go, movementCount, openDetails, pickCategory, startDemo, storedData } from './helpers'

test('favoritos: desde Inicio abren el formulario con hoy, no registran nada solos y guardar dos veces no duplica', async ({ page }) => {
  await startDemo(page)
  const before = await movementCount(page)
  await go(page, '/')
  await page.getByRole('navigation', { name: 'Favoritos' }).getByRole('link', { name: /Café/ }).click()
  await expect(page.getByRole('heading', { name: 'Nuevo movimiento' })).toBeVisible()
  await expect(page.getByText('Usando el favorito «Café»')).toBeVisible()
  await expect(page.getByLabel('Importe')).toHaveValue('4.25')
  await openDetails(page)
  await expect(page.getByLabel('Fecha')).toHaveValue('2026-09-28')
  await expect(page.getByLabel('Categoría', { exact: true })).toHaveAttribute('data-value', 'dining')

  // Abrir un favorito no registra nada.
  await page.getByRole('link', { name: 'Cancelar' }).click()
  expect(await movementCount(page)).toBe(before)

  await go(page, '/')
  await page.getByRole('navigation', { name: 'Favoritos' }).getByRole('link', { name: /Café/ }).click()
  await page.getByRole('button', { name: 'Guardar', exact: true }).dblclick()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  expect(await movementCount(page)).toBe(before + 1)
  await expect(await available(page)).toHaveText('$132.53')
})

test('favoritos: crear desde el formulario, ordenar, cuenta eliminada pide elegir otra, eliminar con deshacer', async ({ page }) => {
  await startDemo(page)

  // Crear desde el formulario de un movimiento.
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe').fill('12')
  await openDetails(page)
  await page.getByLabel('Nota (opcional)').fill('Lavandería')
  await page.getByRole('button', { name: 'Añadir a favoritos' }).click()
  let dialog = page.getByRole('dialog', { name: 'Nuevo favorito' })
  await expect(dialog.getByLabel('Nombre')).toHaveValue('Lavandería')
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).dblclick()
  await expect(page.getByText('Favorito guardado').first()).toBeVisible()

  // Cuenta nueva sin movimientos para poder eliminarla después.
  await go(page, '/ajustes/cuentas')
  await page.getByRole('button', { name: 'Agregar cuenta' }).click()
  const accountDialog = page.getByRole('dialog', { name: 'Nueva cuenta' })
  await accountDialog.getByLabel('Nombre').fill('Tarjeta regalo')
  await accountDialog.getByLabel('Tipo de cuenta').selectOption('other')
  await accountDialog.getByRole('button', { name: 'Guardar', exact: true }).click()

  await go(page, '/movimientos/favoritos')
  await expect(page.locator('.item')).toHaveCount(3) // Café, Pasaje de autobús y Lavandería (sin duplicados)
  await page.getByRole('button', { name: 'Nuevo favorito' }).click()
  dialog = page.getByRole('dialog', { name: 'Nuevo favorito' })
  await dialog.getByLabel('Nombre').fill('Regalo')
  await dialog.getByLabel('Cuenta').selectOption({ label: 'Tarjeta regalo' })
  await pickCategory(page, dialog.getByLabel('Categoría', { exact: true }), 'Regalos')
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click()

  // Ordenar: «Regalo» sube al tercer lugar.
  await page.getByRole('button', { name: /Subir.*Regalo/ }).click()
  await expect(page.locator('.item__title')).toHaveText(['Café', 'Pasaje de autobús', 'Regalo', 'Lavandería'])

  // Se elimina la cuenta: el favorito se conserva, avisa y pide elegir otra.
  await go(page, '/ajustes/cuentas')
  await page.getByRole('button', { name: /Editar.*Tarjeta regalo/ }).click()
  await page.getByRole('dialog', { name: 'Editar cuenta' }).getByRole('button', { name: 'Eliminar' }).click()
  await expect(page.getByText('Cuenta eliminada')).toBeVisible()
  await go(page, '/movimientos/favoritos')
  await expect(page.locator('.item', { hasText: 'Regalo' })).toContainText('Cuenta o categoría no disponible')
  await page.getByRole('link', { name: /Usar.*Regalo/ }).click()
  await expect(page.getByText('La cuenta de este favorito ya no existe: elige una.')).toBeVisible()
  await expect(page.getByLabel('Cuenta', { exact: true })).toHaveValue('')
  await page.getByLabel('Importe').fill('15')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Elige una cuenta válida.')).toBeVisible()
  await page.getByLabel('Cuenta', { exact: true }).selectOption({ label: 'Efectivo' })
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()

  // Eliminar con deshacer; persiste tras recargar.
  await go(page, '/movimientos/favoritos')
  await page.getByRole('button', { name: /Eliminar.*Lavandería/ }).click()
  await expect(page.locator('.item')).toHaveCount(3)
  await page.getByRole('button', { name: 'Deshacer' }).click()
  await expect(page.locator('.item')).toHaveCount(4)
  // Deshacer guarda de forma asíncrona: recargar antes de que termine perdía el favorito restaurado
  // (CI a 320 px: 3 de 4 tras recargar). Se espera a que lo guardado tenga los cuatro.
  await expect.poll(async () => (JSON.parse((await storedData(page)) ?? '{}') as { favorites?: unknown[] }).favorites?.length).toBe(4)
  await page.reload()
  await go(page, '/movimientos/favoritos')
  await expect(page.locator('.item__title')).toHaveText(['Café', 'Pasaje de autobús', 'Regalo', 'Lavandería'])
})
