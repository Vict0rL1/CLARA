import { expect, test, type Page } from '@playwright/test'
import type { AppData } from '../../src/domain/types'
import { backupText } from '../../src/storage/backup'
import { account, baseData } from '../../src/test/fixtures'
import { available, go, openApp, seedStoredData, waitForSaved } from './helpers'

/**
 * Copia antes de importar (revisión de seguridad QA27, O-1/O-3/O-4): el diálogo dice qué protección hay de verdad en este
 * navegador —copia local o solo deshacer de inmediato— y, cuando no hay copias locales, ofrece descargar antes; importar
 * sigue adelante en los dos casos. Que exista `indexedDB` no basta: si no abre, cuenta como «sin copias locales».
 */
const clock = new Date('2026-10-22T12:00:00-04:00')
const current = (): AppData => baseData({ accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 123456, date: '2026-10-01', setAt: '2026-10-01T12:00:00.000Z' } })] })
const incoming = (): AppData => baseData({ accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 777, date: '2026-10-01', setAt: '2026-10-01T12:00:00.000Z' } })] })
const file = () => ({ name: 'otra.json', mimeType: 'application/json', buffer: Buffer.from(backupText(incoming(), new Date('2026-10-22T12:00:00.000Z'), 'test')) })
const NO_COPY = 'Este navegador no guarda copias locales: solo podrás deshacer de inmediato'
const WITH_COPY = 'Antes de reemplazar se guarda una copia local de lo actual'

async function seedViaLocalStorage(page: Page) {
  await openApp(page, clock)
  await expect(page.getByRole('heading', { name: 'Hola, esto es Clara' })).toBeVisible()
  await page.evaluate((d) => localStorage.setItem('margen.data.v1', JSON.stringify(d)), current())
  await page.reload()
  await expect(await available(page)).toHaveText('$1,234.56')
}

async function openImportDialog(page: Page) {
  await go(page, '/ajustes/copia')
  await page.getByTestId('import-file').setInputFiles(file())
  const dialog = page.getByRole('dialog', { name: '¿Reemplazar tus datos con esta copia?' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('sin IndexedDB: el diálogo dice que solo queda deshacer de inmediato, «Descargar copia antes» descarga, importar sigue y «Deshacer» devuelve lo anterior', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true })
  })
  await seedViaLocalStorage(page)
  const dialog = await openImportDialog(page)
  await expect(dialog.getByTestId('import-copy-note')).toContainText(NO_COPY)
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Descargar copia antes' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.json$/)
  await dialog.getByRole('button', { name: 'Reemplazar datos' }).click()
  const toast = page.getByRole('status').filter({ hasText: 'Copia importada' }).first()
  await expect(toast).toBeVisible()
  await waitForSaved(page)
  await go(page, '/')
  await expect(await available(page)).toHaveText('$7.77')
  // Deshacer de inmediato: la única red sin copias locales, y funciona.
  await toast.getByRole('button', { name: 'Deshacer' }).click()
  await waitForSaved(page)
  await expect(await available(page)).toHaveText('$1,234.56')
})

test('IndexedDB existe pero no abre: cuenta como «sin copias locales» (el diálogo lo dice) e importar sigue adelante', async ({ page }) => {
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new Error('blocked')
    }
  })
  await seedViaLocalStorage(page)
  const dialog = await openImportDialog(page)
  await expect(dialog.getByTestId('import-copy-note')).toContainText(NO_COPY)
  await expect(dialog.getByRole('button', { name: 'Descargar copia antes' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Reemplazar datos' }).click()
  await expect(page.getByText('Copia importada').first()).toBeVisible()
  await waitForSaved(page)
  await go(page, '/')
  await expect(await available(page)).toHaveText('$7.77')
})

test('con IndexedDB: el diálogo promete la copia local, no ofrece descargar antes, y tras importar la copia «Antes de restaurar» está en Copias locales', async ({ page }) => {
  await openApp(page, clock)
  await seedStoredData(page, current())
  await expect(await available(page)).toHaveText('$1,234.56')
  const dialog = await openImportDialog(page)
  await expect(dialog.getByTestId('import-copy-note')).toContainText(WITH_COPY)
  await expect(dialog.getByRole('button', { name: 'Descargar copia antes' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Reemplazar datos' }).click()
  await expect(page.getByText('Copia importada').first()).toBeVisible()
  await waitForSaved(page)
  await go(page, '/ajustes/copias-locales')
  await expect(page.getByTestId('local-backup-list').locator('li', { hasText: 'Antes de restaurar' }).first()).toBeVisible()
})
