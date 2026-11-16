import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { baseData, tx } from '../../src/test/fixtures'
import { expectNoHorizontalScroll, go, openMoreMenu, seedStoredData } from './helpers'

/**
 * Fase 3: Estadísticas y CSV con el importe original y el convertido. Septiembre de 2026: ¥1 200 a 0,0092 con 2,5 %
 * = 11,32 $; ₩15 000 a 0,00098 = 14,70 $; 20,00 $ en CAD.
 */
function data() {
  return baseData({
    transactions: [
      tx({ id: 'yen', date: '2026-09-26', amountMinor: 1132, categoryId: 'dining', note: 'Ramen', original: { currency: 'JPY', amountMinor: 1200, rate: '0.0092', rateDate: '2026-09-25', rateSource: 'manual', feeBps: 250 } }),
      tx({ id: 'won', date: '2026-09-27', amountMinor: 1470, categoryId: 'dining', note: 'Bibimbap', original: { currency: 'KRW', amountMinor: 15000, rate: '0.00098', rateDate: '2026-09-25', rateSource: 'manual' } }),
      tx({ id: 'cad', date: '2026-09-27', amountMinor: 2000, categoryId: 'groceries', note: 'Super' }),
    ],
  })
}

test('Estadísticas: «Gastado por moneda» con el original y lo convertido; la lista y el CSV también lo dicen', async ({ page }) => {
  await seedStoredData(page, data())
  await go(page, '/estadisticas')
  const card = page.getByTestId('stats-currency')
  await expect(card).toContainText('Gastado por moneda')
  await expect(card.locator('li', { hasText: '¥1,200 JPY' })).toContainText('$11.32')
  await expect(card.locator('li', { hasText: '₩15,000 KRW' })).toContainText('$14.70')
  await expect(card.locator('li', { hasText: '1 movimiento' }).first()).toBeVisible()
  await expectNoHorizontalScroll(page, 'estadísticas por moneda')

  await go(page, '/movimientos')
  await expect(page.locator('a.item', { hasText: 'Ramen' })).toContainText('¥1,200 JPY')
  const [download] = await Promise.all([page.waitForEvent('download'), (await openMoreMenu(page)).getByRole('button', { name: 'Exportar CSV' }).click()])
  const lines = readFileSync((await download.path())!, 'utf8').replace(/^﻿/, '').split('\r\n')
  expect(lines.find((l) => l.includes(',yen,'))).toMatch(/,-11\.32,CAD,.*,yen,[^,]*,-1200,JPY,0\.0092,2026-09-25,Escrita a mano,2\.50$/)
  expect(lines.find((l) => l.includes(',won,'))).toMatch(/,-14\.70,CAD,.*,won,[^,]*,-15000,KRW,0\.00098,2026-09-25,Escrita a mano,$/)
  expect(lines.find((l) => l.includes(',cad,'))).toMatch(/,cad,[^,]*,,,,,,$/)
})

test('sin nada en otra moneda, Estadísticas no enseña la tarjeta', async ({ page }) => {
  await seedStoredData(page, baseData({ transactions: [tx({ id: 'cad', date: '2026-09-27', amountMinor: 2000 })] }))
  await go(page, '/estadisticas')
  await expect(page.getByRole('heading', { name: 'Por categoría' })).toBeVisible()
  await expect(page.getByTestId('stats-currency')).toHaveCount(0)
})
