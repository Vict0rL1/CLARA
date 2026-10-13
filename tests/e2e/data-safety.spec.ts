import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { failStorageWrites, go, movementCount, restoreStorageWrites, START, startDemo, storedData, writeStoredData, openDetails } from './helpers'

async function addExpense(page: Page, amount: string, note: string) {
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe', { exact: true }).fill(amount)
  await openDetails(page)
  await page.getByLabel('Nota (opcional)').fill(note)
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
}

const stored = storedData
const failWrites = (page: Page) => failStorageWrites(page, 'QuotaExceededError')
const restoreWrites = restoreStorageWrites

test('almacenamiento lleno: nunca dice «Guardado», conserva lo guardado y permite descargar y reintentar', async ({ page }) => {
  await startDemo(page)
  const before = await stored(page)
  const count = await movementCount(page)
  await failWrites(page)
  await addExpense(page, '12.34', 'Prueba sin espacio')
  const banner = page.getByTestId('save-problem')
  await expect(banner).toContainText('Tus últimos cambios no se guardaron')
  await expect(banner).toContainText('no tiene espacio')
  await expect(page.locator('.save-indicator')).not.toContainText('Guardado')
  expect(await stored(page)).toBe(before) // último estado válido intacto
  // Descargar una copia de lo que se ve (incluye el cambio no guardado).
  const download = page.waitForEvent('download')
  await banner.getByRole('button', { name: 'Descargar copia de lo que ves' }).click()
  expect((await download).suggestedFilename()).toMatch(/^clara-demo-copia-.*\.json$/)
  // Al liberar espacio, reintentar guarda todo.
  await restoreWrites(page)
  await banner.getByRole('button', { name: 'Volver a intentar' }).click()
  await expect(banner).toHaveCount(0)
  await expect(page.locator('.save-indicator')).toContainText('Guardado')
  await page.reload()
  expect(await movementCount(page)).toBe(count + 1)
})

test('abrir con el almacenamiento lleno muestra los datos (no la bienvenida ni una demo nueva)', async ({ page }) => {
  await startDemo(page)
  const count = await movementCount(page)
  await page.addInitScript(() => {
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('simulado', 'QuotaExceededError')
    }
    Storage.prototype.setItem = function () {
      throw new DOMException('simulado', 'QuotaExceededError')
    }
  })
  await page.reload()
  await go(page, '/')
  await expect(page.getByTestId('available')).toBeVisible()
  expect(await movementCount(page)).toBe(count)
  await expect(page.getByText('No se puede guardar en este navegador.')).toHaveCount(0)
})

test('dos pestañas: la segunda no sobrescribe en silencio lo que guardó la primera', async ({ page, context }) => {
  await page.clock.install({ time: START })
  await startDemo(page)
  const other = await context.newPage()
  await other.clock.install({ time: START })
  await other.goto('/')
  await expect(other.getByTestId('available')).toBeVisible()

  await addExpense(page, '5', 'Desde la pestaña A')
  const savedByA = await stored(page)
  await addExpense(other, '7', 'Desde la pestaña B')
  const banner = other.getByTestId('save-problem')
  await expect(banner).toContainText('Otra pestaña')
  expect(await stored(other)).toBe(savedByA)
  // Cargar lo guardado trae el cambio de A (y descarta el de B, como dice el botón).
  await banner.getByRole('button', { name: /Cargar lo guardado/ }).click()
  await go(other, '/movimientos')
  await expect(other.locator('a.item', { hasText: 'Desde la pestaña A' })).toBeVisible()
  await expect(other.locator('a.item', { hasText: 'Desde la pestaña B' })).toHaveCount(0)
  // Ahora B puede guardar sin pisar a A.
  await addExpense(other, '7', 'Desde la pestaña B')
  await go(other, '/movimientos')
  await expect(other.locator('a.item', { hasText: 'Desde la pestaña A' })).toBeVisible()
  await expect(other.locator('a.item', { hasText: 'Desde la pestaña B' })).toBeVisible()
})

test('H4 · datos de una versión más nueva (esquema 13): se explican, sin «Empezar de nuevo», y ningún botón los toca', { tag: '@smoke' }, async ({ page }) => {
  await startDemo(page)
  const d = JSON.parse((await stored(page))!)
  d.schemaVersion = 13
  await writeStoredData(page, d)
  const future = await stored(page)
  await page.reload()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Estos datos son de una versión más nueva de Clara')
  await expect(page.getByText('Si acabas de usar Clara en otro dispositivo o pestaña, ábrela ahí y vuelve aquí más tarde.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Empezar de nuevo' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /dañados/ })).toHaveCount(0)
  // Solo dos botones: recargar (principal) y descargar una copia.
  await expect(page.locator('main button')).toHaveCount(2)
  await expect(page.locator('main .btn--primary')).toHaveText('Recargar la app')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar una copia de estos datos' }).click()
  const file = await (await download).path()
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(future!))
  expect(await stored(page)).toBe(future)
  await page.getByRole('button', { name: 'Recargar la app' }).click()
  await expect(alert).toContainText('Estos datos son de una versión más nueva de Clara')
  expect(await stored(page)).toBe(future)
})

test('datos dañados: «Empezar de nuevo» sigue disponible, pide confirmación y cancelar no toca nada', async ({ page }) => {
  await startDemo(page)
  const d = JSON.parse((await stored(page))!)
  delete d.accounts
  await writeStoredData(page, d)
  const broken = await stored(page)
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('No pudimos leer tus datos guardados')
  await expect(page.getByRole('button', { name: 'Descargar datos dañados' })).toBeVisible()
  await page.getByRole('button', { name: 'Empezar de nuevo' }).click()
  const dialog = page.getByRole('dialog', { name: '¿Empezar de nuevo?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancelar' }).click()
  expect(await stored(page)).toBe(broken)
})

test('restaurar una copia se puede deshacer en el momento', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes/copia')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar copia' }).click()
  const file = await (await download).path()
  await addExpense(page, '3.21', 'Después de exportar')
  const count = await movementCount(page)
  await go(page, '/ajustes/copia')
  await page.getByTestId('import-file').setInputFiles(file)
  await page.getByRole('dialog').getByRole('button', { name: 'Reemplazar datos' }).click()
  await page.getByRole('button', { name: 'Deshacer' }).click()
  await expect(page.getByText('Importación deshecha')).toBeVisible()
  expect(await movementCount(page)).toBe(count)
})

test('usuario de una versión anterior: sus datos de localStorage pasan a IndexedDB sin perder nada y el origen se conserva', async ({ page }) => {
  await startDemo(page)
  const count = await movementCount(page)
  const data = JSON.parse((await stored(page))!)
  // Simula la versión anterior: datos solo en localStorage, IndexedDB vacía.
  await page.evaluate(
    (text) =>
      new Promise<void>((resolve) => {
        localStorage.setItem('margen.data.v1', text)
        localStorage.removeItem('margen.data.pre-idb')
        const req = indexedDB.deleteDatabase('clara')
        req.onsuccess = () => resolve()
        req.onblocked = () => resolve()
      }),
    JSON.stringify(data),
  )
  await page.reload()
  await go(page, '/')
  await expect(page.getByTestId('available')).toBeVisible()
  expect(await movementCount(page)).toBe(count)
  expect(JSON.parse((await stored(page))!).transactions).toEqual(data.transactions)
  const origin = await page.evaluate(() => ({ copy: localStorage.getItem('margen.data.pre-idb'), main: localStorage.getItem('margen.data.v1') }))
  expect(JSON.parse(origin.copy!).transactions).toEqual(data.transactions)
  expect(JSON.parse(origin.main!).movedTo).toBe('indexeddb')
  // Ajustes muestra dónde están los datos y la copia del origen.
  await go(page, '/ajustes/almacenamiento')
  await expect(page.getByText(/IndexedDB/).first()).toBeVisible()
})
