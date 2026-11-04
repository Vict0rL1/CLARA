import { expect, test } from '@playwright/test'
import { SCHEMA_VERSION } from '../../src/domain/types'
import { expectNoHorizontalScroll, go, openDetails, startDemo } from './helpers'

/**
 * Etapa 4 del programa: navegación Inicio / Movimientos / + / Plan / Análisis / Ajustes, el destino
 * «Análisis» con señales explicables (reglas fijas, sin IA), «¿Cómo se calculó?» en cada gráfico de
 * estadísticas y el centro de datos y recuperación en Ajustes (decisión 150).
 */

test('navegación: seis huecos sin recortes, «Análisis» agrupa estadísticas, revisión y ¿qué cambió?', async ({ page }) => {
  await startDemo(page)
  const nav = page.getByRole('navigation', { name: 'Navegación principal' })
  for (const name of ['Inicio', 'Movimientos', 'Plan', 'Análisis', 'Ajustes']) await expect(nav.getByRole('link', { name })).toBeVisible()
  await expect(nav.getByRole('button', { name: 'Agregar' })).toBeVisible()
  // Etiquetas enteras: ninguna se recorta ni parte palabras.
  const clipped = await nav.locator('.nav__label').evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent))
  expect(clipped).toEqual([])
  await expectNoHorizontalScroll(page, 'Inicio con seis pestañas')

  await nav.getByRole('link', { name: 'Análisis' }).click()
  await expect(page.getByRole('heading', { name: 'Análisis', level: 1 })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Análisis' })).toHaveAttribute('aria-current', 'page')
  const tabs = page.getByTestId('insights-tabs')
  await expect(tabs.getByRole('link')).toHaveCount(4)
  await tabs.getByRole('link', { name: 'Estadísticas' }).click()
  await expect(page).toHaveURL(/#\/estadisticas$/)
  await expect(nav.getByRole('link', { name: 'Análisis' })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('link', { name: 'Inicio' })).not.toHaveAttribute('aria-current', 'page')
  // Cada gráfico explica su cálculo.
  await expect(page.getByRole('group').filter({ hasText: 'Gasto neto por categoría en el periodo' })).toHaveCount(1)
  expect(await page.locator('main .explain').count()).toBeGreaterThanOrEqual(6)
  await go(page, '/revision')
  await expect(nav.getByRole('link', { name: 'Análisis' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('insights-tabs').getByRole('link', { name: 'Revisión semanal' })).toHaveAttribute('aria-current', 'page')
})

test('análisis: señales con cifras y regla; un gasto previsto grande produce «saldo en negativo» con su desglose; nada se guarda solo', async ({ page }) => {
  await startDemo(page)
  await go(page, '/analisis')
  const list = page.getByTestId('insight-list')
  const titles = list.getByTestId('insight-title')
  await expect(titles.first()).toHaveText('1 pago vencido sin marcar por $42.80')
  await expect(titles.first()).toHaveAttribute('data-id', 'overdueBills')
  await expect(list.getByTestId('insight-title').filter({ hasText: 'Laptop para la escuela' })).toHaveText('«Laptop para la escuela» va $120.00 por detrás del ritmo para el 26 ene 2027')
  await expect(list).not.toContainText('Saldo proyectado en negativo')
  // «¿Cómo se calculó?» enseña la regla y las cifras.
  const first = list.locator('article').first()
  await first.locator('.explain > summary').click()
  await expect(first).toContainText('Regla: Pagos programados con fecha anterior a hoy')
  await expect(first.locator('.calc-row').filter({ hasText: 'Total vencido' })).toContainText('$42.80')
  await expect(first.getByRole('link', { name: 'Ver' })).toHaveAttribute('href', /#\/plan\/calendario$/)

  // Un gasto previsto de 950 el 5-oct deja el saldo proyectado en negativo (901.57 − 42.80 + 18 − 650 − 950 < 0).
  await go(page, '/movimientos/nuevo?kind=expense&date=2026-10-05&status=planned')
  await page.getByLabel('Importe').fill('950')
  await openDetails(page)
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  await go(page, '/analisis')
  await expect(titles.first()).toHaveAttribute('data-id', 'shortfall')
  await expect(titles.first()).toContainText('Saldo proyectado en negativo el 5 oct')
  await expect(list.locator('article').first().getByText('Urgente')).toBeVisible()
  const card = list.locator('article').first()
  await card.locator('.explain > summary').click()
  await expect(card.locator('.calc-row').filter({ hasText: 'Saldo real hoy' })).toContainText('$901.57')
  await expect(card.locator('.calc-row').filter({ hasText: 'Saldo proyectado ese día' })).toBeVisible()
})

test('centro de datos: estado con icono y texto, orden de recuperación y exportar desde ahí; el índice solo avisa si hay algo que revisar', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes')
  await expect(page.getByTestId('settings-row-datos')).toContainText('Datos y recuperación')
  // Con la demo no hay nada que revisar: el índice no añade subtítulo (y no crece a 320 px).
  await expect(page.getByTestId('settings-row-datos').locator('.list-row__subtitle')).toHaveCount(0)
  await page.getByTestId('settings-row-datos').click()
  await expect(page.locator('#page-title')).toHaveText('Datos y recuperación')
  await expect(page.locator('.alert[role="status"]')).toContainText('Hay cosas que conviene saber')
  const rows = page.getByTestId('data-rows')
  await expect(rows.getByTestId('data-row-saving')).toHaveAttribute('data-state', 'ok')
  await expect(rows.getByTestId('data-row-saving')).toContainText('IndexedDB')
  await expect(rows.getByTestId('data-row-export')).toContainText('Datos de demostración: no hace falta copia')
  await expect(rows.getByTestId('data-row-records')).toContainText(/\d+ movimientos · 3 cuentas · 7 programados · 2 metas/)
  await expect(rows.getByTestId('data-row-schema')).toContainText(`esquema ${SCHEMA_VERSION}`)
  await expect(rows.getByTestId('data-row-trash')).toContainText('Papelera vacía')
  await expect(rows.getByTestId('data-row-errors')).toContainText('Sin errores registrados')
  await expect(page.getByTestId('data-steps').locator('li')).toHaveCount(5)
  await expect(page.getByTestId('data-steps').locator('li').first()).toContainText('no disponible ahora')
  // Las filas llevan a su sección.
  await expect(rows.getByTestId('data-row-localCopies').getByRole('link')).toHaveAttribute('href', /#\/ajustes\/copias-locales$/)
  // Exportar desde el centro descarga la copia (misma acción que Copias de seguridad).
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar copia ahora' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.json$/)
  await expect(page.getByText('Descarga solicitada').first()).toBeVisible()
})
