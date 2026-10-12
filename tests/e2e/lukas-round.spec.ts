import { expect, test } from '@playwright/test'
import { go, startDemo } from './helpers'

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
