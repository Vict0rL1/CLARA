import { expect, test } from '@playwright/test'
import { available, go, openDetails, openFilters, applyFilters, pickCategory, startDemo } from './helpers'

/**
 * Etapa 2 del programa: revisión única de propuestas (asistente e importación), reglas explicadas,
 * ficha de un programado con terminar y pausar, y el historial con orden, netos por día e historial
 * de cambios por movimiento (decisión 148).
 */
const money = (text: string) => Number(text.replace('−', '-').replace(/[^0-9.-]/g, ''))

test('asistente: la revisión propone vincular con el pago programado que coincide y avisa del duplicado al repetir', async ({ page }) => {
  await startDemo(page)
  await go(page, '/asistente')
  await page.getByLabel('Texto').fill('renta 650')
  await page.getByRole('button', { name: 'Analizar' }).click()
  const preview = page.getByTestId('assistant-preview')
  await expect(preview.locator('.assistant__line')).toHaveCount(1)
  await expect(page.getByTestId('review-summary')).toContainText('Efecto en lo disponible: −$650.00')
  await expect(page.getByTestId('review-summary')).toContainText('1 coincide con un pago programado')
  const line = preview.locator('.assistant__line').first()
  await expect(line.getByTestId('review-schedule')).toContainText('¿Es el pago programado «Renta de habitación» del 1 oct?')
  await line.getByLabel('Vincular: el calendario lo dará por pagado y no se reservará dos veces').check()
  await page.getByRole('button', { name: 'Registrar 1 movimiento' }).click()
  await expect(page.getByText('1 movimiento registrado')).toBeVisible()
  // Vinculado: lo reservado se libera y el disponible no cambia (misma regla que el formulario).
  await expect(await available(page)).toHaveText('$136.78')

  // Repetir el mismo texto: ya no hay pago abierto que coincida y sí un posible duplicado.
  await go(page, '/asistente')
  await page.getByLabel('Texto').fill('renta 650')
  await page.getByRole('button', { name: 'Analizar' }).click()
  await expect(preview.locator('.assistant__line').first().getByTestId('review-duplicate')).toContainText('Posible duplicado')
  await expect(page.getByTestId('review-summary')).toContainText('1 posible duplicado')
  await expect(page.getByTestId('review-summary')).not.toContainText('coincide con un pago programado')
})

test('reglas: la nueva regla se prueba antes de guardar y las que se solapan se explican', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes/reglas')
  await page.getByRole('button', { name: 'Nueva regla' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nueva regla de categoría' })
  await dialog.getByLabel('Si la descripción contiene').fill('uber')
  await expect(dialog.getByTestId('rule-preview')).toContainText(/Coincide con \d+ movimientos? ya registrados?|No coincide con ningún movimiento/)
  await pickCategory(page, dialog.getByLabel('Categoría'), 'Transporte')
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Regla guardada').first()).toBeVisible()
  await page.getByRole('button', { name: 'Nueva regla' }).click()
  const second = page.getByRole('dialog', { name: 'Nueva regla de categoría' })
  await second.getByLabel('Si la descripción contiene').fill('uber eats')
  await pickCategory(page, second.getByLabel('Categoría'), 'Restaurantes y café')
  await second.getByRole('button', { name: 'Guardar', exact: true }).click()
  // En escritorio pueden verse dos avisos a la vez: basta con que el último esté visible.
  await expect(page.getByText('Regla guardada').last()).toBeVisible()
  await expect(page.getByTestId('rule-conflicts')).toContainText('«uber eats» gana a «uber» cuando la descripción contiene las dos')
  // En el formulario, la nota «uber eats» aplica la regla más específica y lo dice.
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe').fill('12')
  await openDetails(page)
  await page.getByLabel('Nota (opcional)').fill('pedido uber eats')
  await expect(page.getByTestId('category-field')).toHaveAttribute('data-value', 'dining')
  await expect(page.getByText('Otras 1 reglas coincidían; gana la más específica.')).toBeVisible()
})

test('calendario: la ficha de un programado muestra lo que viene y lo pagado; terminar deja de reservar sin tocar lo pagado', async ({ page }) => {
  await startDemo(page)
  await go(page, '/plan/calendario')
  // La vencida (Recibo de luz) sigue pendiente aunque se termine el programado: no se borra una deuda en silencio.
  await page.getByRole('button', { name: 'Detalles: Recibo de luz' }).click()
  const overdueSheet = page.getByTestId('schedule-sheet')
  await expect(overdueSheet).toContainText('1 vencidas sin marcar')
  await expect(overdueSheet).toContainText('Historial')
  await page.keyboard.press('Escape')
  // La renta vence el 1 de octubre: al terminarla deja de reservarse y el disponible sube justo 650.
  await page.getByRole('button', { name: 'Mes siguiente' }).click()
  await page.getByRole('button', { name: 'Detalles: Renta de habitación' }).click()
  const sheet = page.getByTestId('schedule-sheet')
  await expect(sheet.getByTestId('schedule-next')).toContainText('1 de oct')
  await sheet.getByRole('button', { name: 'Terminar' }).click()
  await page.getByRole('dialog', { name: '¿Terminar «Renta de habitación»?' }).getByRole('button', { name: 'Terminar', exact: true }).click()
  await expect(page.getByText('Programado terminado')).toBeVisible()
  await expect(await available(page)).toHaveText('$786.78')
})

test('historial: orden por importe, neto del día y el historial de cambios de un movimiento', async ({ page }) => {
  await startDemo(page)
  await go(page, '/movimientos')
  await expect(page.getByTestId('group-total').first()).toContainText('Neto del día')
  await openFilters(page)
  await page.getByTestId('filters-sheet').getByRole('button', { name: 'Importe mayor primero', exact: true }).click()
  await applyFilters(page)
  await expect(page.getByTestId('group-total')).toHaveCount(0)
  const amounts = page.locator('section[aria-labelledby="realized-title"] .item--link .item__amount')
  const first = money((await amounts.nth(0).textContent())!)
  const second = money((await amounts.nth(1).textContent())!)
  expect(Math.abs(first)).toBeGreaterThanOrEqual(Math.abs(second))
  await openFilters(page)
  await page.getByTestId('filters-sheet').getByRole('button', { name: 'Más recientes primero', exact: true }).click()
  await applyFilters(page)
  await expect(page.getByTestId('group-total').first()).toBeVisible()

  // Historial de cambios: tras editar el importe, el detalle lo cuenta (y dice su alcance).
  await page.getByRole('searchbox', { name: 'Buscar' }).fill('café')
  await page.locator('a.item', { hasText: 'Café' }).first().click()
  await page.getByLabel('Importe').fill('9.99')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Cambios guardados')).toBeVisible()
  await go(page, '/movimientos')
  await page.getByRole('searchbox', { name: 'Buscar' }).fill('café')
  await page.locator('a.item', { hasText: 'Café' }).first().click()
  const history = page.getByTestId('movement-history')
  await history.locator('summary').click()
  await expect(history).toContainText('Solo lo que este dispositivo guardó')
  await expect(history).toContainText('Cambió: Importe')
})
