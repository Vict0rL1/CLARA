import { expect, test } from '@playwright/test'
import { go, waitForPrecache, waitForServiceWorkerControl } from './helpers'

test('tras la primera visita, la app abre sin conexión y conserva los datos', { tag: '@smoke' }, async ({ page, context }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explorar con datos de demostración' }).click()
  await expect(page.getByTestId('available')).toBeVisible()
  // Esperar a que el service worker controle la página y a que la precarga haya terminado.
  await waitForServiceWorkerControl(page)
  await waitForPrecache(page)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Demo · datos ficticios')).toBeVisible()
  // Como una persona: tocar Ajustes dentro de la app (cambia el hash, no carga otra página).
  await go(page, '/ajustes/datos')
  // Si falla, el mensaje muestra lo que hay en pantalla (p. ej. «… no activo todavía …»).
  const shown = (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 400)
  await expect(page.getByText(/^Uso sin conexión:/), shown).toContainText('Uso sin conexión: activo.')
  await context.setOffline(false)
})

test('borrar la caché de la app y el service worker no borra los registros financieros', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explorar con datos de demostración' }).click()
  await expect(page.getByTestId('available')).toBeVisible()
  const before = await page.getByTestId('available').textContent()
  // `registration.active` ya existe mientras el worker todavía está «activating» y la caché
  // puede estar vacía: se espera a que controle la página y a que la caché de esta versión
  // tenga al menos un archivo.
  await waitForServiceWorkerControl(page)
  await waitForPrecache(page)
  // La caché solo contiene archivos de la app (nunca datos).
  const cached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const key of await caches.keys()) for (const req of await (await caches.open(key)).keys()) urls.push(new URL(req.url).pathname)
    return urls
  })
  expect(cached.length).toBeGreaterThan(0)
  // Fuentes incluidas (woff2) son archivos de la app, igual que js y css.
  expect(cached.every((p) => p === '/' || /\.(html|js|css|svg|png|webmanifest|json|ico|woff2)$/.test(p))).toBe(true)
  await page.evaluate(async () => {
    for (const key of await caches.keys()) await caches.delete(key)
    for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister()
  })
  await page.reload()
  await expect(page.getByTestId('available')).toHaveText(before!)
  await expect(page.getByText('Demo · datos ficticios')).toBeVisible()
})
