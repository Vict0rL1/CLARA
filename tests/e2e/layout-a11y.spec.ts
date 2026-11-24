import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { openExplain, go, startDemo, settleAnimations } from './helpers'

const ROUTES = [
  '/',
  '/movimientos',
  '/movimientos/nuevo',
  '/alcanza',
  '/plan/calendario',
  '/plan/metas',
  '/plan/proyeccion',
  '/plan/planes',
  '/plan/planes/nuevo',
  '/estadisticas',
  '/cuenta',
  '/pro',
  '/legal/privacidad',
  '/ajustes',
  '/plan/programado/nuevo',
  '/plan/metas/nueva',
  '/movimientos/papelera',
  '/movimientos/favoritos',
  '/conciliar',
  '/plan/periodos',
  '/plan/periodos/nuevo',
  '/plan/metas/nueva?tipo=gasto',
  '/revision',
  '/cambios',
  '/ajustes/historial',
  '/movimientos/plantillas',
  '/movimientos/plantillas/nueva?tipo=distribution',
  '/alcanza/escenarios',
  '/alcanza/faltante',
  '/alcanza/escenarios/nuevo',
  '/buscar?q=cafe',
  '/pendientes',
]

async function horizontalOverflow(page: import('@playwright/test').Page) {
  // `clientWidth` (viewport de diseño): con `isMobile`, `innerWidth` crece con el desbordamiento y no lo detectaba (B2).
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

test('ninguna pantalla tiene desplazamiento horizontal', async ({ page }) => {
  await startDemo(page)
  for (const route of ROUTES) {
    await go(page, route)
    if (route === '/alcanza') await page.getByLabel('Precio').fill('45')
    expect(await horizontalOverflow(page), route).toBeLessThanOrEqual(0)
  }
})

test('con texto ampliado al 200 % no aparece desplazamiento horizontal', async ({ page }) => {
  await startDemo(page)
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
  for (const route of ['/', '/movimientos', '/alcanza', '/plan/calendario', '/plan/proyeccion', '/movimientos/favoritos', '/conciliar', '/revision', '/alcanza/escenarios/nuevo', '/buscar?q=cafe', '/plan/periodos']) {
    await go(page, route)
    expect(await horizontalOverflow(page), route).toBeLessThanOrEqual(0)
  }
})

test('navegación con teclado: saltar al contenido y llegar a «¿Me alcanza?»', async ({ page }) => {
  await startDemo(page)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main')).toBeFocused()
  const afford = page.getByRole('link', { name: '¿Me alcanza?' })
  await afford.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '¿Me alcanza?' })).toBeVisible()
  await expect(page.getByLabel('Precio')).toBeFocused()
})

test('sin problemas de accesibilidad detectables automáticamente', async ({ page }) => {
  // Una auditoría axe por pantalla (≈1 s cada una): el tiempo crece con la lista de rutas.
  test.setTimeout(ROUTES.length * 4_000)
  await startDemo(page)
  for (const route of ROUTES) {
    await go(page, route)
    if (route === '/alcanza') await page.getByLabel('Precio').fill('45')
    if (route === '/') await openExplain(page)
    await settleAnimations(page)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)
    expect(summary, route).toEqual([])
  }
})

test('modo oscuro también pasa la auditoría de contraste', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  await startDemo(page)
  for (const route of ['/', '/alcanza', '/plan/calendario', '/plan/proyeccion', '/pendientes']) {
    await go(page, route)
    if (route === '/alcanza') await page.getByLabel('Precio').fill('45')
    await settleAnimations(page)
    const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
    expect(results.violations.map((v) => v.nodes.map((n) => n.target.join(' ')).join(' | ')), route).toEqual([])
  }
  await context.close()
})
