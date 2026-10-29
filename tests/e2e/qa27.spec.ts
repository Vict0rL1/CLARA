import { expect, test, type Page } from '@playwright/test'
import type { AppData } from '../../src/domain/types'
import { account, baseData, bill, tx } from '../../src/test/fixtures'
import { available, expectNoHorizontalScroll, go, openApp, storedData, waitForSaved, writeStoredData } from './helpers'
import { shot } from './shots'

/**
 * Auditoría independiente del 2026-10-29 sobre `21b4ed8` (QA27), en el navegador y con datos sintéticos:
 * - QA27-01: reparar el 20-mar, pagar el 31-mar corregido el 29-mar ($980.00) y revertir la reparación: se rechaza con el
 *   pago como motivo y sigue en $980.00 tras recargar (antes: $560.00 con el 28-mar «vencido»).
 * - QA27-02: un aviso del 28-feb aplazado hasta el 5-mar sigue aplazado tras una reparación partida (1-mar-2027).
 * - QA27-03: 5 000 gastos y 5 000 devoluciones de 987 654 321 000: Análisis dice «−200 %» y Estadísticas no se rompe.
 * - QA27-04: sin copia local previa no se restaura: sin IndexedDB (respaldo en localStorage) hace falta descargar una copia
 *   primero; si la copia local falla, igual; con copia, todo sigue como siempre.
 */
type Stored = { schedules: { id: string; startDate: string; endDate?: string; anchorDate?: string }[]; transactions: { id: string; scheduleId?: string; occurrenceDate?: string }[]; inbox: { snoozed: { id: string; until: string }[] }; history: { id: string }[] }
const stored = async (page: Page) => JSON.parse((await storedData(page)) ?? '{}') as Stored
const anchor = (amountMinor: number, date: string) => ({ amountMinor, date, setAt: `${date}T12:00:00.000Z` })
const clock = (iso: string) => new Date(`${iso}T12:00:00-04:00`)

/** Como `seedStoredData`, pero con el reloj fijado en la fecha del caso (el ayudante genérico lo deja en el 28-sep-2026). */
async function seedAt(page: Page, data: AppData, iso: string) {
  await openApp(page, clock(iso))
  await expect(page.getByRole('heading', { name: 'Hola, esto es Clara' })).toBeVisible()
  await writeStoredData(page, data)
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
}

/* ------------------------------------------------------------------ */
/* QA27-01 · reparar, pagar, revertir                                   */
/* ------------------------------------------------------------------ */

/** Factura «Internet» del 31 partida el 28-feb por una versión anterior; enero y febrero pagados; horizonte de 7 días. */
const internet = (): AppData => {
  const d = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(140000, '2026-03-01') })],
    schedules: [
      bill('2026-01-31', 42000, { id: 'b1', name: 'Internet', frequency: 'monthly', endDate: '2026-02-27' }),
      bill('2026-02-28', 42000, { id: 'b2', name: 'Internet', frequency: 'monthly' }),
    ],
    transactions: [
      tx({ id: 'p-jan', kind: 'expense', amountMinor: 42000, date: '2026-01-31', categoryId: 'utilities', scheduleId: 'b1', occurrenceDate: '2026-01-31' }),
      tx({ id: 'p-feb', kind: 'expense', amountMinor: 42000, date: '2026-02-28', categoryId: 'utilities', scheduleId: 'b2', occurrenceDate: '2026-02-28' }),
    ],
  })
  return { ...d, settings: { ...d.settings, fallbackHorizonDays: 7 } }
}

async function restoreUsualDates(page: Page, name: string) {
  await go(page, '/ajustes/datos')
  const card = page.getByTestId('split-repair')
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Restaurar las fechas de siempre' }).click()
  await page.getByRole('dialog', { name: `¿Restaurar las fechas de siempre de «${name}»?` }).getByRole('button', { name: 'Restaurar las fechas de siempre' }).click()
  await expect(page.getByText('Fechas de siempre restauradas').first()).toBeVisible()
  await waitForSaved(page)
}

test('QA27-01 · reparar el 20-mar, pagar el 31-mar el 29-mar ($980.00) y revertir la reparación: se rechaza por el pago y sigue en $980.00 tras recargar', async ({ page }) => {
  await seedAt(page, internet(), '2026-03-20')
  await restoreUsualDates(page, 'Internet')
  expect((await stored(page)).schedules.find((s) => s.id === 'b2')).toMatchObject({ anchorDate: '2026-01-31' })

  // Nueve días después: el 31-mar corregido está a la vista (horizonte de 7 días) y se paga desde el calendario.
  await page.clock.setSystemTime(clock('2026-03-29'))
  await page.reload()
  await expect(await available(page)).toHaveText('$980.00')
  await go(page, '/plan/calendario')
  await page.getByRole('button', { name: /Marcar pagado.*Internet/ }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Marcar como pagado' })
  await dialog.getByRole('button', { name: 'Confirmar pago' }).click()
  await expect(page.getByText('«Internet» marcado como pagado')).toBeVisible()
  await waitForSaved(page)
  await expect(await available(page)).toHaveText('$980.00')
  const paid = (await stored(page)).transactions.find((t) => t.scheduleId === 'b2' && t.occurrenceDate === '2026-03-31')
  expect(paid).toBeDefined()

  // El historial explica el pago y no ofrece «Revertir» para la reparación.
  await go(page, '/ajustes/historial')
  const entry = page.locator('article.history-entry', { hasText: 'Internet' }).filter({ has: page.getByTestId('history-dependents') }).first()
  const note = entry.getByTestId('history-dependents')
  await expect(note).toContainText('No se puede revertir: 1 registro seguiría apuntando a un programado, o a una fecha de pago, que este cambio eliminaría o cambiaría')
  await expect(note).toContainText('Pago registrado para el 31 mar ($420.00)')
  await expect(entry.getByRole('button', { name: 'Revertir' })).toHaveCount(0)
  await shot(page, 'qa27-01-history-refusal', entry)
  await expectNoHorizontalScroll(page, 'historial con un pago dependiente')

  await page.reload()
  await go(page, '/')
  await expect(await available(page)).toHaveText('$980.00')
  const after = await stored(page)
  expect(after.transactions.find((t) => t.id === paid!.id)).toMatchObject({ scheduleId: 'b2', occurrenceDate: '2026-03-31' })
  expect(after.schedules.find((s) => s.id === 'b2')).toMatchObject({ anchorDate: '2026-01-31' })
  await shot(page, 'qa27-01-home-980')
})

/* ------------------------------------------------------------------ */
/* QA27-02 · aplazamiento con la misma fecha                            */
/* ------------------------------------------------------------------ */

test('QA27-02 · el 28-feb-2027 vencido y aplazado hasta el 5-mar sigue aplazado tras la reparación partida del 1-mar', async ({ page }) => {
  const rent = bill('2026-01-31', 150000, { id: 'r1', name: 'Renta', frequency: 'monthly', categoryId: 'housing' })
  const paidOn = (date: string, id: string) => tx({ id, kind: 'expense', amountMinor: 150000, date, categoryId: 'housing', scheduleId: 'r2', occurrenceDate: date })
  const data = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(1000000, '2027-01-01') })],
    schedules: [{ ...rent, endDate: '2026-02-27' }, { ...rent, id: 'r2', startDate: '2026-02-28' }],
    transactions: [
      tx({ id: 'p-r1', kind: 'expense', amountMinor: 150000, date: '2026-01-31', categoryId: 'housing', scheduleId: 'r1', occurrenceDate: '2026-01-31' }),
      ...['2026-02-28', '2026-03-28', '2026-04-28', '2026-05-28', '2026-06-28', '2026-07-28', '2026-08-28', '2026-09-28', '2026-10-28', '2026-11-28', '2026-12-28', '2027-01-28'].map((d, i) => paidOn(d, `p${i}`)),
    ],
    inbox: { snoozed: [{ id: 'due:schedule:r2:2027-02-28', until: '2027-03-05', at: '2027-02-28T12:00:00.000Z' }], dismissed: [] },
  })
  await seedAt(page, data, '2027-03-01')
  await go(page, '/pendientes')
  await expect(page.locator('article', { hasText: '«Renta»' })).toHaveCount(0)
  await expect(page.getByText(/Pospuesto \(1\)/)).toBeVisible()
  await restoreUsualDates(page, 'Renta')
  const s = await stored(page)
  expect(s.schedules.map((x) => [x.id, x.startDate, x.endDate ?? null, x.anchorDate ?? null])).toEqual([
    ['r1', '2026-01-31', '2026-02-27', null],
    ['r2', '2026-02-28', '2027-01-31', null],
    [s.schedules[2]!.id, '2027-02-01', null, '2026-01-31'],
  ])
  expect(s.inbox.snoozed).toEqual([{ id: `due:schedule:${s.schedules[2]!.id}:2027-02-28`, until: '2027-03-05', at: '2027-02-28T12:00:00.000Z' }])
  await go(page, '/pendientes')
  await expect(page.locator('article', { hasText: '«Renta»' })).toHaveCount(0)
  await expect(page.getByText(/Pospuesto \(1\)/)).toBeVisible()
  await shot(page, 'qa27-02-inbox-still-snoozed')
})

/* ------------------------------------------------------------------ */
/* QA27-03 · totales enormes con diferencia que no cabe                 */
/* ------------------------------------------------------------------ */

test('QA27-03 · 5 000 gastos y 5 000 devoluciones de 987 654 321 000: Análisis dice −200 % y Estadísticas sigue en pie', async ({ page }) => {
  const X = 987654321000
  const many = (prefix: string, date: string, kind: 'expense' | 'refund') => Array.from({ length: 5000 }, (_, i) => tx({ id: `${prefix}${i}`, date, amountMinor: X, kind, status: 'realized', categoryId: 'groceries' }))
  const data = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(0, '2026-08-01') })],
    transactions: [...many('e', '2026-09-10', 'expense'), ...many('r', '2026-10-10', 'refund')],
  })
  await seedAt(page, data, '2026-10-27')
  await go(page, '/analisis')
  await expect(page.getByText(/Este mes llevas un 200 % menos de gasto/)).toBeVisible()
  await shot(page, 'qa27-03-analysis-minus-200', page.getByText(/200 % menos/))
  await go(page, '/estadisticas?periodo=month&fecha=2026-10-27')
  await expect(page.getByTestId('stats-expenses').locator('xpath=..')).toContainText('-200 %')
  await shot(page, 'qa27-03-statistics')
  await expectNoHorizontalScroll(page, 'estadísticas con totales enormes')
})

/* ------------------------------------------------------------------ */
/* QA27-04 · sin copia local no se restaura                             */
/* ------------------------------------------------------------------ */

/** El sueldo del 31 partido el 28-feb por una versión anterior (saldo 1 800, seguro de 1 250 el 29-mar), como en la auditoría. */
const salary = (): AppData =>
  baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(180000, '2026-03-01') })],
    schedules: [
      { ...bill('2026-01-31', 320000, { id: 'salary-old', name: 'Sueldo', frequency: 'monthly', endDate: '2026-02-27' }), kind: 'income', categoryId: 'salary' },
      { ...bill('2026-02-28', 320000, { id: 'salary-new', name: 'Sueldo', frequency: 'monthly' }), kind: 'income', categoryId: 'salary' },
      bill('2026-03-29', 125000, { id: 'bill', name: 'Seguro', frequency: 'once' }),
    ],
  })

async function openWithoutIndexedDb(page: Page, data: AppData) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true })
  })
  await openApp(page, clock('2026-03-15'))
  await expect(page.getByRole('heading', { name: 'Hola, esto es Clara' })).toBeVisible()
  await page.evaluate((d) => localStorage.setItem('margen.data.v1', JSON.stringify(d)), data)
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
}
const localRaw = (page: Page) => page.evaluate(() => localStorage.getItem('margen.data.v1'))

test('QA27-04 · sin IndexedDB (datos en localStorage): restaurar sin copia se rechaza y nada cambia; con una copia descargada desde la tarjeta, se restaura', async ({ page }) => {
  await openWithoutIndexedDb(page, salary())
  await expect(await available(page)).toHaveText('$1,800.00')
  await go(page, '/ajustes/datos')
  const card = page.getByTestId('split-repair')
  await expect(card).toBeVisible()
  await expect(card.getByTestId('split-repair-no-local-copy')).toContainText('Este navegador no guarda copias locales')
  await shot(page, 'qa27-04-card-no-local-copies', card)
  const before = await localRaw(page)
  await card.getByRole('button', { name: 'Restaurar las fechas de siempre' }).click()
  const dialog = page.getByRole('dialog', { name: '¿Restaurar las fechas de siempre de «Sueldo»?' })
  await expect(dialog).toContainText('En este navegador no hay copias locales')
  await dialog.getByRole('button', { name: 'Restaurar las fechas de siempre' }).click()
  await expect(page.getByText('No se restauró: antes hace falta una copia de estos datos').first()).toBeVisible()
  await expect(card).toBeVisible()
  expect(await localRaw(page)).toBe(before)
  await go(page, '/')
  await expect(await available(page)).toHaveText('$1,800.00')

  // Descargar una copia desde la tarjeta y volver a intentarlo.
  await go(page, '/ajustes/datos')
  const [download] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Descargar copia antes' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.json$/)
  await waitForSaved(page)
  await card.getByRole('button', { name: 'Restaurar las fechas de siempre' }).click()
  await page.getByRole('dialog', { name: '¿Restaurar las fechas de siempre de «Sueldo»?' }).getByRole('button', { name: 'Restaurar las fechas de siempre' }).click()
  await expect(page.getByText('Fechas de siempre restauradas').first()).toBeVisible()
  await waitForSaved(page)
  await expect(card).toHaveCount(0)
  await page.reload()
  await go(page, '/')
  await expect(await available(page)).toHaveText('$550.00')
  await shot(page, 'qa27-04-repaired-after-export')
})

test('QA27-04 · si la copia local no se puede guardar (IndexedDB rechaza la escritura), restaurar se rechaza y nada cambia; con una copia descargada, se restaura', async ({ page }) => {
  await seedAt(page, salary(), '2026-03-15')
  // Solo el almacén de copias locales rechaza escribir; el presupuesto se guarda con normalidad.
  await page.evaluate(() => {
    const real = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<typeof real>) {
      if (this.name === 'backups') throw new DOMException('simulado', 'QuotaExceededError')
      return real.apply(this, args)
    }
  })
  await go(page, '/ajustes/datos')
  const card = page.getByTestId('split-repair')
  await expect(card.getByTestId('split-repair-no-local-copy')).toHaveCount(0)
  const before = await storedData(page)
  await card.getByRole('button', { name: 'Restaurar las fechas de siempre' }).click()
  await page.getByRole('dialog', { name: '¿Restaurar las fechas de siempre de «Sueldo»?' }).getByRole('button', { name: 'Restaurar las fechas de siempre' }).click()
  await expect(page.getByText('No se pudo guardar la copia local').first()).toBeVisible()
  await expect(card).toBeVisible()
  expect(await storedData(page)).toBe(before)
  const [download] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Descargar copia antes' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.json$/)
  await waitForSaved(page)
  await card.getByRole('button', { name: 'Restaurar las fechas de siempre' }).click()
  await page.getByRole('dialog', { name: '¿Restaurar las fechas de siempre de «Sueldo»?' }).getByRole('button', { name: 'Restaurar las fechas de siempre' }).click()
  await expect(page.getByText('Fechas de siempre restauradas').first()).toBeVisible()
  await waitForSaved(page)
  await go(page, '/')
  await expect(await available(page)).toHaveText('$550.00')
})

test('QA27-04 · con IndexedDB la copia local «antes de restaurar» existe, se puede ver y restaurar, y la reparación no se aplica dos veces', async ({ page }) => {
  await seedAt(page, salary(), '2026-03-15')
  await restoreUsualDates(page, 'Sueldo')
  await expect(page.getByTestId('split-repair')).toHaveCount(0)
  await go(page, '/ajustes/copias-locales')
  const copy = page.getByTestId('local-backup-list').locator('li', { hasText: 'Antes de restaurar' }).first()
  await expect(copy).toBeVisible()
  await shot(page, 'qa27-04-local-copy-before-restore', copy)
  await copy.getByRole('button', { name: 'Restaurar' }).click()
  await page.getByRole('dialog', { name: '¿Restaurar esta copia?' }).getByRole('button', { name: 'Restaurar' }).click()
  await expect(page.getByText('Copia restaurada').first()).toBeVisible()
  await waitForSaved(page)
  await go(page, '/')
  await expect(await available(page)).toHaveText('$1,800.00')
  expect((await stored(page)).schedules.find((s) => s.id === 'salary-new')?.anchorDate).toBeUndefined()
})
