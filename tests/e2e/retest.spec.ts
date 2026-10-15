import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { go, startDemo, storedData } from './helpers'

/**
 * Regresiones de navegador de la comprobación independiente de `main` a23b135 (2026-10-15):
 * RT-01 (moneda escrita en todas sus formas) y RT-03 (el reconocimiento de filas omitidas de un
 * CSV pertenece a esa vista previa). RT-02 se prueba en `src/state/replaceUndo.test.ts`.
 */
type Stored = { transactions: { id: string; amountMinor: number; currency: string; note?: string }[] }
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
