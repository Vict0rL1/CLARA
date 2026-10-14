import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { available, go, showAllNotices, START, startDemo, storedData, storedRecord, seedLegacyLocalStorage } from './helpers'

/** Convierte los datos guardados en una copia v4 real (sin los campos nuevos), no demo y creada hace 10 días. */
async function storeAsOldV4(page: Page) {
  const data = JSON.parse((await storedData(page))!)
  data.schemaVersion = 4
  data.isDemo = false
  data.createdAt = '2026-09-18T12:00:00.000Z'
  for (const field of ['trash', 'purgedImportRefs', 'favorites', 'reconciliations', 'backup', 'periodBudgets', 'scenarios', 'inbox', 'incomeDistributions']) delete data[field]
  delete data.settings.weeklyReview
  // Una v4 venía de una versión que guardaba en localStorage.
  await seedLegacyLocalStorage(page, data)
}

test('copia de seguridad: nunca exportada, exportación solicitada, verificación y datos nuevos sin respaldar', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes/copia')
  const status = page.getByTestId('backup-status')
  await expect(status).toContainText('Nunca has exportado una copia de seguridad.')
  await expect(status).toContainText('Ninguna copia verificada todavía.')
  await expect(page.getByText(/Guardar en este navegador no es una copia de seguridad/)).toBeVisible()

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar copia' }).click()])
  await expect(page.getByText(/Descarga solicitada/)).toBeVisible()
  await expect(status).toContainText('Última exportación:')
  await expect(status).toContainText('No puede comprobar dónde se guardó')
  await expect(status).toContainText('Sin cambios desde la última exportación.')

  // Verificar: la app lee el archivo elegido y comprueba que es de este presupuesto (no importa nada).
  const text = readFileSync((await download.path())!, 'utf8')
  await page.getByTestId('verify-file').setInputFiles({ name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(text) })
  await expect(page.getByText('Copia verificada: el archivo es válido.')).toBeVisible()
  await expect(status).toContainText('Copia verificada: archivo del')

  // Una copia válida de otro presupuesto no cuenta como verificación.
  const other = JSON.parse(text)
  other.data.budgetId = '00000000-0000-4000-8000-000000000000'
  await page.getByTestId('verify-file').setInputFiles({ name: 'otra.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(other)) })
  await expect(page.getByText('El archivo es una copia válida, pero de otro presupuesto.')).toBeVisible()

  // Un cambio en los datos queda como «sin respaldar».
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe').fill('3')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await go(page, '/ajustes/copia')
  await expect(page.getByTestId('backup-status')).toContainText('Hay datos nuevos sin respaldar.')
})

test('copia de seguridad: una exportación fallida no se registra como hecha', async ({ page }) => {
  await page.addInitScript(() => {
    URL.createObjectURL = () => {
      throw new Error('Descarga bloqueada')
    }
  })
  await startDemo(page)
  await go(page, '/ajustes/copia')
  await page.getByRole('button', { name: 'Exportar copia' }).click()
  await expect(page.getByText('No se pudo generar la copia. No se registró ninguna exportación.')).toBeVisible()
  await expect(page.getByTestId('backup-status')).toContainText('Nunca has exportado una copia de seguridad.')
})

test('datos v4 del navegador se migran sin perder nada; recordatorio en Inicio, posponer y exportar', async ({ page }) => {
  await startDemo(page)
  await storeAsOldV4(page)
  await page.reload()

  // Migración: mismos importes, copia previa guardada y nada eliminado.
  await expect(page.getByTestId('available')).toHaveText('$136.78')
  const preserved = (await storedRecord(page, 'margen.data.before-v11')) as { fromVersion: number }
  expect(preserved.fromVersion).toBe(4)
  await showAllNotices(page)
  await expect(page.getByText('Haz una copia de seguridad')).toBeVisible()
  await expect(page.getByText('Nunca has exportado tus datos.')).toBeVisible()

  // Posponer: no vuelve a aparecer al navegar ni al recargar.
  await page.getByRole('button', { name: 'Recordar en 7 días' }).click()
  await expect(page.getByText(/Te lo recordaremos el/)).toBeVisible()
  await expect(page.getByText('Haz una copia de seguridad')).toHaveCount(0)
  await go(page, '/movimientos')
  await go(page, '/')
  await expect(page.getByText('Haz una copia de seguridad')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
  await expect(page.getByText('Haz una copia de seguridad')).toHaveCount(0)

  // 8 días después vuelve a recordarlo; «Exportar ahora» lo resuelve.
  await page.clock.setSystemTime(new Date(START.getTime() + 8 * 86_400_000))
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
  await showAllNotices(page)
  await expect(page.getByText('Haz una copia de seguridad')).toBeVisible()
  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar ahora' }).click()])
  await expect(page.getByText('Haz una copia de seguridad')).toHaveCount(0)

  // Desactivado: no se muestra aunque haya cambios.
  await go(page, '/ajustes/copia')
  await page.getByLabel('Recordatorio de copia').selectOption('off')
  await expect(await available(page)).toBeVisible()
  await expect(page.getByText('Haz una copia de seguridad')).toHaveCount(0)
})
