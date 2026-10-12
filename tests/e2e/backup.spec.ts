import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { available, go, startDemo, storedData, writeStoredData } from './helpers'

test('exportar, rechazar copias inválidas sin tocar datos e importar una válida', { tag: '@smoke' }, async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes/copia')

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar copia' }).click()])
  expect(download.suggestedFilename()).toMatch(/^clara-demo-copia-.*\.json$/)
  const backup = JSON.parse(readFileSync((await download.path())!, 'utf8'))
  expect(backup.format).toBe('margen-backup')
  expect(backup.data.transactions.length).toBeGreaterThan(20)

  const input = page.getByTestId('import-file')

  // 1) No es JSON
  await input.setInputFiles({ name: 'roto.json', mimeType: 'application/json', buffer: Buffer.from('{esto no es json') })
  await expect(page.getByText('No se importó el archivo')).toBeVisible()
  await expect(page.getByText('El archivo no es JSON válido.')).toBeVisible()

  // 2) Importe con decimales (no son centavos enteros)
  const bad = structuredClone(backup)
  bad.data.transactions[0].amountMinor = 12.5
  await input.setInputFiles({ name: 'malo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) })
  await expect(page.getByText('El importe debe ser un número entero de centavos.')).toBeVisible()
  await expect(await available(page)).toHaveText('$136.78')

  // 3) Copia válida con un cambio: pide confirmación y reemplaza.
  await go(page, '/ajustes/copia')
  const good = structuredClone(backup)
  good.data.accounts[0].name = 'Cuenta importada'
  await page.getByTestId('import-file').setInputFiles({ name: 'buena.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(good)) })
  const dialog = page.getByRole('dialog', { name: '¿Reemplazar tus datos con esta copia?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Son datos de demostración')).toBeVisible()
  await dialog.getByRole('button', { name: 'Reemplazar datos' }).click()
  await expect(page.getByText('Copia importada')).toBeVisible()
  await go(page, '/ajustes/cuentas')
  await expect(page.getByText('Cuenta importada').first()).toBeVisible()

  // Tras recargar, sigue la versión importada.
  await page.reload()
  await go(page, '/ajustes/cuentas')
  await expect(page.getByText('Cuenta importada').first()).toBeVisible()
})

test('copia sin fotos: aviso de tamaño, archivo sin recibos que no cuenta como copia y aviso al importarla', async ({ page }) => {
  await startDemo(page)
  // Un movimiento con foto de recibo (como lo deja el asistente).
  const d = JSON.parse((await storedData(page))!)
  d.transactions[0].receiptUri = 'data:image/jpeg;base64,' + 'A'.repeat(3000)
  await writeStoredData(page, d)
  await page.reload()
  await go(page, '/ajustes/copia')

  await expect(page.getByTestId('backup-receipts')).toContainText('Incluye 1 recibo(s) con foto')
  await expect(page.getByText('Nunca has exportado una copia de seguridad.')).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-without-receipts').click()])
  // El aviso se comprueba antes de leer el archivo: en CI la lectura puede tardar más de lo que dura el aviso.
  await expect(page.getByText('Copia sin fotos descargada').first()).toBeVisible()
  expect(download.suggestedFilename()).toMatch(/^clara-demo-copia-sin-fotos-.*\.json$/)
  const text = readFileSync((await download.path())!, 'utf8')
  expect(text).not.toContain('receiptUri')
  const file = JSON.parse(text)
  expect(file.omitted).toEqual(['receipts'])
  expect(file.data.transactions.length).toBe(d.transactions.length)
  // No cuenta como copia de seguridad: el estado sigue igual.
  await expect(page.getByText('Nunca has exportado una copia de seguridad.')).toBeVisible()

  // Al importarla, el resumen avisa de que los movimientos quedarán sin foto. Se cancela: nada cambia.
  await page.getByTestId('import-file').setInputFiles({ name: 'ligera.json', mimeType: 'application/json', buffer: Buffer.from(text) })
  const dialog = page.getByRole('dialog', { name: '¿Reemplazar tus datos con esta copia?' })
  await expect(dialog.getByTestId('import-no-receipts')).toContainText('sin fotos de recibos')
  await dialog.getByRole('button', { name: 'Cancelar' }).click()
  await expect(page.getByTestId('backup-receipts')).toBeVisible()
})
