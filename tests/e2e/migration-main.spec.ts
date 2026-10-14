import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { go, movementCount, openApp, storedData, storedRecord, writeStoredData } from './helpers'

/**
 * H3 · Red de seguridad de la migración (V1 convertido en prueba permanente): los datos que guardó la
 * compilación real de `main` (esquema 8, capturados con scripts/capture-main-fixture.mjs) se abren en
 * esta versión con las mismas cifras, se conserva una copia antes de migrar y el primer guardado los
 * deja en el esquema 10.
 */
const fixture = JSON.parse(readFileSync(new URL('./fixtures/main-schema8.json', import.meta.url), 'utf8')) as {
  expected: { available: string; transactions: number }
  data: { schemaVersion: number; transactions: unknown[] }
}

test('H3 · datos de main (esquema 8): mismas cifras, copia previa y esquema 11 tras guardar', async ({ page }) => {
  expect(fixture.data.schemaVersion).toBe(8)
  await openApp(page)
  await expect(page.getByRole('heading', { name: 'Hola, esto es Clara' })).toBeVisible()
  await writeStoredData(page, fixture.data)
  await page.reload()

  // Mismo «Puedes gastar» que mostraba main y el mismo número de movimientos.
  await expect(page.getByTestId('available')).toHaveText(fixture.expected.available)
  expect(await movementCount(page)).toBe(fixture.expected.transactions)

  // Copia íntegra de los datos de main antes de migrar.
  const before = (await storedRecord(page, 'margen.data.before-v11')) as { fromVersion: number; raw: string } | null
  expect(before).not.toBeNull()
  expect(before!.fromVersion).toBe(8)
  expect(JSON.parse(before!.raw)).toEqual(fixture.data)

  // Un guardado (un gasto de 1.00) escribe el esquema 10 y no toca lo anterior.
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe', { exact: true }).fill('1')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  const saved = JSON.parse((await storedData(page))!) as { schemaVersion: number; transactions: unknown[] }
  expect(saved.schemaVersion).toBe(11)
  expect(saved.transactions).toHaveLength(fixture.expected.transactions + 1)
})
