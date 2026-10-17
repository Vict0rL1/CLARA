import { mkdirSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { MAX_AMOUNT_MINOR } from '../../src/domain/money'
import { baseData, bill, tx } from '../../src/test/fixtures'
import { expectNoHorizontalScroll, go, openDetails, reloadWhenSaved, seedStoredData, startDemo, storedData, waitForSaved } from './helpers'
import { tinyPng } from './png'

/**
 * Aceptación de navegador de los hallazgos de QA V2 (auditoría independiente del 2026-10-15 sobre 43b4d74):
 * CUR-01/02/03 (monedas escritas), FIN-01 (rango exacto del resumen de pagos recurrentes), STAT-01 (fechas
 * personalizadas de Estadísticas en la dirección) y SCH-01 (partir un «dos veces al mes»). Datos sintéticos.
 * El OCR es un `TextDetector` simulado con texto fijo: no prueba una cámara ni un servicio de OCR reales.
 */
type Stored = {
  transactions: { id: string; amountMinor: number; currency: string; note?: string }[]
  schedules: { id: string; name: string; amountMinor: number; startDate: string; endDate?: string; secondDay?: number; paused?: boolean }[]
}
const stored = async (page: Page) => JSON.parse((await storedData(page)) ?? '{}') as Stored

/**
 * Captura opcional para el informe (`QA_V2_SHOTS=dir`): la pantalla visible del celular, centrada en lo que
 * importa (si existe), en JPEG a tamaño CSS para no inflar el repositorio. No cambia la prueba.
 */
async function shot(page: Page, name: string, focus?: Locator) {
  const dir = process.env.QA_V2_SHOTS
  if (!dir || test.info().project.name !== 'celular') return
  mkdirSync(dir, { recursive: true })
  if (focus && (await focus.count()) > 0) await focus.first().evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.screenshot({ path: `${dir}/${name}.jpg`, type: 'jpeg', quality: 70, scale: 'css' })
}

test('CUR-01 · «coffee USD $10» en CAD conserva USD y bloquea la línea; corregida, se registra en CAD y sobrevive a recargar', { tag: '@smoke' }, async ({ page }) => {
  await startDemo(page)
  const before = (await stored(page)).transactions.length
  await go(page, '/asistente')
  await page.getByLabel('Texto').fill('coffee USD $10\ntea $4')
  await page.getByRole('button', { name: 'Analizar' }).click()
  const lines = page.getByTestId('assistant-preview').locator('.assistant__line')
  await expect(lines).toHaveCount(2)
  const coffee = lines.first()
  await shot(page, 'cur01-assistant', coffee.getByLabel('Importe'))
  await expect(coffee.getByLabel('Importe')).toHaveValue('10.00 USD')
  await expect(coffee.getByText('El importe está en USD; este presupuesto usa CAD. No se convierte.')).toBeVisible()
  await expect(coffee.getByTestId('review-currency')).toContainText('Escribiste USD; este presupuesto usa CAD')
  await expect(lines.nth(1).getByLabel('Importe')).toHaveValue('4.00')
  await expect(page.getByTestId('assistant-currency-blocked')).toContainText('1 línea está en otra moneda')
  const register = page.getByRole('button', { name: 'Registrar 2 movimientos' })
  await expect(register).toBeDisabled()
  await register.click({ force: true })
  expect((await stored(page)).transactions).toHaveLength(before)
  await expectNoHorizontalScroll(page, 'asistente con una línea bloqueada por moneda')

  // La persona escribe el importe en CAD: ya se puede registrar, y se guarda en CAD.
  await coffee.getByLabel('Importe').fill('10')
  await expect(page.getByTestId('assistant-currency-blocked')).toHaveCount(0)
  await register.click()
  await expect(page.getByText('2 movimientos registrados').first()).toBeVisible()
  await reloadWhenSaved(page)
  await expect(page.getByTestId('available')).toBeVisible()
  const saved = (await stored(page)).transactions.filter((t) => t.note === 'coffee' || t.note === 'tea')
  expect(saved.map((t) => [t.note, t.amountMinor, t.currency]).sort()).toEqual([
    ['coffee', 1000, 'CAD'],
    ['tea', 400, 'CAD'],
  ])
})

test('CUR-01/02 · dos monedas distintas en el asistente: el campo conserva las dos y la línea no se registra', async ({ page }) => {
  await startDemo(page)
  const before = await storedData(page)
  await go(page, '/asistente')
  await page.getByLabel('Texto').fill('coffee USD 10 CAD')
  await page.getByRole('button', { name: 'Analizar' }).click()
  const line = page.getByTestId('assistant-preview').locator('.assistant__line').first()
  await shot(page, 'cur02-assistant-conflict', line.getByLabel('Importe'))
  await expect(line.getByLabel('Importe')).toHaveValue('USD 10.00 CAD')
  await expect(line.getByText('El importe tiene dos monedas distintas (USD y CAD). No se convierte: escribe solo el número en CAD.')).toBeVisible()
  await expect(line.getByTestId('review-currency')).toContainText('Escribiste USD y CAD; este presupuesto usa CAD')
  const register = page.getByRole('button', { name: 'Registrar 1 movimiento' })
  await expect(register).toBeDisabled()
  await register.click({ force: true })
  await line.getByLabel('Importe').press('Enter')
  await waitForSaved(page)
  expect(await storedData(page)).toBe(before)
})

test('CUR-02 · formulario, CSV y atajo: una contradicción nunca se acepta como CAD; lo compatible sí', async ({ page }) => {
  await startDemo(page)
  const count = async () => (await stored(page)).transactions.length
  const before = await count()

  // Formulario manual.
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe').fill('USD 10 CAD')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await shot(page, 'cur02-form', page.getByLabel('Importe'))
  await expect(page.getByText('El importe tiene dos monedas distintas (USD y CAD). No se convierte: escribe solo el número en CAD.')).toBeVisible()
  expect(await count()).toBe(before)
  await page.getByLabel('Importe').fill('$10 CAD')
  await openDetails(page)
  await page.getByLabel('Nota (opcional)').fill('Compatible')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  await waitForSaved(page)
  expect((await stored(page)).transactions.find((t) => t.note === 'Compatible')).toMatchObject({ amountMinor: 1000, currency: 'CAD' })

  // CSV del banco.
  // La fila CAD lleva otro importe: «-10 CAD» sería un posible duplicado del «$10 CAD» de arriba (y quedaría desmarcada).
  const csv = ['Date,Description,Amount', '2026-09-27,Signed conflict,-USD 10 CAD', '2026-09-27,Euro conflict,€10 CAD', '2026-09-27,Plain CAD,-7.25 CAD'].join('\r\n')
  await go(page, '/movimientos/importar')
  await page.getByTestId('bank-file').setInputFiles({ name: 'banco.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByRole('heading', { name: '3. Revisa y confirma' })).toBeVisible()
  await shot(page, 'cur02-csv', page.getByTestId('import-currency-note'))
  await expect(page.getByText('2 con error')).toBeVisible()
  await expect(page.getByText('Dos monedas distintas (USD y CAD); este presupuesto usa CAD')).toBeVisible()
  await expect(page.getByText('Dos monedas distintas (€ y CAD); este presupuesto usa CAD')).toBeVisible()
  await expect(page.getByTestId('import-currency-note')).toContainText('2 filas')
  await openDetails(page)
  await expect(page.getByRole('checkbox', { name: /Signed conflict/ })).toBeDisabled()
  await expect(page.getByRole('checkbox', { name: /Euro conflict/ })).toBeDisabled()
  await page.getByRole('button', { name: 'Importar 1 movimiento' }).click()
  await expect(page.getByText('1 movimiento importado')).toBeVisible()
  await waitForSaved(page)
  const notes = (await stored(page)).transactions.map((t) => t.note)
  expect(notes).toContain('Plain CAD')
  expect(notes).not.toContain('Signed conflict')
  expect(notes).not.toContain('Euro conflict')

  // Enlace de un atajo: el importe contradictorio queda vacío y se dice; nada se guarda solo.
  await go(page, '/movimientos/nuevo?kind=expense&importe=USD%2010%20CAD&source=shortcut')
  await expect(page.getByText('No se entendió el importe del atajo')).toBeVisible()
  await expect(page.getByLabel('Importe')).toHaveValue('')
})

/** `TextDetector` simulado: devuelve estas líneas para cualquier imagen (texto OCR sintético). */
async function fakeTextDetector(page: Page, lines: readonly string[]) {
  await page.addInitScript((ls) => {
    ;(window as unknown as { TextDetector: unknown }).TextDetector = class {
      async detect() {
        return ls.map((rawValue, i) => ({ rawValue, boundingBox: { x: 0, y: i * 20, width: 200, height: 16 } }))
      }
    }
  }, lines)
}

test('CUR-03 · foto: «TOTAL PEN 10.00» propone 10.00 PEN y bloquea la línea; corregida, se registra en CAD', async ({ page }) => {
  await fakeTextDetector(page, ['SHOP', 'TOTAL PEN 10.00'])
  await startDemo(page)
  await go(page, '/asistente')
  await page.getByTestId('photo-input').setInputFiles({ name: 'recibo.png', mimeType: 'image/png', buffer: tinyPng(8) })
  const line = page.getByTestId('assistant-preview').locator('.assistant__line').first()
  await expect(line).toBeVisible()
  await shot(page, 'cur03-receipt', line.getByLabel('Importe'))
  await expect(line.getByLabel('Importe')).toHaveValue('10.00 PEN')
  await expect(line.getByText('El importe está en PEN; este presupuesto usa CAD. No se convierte.')).toBeVisible()
  const register = page.getByRole('button', { name: 'Registrar 1 movimiento' })
  await expect(register).toBeDisabled()
  await line.getByLabel('Importe').fill('13.70')
  await register.click()
  await expect(page.getByText('1 movimiento registrado').first()).toBeVisible()
  await reloadWhenSaved(page)
  await expect(page.getByTestId('available')).toBeVisible()
  expect((await stored(page)).transactions.find((t) => t.amountMinor === 1370)).toMatchObject({ currency: 'CAD' })
})

test('CUR-03 · control: «PEN 2.99» en una línea de artículo es un bolígrafo; el total se propone en CAD', async ({ page }) => {
  await fakeTextDetector(page, ['STAPLES', 'PEN 2.99', 'TOTAL 2.99'])
  await startDemo(page)
  await go(page, '/asistente')
  await page.getByTestId('photo-input').setInputFiles({ name: 'recibo.png', mimeType: 'image/png', buffer: tinyPng(8) })
  const line = page.getByTestId('assistant-preview').locator('.assistant__line').first()
  await expect(line.getByLabel('Importe')).toHaveValue('2.99')
  await expect(page.getByTestId('assistant-currency-blocked')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Registrar 1 movimiento' })).toBeEnabled()
})

test('FIN-01 · 25 pagos diarios de 10^12: el calendario se abre, dice que el total no se puede calcular exacto y se recupera al pausar uno', async ({ page }) => {
  // Datos extremos: cada mes tiene ~775 pagos en la agenda y cambiar de mes tarda ~1–5 s en este Chromium (medido;
  // límite conocido, ver el informe de QA V2). Más tiempo para los 12 cambios de mes; las comprobaciones son las mismas.
  test.setTimeout(120_000)
  const schedules = Array.from({ length: 25 }, (_, i) => bill('2026-09-28', MAX_AMOUNT_MINOR, { id: `d${i}`, name: `Diario ${i}`, frequency: 'daily' }))
  await seedStoredData(page, baseData({ schedules }))
  const before = await stored(page)
  await go(page, '/plan/calendario')
  await shot(page, 'fin01-calendar', page.getByTestId('recurring-summary'))
  await expect(page.getByText('No se pudo abrir esta pantalla')).toHaveCount(0)
  const summary = page.getByTestId('recurring-summary')
  await expect(summary.getByTestId('recurring-out-of-range')).toContainText('más de lo que Clara puede calcular con exactitud')
  await expect(summary.getByText('Pagos fijos al mes')).toHaveCount(0)
  await expectNoHorizontalScroll(page, 'calendario con importes fuera de rango')

  // Un año más adelante la proyección ya no es exacta: esos días no tienen cifra (y la pantalla sigue abierta).
  for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'Mes siguiente' }).click()
  await expect(page.getByText('No se pudo abrir esta pantalla')).toHaveCount(0)
  await page.locator('.cal-day').filter({ has: page.locator('.cal-day__num', { hasText: /^−?25$/ }) }).click()
  await expect(page.getByTestId('day-balance')).toHaveAttribute('data-state', 'beyond')
  await expect(page.getByTestId('day-balance')).toContainText('supera lo que Clara puede calcular con exactitud')
  await shot(page, 'fin01-calendar-beyond', page.getByTestId('day-balance'))

  // Ver el calendario no cambia nada de lo guardado.
  expect(await stored(page)).toEqual(before)

  // Recuperación: con uno en pausa el total vuelve a caber y se muestra exacto.
  await go(page, '/plan/programado/editar/d0')
  await page.getByRole('checkbox', { name: 'En pausa' }).check()
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Programación guardada').first()).toBeVisible()
  await go(page, '/plan/calendario')
  await expect(summary.getByTestId('recurring-out-of-range')).toHaveCount(0)
  await expect(summary.getByText('Pagos fijos al mes')).toBeVisible()
  const after = await stored(page)
  expect(after.schedules.find((s) => s.id === 'd0')).toMatchObject({ paused: true, amountMinor: MAX_AMOUNT_MINOR })
  expect(after.schedules.filter((s) => s.id !== 'd0')).toEqual(before.schedules.filter((s) => s.id !== 'd0'))
})

test('STAT-01 · las fechas personalizadas viven en la dirección: sobreviven a un filtro, a recargar y a editarlas', async ({ page }) => {
  await startDemo(page)
  await go(page, '/estadisticas?periodo=custom&desde=2026-08-01&hasta=2026-08-31')
  const start = page.getByLabel('Inicio del periodo personalizado')
  const end = page.getByLabel('Fin del periodo personalizado')
  await expect(start).toHaveValue('2026-08-01')
  await expect(end).toHaveValue('2026-08-31')
  await page.getByTestId('stats-filters').locator('summary').click()
  await page.getByTestId('stats-filters').getByLabel('Cuenta').selectOption({ index: 1 })
  await expect(page.getByTestId('stats-filter-active')).toBeVisible()
  await shot(page, 'stat01-filter', page.getByLabel('Inicio del periodo personalizado'))
  await expect(start).toHaveValue('2026-08-01')
  await expect(end).toHaveValue('2026-08-31')
  expect(new URL(page.url()).hash).toMatch(/desde=2026-08-01/)
  expect(new URL(page.url()).hash).toMatch(/hasta=2026-08-31/)
  expect(new URL(page.url()).hash).toMatch(/cuenta=/)

  await page.reload()
  await expect(page.getByLabel('Inicio del periodo personalizado')).toHaveValue('2026-08-01')
  await expect(page.getByLabel('Fin del periodo personalizado')).toHaveValue('2026-08-31')
  await expect(page.getByTestId('stats-filter-active')).toBeVisible()

  // Editar una fecha la cambia en la dirección (sin perder el foco ni el filtro).
  await page.getByLabel('Fin del periodo personalizado').fill('2026-08-15')
  await expect.poll(() => new URL(page.url()).hash).toMatch(/hasta=2026-08-15/)
  await page.reload()
  await expect(page.getByLabel('Fin del periodo personalizado')).toHaveValue('2026-08-15')
  await expect(page.getByLabel('Inicio del periodo personalizado')).toHaveValue('2026-08-01')
  await expect(page.getByTestId('stats-filter-active')).toBeVisible()
})

test('SCH-01 · partir un «dos veces al mes» (15 y 30) desde el 30 conserva los días; volver a «todas» restaura; el borde de fin de mes se dice', async ({ page }) => {
  const paid = ['2026-06-15', '2026-06-30', '2026-07-15', '2026-07-30', '2026-08-15', '2026-08-30', '2026-09-15']
  const data = baseData({
    schedules: [
      bill('2026-06-15', 50000, { id: 'gym', name: 'Gimnasio', frequency: 'semimonthly', secondDay: 30 }),
      bill('2026-06-15', 2000, { id: 'eom', name: 'Ahorro quincenal', frequency: 'semimonthly', secondDay: 31 }),
    ],
    transactions: paid.map((d, i) => tx({ id: `g${i}`, date: d, amountMinor: 50000, scheduleId: 'gym', occurrenceDate: d })),
  })
  await seedStoredData(page, data)
  await go(page, '/plan/programado/editar/gym')
  const second = page.getByLabel('Segundo día del mes')
  await expect(second).toHaveValue('30')
  await page.getByRole('radio', { name: 'Desde una fecha' }).check()
  await expect(page.getByLabel('Desde (primera fecha con los cambios)')).toHaveValue('2026-09-30')
  await shot(page, 'sch01-split', page.getByLabel('Segundo día del mes'))
  await expect(second).toHaveValue('15')
  await expect(page.getByText('Se repite el día 15 y el día 30 de cada mes.', { exact: false })).toBeVisible()
  // Volver a «todas las fechas» deja todo como estaba.
  await page.getByRole('radio', { name: 'A todas las fechas' }).check()
  await expect(second).toHaveValue('30')
  await expect(page.getByLabel('Próxima fecha')).toHaveValue('2026-06-15')

  await page.getByRole('radio', { name: 'Desde una fecha' }).check()
  await page.getByLabel('Importe', { exact: true }).fill('550')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText(/^Cambio guardado desde el/).first()).toBeVisible()
  await waitForSaved(page)
  const gyms = (await stored(page)).schedules.filter((s) => s.name === 'Gimnasio')
  expect(gyms.map((s) => [s.amountMinor, s.startDate, s.endDate ?? null, s.secondDay ?? null])).toEqual([
    [50000, '2026-06-15', '2026-09-29', 30],
    [55000, '2026-09-30', null, 15],
  ])

  // 15 y 31: el 30-sep es el 31 movido. Partir ahí cambiaría el día; se dice y se propone una fecha que lo conserva.
  await go(page, '/plan/programado/editar/eom')
  await page.getByRole('radio', { name: 'Desde una fecha' }).check()
  await expect(page.getByLabel('Desde (primera fecha con los cambios)')).toHaveValue('2026-09-30')
  await expect(page.getByLabel('Segundo día del mes')).toHaveValue('15')
  const drift = page.getByTestId('split-anchor-drift')
  await expect(drift).toContainText('31')
  await expect(drift).toContainText('15 oct')
  await shot(page, 'sch01-month-end', page.getByTestId('split-anchor-drift'))
  await expectNoHorizontalScroll(page, 'partir un programado en un fin de mes movido')
})
