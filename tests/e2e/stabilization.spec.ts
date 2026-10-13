import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { START, available, go, openDetails, pickCategory, startDemo, storedData, writeStoredData } from './helpers'

/**
 * Regresiones de navegador de la auditoría posterior (2026-10-12/13) sobre `e7c9d87`. Cada prueba
 * reproduce el recorrido que fallaba y fija el contrato; los ids son los del informe.
 */
type Stored = { transactions: { id: string; amountMinor: number; currency: string; note?: string }[] }
const txs = async (page: import('@playwright/test').Page) => (JSON.parse((await storedData(page)) ?? '{}') as Stored).transactions ?? []

test('AS-01 · «café USD 10» en un presupuesto CAD se bloquea con el motivo; al escribirlo en CAD se guarda y sobrevive a recargar', async ({ page }) => {
  await startDemo(page)
  const before = (await txs(page)).length
  await go(page, '/asistente')
  await page.getByLabel('Texto').fill('café USD 10')
  await page.getByRole('button', { name: 'Analizar' }).click()
  const line = page.getByTestId('assistant-preview').locator('.assistant__line').first()
  // El importe conserva la moneda escrita y el campo explica por qué no vale.
  await expect(line.getByLabel('Importe')).toHaveValue('10.00 USD')
  await expect(line.getByText('El importe está en USD; este presupuesto usa CAD. No se convierte.')).toBeVisible()
  await expect(line.getByTestId('review-currency')).toContainText('Escribiste USD; este presupuesto usa CAD')
  await expect(page.getByTestId('assistant-currency-blocked')).toBeVisible()
  const register = page.getByRole('button', { name: 'Registrar 1 movimiento' })
  await expect(register).toBeDisabled()
  expect((await txs(page)).length).toBe(before)

  // La persona lo escribe en CAD: se puede registrar y queda en CAD tras recargar.
  await line.getByLabel('Importe').fill('10')
  await expect(page.getByTestId('assistant-currency-blocked')).toHaveCount(0)
  await register.click()
  await expect(page.getByText('1 movimiento registrado').first()).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
  const saved = (await txs(page)).filter((t) => t.note === 'café')
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({ amountMinor: 1000, currency: 'CAD' })
})

test('AS-01 · la misma moneda sigue funcionando: «café 10 CAD» se registra sin aviso', async ({ page }) => {
  await startDemo(page)
  await go(page, '/asistente')
  await page.getByLabel('Texto').fill('café 10 CAD')
  await page.getByRole('button', { name: 'Analizar' }).click()
  const line = page.getByTestId('assistant-preview').locator('.assistant__line').first()
  await expect(line.getByLabel('Importe')).toHaveValue('10.00')
  await expect(page.getByTestId('assistant-currency-blocked')).toHaveCount(0)
  await page.getByRole('button', { name: 'Registrar 1 movimiento' }).click()
  await expect(page.getByText('1 movimiento registrado').first()).toBeVisible()
})

test('FIN-01 · vincular un pago del día del saldo, ya incluido en él, no vuelve a restarlo (antes, después y tras recargar)', async ({ page }) => {
  await startDemo(page)
  // El saldo de referencia de la demo es del 26-sep: un pago de la luz anotado ese día y ya incluido.
  await go(page, '/movimientos/nuevo?kind=expense&date=2026-09-26')
  await page.getByLabel('Importe').fill('42.80')
  await openDetails(page)
  await page.getByLabel('Nota (opcional)').fill('Luz en ventanilla')
  await page.getByLabel(/^Ya estaba incluido en el saldo/).check()
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  await go(page, '/ajustes/cuentas')
  const net = await page.getByTestId('net-worth').innerText()

  await go(page, '/plan/calendario')
  await page.getByRole('button', { name: 'Vincular: Recibo de luz' }).click()
  await expect(page.getByText('«Recibo de luz» vinculado: ya cuenta como pagado').first()).toBeVisible()
  await go(page, '/ajustes/cuentas')
  await expect(page.getByTestId('net-worth')).toHaveText(net)
  await page.reload()
  await expect(page.getByTestId('net-worth')).toHaveText(net)
})

test('FIN-02 · bajar un límite por debajo de lo arrastrado avisa antes de guardar, quita el arrastre y las renovaciones siguen siendo válidas', async ({ page }) => {
  await startDemo(page)
  await go(page, '/plan/planes/nuevo')
  await page.getByLabel('Límite máximo').fill('100')
  await page.getByTestId('plan-categories').click()
  await page.getByTestId('category-picker').getByRole('option', { name: 'Servicios (luz, agua, gas)' }).first().click()
  await page.getByRole('button', { name: 'Listo' }).click()
  await page.getByRole('switch', { name: 'Arrastrar lo no gastado al siguiente ciclo' }).click()
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Plan guardado')).toBeVisible()
  // 2-oct: septiembre cierra sin gasto → octubre 100 + 100.
  await go(page, '/')
  await page.clock.setSystemTime(new Date(START.getTime() + 4 * 86_400_000))
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
  await go(page, '/plan/planes')
  await page.getByTestId('plan-list').getByRole('link', { name: /Servicios \(luz, agua, gas\)/ }).click()
  await expect(page.getByTestId('plan-limit-breakdown')).toContainText('Límite base $100.00 · arrastre +$100.00 = $200.00')
  await page.getByRole('link', { name: 'Editar' }).click()
  await expect(page.getByTestId('plan-carry-note')).toContainText('el límite base queda en $100.00')
  await page.getByLabel('Límite máximo').fill('50')
  await expect(page.getByTestId('plan-carry-note')).toContainText('Este límite es menor que lo arrastrado ($100.00): al guardar se quita el arrastre y $50.00 pasa a ser el límite base.')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Plan guardado')).toBeVisible()
  await expect(page.getByTestId('plan-spent')).toContainText('/ $50.00')
  await expect(page.getByTestId('plan-limit-breakdown')).toHaveCount(0)
  // 2-nov: octubre cierra sin gasto → noviembre 50 + 50; los datos siguen cargando (nada inválido guardado).
  await go(page, '/')
  await page.clock.setSystemTime(new Date(START.getTime() + 35 * 86_400_000))
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
  await go(page, '/plan/planes')
  await page.getByTestId('plan-list').getByRole('link', { name: /Servicios \(luz, agua, gas\)/ }).click()
  await expect(page.getByTestId('plan-limit-breakdown')).toContainText('Límite base $50.00 · arrastre +$50.00 = $100.00')
})

/** El «Deshacer» de un aviso: en el propio aviso o, si otro lo sustituyó, en el botón que queda unos segundos. */
const undoOf = (page: import('@playwright/test').Page, text: string) =>
  page.locator('.toast').filter({ hasText: text }).getByRole('button', { name: 'Deshacer' }).or(page.getByTestId('toast-held').getByRole('button', { name: 'Deshacer' }))

test('REC-01 · importar una copia, registrar algo y pulsar «Deshacer»: se niega, explica dónde está lo anterior y el registro sobrevive a recargar', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes/copia')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar copia' }).click()])
  const backup = JSON.parse(readFileSync((await download.path())!, 'utf8'))
  backup.data.accounts[0].name = 'Cuenta importada'
  await page.getByTestId('import-file').setInputFiles({ name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await page.getByRole('dialog', { name: '¿Reemplazar tus datos con esta copia?' }).getByRole('button', { name: 'Reemplazar datos' }).click()
  await expect(page.getByText('Copia importada').first()).toBeVisible()
  // Dentro del aviso, un movimiento nuevo.
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe').fill('7.77')
  await openDetails(page)
  await page.getByLabel('Nota (opcional)').fill('Después de importar')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  await undoOf(page, 'Copia importada').first().click()
  await expect(page.getByText('No se deshizo: guardaste cambios después y se perderían.').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ver copias locales' })).toBeVisible()
  await go(page, '/')
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
  expect((await txs(page)).some((t) => t.note === 'Después de importar')).toBe(true)
  await go(page, '/ajustes/copias-locales')
  await expect(page.getByTestId('local-backup-list')).toContainText('Antes de restaurar')
})

test('REC-01 · sin cambios posteriores, «Deshacer» la importación sí vuelve a lo anterior', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes/copia')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar copia' }).click()])
  const backup = JSON.parse(readFileSync((await download.path())!, 'utf8'))
  backup.data.accounts[0].name = 'Cuenta importada'
  await page.getByTestId('import-file').setInputFiles({ name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await page.getByRole('dialog', { name: '¿Reemplazar tus datos con esta copia?' }).getByRole('button', { name: 'Reemplazar datos' }).click()
  await undoOf(page, 'Copia importada').first().click()
  await expect(page.getByText('Importación deshecha: se recuperaron los datos anteriores').first()).toBeVisible()
  await page.reload()
  await go(page, '/ajustes/cuentas')
  await expect(page.getByText('Cuenta importada')).toHaveCount(0)
})

test('REC-01 · restaurar una copia local, registrar algo y pulsar «Deshacer»: se niega y el registro sobrevive a recargar', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes/copias-locales')
  await page.getByTestId('backup-now').click()
  await expect(page.getByText('Copia local guardada')).toBeVisible()
  await page.getByRole('button', { name: /^Restaurar ?: / }).click()
  await page.getByRole('dialog', { name: '¿Restaurar esta copia?' }).getByRole('button', { name: 'Restaurar' }).click()
  await expect(page.getByText('Copia restaurada').first()).toBeVisible()
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe').fill('5.55')
  await openDetails(page)
  await page.getByLabel('Nota (opcional)').fill('Después de restaurar')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  await undoOf(page, 'Copia restaurada').first().click()
  await expect(page.getByText('No se deshizo: guardaste cambios después y se perderían.').first()).toBeVisible()
  await go(page, '/')
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
  expect((await txs(page)).some((t) => t.note === 'Después de restaurar')).toBe(true)
})

test('REC-02 · una copia con «exportedAt» inválido muestra un error del archivo al importar y al verificar; nada se guarda y todo carga tras recargar', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes/copia')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar copia' }).click()])
  const backup = JSON.parse(readFileSync((await download.path())!, 'utf8'))
  backup.exportedAt = 'not-a-date'
  const buffer = Buffer.from(JSON.stringify(backup))
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.getByTestId('import-file').setInputFiles({ name: 'rara.json', mimeType: 'application/json', buffer })
  await expect(page.getByText('No se importó el archivo')).toBeVisible()
  await expect(page.getByText('La fecha de exportación del archivo no es válida («not-a-date»)').first()).toBeVisible()
  await page.getByTestId('verify-file').setInputFiles({ name: 'rara.json', mimeType: 'application/json', buffer })
  await expect(page.getByText('La fecha de exportación del archivo no es válida («not-a-date»)').nth(1)).toBeVisible()
  expect(errors).toEqual([])
  await go(page, '/')
  await page.reload()
  await expect(page.getByTestId('available')).toHaveText('$136.78')
})

test('6 · un gasto recién guardado se puede revertir después de recargar, y el disponible vuelve al de antes', async ({ page }) => {
  await startDemo(page)
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe').fill('12.34')
  await openDetails(page)
  await page.getByLabel('Nota (opcional)').fill('Cena del martes')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  await go(page, '/')
  await expect(page.getByTestId('available')).toHaveText('$124.44')
  await page.reload()
  await go(page, '/ajustes/historial')
  const latest = page.locator('.history-entry').first()
  await expect(latest).toContainText('Cena del martes')
  await latest.getByRole('button', { name: 'Revertir' }).click()
  await page.getByRole('dialog', { name: '¿Revertir este cambio?' }).getByRole('button', { name: 'Revertir' }).click()
  await go(page, '/')
  await expect(page.getByTestId('available')).toHaveText('$136.78')
  await page.reload()
  await expect(page.getByTestId('available')).toHaveText('$136.78')
})

test('7 · con «uber» y «uber eats» el asistente elige la regla más específica; lo disponible que anuncia la revisión es el que queda al registrar', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes/reglas')
  for (const [pattern, category] of [
    ['uber', 'Transporte'],
    ['uber eats', 'Restaurantes y café'],
  ] as const) {
    await page.getByRole('button', { name: 'Nueva regla' }).click()
    const dialog = page.getByRole('dialog', { name: 'Nueva regla de categoría' })
    await dialog.getByLabel('Si la descripción contiene').fill(pattern)
    await pickCategory(page, dialog.getByLabel('Categoría'), category)
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }
  await go(page, '/asistente')
  await page.getByLabel('Texto').fill('uber eats 25\nuber 12\nrenta 650')
  await page.getByRole('button', { name: 'Analizar' }).click()
  const lines = page.getByTestId('assistant-preview').locator('.assistant__line')
  await expect(lines).toHaveCount(3)
  await expect(lines.nth(0).getByLabel('Categoría')).toHaveAttribute('data-value', 'dining')
  await expect(lines.nth(1).getByLabel('Categoría')).toHaveAttribute('data-value', 'transport')
  // Sin vincular, la renta se restaría y seguiría reservada; vinculada, libera su reserva.
  const summary = page.getByTestId('review-summary')
  await expect(summary).toContainText('Lo disponible pasaría de $136.78 a -$550.22')
  const rent = lines.nth(2)
  await rent.getByLabel('Vincular: el calendario lo dará por pagado y no se reservará dos veces').check()
  await expect(rent.getByTestId('review-effect')).toHaveText('Saldo de tus cuentas: −$650.00 · Disponible: sin cambio (usa lo que ya estaba reservado)')
  await expect(lines.nth(0).getByTestId('review-effect')).toHaveText('Saldo de tus cuentas: −$25.00')
  await expect(summary).toContainText('Lo disponible pasaría de $136.78 a $99.78')
  await page.getByRole('button', { name: 'Registrar 3 movimientos' }).click()
  await expect(page.getByText('3 movimientos registrados').first()).toBeVisible()
  await go(page, '/')
  await expect(await available(page)).toHaveText('$99.78')
})

test('8 · con más devoluciones que gastos, la barra de gasto baja del cero (ninguna altura negativa) y gráfico, aviso y tabla dicen lo mismo', async ({ page }) => {
  await startDemo(page)
  const data = JSON.parse((await storedData(page))!) as { accounts: { id: string }[]; transactions: unknown[] }
  const at = '2026-09-28T15:00:00.000Z'
  data.transactions.push({ id: 'refund-big', kind: 'refund', status: 'realized', amountMinor: 200000, currency: 'CAD', date: '2026-09-20', accountId: data.accounts[0]!.id, categoryId: 'dining', note: 'Devolución grande', createdAt: at, updatedAt: at, realizedAt: at })
  await writeStoredData(page, data)
  await page.reload()
  await go(page, '/estadisticas')
  const bars = page.locator('.bars').first()
  await expect(bars).toBeVisible()
  const heights = await bars.locator('rect.bars__bar').evaluateAll((els) => els.map((e) => Number(e.getAttribute('height'))))
  expect(heights.length).toBeGreaterThan(0)
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(0)
  const negative = bars.locator('rect.bars__bar--negative')
  await expect(negative).toHaveCount(1)
  await expect(negative).toHaveAttribute('data-value', '-75682')
  // Se ve (altura real) y está por debajo de la línea del cero.
  const [barBox, axisY] = await Promise.all([negative.evaluate((e) => ({ y: Number(e.getAttribute('y')), h: Number(e.getAttribute('height')) })), bars.locator('line.chart__axis').first().getAttribute('y1')])
  expect(barBox.h).toBeGreaterThan(10)
  expect(barBox.y).toBeCloseTo(Number(axisY), 1)
  await expect(bars.getByTestId('bars-negative-note')).toContainText('las devoluciones superaron a los gastos')
  await expect(page.getByTestId('bars-tooltip')).toContainText('Gastos -$756.82')
  await bars.getByRole('button', { name: 'Ver tabla' }).click()
  await expect(bars.locator('tbody tr').last()).toContainText('-$756.82')
})

test('9 · un día más allá de los 400 días de proyección dice que no hay saldo calculado; antes del límite sí da la cifra', async ({ page }) => {
  await startDemo(page)
  await go(page, '/plan/calendario')
  for (let i = 0; i < 14; i++) await page.getByRole('button', { name: 'Mes siguiente' }).click()
  await expect(page.getByRole('heading', { name: /noviembre de 2027/i }).first()).toBeVisible()
  const day = (n: number) => page.locator('button.cal-day', { has: page.locator('.cal-day__num', { hasText: new RegExp(`^−?${n}$`) }) })
  await expect(page.getByTestId('calendar-beyond-note')).toContainText('La proyección llega hasta el')
  // 1-nov-2027 es el día 400 (el último proyectado): tiene cifra.
  await day(1).click()
  await expect(page.getByTestId('day-balance')).toHaveAttribute('data-state', 'projected')
  await expect(page.getByTestId('day-balance')).toContainText('$')
  // 20-nov-2027 queda fuera: ninguna cifra, el motivo y hasta dónde llega.
  await day(1).click()
  await day(20).click()
  const balance = page.getByTestId('day-balance')
  await expect(balance).toHaveAttribute('data-state', 'beyond')
  await expect(balance).toContainText('Sin saldo proyectado para este día')
  await expect(balance).not.toContainText('$')
  // La simulación de ese día tampoco inventa un resultado.
  await page.getByLabel('Importe a simular').fill('100')
  await expect(page.getByTestId('sim-beyond')).toBeVisible()
  await expect(page.getByTestId('sim-result')).toHaveCount(0)
})
