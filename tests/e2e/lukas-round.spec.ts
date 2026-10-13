import { expect, test } from '@playwright/test'
import { available, go, startDemo } from './helpers'

/**
 * Ronda «Lukas como referencia» (2026-10-12): Inicio responde de un vistazo a «¿cuánto tengo?»,
 * «¿cuánto puedo gastar y hasta cuándo?», «¿qué pagos vienen?» y «¿cómo van mis metas?».
 * Las cifras salen de `computeBudget` con la demostración (hoy = 28-sep-2026).
 */

test('Inicio: la cifra principal muestra saldo en cuentas y reservado, y cuadra con el disponible', async ({ page }) => {
  await startDemo(page)
  const ledger = page.getByTestId('hero-ledger')
  // 901,57 en cuentas − 764,79 reservado (704,79 pagos + 60,00 metas) = 136,78 disponible.
  await expect(ledger).toContainText('En cuentas $901.57')
  await expect(ledger).toContainText('Reservado −$764.79')
  await expect(page.getByTestId('available')).toHaveText('$136.78')
  await expect(page.locator('.hero__sub')).toContainText('6 días')
  // «¿Cómo?» sigue explicando lo mismo con las mismas cifras.
  await page.locator('.hero .explain > summary').first().click()
  await expect(page.locator('.hero')).toContainText('Pagos reservados (3)')
  // Modo privado: la línea también oculta los importes.
  await page.getByTestId('privacy-toggle').click()
  await expect(ledger).not.toContainText('$901.57')
})

test('Inicio esencial: franja con los dos próximos pagos y enlace al calendario; la vista completa tiene la tarjeta', async ({ page }) => {
  await startDemo(page)
  const strip = page.getByTestId('upcoming-strip')
  await expect(strip).toBeVisible()
  await expect(strip.locator('.upcoming-strip__item')).toHaveCount(2)
  await expect(strip.locator('.upcoming-strip__item').first()).toContainText('Recibo de luz')
  await expect(strip.locator('.upcoming-strip__item').first()).toContainText('Vencido')
  await expect(strip.locator('.upcoming-strip__item').first()).toContainText('−$42.80')
  await expect(strip.getByRole('link', { name: /2 más en el calendario/ })).toBeVisible()
  await page.getByTestId('show-full-home').click()
  await expect(page.getByTestId('home-sections')).toBeVisible()
  await expect(page.getByTestId('upcoming-strip')).toHaveCount(0)
  await expect(page.locator('#upcoming-title')).toBeVisible()
})

test('Metas: arco de progreso accesible en Inicio y en Plan › Metas, con el mismo texto de valor', async ({ page }) => {
  await startDemo(page)
  await page.getByTestId('show-full-home').click()
  await page.getByTestId('home-more').locator('> summary').click()
  const homeArc = page.locator('.goal-mini .arc').first()
  await expect(homeArc).toHaveAttribute('role', 'progressbar')
  const valueText = await homeArc.getAttribute('aria-valuetext')
  expect(valueText).toMatch(/\$[\d,.]+ de \$[\d,.]+/)
  const now = Number(await homeArc.getAttribute('aria-valuenow'))
  expect(now).toBeGreaterThanOrEqual(0)
  expect(now).toBeLessThanOrEqual(100)
  await go(page, '/plan/metas')
  const arcs = page.locator('.goal__summary .arc')
  await expect(arcs.first()).toBeVisible()
  await expect(arcs.first()).toHaveAttribute('aria-valuetext', valueText!)
})

test('Registro: aviso de posible duplicado antes de guardar; guardar sigue siendo posible', async ({ page }) => {
  await startDemo(page)
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe', { exact: true }).fill('123.45')
  await expect(page.getByTestId('duplicate-warning')).toHaveCount(0)
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  // El segundo igual (tipo, cuenta, importe, hoy) avisa con el existente a la vista; no bloquea.
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe', { exact: true }).fill('123.45')
  const warn = page.getByTestId('duplicate-warning')
  await expect(warn).toContainText('Posible duplicado: ya hay un movimiento igual')
  await expect(warn).toContainText('$123.45')
  await expect(warn.getByRole('link', { name: 'Ver el existente' })).toBeVisible()
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  await go(page, '/movimientos')
  await expect(page.locator('.item', { hasText: '$123.45' })).toHaveCount(2)
})

test('Registro: un importe igual a un pago programado abierto ofrece vincularlo; al guardar, el calendario lo da por pagado y el disponible no cambia', async ({ page }) => {
  await startDemo(page)
  await expect(page.getByTestId('available')).toHaveText('$136.78')
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe', { exact: true }).fill('650')
  const suggestion = page.getByTestId('link-suggestion')
  await expect(suggestion).toContainText('¿Es el pago programado «Renta de habitación»')
  await expect(suggestion).toContainText('$650.00')
  await suggestion.getByRole('button', { name: 'Sí, vincularlo' }).click()
  await expect(page.getByTestId('link-suggestion')).toHaveCount(0)
  await expect(page.getByLabel('Vincular con un pago previsto')).toHaveValue(/^schedule:/)
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  // Pagar un pago ya reservado: baja el saldo y baja lo reservado; el disponible queda igual.
  await expect(await available(page)).toHaveText('$136.78')
  await page.getByTestId('show-full-home').click()
  await expect(page.locator('section[aria-labelledby="upcoming-title"]')).not.toContainText('Renta de habitación')
})

test('Registro: «No, es otro» descarta la sugerencia y el movimiento se guarda sin vínculo', async ({ page }) => {
  await startDemo(page)
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe', { exact: true }).fill('650')
  await page.getByTestId('link-suggestion').getByRole('button', { name: 'No, es otro' }).click()
  await expect(page.getByTestId('link-suggestion')).toHaveCount(0)
  await expect(page.getByLabel('Vincular con un pago previsto')).toHaveValue('')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  // Sin vínculo, la renta sigue pendiente y el disponible baja 650.
  await expect(await available(page)).toHaveText('-$513.22')
})

test('Detalle: al abrir un movimiento se ve importe con moneda, fecha, categoría, cuenta, origen y, si viene del calendario, el alcance de la edición', async ({ page }) => {
  await startDemo(page)
  await go(page, '/movimientos')
  await page.locator('.item--link', { hasText: 'Renta de habitación' }).first().click()
  const summary = page.getByTestId('movement-summary')
  await expect(summary).toContainText('−$650.00')
  await expect(summary).toContainText('CAD')
  await expect(summary).toContainText('Programado')
  await expect(summary).toContainText('Renta de habitación · Cada mes')
  await expect(summary).toContainText('no cambia el programado «Renta de habitación» ni sus próximas ocurrencias')
  await expect(summary.getByRole('link', { name: 'Editar el programado' })).toHaveAttribute('href', /plan\/programado\/editar\//)
  // Un movimiento manual: origen «Manual» y sin nota de alcance.
  await go(page, '/movimientos')
  await page.locator('.item--link', { hasText: 'Ahorro' }).first().click()
  await expect(page.getByTestId('movement-summary')).toContainText('Manual')
  await expect(page.getByTestId('movement-summary')).not.toContainText('próximas ocurrencias')
})

test('Historial: al volver de un detalle se conservan los filtros y la posición de la lista', async ({ page }) => {
  await startDemo(page)
  await go(page, '/movimientos')
  await page.getByTestId('open-filters').click()
  await page.getByTestId('filters-sheet').getByRole('button', { name: 'Gasto', exact: true }).click()
  await page.getByRole('button', { name: 'Ver resultados' }).click()
  await expect(page.getByTestId('active-filters')).toContainText('Gasto')
  const rows = page.locator('.item--link')
  const count = await rows.count()
  expect(count).toBeGreaterThan(4)
  const last = rows.nth(count - 1)
  await last.scrollIntoViewIfNeeded()
  const before = await page.evaluate(() => window.scrollY)
  expect(before).toBeGreaterThan(100)
  await last.click()
  await expect(page.getByTestId('movement-summary')).toBeVisible()
  await page.getByRole('link', { name: 'Volver' }).click()
  await expect(page.getByTestId('active-filters')).toContainText('Gasto')
  await expect.poll(async () => page.evaluate(() => window.scrollY), { timeout: 3000 }).toBeGreaterThan(before - 80)
  // Un enlace con sus propios filtros manda sobre lo recordado.
  await go(page, '/movimientos?categoria=housing')
  await expect(page.getByTestId('active-filters')).toContainText('Vivienda')
  await expect(page.getByTestId('active-filters')).not.toContainText('Gasto')
})
