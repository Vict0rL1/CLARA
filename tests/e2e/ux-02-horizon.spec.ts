import { expect, test, type Page } from '@playwright/test'
import { openApp, openExplain, storedData } from './helpers'

/**
 * UX-02 (auditoría 2026-10-12): el resumen de la configuración describe el horizonte que de verdad usó
 * el cálculo. Reproducción del informe: 11-oct-2026 en America/Vancouver, presupuesto nuevo en CAD,
 * periodo mensual, saldo 2 000, sin fecha de ingreso, sin pagos y apartado de 300. Importes ficticios.
 */
test.use({ timezoneId: 'America/Vancouver' })
const OCT_11 = new Date('2026-10-11T12:00:00-07:00')
const HORIZON_SELECT = '¿Para cuántos días quieres repartir tu dinero?'

async function startSetup(page: Page, balance: string, time = OCT_11) {
  await openApp(page, time)
  await page.getByRole('button', { name: 'Configurar con mis datos' }).click()
  await expect(page.getByRole('heading', { name: 'Tus categorías' })).toBeVisible()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByLabel('Saldo disponible').fill(balance)
}

async function reserveAndSummary(page: Page, reserve: string) {
  await page.getByRole('button', { name: 'Continuar' }).click() // pagos próximos: ninguno
  await page.getByLabel('Cantidad reservada').fill(reserve)
  await page.getByRole('button', { name: 'Ver resumen' }).click()
  await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible()
}

async function storedSettings(page: Page) {
  return (JSON.parse((await storedData(page))!) as { settings: { fallbackHorizonDays: number | null; budgetPeriod: { type: string } } }).settings
}

test('periodo mensual sin fecha de ingreso: el resumen explica los 21 días que quedan de octubre, no «14 días»', async ({ page }) => {
  await startSetup(page, '2000')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByRole('radio', { name: 'No tengo fecha' }).check()
  // Con un periodo de calendario el selector de días no decide nada: se explica en su lugar.
  await expect(page.getByLabel(HORIZON_SELECT)).toHaveCount(0)
  await expect(page.getByTestId('setup-period-instead')).toContainText('Con el periodo «Mensual»')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await reserveAndSummary(page, '300')

  // 2 000 − 300 = 1 700 en los 21 días que quedan (11 al 31 de octubre, hoy incluido): 80,95 por día.
  await expect(page.locator('.hero__value')).toHaveText('$1,700.00')
  await expect(page.locator('.hero__sub')).toHaveText('octubre de 2026 · quedan 21 días')
  await expect(page.locator('.calc')).toContainText('$80.95')
  const note = page.getByTestId('setup-provisional-income')
  await expect(note).toContainText('usa tu periodo (octubre de 2026)')
  await expect(note).toContainText(/31 de oct/)
  await expect(note).toContainText('quedan 21 días')
  await expect(page.getByText(/14 días/)).toHaveCount(0)

  // Inicio y su explicación cuentan lo mismo; el valor de respaldo no se guarda porque nunca se eligió.
  await page.getByRole('button', { name: 'Empezar a usar Clara' }).click()
  await expect(page.getByTestId('available')).toHaveText('$1,700.00')
  await expect(page.locator('.hero__sub')).toContainText('quedan 21 días')
  await expect(page.locator('.stat__value').first()).toHaveText('$80.95')
  await openExplain(page)
  await expect(page.locator('.hero .explain')).toContainText('El periodo va del')
  await expect(page.locator('.hero .explain')).toContainText('quedan 21 días')
  await expect(page.locator('.hero .explain')).not.toContainText('horizonte que elegiste')
  const settings = await storedSettings(page)
  expect(settings.budgetPeriod.type).toBe('month')
  expect(settings.fallbackHorizonDays).toBeNull()
})

test('«hasta mi próximo ingreso» sin fecha: los 14 días elegidos sí rigen y se explican con su fecha final', async ({ page }) => {
  await startSetup(page, '2000')
  await page.getByLabel('Periodo del presupuesto').selectOption({ label: 'Hasta mi próximo ingreso' })
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByRole('radio', { name: 'No tengo fecha' }).check()
  await expect(page.getByLabel(HORIZON_SELECT)).toHaveValue('14')
  await expect(page.getByTestId('setup-period-instead')).toHaveCount(0)
  await page.getByRole('button', { name: 'Continuar' }).click()
  await reserveAndSummary(page, '300')

  // 1 700 / 14 = 121,428… → 121,42 (truncado en unidades menores). El día 14 (25-oct) no cuenta.
  await expect(page.locator('.hero__value')).toHaveText('$1,700.00')
  await expect(page.locator('.hero__sub')).toContainText('14 días')
  await expect(page.locator('.hero__sub')).toContainText(/25 de oct/)
  await expect(page.locator('.calc')).toContainText('$121.42')
  const note = page.getByTestId('setup-provisional-income')
  await expect(note).toContainText('se reparte en 14 días')
  await expect(note).toContainText(/25 de oct/)
  await expect(page.getByText(/quedan 21 días/)).toHaveCount(0)

  await page.getByRole('button', { name: 'Empezar a usar Clara' }).click()
  await expect(page.getByTestId('available')).toHaveText('$1,700.00')
  await expect(page.locator('.stat__value').first()).toHaveText('$121.42')
  await openExplain(page)
  await expect(page.locator('.hero .explain')).toContainText('usamos el horizonte que elegiste')
  expect((await storedSettings(page)).fallbackHorizonDays).toBe(14)
})

test('con fecha de ingreso conocida: el mensual sigue describiendo el calendario y «hasta mi próximo ingreso» termina ese día', async ({ page }) => {
  // Mensual + ingreso el 24-oct: el periodo sigue siendo octubre; el ingreso futuro no se suma.
  await startSetup(page, '2000')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByLabel('Importe esperado').fill('500')
  await page.getByLabel('Fecha del próximo ingreso').fill('2026-10-24')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await reserveAndSummary(page, '300')
  await expect(page.locator('.hero__value')).toHaveText('$1,700.00')
  await expect(page.locator('.hero__sub')).toHaveText('octubre de 2026 · quedan 21 días')
  await expect(page.locator('.calc')).toContainText('$80.95')
  await expect(page.getByTestId('setup-provisional-income')).toHaveCount(0)
  await expect(page.getByText(/Sin fecha de próximo ingreso/)).toHaveCount(0)

  // «Hasta mi próximo ingreso» + ingreso el 24-oct: 13 días (el día del ingreso no cuenta).
  await startSetup(page, '2000')
  await page.getByLabel('Periodo del presupuesto').selectOption({ label: 'Hasta mi próximo ingreso' })
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByLabel('Importe esperado').fill('500')
  await page.getByLabel('Fecha del próximo ingreso').fill('2026-10-24')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await reserveAndSummary(page, '300')
  await expect(page.locator('.hero__value')).toHaveText('$1,700.00')
  await expect(page.locator('.hero__sub')).toContainText('hasta tu próximo ingreso')
  await expect(page.locator('.hero__sub')).toContainText('13 días')
  await expect(page.locator('.calc')).toContainText('$130.76') // 1 700 / 13 truncado
  await expect(page.getByTestId('setup-provisional-income')).toHaveCount(0)
})

test('último día del mes: queda 1 día y todo lo disponible es el importe del día', async ({ page }) => {
  await startSetup(page, '2000', new Date('2026-10-31T12:00:00-07:00'))
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByRole('radio', { name: 'No tengo fecha' }).check()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await reserveAndSummary(page, '300')
  await expect(page.locator('.hero__sub')).toHaveText('octubre de 2026 · quedan 1 día')
  await expect(page.getByTestId('setup-provisional-income')).toContainText('quedan 1 día')
  await expect(page.locator('.calc')).toContainText('$1,700.00')
})

test('en inglés el resumen cuenta lo mismo: 21 days left, sin «14-day»', async ({ page }) => {
  await openApp(page, OCT_11)
  await page.getByRole('radio', { name: 'English' }).check()
  await page.getByRole('button', { name: 'Set up with my data' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Available balance').fill('2000')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('radio', { name: 'I don’t have a date' }).check()
  await expect(page.getByTestId('setup-period-instead')).toContainText('With the “Monthly” period')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Reserved amount').fill('300')
  await page.getByRole('button', { name: 'See summary' }).click()
  await expect(page.locator('.hero__value')).toHaveText('$1,700.00')
  await expect(page.locator('.hero__sub')).toContainText('21 days left')
  await expect(page.getByTestId('setup-provisional-income')).toContainText('21 days left')
  await expect(page.getByText(/14-day|14 days/)).toHaveCount(0)
})
