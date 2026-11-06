import { expect, test, type Page } from '@playwright/test'
import { computeInbox } from '../../src/domain/inbox'
import type { AppData } from '../../src/domain/types'
import { account, baseData, bill, tx } from '../../src/test/fixtures'
import { available, expectNoHorizontalScroll, go, openApp, openDetails, setLanguage, startDemo, storedData, waitForSaved, writeStoredData, type UiLanguage } from './helpers'
import { shot } from './shots'

/**
 * Auditoría independiente del 2026-11-02 sobre `420c700`, en el navegador y con datos sintéticos:
 * - P1: reparar «Internet» el 20-mar (28-mar → 31-mar), crear un gasto planificado vinculado al 31-mar con 420 apartados
 *   ($980.00) y revertir la reparación: se rechaza por el gasto planificado y sigue en $980.00 tras recargar (antes:
 *   $560.00, la misma factura reservada dos veces).
 * - P2: 50 parejas históricas de café a 4,25 descartadas; dos cafés nuevos el mismo día se ofrecen como posible
 *   duplicado (antes: nunca) y «Son distintos» los cierra.
 * - P3: con el archivo `legal.es-*.json` bloqueado, Privacidad enseña un estado de fallo legible (nunca claves) y, al
 *   volver la red, «Reintentar» o volver a abrir la pantalla recupera el texto; inglés con respaldo en español; los dos
 *   fallidos; Galería; los cuatro idiomas con red.
 * - P4: 400 programados diarios de 10¹²: Proyección, Análisis, Plan ante faltante, Escenarios y «¿Me alcanza?» dicen
 *   desde qué día no hay cifra (24-nov) en vez de «No se pudo abrir esta pantalla»; en es/en/pt/fr.
 */
type Stored = { schedules: { id: string; anchorDate?: string }[]; goals: { id: string; plan?: { link?: { scheduleId: string; occurrenceDate: string } }; allocations: { amountMinor: number }[] }[]; inbox: { dismissed: { id: string }[] }; transactions: { id: string; note?: string }[] }
const stored = async (page: Page) => JSON.parse((await storedData(page)) ?? '{}') as Stored
const anchor = (amountMinor: number, date: string) => ({ amountMinor, date, setAt: `${date}T12:00:00.000Z` })
const clock = (iso: string) => new Date(`${iso}T12:00:00-04:00`)
const SCREEN_FAILED = /No se pudo abrir esta pantalla|This screen could not be opened/

/** Como `seedStoredData`, pero con el reloj fijado en la fecha del caso. */
async function seedAt(page: Page, data: AppData, iso: string) {
  await openApp(page, clock(iso))
  await expect(page.getByRole('heading', { name: 'Hola, esto es Clara' })).toBeVisible()
  await writeStoredData(page, data)
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
}

/* ------------------------------------------------------------------ */
/* P1 · revertir una reparación con un gasto planificado vinculado      */
/* ------------------------------------------------------------------ */

/** Factura «Internet» del 31 partida el 28-feb por una versión anterior; enero y febrero omitidos; horizonte de 30 días. */
const internet = (): AppData => {
  const d = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(140000, '2026-03-01') })],
    schedules: [
      bill('2026-01-31', 42000, { id: 'b1', name: 'Internet', frequency: 'monthly', endDate: '2026-02-27', skippedDates: ['2026-01-31'] }),
      bill('2026-02-28', 42000, { id: 'b2', name: 'Internet', frequency: 'monthly', skippedDates: ['2026-02-28'] }),
    ],
  })
  return { ...d, settings: { ...d.settings, fallbackHorizonDays: 30 } }
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

test('P1 · reparar el 20-mar, apartar $420.00 para el 31-mar corregido ($980.00) y revertir la reparación: se rechaza por el gasto planificado y sigue en $980.00 tras recargar', async ({ page }) => {
  await seedAt(page, internet(), '2026-03-20')
  await expect(await available(page)).toHaveText('$980.00')
  await restoreUsualDates(page, 'Internet')
  expect((await stored(page)).schedules.find((s) => s.id === 'b2')).toMatchObject({ anchorDate: '2026-01-31' })
  await expect(await available(page)).toHaveText('$980.00')

  // Gasto planificado vinculado al 31-mar corregido, con los 420 ya apartados: cubre esa factura, no se reserva dos veces.
  await go(page, '/plan/metas')
  await page.getByRole('link', { name: 'Nuevo gasto planificado' }).click()
  await expect(page.getByRole('heading', { name: 'Nuevo gasto planificado' })).toBeVisible()
  const link = page.getByLabel('Vincular con un pago del calendario (opcional)')
  await link.selectOption((await link.locator('option', { hasText: /Internet · 31 mar · faltan/ }).getAttribute('value'))!)
  await expect(page.getByLabel('Nombre')).toHaveValue('Internet')
  await page.getByLabel('Ya apartado (opcional)').fill('420')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.locator('article', { hasText: 'Internet' }).getByTestId('planned-confirmed')).toHaveText('$420.00')
  await waitForSaved(page)
  await expect(await available(page)).toHaveText('$980.00')
  const goal = (await stored(page)).goals.find((g) => g.plan?.link?.scheduleId === 'b2')
  expect(goal).toMatchObject({ plan: { link: { scheduleId: 'b2', occurrenceDate: '2026-03-31' } } })

  // El historial explica el gasto planificado y no ofrece «Revertir» para la reparación.
  await go(page, '/ajustes/historial')
  const entry = page.locator('article.history-entry', { hasText: 'Internet' }).filter({ has: page.getByTestId('history-dependents') }).first()
  const note = entry.getByTestId('history-dependents')
  await expect(note).toContainText('No se puede revertir: 1 registro seguiría apuntando a un programado, o a una fecha de pago, que este cambio eliminaría o cambiaría')
  await expect(note).toContainText('Gasto planificado «Internet», vinculado al pago del 31 mar')
  await expect(entry.getByRole('button', { name: 'Revertir' })).toHaveCount(0)
  await shot(page, 'nov02-p1-history-refusal', entry)
  await expectNoHorizontalScroll(page, 'historial con un gasto planificado dependiente')

  // Tras recargar: mismas cifras, mismo vínculo, misma fecha de siempre; nada cambió.
  await page.reload()
  await expect(await available(page)).toHaveText('$980.00')
  const after = await stored(page)
  expect(after.goals.find((g) => g.id === goal!.id)).toMatchObject({ plan: { link: { scheduleId: 'b2', occurrenceDate: '2026-03-31' } } })
  expect(after.schedules.find((s) => s.id === 'b2')).toMatchObject({ anchorDate: '2026-01-31' })
  await shot(page, 'nov02-p1-home-980')
})

/* ------------------------------------------------------------------ */
/* P2 · duplicados: lo ya revisado no agota el tope                     */
/* ------------------------------------------------------------------ */

const isoDay = (base: string, offset: number) => {
  const d = new Date(`${base}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

/** 50 parejas históricas de café a 4,25 (cada pareja el mismo día, parejas a cuatro días), todas ya descartadas con «Son distintos». */
const coffees = (): AppData => {
  const pairs = Array.from({ length: 50 }, (_, k) => [
    tx({ id: `h${String(k).padStart(2, '0')}a`, date: isoDay('2026-01-02', 4 * k), amountMinor: 425, kind: 'expense', status: 'realized', categoryId: 'dining', note: 'Café' }),
    tx({ id: `h${String(k).padStart(2, '0')}b`, date: isoDay('2026-01-02', 4 * k), amountMinor: 425, kind: 'expense', status: 'realized', categoryId: 'dining', note: 'Café' }),
  ]).flat()
  const d = baseData({ accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(100000, '2026-01-01') })], transactions: pairs })
  const dismissed = computeInbox(d, '2026-09-28')
    .filter((i) => i.kind === 'duplicate')
    .map((i) => ({ id: i.id, fingerprint: i.fingerprint, at: '2026-09-01T12:00:00.000Z' }))
  if (dismissed.length !== 50) throw new Error(`se esperaban 50 parejas, hay ${dismissed.length}`)
  return { ...d, inbox: { snoozed: [], dismissed } }
}

async function saveCoffee(page: Page) {
  await go(page, '/movimientos/nuevo')
  await page.getByLabel('Importe').fill('4.25')
  await openDetails(page)
  await page.getByLabel('Nota (opcional)').fill('Café')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  await waitForSaved(page)
}

test('P2 · con 50 parejas históricas descartadas, dos cafés nuevos de $4.25 el mismo día se ofrecen como posible duplicado y «Son distintos» los cierra', async ({ page }) => {
  await seedAt(page, coffees(), '2026-09-28')
  await go(page, '/pendientes')
  await expect(page.getByRole('heading', { name: 'Pendientes', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Posibles duplicados/ })).toHaveCount(0)
  await expect(page.getByText(/Descartados \(50\)/)).toBeVisible()

  await saveCoffee(page)
  await saveCoffee(page)
  expect((await stored(page)).transactions.filter((t) => t.note === 'Café')).toHaveLength(102)

  await go(page, '/pendientes')
  await expect(page.getByRole('heading', { name: /Posibles duplicados \(1\)/ })).toBeVisible()
  const dup = page.locator('article', { hasText: 'Café' }).filter({ has: page.getByRole('button', { name: 'Son distintos' }) }).first()
  await expect(dup).toBeVisible()
  await expect(page.getByTestId('inbox-more-duplicates')).toHaveCount(0)
  await shot(page, 'nov02-p2-new-pair-offered', dup)
  await expectNoHorizontalScroll(page, 'pendientes con la pareja nueva')
  await dup.getByRole('button', { name: 'Son distintos' }).click()
  await expect(page.getByText('Decisión guardada').first()).toBeVisible()
  await waitForSaved(page)
  await expect(page.getByRole('heading', { name: /Posibles duplicados/ })).toHaveCount(0)

  // Tras recargar sigue cerrada, y lo revisado antes sigue ahí para poder recuperarlo.
  await page.reload()
  await go(page, '/pendientes')
  await expect(page.getByRole('heading', { name: /Posibles duplicados/ })).toHaveCount(0)
  await expect(page.getByText(/Descartados \(51\)/)).toBeVisible()
  expect((await stored(page)).inbox.dismissed).toHaveLength(51)
})

test('P2 · más parejas sin revisar que el tope: se dice que hay más y, al revisar, aparecen las siguientes', async ({ page }) => {
  const same = Array.from({ length: 12 }, (_, i) => tx({ id: `q${String(i).padStart(2, '0')}`, date: '2026-09-27', amountMinor: 425, kind: 'expense', status: 'realized', categoryId: 'dining', note: 'Café' }))
  await seedAt(page, baseData({ accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(100000, '2026-01-01') })], transactions: same }), '2026-09-28')
  await go(page, '/pendientes')
  await expect(page.getByRole('heading', { name: /Posibles duplicados \(50\)/ })).toBeVisible()
  await expect(page.getByTestId('inbox-more-duplicates')).toContainText('Hay más posibles duplicados de los que se muestran')
  await shot(page, 'nov02-p2-more-duplicates', page.getByTestId('inbox-more-duplicates'))
  await page.locator('article', { hasText: 'Café' }).filter({ has: page.getByRole('button', { name: 'Son distintos' }) }).first().getByRole('button', { name: 'Son distintos' }).click()
  await expect(page.getByText('Decisión guardada').first()).toBeVisible()
  await waitForSaved(page)
  // Una revisada deja ver la siguiente: siguen siendo 50 a la vista (de las 66) y se sigue diciendo que hay más.
  await expect(page.getByRole('heading', { name: /Posibles duplicados \(50\)/ })).toBeVisible()
  await expect(page.getByTestId('inbox-more-duplicates')).toBeVisible()
  await expect(page.getByText(/Descartados? \(1\)/)).toBeVisible()
})

/* ------------------------------------------------------------------ */
/* P3 · paquetes de texto diferidos                                     */
/* ------------------------------------------------------------------ */

test.describe('P3 · paquetes de texto diferidos (sin service worker: el archivo JSON se pide a la red)', () => {
  test.use({ serviceWorkers: 'block' })
  const KEYS = /legal\.(privacy|terms)\.\d|gallery\.[a-z]/
  const block = (page: Page, pattern: string) => page.route(pattern, (route) => route.abort('failed'))

  test('Privacidad en español con el archivo bloqueado: estado de fallo legible, ninguna clave; al volver la red basta con volver a abrir la pantalla', async ({ page }) => {
    await startDemo(page)
    await block(page, '**/assets/legal.es-*.json')
    await go(page, '/legal/privacidad')
    const failed = page.getByTestId('pack-failed')
    await expect(failed).toBeVisible()
    await expect(failed).toContainText('No se pudo cargar este texto')
    await expect(failed.getByRole('button', { name: 'Reintentar' })).toBeVisible()
    await expect(failed.getByRole('button', { name: 'Recargar la app' })).toBeVisible()
    expect(await page.locator('#main').innerText()).not.toMatch(KEYS)
    await expect(page.getByText('Dónde están tus datos')).toHaveCount(0)
    await shot(page, 'nov02-p3-privacy-failed', failed)
    await expectNoHorizontalScroll(page, 'privacidad sin el paquete')
    // Vuelve la red: navegar a otra pantalla y volver recupera el texto (el fallo no quedó en memoria).
    await page.unroute('**/assets/legal.es-*.json')
    await go(page, '/ajustes')
    await go(page, '/legal/privacidad')
    await expect(page.getByText('Dónde están tus datos')).toBeVisible()
    await expect(page.getByTestId('pack-failed')).toHaveCount(0)
    expect(await page.locator('#main').innerText()).not.toMatch(KEYS)
  })

  test('Privacidad en español: «Reintentar» recupera el texto sin recargar ni borrar nada; los datos siguen', async ({ page }) => {
    await startDemo(page)
    const before = await available(page).then((l) => l.textContent())
    await block(page, '**/assets/legal.es-*.json')
    await go(page, '/legal/privacidad')
    await expect(page.getByTestId('pack-failed')).toBeVisible()
    await page.unroute('**/assets/legal.es-*.json')
    await page.getByTestId('pack-failed').getByRole('button', { name: 'Reintentar' }).click()
    await expect(page.getByText('Dónde están tus datos')).toBeVisible()
    await expect(page.getByTestId('pack-failed')).toHaveCount(0)
    await shot(page, 'nov02-p3-privacy-recovered')
    await expect(await available(page)).toHaveText(before!)
  })

  test('inglés con su archivo bloqueado: el texto sale en español y se dice; «Retry» con red devuelve el inglés', async ({ page }) => {
    await startDemo(page)
    await setLanguage(page, 'English')
    await block(page, '**/assets/legal.en-*.json')
    await go(page, '/legal/privacidad')
    const fallback = page.getByTestId('pack-fallback')
    await expect(fallback).toContainText('This text could not be loaded in your language; it is shown in Spanish.')
    await expect(page.getByText('Dónde están tus datos')).toBeVisible()
    expect(await page.locator('#main').innerText()).not.toMatch(KEYS)
    await shot(page, 'nov02-p3-privacy-fallback', fallback)
    await page.unroute('**/assets/legal.en-*.json')
    await fallback.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByText('Where your data lives')).toBeVisible()
    await expect(page.getByTestId('pack-fallback')).toHaveCount(0)
  })

  test('inglés con los dos archivos bloqueados: estado de fallo en inglés; «Reload the app» con red recupera el texto y los datos siguen', async ({ page }) => {
    await startDemo(page)
    await setLanguage(page, 'English')
    await block(page, '**/assets/legal.en-*.json')
    await block(page, '**/assets/legal.es-*.json')
    await go(page, '/legal/terminos')
    const failed = page.getByTestId('pack-failed')
    await expect(failed).toContainText('This text could not be loaded')
    expect(await page.locator('#main').innerText()).not.toMatch(KEYS)
    await page.unroute('**/assets/legal.en-*.json')
    await page.unroute('**/assets/legal.es-*.json')
    await failed.getByRole('button', { name: 'Reload the app' }).click()
    await expect(page.getByRole('heading', { name: 'Terms of use' })).toBeVisible()
    await expect(page.getByTestId('pack-failed')).toHaveCount(0)
    expect(await page.locator('#main').innerText()).not.toMatch(KEYS)
    await expect(await available(page)).toBeVisible()
  })

  test('Galería con su archivo bloqueado: cabecera y estado de fallo, ninguna clave; «Reintentar» con red dibuja la galería', async ({ page }) => {
    await startDemo(page)
    await block(page, '**/assets/gallery.es-*.json')
    await go(page, '/galeria')
    await expect(page.getByRole('heading', { name: 'Galería de componentes' })).toBeVisible()
    const failed = page.getByTestId('pack-failed')
    await expect(failed).toContainText('No se pudo cargar este texto')
    expect(await page.locator('#main').innerText()).not.toMatch(KEYS)
    await shot(page, 'nov02-p3-gallery-failed', failed)
    await page.unroute('**/assets/gallery.es-*.json')
    await failed.getByRole('button', { name: 'Reintentar' }).click()
    await expect(page.getByText(/Todos los componentes base de Clara/)).toBeVisible()
    await expect(page.getByTestId('pack-failed')).toHaveCount(0)
  })

  test('con red, Privacidad, Términos y Galería salen en los cuatro idiomas y sin claves', async ({ page }) => {
    await startDemo(page)
    const cases: [UiLanguage, string, string][] = [
      ['Español', 'Dónde están tus datos', 'Galería de componentes'],
      ['English', 'Where your data lives', 'Component gallery'],
      ['Português', 'Onde estão seus dados', 'Galeria de componentes'],
      ['Français', 'Où se trouvent vos données', 'Galerie de composants'],
    ]
    for (const [language, privacy, gallery] of cases) {
      await setLanguage(page, language)
      await go(page, '/legal/privacidad')
      await expect(page.getByText(privacy)).toBeVisible()
      await go(page, '/legal/terminos')
      await expect(page.locator('#main section').first()).toBeVisible()
      await go(page, '/galeria')
      await expect(page.getByRole('heading', { name: gallery })).toBeVisible()
      for (const id of ['pack-failed', 'pack-fallback', 'pack-loading']) await expect(page.getByTestId(id)).toHaveCount(0)
      expect(await page.locator('#main').innerText(), language).not.toMatch(KEYS)
    }
  })
})

/* ------------------------------------------------------------------ */
/* P4 · proyección fuera del rango exacto                              */
/* ------------------------------------------------------------------ */

/** 400 gastos programados diarios de 10¹² desde el 2-nov-2026 (validan; 22 días exactos, sin cifra desde el 24-nov). */
const dailyOverflow = (): AppData => {
  const d = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(500000, '2026-11-01') })],
    schedules: Array.from({ length: 400 }, (_, i) => bill('2026-11-02', 1_000_000_000_000, { id: `d${i}`, name: `Diario ${i}`, frequency: 'daily' })),
  })
  return { ...d, settings: { ...d.settings, fallbackHorizonDays: 7 } }
}

test('P4 · 400 programados diarios de 10¹²: Proyección, Análisis, Plan ante faltante, Escenarios y «¿Me alcanza?» dicen desde cuándo no hay cifra en vez de romperse', async ({ page }) => {
  await seedAt(page, dailyOverflow(), '2026-11-02')

  await go(page, '/plan/proyeccion')
  await expect(page.getByTestId('projection-partial')).toContainText('Desde el 24 nov')
  await expect(page.getByText('La curva termina el 23 nov')).toBeVisible()
  expect(await page.locator('#main').innerText()).not.toMatch(SCREEN_FAILED)
  await shot(page, 'nov02-p4-projection')
  await expectNoHorizontalScroll(page, 'proyección parcial')

  await go(page, '/analisis')
  await expect(page.getByText('La proyección a 60 días solo tiene cifra hasta el 23 nov')).toBeVisible()
  expect(await page.locator('#main').innerText()).not.toMatch(SCREEN_FAILED)
  await shot(page, 'nov02-p4-analysis')

  await go(page, '/alcanza/faltante')
  await expect(page.getByTestId('shortfall-partial')).toContainText('La proyección solo tiene cifra hasta el 23 nov')
  expect(await page.locator('#main').innerText()).not.toMatch(SCREEN_FAILED)
  await shot(page, 'nov02-p4-shortfall')

  await go(page, '/alcanza/escenarios')
  await expect(page.getByTestId('scenario-partial')).toBeVisible()
  await expect(page.getByText('Sin cifra desde el 24 nov').first()).toBeVisible()
  expect(await page.locator('#main').innerText()).not.toMatch(SCREEN_FAILED)
  await shot(page, 'nov02-p4-scenarios')

  await go(page, '/alcanza')
  await page.getByLabel('Precio').fill('10')
  await expect(page.getByTestId('verdict')).toBeVisible()
  await expect(page.getByTestId('afford-partial')).toContainText('Desde el 24 nov')
  expect(await page.locator('#main').innerText()).not.toMatch(SCREEN_FAILED)
  await shot(page, 'nov02-p4-afford')

  // Lo demás sigue en pie: Inicio, Movimientos, un formulario y la copia.
  for (const route of ['/', '/movimientos', '/movimientos/nuevo', '/ajustes/copia']) {
    await go(page, route)
    expect(await page.locator('#main').innerText(), route).not.toMatch(SCREEN_FAILED)
  }
})

test('P4 · la proyección parcial se explica en inglés, portugués y francés', async ({ page }) => {
  await seedAt(page, dailyOverflow(), '2026-11-02')
  const cases: [UiLanguage, RegExp][] = [
    ['English', /what Clara can calculate exactly/],
    ['Português', /o que a Clara consegue calcular com exatidão/],
    ['Français', /ce que Clara peut calculer exactement/],
  ]
  for (const [language, text] of cases) {
    await setLanguage(page, language)
    await go(page, '/plan/proyeccion')
    await expect(page.getByTestId('projection-partial')).toContainText(text)
    expect(await page.locator('#main').innerText(), language).not.toMatch(SCREEN_FAILED)
    await go(page, '/analisis')
    expect(await page.locator('#main').innerText(), language).not.toMatch(SCREEN_FAILED)
  }
})
