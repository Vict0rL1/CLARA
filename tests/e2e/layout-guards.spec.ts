import { expect, test, type Page } from '@playwright/test'
import { expectAboveFold, expectNoHorizontalScroll, expectNoMidWordBreaks, expectNoOverlap, expectNoTruncatedControls, go, openApp, pageHeightInScreens, setLanguage, setupFirstUse, showFullHome, startDemo, tabBarHeight, waitForFonts } from './helpers'

/**
 * Guardas de maquetación y jerarquía (ronda 2 de pulido). Cada prueba corresponde a un punto
 * del informe: B1 palabras partidas, B2 botón flotante que tapa, B3 una sola entrada «Agregar»,
 * B10 controles recortados, C1 Inicio, C2 Movimientos, C3 Ajustes. Fallaban en c75532b.
 */

const LANGUAGES = ['Español', 'English', 'Português', 'Français'] as const
const INTERACTIVE = 'main a, main button, main input, main select, main summary, main [role="button"]'
const FLOATING = '.fab, .toasts .toast'

/** Preferencias de presentación del dispositivo (vista «esencial» o «completa») antes de cargar. */
const presetView = (page: Page, view: 'essential' | 'full') => page.addInitScript((v) => localStorage.setItem('clara.ui.v1', JSON.stringify({ view: v })), view)

test.describe('B1 · ninguna categoría se parte a media palabra', () => {
  for (const language of LANGUAGES) {
    test(`configuración inicial en ${language}`, async ({ page }) => {
      await openApp(page)
      await page.getByRole('radio', { name: language }).check()
      await page.getByRole('button', { name: /Configurar con mis datos|Set up with my data|Configurar com meus dados|Configurer avec mes données/ }).click()
      await expect(page.locator('.cat-option__label').first()).toBeVisible()
      await expectNoMidWordBreaks(page.locator('.cat-option__label'), `categorías en ${language}`)
    })
  }
  test('pestañas y fichas de categoría sin guiones automáticos: cada navegador partiría distinto', async ({ page }) => {
    // Con `hyphens: auto`, Chromium 153 partía «Movi-mientos» en la barra (más alta) y nombres de
    // categoría; Chromium 141 no. Las palabras caben enteras (guarda de arriba): no hacen falta.
    await openApp(page)
    await page.getByRole('button', { name: 'Configurar con mis datos' }).click()
    await expect(page.locator('.cat-option__label').first()).toBeVisible()
    expect(await page.locator('.cat-option__label').first().evaluate((el) => getComputedStyle(el).hyphens)).toBe('manual')
    await page.goto('about:blank')
    await startDemo(page)
    const tabs = await page.locator('.nav a, .nav button').evaluateAll((els) => els.map((el) => getComputedStyle(el).hyphens))
    expect(tabs.length).toBeGreaterThan(0)
    expect(new Set(tabs)).toEqual(new Set(['manual']))
  })

  test('la tipografía Inter (autoalojada) carga y se usa: las medidas de estas guardas son con ella', async ({ page }) => {
    await openApp(page)
    // Con texto en pantalla el navegador ya pidió la fuente; `fonts.ready` antes de eso no espera nada.
    await expect(page.getByRole('heading', { name: 'Hola, esto es Clara' })).toBeVisible()
    await waitForFonts(page)
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?Inter"?,/)
    await expect
      .poll(() => page.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'Inter' && f.status === 'loaded').length), { message: 'caras de Inter cargadas' })
      .toBeGreaterThanOrEqual(1)
    expect(await page.evaluate(() => document.fonts.check('600 13px Inter')), 'Inter disponible para texto en latín').toBe(true)
  })
  test('gestión de categorías en Ajustes', async ({ page }) => {
    await startDemo(page)
    await go(page, '/ajustes/categorias')
    await expectNoMidWordBreaks(page.locator('.list-row__title, .cat-option__label, .cat-chip__label, .cat-tile__label'))
  })
})

test.describe('B2 · nada flotante tapa un control', () => {
  for (const [name, prepare, route] of [
    ['Inicio (demo)', startDemo, '/'],
    ['Inicio (primer uso)', setupFirstUse, '/'],
    ['Planes', startDemo, '/plan/planes'],
  ] as const) {
    test(name, async ({ page }) => {
      await prepare(page)
      await go(page, route)
      await expectNoOverlap(page, page.locator(FLOATING), page.locator(INTERACTIVE), name)
    })
  }
})

test('B3 · una sola entrada «Agregar» en Inicio', async ({ page }) => {
  await startDemo(page)
  const controls = page.getByRole('link', { name: /^(Agregar|Add)\b/ }).or(page.getByRole('button', { name: /^(Agregar|Add)\b/ }))
  await expect(controls).toHaveCount(1)
})

test.describe('B10 · ningún control recorta su texto', () => {
  for (const route of ['/movimientos', '/plan/planes', '/ajustes']) {
    test(route, async ({ page }) => {
      await startDemo(page)
      await go(page, route)
      await expectNoTruncatedControls(page, route)
    })
  }
})

test('G2 · los botones del héroe caben en una línea', async ({ page }) => {
  await startDemo(page)
  const heights = await page.locator('.hero__actions > .btn, .hero__actions summary').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)))
  expect(heights.length).toBeGreaterThan(1)
  for (const h of heights) expect(h, 'botón del héroe de una sola línea').toBeLessThanOrEqual(48)
})

const PLAN_ROUTES = ['/plan/planes', '/plan/calendario', '/plan/metas', '/plan/periodos', '/plan/proyeccion']

test.describe('F3 · Plan sin desplazamiento horizontal ni controles recortados, en los cuatro idiomas', () => {
  for (const language of LANGUAGES) {
    test(language, async ({ page }) => {
      test.setTimeout(120_000)
      await startDemo(page)
      await setLanguage(page, language)
      await go(page, '/plan/planes')
      const detail = (await page.locator('a.plan-card').first().getAttribute('href'))?.replace(/^#/, '')
      for (const route of [...PLAN_ROUTES, ...(detail ? [detail] : [])]) {
        await go(page, route)
        await expectNoHorizontalScroll(page, `${language} ${route}`)
        await expectNoTruncatedControls(page, `${language} ${route}`)
      }
    })
  }
})

test.describe('C1 · Inicio: la cifra principal primero y cabe en pocas pantallas', () => {
  test('primer uso: la tarjeta «Puedes gastar» es la primera', async ({ page }) => {
    await setupFirstUse(page)
    const firstCard = page.locator('.home-grid .card').first()
    await expect(firstCard).toHaveClass(/\bhero\b/)
  })
  test('demo: cabecera, cifra, por día, ingresos/gastos y el primer aviso en la primera pantalla', async ({ page }, info) => {
    await startDemo(page)
    await expectAboveFold(page, page.locator('.topbar'), 'cabecera')
    await expectAboveFold(page, page.getByTestId('available'), 'cifra principal')
    await expectAboveFold(page, page.locator('.stat__value').first(), 'por día')
    await expectAboveFold(page, page.getByTestId('period-income'), 'caja INGRESOS')
    await expectAboveFold(page, page.getByTestId('period-expenses'), 'caja GASTOS')
    // A 320 × 640 la primera pantalla termina con la cifra; el aviso llega en la siguiente (DECISIONS).
    if (info.project.name !== 'celular-pequeno') await expectAboveFold(page, page.locator('main .alert').first(), 'primer aviso')
  })
  test('demo: ≤ 2 pantallas en «Esencial» y ≤ 3 en «Completa»', async ({ page }, info) => {
    await presetView(page, 'essential')
    await startDemo(page)
    // A 320 × 640 el aviso, los favoritos y «Más herramientas» ocupan más alto, y desde la ronda Lukas
    // la vista esencial suma la línea «En cuentas · Reservado» y la franja de próximos pagos: hasta 2,75
    // (decisión 146; la vista completa sigue en ≤ 3).
    expect(await pageHeightInScreens(page), 'vista esencial').toBeLessThanOrEqual(info.project.name === 'celular-pequeno' ? 2.75 : 2)
  })
  test('demo: ≤ 3 pantallas en «Completa»', async ({ page }) => {
    await presetView(page, 'full')
    await startDemo(page)
    expect(await pageHeightInScreens(page), 'vista completa').toBeLessThanOrEqual(3)
  })
})

test('C2 · Movimientos: título, búsqueda y al menos 3 filas en la primera pantalla', async ({ page }, info) => {
  await startDemo(page)
  await go(page, '/movimientos')
  await expectAboveFold(page, page.locator('#page-title'), 'título')
  await expectAboveFold(page, page.getByRole('searchbox'), 'búsqueda')
  await expect(page.locator('.tx-group .item').first()).toBeVisible()
  await waitForFonts(page)
  const limit = page.viewportSize()!.height - (await tabBarHeight(page))
  const rows = await page.locator('.tx-group .item').evaluateAll((els, max) => els.filter((el) => el.getBoundingClientRect().bottom <= max).length, limit)
  // Si falla, el mensaje dice qué ocupa la primera pantalla (bloques de <main> con su alto).
  const layout = await page.evaluate(() =>
    [...(document.querySelector('main')?.querySelectorAll(':scope > *, :scope > * > *') ?? [])]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.height > 0 && r.top < window.innerHeight)
      .map(({ el, r }) => `${el.className || el.tagName}@${Math.round(r.top)}+${Math.round(r.height)}`)
      .join(' · '),
  )
  // A 320 × 640 caben el título, la búsqueda, el resumen del mes y la primera fila (DECISIONS).
  expect(rows, `filas de movimientos visibles sin desplazarse (límite ${limit} px): ${layout}`).toBeGreaterThanOrEqual(info.project.name === 'celular-pequeno' ? 1 : 3)
})

test.describe('C3 · Ajustes: índice corto y subpantallas acotadas', () => {
  test('índice ≤ 2,5 pantallas', async ({ page }, info) => {
    await startDemo(page)
    await go(page, '/ajustes')
    // A 320 × 640 las filas con valor ocupan dos líneas: hasta 3 pantallas (DECISIONS).
    expect(await pageHeightInScreens(page)).toBeLessThanOrEqual(info.project.name === 'celular-pequeno' ? 3 : 2.5)
  })
  for (const id of ['copia', 'notificaciones', 'cuentas', 'programados']) {
    test(`subpantalla ${id} ≤ 4 pantallas`, async ({ page }) => {
      await startDemo(page)
      await go(page, `/ajustes/${id}`)
      await expect(page.locator('#page-title')).not.toHaveText(/^Ajustes$/)
      expect(await pageHeightInScreens(page)).toBeLessThanOrEqual(4)
    })
  }
})

/** E1: un solo estilo de categoría (círculo con tinte e icono) en fichas, selector, filas, Ajustes y leyendas. */
async function expectOneCategoryStyle(page: Page, scope = 'main') {
  const dots = page.locator(`${scope} .cat-dot`)
  const n = await dots.count()
  expect(n, 'hay al menos un icono de categoría').toBeGreaterThan(0)
  const bad = await dots.evaluateAll((els) =>
    els
      .map((el) => {
        const r = el.getBoundingClientRect()
        const lg = el.classList.contains('cat-dot--lg')
        const svg = el.querySelector('svg')
        const expected = lg ? 40 : 32
        const icon = lg ? 20 : 16
        const w = Math.round(r.width)
        const h = Math.round(r.height)
        const s = svg ? Math.round(svg.getBoundingClientRect().width) : 0
        return w === expected && h === expected && s === icon ? null : `${el.className}: ${w}×${h}, icono ${s}`
      })
      .filter(Boolean),
  )
  expect(bad, 'todos los iconos de categoría miden lo mismo').toEqual([])
}

test.describe('E1 · un solo estilo de categoría en toda la app', () => {
  test('filas de Movimientos, Ajustes › Categorías, leyenda de Estadísticas y selector', async ({ page }) => {
    await startDemo(page)
    await go(page, '/movimientos')
    // Cada fila con categoría muestra su icono con el tinte de la categoría (no solo el tipo de movimiento).
    await expect(page.locator('.item', { hasText: 'Supermercado' }).first().locator('.cat-dot')).toHaveCount(1)
    await expectOneCategoryStyle(page)
    await go(page, '/ajustes/categorias')
    await expectOneCategoryStyle(page)
    await go(page, '/estadisticas')
    await expect(page.getByTestId('stats-tiles')).toBeVisible()
    await expect(page.locator('.donut__row .cat-dot svg').first()).toBeVisible()
    await expectOneCategoryStyle(page)
    await go(page, '/movimientos/nuevo')
    await page.getByLabel('Categoría', { exact: true }).click()
    await expect(page.getByTestId('category-picker')).toBeVisible()
    await expectOneCategoryStyle(page, '[data-testid="category-picker"]')
  })

  test('fichas de la configuración inicial: el mismo círculo, en grande', async ({ page }) => {
    await openApp(page)
    await page.getByRole('button', { name: 'Configurar con mis datos' }).click()
    await expect(page.getByRole('heading', { name: 'Tus categorías' })).toBeVisible()
    await expectOneCategoryStyle(page)
  })
})

/**
 * E3: cada lista vacía usa el estado vacío común: icono, título de una línea, texto de una línea
 * (dos a 320 px) y como mucho una acción; ningún gráfico vacío pasa de 160 px.
 */
async function expectEmptyStates(page: Page, min: number, maxLines: number) {
  const empties = page.locator('main .empty')
  await expect(empties.first()).toBeVisible()
  expect(await empties.count(), 'estados vacíos en la pantalla').toBeGreaterThanOrEqual(min)
  const problems = await empties.evaluateAll(
    (els, max) =>
      els.flatMap((el) => {
        const out: string[] = []
        const lines = (node: Element | null) => {
          if (!node) return 0
          const lh = parseFloat(getComputedStyle(node).lineHeight) || 20
          return Math.round(node.getBoundingClientRect().height / lh)
        }
        const title = el.querySelector('.empty__title')
        const text = el.querySelector('.empty__text')
        const label = (title?.textContent ?? '').slice(0, 40)
        if (el.querySelectorAll(':scope > svg.empty__icon').length !== 1) out.push(`${label}: sin icono`)
        if (!title) out.push('sin título')
        if (lines(title) > max) out.push(`${label}: título en ${lines(title)} líneas`)
        if (text && lines(text) > max) out.push(`${label}: texto en ${lines(text)} líneas`)
        if (el.querySelector('.empty__text p, .empty__text ul')) out.push(`${label}: párrafos dentro del texto`)
        const actions = el.querySelectorAll('a, button').length
        if (actions > 1) out.push(`${label}: ${actions} acciones`)
        return out
      }),
    maxLines,
  )
  expect(problems).toEqual([])
}

test.describe('E3 · estados vacíos con el componente común', () => {
  test('primer uso: historial, metas, planes, estadísticas, papelera, favoritos, plantillas, etiquetas y reglas', async ({ page }, info) => {
    test.setTimeout(120_000)
    const max = info.project.name === 'celular-pequeno' ? 2 : 1
    await setupFirstUse(page)
    const routes: [string, number][] = [
      ['/movimientos', 1],
      ['/plan/metas', 1], // la configuración ya crea la meta de la reserva: queda vacío «Gastos planificados»
      ['/estadisticas', 1],
      ['/movimientos/papelera', 1],
      ['/movimientos/favoritos', 1],
      ['/movimientos/plantillas', 1],
      ['/ajustes/etiquetas', 1],
      ['/ajustes/reglas', 1],
      ['/plan/periodos', 1],
    ]
    for (const [route, min] of routes) {
      await go(page, route)
      await expectEmptyStates(page, min, max)
    }
    // Plan › Planes: tras la introducción, «Activos» está vacío (la meta de la reserva ya está completa).
    await go(page, '/plan/planes')
    await page.getByRole('button', { name: 'Omitir' }).click()
    await expectEmptyStates(page, 1, max)
    // Sin datos, Estadísticas no dibuja gráficos vacíos (y ninguno pasa de 160 px).
    await go(page, '/estadisticas')
    const tall = await page.locator('main svg').evaluateAll((svgs) => svgs.filter((s) => s.getBoundingClientRect().height > 160).map((s) => s.getAttribute('class')))
    expect(tall).toEqual([])
  })
})

/**
 * E6: en Inicio, Movimientos y Plan las explicaciones visibles son una frase corta (≤ 2 líneas en
 * Pixel 7 y escritorio, ≤ 3 a 320 px); el párrafo completo vive en «¿Por qué?».
 */
test.describe('E6 · explicaciones de una frase con «¿Por qué?»', () => {
  test('Inicio, Movimientos y las cinco pantallas de Plan', async ({ page }, info) => {
    test.setTimeout(120_000)
    const max = info.project.name === 'celular-pequeno' ? 3 : 2
    await startDemo(page)
    await showFullHome(page)
    const check = async (where: string) => {
      const long = await page.locator('main p.note, main p.lead, main .alert__text').evaluateAll(
        (els, limit) =>
          els
            .filter((el) => el.getBoundingClientRect().height > 0 && !el.closest('details:not([open]), .explain, .empty') && !el.querySelector('.why'))
            .map((el) => {
              const lh = parseFloat(getComputedStyle(el).lineHeight) || 20
              return { lines: Math.round(el.getBoundingClientRect().height / lh), text: (el.textContent ?? '').slice(0, 60) }
            })
            .filter((x) => x.lines > limit)
            .map((x) => `${x.lines} líneas: ${x.text}`),
        max,
      )
      expect(long, `explicaciones largas en ${where}`).toEqual([])
      const whys = page.locator('main .why')
      for (let i = 0; i < (await whys.count()); i++) {
        const why = whys.nth(i)
        await expect(why.locator('summary')).toHaveText(/¿Por qué\?/)
        expect(((await why.locator('details').textContent()) ?? '').length).toBeGreaterThan(40)
      }
    }
    await check('Inicio')
    await go(page, '/movimientos')
    await check('Movimientos')
    for (const tab of ['planes', 'calendario', 'metas', 'periodos', 'proyeccion']) {
      await go(page, `/plan/${tab}`)
      await check(`Plan › ${tab}`)
    }
  })
})

test('E6 · la etiqueta del periodo en el héroe cabe sin recortarse (también en un mes pasado)', async ({ page }) => {
  await startDemo(page)
  const label = page.getByTestId('period-label')
  const fits = () => label.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
  expect(await fits()).toBe(true)
  await page.getByTestId('period-prev').click()
  await expect(label).toContainText(/agosto|ago/i)
  expect(await fits()).toBe(true)
})
