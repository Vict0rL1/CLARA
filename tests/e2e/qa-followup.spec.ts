import { readFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { MAX_AMOUNT_MINOR } from '../../src/domain/money'
import { saveScheduleFrom } from '../../src/domain/scheduleFrom'
import type { AppData, HistoryEntry, Schedule } from '../../src/domain/types'
import { account, baseData, bill, EARLIER, income, NOW, tx } from '../../src/test/fixtures'
import { available, expectNoHorizontalScroll, go, openApp, seedStoredData, settleAnimations, storedData, waitForSaved, writeStoredData } from './helpers'

/**
 * Aceptación de navegador de la auditoría independiente de seguimiento (cabeza 46fe617). Datos sintéticos; reloj
 * fijo (28-sep-2026). Corre en los tres tamaños (celular, celular 320 px y escritorio).
 *
 * F-01 · un programado con un id largo (hasta 64, admitido) y su aviso pospuesto: partirlo «desde una fecha» guardaba
 * un historial que la validación entera rechazaba al recargar (ids de `inboxSnoozed` de hasta 88 caracteres frente al
 * límite de 64 de los ids de registro) y la app clasificaba el presupuesto como dañado; la copia tampoco se podía
 * reimportar. Ahora cada colección del historial valida con su propio contrato de id.
 */
type Stored = {
  schedules: { id: string; name: string; amountMinor: number; startDate: string; endDate?: string; anchorDate?: string }[]
  templates: { id: string; lines: { target: { kind: string; scheduleId?: string } }[] }[]
  inbox: { snoozed: { id: string }[]; dismissed: { id: string; fingerprint: string }[] }
  history: { changes: { collection: string; id: string }[] }[]
}
const stored = async (page: Page) => JSON.parse((await storedData(page)) ?? '{}') as Stored
const anchor = (amountMinor: number, date = '2026-09-15') => ({ amountMinor, date, setAt: `${date}T12:00:00.000Z` })

async function exportBackup(page: Page) {
  await go(page, '/ajustes/copia')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar copia' }).click()])
  return JSON.parse(readFileSync((await download.path())!, 'utf8')) as { data: Stored }
}

/** La app vuelve a leer lo guardado (IndexedDB) y lo acepta: ni pantalla de datos dañados ni presupuesto vacío. */
async function expectLoadsClean(page: Page, label: string) {
  await page.reload()
  // Primero el síntoma del fallo (la pantalla de datos dañados), con su etiqueta; luego el Inicio entero.
  await expect(page.getByText('No pudimos leer tus datos guardados'), label).toHaveCount(0)
  await expect(page.locator('#page-title'), label).toBeVisible()
  await go(page, '/')
  await expect(page.getByTestId('available'), label).toBeVisible()
}

for (const oldLen of [64, 47]) {
  test(`F-01 · factura CAD 400 con id de ${oldLen} caracteres y aviso pospuesto del 1-oct: cambiar a 420 desde el 1-oct se guarda, recarga, se deshace, se exporta y se reimporta`, async ({ page }) => {
    const oldId = 'a'.repeat(oldLen)
    const data = baseData({
      accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(100000) })],
      schedules: [bill('2026-06-01', 40000, { id: oldId, name: 'Luz', frequency: 'monthly' })],
      inbox: { snoozed: [{ id: `due:schedule:${oldId}:2026-10-01`, until: '2026-10-15', at: '2026-09-27T12:00:00.000Z' }], dismissed: [] },
    })
    await seedStoredData(page, data)
    await go(page, `/plan/programado/editar/${oldId}`)
    await page.getByRole('radio', { name: 'Desde una fecha' }).check()
    await expect(page.getByLabel('Desde (primera fecha con los cambios)')).toHaveValue('2026-10-01')
    await page.getByLabel('Importe', { exact: true }).fill('420')
    await page.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(page.getByText(/^Cambio guardado desde el/).first()).toBeVisible()
    await waitForSaved(page)

    const after = await stored(page)
    const next = after.schedules.find((s) => s.id !== oldId)!
    expect(after.schedules.map((s) => [s.amountMinor, s.startDate, s.endDate ?? null])).toEqual([
      [40000, '2026-06-01', '2026-09-30'],
      [42000, '2026-10-01', null],
    ])
    expect(after.inbox.snoozed.map((s) => s.id)).toEqual([`due:schedule:${next.id}:2026-10-01`])
    // Lo guardado contiene ids de aviso más largos que un id de registro (13 + id + 11): es lo que antes no volvía a cargar.
    const snoozeIds = after.history.at(-1)!.changes.filter((c) => c.collection === 'inboxSnoozed').map((c) => c.id.length)
    expect(snoozeIds.sort((a, b) => a - b)).toEqual([24 + next.id.length, 24 + oldLen])
    expect(Math.max(...snoozeIds)).toBeGreaterThan(64)

    // Recarga desde IndexedDB: el presupuesto carga entero (antes: «No pudimos leer tus datos guardados»).
    await expectLoadsClean(page, 'tras partir')
    await expect(page.getByTestId('available')).toHaveText('$1,000.00')

    // Deshacer desde el historial y volver a cargar.
    await go(page, '/ajustes/historial')
    const entry = page.locator('article.history-entry', { hasText: 'Aplazamiento' }).first()
    await entry.getByRole('button', { name: 'Revertir' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Revertir' }).click()
    await expect(page.getByText('Cambio revertido').first()).toBeVisible()
    await waitForSaved(page)
    const back = await stored(page)
    expect(back.schedules.map((s) => [s.id, s.amountMinor, s.endDate ?? null])).toEqual([[oldId, 40000, null]])
    expect(back.inbox.snoozed.map((s) => s.id)).toEqual([`due:schedule:${oldId}:2026-10-01`])
    await expectLoadsClean(page, 'tras deshacer')

    // Exportar la copia (con el historial de la partición y su reversión) y reimportarla.
    const backup = await exportBackup(page)
    expect(backup.data.history.flatMap((e) => e.changes).some((c) => c.collection === 'inboxSnoozed' && c.id.length > 64)).toBe(true)
    await page.getByTestId('import-file').setInputFiles({ name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
    await page.getByRole('dialog', { name: '¿Reemplazar tus datos con esta copia?' }).getByRole('button', { name: 'Reemplazar datos' }).click()
    await expect(page.getByText('Copia importada').first()).toBeVisible()
    await waitForSaved(page)
    await expectLoadsClean(page, 'tras reimportar')
    expect((await stored(page)).inbox.snoozed.map((s) => s.id)).toEqual([`due:schedule:${oldId}:2026-10-01`])
    await expectNoHorizontalScroll(page, 'inicio tras reimportar la copia')
  })
}

/* ------------------------------------------------------------------ */
/* F-02 · deshacer no elimina una serie a la que otros registros apuntan */
/* ------------------------------------------------------------------ */

test('F-02 · una partición grabada por una versión anterior (solo instantáneas de programados): el historial explica qué seguiría apuntando a la serie que desaparecería, no ofrece «Revertir» y nada cambia', async ({ page }) => {
  const rent = bill('2026-06-01', 65000, { id: 'old', name: 'Renta', frequency: 'monthly', categoryId: 'housing' })
  const base = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(100000) })],
    schedules: [rent],
    templates: [{ id: 't', name: 'Quincena', kind: 'distribution', lines: [{ target: { kind: 'payment', scheduleId: 'old' }, amount: { mode: 'fixed', amountMinor: 65000 } }], createdAt: EARLIER, updatedAt: EARLIER }],
    scenarios: [{ id: 'sc', name: 'Si sube', changes: [{ type: 'scheduleAmount', scheduleId: 'old', newAmountMinor: 72000 }], baseFingerprint: 'x', createdAt: EARLIER, updatedAt: EARLIER }],
    inbox: { snoozed: [{ id: 'due:schedule:old:2026-10-01', until: '2026-10-20', at: EARLIER }], dismissed: [] },
  })
  const { createdAt: _c, updatedAt: _u, currency: _cur, skippedDates: _k, ...rest } = rent as Schedule
  const split = saveScheduleFrom(base, 'old', { ...rest, id: 'next', startDate: '2026-10-01', amountMinor: 70000 }, { today: '2026-09-28', now: NOW })
  if (!split.ok) throw new Error(JSON.stringify(split.issues))
  const legacy: HistoryEntry = {
    id: 'h-legacy',
    at: NOW,
    source: 'app',
    changes: [
      { collection: 'schedules', id: 'old', before: rent, after: split.data.schedules.find((s) => s.id === 'old')! },
      { collection: 'schedules', id: 'next', before: null, after: split.data.schedules.find((s) => s.id === 'next')! },
    ],
  }
  const data: AppData = { ...split.data, history: [legacy] }
  await seedStoredData(page, data)
  await go(page, '/ajustes/historial')
  const entry = page.locator('article.history-entry', { hasText: 'Renta' }).first()
  const note = entry.getByTestId('history-dependents')
  await expect(note).toContainText('No se puede revertir: 3 registros seguirían apuntando a un programado que este cambio eliminaría')
  await expect(note).toContainText('Plantilla «Quincena»')
  await expect(note).toContainText('Escenario «Si sube»')
  await expect(note).toContainText('Aviso aplazado del 1 oct')
  await expect(entry.getByRole('button', { name: 'Revertir' })).toHaveCount(0)
  await expectNoHorizontalScroll(page, 'historial con una partición antigua no revertible')
  await page.reload()
  const stored = JSON.parse((await storedData(page)) ?? '{}') as Stored
  expect(stored.schedules.map((s) => s.id).sort()).toEqual(['next', 'old'])
  expect(stored.templates[0]!.lines[0]!.target).toEqual({ kind: 'payment', scheduleId: 'next' })
  expect(stored.inbox.snoozed.map((s) => s.id)).toEqual(['due:schedule:next:2026-10-01'])
})

/* ------------------------------------------------------------------ */
/* F-03 · Análisis: porcentaje exacto                                   */
/* ------------------------------------------------------------------ */

test('F-03 · 1 gasto de MAX_AMOUNT_MINOR el 10-ago frente a 100 el 10-sep: Análisis muestra 9 900 % en vez de fallar', async ({ page }) => {
  const MAX = MAX_AMOUNT_MINOR
  const data = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 0, date: '2026-07-01', setAt: '2026-07-01T12:00:00.000Z' } })],
    transactions: [
      tx({ id: 'p0', date: '2026-08-10', amountMinor: MAX, kind: 'expense', status: 'realized' }),
      ...Array.from({ length: 100 }, (_, i) => tx({ id: `c${i}`, date: '2026-09-10', amountMinor: MAX, kind: 'expense', status: 'realized' })),
    ],
  })
  await seedStoredData(page, data)
  await go(page, '/analisis')
  await expect(page.getByText(/Este mes llevas un 9[\s.,\u00a0]?900 % más de gasto/)).toBeVisible()
  await expectNoHorizontalScroll(page, 'análisis con un porcentaje enorme')
})

/* ------------------------------------------------------------------ */
/* F-04 · «Sin comparación» con contraste AA en oscuro                  */
/* ------------------------------------------------------------------ */

const STATS_JULY = '/estadisticas?periodo=custom&desde=2026-07-01&hasta=2026-07-31'
const statsData = () =>
  baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 500000, date: '2026-01-01', setAt: '2026-01-01T12:00:00.000Z' } })],
    // Solo gastos: ningún ingreso en julio ni antes, así la cifra de ingresos dice «Sin comparación».
    transactions: [tx({ id: 'e1', date: '2026-07-10', amountMinor: 12345, kind: 'expense', status: 'realized' }), tx({ id: 'e2', date: '2026-06-05', amountMinor: 2000, kind: 'expense', status: 'realized' })],
  })

/** Contraste calculado del texto sobre el primer fondo opaco que lo rodea (WCAG 2.x). */
async function textContrast(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null
    if (!el) throw new Error(`no hay ${sel}`)
    const parse = (c: string) => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c)
      return m ? { r: +m[1]!, g: +m[2]!, b: +m[3]!, a: m[4] === undefined ? 1 : +m[4] } : null
    }
    const fg = parse(getComputedStyle(el).color)!
    let node: HTMLElement | null = el
    let bg = null as ReturnType<typeof parse>
    while (node && (!bg || bg.a === 0)) {
      bg = parse(getComputedStyle(node).backgroundColor)
      node = node.parentElement
    }
    const lum = (c: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
    }
    const [a, b] = [lum(fg), lum(bg!)]
    return { fg: getComputedStyle(el).color, bg: `rgb(${bg!.r}, ${bg!.g}, ${bg!.b})`, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), fontSize: getComputedStyle(el).fontSize, fontWeight: getComputedStyle(el).fontWeight }
  }, selector)
}

async function expectNeutralDeltaAA(page: Page, label: string) {
  await go(page, STATS_JULY)
  const neutral = page.locator('.stat__delta--neutral').first()
  await expect(neutral, label).toBeVisible()
  await expect(neutral, label).toHaveText('Sin comparación')
  await settleAnimations(page)
  const c = await textContrast(page, '.stat__delta--neutral')
  expect(c.ratio, `${label}: ${c.fg} sobre ${c.bg} (${c.fontSize}/${c.fontWeight})`).toBeGreaterThanOrEqual(4.5)
  const results = await new AxeBuilder({ page }).include('#main').withRules(['color-contrast']).analyze()
  expect(results.violations.map((v) => v.nodes.map((n) => n.target.join(' ')).join(' | ')), label).toEqual([])
}

test('F-04 · tema «Oscuro» explícito: «Sin comparación» (julio personalizado sin ingresos previos) cumple AA y axe no encuentra fallos de contraste', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('clara.theme', 'dark'))
  await seedStoredData(page, statsData())
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expectNeutralDeltaAA(page, 'oscuro explícito')
})

test.describe('F-04 · tema «Sistema» con el sistema en oscuro', () => {
  test.use({ colorScheme: 'dark' })
  test('«Sin comparación» cumple AA y axe no encuentra fallos de contraste', async ({ page }) => {
    // «Sistema» explícito (la app arranca en «Oscuro» si no hay preferencia): sin `data-theme`, manda el sistema.
    await page.addInitScript(() => localStorage.setItem('clara.theme', 'system'))
    await seedStoredData(page, statsData())
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./)
    await expectNeutralDeltaAA(page, 'sistema oscuro')
  })
})

test('F-04 · en claro sigue cumpliendo AA y las variaciones positiva y negativa conservan su color', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('clara.theme', 'light'))
  await seedStoredData(page, statsData())
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expectNeutralDeltaAA(page, 'claro')
  // El gasto de julio (123,45) frente al de junio (20,00): variación con tono, no neutra.
  await expect(page.locator('.stat__delta--bad, .stat__delta--good').first()).toBeVisible()
})

/* ------------------------------------------------------------------ */
/* QA-01 histórico · revisión y reparación de particiones antiguas      */
/* ------------------------------------------------------------------ */

const MARCH = new Date('2026-03-15T12:00:00-04:00')
/** La auditoría (esquema 13, hecho por 819eaa9): saldo CAD 1 800, seguro de 1 250 el 29-mar, sueldo del 31 partido el 28-feb solo por importe. */
const v13Audit = () => ({
  ...baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: { amountMinor: 180000, date: '2026-03-01', setAt: '2026-03-01T12:00:00.000Z' } })],
    schedules: [
      income('2026-01-31', 300000, { id: 'salary-old', name: 'Sueldo', frequency: 'monthly', endDate: '2026-02-27' }),
      income('2026-02-28', 320000, { id: 'salary-new', name: 'Sueldo', frequency: 'monthly' }),
      bill('2026-03-29', 125000, { id: 'bill', name: 'Seguro', frequency: 'once' }),
    ],
  }),
  schemaVersion: 13,
})

async function seedV13(page: Page) {
  await openApp(page, MARCH)
  await expect(page.getByRole('heading', { name: 'Hola, esto es Clara' })).toBeVisible()
  await writeStoredData(page, v13Audit())
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
}

test('QA-01 histórico · datos v13 con el sueldo del 31 partido el 28-feb: tras migrar, Ajustes › Datos lo muestra (28-mar frente a 31-mar); restaurar deja 1 250 reservados y $550.00 disponibles tras recargar y en la copia', async ({ page }) => {
  await seedV13(page)
  // Lo que vio la auditoría: horizonte 28-mar, el seguro del 29 fuera, 1 800 disponibles.
  await expect(await available(page)).toHaveText('$1,800.00')
  await go(page, '/ajustes/datos')
  const card = page.getByTestId('split-repair')
  await expect(card).toBeVisible()
  await expect(card.getByTestId('split-repair-current')).toContainText('28 mar')
  await expect(card.getByTestId('split-repair-proposed')).toContainText('31 mar')
  await expect(card.getByTestId('split-repair-proposed')).toContainText('30 abr')
  await expectNoHorizontalScroll(page, 'revisión de particiones antiguas')
  await card.getByRole('button', { name: 'Restaurar las fechas de siempre' }).click()
  const dialog = page.getByRole('dialog', { name: '¿Restaurar las fechas de siempre de «Sueldo»?' })
  await expect(dialog).toContainText('31 mar')
  await dialog.getByRole('button', { name: 'Restaurar las fechas de siempre' }).click()
  await expect(page.getByText('Fechas de siempre restauradas').first()).toBeVisible()
  await waitForSaved(page)
  await expect(card).toHaveCount(0)
  const stored = JSON.parse((await storedData(page)) ?? '{}') as Stored
  expect(stored.schedules.find((s) => s.id === 'salary-new')).toMatchObject({ startDate: '2026-02-28', anchorDate: '2026-01-31', amountMinor: 320000 })
  expect(stored.schedules.find((s) => s.id === 'salary-old')).toMatchObject({ startDate: '2026-01-31', endDate: '2026-02-27' })
  expect(stored.schedules.find((s) => s.id === 'salary-old')?.anchorDate).toBeUndefined()

  await page.reload()
  await go(page, '/')
  await expect(await available(page)).toHaveText('$550.00')
  await expect(page.getByTestId('split-repair')).toHaveCount(0)
  // El cambio queda en el historial (se puede revertir) y la copia local previa existe.
  await go(page, '/ajustes/historial')
  await expect(page.locator('article.history-entry').first()).toContainText('Sueldo')
  await expect(page.locator('article.history-entry').first().getByRole('button', { name: 'Revertir' })).toBeVisible()
  await go(page, '/ajustes/copias-locales')
  await expect(page.locator('#main')).toContainText(/Antes de restaurar|antes de restaurar/)
  // Exportar e importar la copia conserva la reparación.
  const backup = await exportBackup(page)
  expect(backup.data.schedules.find((s) => s.id === 'salary-new')?.anchorDate).toBe('2026-01-31')
  await page.getByTestId('import-file').setInputFiles({ name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await page.getByRole('dialog', { name: '¿Reemplazar tus datos con esta copia?' }).getByRole('button', { name: 'Reemplazar datos' }).click()
  await expect(page.getByText('Copia importada').first()).toBeVisible()
  await waitForSaved(page)
  await go(page, '/')
  await expect(await available(page)).toHaveText('$550.00')
})

test('QA-01 histórico · «Dejar como está» conserva el 28 a propósito: la revisión desaparece, sigue sin aparecer tras recargar y el disponible sigue siendo $1,800.00', async ({ page }) => {
  await seedV13(page)
  await go(page, '/ajustes/datos')
  const card = page.getByTestId('split-repair')
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Dejar como está' }).click()
  await expect(page.getByText('Se deja como está').first()).toBeVisible()
  await waitForSaved(page)
  await expect(card).toHaveCount(0)
  await page.reload()
  await go(page, '/ajustes/datos')
  await expect(page.getByTestId('split-repair')).toHaveCount(0)
  const stored = JSON.parse((await storedData(page)) ?? '{}') as Stored
  expect(stored.schedules.find((s) => s.id === 'salary-new')?.anchorDate).toBeUndefined()
  expect(stored.inbox.dismissed.map((d) => d.id)).toEqual(['int:split:salary-new'])
  await go(page, '/')
  await expect(await available(page)).toHaveText('$1,800.00')
})
