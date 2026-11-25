import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { baseData } from '../../src/test/fixtures'
import { available, expectNoHorizontalScroll, go, openApp, waitForSaved } from './helpers'
import { addFakeCapture, asNativeApp, fakeCaptureQueue, nativeFile, requestFakeScreen, seedFakeScreen, seedNativeData } from './nativeShell'

/**
 * Fase 4 en la app simulada (`nativeShell.ts`): un aviso del banco que llega SOLO con su texto («Registrar desde
 * texto»), «Probar un aviso» en Ajustes y «Nuevo gasto en Clara» (que abre el formulario). El Swift (las acciones, la
 * cola en disco, el control) no se prueba aquí: eso es Xcode y el iPhone.
 *
 * El aviso de estas pruebas es inventado y no imita a ningún banco: sin ejemplos reales, Clara no conoce ningún
 * formato y todo aviso queda como propuesta. Saldo de referencia 1 000,00 escrito el 28-sep a las 13:00Z.
 */
const SMS = 'Aviso de prueba: compra de $4.25 en TIENDA DE PRUEBA con la tarjeta ••1234'
const alert = (captureId: string, rawText = SMS) => ({ captureId, createdAt: '2026-09-28T15:00:00Z', origin: 'bank_text', rawText })
const stored = async (page: Parameters<typeof nativeFile>[0]) => JSON.parse((await nativeFile(page, 'data'))!.text) as ReturnType<typeof baseData>

test('un aviso del banco sin formato conocido: propuesta con su texto y el importe sugerido; registrarlo no guarda el texto', async ({ page }) => {
  await asNativeApp(page)
  await openApp(page)
  await seedNativeData(page, baseData())
  await addFakeCapture(page, alert('cap-sms00001'))
  await expect.poll(async () => (await stored(page)).captures?.proposals.map((p) => [p.captureId, p.reason, p.origin])).toEqual([['cap-sms00001', 'unparsed', 'bank_text']])
  // No cuenta: el disponible sigue igual y la cola ya se vació.
  expect((await stored(page)).transactions).toEqual([])
  expect(await fakeCaptureQueue(page)).toBe('')

  await go(page, '/pendientes')
  const card = page.getByTestId('capture-review').locator('article', { hasText: 'Aviso del banco' })
  await expect(card).toContainText('Clara todavía no conoce el formato de este aviso y no adivina')
  await expect(card).toContainText(`Texto del aviso: ${SMS}`)
  const amount = card.getByLabel('Importe en CAD')
  await expect(amount).toHaveValue('4.25')
  await expect(card).toContainText('Importe sugerido a partir del texto del aviso: compruébalo antes de registrar.')
  await expectNoHorizontalScroll(page, 'aviso del banco por revisar')
  expect((await new AxeBuilder({ page }).include('[data-testid="capture-review"]').analyze()).violations).toEqual([])

  await card.getByRole('button', { name: 'Registrar', exact: true }).click()
  await waitForSaved(page)
  const data = await stored(page)
  expect(data.transactions.map((t) => [t.id, t.amountMinor, t.source, t.review])).toEqual([['cap-sms00001', 425, 'bank_text', undefined]])
  expect(data.captures?.proposals).toEqual([])
  // El texto del aviso ya no está en ningún sitio: ni en el movimiento ni en el historial.
  expect((await nativeFile(page, 'data'))!.text).not.toContain('TIENDA DE PRUEBA')
  await expect(await available(page)).toHaveText('$995.75')
})

test('Ajustes › Captura automática: guía de los avisos por SMS, «Probar un aviso» (no guarda nada) y «Nuevo gasto en un toque»', async ({ page }) => {
  await asNativeApp(page)
  await openApp(page)
  await seedNativeData(page, baseData())
  await go(page, '/ajustes/captura')
  const section = page.locator('.card', { has: page.getByRole('heading', { name: 'Captura automática' }) })
  await expect(section.getByRole('heading', { name: 'Avisos del banco por SMS' })).toBeVisible()
  await expect(section.getByTestId('capture-sms-state')).toHaveText(/Por ahora Clara no conoce el formato de ningún banco/)
  await expect(section).toContainText('«Registrar desde texto en Clara»')
  await expect(section.getByRole('heading', { name: 'Nuevo gasto en un toque' })).toBeVisible()
  await expect(section).toContainText('Tocar atrás: Ajustes › Accesibilidad › Tocar › Tocar atrás')

  const before = (await nativeFile(page, 'data'))!.text
  await section.getByTestId('capture-sms-test').click()
  await expect(section.getByText('Pega el texto de un aviso.')).toBeVisible()
  await section.getByLabel('Texto de un aviso de tu banco').fill(SMS)
  await section.getByTestId('capture-sms-test').click()
  await expect(section.getByTestId('capture-sms-result')).toHaveText(/Clara no conoce este formato\. Lo dejaría como propuesta con \$4\.25 sugerido/)
  await section.getByLabel('Texto de un aviso de tu banco').fill('Pagado $4.25 · disponible $1,000.00')
  await section.getByTestId('capture-sms-test').click()
  await expect(section.getByTestId('capture-sms-result')).toHaveText(/no encuentra un único importe con su moneda/)
  // Nada se guardó: los datos son los mismos y la cola sigue vacía.
  expect((await nativeFile(page, 'data'))!.text).toBe(before)
  expect(await fakeCaptureQueue(page)).toBe('')
  await expectNoHorizontalScroll(page, 'captura automática, fase 4')
  expect((await new AxeBuilder({ page }).include('.card').analyze()).violations).toEqual([])
})

test('«Nuevo gasto en Clara»: pedido antes de que cargue la web abre el formulario al arrancar; con la app abierta, en el acto', async ({ page }) => {
  await asNativeApp(page)
  await openApp(page)
  await seedNativeData(page, baseData())
  // La acción se ejecutó mientras la app estaba cerrada: la web la recoge al arrancar.
  await seedFakeScreen(page, 'newExpense')
  await page.reload()
  await expect(page).toHaveURL(/#\/movimientos\/nuevo$/)
  await expect(page.locator('#page-title')).toHaveText('Nuevo movimiento')
  // Una sola vez: recargar no vuelve a abrirlo.
  await go(page, '/')
  await page.reload()
  await expect(page).not.toHaveURL(/movimientos\/nuevo/)

  // Con la app abierta: el aviso del plugin abre el formulario enseguida; una pantalla desconocida no abre nada.
  await requestFakeScreen(page, 'borrarTodo')
  await expect(page).not.toHaveURL(/movimientos\/nuevo/)
  await requestFakeScreen(page, 'newExpense')
  await expect(page).toHaveURL(/#\/movimientos\/nuevo$/)
  // Nada se guardó: abrir el formulario no registra ningún movimiento.
  expect((await stored(page)).transactions).toEqual([])
})
