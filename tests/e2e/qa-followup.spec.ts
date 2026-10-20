import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { account, baseData, bill } from '../../src/test/fixtures'
import { expectNoHorizontalScroll, go, seedStoredData, storedData, waitForSaved } from './helpers'

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

