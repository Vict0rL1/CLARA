import { expect, test } from '@playwright/test'
import { go, startDemo } from './helpers'
import { SETTINGS_SECTIONS } from '../../src/ui/screens/settings/sections'

/** En el navegador; las secciones que solo existen en la app de iPhone (`nativeOnly`) se prueban en `native-captures.spec.ts`. */
const WEB_SECTIONS = SETTINGS_SECTIONS.filter((s) => !s.nativeOnly)

/**
 * B6/C3: cada sección de Ajustes es una subpantalla (`/ajustes/<id>`) con su título y vuelta al
 * índice; los enlaces antiguos `?seccion=<id>` redirigen a ella. Los ids vienen de SETTINGS_SECTIONS.
 */
test('todos los enlaces profundos de Ajustes abren su subpantalla', async ({ page }) => {
  test.setTimeout(90_000)
  await startDemo(page)
  for (const section of WEB_SECTIONS) {
    if (section.href) {
      await go(page, section.href)
      await expect(page.locator('#page-title'), section.id).toBeVisible()
      continue
    }
    await go(page, `/ajustes/${section.id}`)
    await expect(page.locator('#page-title'), section.id).not.toHaveText('Ajustes')
    await expect(page.getByRole('link', { name: 'Ajustes' }).first(), `${section.id}: vuelta al índice`).toBeVisible()
    // El enlace antiguo con consulta lleva al mismo sitio.
    await go(page, `/ajustes?seccion=${section.id}`)
    await expect(page).toHaveURL(new RegExp(`#/ajustes/${section.id}$`))
  }
  // Un id antiguo guardado en un marcador sigue funcionando.
  await go(page, '/ajustes?seccion=reset-title')
  await expect(page).toHaveURL(/#\/ajustes\/reinicio$/)
  await expect(page.getByRole('button', { name: 'Reiniciar datos de demostración' })).toBeVisible()
})

test('el índice de Ajustes enlaza cada sección exactamente una vez y la búsqueda filtra por título y palabras clave', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes')
  const index = page.getByRole('navigation', { name: 'En esta página' })
  for (const section of SETTINGS_SECTIONS) {
    const target = section.href ?? `/ajustes/${section.id}`
    // Exactamente una vez; ninguna si solo existe en la app de iPhone.
    await expect(index.locator(`a[href="#${target}"]`), section.id).toHaveCount(section.nativeOnly ? 0 : 1)
  }
  // Cuenta y Pro siguen arriba; cada fila muestra su valor actual cuando lo tiene.
  await expect(page.getByTestId('account-link')).toBeVisible()
  await expect(page.getByTestId('settings-row-cuentas')).toContainText('3 cuentas')
  // Búsqueda: por título («Copias») y por palabra clave («tema» → Formato).
  const search = page.getByRole('searchbox', { name: 'Buscar en Ajustes' })
  await search.fill('copias')
  await expect(index.locator('a')).toHaveCount(2)
  await search.fill('tema')
  await expect(page.getByTestId('settings-row-formato')).toBeVisible()
  await search.fill('zzzz')
  await expect(index.getByRole('status')).toContainText('zzzz')
  await expect(index.locator('a')).toHaveCount(0)
})
