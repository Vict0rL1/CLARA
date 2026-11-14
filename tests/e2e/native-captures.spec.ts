import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { account, baseData } from '../../src/test/fixtures'
import { available, expectNoHorizontalScroll, go, openApp, startDemo, waitForSaved } from './helpers'
import { addFakeCapture, asNativeApp, fakeCaptureQueue, nativeFile, seedNativeData } from './nativeShell'

/**
 * Fase 2 en la app simulada (`nativeShell.ts`): la cola que deja la acción «Registrar pago en Clara» entra en los datos
 * al abrir, al volver a la app y cuando la acción avisa con la app abierta; solo después de guardar se vacía. Ajustes ›
 * Captura automática solo existe en la app. El Swift (la acción, la cola en disco) no se prueba aquí: eso es Xcode.
 *
 * Saldo de referencia 1 000,00 escrito el 28-sep a las 13:00Z; los pagos de las 15:00Z en adelante ya restan.
 */
const pay = (captureId: string, extra: Record<string, unknown> = {}) => ({
  captureId,
  createdAt: '2026-09-28T15:00:00Z',
  origin: 'apple_pay',
  rawAmount: '4.25',
  currencyHint: 'CAD',
  merchant: 'Tim Hortons',
  card: 'Visa ••1234',
  ...extra,
})

const stored = async (page: Parameters<typeof nativeFile>[0]) => JSON.parse((await nativeFile(page, 'data'))!.text) as ReturnType<typeof baseData>

test('los pagos que esperaban en la cola entran al abrir la app, la cola se vacía tras guardar y reabrir no duplica', async ({ page }) => {
  await asNativeApp(page)
  await openApp(page)
  await addFakeCapture(page, pay('cap-a0000001'), false)
  await addFakeCapture(page, pay('cap-u0000001', { rawAmount: '12.5', currencyHint: 'USD', merchant: 'Amazon', createdAt: '2026-09-28T15:20:00Z' }), false)
  await seedNativeData(page, baseData())
  // 1 000 − 4,25: el de USD queda como propuesta y no cuenta.
  await expect(await available(page)).toHaveText('$995.75')
  await expect.poll(() => fakeCaptureQueue(page)).toBe('')
  await go(page, '/pendientes')
  await expect(page.getByTestId('capture-review').getByRole('heading', { name: 'Por revisar (2)' })).toBeVisible()

  await waitForSaved(page)
  await page.reload()
  await expect(await available(page)).toHaveText('$995.75')
  const data = await stored(page)
  expect(data.transactions.map((t) => [t.id, t.amountMinor, t.source, t.review?.reason])).toEqual([['cap-a0000001', 425, 'apple_pay', 'auto_capture']])
  expect(data.captures!.proposals.map((p) => [p.captureId, p.reason])).toEqual([['cap-u0000001', 'currency']])
})

test('con la app abierta, el aviso de la acción hace entrar el pago enseguida; volver a primer plano también lee la cola', async ({ page }) => {
  await asNativeApp(page)
  await openApp(page)
  await seedNativeData(page, baseData())
  await expect(await available(page)).toHaveText('$1,000.00')
  await addFakeCapture(page, pay('cap-a0000001'))
  await expect(page.getByTestId('available')).toHaveText('$995.75')
  // Sin aviso (la acción corrió con Clara en segundo plano): al volver, Capacitor envía «resume».
  await addFakeCapture(page, pay('cap-b0000001', { rawAmount: '18.40', merchant: 'Metro', createdAt: '2026-09-28T15:30:00Z' }), false)
  await page.evaluate(() => document.dispatchEvent(new Event('resume')))
  await expect(page.getByTestId('available')).toHaveText('$977.35')
  await expect.poll(() => fakeCaptureQueue(page)).toBe('')
})

test('con los datos de demostración no se importa nada: los pagos esperan en la cola', async ({ page }) => {
  await asNativeApp(page)
  await startDemo(page)
  await addFakeCapture(page, pay('cap-a0000001'))
  await page.evaluate(() => document.dispatchEvent(new Event('resume')))
  await waitForSaved(page)
  expect(await fakeCaptureQueue(page)).toContain('cap-a0000001')
  expect((await stored(page)).transactions.some((t) => t.id === 'cap-a0000001')).toBe(false)
})

test('Ajustes › Captura automática: solo en la app; apagar «Guardar automáticamente», tarjeta → cuenta y «Probar»', async ({ page }) => {
  await asNativeApp(page)
  await openApp(page)
  await seedNativeData(page, baseData({ accounts: [account({ id: 'main', name: 'Principal' }), account({ id: 'visa', name: 'Visa', kind: 'credit', anchor: { amountMinor: 0, date: '2026-09-28', setAt: '2026-09-28T13:00:00.000Z' } })] }))
  await go(page, '/ajustes')
  await page.getByTestId('settings-row-captura').click()
  const section = page.locator('.card', { has: page.getByRole('heading', { name: 'Captura automática' }) })
  await expect(section.getByText('Cómo activarlo en tu iPhone')).toBeVisible()
  await expectNoHorizontalScroll(page, 'captura automática')
  expect((await new AxeBuilder({ page }).include('.card').analyze()).violations).toEqual([])

  await section.getByRole('switch', { name: 'Guardar automáticamente' }).click()
  await waitForSaved(page)
  await section.getByLabel('Nombre de la tarjeta').fill('Visa ••1234')
  await section.getByLabel('Cuenta de la tarjeta nueva').selectOption('visa')
  await section.getByRole('button', { name: 'Añadir tarjeta' }).click()
  await expect(section.getByLabel('Cuenta de Visa ••1234')).toHaveValue('visa')
  await section.getByLabel('Nombre de la tarjeta').fill('visa ••1234')
  await section.getByRole('button', { name: 'Añadir tarjeta' }).click()
  await expect(section.getByText('Esa tarjeta ya está en la lista.')).toBeVisible()
  await waitForSaved(page)
  expect((await stored(page)).settings.capture).toEqual({ autoSave: false, cardAccounts: [{ card: 'Visa ••1234', accountId: 'visa' }] })

  // Apagado: un pago con esa tarjeta queda como propuesta en su cuenta y no cuenta.
  await addFakeCapture(page, pay('cap-a0000001'))
  await expect.poll(async () => (await stored(page)).captures?.proposals.map((p) => [p.captureId, p.reason, p.accountId])).toEqual([['cap-a0000001', 'auto_capture', 'visa']])
  expect((await stored(page)).transactions).toEqual([])

  // «Probar»: la prueba recorre la cola y aparece como «Prueba» en Pendientes.
  await section.getByTestId('capture-test').click()
  await expect(section.getByText('Funciona: la prueba está en Pendientes › Por revisar.')).toBeVisible()
  await go(page, '/pendientes')
  await expect(page.getByTestId('capture-review').locator('article', { hasText: 'Prueba de Clara' })).toContainText('Prueba')
  expect(await fakeCaptureQueue(page)).toBe('')
})

test('en el navegador no hay «Captura automática»: ni en el índice ni por enlace directo', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes')
  await expect(page.getByTestId('settings-row-safe-to-spend')).toBeVisible()
  await expect(page.getByTestId('settings-row-captura')).toHaveCount(0)
  await go(page, '/ajustes/captura')
  await expect(page.getByRole('heading', { name: 'Captura automática' })).toHaveCount(0)
  await expect(page.getByTestId('settings-row-safe-to-spend')).toBeVisible()
})
