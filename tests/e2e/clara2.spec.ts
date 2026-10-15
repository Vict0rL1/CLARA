import { expect, test, type Page } from '@playwright/test'
import { go, openDetails, openExplain, pickCategory, setupFirstUse, startDemo, storedData } from './helpers'

/**
 * Clara 2.0 · fase 1 (cimientos), de punta a punta: colchón de seguridad en «Puedes gastar»,
 * pagos dos veces al mes y los tipos de cuenta nuevos. Parte de la configuración de
 * `docs/MANUAL-TEST.md` (disponible = $400.00).
 */
type Stored = {
  settings: { safeToSpend: { bufferMinor: number } }
  schedules: { name: string; frequency: string; startDate: string; secondDay?: number }[]
  accounts: { name: string; kind: string; institution?: string; includeInBudget: boolean }[]
}
const stored = async (page: Page) => JSON.parse((await storedData(page)) ?? '{}') as Stored

test('colchón de seguridad: se resta de «Puedes gastar», se explica, sobrevive a recargar y se puede quitar', async ({ page }) => {
  await setupFirstUse(page)
  await go(page, '/ajustes/safe-to-spend')
  await page.getByLabel('Colchón de seguridad').fill('50')
  await page.getByTestId('save-buffer').click()
  await expect(page.getByText('Colchón guardado')).toBeVisible()
  expect((await stored(page)).settings.safeToSpend.bufferMinor).toBe(5000)

  await go(page, '/')
  await expect(page.getByTestId('available')).toHaveText('$350.00')
  await openExplain(page)
  await expect(page.getByText('Colchón de seguridad (se descuenta)')).toBeVisible()

  await page.reload()
  await go(page, '/')
  await expect(page.getByTestId('available')).toHaveText('$350.00')

  // Un colchón mayor que lo que queda: pagos y apartados siguen cubiertos, así que es un aviso
  // («usando tu colchón»), nunca la alarma de «te faltan … para cubrir pagos».
  await go(page, '/ajustes/safe-to-spend')
  await expect(page.getByLabel('Colchón de seguridad')).toHaveValue('50.00')
  await page.getByLabel('Colchón de seguridad').fill('450')
  await page.getByTestId('save-buffer').click()
  await expect(page.getByText('Colchón guardado').first()).toBeVisible()
  await go(page, '/')
  await expect(page.getByTestId('available')).toHaveText('-$50.00')
  await expect(page.getByText('Estás usando $50.00 de tu colchón de $450.00')).toBeVisible()
  await expect(page.getByText(/Te faltan .* para cubrir pagos y apartados/)).toHaveCount(0)

  // Vacío = sin colchón: vuelve la cifra de siempre y desaparece la línea de la explicación.
  await go(page, '/ajustes/safe-to-spend')
  await expect(page.getByLabel('Colchón de seguridad')).toHaveValue('450.00')
  await page.getByLabel('Colchón de seguridad').fill('')
  await page.getByTestId('save-buffer').click()
  await expect(page.getByText('Colchón guardado').first()).toBeVisible()
  await go(page, '/')
  await expect(page.getByTestId('available')).toHaveText('$400.00')
  await openExplain(page)
  await expect(page.getByText('Colchón de seguridad (se descuenta)')).toHaveCount(0)
})

test('dos veces al mes: el segundo día se elige, se explica y se valida antes de guardar', async ({ page }) => {
  await setupFirstUse(page)
  await go(page, '/plan/programado/nuevo')
  await page.getByLabel('Nombre').fill('Seguro')
  await page.getByLabel('Importe', { exact: true }).fill('10')
  await page.getByLabel('Frecuencia').selectOption('semimonthly')
  await page.getByLabel('Próxima fecha').fill('2026-10-15')
  const second = page.getByLabel('Segundo día del mes')
  // Vacío: 15 días después del primero, y la ayuda lo dice.
  await expect(page.getByText('Se repite el día 15 y el día 30 de cada mes')).toBeVisible()
  // Demasiado cerca del primero: error asociado al campo y nada se guarda.
  await second.fill('18')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('El segundo día debe estar entre 1 y 31 y a 7 días o más del primero.')).toBeVisible()
  expect((await stored(page)).schedules.some((s) => s.name === 'Seguro')).toBe(false)

  await second.fill('31')
  await expect(page.getByText('Se repite el día 15 y el día 31 de cada mes')).toBeVisible()
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Programación guardada')).toBeVisible()
  const saved = (await stored(page)).schedules.find((s) => s.name === 'Seguro')
  expect(saved).toMatchObject({ frequency: 'semimonthly', startDate: '2026-10-15', secondDay: 31 })
})

test('tipos de cuenta: un monedero digital con su emisor y una inversión que no cuenta para gastar', async ({ page }) => {
  await setupFirstUse(page)
  await go(page, '/ajustes/cuentas')
  await page.getByRole('button', { name: 'Agregar cuenta' }).click()
  let dialog = page.getByRole('dialog', { name: 'Nueva cuenta' })
  await dialog.getByLabel('Nombre').fill('Monedero')
  await dialog.getByLabel('Tipo de cuenta').selectOption('wallet')
  await dialog.getByLabel('Banco o emisor (opcional)').fill('PayPal')
  await dialog.getByLabel('Saldo actual').fill('25')
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Cuenta guardada')).toBeVisible()
  await expect(page.getByTestId(/^account-/).filter({ hasText: 'Monedero' }).getByText(/Monedero digital\s*· PayPal/)).toBeVisible()

  await page.getByRole('button', { name: 'Agregar cuenta' }).click()
  dialog = page.getByRole('dialog', { name: 'Nueva cuenta' })
  await dialog.getByLabel('Nombre').fill('Fondo')
  await dialog.getByLabel('Tipo de cuenta').selectOption('investment')
  // Una inversión nueva viene sin marcar para «Puedes gastar».
  await expect(dialog.getByLabel('Contar esta cuenta para lo que puedo gastar')).not.toBeChecked()
  await dialog.getByLabel('Saldo actual').fill('1000')
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  // En escritorio el aviso anterior puede seguir visible: la señal es que la hoja se cierra.
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId(/^account-/).filter({ hasText: 'Fondo' }).getByText('Inversión')).toBeVisible()

  const accounts = (await stored(page)).accounts
  expect(accounts.find((a) => a.name === 'Monedero')).toMatchObject({ kind: 'wallet', institution: 'PayPal', includeInBudget: true })
  expect(accounts.find((a) => a.name === 'Fondo')).toMatchObject({ kind: 'investment', includeInBudget: false })
  expect(accounts.find((a) => a.name === 'Fondo')!.institution).toBeUndefined()
  // El monedero (incluido) suma 25; la inversión (excluida) no cambia lo que puedes gastar.
  await go(page, '/')
  await expect(page.getByTestId('available')).toHaveText('$425.00')
})

test('avisos de un límite al 50/75/90 %: apagados por defecto, se guardan y se ven al editar', async ({ page }) => {
  await setupFirstUse(page)
  await go(page, '/plan/planes/nuevo')
  await page.getByLabel('Límite máximo').fill('300')
  await page.getByLabel('Nombre (opcional)').fill('Salidas')
  for (const p of [50, 75, 90]) await expect(page.getByRole('switch', { name: `Avisar al ${p} %` })).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('switch', { name: 'Avisar al 80 %' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('switch', { name: 'Avisar al 50 %' }).click()
  await page.getByRole('switch', { name: 'Avisar al 90 %' }).click()
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Plan guardado').first()).toBeVisible()
  const plan = (JSON.parse((await storedData(page)) ?? '{}') as { plans: { id: string; name: string; alertLevels?: number[]; alertAt80: boolean; alertAt100: boolean }[] }).plans.find((p) => p.name === 'Salidas')!
  expect(plan).toMatchObject({ alertLevels: [50, 90], alertAt80: true, alertAt100: true })

  await page.reload()
  await go(page, `/plan/planes/editar/${plan.id}`)
  await expect(page.getByRole('switch', { name: 'Avisar al 50 %' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('switch', { name: 'Avisar al 75 %' })).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('switch', { name: 'Avisar al 90 %' })).toHaveAttribute('aria-checked', 'true')
})

test('corregir la categoría que propone una regla ofrece recordarla; solo se guarda al pulsar «Recordar»', async ({ page }) => {
  await startDemo(page)
  const rules = async () => (JSON.parse((await storedData(page)) ?? '{}') as { categoryRules: { pattern: string; categoryId: string }[] }).categoryRules
  const before = (await rules()).length

  // Sin corrección no se ofrece nada.
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe', { exact: true }).fill('3')
  await openDetails(page)
  await page.getByLabel('Nota (opcional)').fill('Café con Ana')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Recordar' })).toHaveCount(0)

  // La regla «café» propone Restaurantes y café; la persona elige Supermercado.
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe', { exact: true }).fill('4')
  await openDetails(page)
  await page.getByLabel('Nota (opcional)').fill('Café del museo')
  const category = page.getByLabel('Categoría', { exact: true })
  await expect(category).toHaveAttribute('data-value', 'dining')
  await pickCategory(page, category, 'Supermercado')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('¿Usar siempre «Supermercado» cuando la descripción incluya «Café del museo»?')).toBeVisible()
  // Ofrecer no es guardar.
  expect((await rules()).length).toBe(before)
  await page.getByRole('button', { name: 'Recordar' }).click()
  await expect(page.getByText(/Regla guardada: «Café del museo» → Supermercado/)).toBeVisible()
  expect((await rules()).filter((r) => r.pattern === 'Café del museo')).toEqual([expect.objectContaining({ categoryId: 'groceries' })])

  // La próxima vez la regla nueva (más específica) gana; la anterior sigue para lo demás.
  await go(page, '/movimientos/nuevo')
  await openDetails(page)
  await page.getByLabel('Nota (opcional)').fill('café del museo')
  await expect(page.getByLabel('Categoría', { exact: true })).toHaveAttribute('data-value', 'groceries')
  await page.getByLabel('Nota (opcional)').fill('Café con Luis')
  await expect(page.getByLabel('Categoría', { exact: true })).toHaveAttribute('data-value', 'dining')
})
