import { expect, test, type Page } from '@playwright/test'
import { baseData } from '../../src/test/fixtures'
import { available, go, openApp, waitForSaved } from './helpers'
import { asNativeApp, FAKE_NATIVE_PREFIX, nativeFile, seedNativeData } from './nativeShell'

/**
 * Lo que la app de iPhone guardaba en el WebView y iOS puede vaciar (decisión 173), ahora en archivos de la app, con el
 * puente nativo simulado (`nativeShell.ts`): las copias locales automáticas, el bloqueo con PIN y las preferencias, y la
 * fila «copia previa a una migración» de Datos y recuperación. El Swift y el iPhone real no se prueban aquí.
 */

/**
 * Como iOS al quedarse sin espacio: borra el almacenamiento del WebView (no los archivos de la app). iOS lo hace con la
 * app cerrada, así que primero se sale de Clara (a un archivo del mismo origen, sin la app) y después se vuelve.
 */
async function iosEmptiesWebView(page: Page) {
  await page.goto('/manifest.webmanifest')
  await page.evaluate(async (prefix) => {
    for (const key of Object.keys(localStorage)) if (!key.startsWith(prefix)) localStorage.removeItem(key)
    for (const name of ['clara', 'clara-backups']) {
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(name)
        req.onsuccess = req.onerror = req.onblocked = () => resolve()
      })
    }
  }, FAKE_NATIVE_PREFIX)
}

async function enablePin(page: Page) {
  await go(page, '/ajustes/bloqueo')
  await page.getByRole('switch', { name: 'Pedir PIN al abrir' }).click()
  const dialog = page.getByRole('dialog', { name: 'Elige un PIN' })
  await dialog.getByLabel('PIN', { exact: true }).fill('2468')
  await dialog.getByLabel('Repite el PIN').fill('2468')
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('PIN guardado; se pedirá al abrir')).toBeVisible()
}

const deviceCopy = async (page: Page) => {
  const file = await nativeFile(page, 'device')
  return file ? (JSON.parse(file.text) as Record<string, string>) : null
}

test('las copias locales automáticas van a archivos de la app, no al IndexedDB del WebView', async ({ page }) => {
  await asNativeApp(page)
  await openApp(page)
  await seedNativeData(page, baseData())
  await expect(await available(page)).toHaveText('$1,000.00')
  // La primera copia automática se hace al abrir (datos propios, sin copia previa).
  await expect.poll(async () => (await nativeFile(page, 'local-backups')) !== null).toBe(true)
  const index = JSON.parse((await nativeFile(page, 'local-backups'))!.text) as { id: string; file: string; reason: string }[]
  expect(index).toHaveLength(1)
  expect(index[0]!.reason).toBe('auto')
  expect(JSON.parse((await nativeFile(page, index[0]!.file))!.text).data.budgetId).toBe('budget-1')
  expect(await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))).not.toContain('clara-backups')

  await go(page, '/ajustes/copias-locales')
  await expect(page.getByTestId('local-backup-list').locator('li')).toHaveCount(1)
  await page.getByTestId('backup-now').click()
  await expect(page.getByTestId('local-backup-list').locator('li')).toHaveCount(2)
  expect(JSON.parse((await nativeFile(page, 'local-backups'))!.text)).toHaveLength(2)
})

test('si iOS vacía el WebView, el bloqueo con PIN vuelve al abrir; y quitarlo también se conserva', async ({ page }) => {
  await asNativeApp(page)
  await openApp(page)
  await seedNativeData(page, baseData())
  await enablePin(page)
  await expect.poll(async () => Object.keys((await deviceCopy(page)) ?? {})).toContain('clara.lock.v1')

  await iosEmptiesWebView(page)
  expect(await page.evaluate(() => localStorage.getItem('clara.lock.v1'))).toBeNull()
  await page.goto('/')
  await expect(page.getByTestId('lock-screen')).toBeVisible()
  await page.getByLabel('PIN').fill('2468')
  await page.getByRole('button', { name: 'Desbloquear' }).click()
  await expect(page.getByTestId('lock-screen')).toHaveCount(0)
  // Los datos siguen en su archivo.
  await expect(await available(page)).toHaveText('$1,000.00')

  await go(page, '/ajustes/bloqueo')
  await page.getByRole('switch', { name: 'Pedir PIN al abrir' }).click()
  await expect(page.getByText('Bloqueo quitado')).toBeVisible()
  await expect.poll(async () => Object.keys((await deviceCopy(page)) ?? {})).not.toContain('clara.lock.v1')
  await waitForSaved(page)
  await iosEmptiesWebView(page)
  await page.goto('/')
  await expect(page.getByTestId('available')).toBeVisible()
  await expect(page.getByTestId('lock-screen')).toHaveCount(0)
})

test('Datos y recuperación ve la copia previa a una migración guardada en el archivo de la app', async ({ page }) => {
  await asNativeApp(page)
  await openApp(page)
  await seedNativeData(page, { ...baseData(), schemaVersion: 14 })
  await expect(await available(page)).toHaveText('$1,000.00')
  expect(JSON.parse((await nativeFile(page, 'before-v15'))!.text).fromVersion).toBe(14)
  await go(page, '/ajustes/datos')
  await expect(page.getByTestId('data-row-preMigration')).toContainText('Copia previa a la migración al esquema 15, conservada en la app')
  await expect(page.getByTestId('data-row-preMigration')).toHaveAttribute('data-state', 'ok')
})

test('si iOS vacía el WebView con Clara suspendida, al volver (resume) el bloqueo se restaura antes de cualquier copia', async ({ page }) => {
  await asNativeApp(page)
  await openApp(page)
  await seedNativeData(page, baseData())
  await enablePin(page)
  await expect.poll(async () => Object.keys((await deviceCopy(page)) ?? {})).toContain('clara.lock.v1')
  // Vaciado con la página viva (app suspendida) y vuelta a primer plano.
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) if (key.startsWith('clara.')) localStorage.removeItem(key)
    document.dispatchEvent(new Event('resume'))
  })
  await expect.poll(() => page.evaluate(() => localStorage.getItem('clara.lock.v1'))).not.toBeNull()
  await page.reload()
  await expect(page.getByTestId('lock-screen')).toBeVisible()
  expect(Object.keys((await deviceCopy(page)) ?? {})).toContain('clara.lock.v1')
})
