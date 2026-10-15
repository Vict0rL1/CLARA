import { mkdirSync, readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { go, startDemo, storedData } from './helpers'

/**
 * Regresiones de navegador de la comprobación independiente de `main` a23b135 (2026-10-15):
 * RT-01 (moneda escrita en todas sus formas), RT-02 (deshacer un reemplazo con un cambio automático
 * justo después, sin retrasos artificiales: el de escritura retenida está en
 * `src/state/replaceUndo.test.ts`) y RT-03 (el reconocimiento de filas omitidas de un CSV pertenece
 * a esa vista previa).
 */
type Stored = { transactions: { id: string; amountMinor: number; currency: string; note?: string; scheduleId?: string }[]; schedules: { id: string; name: string }[]; accounts: { name: string }[] }
const txs = async (page: Page) => (JSON.parse((await storedData(page)) ?? '{}') as Stored).transactions ?? []

/** Captura opcional para el informe (`RT_SHOTS=dir`); no cambia la prueba. */
async function shot(page: Page, name: string) {
  const dir = process.env.RT_SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: `${dir}/${name}-${test.info().project.name}.png`, fullPage: true })
}

for (const [text, field, found] of [
  ['coffee 10€', '€10.00', '€'],
  ['coffee GBP 10', '10.00 GBP', 'GBP'],
  ['coffee EUR ten', '10.00 EUR', 'EUR'],
  ['coffee ten USD', '10.00 USD', 'USD'],
] as const) {
  test(`RT-01 · «${text}» en un presupuesto CAD no se puede registrar como CAD`, async ({ page }) => {
    await startDemo(page)
    const before = await txs(page)
    await go(page, '/asistente')
    await page.getByLabel('Texto').fill(text)
    await page.getByRole('button', { name: 'Analizar' }).click()
    const line = page.getByTestId('assistant-preview').locator('.assistant__line').first()
    await expect(line.getByLabel('Importe')).toHaveValue(field)
    await expect(line.getByText(`El importe está en ${found}; este presupuesto usa CAD. No se convierte.`)).toBeVisible()
    await expect(line.getByTestId('review-currency')).toContainText(`Escribiste ${found}; este presupuesto usa CAD`)
    await expect(page.getByTestId('assistant-currency-blocked')).toBeVisible()
    const register = page.getByRole('button', { name: 'Registrar 1 movimiento' })
    await expect(register).toBeDisabled()
    if (text === 'coffee 10€') await shot(page, 'rt01-coffee-10-euro')
    // Ni un clic forzado ni Intro en el campo guardan nada.
    await register.click({ force: true })
    await line.getByLabel('Importe').press('Enter')
    await page.reload()
    await go(page, '/')
    await expect(page.getByTestId('available')).toBeVisible()
    expect(await txs(page)).toEqual(before)
  })
}

test('RT-01 · control: «coffee 10» y «coffee 10 CAD» se registran en CAD y sobreviven a recargar', async ({ page }) => {
  await startDemo(page)
  await go(page, '/asistente')
  await page.getByLabel('Texto').fill('coffee 10\ntea 4 CAD')
  await page.getByRole('button', { name: 'Analizar' }).click()
  await expect(page.getByTestId('assistant-currency-blocked')).toHaveCount(0)
  await page.getByRole('button', { name: 'Registrar 2 movimientos' }).click()
  await expect(page.getByText('2 movimientos registrados').first()).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
  const saved = (await txs(page)).filter((t) => t.note === 'coffee' || t.note === 'tea')
  expect(saved.map((t) => [t.note, t.amountMinor, t.currency]).sort()).toEqual([['coffee', 1000, 'CAD'], ['tea', 400, 'CAD']])
})

const undoOf = (page: Page, text: string) =>
  page.locator('.toast').filter({ hasText: text }).getByRole('button', { name: 'Deshacer' }).or(page.getByTestId('toast-held').getByRole('button', { name: 'Deshacer' }))

/** La copia lleva «Recibo de luz» (vencido el 27-sep) con confirmación automática: al aplicarla, la app lo registra sola. */
function withAutoBill(backup: { data: { schedules: { name: string; autoConfirm?: boolean }[]; accounts: { name: string }[] } }) {
  backup.data.schedules.find((s) => s.name === 'Recibo de luz')!.autoConfirm = true
  backup.data.accounts[0]!.name = 'Cuenta reemplazada'
  return backup
}

async function expectUndoRefusedAndAutoBillKept(page: Page, toastText: string) {
  // La tarea automática registró el recibo en cuanto se vieron los datos nuevos; su aviso puede
  // sustituir al del reemplazo, cuyo «Deshacer» queda entonces retenido (`toast-held`).
  await expect(page.getByText('1 pago programado se registró solo').first()).toBeVisible()
  await undoOf(page, toastText).first().click()
  await expect(page.getByText('No se deshizo: guardaste cambios después y se perderían.').first()).toBeVisible()
  await go(page, '/')
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
  const stored = JSON.parse((await storedData(page)) ?? '{}') as Stored
  const bill = stored.schedules.find((s) => s.name === 'Recibo de luz')!
  expect(stored.transactions.filter((t) => t.scheduleId === bill.id)).toHaveLength(1)
  expect(stored.accounts[0]!.name).toBe('Cuenta reemplazada')
}

test('RT-02 · importar una copia que dispara un registro automático: «Deshacer» se niega y el registro sobrevive a recargar', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes/copia')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar copia' }).click()])
  const backup = withAutoBill(JSON.parse(readFileSync((await download.path())!, 'utf8')))
  await page.getByTestId('import-file').setInputFiles({ name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await page.getByRole('dialog', { name: '¿Reemplazar tus datos con esta copia?' }).getByRole('button', { name: 'Reemplazar datos' }).click()
  await expectUndoRefusedAndAutoBillKept(page, 'Copia importada')
})

test('RT-02 · restaurar una copia local que dispara un registro automático: «Deshacer» se niega y el registro sobrevive a recargar', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes/copias-locales')
  await page.getByTestId('backup-now').click()
  await expect(page.getByText('Copia local guardada')).toBeVisible()
  // La copia local guardada pasa a llevar el recibo con confirmación automática.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('clara-backups', 1)
        req.onsuccess = () => {
          const tx = req.result.transaction('backups', 'readwrite')
          const store = tx.objectStore('backups')
          const all = store.getAll()
          all.onsuccess = () => {
            for (const rec of all.result as { json: string }[]) {
              const file = JSON.parse(rec.json)
              file.data.schedules.find((s: { name: string }) => s.name === 'Recibo de luz').autoConfirm = true
              file.data.accounts[0].name = 'Cuenta reemplazada'
              store.put({ ...rec, json: JSON.stringify(file) })
            }
          }
          tx.oncomplete = () => {
            req.result.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
        req.onerror = () => reject(req.error)
      }),
  )
  await page.reload()
  await page.getByRole('button', { name: /^Restaurar ?: / }).first().click()
  await page.getByRole('dialog', { name: '¿Restaurar esta copia?' }).getByRole('button', { name: 'Restaurar' }).click()
  await expectUndoRefusedAndAutoBillKept(page, 'Copia restaurada')
})
