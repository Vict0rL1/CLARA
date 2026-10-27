import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { account, baseData, tx } from '../../src/test/fixtures'
import { available, go, seedStoredData, setLanguage, settleAnimations, startDemo, storedData, waitForSaved, type UiLanguage } from './helpers'
import { shot } from './shots'

/**
 * Pasada del responsable de implementación (2026-10-27): aceptación de navegador adicional.
 * - QA-01 histórico con la copia v13 GENUINA escrita por 819eaa9 (`src/test/v13-known-intent-backup.json`), importada por la
 *   interfaz con el reloj en el 21-mar-2026: antes de reparar $1,800.00; «Restaurar las fechas de siempre» → $550.00 tras
 *   recargar y tras exportar e importar; «Dejar como está» conserva el 28.
 * - F-05: la selección por teclado y por toque conserva fechas y cifras completas; las etiquetas de mes y año siguen igual.
 * Datos sintéticos; relojes fijos; sin OCR ni cámara reales.
 */
type Stored = { schedules: { id: string; startDate: string; anchorDate?: string; amountMinor: number }[]; inbox: { dismissed: { id: string }[] }; history: unknown[] }
const stored = async (page: Page) => JSON.parse((await storedData(page)) ?? '{}') as Stored
const MARCH21 = new Date('2026-03-21T12:00:00-04:00')
const V13 = readFileSync(new URL('../../src/test/v13-known-intent-backup.json', import.meta.url))

async function importV13(page: Page) {
  await startDemo(page, MARCH21)
  await go(page, '/ajustes/copia')
  await page.getByTestId('import-file').setInputFiles({ name: 'copia-v13.json', mimeType: 'application/json', buffer: V13 })
  await page.getByRole('dialog', { name: '¿Reemplazar tus datos con esta copia?' }).getByRole('button', { name: 'Reemplazar datos' }).click()
  await expect(page.getByText('Copia importada').first()).toBeVisible()
  await waitForSaved(page)
  const s = await stored(page)
  expect(s.schedules.map((x) => [x.id, x.startDate, x.anchorDate ?? null, x.amountMinor])).toEqual([
    ['salary', '2026-01-31', null, 240000],
    ['bill', '2026-03-29', null, 125000],
    ['salary-2', '2026-02-28', null, 240777],
  ])
  expect(s.history.length).toBe(2) // la entrada de la partición antigua + el corte de la importación
  await go(page, '/')
  await expect(await available(page)).toHaveText('$1,800.00')
}

async function exportBackup(page: Page) {
  await go(page, '/ajustes/copia')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar copia' }).click()])
  return readFileSync((await download.path())!)
}

test('QA-01 histórico · copia v13 genuina importada por la interfaz (21-mar): $1,800.00 antes; restaurar el 31 → $550.00 tras recargar y tras exportar e importar', async ({ page }) => {
  await importV13(page)
  await shot(page, 'qa01-v13-imported-home')
  await go(page, '/ajustes/datos')
  const card = page.getByTestId('split-repair')
  await expect(card).toBeVisible()
  await expect(card.getByTestId('split-repair-current')).toContainText('28 mar')
  await expect(card.getByTestId('split-repair-proposed')).toContainText('31 mar')
  await shot(page, 'qa01-v13-repair-card', card)
  // Teclado: el botón de restaurar se alcanza y se activa con Enter.
  await card.getByRole('button', { name: 'Restaurar las fechas de siempre' }).focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '¿Restaurar las fechas de siempre de «Sueldo»?' })
  await expect(dialog).toContainText('31 mar')
  await shot(page, 'qa01-v13-repair-dialog')
  await dialog.getByRole('button', { name: 'Restaurar las fechas de siempre' }).click()
  await expect(page.getByText('Fechas de siempre restauradas').first()).toBeVisible()
  await waitForSaved(page)
  expect((await stored(page)).schedules.find((s) => s.id === 'salary-2')).toMatchObject({ anchorDate: '2026-01-31', amountMinor: 240777 })
  await page.reload()
  await go(page, '/')
  await expect(await available(page)).toHaveText('$550.00')
  await shot(page, 'qa01-v13-repaired-home')
  const backup = await exportBackup(page)
  await page.getByTestId('import-file').setInputFiles({ name: 'copia.json', mimeType: 'application/json', buffer: backup })
  await page.getByRole('dialog', { name: '¿Reemplazar tus datos con esta copia?' }).getByRole('button', { name: 'Reemplazar datos' }).click()
  await expect(page.getByText('Copia importada').first()).toBeVisible()
  await waitForSaved(page)
  await go(page, '/')
  await expect(await available(page)).toHaveText('$550.00')
  await go(page, '/ajustes/copias-locales')
  await expect(page.locator('#main')).toContainText(/antes de restaurar/i)
})

test('QA-01 histórico · copia v13 genuina: «Dejar como está» conserva el 28 ($1,800.00) y la revisión no vuelve tras recargar', async ({ page }) => {
  await importV13(page)
  await go(page, '/ajustes/datos')
  const card = page.getByTestId('split-repair')
  await card.getByRole('button', { name: 'Dejar como está' }).click()
  await expect(page.getByText('Se deja como está').first()).toBeVisible()
  await waitForSaved(page)
  await expect(card).toHaveCount(0)
  await page.reload()
  await go(page, '/ajustes/datos')
  await expect(page.getByTestId('split-repair')).toHaveCount(0)
  expect((await stored(page)).inbox.dismissed.map((d) => d.id)).toEqual(['int:split:salary-2'])
  await go(page, '/')
  await expect(await available(page)).toHaveText('$1,800.00')
})

const STATS_JULY = '/estadisticas?periodo=custom&desde=2026-07-01&hasta=2026-07-31'
const statsData = () =>
  baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 500000, date: '2026-01-01', setAt: '2026-01-01T12:00:00.000Z' } })],
    transactions: [
      tx({ id: 'j1', date: '2026-07-10', amountMinor: 12345, kind: 'expense', status: 'realized' }),
      tx({ id: 'm1', date: '2026-05-31', amountMinor: 4500, kind: 'expense', status: 'realized' }),
      tx({ id: 'a1', date: '2026-04-30', amountMinor: 7800, kind: 'expense', status: 'realized' }),
    ],
  })

test('F-05 · teclado y toque: cada grupo de barras seleccionado muestra su fecha completa y sus cifras en el tooltip (es/en/pt/fr)', async ({ page }, info) => {
  test.setTimeout(120_000)
  await seedStoredData(page, statsData())
  for (const language of ['Español', 'English', 'Português', 'Français'] as UiLanguage[]) {
    await setLanguage(page, language)
    await go(page, STATS_JULY)
    await expect(page.locator('.bars__svg')).toBeVisible()
    await settleAnimations(page)
    const hits = page.locator('.bars__hit')
    await expect(hits).toHaveCount(6)
    const periods = (await hits.evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') ?? '').split(':')[0]!)))
    expect(periods.every((p) => p.length > 0), language).toBe(true)
    // Teclado: foco en el primer grupo y Tab al siguiente; el tooltip sigue al foco con la fecha completa y las cifras.
    await hits.first().focus()
    await expect(page.getByTestId('bars-tooltip'), language).toContainText(periods[0]!)
    await page.keyboard.press('Tab')
    await expect(hits.nth(1)).toBeFocused()
    await expect(page.getByTestId('bars-tooltip'), language).toContainText(periods[1]!)
    const tip = await page.getByTestId('bars-tooltip').textContent()
    expect(tip, language).toMatch(/\d/)
    // Toque (celulares) o clic (escritorio) en el último grupo: el periodo actual.
    if (info.project.name === 'escritorio') await hits.nth(5).click()
    else await hits.nth(5).tap()
    await expect(page.getByTestId('bars-tooltip'), language).toContainText(periods[5]!)
    await shot(page, `f05-${language.toLowerCase().slice(0, 2)}-axis-tooltip`, page.locator('.bars'))
  }
})

test('F-05 · las etiquetas de mes y de año no cambian: seis abreviaturas de mes y seis años', async ({ page }) => {
  await seedStoredData(page, statsData())
  await go(page, '/estadisticas?periodo=month&fecha=2026-07-15')
  await expect(page.locator('.bars__svg')).toBeVisible()
  const months = await page.locator('.bars__svg text.stats-axis').allTextContents()
  expect(months).toHaveLength(6)
  expect(months.every((m) => m.length >= 3 && m.length <= 4 && !/\d/.test(m)), months.join(',')).toBe(true)
  await go(page, '/estadisticas?periodo=year&fecha=2026-07-15')
  await expect(page.locator('.bars__svg')).toBeVisible()
  const years = await page.locator('.bars__svg text.stats-axis').allTextContents()
  expect(years).toEqual(['2021', '2022', '2023', '2024', '2025', '2026'])
})
