import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { account, baseData, bill, income, tx } from '../../src/test/fixtures'
import { available, expectNoHorizontalScroll, go, seedStoredData, storedData, waitForSaved } from './helpers'

/**
 * Aceptación de navegador de la auditoría independiente del PR #15 (cabeza 819eaa9): QA-01 (la serie conserva sus
 * fechas al partirla cambiando solo el importe; el caso financiero y la copia de seguridad), QA-02 (el colchón de
 * seguridad bloquea cambiar la moneda), QA-03 (fechas personalizadas de Estadísticas con filtros, atrás/adelante,
 * recarga y dirección) y QA-05 (revertir una partición devuelve plantillas, escenarios y aplazamientos). QA-04 está
 * en `qa-v2.spec.ts` (CUR-02: formulario, CSV y atajo). Datos sintéticos; reloj fijo (28-sep-2026 salvo donde se dice).
 */
type Stored = {
  settings: { currency: string; safeToSpend: { bufferMinor: number } }
  schedules: { id: string; name: string; amountMinor: number; startDate: string; endDate?: string; anchorDate?: string; secondDay?: number }[]
  templates: { id: string; lines: { target: { kind: string; scheduleId?: string } }[] }[]
  scenarios: { id: string; changes: { type: string; scheduleId?: string }[] }[]
  inbox: { snoozed: { id: string }[] }
}
const stored = async (page: Page) => JSON.parse((await storedData(page)) ?? '{}') as Stored
const anchor = (amountMinor: number, date = '2026-09-15') => ({ amountMinor, date, setAt: `${date}T12:00:00.000Z` })

async function exportBackup(page: Page) {
  await go(page, '/ajustes/copia')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar copia' }).click()])
  return JSON.parse(readFileSync((await download.path())!, 'utf8')) as { data: Stored }
}

test('QA-01 · sueldo del 31 partido el 30-sep (el 31 movido) cambiando solo el importe: el 20-oct el seguro del 31-oct sigue reservado («Puedes gastar» $100.00) y la copia conserva la serie', async ({ page }) => {
  const data = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(100000) })],
    schedules: [income('2026-05-31', 300000, { id: 'salary', name: 'Sueldo', frequency: 'monthly' }), bill('2026-10-31', 90000, { id: 'bill', name: 'Seguro', frequency: 'once' })],
  })
  await seedStoredData(page, data)
  await go(page, '/plan/programado/editar/salary')
  await page.getByRole('radio', { name: 'Desde una fecha' }).check()
  await expect(page.getByLabel('Desde (primera fecha con los cambios)')).toHaveValue('2026-09-30')
  await expect(page.getByText('las fechas de la serie siguen siendo las de siempre', { exact: false })).toBeVisible()
  await page.getByLabel('Importe', { exact: true }).fill('3200')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText(/^Cambio guardado desde el/).first()).toBeVisible()
  await waitForSaved(page)
  expect((await stored(page)).schedules.filter((s) => s.name === 'Sueldo').map((s) => [s.amountMinor, s.startDate, s.endDate ?? null, s.anchorDate ?? null])).toEqual([
    [300000, '2026-05-31', '2026-09-29', null],
    [320000, '2026-09-30', null, '2026-05-31'],
  ])

  // El 20-oct: el próximo ingreso es el 31-oct (no el 30), así que el seguro del 31-oct sigue reservado: 1 000 − 900.
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00-04:00'))
  await page.reload()
  await expect(await available(page)).toHaveText('$100.00')

  // La copia exportada conserva la fecha que fija la serie y, restaurada, da la misma cifra.
  const backup = await exportBackup(page)
  expect(backup.data.schedules.find((s) => s.startDate === '2026-09-30')?.anchorDate).toBe('2026-05-31')
  await page.getByTestId('import-file').setInputFiles({ name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await page.getByRole('dialog', { name: '¿Reemplazar tus datos con esta copia?' }).getByRole('button', { name: 'Reemplazar datos' }).click()
  await expect(page.getByText('Copia importada').first()).toBeVisible()
  await waitForSaved(page)
  expect((await stored(page)).schedules.filter((s) => s.name === 'Sueldo').map((s) => [s.startDate, s.anchorDate ?? null])).toEqual([
    ['2026-05-31', null],
    ['2026-09-30', '2026-05-31'],
  ])
  await expect(await available(page)).toHaveText('$100.00')
})

test('QA-02 · con un colchón de seguridad guardado y nada más, la moneda no se puede cambiar y se explica; nada cambia al recargar ni en la copia; con el colchón en 0 sí se puede', async ({ page }) => {
  const base = baseData({ accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(0) })] })
  await seedStoredData(page, { ...base, settings: { ...base.settings, safeToSpend: { ...base.settings.safeToSpend, bufferMinor: 10000 } } })
  await go(page, '/ajustes/formato')
  const hint = page.getByTestId('currency-hint')
  await expect(hint).toContainText('El colchón de seguridad guardado ($100.00) ya es un importe en CAD')
  await page.getByTestId('change-currency').click()
  await page.getByRole('dialog').getByRole('button', { name: /^JPY/ }).click()
  await expect(page.locator('.toast').filter({ hasText: 'El colchón de seguridad guardado ($100.00)' })).toBeVisible()
  await page.reload()
  await go(page, '/ajustes/formato')
  await expect(page.locator('#main')).toContainText('CAD · dólar canadiense')
  expect((await stored(page)).settings).toMatchObject({ currency: 'CAD', safeToSpend: { bufferMinor: 10000 } })
  const backup = await exportBackup(page)
  expect(backup.data.settings).toMatchObject({ currency: 'CAD', safeToSpend: { bufferMinor: 10000 } })

  // Con el colchón en 0 (y nada más guardado) sí se puede cambiar.
  await go(page, '/ajustes/safe-to-spend')
  await page.getByLabel('Colchón de seguridad').fill('')
  await page.getByRole('button', { name: 'Guardar colchón' }).click()
  await expect(page.getByText('Colchón guardado').first()).toBeVisible()
  await waitForSaved(page)
  await go(page, '/ajustes/formato')
  await expect(hint).toContainText('puedes cambiar la moneda ahora')
  await page.getByTestId('change-currency').click()
  await page.getByRole('dialog').getByRole('button', { name: /^JPY/ }).click()
  await expect(page.getByText('Moneda cambiada a JPY').first()).toBeVisible()
  await waitForSaved(page)
  expect((await stored(page)).settings.currency).toBe('JPY')
})

test('QA-03 · Estadísticas de julio (personalizado): las cifras siguen siendo solo de julio tras cada filtro, al quitarlos, con atrás/adelante, al recargar y al abrir la dirección; el saldo futuro dice que no se filtra', async ({ page }) => {
  const data = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(500000, '2026-06-01') }), account({ id: 'card', name: 'Tarjeta', kind: 'credit', anchor: anchor(0, '2026-06-01') })],
    tags: [{ id: 'tg', name: 'Viaje', color: 'blue', createdAt: '2026-06-01T12:00:00.000Z', updatedAt: '2026-06-01T12:00:00.000Z' }],
    transactions: [
      tx({ id: 'j1', date: '2026-07-03', amountMinor: 12345, accountId: 'main', note: 'Super julio', merchant: 'Super', tagIds: ['tg'] }),
      tx({ id: 'j2', date: '2026-07-20', amountMinor: 10000, accountId: 'card', note: 'Gasolina julio', merchant: 'Gasolinera' }),
      tx({ id: 's1', date: '2026-09-10', amountMinor: 55555, accountId: 'main', note: 'Super septiembre', merchant: 'Super', tagIds: ['tg'] }),
      // Siete días con gasto en el último mes: el saldo futuro se muestra (y dice que no se filtra).
      ...Array.from({ length: 7 }, (_, i) => tx({ id: `d${i}`, date: `2026-09-${String(15 + i).padStart(2, '0')}`, amountMinor: 1000, accountId: 'main', note: `Café ${i}` })),
    ],
  })
  await seedStoredData(page, data)
  await go(page, '/estadisticas?periodo=custom&desde=2026-07-01&hasta=2026-07-31')
  const tiles = page.getByTestId('stats-tiles')
  const start = page.getByLabel('Inicio del periodo personalizado')
  const end = page.getByLabel('Fin del periodo personalizado')
  const expectJuly = async (expenses: string) => {
    await expect(start).toHaveValue('2026-07-01')
    await expect(end).toHaveValue('2026-07-31')
    await expect(tiles).toContainText(expenses)
    expect(new URL(page.url()).hash).toMatch(/desde=2026-07-01/)
    expect(new URL(page.url()).hash).toMatch(/hasta=2026-07-31/)
  }
  await expectJuly('$223.45')
  await page.getByTestId('stats-filters').locator('summary').click()
  const accountFilter = page.getByTestId('stats-filters').getByLabel('Cuenta')
  await accountFilter.selectOption({ label: 'Principal' })
  await expectJuly('$123.45')
  await expect(page.getByText('El saldo futuro es de todas las cuentas del presupuesto')).toBeVisible()
  await accountFilter.selectOption({ label: 'Tarjeta' })
  await expectJuly('$100.00')
  // Etiqueta, comercio y combinaciones (criterios de QA-03): siempre cifras solo de julio, con las fechas en la dirección.
  await accountFilter.selectOption({ label: 'Todas' })
  await expectJuly('$223.45')
  await page.getByTestId('stats-filters').locator('summary').click()
  const tagFilter = page.getByTestId('stats-filters').getByLabel('Etiqueta')
  const merchantFilter = page.getByTestId('stats-filters').getByLabel('Comercio')
  await tagFilter.selectOption({ label: 'Viaje' })
  await expectJuly('$123.45')
  await merchantFilter.selectOption({ label: 'Super' })
  await expectJuly('$123.45')
  await accountFilter.selectOption({ label: 'Tarjeta' })
  await expectJuly('$0.00')
  await expect(page.getByText('Cifras solo de: Tarjeta · Viaje · Super', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Quitar filtros' }).click()
  await expectJuly('$223.45')
  // Atrás vuelve a la última combinación (Tarjeta · Viaje · Super → $0.00); adelante, a «sin filtros».
  await page.goBack()
  await expectJuly('$0.00')
  await page.goForward()
  await expectJuly('$223.45')
  await page.reload()
  await expectJuly('$223.45')
  // Abrir la dirección tal cual (un enlace guardado) da lo mismo.
  const url = page.url()
  await page.goto(url)
  await expectJuly('$223.45')
  await expectNoHorizontalScroll(page, 'Estadísticas de julio con filtros')
})

test('QA-05 · partir un programado que usan una plantilla, un escenario y un aplazamiento; revertirlo desde el historial los devuelve y no queda referencia al tramo nuevo', async ({ page }) => {
  const at = '2026-06-01T12:00:00.000Z'
  const data = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(100000) })],
    schedules: [bill('2026-06-01', 65000, { id: 'old', name: 'Renta', frequency: 'monthly', categoryId: 'housing' })],
    templates: [{ id: 't', name: 'Quincena', kind: 'distribution', lines: [{ target: { kind: 'payment', scheduleId: 'old' }, amount: { mode: 'fixed', amountMinor: 65000 } }], createdAt: at, updatedAt: at }],
    scenarios: [{ id: 'sc', name: 'Si sube', changes: [{ type: 'scheduleAmount', scheduleId: 'old', newAmountMinor: 72000 }], baseFingerprint: 'x', createdAt: at, updatedAt: at }],
    inbox: { snoozed: [{ id: 'due:schedule:old:2026-10-01', until: '2026-10-20', at: '2026-09-27T12:00:00.000Z' }], dismissed: [] },
  })
  await seedStoredData(page, data)
  await go(page, '/plan/programado/editar/old')
  await page.getByRole('radio', { name: 'Desde una fecha' }).check()
  await expect(page.getByLabel('Desde (primera fecha con los cambios)')).toHaveValue('2026-10-01')
  await page.getByLabel('Importe', { exact: true }).fill('700')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText(/^Cambio guardado desde el/).first()).toBeVisible()
  await waitForSaved(page)
  const after = await stored(page)
  const next = after.schedules.find((s) => s.id !== 'old')!
  expect(after.templates[0]!.lines[0]!.target).toEqual({ kind: 'payment', scheduleId: next.id })
  expect(after.scenarios[0]!.changes[0]).toMatchObject({ scheduleId: next.id })
  expect(after.inbox.snoozed[0]!.id).toBe(`due:schedule:${next.id}:2026-10-01`)

  // Tras recargar (el formulario deja la app en el calendario), el historial describe también lo que la partición
  // movió, y «Revertir» lo devuelve todo.
  await page.reload()
  await go(page, '/')
  await expect(page.getByTestId('available')).toBeVisible()
  await go(page, '/ajustes/historial')
  const entry = page.locator('article.history-entry', { hasText: 'Plantilla cambiada: Quincena' })
  await expect(entry).toContainText('Escenario cambiado: Si sube')
  await expect(entry).toContainText('Aplazamiento')
  await entry.getByRole('button', { name: 'Revertir' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Revertir' }).click()
  await expect(page.getByText('Cambio revertido').first()).toBeVisible()
  await waitForSaved(page)
  const back = await stored(page)
  expect(back.schedules.map((s) => [s.id, s.amountMinor, s.endDate ?? null])).toEqual([['old', 65000, null]])
  expect(back.templates[0]!.lines[0]!.target).toEqual({ kind: 'payment', scheduleId: 'old' })
  expect(back.scenarios[0]!.changes[0]).toMatchObject({ scheduleId: 'old' })
  expect(back.inbox.snoozed.map((s) => s.id)).toEqual(['due:schedule:old:2026-10-01'])
  await expectNoHorizontalScroll(page, 'historial con una partición revertida')
})

test('R2 (revisión propia) · Estadísticas: el periodo personalizado vive solo en la dirección; chips, «Hoy» y atrás/adelante nunca la contradicen', async ({ page }) => {
  const data = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(500000, '2026-06-01') })],
    transactions: [tx({ id: 'j1', date: '2026-07-03', amountMinor: 12345, accountId: 'main', note: 'Super julio' }), tx({ id: 'a1', date: '2026-08-03', amountMinor: 20000, accountId: 'main', note: 'Super agosto' })],
  })
  await seedStoredData(page, data)
  await go(page, '/estadisticas?periodo=custom&desde=2026-07-01&hasta=2026-07-31')
  const tiles = page.getByTestId('stats-tiles')
  const start = page.getByLabel('Inicio del periodo personalizado')
  const end = page.getByLabel('Fin del periodo personalizado')
  const expectRange = async (from: string, to: string, expenses: string) => {
    await expect(start).toHaveValue(from)
    await expect(end).toHaveValue(to)
    await expect(tiles).toContainText(expenses)
    expect(new URL(page.url()).hash).toContain(`desde=${from}`)
    expect(new URL(page.url()).hash).toContain(`hasta=${to}`)
  }
  await expectRange('2026-07-01', '2026-07-31', '$123.45')
  // Chip «Mensual»: la dirección del mes no arrastra las fechas personalizadas. Volver a «Personalizado» abre el
  // personalizado por defecto (últimos 30 días, sin fechas escritas) y la dirección dice lo mismo: nunca se contradicen.
  await page.getByRole('button', { name: 'Mensual', exact: true }).click()
  await expect(start).toHaveCount(0)
  expect(new URL(page.url()).hash).not.toContain('desde=')
  await page.getByRole('button', { name: 'Personalizado', exact: true }).click()
  await expect(start).toHaveValue('')
  await expect(end).toHaveValue('')
  expect(new URL(page.url()).hash).toContain('periodo=custom')
  expect(new URL(page.url()).hash).not.toContain('desde=')
  // «Periodo siguiente» (agosto) y atrás/adelante: la pantalla sigue a la dirección.
  await go(page, '/estadisticas?periodo=custom&desde=2026-07-01&hasta=2026-07-31')
  await expectRange('2026-07-01', '2026-07-31', '$123.45')
  await page.getByRole('button', { name: 'Periodo siguiente' }).click()
  await expectRange('2026-08-01', '2026-08-31', '$200.00')
  await page.goBack()
  await expectRange('2026-07-01', '2026-07-31', '$123.45')
  await page.goForward()
  await expectRange('2026-08-01', '2026-08-31', '$200.00')
  // «Hoy» en personalizado: un periodo de la misma duración que termina hoy (28-sep), en la pantalla y en la dirección.
  await page.getByRole('button', { name: 'Hoy', exact: true }).click()
  await expectRange('2026-08-29', '2026-09-28', '$0.00')
  await page.reload()
  await expectRange('2026-08-29', '2026-09-28', '$0.00')
})
