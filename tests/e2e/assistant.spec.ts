import { expect, test } from '@playwright/test'
import { available, go, movementCount, openAddSheet, openApp, startDemo, storedData } from './helpers'

test('asistente: texto → vista previa editable → registro todo o nada; nada se guarda antes de confirmar', async ({ page }) => {
  await startDemo(page)
  const before = await movementCount(page)
  await go(page, '/')
  // Pestaña «+» → hoja → asistente.
  await openAddSheet(page)
  const sheet = page.getByRole('dialog', { name: '¿Qué quieres registrar?' })
  await sheet.getByRole('link', { name: /Escribir o dictar/ }).click()
  await expect(page.getByRole('heading', { name: 'Asistente de registro' })).toBeVisible()

  const stored = await storedData(page)
  await page.getByLabel('Texto').fill('café 45 en Starbucks, uber 80 ayer y cobré 500 de freelance')
  await page.getByRole('button', { name: 'Analizar' }).click()
  const preview = page.getByTestId('assistant-preview')
  await expect(preview.locator('.assistant__line')).toHaveCount(3)
  // Primera línea: gasto, 45, restaurantes, hoy. Tercera: ingreso.
  const first = preview.locator('.assistant__line').nth(0)
  await expect(first.getByLabel('Importe')).toHaveValue('45.00')
  await expect(first.getByLabel('Categoría')).toHaveAttribute('data-value', 'dining')
  await expect(first.getByRole('radio', { name: 'Gasto' })).toBeChecked()
  const second = preview.locator('.assistant__line').nth(1)
  await expect(second.getByLabel('Fecha')).toHaveValue('2026-09-27')
  const third = preview.locator('.assistant__line').nth(2)
  await expect(third.getByRole('radio', { name: 'Ingreso' })).toBeChecked()
  await expect(third.getByLabel('Importe')).toHaveValue('500.00')
  // Nada registrado todavía: lo guardado tiene los mismos movimientos (solo cambió el contador de usos).
  const txCount = (json: string | null) => (JSON.parse(json ?? '{}') as { transactions?: unknown[] }).transactions?.length
  expect(txCount(await storedData(page))).toBe(txCount(stored))
  // Editar una línea y quitar otra.
  await second.getByLabel('Importe').fill('85')
  await third.getByRole('button', { name: 'Quitar esta línea' }).click()
  await expect(preview.locator('.assistant__line')).toHaveCount(2)
  await page.getByRole('button', { name: 'Registrar 2 movimientos' }).click()
  await expect(page.getByText('2 movimientos registrados')).toBeVisible()
  expect(await movementCount(page)).toBe(before + 2)
  await go(page, '/movimientos')
  await expect(page.locator('.item', { hasText: 'café' }).first()).toContainText('$45.00')
  await expect(page.locator('.item', { hasText: 'uber' }).first()).toContainText('$85.00')
})

test('asistente: sin importe no inventa nada; un importe inválido bloquea todo el registro', async ({ page }) => {
  await startDemo(page)
  const before = await movementCount(page)
  await go(page, '/asistente')
  await page.getByLabel('Texto').fill('café con Ana')
  await page.getByRole('button', { name: 'Analizar' }).click()
  const line = page.getByTestId('assistant-preview').locator('.assistant__line').first()
  await expect(line.getByLabel('Importe')).toHaveValue('')
  await expect(line.getByText('Sin importe: escríbelo.')).toBeVisible()
  await page.getByRole('button', { name: 'Registrar 1 movimiento' }).click()
  await expect(line.getByText('Escribe un importe.')).toBeVisible()
  expect(await movementCount(page)).toBe(before)
})

/**
 * Transparencia del asistente (auditoría 2026-10-12, §6): el texto se analiza en el dispositivo, cada
 * línea se ve y se edita antes de registrar, nada se guarda sin importe y lo registrado persiste.
 * Presupuesto nuevo de 2 000 con apartado de 300 → 1 700; «café 4.50» y «cobré 500 de freelance»
 * dejan 2 000 − 300 − 4,50 + 500 = 2 195,50, también tras recargar.
 */
test('asistente: «café 4.50» y «cobré 500 de freelance» se registran; «café» solo no se puede guardar; 2 195,50 persiste', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Configurar con mis datos' }).click()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByLabel('Saldo disponible').fill('2000')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByRole('radio', { name: 'No tengo fecha' }).check()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByLabel('Cantidad reservada').fill('300')
  await page.getByRole('button', { name: 'Ver resumen' }).click()
  await page.getByRole('button', { name: 'Empezar a usar Clara' }).click()
  await expect(page.getByTestId('available')).toHaveText('$1,700.00')

  const analyze = async (text: string) => {
    await go(page, '/asistente')
    await page.getByLabel('Texto').fill(text)
    await page.getByRole('button', { name: 'Analizar' }).click()
    return page.getByTestId('assistant-preview').locator('.assistant__line').first()
  }
  const coffee = await analyze('café 4.50')
  await expect(coffee.getByLabel('Importe')).toHaveValue('4.50')
  await expect(coffee.getByRole('radio', { name: 'Gasto' })).toBeChecked()
  await page.getByRole('button', { name: 'Registrar 1 movimiento' }).click()
  await expect(page.getByText('1 movimiento registrado')).toBeVisible()
  await expect(await available(page)).toHaveText('$1,695.50')

  const paid = await analyze('cobré 500 de freelance')
  await expect(paid.getByLabel('Importe')).toHaveValue('500.00')
  await expect(paid.getByRole('radio', { name: 'Ingreso' })).toBeChecked()
  await page.getByRole('button', { name: 'Registrar 1 movimiento' }).click()
  await expect(await available(page)).toHaveText('$2,195.50')

  // Sin importe no se inventa nada ni se guarda.
  const bare = await analyze('café')
  await expect(bare.getByLabel('Importe')).toHaveValue('')
  await expect(bare.getByText('Sin importe: escríbelo.')).toBeVisible()
  await page.getByRole('button', { name: 'Registrar 1 movimiento' }).click()
  await expect(bare.getByText('Escribe un importe.')).toBeVisible()
  expect(await movementCount(page)).toBe(2)

  // Tras recargar (la pestaña queda en Movimientos), Inicio sigue mostrando lo guardado.
  await page.reload()
  await expect(await available(page)).toHaveText('$2,195.50')
  expect(await movementCount(page)).toBe(2)
})
