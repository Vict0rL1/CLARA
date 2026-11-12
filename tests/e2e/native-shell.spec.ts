import { expect, test, type Page } from '@playwright/test'
import { expectNoHorizontalScroll, go, reloadWhenSaved, setLanguage, setupFirstUse, startDemo, storedData, waitForSaved } from './helpers'
import { asNativeApp, fakeBiometricCalls, nativeFile, setFakeBiometric } from './nativeShell'

/**
 * Clara dentro de la app de iPhone (Fase 1), con el puente nativo simulado (`nativeShell.ts`). Comprueba el lado web:
 * que guarda en el archivo propio de la app y no en el almacenamiento del WebView, que trae una sola vez lo que hubiera
 * ahí, y que los textos y pantallas del navegador (instalar, persistencia, Safari, enlaces de Atajos) se sustituyen por
 * los de la app. El Swift y el iPhone real no se prueban aquí.
 */

/** Las peticiones de los paquetes de texto de la app (`nativeApp.<idioma>-<huella>.json`). */
function nativePackRequests(page: Page): string[] {
  const urls: string[] = []
  page.on('request', (request) => {
    if (/nativeApp\.[a-z]{2}[-.]/.test(request.url())) urls.push(request.url())
  })
  return urls
}

test.describe('datos: un archivo propio de la app', () => {
  test('guarda en el archivo nativo, no en el WebView, y lo guardado sigue ahí al volver a abrir', async ({ page }) => {
    await asNativeApp(page)
    await startDemo(page)
    await waitForSaved(page)
    const saved = await nativeFile(page, 'data')
    expect(saved).not.toBeNull()
    expect(saved!.revision).toBeGreaterThanOrEqual(1)
    expect((JSON.parse(saved!.text) as { isDemo?: boolean }).isDemo).toBe(true)
    // El almacenamiento del WebView (IndexedDB) no recibe los datos.
    expect(await storedData(page)).toBeNull()

    await go(page, '/ajustes/datos')
    await expect(page.getByTestId('data-row-saving')).toContainText('Guardado en este iPhone, en un archivo propio de la app')
    await expect(page.getByTestId('data-row-saving')).toHaveAttribute('data-state', 'ok')

    // Cerrar y abrir (aquí, recargar): los datos vuelven del archivo, y cada guardado sube la revisión.
    await reloadWhenSaved(page)
    await expect(page.locator('#page-title')).toBeVisible()
    await go(page, '/')
    await expect(page.getByTestId('available')).toBeVisible()
    expect((await nativeFile(page, 'data'))!.revision).toBeGreaterThanOrEqual(saved!.revision)
  })

  test('primer arranque con datos en el WebView: se copian al archivo nativo, se comprueban y el origen no se borra', async ({ page }) => {
    // Antes: la misma web sin puente nativo (como una compilación anterior a este repositorio) deja datos en IndexedDB.
    await startDemo(page)
    await waitForSaved(page)
    const before = await storedData(page)
    expect(before).not.toBeNull()

    await asNativeApp(page)
    await page.reload()
    await expect(page.getByTestId('available')).toBeVisible()
    const migrated = await nativeFile(page, 'data')
    expect(migrated).not.toBeNull()
    expect(JSON.parse(migrated!.text)).toEqual(JSON.parse(before!))
    const marker = await nativeFile(page, 'migration')
    expect(JSON.parse(marker!.text)).toMatchObject({ from: 'webview', status: 'done' })
    // El origen sigue intacto.
    expect(await storedData(page)).toBe(before)
  })

  test('sin el plugin de almacenamiento la app lo avisa: nunca dice que guarda en su archivo', async ({ page }) => {
    await asNativeApp(page, { storage: false })
    await startDemo(page)
    await waitForSaved(page)
    expect(await nativeFile(page, 'data')).toBeNull()
    expect(await storedData(page)).not.toBeNull()
    await go(page, '/ajustes/datos')
    const row = page.getByTestId('data-row-saving')
    await expect(row).toHaveAttribute('data-state', 'warn')
    await expect(row).toContainText('La app no pudo usar su archivo propio')
    await expect(page.getByTestId('storage-backend')).toContainText('La app no pudo usar su archivo propio y guarda en IndexedDB')
  })
})

test.describe('textos de la app', () => {
  test('«Clara en este iPhone» en vez de «Instalar Clara»: dónde están los datos, cómo traerlos, actualizar y los 7 días', async ({ page }) => {
    await asNativeApp(page)
    await startDemo(page)
    await go(page, '/ajustes')
    await expect(page.getByRole('link', { name: 'Clara en este iPhone' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Instalar Clara' })).toHaveCount(0)

    await go(page, '/ajustes/instalar')
    // El título de la página y el de la tarjeta dicen lo mismo.
    await expect(page.locator('#page-title')).toHaveText('Clara en este iPhone')
    await expect(page.locator('#instalar')).toHaveText('Clara en este iPhone')
    const guide = page.getByTestId('native-app-guide')
    await expect(guide).toContainText('la misma Clara de la web, dentro de una app instalada desde Xcode')
    await expect(guide).toContainText('Traer tus datos de la versión web')
    // Las instrucciones nombran la sección y los botones tal como se ven.
    await expect(guide).toContainText('abre Ajustes › Copias de seguridad y toca «Exportar copia»')
    await expect(guide).toContainText('toca «Importar copia» y elige ese archivo')
    await expect(guide).toContainText('Deja de abrirse a los 7 días')
    await expect(guide).toContainText('Antes de actualizar o reinstalar, exporta una copia.')
    // Nada de los pasos de Safari ni botones de instalar.
    await expect(page.getByTestId('install-guide')).toHaveCount(0)
    await expect(guide).not.toContainText('Agregar a inicio')
    await expect(guide.getByRole('button')).toHaveCount(0)
    await expectNoHorizontalScroll(page, 'Clara en este iPhone')

    await guide.getByRole('link', { name: 'Abrir Copias de seguridad' }).click()
    await expect(page.getByRole('button', { name: 'Exportar copia' })).toBeVisible()
  })

  test('almacenamiento: habla del iPhone y de la app, sin pedir nada al navegador', async ({ page }) => {
    await asNativeApp(page)
    await startDemo(page)
    await go(page, '/ajustes/datos')
    const card = page.locator('.card', { has: page.locator('#almacenamiento') })
    await expect(card).toContainText('Tus datos se guardan solo en este iPhone, dentro de la app Clara.')
    await expect(card).toContainText('Si eliminas la app de este iPhone, se pierden.')
    await expect(page.getByTestId('storage-backend')).toContainText('un archivo propio de la app Clara en este iPhone')
    await expect(page.getByTestId('persist-storage')).toHaveCount(0)
    await expect(card).not.toContainText(/navegador (puede|aceptó)|Safari/)
    await expect(page.locator('#main')).toContainText('Todo vive en este iPhone, dentro de la app')
    await expectNoHorizontalScroll(page, 'Datos y recuperación en la app')
  })

  test('Atajos: solo los de teclado; los enlaces hacia la Clara de la web no se ofrecen', async ({ page }) => {
    await asNativeApp(page)
    await startDemo(page)
    await go(page, '/ajustes/atajos')
    await expect(page.getByRole('heading', { name: 'Atajos de teclado' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Atajos de iPhone' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Copiar/ })).toHaveCount(0)
  })

  test('en otro idioma, los textos de la app salen en ese idioma', async ({ page }) => {
    await asNativeApp(page)
    await startDemo(page)
    await setLanguage(page, 'English')
    await go(page, '/ajustes/instalar')
    await expect(page.locator('#page-title')).toHaveText('Clara on this iPhone')
    await expect(page.locator('#instalar')).toHaveText('Clara on this iPhone')
    const guide = page.getByTestId('native-app-guide')
    await expect(guide).toContainText('It stops opening after 7 days')
    await expect(guide).toContainText('open Settings › Backups and tap “Export backup”')
    await expect(guide.locator('[lang="es"]')).toHaveCount(0)
    await expectNoHorizontalScroll(page, 'Clara on this iPhone')
  })

  test('«Protege tus datos» tras configurar: solo la copia, sin el paso del navegador', async ({ page }) => {
    await asNativeApp(page)
    await setupFirstUse(page)
    const card = page.getByTestId('safety-card')
    await expect(card).toBeVisible()
    await expect(card).toContainText('Clara guarda todo solo en este iPhone, sin servidor.')
    await expect(card.getByRole('heading', { name: 'Haz la primera copia' })).toBeVisible()
    await expect(page.getByTestId('safety-persist')).toHaveCount(0)
    await expect(card).not.toContainText('navegador')
    await expect(card.getByRole('button', { name: 'Exportar copia' })).toBeVisible()
  })
})

test.describe('la web no cambia', () => {
  test('en el navegador no se pide el paquete de la app y «Instalar Clara» sigue igual', async ({ page }) => {
    const requests = nativePackRequests(page)
    await startDemo(page)
    await go(page, '/ajustes')
    await expect(page.getByRole('link', { name: 'Instalar Clara' })).toBeVisible()
    await go(page, '/ajustes/instalar')
    await expect(page.getByTestId('install-guide')).toBeVisible()
    await expect(page.getByTestId('native-app-guide')).toHaveCount(0)
    await go(page, '/ajustes/datos')
    await expect(page.getByTestId('persist-storage')).toBeVisible()
    await expect(page.locator('.card', { has: page.locator('#almacenamiento') })).toContainText('Tus datos se guardan solo en este navegador, en este dispositivo.')
    await go(page, '/ajustes/atajos')
    await expect(page.getByRole('heading', { name: 'Atajos de iPhone' })).toBeVisible()
    expect(requests).toEqual([])
  })

  test('dentro de la app sí se pide, una vez por idioma', async ({ page }) => {
    const requests = nativePackRequests(page)
    await asNativeApp(page)
    await startDemo(page)
    await go(page, '/ajustes/instalar')
    await expect(page.getByTestId('native-app-guide')).toContainText('Deja de abrirse a los 7 días')
    expect(requests.filter((url) => /nativeApp\.es/.test(url))).toHaveLength(1)
  })
})

test.describe('Face ID o Touch ID en el bloqueo (decisión 165)', () => {
  /** Ajustes › Bloqueo: activa el PIN 2468. */
  async function enablePin(page: Page) {
    await go(page, '/ajustes/bloqueo')
    await page.getByRole('switch', { name: 'Pedir PIN al abrir' }).click()
    const dialog = page.getByRole('dialog', { name: 'Elige un PIN' })
    await dialog.getByLabel('PIN', { exact: true }).fill('2468')
    await dialog.getByLabel('Repite el PIN').fill('2468')
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(page.getByText('PIN guardado; se pedirá al abrir')).toBeVisible()
  }

  test('activar Face ID lo pide una vez; al abrir se pide y, si el sistema confirma, entra sin PIN', async ({ page }) => {
    await asNativeApp(page, { biometric: { available: true, answer: true } })
    await startDemo(page)
    await enablePin(page)
    const card = page.locator('.card', { has: page.locator('#bloqueo') })
    await expect(card).toContainText('Si este iPhone lo tiene configurado, también Face ID o Touch ID.')
    await card.getByRole('button', { name: 'Usar Face ID o Touch ID' }).click()
    await expect(page.getByText('Face ID o Touch ID activado', { exact: true })).toBeVisible()
    await expect(card).toContainText('Face ID o Touch ID activado en este iPhone.')
    expect(await fakeBiometricCalls(page)).toEqual(['Desbloquear'])

    await reloadWhenSaved(page)
    // Al abrir se pide Face ID sola; el sistema confirma y la app entra.
    await expect(page.getByTestId('lock-screen')).toHaveCount(0)
    await go(page, '/')
    await expect(page.getByTestId('available')).toBeVisible()
    expect(await fakeBiometricCalls(page)).toEqual(['Desbloquear', 'Desbloquear'])
  })

  test('si se cancela Face ID, la app sigue bloqueada y entra con el PIN', async ({ page }) => {
    await asNativeApp(page, { biometric: { available: true, answer: true } })
    await startDemo(page)
    await enablePin(page)
    await page.locator('.card', { has: page.locator('#bloqueo') }).getByRole('button', { name: 'Usar Face ID o Touch ID' }).click()
    await expect(page.getByText('Face ID o Touch ID activado', { exact: true })).toBeVisible()

    await setFakeBiometric(page, { available: true, answer: false })
    await reloadWhenSaved(page)
    const lock = page.getByTestId('lock-screen')
    await expect(lock).toBeVisible()
    await expect(lock).toContainText('No se pudo verificar. Usa el PIN.')
    await expect(page.getByTestId('available')).toHaveCount(0)
    await expect(lock.getByRole('button', { name: 'Usar Face ID o Touch ID' })).toBeVisible()
    await page.getByLabel('PIN').fill('2468')
    await page.getByRole('button', { name: 'Desbloquear' }).click()
    await expect(lock).toHaveCount(0)
    await expectNoHorizontalScroll(page, 'tras desbloquear con PIN')
  })

  test('sin Face ID configurado: se dice y no se ofrece el botón; el PIN funciona igual', async ({ page }) => {
    await asNativeApp(page, { biometric: { available: false, answer: false } })
    await startDemo(page)
    await enablePin(page)
    const card = page.locator('.card', { has: page.locator('#bloqueo') })
    await expect(card).toContainText('Face ID o Touch ID no está disponible ahora')
    await expect(card.getByRole('button', { name: 'Usar Face ID o Touch ID' })).toHaveCount(0)
    await expect(card).not.toContainText('WebAuthn')
    await reloadWhenSaved(page)
    await expect(page.getByTestId('lock-screen')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Usar Face ID o Touch ID' })).toHaveCount(0)
    expect(await fakeBiometricCalls(page)).toEqual([])
  })
})
