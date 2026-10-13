import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { START, available, go, openDetails, pickCategory, setLanguage, startDemo, storedData, writeStoredData, type UiLanguage } from './helpers'

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

test('10 · CSV: dos descripciones largas que empiezan igual no se omiten; un archivo de 5,003 filas dice cuáles quedan fuera y exige reconocerlo', async ({ page }) => {
  await startDemo(page)
  const P = 'COMPRA TARJETA 4521 SUPERMERCADO EL AHORRO SUCURSAL CENTRO AVENIDA PRINCIPAL 1234 C'
  const load = async (text: string) => {
    await go(page, '/movimientos/importar')
    await page.getByTestId('bank-file').setInputFiles({ name: 'banco.csv', mimeType: 'text/csv', buffer: Buffer.from(text) })
    await expect(page.getByRole('heading', { name: '3. Revisa y confirma' })).toBeVisible()
  }
  await load(['Date,Description,Amount', `2026-09-27,${P} REF 0001,-45.10`].join('\n'))
  await page.getByRole('button', { name: 'Importar 1 movimiento' }).click()
  await expect(page.getByText('1 movimiento importado').first()).toBeVisible()
  // El extracto siguiente trae otra compra distinta con los mismos 80 primeros caracteres: se revisa, no se omite.
  await load(['Date,Description,Amount', `2026-09-27,${P} REF 0002,-45.10`].join('\n'))
  await expect(page.getByText('1 posible duplicado')).toBeVisible()
  await expect(page.getByText('ya importado')).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: /REF 0002/ })).not.toBeChecked()

  const rows = Array.from({ length: 5003 }, (_, i) => `2026-09-27,Fila ${i + 1},-1.00`)
  await load(['Date,Description,Amount', ...rows].join('\n'))
  await expect(page.getByText('El archivo tiene 5,003 filas y Clara analiza como máximo 5,000 por vez: las filas 5,002 a 5,004 (3) no se muestran ni se importarán.')).toBeVisible()
  await expect(page.getByTestId('import-omitted')).toContainText('Divide el archivo')
  const confirm = page.getByRole('button', { name: /^Importar \d+ movimientos$/ })
  await expect(confirm).toBeDisabled()
  await page.getByLabel('Entiendo que 3 filas del archivo quedan fuera de esta importación').check()
  await expect(confirm).toBeEnabled()
})

/** Contraste WCAG entre el `fill` de un texto SVG y el primer fondo opaco de sus antecesores. */
async function svgTextContrast(page: import('@playwright/test').Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([^)]+)\)/)
      if (!m) return null
      const [r, g, b, a] = m[1]!.split(',').map((x) => Number(x.trim()))
      return { r: r!, g: g!, b: b!, a: a ?? 1 }
    }
    const lum = (c: { r: number; g: number; b: number }) => {
      const ch = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b)
    }
    let bg = null as ReturnType<typeof parse>
    for (let n: Element | null = el; n && !bg; n = n.parentElement) {
      const p = parse(getComputedStyle(n).backgroundColor)
      if (p && p.a > 0) bg = p
    }
    const fg = parse(getComputedStyle(el).fill)
    if (!fg || !bg) return 0
    return (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05)
  })
}

for (const theme of ['light', 'dark'] as const) {
  test(`12 · el total y el subtítulo del donut cumplen contraste AA en tema ${theme === 'light' ? 'claro' : 'oscuro'} (axe no mide el texto SVG)`, async ({ page }) => {
    // El tema es una preferencia del dispositivo (oscuro por defecto): se fija antes de abrir la app.
    await page.addInitScript((t) => localStorage.setItem('clara.theme', t), theme)
    await startDemo(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await go(page, '/estadisticas')
    await expect(page.locator('.donut__total').first()).toBeVisible()
    expect(await svgTextContrast(page, '.donut__total')).toBeGreaterThanOrEqual(4.5)
    expect(await svgTextContrast(page, '.donut__sub')).toBeGreaterThanOrEqual(4.5)
  })
}

test('13 · texto al 200 % en 320 px: Cuentas, Metas, Datos y Calendario sin desplazamiento horizontal en es/en/pt/fr; la barra inferior entera, nada tapado y el foco visible', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular-pequeno', 'el caso es la pantalla de 320 px')
  test.setTimeout(240_000)
  await startDemo(page)
  const languages: UiLanguage[] = ['Español', 'English', 'Português', 'Français']
  for (const language of languages) {
    await setLanguage(page, language)
    for (const route of ['/ajustes/cuentas', '/plan/metas', '/ajustes/datos', '/plan/calendario']) {
      await go(page, route)
      // Igual que la auditoría: tamaño de letra raíz al 200 % (las medidas de la app están en rem).
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
      const where = `${language} ${route}`
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { message: where }).toBeLessThanOrEqual(320)
      const layout = await page.evaluate(() => {
        const nav = document.querySelector('.nav')!.getBoundingClientRect()
        const items = Array.from(document.querySelectorAll('.nav .nav__item')).map((el) => {
          const r = el.getBoundingClientRect()
          const label = el.querySelector('.nav__label') as HTMLElement
          return { left: r.left, right: r.right, bottom: r.bottom, truncated: label.scrollWidth > label.clientWidth + 1 }
        })
        const main = document.querySelector('.main') as HTMLElement
        return { navHeight: nav.height, navBottom: nav.bottom, items, padding: parseFloat(getComputedStyle(main).paddingBottom), vh: window.innerHeight }
      })
      expect(layout.items, where).toHaveLength(6)
      for (const item of layout.items) {
        expect(item.left, where).toBeGreaterThanOrEqual(0)
        expect(item.right, where).toBeLessThanOrEqual(320)
        expect(item.bottom, where).toBeLessThanOrEqual(layout.vh + 1)
        expect(item.truncated, where).toBe(false)
      }
      // El relleno inferior del contenido cubre el alto real de la barra (una o dos filas).
      expect(layout.padding, where).toBeGreaterThanOrEqual(layout.navHeight)
    }
  }
  // Teclado: el elemento enfocado se ve (contorno o sombra) y queda dentro de la pantalla.
  await page.keyboard.press('Tab')
  const focus = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return { visible: cs.outlineStyle !== 'none' || cs.boxShadow !== 'none', left: r.left, right: r.right }
  })
  expect(focus.visible).toBe(true)
  expect(focus.left).toBeGreaterThanOrEqual(0)
  expect(focus.right).toBeLessThanOrEqual(320)
})
