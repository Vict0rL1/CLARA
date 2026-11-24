import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import type { CaptureProposal, PeriodBudget, Transaction } from '../../src/domain/types'
import { account, baseData, EARLIER, tx } from '../../src/test/fixtures'
import { available, expectNoHorizontalScroll, go, seedStoredData, storedData } from './helpers'

/**
 * Fase 2 nativa: «Por revisar» en Pendientes, con datos como los que deja la importación de capturas (la cola del
 * iPhone se prueba aparte). Saldo de referencia 1 000,00 escrito el 28-sep a las 13:00Z; los tres pagos registrados
 * solos son posteriores, así que ya restan: 1 000 − 4,25 − 18,40 − 12,00 = 965,35.
 */
const captured = (id: string, amountMinor: number, merchant: string, at: string, extra: Partial<Transaction> = {}): Transaction =>
  tx({ id, amountMinor, merchant, categoryId: 'other_expense', source: 'apple_pay', captureId: id, review: { needed: true, reason: 'auto_capture' }, realizedAt: at, ...extra })

const proposal = (overrides: Partial<CaptureProposal>): CaptureProposal => ({
  captureId: 'cap-p0000001',
  capturedAt: '2026-09-28T15:40:00Z',
  origin: 'apple_pay',
  reason: 'currency',
  amount: { kind: 'foreign', currency: 'USD', minor: 1250 },
  merchant: 'Amazon',
  card: 'Visa ••1234',
  accountId: 'main',
  date: '2026-09-28',
  categoryId: 'shopping',
  receivedAt: '2026-09-28T15:41:00.000Z',
  ...overrides,
})

function data() {
  return baseData({
    transactions: [
      captured('cap-a0000001', 425, 'Tim Hortons', '2026-09-28T15:00:00Z'),
      captured('cap-b0000001', 1840, 'Metro', '2026-09-28T15:10:00Z', { source: 'bank_text', review: { needed: true, reason: 'auto_capture', rawText: 'Compra por $18.40 en METRO' } }),
      captured('cap-c0000001', 1200, 'Uber', '2026-09-28T15:20:00Z', { source: 'siri' }),
    ],
    captures: {
      processed: ['cap-a0000001', 'cap-b0000001', 'cap-c0000001', 'cap-p0000001', 'cap-p0000002'].map((id) => ({ id, at: EARLIER })),
      proposals: [
        proposal({}),
        proposal({ captureId: 'cap-p0000002', reason: 'duplicate', amount: { kind: 'budget', minor: 425 }, merchant: 'Tim Hortons', capturedAt: '2026-09-28T15:01:00Z', similarTxId: 'cap-a0000001', categoryId: 'dining' }),
      ],
    },
  })
}

const card = (page: Page, name: string) => page.getByTestId('capture-review').locator('article', { hasText: name })
/** Los avisos se apilan: cada uno se busca por su texto. */
const toast = (page: Page, message: string) => page.locator('.toast:not(.toast--held)', { hasText: message })

test('por revisar: confirmar, deshacer, editar, rechazar, registrar en otra moneda y descartar; las cifras cambian solo con lo registrado', async ({ page }) => {
  await seedStoredData(page, data())
  await expect(await available(page)).toHaveText('$965.35')
  // 5 pagos por revisar + «nunca verificaste el saldo» de la cuenta. Los tres en «Otros gastos» no salen además como sin
  // categoría mientras esperan revisión.
  await expect(page.getByTestId('inbox-link').first()).toContainText('6 pendientes')

  // La lista de movimientos marca lo que falta revisar.
  await go(page, '/movimientos')
  await expect(page.locator('a.item', { hasText: '4.25' })).toContainText('Por revisar')

  await go(page, '/pendientes')
  const review = page.getByTestId('capture-review')
  await expect(review.getByRole('heading', { name: 'Por revisar (5)' })).toBeVisible()
  await expect(page.getByTestId('inbox-count')).toHaveText('6 pendientes')
  await expect(page.getByRole('heading', { name: /Sin categoría/ })).toHaveCount(0)
  await expect(card(page, 'Metro')).toContainText('Texto del aviso: Compra por $18.40 en METRO')
  await expect(card(page, 'Amazon')).toContainText('Llegó como $12.50 USD y no hay una tasa escrita para esa moneda')
  await expect(card(page, 'Amazon')).toContainText('Propuesta · no cuenta')
  await expect(review.locator('article', { hasText: 'Se parece a otro gasto' })).toContainText('Tim Hortons')
  await expectNoHorizontalScroll(page, 'por revisar')
  expect((await new AxeBuilder({ page }).include('[data-testid="capture-review"]').analyze()).violations).toEqual([])

  // «Está bien» y «Deshacer».
  await card(page, '$4.25').filter({ hasText: 'Registrado solo' }).getByRole('button', { name: 'Está bien' }).click()
  await expect(toast(page, 'Marcado como revisado')).toBeVisible()
  await expect(review.getByRole('heading', { name: 'Por revisar (4)' })).toBeVisible()
  await toast(page, 'Marcado como revisado').getByRole('button', { name: 'Deshacer' }).click()
  await expect(review.getByRole('heading', { name: 'Por revisar (5)' })).toBeVisible()
  await card(page, '$4.25').filter({ hasText: 'Registrado solo' }).getByRole('button', { name: 'Está bien' }).click()
  await expect(review.getByRole('heading', { name: 'Por revisar (4)' })).toBeVisible()

  // «Editar»: el formulario lo explica y guardar también es revisar.
  await card(page, 'Uber').getByRole('link', { name: 'Editar' }).click()
  await expect(page.getByText('Lo registró una captura automática')).toBeVisible()
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.locator('#page-title')).toHaveText('Pendientes')
  await expect(review.getByRole('heading', { name: 'Por revisar (3)' })).toBeVisible()

  // «Fue rechazado»: a la papelera; deja de contar (965,35 + 18,40 = 983,75).
  await card(page, 'Metro').getByRole('button', { name: 'Fue rechazado' }).click()
  await expect(toast(page, 'Movimiento enviado a la papelera')).toBeVisible()
  await expect(review.getByRole('heading', { name: 'Por revisar (2)' })).toBeVisible()

  // Otra moneda: sin importe no se registra; con lo que cobró el banco en CAD, sí (983,75 − 17,10 = 966,65).
  await card(page, 'Amazon').getByRole('button', { name: 'Registrar' }).click()
  await expect(card(page, 'Amazon').locator('.field__error')).toBeVisible()
  await card(page, 'Amazon').getByLabel('Importe en CAD').fill('17.10')
  await card(page, 'Amazon').getByRole('button', { name: 'Registrar' }).click()
  await expect(toast(page, 'Registrado: Amazon')).toBeVisible()
  await expect(review.getByRole('heading', { name: 'Por revisar (1)' })).toBeVisible()

  // El posible duplicado: «Descartar», «Deshacer» y otra vez «Descartar». No cambia ninguna cifra.
  const duplicate = review.locator('article', { hasText: 'Se parece a otro gasto' })
  await duplicate.getByRole('button', { name: 'Descartar' }).click()
  await expect(toast(page, 'Propuesta descartada')).toBeVisible()
  await expect(page.getByTestId('capture-review')).toHaveCount(0)
  await toast(page, 'Propuesta descartada').getByRole('button', { name: 'Deshacer' }).click()
  await expect(duplicate).toBeVisible()
  await duplicate.getByRole('button', { name: 'Descartar' }).click()
  await expect(page.getByTestId('capture-review')).toHaveCount(0)

  await expect(await available(page)).toHaveText('$966.65')
  const stored = JSON.parse((await storedData(page))!) as ReturnType<typeof data>
  expect(stored.captures!.proposals).toEqual([])
  expect(stored.captures!.processed.map((p) => p.id)).toContain('cap-p0000002')
  const amazon = stored.transactions.find((t) => t.id === 'cap-p0000001')!
  expect(amazon).toMatchObject({ amountMinor: 1710, currency: 'CAD', realizedAt: '2026-09-28T15:40:00Z', captureId: 'cap-p0000001', source: 'apple_pay' })
  expect(amazon).not.toHaveProperty('review')
  expect(stored.transactions.filter((t) => t.review)).toEqual([])
  expect(stored.trash.map((e) => e.id)).toEqual(['cap-b0000001'])
})

test('la prueba de Ajustes: se ve como «Prueba», no se puede registrar y se descarta sin tocar ninguna cifra', async ({ page }) => {
  const test = proposal({ captureId: 'cap-t0000001', reason: 'auto_capture', amount: { kind: 'budget', minor: 1 }, merchant: 'Prueba de Clara', card: undefined, test: true })
  await seedStoredData(page, baseData({ captures: { processed: [{ id: test.captureId, at: EARLIER }], proposals: [test] } }))
  await expect(await available(page)).toHaveText('$1,000.00')
  await go(page, '/pendientes')
  const item = card(page, 'Prueba de Clara')
  await expect(item).toContainText('Prueba')
  await expect(item).toContainText('Es la prueba de Ajustes')
  await expect(item.getByRole('button', { name: 'Registrar' })).toHaveCount(0)
  await expect(item.getByLabel('Importe en CAD')).toHaveCount(0)
  await item.getByRole('button', { name: 'Descartar' }).click()
  await expect(page.getByTestId('capture-review')).toHaveCount(0)
  await expect(await available(page)).toHaveText('$1,000.00')
})

test('tarjeta nueva: se pregunta su cuenta una vez; lo que espera revisión pasa a esa cuenta y la pregunta desaparece', async ({ page }) => {
  const accounts = [account({ id: 'main', name: 'Principal' }), account({ id: 'visa', name: 'Visa oro', kind: 'credit', anchor: { amountMinor: 0, date: '2026-09-28', setAt: EARLIER } })]
  const paid = captured('cap-a0000001', 425, 'Tim Hortons', '2026-09-28T15:00:00Z', { review: { needed: true, reason: 'auto_capture', card: 'Visa ••1234' } })
  await seedStoredData(page, baseData({ accounts, transactions: [paid], captures: { processed: [{ id: paid.id, at: EARLIER }], proposals: [] } }))
  await go(page, '/pendientes')
  const ask = page.getByTestId('capture-review').locator('article', { hasText: 'Tarjeta nueva: Visa ••1234' })
  await expect(ask).toBeVisible()
  await ask.getByLabel('Cuenta de Visa ••1234').selectOption('visa')
  await ask.getByRole('button', { name: 'Guardar' }).click()
  await expect(toast(page, 'Visa ••1234 → Visa oro')).toBeVisible()
  await expect(ask).toHaveCount(0)
  await expect(card(page, 'Tim Hortons')).toContainText('Visa oro')
  const stored = JSON.parse((await storedData(page))!) as ReturnType<typeof baseData>
  expect(stored.settings.capture?.cardAccounts).toEqual([{ card: 'Visa ••1234', accountId: 'visa' }])
  expect(stored.transactions[0]!.accountId).toBe('visa')
})

/**
 * Fase 3: viaje «Asia» (25-sep → 4-oct) con yen y yuan a mano y 2,5 % de comisión. A mano:
 *   ¥1 200 × 0,0092 × 1,025 = 11,316 → 11,32 $ (llegó solo y ya resta: 1 000,00 − 11,32 = 988,68)
 *   CN¥88,30 × 0,1923 × 1,025 = 17,404… → 17,40 $ (propuesta; con la tasa del viaje: 988,68 − 17,40 = 971,28)
 *   12,50 US$ cobrados como 13,71 $ → tasa 1,0968 (el dólar no es del viaje: 971,28 − 13,71 = 957,57)
 */
test('viaje: lo convertido dice su tasa; una propuesta se registra con la tasa del viaje o con el cargo real', async ({ page }) => {
  const trip: PeriodBudget = {
    id: 'asia',
    name: 'Asia',
    template: 'trip',
    startDate: '2026-09-25',
    endDate: '2026-10-04',
    allocatedMinor: 50000,
    currency: 'CAD',
    txIds: ['cap-j0000001'],
    archived: false,
    trip: {
      currencies: ['JPY', 'CNY'],
      localCurrency: 'JPY',
      rates: [
        { currency: 'JPY', rate: '0.0092', date: '2026-09-25' },
        { currency: 'CNY', rate: '0.1923', date: '2026-09-28' },
      ],
      feeBps: 250,
    },
    createdAt: EARLIER,
    updatedAt: EARLIER,
  }
  const ramen = captured('cap-j0000001', 1132, 'Ichiran', '2026-09-28T15:00:00Z', {
    original: { currency: 'JPY', amountMinor: 1200, rate: '0.0092', rateDate: '2026-09-25', rateSource: 'manual', feeBps: 250 },
    review: { needed: true, reason: 'currency' },
  })
  const tea = proposal({ captureId: 'cap-c0000001', amount: { kind: 'foreign', currency: 'CNY', minor: 8830 }, merchant: 'Tea house', categoryId: 'dining' })
  const usd = proposal({ captureId: 'cap-u0000001' })
  await seedStoredData(page, baseData({ transactions: [ramen], periodBudgets: [trip], captures: { processed: ['cap-j0000001', 'cap-c0000001', 'cap-u0000001'].map((id) => ({ id, at: EARLIER })), proposals: [tea, usd] } }))
  await expect(await available(page)).toHaveText('$988.68')
  await go(page, '/pendientes')
  await expect(card(page, 'Ichiran')).toContainText('Pagado ¥1,200 JPY. Convertido con la tasa del viaje 0.0092 del 25 sep')
  await expect(card(page, 'Ichiran')).toContainText('y 2.5 % de comisión')
  await expect(card(page, 'Tea house')).toContainText('Con la tasa del viaje (0.1923 del')
  await expect(card(page, 'Tea house')).toContainText('y 2.5 % de comisión: $17.40.')
  await expect(card(page, 'Amazon').getByRole('button', { name: 'Registrar con esta tasa' })).toHaveCount(0)
  await expectNoHorizontalScroll(page, 'por revisar con viaje')
  expect((await new AxeBuilder({ page }).include('[data-testid="capture-review"]').analyze()).violations).toEqual([])

  await card(page, 'Tea house').getByRole('button', { name: 'Registrar con esta tasa' }).click()
  await expect(toast(page, 'Registrado: Tea house')).toBeVisible()
  await expect(card(page, 'Tea house')).toHaveCount(0)
  await card(page, 'Amazon').getByLabel('Importe en CAD').fill('13.71')
  await card(page, 'Amazon').getByRole('button', { name: 'Registrar', exact: true }).click()
  await expect(toast(page, 'Registrado: Amazon')).toBeVisible()
  await expect(await available(page)).toHaveText('$957.57')

  const stored = JSON.parse((await storedData(page))!) as ReturnType<typeof baseData>
  expect(stored.transactions.find((t) => t.id === 'cap-c0000001')).toMatchObject({
    amountMinor: 1740,
    original: { currency: 'CNY', amountMinor: 8830, rate: '0.1923', rateDate: '2026-09-28', rateSource: 'manual', feeBps: 250 },
  })
  expect(stored.transactions.find((t) => t.id === 'cap-u0000001')).toMatchObject({ amountMinor: 1371, original: { currency: 'USD', amountMinor: 1250, rate: '1.0968', rateSource: 'card_actual' } })
  expect(stored.periodBudgets[0]!.txIds).toEqual(['cap-j0000001', 'cap-c0000001'])
})
