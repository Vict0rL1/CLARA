import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { applyFilters, go, openAddSheet, openDetails, openFilters, openMoreMenu, startDemo, storedData } from './helpers'

/**
 * L1 · Enlace externo a «nuevo movimiento» (Atajos de iPhone):
 *   #/movimientos/nuevo?kind=expense&importe=12.50&comercio=Starbucks&source=shortcut
 * Rellena el formulario y avisa; nunca guarda solo. `amount` (unidades menores) no cambia.
 */
const amount = (page: Page) => page.getByLabel('Importe', { exact: true })
const storedCount = async (page: Page) => (JSON.parse((await storedData(page)) ?? '{}') as { transactions: unknown[] }).transactions.length
const lastTx = async (page: Page) => {
  const d = JSON.parse((await storedData(page)) ?? '{}') as { transactions: { amountMinor: number; merchant?: string; source?: string; categoryId?: string; createdAt: string }[] }
  return [...d.transactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!
}

test('atajo de iPhone: rellena importe, comercio y categoría, avisa y solo guarda al pulsar Guardar', { tag: '@smoke' }, async ({ page }) => {
  await startDemo(page)
  const before = await storedCount(page)
  await go(page, '/movimientos/nuevo?kind=expense&importe=12.50&comercio=Starbucks&source=shortcut')
  await expect(page.getByTestId('shortcut-banner')).toContainText('Llegó desde un atajo · revisa y guarda')
  await expect(amount(page)).toHaveValue('12.50')
  await openDetails(page)
  await expect(page.getByLabel('Comercio')).toHaveValue('Starbucks')
  await expect(page.getByLabel('Categoría', { exact: true })).toHaveAttribute('data-value', 'dining')
  await expect(page.getByText('Categoría sugerida por el comercio «Starbucks»')).toBeVisible()
  // Nada se registra solo (contado en lo guardado, sin salir del formulario).
  expect(await storedCount(page)).toBe(before)
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  expect(await storedCount(page)).toBe(before + 1)
  expect(await lastTx(page)).toMatchObject({ amountMinor: 1250, merchant: 'Starbucks', source: 'shortcut', categoryId: 'dining' })
})

test('el origen «Atajo» aparece en el filtro del historial y en el CSV', async ({ page }) => {
  await startDemo(page)
  await go(page, '/movimientos/nuevo?kind=expense&importe=7.25&comercio=Tim%20Hortons&source=shortcut')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  await go(page, '/movimientos')
  const sheet = await openFilters(page)
  await sheet.getByRole('group', { name: 'Origen' }).getByRole('button', { name: 'Atajo' }).click()
  await applyFilters(page)
  await expect(page.getByTestId('history-tools')).toContainText('1 movimiento')
  await expect(page.locator('.tx-group .item').first()).toContainText('7.25')
  const [download] = await Promise.all([page.waitForEvent('download'), (await openMoreMenu(page)).getByRole('button', { name: 'Exportar CSV' }).click()])
  const csv = readFileSync((await download.path())!, 'utf8')
  expect(csv.split('\r\n')[0]).toMatch(/,Origen,Importe original,Moneda original,Tasa,Fecha de la tasa,Origen de la tasa,Comisión \(%\)$/)
  expect(csv).toContain('Atajo')
})

test('`amount` sigue en unidades menores (25 → 0.25) e `importe` en mayores (25 → 25.00); si vienen los dos, manda `importe`', async ({ page }) => {
  await startDemo(page)
  await go(page, '/movimientos/nuevo?amount=25')
  await expect(amount(page)).toHaveValue('0.25')
  await go(page, '/')
  await go(page, '/movimientos/nuevo?importe=25')
  await expect(amount(page)).toHaveValue('25.00')
  await go(page, '/')
  await go(page, '/movimientos/nuevo?amount=25&importe=12,50')
  await expect(amount(page)).toHaveValue('12.50')
  // Sin `source=shortcut` no hay aviso de atajo.
  await expect(page.getByTestId('shortcut-banner')).toHaveCount(0)
})

for (const [label, value] of [
  ['texto', 'doce'],
  ['vacío', ''],
  ['enorme', '99999999999999'],
] as const) {
  test(`importe ${label}: el campo queda vacío y se dice que no se entendió (nunca se adivina)`, async ({ page }) => {
    await startDemo(page)
    await go(page, `/movimientos/nuevo?importe=${encodeURIComponent(value)}&source=shortcut`)
    await expect(amount(page)).toHaveValue('')
    await expect(page.getByText('No se entendió el importe del atajo')).toBeVisible()
  })
}

test('importe en otra moneda: se rellena el número tal cual y se avisa', async ({ page }) => {
  await startDemo(page)
  await go(page, '/movimientos/nuevo?importe=12%20USD&source=shortcut')
  await expect(amount(page)).toHaveValue('12.00')
  await expect(page.getByText('El atajo envió el importe en USD; este presupuesto usa CAD')).toBeVisible()
})

test('importe grande pero válido: pasa por la confirmación de importe desproporcionado (G5)', async ({ page }) => {
  await startDemo(page)
  const before = await storedCount(page)
  await go(page, '/movimientos/nuevo?kind=expense&importe=50000&source=shortcut')
  await expect(amount(page)).toHaveValue('50000.00')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: /¿Seguro\?/ })
  await expect(dialog).toBeVisible()
  expect(await storedCount(page)).toBe(before)
  await dialog.getByRole('button', { name: 'Sí, es correcto' }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  expect((await lastTx(page)).source).toBe('shortcut')
})

/**
 * L3 · Paso por el portapapeles: el atajo copia «Starbucks 12.50» y abre Clara; en la hoja «+»,
 * «Pegar del atajo» (un toque: `readText` lo exige) abre la vista previa del asistente. Sin importe,
 * lo dice y no crea nada. El portapapeles se simula: Chromium sin interfaz no deja leer el real.
 */
async function stubClipboard(page: Page, text: string | null) {
  await page.addInitScript((value) => {
    const w = window as unknown as { __copied?: string }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: () => (value === null ? Promise.reject(new DOMException('denied', 'NotAllowedError')) : Promise.resolve(value)),
        writeText: (t: string) => {
          w.__copied = t
          return Promise.resolve()
        },
      },
    })
  }, text)
}
const pasteFromShortcut = async (page: Page) => {
  await openAddSheet(page)
  await page.getByRole('dialog', { name: '¿Qué quieres registrar?' }).getByRole('button', { name: /Pegar del atajo/ }).click()
}

test('«Pegar del atajo»: abre la vista previa con la fila leída y solo registra al confirmar, con origen «Atajo»', async ({ page }) => {
  await stubClipboard(page, '  Starbucks 12.50\n')
  await startDemo(page)
  const before = await storedCount(page)
  await go(page, '/')
  await pasteFromShortcut(page)
  await expect(page.getByRole('heading', { name: 'Asistente de registro' })).toBeVisible()
  await expect(page.getByTestId('shortcut-banner')).toContainText('Llegó desde un atajo · revisa y registra')
  const line = page.getByTestId('assistant-preview').locator('.assistant__line')
  await expect(line).toHaveCount(1)
  await expect(line.getByLabel('Importe')).toHaveValue('12.50')
  await expect(line.getByLabel('Categoría')).toHaveAttribute('data-value', 'dining')
  // Nada se registra solo.
  expect(await storedCount(page)).toBe(before)
  await page.getByRole('button', { name: 'Registrar 1 movimiento' }).click()
  await expect(page.getByText('1 movimiento registrado')).toBeVisible()
  expect(await storedCount(page)).toBe(before + 1)
  expect(await lastTx(page)).toMatchObject({ amountMinor: 1250, source: 'shortcut', categoryId: 'dining' })
})

for (const [label, clip, message] of [
  ['sin importe', 'Starbucks', 'El portapapeles no tiene un importe'],
  ['vacío', '', 'El portapapeles no tiene un importe'],
  ['sin permiso', null, 'No se pudo leer el portapapeles'],
] as const) {
  test(`«Pegar del atajo» ${label}: lo dice, no sale de la hoja y no crea nada`, async ({ page }) => {
    await stubClipboard(page, clip)
    await startDemo(page)
    const before = await storedCount(page)
    await go(page, '/')
    await pasteFromShortcut(page)
    await expect(page.getByTestId('paste-note')).toContainText(message)
    await expect(page.getByRole('dialog', { name: '¿Qué quieres registrar?' })).toBeVisible()
    expect(page.url()).not.toContain('asistente')
    expect(await storedCount(page)).toBe(before)
  })
}

test('sin portapapeles en el navegador no se ofrece «Pegar del atajo»', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }))
  await startDemo(page)
  await go(page, '/')
  await openAddSheet(page)
  const sheet = page.getByRole('dialog', { name: '¿Qué quieres registrar?' })
  await expect(sheet.getByRole('link', { name: /Escribir o dictar/ })).toBeVisible()
  await expect(sheet.getByRole('button', { name: /Pegar del atajo/ })).toHaveCount(0)
})

test('Ajustes › Atajos › Atajos de iPhone: dos plantillas con esta dirección, «Copiar» y aviso honesto de lo pendiente', async ({ page, baseURL }) => {
  await stubClipboard(page, '')
  await startDemo(page)
  await go(page, '/ajustes')
  await page.getByLabel('Buscar en Ajustes').fill('apple pay')
  await page.getByRole('link', { name: /^Atajos/ }).click()
  await expect(page.getByRole('heading', { name: 'Atajos de teclado' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Atajos de iPhone' })).toBeVisible()
  const section = page.getByTestId('ios-shortcuts')
  await expect(section).toContainText('Todavía no está comprobado dónde abre iOS los enlaces')
  await expect(section).not.toContainText(/automátic/i)
  const origin = new URL(baseURL!).origin
  const pay = `${origin}/#/movimientos/nuevo?kind=expense&importe=[Importe]&comercio=[Comercio]&source=shortcut`
  await expect(page.getByTestId('ios-link-pay').locator('code')).toHaveText(pay)
  await expect(page.getByTestId('ios-link-back-tap').locator('code')).toHaveText(`${origin}/#/movimientos/nuevo?source=shortcut`)
  await page.getByTestId('ios-link-pay').getByRole('button', { name: /^Copiar/ }).click()
  await expect(page.getByText('Enlace copiado')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toBe(pay)
  // El enlace anterior a la sección sigue llevando aquí.
  await go(page, '/ajustes/atajos-iphone')
  await expect(page.getByTestId('ios-shortcuts')).toBeVisible()
})
