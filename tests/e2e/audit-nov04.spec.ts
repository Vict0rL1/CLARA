import { expect, test, type Page, type Route } from '@playwright/test'
import { computeInbox } from '../../src/domain/inbox'
import { financialFingerprint } from '../../src/domain/scenarios'
import type { AppData } from '../../src/domain/types'
import { account, baseData, bill, income, tx } from '../../src/test/fixtures'
import { available, expectNoHorizontalScroll, go, openApp, setLanguage, startDemo, storedData, waitForSaved, writeStoredData, type UiLanguage } from './helpers'
import { shot } from './shots'

/**
 * Auditoría independiente del 2026-11-04 sobre `f8d6da0`, en el navegador, con el reloj en el 4-nov-2026 y datos sintéticos:
 * - F1: 400 ingresos y 400 gastos diarios de 10¹² (saldo 100 000 exacto cada día): Proyección y Análisis abren; los
 *   ingresos brutos salen «sin cifra exacta» y los saldos y el faltante de −1 del 27-nov son exactos (antes: «No se pudo
 *   abrir esta pantalla»).
 * - F2: 400 ingresos variables diarios (mínimo 1, esperado y extra 10¹²): la fila del mínimo cubre los 30 días y las del
 *   esperado y el extra dicen «hasta el 25 nov» aunque el escenario elegido sea otro (antes: «hasta el 3 dic» para
 *   todas); cero días exactos se dice sin «hasta hoy».
 * - F3: con la descarga del paquete detenida, al vencer el plazo «Reintentar» pide el archivo de nuevo y el texto llega
 *   sin recargar; el español de respaldo lleva `lang="es"`; una petición rechazada se recupera igual.
 * - F4: 5 000 movimientos iguales el mismo día con 50 parejas de nota igual: Pendientes abre con 50 parejas.
 * - F5: una pareja descartada o pospuesta sigue en «Descartados»/«Pospuestos» aunque 12 movimientos iguales de ocho
 *   días antes llenen el tope del grupo, y se puede volver a mostrar.
 */
const TODAY = '2026-11-04'
const X = 1_000_000_000_000
const anchor = (amountMinor: number, date: string) => ({ amountMinor, date, setAt: `${date}T12:00:00.000Z` })
const clock = (iso: string) => new Date(`${iso}T12:00:00-05:00`)
const SCREEN_FAILED = /No se pudo abrir esta pantalla|This screen could not be opened/
const KEYS = /legal\.(privacy|terms)\.\d|gallery\.[a-z]/
const isoDay = (base: string, offset: number) => {
  const d = new Date(`${base}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
type Stored = { inbox: { dismissed: { id: string }[]; snoozed: { id: string }[] } }
const stored = async (page: Page) => JSON.parse((await storedData(page)) ?? '{}') as Stored

/** Como `seedStoredData`, pero con el reloj fijado en la fecha del caso. `timeout`: Inicio con miles de programados tarda más. */
async function seedAt(page: Page, data: AppData, iso: string, timeout = 5_000) {
  await openApp(page, clock(iso))
  await expect(page.getByRole('heading', { name: 'Hola, esto es Clara' })).toBeVisible()
  await writeStoredData(page, data)
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible({ timeout })
}

/* ------------------------------------------------------------------ */
/* F1 · totales brutos fuera del rango exacto                          */
/* ------------------------------------------------------------------ */

/** nov04-gross-income: 400 ingresos y 400 gastos diarios de 10¹² (neto 0 al día) más un ingreso variable (mínimo 0). */
const grossIncome = (): AppData => {
  const d = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(100000, '2026-11-03') })],
    schedules: [
      ...Array.from({ length: 400 }, (_, i) => income(TODAY, X, { id: `in${i}`, name: `Ingreso ${i}`, frequency: 'daily' })),
      ...Array.from({ length: 400 }, (_, i) => bill(TODAY, X, { id: `out${i}`, name: `Pago ${i}`, frequency: 'daily' })),
      income('2026-12-15', 1000, { id: 'var', name: 'Variable', frequency: 'monthly', range: { minMinor: 0, extraMinor: 2000 } }),
    ],
  })
  return { ...d, settings: { ...d.settings, fallbackHorizonDays: 7 } }
}
/** nov04-analysis-gross: lo mismo más una compra prevista de 100 001 el 27-nov → saldo −1 ese día. */
const analysisGross = (): AppData => ({ ...grossIncome(), transactions: [tx({ id: 'planned', kind: 'expense', status: 'planned', amountMinor: 100001, date: '2026-11-27', note: 'Compra prevista' })] })

test('F1 · Proyección con ingresos brutos fuera del rango exacto abre: «Sin cifra exacta» en la columna de ingresos, saldos y faltantes exactos', async ({ page }) => {
  await seedAt(page, grossIncome(), TODAY)
  await go(page, '/plan/proyeccion')
  expect(await page.locator('#main').innerText()).not.toMatch(SCREEN_FAILED)
  await expect(page.getByText('Sin faltantes previstos con estas suposiciones')).toBeVisible()
  const table = page.getByTestId('scenario-table')
  await expect(table).toBeVisible()
  const rows = table.locator('tbody tr')
  await expect(rows).toHaveCount(3)
  for (let i = 0; i < 3; i++) {
    await expect(rows.nth(i).locator('td').nth(0)).toHaveText('Sin cifra exacta')
    await expect(rows.nth(i).locator('td').nth(1)).toHaveText('$1,000.00')
    await expect(rows.nth(i).locator('td').nth(2)).toHaveText('$1,000.00')
    await expect(rows.nth(i).locator('td').nth(3)).toHaveText('No')
  }
  await expect(page.getByTestId('scenario-gross')).toContainText('no se redondea, no se recorta ni se pone a cero')
  await expect(page.getByTestId('scenario-coverage')).toHaveCount(0)
  await shot(page, 'nov04-f1-projection', page.getByTestId('scenario-table'))
  await expectNoHorizontalScroll(page, 'proyección con ingresos brutos sin cifra')
})

test('F1 · Análisis con el faltante de −1 el 27-nov abre: la señal es exacta y el «¿Cómo se calculó?» dice ingresos y pagos sin cifra', async ({ page }) => {
  await seedAt(page, analysisGross(), TODAY)
  await go(page, '/analisis')
  expect(await page.locator('#main').innerText()).not.toMatch(SCREEN_FAILED)
  const title = page.getByTestId('insight-title').filter({ hasText: 'Saldo proyectado en negativo' })
  await expect(title).toHaveText('Saldo proyectado en negativo el 27 nov (-$0.01)')
  const card = page.locator('article.insight', { has: title })
  await card.getByText('¿Cómo se calculó?').click()
  const rows = card.locator('.composition .calc-row, .composition > *')
  await expect(card.locator('.composition')).toContainText('Ingresos previstos hasta ese día')
  await expect(card.locator('.composition')).toContainText('Sin cifra exacta: la suma no cabe en un entero exacto')
  await expect(card.locator('.composition')).toContainText('Saldo proyectado ese día')
  await expect(card.locator('.composition')).toContainText('-$0.01')
  expect(await rows.count()).toBeGreaterThan(0)
  await expect(page.getByTestId('insight-title').filter({ hasText: 'solo tiene cifra hasta' })).toHaveCount(0)
  await shot(page, 'nov04-f1-analysis', card)
  await expectNoHorizontalScroll(page, 'análisis con sumas brutas sin cifra')
})

/* ------------------------------------------------------------------ */
/* F2 · cobertura exacta por escenario                                 */
/* ------------------------------------------------------------------ */

/** nov04-scenario-dates: 400 ingresos variables diarios (mínimo 1, esperado y extra 10¹²). */
const scenarioDates = (): AppData => {
  const d = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(100000, '2026-11-03') })],
    schedules: Array.from({ length: 400 }, (_, i) => income(TODAY, X, { id: `v${i}`, name: `Variable ${i}`, frequency: 'daily', range: { minMinor: 1, extraMinor: X } })),
  })
  return { ...d, settings: { ...d.settings, fallbackHorizonDays: 7 } }
}
/** Cero días exactos: 9 008 ingresos de 10¹² hoy (ni el cierre de hoy cabe), con un escenario guardado para que Escenarios dibuje su tabla. */
const zeroDays = (): AppData => {
  const d = baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(100000, '2026-11-03') })],
    schedules: Array.from({ length: 9008 }, (_, i) => income(TODAY, X, { id: `z${i}`, name: `Hoy ${i}` })),
  })
  const withSettings = { ...d, settings: { ...d.settings, fallbackHorizonDays: 7 } }
  const at = `${TODAY}T12:00:00.000Z`
  return { ...withSettings, scenarios: [{ id: 'sc1', name: 'Una compra', changes: [{ type: 'purchase', amountMinor: 1000, date: TODAY }], baseFingerprint: financialFingerprint(withSettings), createdAt: at, updatedAt: at }] }
}

test('F2 · cada fila del comparador dice su propia cobertura: el mínimo los 30 días, el esperado y el extra hasta el 25 nov, elija el escenario que se elija', async ({ page }) => {
  await seedAt(page, scenarioDates(), TODAY)
  await go(page, '/plan/proyeccion')
  expect(await page.locator('#main').innerText()).not.toMatch(SCREEN_FAILED)
  const table = page.getByTestId('scenario-table')
  const rows = table.locator('tbody tr')
  const expectRows = async () => {
    await expect(rows.nth(0).locator('td').nth(2)).toHaveText('$1,120.00')
    await expect(rows.nth(0).locator('td').nth(3)).toHaveText('No')
    for (const i of [1, 2]) {
      await expect(rows.nth(i).locator('td').nth(2)).toHaveText('Sin cifra desde el 26 nov')
      await expect(rows.nth(i).locator('td').nth(3)).toHaveText('No hasta el 25 nov; después sin cifra')
    }
    await expect(page.getByTestId('scenario-coverage')).toHaveText('Días con cifra exacta por escenario: Mínimo: los 30 días · Esperado: hasta el 25 nov (22 días) · Extra: hasta el 25 nov (22 días)')
    await expect(table).toHaveAttribute('aria-describedby', 'scenario-coverage')
  }
  // Mínimo elegido (por defecto): proyección completa arriba; las filas del esperado y el extra ya dicen «hasta el 25 nov».
  await expect(page.getByText('Sin faltantes previstos con estas suposiciones')).toBeVisible()
  await expect(page.getByTestId('projection-partial')).toHaveCount(0)
  await expectRows()
  await shot(page, 'nov04-f2-projection-min', table)
  await expectNoHorizontalScroll(page, 'comparador con cobertura por escenario')
  // Esperado elegido: el aviso de arriba pasa a parcial (es su proyección) y las filas no cambian.
  await page.getByRole('radio', { name: 'Esperado' }).check()
  await expect(page.getByTestId('projection-partial')).toContainText('Hasta el 25 nov no hay faltante previsto. Desde el 26 nov')
  await expect(page.getByText('La curva termina el 25 nov')).toBeVisible()
  await expectRows()
  await shot(page, 'nov04-f2-projection-expected', table)
  // Extra elegido: igual.
  await page.getByRole('radio', { name: 'Extra' }).check()
  await expect(page.getByTestId('projection-partial')).toContainText('Desde el 26 nov')
  await expectRows()
})

test('F2 · cero días exactos: Proyección, Análisis, Plan ante faltante, Escenarios y «¿Me alcanza?» lo dicen sin afirmar «hasta hoy»', async ({ page }) => {
  await seedAt(page, zeroDays(), TODAY, 20_000)
  await go(page, '/plan/proyeccion')
  expect(await page.locator('#main').innerText()).not.toMatch(SCREEN_FAILED)
  await expect(page.getByRole('status').filter({ hasText: 'Sin cifra desde hoy' })).toBeVisible()
  await expect(page.getByTestId('projection-partial')).toContainText('ningún día tiene cifra')
  await expect(page.getByText('La curva no tiene ningún día con cifra exacta')).toBeVisible()
  expect(await page.locator('#main').innerText()).not.toMatch(/hasta el 3 nov|Hasta el 4 nov|hasta hoy/i)
  await shot(page, 'nov04-f2-zero-days-projection')
  await expectNoHorizontalScroll(page, 'proyección sin ningún día exacto')
  await go(page, '/analisis')
  await expect(page.getByTestId('insight-title').filter({ hasText: 'no tiene ningún día con cifra exacta' })).toBeVisible()
  expect(await page.locator('#main').innerText()).not.toMatch(/hasta el 3 nov|hasta el 4 nov/i)
  await go(page, '/alcanza/faltante')
  await expect(page.getByTestId('shortfall-partial')).toContainText('no se afirma nada sobre los 30 días')
  await expect(page.getByRole('status').filter({ hasText: 'Sin cifra desde hoy: no se puede proyectar' })).toBeVisible()
  expect(await page.locator('#main').innerText()).not.toMatch(/hasta el 3 nov|hasta el 4 nov/i)
  await go(page, '/alcanza/escenarios')
  await expect(page.getByTestId('scenario-partial')).toContainText('Sin cifra desde el 4 nov')
  await expect(page.getByRole('table').getByText('Sin cifra desde hoy').first()).toBeVisible()
  expect(await page.locator('#main').innerText()).not.toMatch(/hasta el 3 nov|No hasta el 4 nov/i)
  await go(page, '/alcanza')
  await page.getByLabel('Precio').fill('10')
  await expect(page.getByTestId('verdict')).toBeVisible()
  await expect(page.getByTestId('afford-partial')).toContainText('sobre los días siguientes no se afirma nada')
  await expect(page.getByText('solo hoy; después sin cifra').first()).toBeVisible()
  expect(await page.locator('#main').innerText()).not.toMatch(/hasta el 3 nov|hasta el 4 nov/i)
  await shot(page, 'nov04-f2-zero-days-afford')
})

test('F2 · la cobertura por escenario y la ausencia de días exactos se dicen en inglés, portugués y francés', async ({ page }) => {
  await seedAt(page, scenarioDates(), TODAY)
  const cases: [UiLanguage, RegExp][] = [
    ['English', /Minimum: all 30 days · Expected: up to Nov 25 \(22 days\) · Extra: up to Nov 25 \(22 days\)/],
    ['Português', /Mínimo: os 30 dias · Esperado: até 25 de nov\.? \(22 dias\) · Extra: até 25 de nov\.? \(22 dias\)/],
    ['Français', /Minimum : les 30 jours · Attendu : jusqu’au 25 nov\.? \(22 jours\) · Extra : jusqu’au 25 nov\.? \(22 jours\)/],
  ]
  for (const [language, text] of cases) {
    await setLanguage(page, language)
    await go(page, '/plan/proyeccion')
    await expect(page.getByTestId('scenario-coverage'), language).toHaveText(text)
    expect(await page.locator('#main').innerText(), language).not.toMatch(SCREEN_FAILED)
  }
})

/* ------------------------------------------------------------------ */
/* F3 · descarga de paquete que no responde                            */
/* ------------------------------------------------------------------ */

test.describe('F3 · paquetes de texto diferidos (sin service worker: el archivo JSON se pide a la red)', () => {
  test.use({ serviceWorkers: 'block' })

  /** Detiene la PRIMERA petición que coincide (queda pendiente hasta que termina la prueba); las siguientes pasan. */
  async function holdFirst(page: Page, pattern: string): Promise<{ held: Route[]; urls: string[] }> {
    const held: Route[] = []
    const urls: string[] = []
    await page.route(pattern, async (route) => {
      urls.push(route.request().url())
      if (held.length === 0) {
        held.push(route)
        await new Promise(() => {})
      } else await route.continue()
    })
    return { held, urls }
  }

  test('Privacidad en español con la descarga detenida: al vencer el plazo, estado de fallo; «Reintentar» pide el archivo de nuevo (otra marca) y el texto llega sin recargar; los datos siguen', async ({ page }) => {
    await startDemo(page)
    const before = await available(page).then((l) => l.textContent())
    const data = await storedData(page)
    const { urls } = await holdFirst(page, '**/assets/legal.es-*.json*')
    await go(page, '/legal/privacidad')
    await expect(page.getByTestId('pack-loading')).toBeVisible()
    expect(urls).toHaveLength(1)
    await page.clock.runFor(15_500)
    const failed = page.getByTestId('pack-failed')
    await expect(failed).toBeVisible()
    await expect(failed).toContainText('No se pudo cargar este texto')
    expect(await page.locator('#main').innerText()).not.toMatch(KEYS)
    await shot(page, 'nov04-f3-stalled-timeout', failed)
    await failed.getByRole('button', { name: 'Reintentar' }).click()
    await expect(page.getByText('Dónde están tus datos')).toBeVisible()
    await expect(page.getByTestId('pack-failed')).toHaveCount(0)
    // Una petición nueva de verdad: misma dirección con otra marca.
    expect(urls).toHaveLength(2)
    expect(urls[1]).toMatch(/\/assets\/legal\.es-[^/]*\.json\?retry=\d+$/)
    expect(urls[1]).not.toBe(urls[0])
    expect(await page.locator('#main').innerText()).not.toMatch(KEYS)
    await expect(page.getByTestId('pack-content')).not.toHaveAttribute('lang', /.+/)
    await shot(page, 'nov04-f3-stalled-recovered')
    await expect(await available(page)).toHaveText(before!)
    expect(await storedData(page)).toBe(data)
  })

  test('inglés con su descarga detenida: respaldo en español marcado con lang="es" bajo una interfaz en inglés; «Retry» pide el inglés de nuevo y llega', async ({ page }) => {
    await startDemo(page)
    await setLanguage(page, 'English')
    const { urls } = await holdFirst(page, '**/assets/legal.en-*.json*')
    await go(page, '/legal/privacidad')
    await page.clock.runFor(15_500)
    const fallback = page.getByTestId('pack-fallback')
    await expect(fallback).toContainText('This text could not be loaded in your language; it is shown in Spanish.')
    await expect(page.getByText('Dónde están tus datos')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByTestId('pack-content')).toHaveAttribute('lang', 'es')
    await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible()
    expect(await page.locator('#main').innerText()).not.toMatch(KEYS)
    await shot(page, 'nov04-f3-fallback-lang', page.locator('#main'))
    await fallback.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByText('Where your data lives')).toBeVisible()
    await expect(page.getByTestId('pack-fallback')).toHaveCount(0)
    await expect(page.getByTestId('pack-content')).not.toHaveAttribute('lang', /.+/)
    expect(urls).toHaveLength(2)
    expect(urls[1]).toMatch(/legal\.en-[^/]*\.json\?retry=\d+$/)
  })

  test('una petición rechazada (no detenida) se recupera igual: «Reintentar» pide el archivo con otra marca y Galería también', async ({ page }) => {
    await startDemo(page)
    const urls: string[] = []
    await page.route('**/assets/legal.es-*.json*', (route) => {
      urls.push(route.request().url())
      return urls.length === 1 ? route.abort('failed') : route.continue()
    })
    await go(page, '/legal/terminos')
    const failed = page.getByTestId('pack-failed')
    await expect(failed).toBeVisible()
    await failed.getByRole('button', { name: 'Reintentar' }).click()
    await expect(page.locator('#main section').first()).toBeVisible()
    await expect(page.getByTestId('pack-failed')).toHaveCount(0)
    expect(urls).toHaveLength(2)
    expect(urls[1]).toMatch(/\?retry=\d+$/)
    const gallery: string[] = []
    await page.route('**/assets/gallery.es-*.json*', (route) => {
      gallery.push(route.request().url())
      return gallery.length === 1 ? route.abort('failed') : route.continue()
    })
    await go(page, '/galeria')
    await expect(page.getByTestId('pack-failed')).toBeVisible()
    await page.getByTestId('pack-failed').getByRole('button', { name: 'Reintentar' }).click()
    await expect(page.getByText(/Todos los componentes base de Clara/)).toBeVisible()
    expect(gallery).toHaveLength(2)
    expect(gallery[1]).toMatch(/\?retry=\d+$/)
    expect(await page.locator('#main').innerText()).not.toMatch(KEYS)
  })
})

/* ------------------------------------------------------------------ */
/* F4 · duplicados: trabajo acotado                                    */
/* ------------------------------------------------------------------ */

/** 5 000 movimientos iguales el mismo día: 50 parejas de nota igual entre los 100 primeros, notas únicas después. */
const fiveThousand = (): AppData =>
  baseData({
    accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(100000, '2026-01-01') })],
    transactions: Array.from({ length: 5000 }, (_, i) => tx({ id: `t${String(i).padStart(4, '0')}`, date: TODAY, amountMinor: 1000, note: i < 100 ? `nota ${Math.floor(i / 2)}` : `única ${i}` })),
  })

test('F4 · 5 000 movimientos iguales con 50 parejas de nota igual: Pendientes abre con las 50 parejas y sin «hay más»', async ({ page }) => {
  await seedAt(page, fiveThousand(), TODAY)
  await go(page, '/pendientes')
  await expect(page.getByRole('heading', { name: /Posibles duplicados \(50\)/ })).toBeVisible()
  await expect(page.getByTestId('inbox-more-duplicates')).toHaveCount(0)
  await expect(page.locator('article', { hasText: 'nota 0' }).first()).toBeVisible()
  await shot(page, 'nov04-f4-inbox-5000')
})

/* ------------------------------------------------------------------ */
/* F5 · lo revisado se recupera aunque el tope esté lleno              */
/* ------------------------------------------------------------------ */

/** Pareja de hoy (p1, p2) con 12 movimientos iguales ocho días antes (66 parejas > tope), descartada o pospuesta. */
const crowded = (decision: 'dismissed' | 'snoozed'): AppData => {
  const pair = [tx({ id: 'p1', date: TODAY, amountMinor: 425, categoryId: 'dining', note: 'Café' }), tx({ id: 'p2', date: TODAY, amountMinor: 425, categoryId: 'dining', note: 'Café' })]
  const alone = baseData({ accounts: [account({ id: 'main', name: 'Principal', anchor: anchor(100000, '2026-01-01') })], transactions: pair })
  const item = computeInbox(alone, TODAY).find((i) => i.id === 'dup:p1:p2')!
  const earlier = Array.from({ length: 12 }, (_, i) => tx({ id: `e${String(i).padStart(2, '0')}`, date: isoDay(TODAY, -8), amountMinor: 425, categoryId: 'dining', note: 'Café' }))
  const inbox = decision === 'dismissed' ? { snoozed: [], dismissed: [{ id: item.id, fingerprint: item.fingerprint, at: `${TODAY}T12:00:00.000Z` }] } : { snoozed: [{ id: item.id, until: isoDay(TODAY, 7), at: `${TODAY}T12:00:00.000Z` }], dismissed: [] }
  return { ...alone, transactions: [...earlier, ...pair], inbox }
}

test('F5 · la pareja descartada sigue en «Descartados» con las 12 anteriores llenando el tope, y «Volver a mostrar» quita la decisión sin revisar las 66 ajenas', async ({ page }) => {
  await seedAt(page, crowded('dismissed'), TODAY)
  await go(page, '/pendientes')
  await expect(page.getByRole('heading', { name: /Posibles duplicados \(50\)/ })).toBeVisible()
  await expect(page.getByTestId('inbox-more-duplicates')).toBeVisible()
  const dismissed = page.locator('details', { hasText: 'Descartado (1)' })
  await expect(dismissed).toBeVisible()
  await dismissed.locator('summary').click()
  const entry = dismissed.locator('li', { hasText: 'Café' })
  await expect(entry).toContainText('4 nov')
  await shot(page, 'nov04-f5-dismissed-recoverable', dismissed)
  await expectNoHorizontalScroll(page, 'pendientes con una pareja descartada recuperable')
  await entry.getByRole('button', { name: 'Volver a mostrar' }).click()
  await waitForSaved(page)
  await expect(page.locator('details', { hasText: /Descartado/ })).toHaveCount(0)
  expect((await stored(page)).inbox.dismissed).toEqual([])
  // La pareja vuelve a ser una sin revisar: el grupo sigue lleno (50 a la vista, «hay más»).
  await expect(page.getByRole('heading', { name: /Posibles duplicados \(50\)/ })).toBeVisible()
  await expect(page.getByTestId('inbox-more-duplicates')).toBeVisible()
})

test('F5 · la pareja pospuesta sigue en «Pospuestos» con su fecha y «Mostrar ahora» quita la decisión; tras recargar, igual', async ({ page }) => {
  await seedAt(page, crowded('snoozed'), TODAY)
  await go(page, '/pendientes')
  const snoozed = page.locator('details', { hasText: 'Pospuesto (1)' })
  await expect(snoozed).toBeVisible()
  await page.reload()
  await go(page, '/pendientes')
  await expect(snoozed).toBeVisible()
  await snoozed.locator('summary').click()
  const entry = snoozed.locator('li', { hasText: 'Café' })
  await expect(entry).toContainText('11 nov')
  await shot(page, 'nov04-f5-snoozed-recoverable', snoozed)
  await entry.getByRole('button', { name: 'Mostrar ahora' }).click()
  await waitForSaved(page)
  await expect(page.locator('details', { hasText: /Pospuesto/ })).toHaveCount(0)
  expect((await stored(page)).inbox.snoozed).toEqual([])
})
