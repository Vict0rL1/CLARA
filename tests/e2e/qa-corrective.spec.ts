import { expect, test, type Page } from '@playwright/test'
import { go, reloadWhenSaved, startDemo, storedData } from './helpers'
import { tinyPng } from './png'

/**
 * Auditoría independiente 2026-10-19, pasada correctiva (aceptación de navegador). P1: una moneda no admitida separada
 * del importe por puntuación («coffee (RUB) 10», «TOTAL RUB: 10.00») se ve, bloquea el registro (también por teclado y
 * con un clic forzado: nada guardado cambia) y solo una corrección manual permite registrar en CAD, que sobrevive a
 * recargar. P2: «PEN 2.99 TAX 0.10» es un artículo: el recibo propone 3.09 CAD sin conflicto y se registra. Recibos
 * = texto OCR sintético (un `TextDetector` falso); nada de esto prueba OCR ni cámara reales. Datos de demostración.
 */
type Stored = { transactions: { id: string; amountMinor: number; currency: string; note?: string }[] }
const stored = async (page: Page) => JSON.parse((await storedData(page)) ?? '{}') as Stored

async function fakeTextDetector(page: Page, lines: readonly string[]) {
  await page.addInitScript((ls) => {
    ;(window as unknown as { TextDetector: unknown }).TextDetector = class {
      async detect() {
        return ls.map((rawValue, i) => ({ rawValue, boundingBox: { x: 0, y: i * 20, width: 200, height: 16 } }))
      }
    }
  }, lines)
}

/** La línea está bloqueada: el error se ve, «Registrar» está desactivado y ni Enter ni un clic forzado cambian lo guardado. */
async function expectBlocked(page: Page, line: ReturnType<Page['locator']>, field: string, message: string | RegExp) {
  await expect(line.getByLabel('Importe')).toHaveValue(field)
  await expect(line.getByText(message)).toBeVisible()
  await expect(page.getByTestId('assistant-currency-blocked')).toContainText('1 línea está en otra moneda')
  const register = page.getByRole('button', { name: 'Registrar 1 movimiento' })
  await expect(register).toBeDisabled()
  // Intentos de registrar por teclado (Enter en el campo) y con un clic forzado sobre el botón desactivado: nada
  // guardado cambia (se compara el almacenamiento entero antes y después).
  const before = await storedData(page)
  await line.getByLabel('Importe').focus()
  await page.keyboard.press('Enter')
  await register.click({ force: true })
  await expect(page.getByText(/movimiento registrado/)).toHaveCount(0)
  await expect(register).toBeDisabled()
  expect(await storedData(page)).toBe(before)
}

/** Corrección manual: solo el número → se registra en CAD y sigue ahí tras recargar. */
async function correctAndRegister(page: Page, line: ReturnType<Page['locator']>, amount: string, minor: number) {
  await line.getByLabel('Importe').fill(amount)
  await expect(page.getByTestId('assistant-currency-blocked')).toHaveCount(0)
  const register = page.getByRole('button', { name: 'Registrar 1 movimiento' })
  await expect(register).toBeEnabled()
  await register.click()
  await expect(page.getByText('1 movimiento registrado').first()).toBeVisible()
  await reloadWhenSaved(page)
  await expect(page.getByTestId('available')).toBeVisible()
  const saved = (await stored(page)).transactions.filter((t) => t.amountMinor === minor)
  expect(saved.length).toBeGreaterThanOrEqual(1)
  expect(saved.every((t) => t.currency === 'CAD')).toBe(true)
}

const RUB_MESSAGE = '«RUB» no es una moneda conocida. Escribe solo el número.'

for (const text of ['coffee (RUB) 10', 'coffee RUB: 10']) {
  test(`P1 · asistente: «${text}» se conserva como 10.00 RUB, bloquea el registro y solo corregido a mano se guarda en CAD`, async ({ page }) => {
    await startDemo(page)
    await go(page, '/asistente')
    await page.getByLabel('Texto').fill(text)
    await page.getByRole('button', { name: 'Analizar' }).click()
    const line = page.getByTestId('assistant-preview').locator('.assistant__line').first()
    await expect(line).toBeVisible()
    await expectBlocked(page, line, '10.00 RUB', RUB_MESSAGE)
    await correctAndRegister(page, line, '10', 1000)
  })
}

test('P1 · asistente: «coffee (RUB) $10» tiene dos monedas que se contradicen: el campo conserva las dos y la línea se bloquea', async ({ page }) => {
  await startDemo(page)
  await go(page, '/asistente')
  await page.getByLabel('Texto').fill('coffee (RUB) $10')
  await page.getByRole('button', { name: 'Analizar' }).click()
  const line = page.getByTestId('assistant-preview').locator('.assistant__line').first()
  await expectBlocked(page, line, 'RUB 10.00 $', /El importe tiene dos monedas distintas \(RUB y \$\)/)
  await correctAndRegister(page, line, '10', 1000)
})

for (const total of ['TOTAL RUB: 10.00', 'TOTAL (RUB) 10.00']) {
  test(`P1 · foto (OCR sintético): «${total}» propone 10.00 RUB y bloquea; corregida, se registra en CAD`, async ({ page }) => {
    await fakeTextDetector(page, ['SHOP', total])
    await startDemo(page)
    await go(page, '/asistente')
    await page.getByTestId('photo-input').setInputFiles({ name: 'recibo.png', mimeType: 'image/png', buffer: tinyPng(8) })
    const line = page.getByTestId('assistant-preview').locator('.assistant__line').first()
    await expect(line).toBeVisible()
    await expectBlocked(page, line, '10.00 RUB', RUB_MESSAGE)
    await correctAndRegister(page, line, '10', 1000)
  })
}

for (const lines of [
  ['SHOP', 'PEN 2.99 TAX 0.10', 'TOTAL CAD 3.09'],
  ['SHOP', 'PEN 2.99 TAX 0.10', 'TOTAL 3.09'],
] as const) {
  test(`P2 · foto (OCR sintético): «${lines[1]}» con «${lines[2]}» propone 3.09 en CAD sin conflicto y se registra`, async ({ page }) => {
    await fakeTextDetector(page, lines)
    await startDemo(page)
    await go(page, '/asistente')
    await page.getByTestId('photo-input').setInputFiles({ name: 'recibo.png', mimeType: 'image/png', buffer: tinyPng(8) })
    const line = page.getByTestId('assistant-preview').locator('.assistant__line').first()
    await expect(line.getByLabel('Importe')).toHaveValue('3.09')
    await expect(page.getByTestId('assistant-currency-blocked')).toHaveCount(0)
    await expect(line.getByText(/No se convierte/)).toHaveCount(0)
    const register = page.getByRole('button', { name: 'Registrar 1 movimiento' })
    await expect(register).toBeEnabled()
    await register.click()
    await expect(page.getByText('1 movimiento registrado').first()).toBeVisible()
    await reloadWhenSaved(page)
    await expect(page.getByTestId('available')).toBeVisible()
    expect((await stored(page)).transactions.find((t) => t.amountMinor === 309)).toMatchObject({ currency: 'CAD' })
  })
}

test('P2 · control (OCR sintético): «TOTAL PEN 10.00» sigue bloqueado como moneda extranjera', async ({ page }) => {
  await fakeTextDetector(page, ['SHOP', 'PEN 2.99 TAX 0.10', 'TOTAL PEN 10.00'])
  await startDemo(page)
  await go(page, '/asistente')
  await page.getByTestId('photo-input').setInputFiles({ name: 'recibo.png', mimeType: 'image/png', buffer: tinyPng(8) })
  const line = page.getByTestId('assistant-preview').locator('.assistant__line').first()
  await expectBlocked(page, line, '10.00 PEN', 'El importe está en PEN; este presupuesto usa CAD. No se convierte.')
})
