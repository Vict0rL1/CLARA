import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import type { PeriodBudget, Transaction } from '../../src/domain/types'
import { baseData, EARLIER, tx } from '../../src/test/fixtures'
import { available, expectNoHorizontalScroll, go, openApp, seedStoredData, storedData } from './helpers'
import { addFakeCapture, asNativeApp, fakeCaptureQueue, nativeFile, seedNativeData } from './nativeShell'

/**
 * Decisión 181: tasas del Banco de Canadá (Valet) con la red SIMULADA (`page.route`), nunca la real. La respuesta tiene
 * la forma exacta de una real guardada (`src/domain/__fixtures__/boc/`), con observaciones de septiembre: el viernes
 * 25-sep 0.009230 y nada el fin de semana. Hoy lunes 28-sep (la del día aún no está publicada), así que vale la del 25:
 *   ¥1 200 × 0,00923 = 11,076 → 11,08 $        1 000,00 − 11,08 = 988,92
 */
const VALET = 'https://www.bankofcanada.ca/valet/**'
const real = JSON.parse(readFileSync(new URL('../../src/domain/__fixtures__/boc/FXJPYCAD-2026-11-04_2026-11-10.json', import.meta.url), 'utf8')) as { observations: unknown[] }
const september = JSON.stringify({
  ...real,
  observations: [
    { d: '2026-09-24', FXJPYCAD: { v: '0.009190' } },
    { d: '2026-09-25', FXJPYCAD: { v: '0.009230' } },
  ],
})

/** Simula Valet; `mode` se puede cambiar durante la prueba. Apunta cada dirección pedida y sus cabeceras. */
async function fakeValet(page: Page) {
  const state = { mode: 'ok' as 'ok' | 'offline', requests: [] as { url: string; headers: Record<string, string> }[] }
  await page.route(VALET, async (route: Route) => {
    state.requests.push({ url: route.request().url(), headers: route.request().headers() })
    if (state.mode === 'offline') return route.abort('internetdisconnected')
    return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', headers: { 'access-control-allow-origin': '*' }, body: september })
  })
  return state
}

const stored = async (page: Page) => JSON.parse((await storedData(page))!) as { transactions: Transaction[] }

test('formulario: apagado no pide nada; encendido usa la tasa del banco con su aviso; sin conexión no hay tasa y no se guarda', async ({ page }) => {
  const valet = await fakeValet(page)
  await seedStoredData(page, baseData())
  // La versión compilada abre SOLO ese origen en connect-src.
  expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')).toContain("connect-src 'self' https://www.bankofcanada.ca;")

  // Apagado (por defecto): ni botón ni peticiones.
  await go(page, '/movimientos/nuevo')
  const section = page.getByTestId('foreign-amount')
  await section.getByRole('switch', { name: 'Pagado en otra moneda' }).click()
  await page.getByLabel('Moneda en que pagaste').selectOption('JPY')
  await expect(section.getByText('Importe en JPY')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Usar la tasa del Banco de Canadá' })).toHaveCount(0)

  // Ajustes › Formato › Tasas del Banco de Canadá.
  await go(page, '/ajustes/formato')
  const setting = page.getByTestId('boc-setting')
  await expect(setting).toContainText('nada tuyo (ni importes, ni comercios, ni cuentas)')
  await expect(setting).toContainText('Fuente: Banco de Canadá')
  const toggle = setting.getByRole('switch', { name: 'Pedir tasas al Banco de Canadá' })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expectNoHorizontalScroll(page, 'ajuste del Banco de Canadá')
  expect((await new AxeBuilder({ page }).include('[data-testid="boc-setting"]').analyze()).violations).toEqual([])
  expect(valet.requests).toEqual([])

  // Encendido: el botón pide la tasa de la fecha del gasto y la pone en el campo.
  await go(page, '/movimientos/nuevo')
  await section.getByRole('switch', { name: 'Pagado en otra moneda' }).click()
  await page.getByLabel('Moneda en que pagaste').selectOption('JPY')
  await page.getByLabel('Importe en JPY').fill('1200')
  await page.getByRole('button', { name: 'Usar la tasa del Banco de Canadá' }).click()
  await expect(page.getByLabel('Tasa: CAD por 1 JPY')).toHaveValue('0.00923')
  await expect(page.getByLabel('Fecha de la tasa')).toHaveValue('2026-09-25')
  await expect(section).toContainText(/Tasa indicativa del Banco de Canadá del .*25/)
  await expect(page.getByTestId('foreign-result')).toContainText('× 0.00923 = $11.08')
  expect(valet.requests.map((r) => r.url)).toEqual(['https://www.bankofcanada.ca/valet/observations/FXJPYCAD/json?start_date=2026-09-18&end_date=2026-09-28'])
  // Nada de la persona: ni cookies ni Referer.
  expect(valet.requests[0]!.headers.cookie).toBeUndefined()
  expect(valet.requests[0]!.headers.referer).toBeUndefined()
  await expectNoHorizontalScroll(page, 'tasa del banco en el formulario')
  expect((await new AxeBuilder({ page }).include('[data-testid="foreign-amount"]').analyze()).violations).toEqual([])
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(await available(page)).toHaveText('$988.92')
  const saved = (await stored(page)).transactions
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({ amountMinor: 1108, original: { currency: 'JPY', amountMinor: 1200, rate: '0.00923', rateDate: '2026-09-25', rateSource: 'boc' } })

  // Al editarlo, el aviso sigue; si se cambia la tasa a mano, deja de ser la del banco.
  await go(page, `/movimientos/editar/${saved[0]!.id}`)
  await expect(section).toContainText(/Tasa indicativa del Banco de Canadá del .*25/)
  await page.getByLabel('Tasa: CAD por 1 JPY').fill('0.0093')
  await expect(section).not.toContainText('Tasa indicativa del Banco de Canadá')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  // ¥1 200 × 0,0093 = 11,16 $
  await expect(await available(page)).toHaveText('$988.84')
  expect((await stored(page)).transactions[0]).toMatchObject({ amountMinor: 1116, original: { rate: '0.0093', rateSource: 'manual' } })

  // Sin conexión: se dice, el campo queda vacío y no se guarda nada.
  valet.mode = 'offline'
  await go(page, '/movimientos/nuevo')
  await section.getByRole('switch', { name: 'Pagado en otra moneda' }).click()
  await page.getByLabel('Moneda en que pagaste').selectOption('JPY')
  await page.getByLabel('Importe en JPY').fill('500')
  await page.getByRole('button', { name: 'Usar la tasa del Banco de Canadá' }).click()
  await expect(page.getByTestId('boc-status')).toHaveText('No se pudo conectar con el Banco de Canadá: no hay tasa. Escribe la tasa o usa lo que cobró el banco.')
  await expect(page.getByLabel('Tasa: CAD por 1 JPY')).toHaveValue('')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(section.locator('.field__error').first()).toBeVisible()
  await expect(page.getByTestId('foreign-result')).toHaveCount(0)
  expect((await stored(page)).transactions).toHaveLength(1)
})

test('con presupuesto en otra moneda el interruptor no se ofrece y se dice por qué', async ({ page }) => {
  const data = baseData()
  await seedStoredData(page, { ...data, settings: { ...data.settings, currency: 'USD' }, accounts: data.accounts.map((a) => ({ ...a, currency: 'USD' })) })
  await go(page, '/ajustes/formato')
  await expect(page.getByTestId('boc-only-cad')).toHaveText('Solo con un presupuesto en dólares canadienses: el banco publica sus tasas en CAD y tu presupuesto es en USD.')
  await expect(page.getByTestId('boc-setting').getByRole('switch')).toHaveCount(0)
})

test('app: una captura en yenes entra convertida con la tasa del banco; sin conexión queda como propuesta y se registra después', async ({ page }) => {
  const valet = await fakeValet(page)
  await asNativeApp(page)
  await openApp(page)
  await page.evaluate(() => localStorage.setItem('clara.boc.v1', JSON.stringify({ enabled: true })))
  await addFakeCapture(page, { captureId: 'cap-y0000001', createdAt: '2026-09-28T15:00:00Z', origin: 'apple_pay', rawAmount: '1200', currencyHint: 'JPY', merchant: 'Lawson' }, false)
  await seedNativeData(page, baseData())
  await expect(await available(page)).toHaveText('$988.92')
  await expect.poll(() => fakeCaptureQueue(page)).toBe('')
  const data = JSON.parse((await nativeFile(page, 'data'))!.text) as { transactions: Transaction[] }
  expect(data.transactions[0]).toMatchObject({ id: 'cap-y0000001', amountMinor: 1108, original: { rate: '0.00923', rateDate: '2026-09-25', rateSource: 'boc' }, review: { needed: true, reason: 'currency' } })
  expect(valet.requests).toHaveLength(1)

  await go(page, '/pendientes')
  const review = page.getByTestId('capture-review')
  await expect(review.locator('article', { hasText: 'Lawson' })).toContainText('Pagado ¥1,200 JPY. Convertido con la tasa indicativa del Banco de Canadá del 25 sep (0.00923).')

  // Sin conexión: el siguiente pago queda como propuesta (no cuenta) y la cola se vacía igual.
  valet.mode = 'offline'
  await addFakeCapture(page, { captureId: 'cap-y0000002', createdAt: '2026-09-28T15:30:00Z', origin: 'apple_pay', rawAmount: '500', currencyHint: 'JPY', merchant: 'FamilyMart' })
  const family = review.locator('article', { hasText: 'FamilyMart' })
  await expect(family).toContainText('Propuesta · no cuenta')
  await expect.poll(() => fakeCaptureQueue(page)).toBe('')
  await family.getByRole('button', { name: 'Pedir la tasa del Banco de Canadá' }).click()
  await expect(family).toContainText('No se pudo conectar con el Banco de Canadá: no hay tasa.')

  // Con conexión otra vez: ¥500 × 0,00923 = 4,615 → 4,62 $ (la mitad, hacia arriba).
  valet.mode = 'ok'
  await family.getByRole('button', { name: 'Pedir la tasa del Banco de Canadá' }).click()
  await expect(family).toContainText('Con la tasa indicativa del Banco de Canadá del 25 sep (0.00923): $4.62.')
  await expectNoHorizontalScroll(page, 'propuesta con la tasa del banco')
  expect((await new AxeBuilder({ page }).include('[data-testid="capture-review"]').analyze()).violations).toEqual([])
  await family.getByRole('button', { name: 'Registrar con esta tasa' }).click()
  await expect(family).toHaveCount(0)
  // 988,92 − 4,62 = 984,30
  await expect(await available(page)).toHaveText('$984.30')
  const after = JSON.parse((await nativeFile(page, 'data'))!.text) as { transactions: Transaction[] }
  expect(after.transactions.find((t) => t.id === 'cap-y0000002')).toMatchObject({ amountMinor: 462, original: { rate: '0.00923', rateDate: '2026-09-25', rateSource: 'boc' } })
})

test('vista del viaje: dice cuántos movimientos se convirtieron con la tasa del banco', async ({ page }) => {
  const yen = tx({ id: 'tx-boc00001', amountMinor: 1108, merchant: 'Lawson', original: { currency: 'JPY', amountMinor: 1200, rate: '0.00923', rateDate: '2026-09-25', rateSource: 'boc' } })
  const trip: PeriodBudget = {
    id: 'japon',
    name: 'Japón',
    template: 'trip',
    startDate: '2026-09-25',
    endDate: '2026-10-04',
    allocatedMinor: 50000,
    currency: 'CAD',
    txIds: [yen.id],
    archived: false,
    trip: { currencies: ['JPY'], localCurrency: 'JPY', rates: [] },
    createdAt: EARLIER,
    updatedAt: EARLIER,
  }
  await seedStoredData(page, baseData({ transactions: [yen], periodBudgets: [trip] }))
  await go(page, '/plan/periodos/japon')
  const card = page.getByTestId('trip-card')
  await expect(page.getByTestId('trip-total')).toHaveText('Total en CAD: $11.08')
  await expect(page.getByTestId('trip-boc')).toHaveText('1 movimiento se convirtió con la tasa indicativa del Banco de Canadá de su fecha.')
  await expectNoHorizontalScroll(page, 'viaje con tasa del banco')
  expect((await new AxeBuilder({ page }).include('[data-testid="trip-card"]').analyze()).violations).toEqual([])
  await expect(card).toContainText('JPY: sin tasa')
})
