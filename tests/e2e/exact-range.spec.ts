import { expect, test } from '@playwright/test'
import type { AppData } from '../../src/domain/types'
import { backupText } from '../../src/storage/backup'
import { account, baseData, tx } from '../../src/test/fixtures'
import { expectNoHorizontalScroll, go, openApp, storedData, writeStoredData } from './helpers'

/**
 * Cota de exactitud (`domain/exactRange.ts`): una copia cuyos importes suman más de 2⁵³ − 1 se rechaza al importar con su
 * motivo; con los datos más grandes que entran (9 007 movimientos de 10¹² y el resto exacto) ninguna pantalla cae en
 * «No se pudo abrir esta pantalla». Datos sintéticos.
 */
const X = 1_000_000_000_000
const REST = Number.MAX_SAFE_INTEGER - 9007 * X
const clock = (iso: string) => new Date(`${iso}T12:00:00-04:00`)
const edge = (rest = REST): AppData =>
  baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 0, date: '2026-08-01', setAt: '2026-08-01T12:00:00.000Z' } })],
    transactions: [
      ...Array.from({ length: 9007 }, (_, i) => tx({ id: `e${i}`, date: '2026-10-10', amountMinor: X, kind: 'expense', status: 'realized', categoryId: 'groceries', merchant: 'Mercado' })),
      tx({ id: 'rest', date: '2026-10-11', amountMinor: rest, kind: 'expense', status: 'realized', categoryId: 'groceries' }),
    ],
  })
const ERROR_HEADING = 'No se pudo abrir esta pantalla'

test('una copia cuya suma de importes pasa de 2⁵³ − 1 se rechaza al importar, con el motivo, y los datos no cambian', async ({ page }) => {
  await openApp(page, clock('2026-10-22'))
  await expect(page.getByRole('heading', { name: 'Hola, esto es Clara' })).toBeVisible()
  const before = await storedData(page)
  await go(page, '/ajustes?seccion=copia')
  const text = backupText(edge(REST + 1), new Date('2026-10-22T12:00:00.000Z'), 'test')
  await page.getByTestId('import-file').setInputFiles({ name: 'demasiado.json', mimeType: 'application/json', buffer: Buffer.from(text) })
  await expect(page.getByText('la suma de los importes pasaría de 2⁵³ − 1 unidades menores')).toBeVisible()
  await expect(page.getByRole('dialog', { name: '¿Reemplazar tus datos con esta copia?' })).toHaveCount(0)
  expect(await storedData(page)).toBe(before)
})

test('con los datos más grandes que entran (9 007 × 10¹² y el resto exacto), Inicio, Movimientos, Pendientes, Análisis, Revisión y Estadísticas se abren', async ({ page }) => {
  test.setTimeout(120_000)
  await openApp(page, clock('2026-10-22'))
  await expect(page.getByRole('heading', { name: 'Hola, esto es Clara' })).toBeVisible()
  await writeStoredData(page, edge())
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
  for (const route of ['/', '/movimientos', '/pendientes', '/analisis', '/revision', '/estadisticas']) {
    await go(page, route)
    await expect(page.getByRole('heading', { name: ERROR_HEADING }), route).toHaveCount(0)
    await expectNoHorizontalScroll(page, `cota de exactitud ${route}`)
  }
  await expect(page.getByTestId('stats-future-hidden')).toContainText('no cabe en una cifra exacta')
})
