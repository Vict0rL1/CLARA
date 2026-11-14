import { expect, test } from '@playwright/test'
import { applyFilters, openFilters, openMoreMenu, go, movementCount, startDemo } from './helpers'

test('historial: selección múltiple a la papelera (con restauración) y exportación CSV del filtro', async ({ page }) => {
  await startDemo(page)
  const before = await movementCount(page)
  await go(page, '/movimientos')
  await page.getByRole('button', { name: 'Seleccionar' }).click()
  const boxes = page.getByRole('checkbox', { name: /^Seleccionar «/ })
  await boxes.nth(0).check()
  await boxes.nth(1).check()
  await expect(page.getByText('2 seleccionados')).toBeVisible()
  await page.getByRole('button', { name: 'Enviar a la papelera' }).click()
  await page.getByRole('dialog', { name: '¿Enviar 2 a la papelera?' }).getByRole('button', { name: 'Enviar a la papelera' }).click()
  await expect(page.getByText('2 movimientos enviados a la papelera')).toBeVisible()
  expect(await movementCount(page)).toBe(before - 2)
  await go(page, '/movimientos/papelera')
  await expect(page.getByRole('button', { name: 'Restaurar' })).toHaveCount(2)
  await page.getByRole('button', { name: 'Restaurar' }).first().click()
  expect(await movementCount(page)).toBe(before - 1)

  // CSV del filtro: tantas filas como movimientos filtrados, importes con signo.
  await go(page, '/movimientos')
  await (await openFilters(page)).getByRole('group', { name: 'Tipo' }).getByRole('button', { name: 'Ingreso', exact: true }).click()
  await applyFilters(page)
  const count = Number(/(\d+) movimiento/.exec((await page.locator('.summary-line').textContent()) ?? '')?.[1])
  const download = page.waitForEvent('download')
  await (await openMoreMenu(page)).getByRole('button', { name: 'Exportar CSV' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^clara-movimientos-\d{4}-\d{2}-\d{2}\.csv$/)
  const text = await (await import('node:fs/promises')).readFile(await file.path(), 'utf8')
  const lines = text.replace(/^﻿/, '').trim().split('\r\n')
  // L1: columna «Origen» (manual, asistente, atajo…); Fase 3: luego el importe en la moneda en que se pagó.
  expect(lines[0]).toBe('Fecha,Tipo,Estado,Importe,Moneda,Categoría,Cuenta,Cuenta destino,Nota,Comercio,Id,Origen,Importe original,Moneda original,Tasa,Fecha de la tasa,Origen de la tasa,Comisión (%)')
  expect(lines.length - 1).toBe(count)
  expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2},Ingreso,Realizado,\d+\.\d{2},CAD,/)
})

test('historial: deslizar una fila la envía a la papelera con Deshacer', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'solo en pantallas táctiles')
  await startDemo(page)
  const before = await movementCount(page)
  await go(page, '/movimientos')
  const row = page.locator('.swipe').first()
  const box = (await row.boundingBox())!
  await page.touchscreen.tap(box.x + box.width - 20, box.y + box.height / 2)
  const content = row.locator('.swipe__content')
  await content.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: box.x + 200, clientY: box.y + 10, pointerId: 1, bubbles: true })
  await content.dispatchEvent('pointermove', { pointerType: 'touch', clientX: box.x + 60, clientY: box.y + 10, pointerId: 1, bubbles: true })
  await content.dispatchEvent('pointerup', { pointerType: 'touch', clientX: box.x + 60, clientY: box.y + 10, pointerId: 1, bubbles: true })
  await row.getByRole('button', { name: /^Eliminar «/ }).click()
  await expect(page.getByText('Movimiento enviado a la papelera')).toBeVisible()
  await page.getByRole('button', { name: 'Deshacer' }).click()
  await expect(page.getByText('Movimiento restaurado.')).toBeVisible()
  expect(await movementCount(page)).toBe(before)
})
