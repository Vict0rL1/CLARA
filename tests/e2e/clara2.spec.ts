import { expect, test, type Page } from '@playwright/test'
import { recurringCosts } from '../../src/domain/recurringCosts'
import { account, baseData, bill, goal, tx } from '../../src/test/fixtures'
import { expectNoHorizontalScroll, go, openApp, openDetails, openExplain, pickCategory, seedStoredData, setupFirstUse, startDemo, storedData } from './helpers'

/**
 * Clara 2.0 · fase 1 (cimientos), de punta a punta: colchón de seguridad en «Puedes gastar»,
 * pagos dos veces al mes y los tipos de cuenta nuevos. Parte de la configuración de
 * `docs/MANUAL-TEST.md` (disponible = $400.00).
 */
type Stored = {
  settings: { safeToSpend: { bufferMinor: number } }
  schedules: { id: string; name: string; frequency: string; startDate: string; endDate?: string; secondDay?: number; amountMinor: number; categoryId?: string; accountId: string }[]
  accounts: { name: string; kind: string; institution?: string; includeInBudget: boolean }[]
}
const stored = async (page: Page) => JSON.parse((await storedData(page)) ?? '{}') as Stored

test('colchón de seguridad: se resta de «Puedes gastar», se explica, sobrevive a recargar y se puede quitar', async ({ page }) => {
  await setupFirstUse(page)
  await go(page, '/ajustes/safe-to-spend')
  await page.getByLabel('Colchón de seguridad').fill('50')
  await page.getByTestId('save-buffer').click()
  await expect(page.getByText('Colchón guardado')).toBeVisible()
  expect((await stored(page)).settings.safeToSpend.bufferMinor).toBe(5000)

  await go(page, '/')
  await expect(page.getByTestId('available')).toHaveText('$350.00')
  await openExplain(page)
  await expect(page.getByText('Colchón de seguridad (se descuenta)')).toBeVisible()

  await page.reload()
  await go(page, '/')
  await expect(page.getByTestId('available')).toHaveText('$350.00')

  // Un colchón mayor que lo que queda: pagos y apartados siguen cubiertos, así que es un aviso
  // («usando tu colchón»), nunca la alarma de «te faltan … para cubrir pagos».
  await go(page, '/ajustes/safe-to-spend')
  await expect(page.getByLabel('Colchón de seguridad')).toHaveValue('50.00')
  await page.getByLabel('Colchón de seguridad').fill('450')
  await page.getByTestId('save-buffer').click()
  await expect(page.getByText('Colchón guardado').first()).toBeVisible()
  await go(page, '/')
  await expect(page.getByTestId('available')).toHaveText('-$50.00')
  await expect(page.getByText('Estás usando $50.00 de tu colchón de $450.00')).toBeVisible()
  await expect(page.getByText(/Te faltan .* para cubrir pagos y apartados/)).toHaveCount(0)

  // Vacío = sin colchón: vuelve la cifra de siempre y desaparece la línea de la explicación.
  await go(page, '/ajustes/safe-to-spend')
  await expect(page.getByLabel('Colchón de seguridad')).toHaveValue('450.00')
  await page.getByLabel('Colchón de seguridad').fill('')
  await page.getByTestId('save-buffer').click()
  await expect(page.getByText('Colchón guardado').first()).toBeVisible()
  await go(page, '/')
  await expect(page.getByTestId('available')).toHaveText('$400.00')
  await openExplain(page)
  await expect(page.getByText('Colchón de seguridad (se descuenta)')).toHaveCount(0)
})

test('dos veces al mes: el segundo día se elige, se explica y se valida antes de guardar', async ({ page }) => {
  await setupFirstUse(page)
  await go(page, '/plan/programado/nuevo')
  await page.getByLabel('Nombre').fill('Seguro')
  await page.getByLabel('Importe', { exact: true }).fill('10')
  await page.getByLabel('Frecuencia').selectOption('semimonthly')
  await page.getByLabel('Próxima fecha').fill('2026-10-15')
  const second = page.getByLabel('Segundo día del mes')
  // Vacío: 15 días después del primero, y la ayuda lo dice.
  await expect(page.getByText('Se repite el día 15 y el día 30 de cada mes')).toBeVisible()
  // Demasiado cerca del primero: error asociado al campo y nada se guarda.
  await second.fill('18')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('El segundo día debe estar entre 1 y 31 y a 7 días o más del primero.')).toBeVisible()
  expect((await stored(page)).schedules.some((s) => s.name === 'Seguro')).toBe(false)

  await second.fill('31')
  await expect(page.getByText('Se repite el día 15 y el día 31 de cada mes')).toBeVisible()
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Programación guardada')).toBeVisible()
  const saved = (await stored(page)).schedules.find((s) => s.name === 'Seguro')
  expect(saved).toMatchObject({ frequency: 'semimonthly', startDate: '2026-10-15', secondDay: 31 })
})

test('tipos de cuenta: un monedero digital con su emisor y una inversión que no cuenta para gastar', async ({ page }) => {
  await setupFirstUse(page)
  await go(page, '/ajustes/cuentas')
  await page.getByRole('button', { name: 'Agregar cuenta' }).click()
  let dialog = page.getByRole('dialog', { name: 'Nueva cuenta' })
  await dialog.getByLabel('Nombre').fill('Monedero')
  await dialog.getByLabel('Tipo de cuenta').selectOption('wallet')
  await dialog.getByLabel('Banco o emisor (opcional)').fill('PayPal')
  await dialog.getByLabel('Saldo actual').fill('25')
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Cuenta guardada')).toBeVisible()
  await expect(page.getByTestId(/^account-/).filter({ hasText: 'Monedero' }).getByText(/Monedero digital\s*· PayPal/)).toBeVisible()

  await page.getByRole('button', { name: 'Agregar cuenta' }).click()
  dialog = page.getByRole('dialog', { name: 'Nueva cuenta' })
  await dialog.getByLabel('Nombre').fill('Fondo')
  await dialog.getByLabel('Tipo de cuenta').selectOption('investment')
  // Una inversión nueva viene sin marcar para «Puedes gastar».
  await expect(dialog.getByLabel('Contar esta cuenta para lo que puedo gastar')).not.toBeChecked()
  await dialog.getByLabel('Saldo actual').fill('1000')
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  // En escritorio el aviso anterior puede seguir visible: la señal es que la hoja se cierra.
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId(/^account-/).filter({ hasText: 'Fondo' }).getByText('Inversión')).toBeVisible()

  const accounts = (await stored(page)).accounts
  expect(accounts.find((a) => a.name === 'Monedero')).toMatchObject({ kind: 'wallet', institution: 'PayPal', includeInBudget: true })
  expect(accounts.find((a) => a.name === 'Fondo')).toMatchObject({ kind: 'investment', includeInBudget: false })
  expect(accounts.find((a) => a.name === 'Fondo')!.institution).toBeUndefined()
  // El monedero (incluido) suma 25; la inversión (excluida) no cambia lo que puedes gastar.
  await go(page, '/')
  await expect(page.getByTestId('available')).toHaveText('$425.00')
})

test('avisos de un límite al 50/75/90 %: apagados por defecto, se guardan y se ven al editar', async ({ page }) => {
  await setupFirstUse(page)
  await go(page, '/plan/planes/nuevo')
  await page.getByLabel('Límite máximo').fill('300')
  await page.getByLabel('Nombre (opcional)').fill('Salidas')
  for (const p of [50, 75, 90]) await expect(page.getByRole('switch', { name: `Avisar al ${p} %` })).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('switch', { name: 'Avisar al 80 %' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('switch', { name: 'Avisar al 50 %' }).click()
  await page.getByRole('switch', { name: 'Avisar al 90 %' }).click()
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Plan guardado').first()).toBeVisible()
  const plan = (JSON.parse((await storedData(page)) ?? '{}') as { plans: { id: string; name: string; alertLevels?: number[]; alertAt80: boolean; alertAt100: boolean }[] }).plans.find((p) => p.name === 'Salidas')!
  expect(plan).toMatchObject({ alertLevels: [50, 90], alertAt80: true, alertAt100: true })

  await page.reload()
  await go(page, `/plan/planes/editar/${plan.id}`)
  await expect(page.getByRole('switch', { name: 'Avisar al 50 %' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('switch', { name: 'Avisar al 75 %' })).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('switch', { name: 'Avisar al 90 %' })).toHaveAttribute('aria-checked', 'true')
})

test('corregir la categoría que propone una regla ofrece recordarla; solo se guarda al pulsar «Recordar»', async ({ page }) => {
  await startDemo(page)
  const rules = async () => (JSON.parse((await storedData(page)) ?? '{}') as { categoryRules: { pattern: string; categoryId: string }[] }).categoryRules
  const before = (await rules()).length

  // Sin corrección no se ofrece nada.
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe', { exact: true }).fill('3')
  await openDetails(page)
  await page.getByLabel('Nota (opcional)').fill('Café con Ana')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Recordar' })).toHaveCount(0)

  // La regla «café» propone Restaurantes y café; la persona elige Supermercado.
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe', { exact: true }).fill('4')
  await openDetails(page)
  await page.getByLabel('Nota (opcional)').fill('Café del museo')
  const category = page.getByLabel('Categoría', { exact: true })
  await expect(category).toHaveAttribute('data-value', 'dining')
  await pickCategory(page, category, 'Supermercado')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('¿Usar siempre «Supermercado» cuando la descripción incluya «Café del museo»?')).toBeVisible()
  // Ofrecer no es guardar.
  expect((await rules()).length).toBe(before)
  await page.getByRole('button', { name: 'Recordar' }).click()
  await expect(page.getByText(/Regla guardada: «Café del museo» → Supermercado/)).toBeVisible()
  expect((await rules()).filter((r) => r.pattern === 'Café del museo')).toEqual([expect.objectContaining({ categoryId: 'groceries' })])

  // La próxima vez la regla nueva (más específica) gana; la anterior sigue para lo demás.
  await go(page, '/movimientos/nuevo')
  await openDetails(page)
  await page.getByLabel('Nota (opcional)').fill('café del museo')
  await expect(page.getByLabel('Categoría', { exact: true })).toHaveAttribute('data-value', 'groceries')
  await page.getByLabel('Nota (opcional)').fill('Café con Luis')
  await expect(page.getByLabel('Categoría', { exact: true })).toHaveAttribute('data-value', 'dining')
})

test('configuración inicial: un sueldo dos veces al mes con su segundo día, validado antes de seguir', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Configurar con mis datos' }).click()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByLabel('Saldo disponible').fill('1200')
  await page.getByLabel('Periodo del presupuesto').selectOption({ label: 'Hasta mi próximo ingreso' })
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByLabel('Importe esperado').fill('800')
  await page.getByLabel('Fecha del próximo ingreso').fill('2026-10-08')
  await page.getByLabel('Frecuencia').selectOption('semimonthly')
  // Vacío: 15 días después, y la ayuda lo dice antes de seguir.
  await expect(page.getByText('Se repite el día 8 y el día 23 de cada mes')).toBeVisible()
  await page.getByLabel('Segundo día del mes').fill('10')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByText('El segundo día debe estar entre 1 y 31 y a 7 días o más del primero.')).toBeVisible()
  await page.getByLabel('Segundo día del mes').fill('22')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByRole('button', { name: 'Ver resumen' }).click()
  await page.getByRole('button', { name: 'Empezar a usar Clara' }).click()
  await expect(page.getByTestId('available')).toBeVisible()
  const pay = (await stored(page)).schedules.find((s) => s.startDate === '2026-10-08')
  expect(pay).toMatchObject({ frequency: 'semimonthly', secondDay: 22 })
})

test('«Repetir» dos veces al mes: el programado guarda el segundo día elegido', async ({ page }) => {
  await setupFirstUse(page)
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe', { exact: true }).fill('5')
  await openDetails(page)
  await page.getByLabel('Nota (opcional)').fill('Lavandería')
  await page.getByRole('switch', { name: 'Repetir' }).click()
  await page.getByLabel('Frecuencia').selectOption('semimonthly')
  // Hoy es 28: por defecto, el 13 y el 28.
  await expect(page.getByText('Se repite el día 13 y el día 28 de cada mes')).toBeVisible()
  await page.getByLabel('Segundo día del mes').fill('25')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('El segundo día debe estar entre 1 y 31 y a 7 días o más del primero.')).toBeVisible()
  expect((await stored(page)).schedules.some((s) => s.name === 'Lavandería')).toBe(false)
  await page.getByLabel('Segundo día del mes').fill('14')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado y programado creado').first()).toBeVisible()
  expect((await stored(page)).schedules.find((s) => s.name === 'Lavandería')).toMatchObject({ frequency: 'semimonthly', startDate: '2026-09-28', secondDay: 14 })
})

test('asistente: corregir la categoría que proponía una regla ofrece recordarla; «Recordar» guarda y se puede deshacer', async ({ page }) => {
  await startDemo(page)
  const rules = async () => (JSON.parse((await storedData(page)) ?? '{}') as { categoryRules: { pattern: string; categoryId: string }[] }).categoryRules
  const before = (await rules()).length
  await go(page, '/asistente')
  await page.getByLabel('Texto').fill('café del museo 4')
  await page.getByRole('button', { name: 'Analizar' }).click()
  const line = page.getByTestId('assistant-preview').locator('.assistant__line').first()
  const category = line.getByLabel('Categoría', { exact: true })
  // La regla «café» propone Restaurantes y café; la persona elige Supermercado.
  await expect(category).toHaveAttribute('data-value', 'dining')
  await pickCategory(page, category, 'Supermercado')
  await page.getByRole('button', { name: 'Registrar 1 movimiento' }).click()
  await expect(page.getByText('1 movimiento registrado. ¿Usar siempre «Supermercado» cuando la descripción incluya «café del museo»?')).toBeVisible()
  expect((await rules()).length).toBe(before)
  await page.getByRole('button', { name: 'Recordar' }).click()
  await expect(page.getByText(/Regla guardada: «café del museo» → Supermercado/)).toBeVisible()
  expect((await rules()).filter((r) => r.pattern === 'café del museo')).toEqual([expect.objectContaining({ categoryId: 'groceries' })])
  await page.getByRole('button', { name: 'Deshacer' }).click()
  await expect.poll(async () => (await rules()).length).toBe(before)

  // Sin corrección no se ofrece nada.
  await go(page, '/asistente')
  await page.getByLabel('Texto').fill('café con Ana 3')
  await page.getByRole('button', { name: 'Analizar' }).click()
  await page.getByRole('button', { name: 'Registrar 1 movimiento' }).click()
  await expect(page.getByText('1 movimiento registrado').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Recordar' })).toHaveCount(0)
})

test('comercios: una regla escrita normal reconoce la forma del extracto («UBER *EATS 8XK2L») y «Crear regla» propone el nombre sin el código', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes/reglas')
  await page.getByRole('button', { name: 'Nueva regla' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nueva regla de categoría' })
  await dialog.getByLabel('Si la descripción contiene').fill('Uber Eats')
  await pickCategory(page, dialog.getByLabel('Categoría', { exact: true }), 'Restaurantes y café')
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  await go(page, '/movimientos/importar')
  const csv = ['Fecha,Descripción,Importe', '2026-09-27,UBER *EATS 8XK2L TORONTO,-18.50', '2026-09-27,SQ *PANADERIA SOL 4412,-6.00'].join('\n')
  await page.getByTestId('bank-file').setInputFiles({ name: 'banco.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByLabel('Categoría: UBER *EATS 8XK2L TORONTO')).toHaveValue('dining')
  await expect(page.getByText('regla «Uber Eats»')).toBeVisible()

  const bakery = page.getByLabel('Categoría: SQ *PANADERIA SOL 4412')
  await bakery.selectOption({ label: 'Supermercado' })
  await page.getByRole('button', { name: /^Crear regla ?: SQ \*PANADERIA SOL 4412$/ }).click()
  const ruleDialog = page.getByRole('dialog', { name: 'Nueva regla de categoría' })
  // Sin el prefijo del procesador ni el código, que cambian en cada compra.
  await expect(ruleDialog.getByLabel('Si la descripción contiene')).toHaveValue('PANADERIA SOL')
})

test('pagos recurrentes: el calendario dice cuánto cuestan en 12 meses y al mes, igual que el cálculo del dominio', async ({ page }) => {
  await startDemo(page)
  await go(page, '/plan/calendario')
  const summary = page.getByTestId('recurring-summary')
  await expect(summary).toBeVisible()
  const data = JSON.parse((await storedData(page))!)
  const expected = recurringCosts(data, '2026-09-28')
  expect(expected.items.length).toBeGreaterThan(0)
  const cents = (text: string | null) => Number((text ?? '').replace(/[^\d]/g, ''))
  await expect(summary.getByText('Pagos fijos al mes')).toBeVisible()
  await expect(summary.getByText('Próximos 12 meses').first()).toBeVisible()
  // La explicación tiene una fila por pago y el total es exactamente el del dominio, al céntimo.
  await summary.locator('.explain > summary').click()
  const rows = summary.locator('.calc-row')
  await expect(rows).toHaveCount(expected.items.length + 2)
  expect(cents(await rows.nth(expected.items.length).locator('.calc-row__value').textContent())).toBe(expected.totalMinor)
  expect(cents(await rows.nth(expected.items.length + 1).locator('.calc-row__value').textContent())).toBe(expected.monthlyMinor)
  await expectNoHorizontalScroll(page, 'calendario con resumen de pagos recurrentes')
})

test('pagos que parecen fijos: la bandeja lo sugiere, «Programar» abre el formulario relleno y, al guardarlo, la sugerencia desaparece', async ({ page }) => {
  // El mismo comercio escrito de tres formas, 15,99 cada día 15: parece una suscripción no programada.
  const notes = ['PAYPAL *NETFLIX.COM 4029', 'NETFLIX.COM 8812', 'Netflix.com', 'PAYPAL *NETFLIX.COM 7731']
  const dates = ['2026-06-15', '2026-07-15', '2026-08-15', '2026-09-15']
  const data = baseData({ transactions: dates.map((date, i) => tx({ id: `n${i}`, date, note: notes[i], amountMinor: 1599, categoryId: 'subscriptions' })) })
  await seedStoredData(page, data)
  // Una sugerencia no es un pendiente: Inicio solo cuenta la cuenta sin verificar.
  await expect(page.getByTestId('inbox-link').first()).toContainText('1 pendiente por revisar')

  await go(page, '/pendientes')
  const card = page.locator('article', { hasText: '¿«NETFLIX COM» es un pago fijo?' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Lo registraste 4 veces por $15.99')
  await expectNoHorizontalScroll(page, 'bandeja con una sugerencia de pago fijo')
  await card.getByRole('link', { name: 'Programar' }).click()

  // Nada se programó todavía: solo el formulario relleno.
  expect((await stored(page)).schedules).toEqual([])
  await expect(page.getByLabel('Nombre')).toHaveValue('NETFLIX COM')
  await expect(page.getByLabel('Importe', { exact: true })).toHaveValue('15.99')
  await expect(page.getByLabel('Frecuencia')).toHaveValue('monthly')
  await expect(page.getByLabel('Próxima fecha')).toHaveValue('2026-10-15')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Programación guardada').first()).toBeVisible()
  expect((await stored(page)).schedules).toEqual([
    expect.objectContaining({ name: 'NETFLIX COM', amountMinor: 1599, frequency: 'monthly', startDate: '2026-10-15', categoryId: 'subscriptions', accountId: 'main' }),
  ])

  await go(page, '/pendientes')
  await expect(page.getByText('¿«NETFLIX COM» es un pago fijo?')).toHaveCount(0)
})

test('cambiar un programado desde una fecha: lo anterior queda igual, desde esa fecha el importe nuevo', async ({ page }) => {
  // Renta de 650 cada día 1 desde junio; junio–septiembre pagados. Hoy = 28-sep.
  const paid = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']
  const data = baseData({
    schedules: [bill('2026-06-01', 65000, { id: 'rent', name: 'Renta', frequency: 'monthly', categoryId: 'housing' })],
    transactions: paid.map((d, i) => tx({ id: `p${i}`, date: d, amountMinor: 65000, categoryId: 'housing', scheduleId: 'rent', occurrenceDate: d })),
  })
  await seedStoredData(page, data)
  await go(page, '/plan/programado/editar/rent')
  // Por defecto, como siempre: el cambio vale para todas las fechas.
  await expect(page.getByRole('radio', { name: 'A todas las fechas' })).toBeChecked()
  await expect(page.getByLabel('Próxima fecha')).toHaveValue('2026-06-01')
  await page.getByRole('radio', { name: 'Desde una fecha' }).check()
  const from = page.getByLabel('Desde (primera fecha con los cambios)')
  await expect(from).toHaveValue('2026-10-01')
  await expect(page.getByText(/^Hasta el .+ sigue como estaba/)).toBeVisible()
  await expectNoHorizontalScroll(page, 'programado: cambiar desde una fecha')

  // Una fecha que no es posterior a la primera se explica y no guarda nada.
  await from.fill('2026-06-01')
  await page.getByLabel('Importe', { exact: true }).fill('700')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText(/Elige una fecha posterior a la primera/)).toBeVisible()
  expect((await stored(page)).schedules).toHaveLength(1)

  await from.fill('2026-10-01')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText(/^Cambio guardado desde el/).first()).toBeVisible()
  const schedules = (await stored(page)).schedules
  expect(schedules.map((s) => [s.name, s.amountMinor, s.startDate, s.endDate ?? null])).toEqual([
    ['Renta', 65000, '2026-06-01', '2026-09-30'],
    ['Renta', 70000, '2026-10-01', null],
  ])

  // En la lista: la de siempre termina el 30-sep; la nueva sigue, con el importe nuevo.
  await go(page, '/plan/calendario')
  const list = page.locator('.item-list').last()
  await expect(list.getByRole('link', { name: /Renta.*termina el/ })).toContainText('$650.00')
  await expect(list.getByRole('link', { name: /Renta.*1 oct/ })).toContainText('$700.00')
  // La nueva no tiene fechas anteriores: no ofrece partirla.
  await go(page, `/plan/programado/editar/${schedules[1]!.id}`)
  await expect(page.getByLabel('Próxima fecha')).toHaveValue('2026-10-01')
  await expect(page.getByRole('radio', { name: 'Desde una fecha' })).toHaveCount(0)
})

test('límite sugerido según lo gastado: mediana de los meses completos, explicada; solo se usa al pulsar', async ({ page }) => {
  // Empezó el 1-jun; supermercado: junio 300, julio 450 − 50 de devolución, agosto 350.50; septiembre (en curso) no cuenta.
  const data = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 100000, date: '2026-06-01', setAt: '2026-06-01T12:00:00.000Z' } })],
    transactions: [
      tx({ id: 'jun', date: '2026-06-03', amountMinor: 30000, categoryId: 'groceries' }),
      tx({ id: 'jul', date: '2026-07-10', amountMinor: 45000, categoryId: 'groceries' }),
      tx({ id: 'ref', kind: 'refund', date: '2026-07-12', amountMinor: 5000, categoryId: 'groceries' }),
      tx({ id: 'aug', date: '2026-08-20', amountMinor: 35050, categoryId: 'groceries' }),
      tx({ id: 'sep', date: '2026-09-05', amountMinor: 99900, categoryId: 'groceries' }),
    ],
  })
  await seedStoredData(page, data)
  await go(page, '/plan/planes/nuevo')
  await page.getByTestId('plan-categories').click()
  await page.getByTestId('category-picker').getByRole('option', { name: 'Supermercado' }).first().click()
  await page.getByRole('button', { name: 'Listo' }).click()
  const box = page.getByTestId('plan-suggestion')
  await expect(box).toContainText('Sugerencia según lo que gastaste: $351.00')
  await expect(box).toContainText('Mediana de los últimos 3 periodos completos')
  // Nada se rellena solo.
  await expect(page.getByLabel('Límite máximo')).toHaveValue('')
  await box.locator('.explain > summary').click()
  const rows = box.locator('.calc-row__value')
  await expect(rows).toHaveText(['$300.00', '$400.00', '$350.50', '$350.50', '$351.00'])
  await expectNoHorizontalScroll(page, 'límite con sugerencia')
  await box.getByRole('button', { name: 'Usar $351.00' }).click()
  await expect(page.getByLabel('Límite máximo')).toHaveValue('351.00')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Plan guardado')).toBeVisible()
  const plans = JSON.parse((await storedData(page))!).plans as { amountMinor: number; categoryIds: string[] }[]
  expect(plans.map((p) => [p.amountMinor, p.categoryIds])).toEqual([[35100, ['groceries']]])
})

test('hitos de una meta: con «Alertas de planes», aviso dentro de la app al cruzar el 50 %; una meta que ya estaba ahí no avisa', async ({ page }) => {
  const at = (id: string, date: string, amountMinor: number) => ({ id, date, amountMinor, createdAt: `${date}T12:00:00.000Z`, reason: 'contribution' as const })
  const base = baseData()
  const data = baseData({
    settings: { ...base.settings, notifications: { ...base.settings.notifications, planAlerts: true } },
    goals: [
      // Laptop: del 30 % al 55 % con el aporte de ayer → «llegó al 50 %».
      goal({ id: 'laptop', name: 'Laptop', targetMinor: 100000, allocations: [at('a', '2026-08-01', 30000), at('b', '2026-09-27', 25000)] }),
      // Viaje: al 60 % desde agosto → nada nuevo.
      goal({ id: 'trip', name: 'Viaje', targetMinor: 50000, allocations: [at('c', '2026-08-01', 30000)] }),
    ],
  })
  await seedStoredData(page, data)
  await go(page, '/ajustes/notificaciones')
  await expect(page.getByRole('switch', { name: 'Alertas de planes (80 % y 100 %)' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('También avisa cuando una meta llega al 25, 50, 75 y 100 %')).toBeVisible()
  const due = page.getByTestId('due-notices')
  await expect(due).toContainText('«Laptop» llegó al 50 %')
  await expect(due).toContainText('Llevas $550.00 apartados de $1,000.00.')
  await expect(due).not.toContainText('Viaje')
})

test('estadísticas con filtros de cuenta, etiqueta y comercio: las cifras son las de esos movimientos y el filtro sobrevive a recargar', async ({ page }) => {
  const anchor = { amountMinor: 100000, date: '2026-08-01', setAt: '2026-08-01T12:00:00.000Z' }
  const data = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor }), account({ id: 'card', name: 'Tarjeta Visa', kind: 'credit', anchor: { ...anchor, amountMinor: 0 } })],
    tags: [{ id: 'trip', name: 'Viaje a Quebec', color: 'emerald', createdAt: anchor.setAt, updatedAt: anchor.setAt }],
    transactions: [
      tx({ id: 'u1', date: '2026-09-03', amountMinor: 1850, categoryId: 'dining', note: 'UBER *EATS 8XK2L', accountId: 'card', tagIds: ['trip'] }),
      tx({ id: 'u2', date: '2026-09-10', amountMinor: 2200, categoryId: 'dining', merchant: 'Uber Eats', accountId: 'main' }),
      tx({ id: 'g1', date: '2026-09-12', amountMinor: 8000, categoryId: 'groceries', note: 'Super', accountId: 'main', tagIds: ['trip'] }),
      tx({ id: 'r1', kind: 'refund', date: '2026-09-14', amountMinor: 500, categoryId: 'dining', note: 'Uber Eats', accountId: 'card' }),
    ],
  })
  await seedStoredData(page, data)
  await go(page, '/estadisticas?periodo=month')
  const expenses = page.getByTestId('stats-expenses')
  await expect(expenses).toHaveText('$115.50')
  await page.getByTestId('stats-filters').locator('summary').click()
  await page.getByLabel('Cuenta', { exact: true }).selectOption({ label: 'Tarjeta Visa' })
  await expect(expenses).toHaveText('$13.50')
  await expect(page.getByTestId('stats-filter-active')).toContainText('Cifras solo de: Tarjeta Visa')
  await expectNoHorizontalScroll(page, 'estadísticas filtradas')

  // Recargar conserva el filtro (va en la dirección); se le suma la etiqueta → solo u1.
  await page.reload()
  await expect(expenses).toHaveText('$13.50')
  await page.getByLabel('Etiqueta', { exact: true }).selectOption({ label: 'Viaje a Quebec' })
  await expect(expenses).toHaveText('$18.50')
  await expect(page.getByTestId('stats-filters').locator('summary')).toContainText('Filtrar (2 activos)')

  // Comercio: las dos formas de Uber Eats (y su devolución) cuentan juntas.
  await page.getByRole('button', { name: 'Quitar filtros' }).click()
  await expect(expenses).toHaveText('$115.50')
  await page.getByTestId('stats-filters').locator('summary').click()
  await page.getByLabel('Comercio', { exact: true }).selectOption({ label: 'UBER *EATS 8XK2L' })
  await expect(expenses).toHaveText('$35.50')
  await expect(page.getByTestId('stats-top').locator('li')).toHaveCount(1)
})
