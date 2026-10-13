import { expect, test } from '@playwright/test'
import { START, available, go, openDetails, startDemo } from './helpers'

/**
 * Etapa 3 del programa: calendario de flujo de caja (saldo proyectado por día, primer día en negativo,
 * simulación explícita y conciliación de programados), límites con arrastre y compromisos del ciclo,
 * y metas con ritmo explicado, efecto en el disponible e historial de aportes (decisión 149).
 *
 * Demo (28-sep, saldo del presupuesto $901.57): luz vencida 42.80 (27-sep), renta 650 el 1-oct,
 * matrícula 400 el 16-oct; sueldo 520 el 4 y el 18-oct. Punto más bajo proyectado: $146.63 el 16-oct.
 */

test('calendario: saldo proyectado por día, sin faltante previsto; una simulación de $200 lo lleva a negativo el 16-oct y no guarda nada', async ({ page }) => {
  await startDemo(page)
  await go(page, '/plan/calendario')
  // Sin faltante hasta el horizonte (≥ 60 días desde hoy).
  await expect(page.getByTestId('flow-line')).toContainText('Sin saldo negativo hasta el')
  await expect(page.locator('.cal-day.is-negative')).toHaveCount(0)
  // Día elegido: saldo proyectado al cerrar el día (30-sep: 901.57 − 42.80 + 18.00 = 876.77).
  await page.getByRole('button', { name: /^mié, 30 de sep/ }).click()
  await expect(page.getByTestId('day-balance')).toContainText('Saldo proyectado al cerrar el día: $876.77')
  // Un día pasado no se proyecta.
  await page.getByRole('button', { name: /^vie, 25 de sep/ }).click()
  await expect(page.getByTestId('day-balance')).toContainText('Día pasado')
  await page.getByRole('button', { name: /^mié, 30 de sep/ }).click()

  // Simulación: $200 el 30-sep → 676.77 ese día y primer negativo el 16-oct (146.63 − 200 = −53.37).
  await page.getByLabel('Importe a simular').fill('200')
  const sim = page.getByTestId('sim-result')
  await expect(sim).toContainText('Con ese pago el 30 sep: $676.77 al cerrar ese día')
  await expect(sim).toContainText('Primer día en negativo: 16 oct (-$53.37)')
  // La proyección real no cambia (nada se guarda).
  await expect(page.getByTestId('flow-line')).toContainText('Sin saldo negativo hasta el')
  await expect(page.getByTestId('day-balance')).toContainText('$876.77')
  // «Registrar como previsto» abre el formulario ya relleno; «Quitar simulación» la borra.
  const register = page.getByRole('link', { name: 'Registrar como previsto' })
  await expect(register).toHaveAttribute('href', /movimientos\/nuevo\?kind=expense&amount=20000&date=2026-09-30&status=planned/)
  await page.getByRole('button', { name: 'Quitar simulación' }).click()
  await expect(sim).toHaveCount(0)
  await expect(page.getByLabel('Importe a simular')).toHaveValue('')
  // El disponible no se movió.
  await expect(await available(page)).toHaveText('$136.78')
})

test('calendario: un gasto registrado a mano que coincide con la luz vencida se propone y, al vincular, cuenta como pagado una sola vez', async ({ page }) => {
  await startDemo(page)
  // Registrar 42.80 el 27-sep sin vincular: el disponible baja 42.80 y la luz sigue vencida (reservada).
  await go(page, '/movimientos/nuevo?kind=expense&date=2026-09-27')
  await page.getByLabel('Importe').fill('42.80')
  await openDetails(page)
  await page.getByLabel('Nota (opcional)').fill('Pago luz en ventanilla')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  await expect(await available(page)).toHaveText('$93.98')

  await go(page, '/plan/calendario')
  const list = page.getByTestId('reconcile-list')
  await expect(list.locator('li')).toHaveCount(1)
  await expect(list).toContainText('«Recibo de luz» del 27 sep ↔ movimiento del 27 sep por $42.80')
  await page.getByRole('button', { name: 'Vincular: Recibo de luz' }).click()
  await expect(page.getByText('«Recibo de luz» vinculado: ya cuenta como pagado').first()).toBeVisible()
  // Ya no se propone, la ocurrencia figura pagada y la reserva se libera: el disponible vuelve a 136.78.
  await expect(list).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^dom, 27 de sep/ })).toHaveAttribute('aria-label', /1 elemento/)
  await page.getByRole('button', { name: /^dom, 27 de sep/ }).click()
  await expect(page.getByRole('list').filter({ hasText: 'Recibo de luz' }).first()).toContainText('Pagado')
  await expect(await available(page)).toHaveText('$136.78')
})

test('límites: arrastre explícito en el formulario, compromisos programados del ciclo, comparación honesta y límite renovado con arrastre', async ({ page }) => {
  await startDemo(page)
  await go(page, '/plan/planes/nuevo')
  await expect(page.getByRole('heading', { name: 'Nuevo límite' })).toBeVisible()
  await page.getByLabel('Límite máximo').fill('100')
  await page.getByTestId('plan-categories').click()
  await page.getByTestId('category-picker').getByRole('option', { name: 'Servicios (luz, agua, gas)' }).first().click()
  await page.getByRole('button', { name: 'Listo' }).click()
  const carry = page.getByRole('switch', { name: 'Arrastrar lo no gastado al siguiente ciclo' })
  await expect(carry).toHaveAttribute('aria-checked', 'false')
  await carry.click()
  await expect(carry).toHaveAttribute('aria-checked', 'true')
  // Sin recurrencia no hay arrastre que ofrecer.
  await page.getByRole('switch', { name: 'Recurrente' }).click()
  await expect(carry).toHaveCount(0)
  await page.getByRole('switch', { name: 'Recurrente' }).click()
  await expect(page.getByRole('switch', { name: 'Arrastrar lo no gastado al siguiente ciclo' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Plan guardado')).toBeVisible()

  // Detalle: nada gastado; la luz vencida (42.80) es compromiso del ciclo, no gasto; sin ciclo anterior con datos.
  await expect(page.getByTestId('plan-spent')).toContainText('$0.00')
  await expect(page.getByTestId('plan-upcoming')).toContainText('Recibo de luz')
  await expect(page.getByTestId('plan-upcoming')).toContainText('Vencido')
  await expect(page.getByTestId('plan-upcoming-total')).toContainText('Comprometido $42.80 · restante tras lo previsto $57.20')
  await expect(page.getByTestId('plan-compare')).toContainText('Sin ciclo anterior con datos para comparar.')
  await expect(page.getByText('Un límite es una regla de gasto, no dinero apartado: no cambia lo que puedes gastar.')).toBeVisible()
  await expect(page.getByTestId('plan-limit-breakdown')).toHaveCount(0)
  await expect(await available(page)).toHaveText('$136.78')

  // 2 de octubre: el ciclo de septiembre se cierra con 100 sin gastar y el nuevo límite es 100 + 100.
  await page.clock.setSystemTime(new Date(START.getTime() + 4 * 86_400_000))
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
  await go(page, '/plan/planes')
  await page.getByTestId('plan-list').getByRole('link', { name: /Servicios \(luz, agua, gas\)/ }).click()
  await expect(page.getByTestId('plan-spent')).toContainText('/ $200.00')
  await expect(page.getByTestId('plan-limit-breakdown')).toContainText('Límite base $100.00 · arrastre +$100.00 = $200.00')
})

test('metas: ritmo explicado con cifras, efecto sobre el disponible e historial de aportes', async ({ page }) => {
  await startDemo(page)
  await go(page, '/plan/metas')
  const emergency = page.getByRole('article', { name: 'Fondo de emergencia' })
  const laptop = page.getByRole('article', { name: 'Laptop para la escuela' })
  // Fondo de emergencia: 400 ahorrados frente a 181.81 ideales → por delante; en otra cuenta, no resta del disponible.
  await expect(emergency.getByTestId('goal-pace')).toContainText('Vas $218.19 por delante del ritmo para llegar el 27 mar 2027.')
  await expect(emergency.getByTestId('goal-impact')).toContainText('En otra cuenta: no resta de tu disponible.')
  // Laptop: 60 frente a 180 ideales → por detrás; apartado del presupuesto: reduce el disponible en 60.
  await expect(laptop.getByTestId('goal-pace')).toContainText('Vas $120.00 por detrás del ritmo para llegar el 26 ene 2027: tocaría llevar $180.00.')
  await expect(laptop.getByTestId('goal-impact')).toContainText('Apartado del presupuesto: reduce tu disponible en $60.00.')
  // Historial de aportes: plegado, con motivo y fecha.
  await emergency.getByRole('group').filter({ hasText: 'Aportes (2)' }).locator('summary').click()
  const history = emergency.getByTestId('goal-history')
  await expect(history.locator('li')).toHaveCount(2)
  await expect(history.locator('li').first()).toContainText('Aporte')
  await expect(history.locator('li').first()).toContainText('+$50.00')
  await expect(history.locator('li').last()).toContainText('+$350.00')
})
