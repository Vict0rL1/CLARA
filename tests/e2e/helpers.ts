import { expect, type Locator, type Page } from '@playwright/test'

/** Mediodía del 28-sep-2026 en Toronto. El reloj avanza con normalidad desde aquí. */
export const START = new Date('2026-09-28T12:00:00-04:00')

export async function openApp(page: Page, time: Date = START) {
  await page.clock.install({ time })
  await page.goto('/')
}

/** Abre la app y carga los datos de demostración (fechas relativas a START). */
export async function startDemo(page: Page, time: Date = START) {
  await openApp(page, time)
  await page.getByRole('button', { name: 'Explorar con datos de demostración' }).click()
  await expect(page.getByTestId('available')).toBeVisible()
}

export function nav(page: Page, name: 'Inicio' | 'Movimientos' | 'Plan' | 'Ajustes') {
  return page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name })
}

export async function go(page: Page, hash: string) {
  // Como una persona: espera a que termine de guardarse lo anterior (el guardado es asíncrono
  // y, al terminar, el formulario vuelve a su pantalla de origen).
  await expect(page.locator('.save-indicator--saving')).toHaveCount(0)
  await page.waitForTimeout(0)
  await page.evaluate((h) => {
    window.location.hash = h
  }, hash)
  await expect(page.locator('#page-title')).toBeVisible()
}

export async function available(page: Page) {
  await go(page, '/')
  return page.getByTestId('available')
}

/** Número de movimientos según el resumen de la lista. */
export async function movementCount(page: Page): Promise<number> {
  await go(page, '/movimientos')
  if ((await page.getByText('Todavía no hay movimientos').count()) > 0) return 0
  const text = (await page.locator('.summary-line').textContent()) ?? ''
  return Number(/(\d+) movimiento/.exec(text)?.[1] ?? NaN)
}

/** Inicio agrupa los avisos secundarios en «N avisos más»: los despliega si existen. */
export async function showAllNotices(page: Page) {
  const more = page.getByTestId('more-notices')
  if ((await more.count()) > 0 && !(await more.evaluate((d) => (d as HTMLDetailsElement).open))) await more.locator('summary').click()
}

/* ------------------------------------------------------------------ */
/* Almacenamiento real de la app (IndexedDB «clara», almacén «kv»).    */
/* ------------------------------------------------------------------ */

/** Texto JSON de los datos guardados (o null si no hay). */
export async function storedData(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      new Promise<string | null>((resolve, reject) => {
        const req = indexedDB.open('clara', 1)
        req.onsuccess = () => {
          const get = req.result.transaction('kv', 'readonly').objectStore('kv').get('data')
          get.onsuccess = () => {
            resolve(get.result === undefined ? null : JSON.stringify(get.result))
            req.result.close()
          }
          get.onerror = () => reject(get.error)
        }
        req.onerror = () => reject(req.error)
      }),
  )
}

/** Sustituye los datos guardados (como si otra versión o pestaña los hubiera escrito). */
export async function writeStoredData(page: Page, data: unknown) {
  await page.evaluate(
    (d) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('clara', 1)
        req.onsuccess = () => {
          const tx = req.result.transaction('kv', 'readwrite')
          tx.objectStore('kv').put(d, 'data')
          tx.objectStore('kv').put({ revision: 1_000_000 + Math.floor(Math.random() * 1000), savedAt: new Date().toISOString() }, 'meta')
          tx.oncomplete = () => {
            req.result.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
        req.onerror = () => reject(req.error)
      }),
    data,
  )
}

/**
 * Siembra datos en el almacenamiento real (IndexedDB) desde la bienvenida y recarga, como una persona
 * que ya usaba Clara. `data` suele venir de los constructores de `src/test/fixtures.ts`.
 */
export async function seedStoredData(page: Page, data: unknown) {
  await openApp(page)
  await expect(page.getByRole('heading', { name: 'Hola, esto es Clara' })).toBeVisible()
  await writeStoredData(page, data)
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
}

/** Hace que IndexedDB rechace escrituras (como con el almacenamiento lleno). */
export async function failStorageWrites(page: Page, name: 'QuotaExceededError' | 'InvalidStateError' = 'QuotaExceededError') {
  await page.evaluate((n) => {
    const w = window as unknown as { __realPut?: typeof IDBObjectStore.prototype.put }
    w.__realPut ??= IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('simulado', n)
    }
  }, name)
}

export async function restoreStorageWrites(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __realPut?: typeof IDBObjectStore.prototype.put }
    if (w.__realPut) IDBObjectStore.prototype.put = w.__realPut
  })
}

/** Lee cualquier registro del almacén (p. ej. la copia previa a un cambio de formato). */
export async function storedRecord(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (k) =>
      new Promise<unknown>((resolve, reject) => {
        const req = indexedDB.open('clara', 1)
        req.onsuccess = () => {
          const get = req.result.transaction('kv', 'readonly').objectStore('kv').get(k)
          get.onsuccess = () => {
            resolve(get.result ?? null)
            req.result.close()
          }
          get.onerror = () => reject(get.error)
        }
        req.onerror = () => reject(req.error)
      }),
    key,
  )
}

/** Simula a alguien que viene de una versión anterior: datos solo en localStorage. */
export async function seedLegacyLocalStorage(page: Page, data: unknown) {
  await page.evaluate(
    (text) =>
      new Promise<void>((resolve) => {
        localStorage.setItem('margen.data.v1', text)
        localStorage.removeItem('margen.data.pre-idb')
        const req = indexedDB.deleteDatabase('clara')
        req.onsuccess = () => resolve()
        req.onblocked = () => resolve()
        req.onerror = () => resolve()
      }),
    JSON.stringify(data),
  )
}

/** Abre «Más detalles» del formulario de movimiento (fecha, estado, nota…) si está plegado. */
export async function openDetails(page: Page) {
  const details = page.getByTestId('movement-details')
  if ((await details.count()) === 0) return
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator('summary').click()
}

/* ------------------------------------------------------------------ */
/* Estados de partida reutilizables (prueba manual y capturas).         */
/* ------------------------------------------------------------------ */

/**
 * Configuración inicial con los números de `docs/MANUAL-TEST.md` (hoy = START):
 * 1200 de saldo, ingreso de 800 el 8-oct, renta de 600 el 3-oct, 200 reservados → 400.00.
 * Deja la app en Inicio con el recorrido de 3 pasos ya omitido.
 */
export async function setupFirstUse(page: Page) {
  await openApp(page)
  await page.getByRole('button', { name: 'Configurar con mis datos' }).click()
  await expect(page.getByRole('heading', { name: 'Tus categorías' })).toBeVisible()
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByLabel('Saldo disponible').fill('1200')
  await page.getByLabel('Periodo del presupuesto').selectOption({ label: 'Hasta mi próximo ingreso' })
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByLabel('Importe esperado').fill('800')
  await page.getByLabel('Fecha del próximo ingreso').fill('2026-10-08')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByRole('button', { name: 'Agregar un pago' }).click()
  await page.getByLabel('Nombre').fill('Renta')
  await page.getByLabel('Importe', { exact: true }).fill('600')
  await page.getByLabel('Próxima fecha de pago').fill('2026-10-03')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByLabel('Cantidad reservada').fill('200')
  await page.getByRole('button', { name: 'Ver resumen' }).click()
  await page.getByRole('button', { name: 'Empezar a usar Clara' }).click()
  await expect(page.getByTestId('available')).toHaveText('$400.00')
  const skip = page.getByRole('button', { name: 'Omitir' })
  if ((await skip.count()) > 0) await skip.click()
}

/**
 * D5: elige una categoría en el selector (campo → hoja → opción). `field` es el botón del campo
 * (p. ej. `page.getByLabel('Categoría', { exact: true })`).
 */
export async function pickCategory(page: Page, field: Locator, option: string | RegExp) {
  await field.click()
  const picker = page.getByTestId('category-picker')
  await picker.waitFor()
  await picker.getByRole('option', { name: option }).first().click()
  // En modo múltiple (filtros, límites) la hoja sigue abierta hasta «Listo».
  const done = page.getByRole('dialog').filter({ has: picker }).getByRole('button', { name: 'Listo' })
  if ((await done.count()) > 0) await done.click()
  await picker.waitFor({ state: 'hidden' })
}

/** Abre o cierra «¿Cómo se calculó?» del héroe (en pantallas estrechas el texto visible es «¿Cómo?», G2). */
export async function openExplain(page: Page) {
  await page.locator('.hero .explain > summary').first().click()
}

/**
 * Sin desplazamiento horizontal (F3): el documento no es más ancho que la ventana y ningún
 * elemento visible de `main` termina más allá del borde derecho (un contenedor con
 * `overflow: hidden` esconde el desbordamiento sin que el documento crezca). Los elementos dentro
 * de una franja que se desplaza a propósito (pestañas, fichas) no cuentan.
 */
export async function expectNoHorizontalScroll(page: Page, label?: string) {
  await waitForFonts(page)
  const result = await page.evaluate(() => {
    const limit = window.innerWidth + 1
    const docOverflow = document.documentElement.scrollWidth - window.innerWidth
    const main = document.getElementById('main') ?? document.body
    const scrolls = (el: Element | null) => {
      for (let n = el; n && n !== main; n = n.parentElement) {
        const o = getComputedStyle(n).overflowX
        if (o === 'auto' || o === 'scroll') return true
      }
      return false
    }
    const out: string[] = []
    for (const el of main.querySelectorAll<HTMLElement>('*')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || r.right <= limit) continue
      // El contenido de un <details> cerrado no se ve, pero Chromium le da caja al medirlo.
      if (scrolls(el) || el.closest('details:not([open])')) continue
      out.push(`${el.tagName.toLowerCase()}.${el.className && typeof el.className === 'string' ? el.className.split(' ').slice(0, 2).join('.') : ''} termina en x=${Math.round(r.right)}`)
      if (out.length >= 5) break
    }
    return { docOverflow, out }
  })
  expect(result.docOverflow, `${label ?? page.url()}: desplazamiento horizontal de ${result.docOverflow}px`).toBeLessThanOrEqual(0)
  expect(result.out, `${label ?? page.url()}: elementos más allá del borde derecho`).toEqual([])
}

export type UiLanguage = 'Español' | 'English' | 'Português' | 'Français'
const LANG_CODE: Record<UiLanguage, string> = { Español: 'es', English: 'en', Português: 'pt', Français: 'fr' }

/** Cambia el idioma desde Ajustes › Formato (la demo arranca en español) y espera al diccionario. */
export async function setLanguage(page: Page, language: UiLanguage) {
  await go(page, '/ajustes/formato')
  await page.getByTestId('language-chips').getByRole('button', { name: new RegExp(language) }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', LANG_CODE[language])
}

/**
 * C1: Inicio arranca en vista esencial; las secciones secundarias (semana, metas, datos,
 * recordatorios) viven en la vista completa, plegadas en «Más en tu Inicio». Pasa a completa (si
 * hace falta) y despliega esa tarjeta.
 */
export async function showFullHome(page: Page) {
  const full = page.getByTestId('show-full-home')
  if (await full.count()) await full.click()
  const more = page.getByTestId('home-more')
  if ((await more.count()) && !(await more.evaluate((el) => (el as HTMLDetailsElement).open))) await more.locator(':scope > summary').click()
}

/** C2: abre la hoja «Filtros» de Movimientos (los filtros ya no están en la página). */
export async function openFilters(page: Page) {
  await page.getByTestId('open-filters').click()
  await page.getByTestId('filters-sheet').waitFor()
  return page.getByRole('dialog', { name: 'Filtros' })
}

/** Cierra la hoja de filtros con «Ver resultados». */
export async function applyFilters(page: Page) {
  await page.getByRole('dialog', { name: 'Filtros' }).getByRole('button', { name: 'Ver resultados' }).click()
  await page.getByTestId('filters-sheet').waitFor({ state: 'hidden' })
}

/** C2: menú «⋯» de Movimientos (Estadísticas, Favoritos, Plantillas, Papelera, Importar CSV). */
export async function openMoreMenu(page: Page) {
  await page.getByTestId('movements-more').click()
  return page.getByRole('dialog', { name: 'Más opciones' })
}

/** C2: el resumen del mes es un desplegable cerrado por defecto. */
export async function openMonthSummary(page: Page) {
  const summary = page.locator('.month-summary')
  if (!(await summary.evaluate((el) => (el as HTMLDetailsElement).open))) await summary.locator('summary').click()
  return summary
}

/**
 * Espera a que terminen las transiciones y animaciones finitas (el color de la pestaña activa al
 * navegar, el cambio de tema, la entrada de un aviso). Una auditoría de contraste a mitad de una
 * transición mide colores intermedios que nadie ve más de 200 ms: en CI fallaba una vez de cada
 * muchas. Las animaciones infinitas (spinner, skeleton) no se esperan.
 */
export async function settleAnimations(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().endTime === Infinity), undefined, { polling: 50 })
}

/** Abre la hoja «¿Qué quieres registrar?» por la entrada que exista (botón flotante o pestaña «+»). */
export async function openAddSheet(page: Page) {
  const fab = page.locator('.fab')
  if ((await fab.count()) > 0) await fab.first().click()
  else await page.getByRole('navigation', { name: /Navegación principal|Main navigation/ }).getByRole('button', { name: /Agregar|Add/ }).click()
  await expect(page.getByRole('dialog', { name: /¿Qué quieres registrar\?|What do you want to log\?/ })).toBeVisible()
}

/* ------------------------------------------------------------------ */
/* Guardas de maquetación (lo que las pruebas funcionales no ven).      */
/* ------------------------------------------------------------------ */

/**
 * Espera a que terminen de cargar las fuentes de la página (Inter, autoalojada, con
 * `font-display: swap`). Hasta entonces el texto usa la fuente del sistema, con otras medidas:
 * las guardas de maquetación miden la página ya con Inter.
 */
export async function waitForFonts(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
}

/**
 * Ninguna palabra se parte a media línea: dentro del localizador, cada salto de línea
 * renderizado (medido carácter a carácter con `Range.getClientRects()`) ocurre tras un espacio,
 * un guion o un guion suave; nunca en mitad de una palabra.
 *
 * Además, ninguna palabra es más ancha que el espacio de su contenedor: según el navegador, una
 * palabra que no cabe se parte (Chromium reciente) o se sale de su caja (Chromium anterior), y
 * las dos cosas son un defecto. Medir el ancho no depende de cómo decida cortar cada versión.
 */
export async function expectNoMidWordBreaks(locator: Locator, label?: string) {
  await waitForFonts(locator.page())
  const problems = await locator.evaluateAll((els) => {
    const out: string[] = []
    for (const el of els) {
      if (!(el instanceof HTMLElement) || el.getClientRects().length === 0) continue
      // Texto solo para lectores de pantalla (1 px de ancho) se parte en cada letra a propósito.
      if (el.getBoundingClientRect().width < 12) continue
      const parent = el.parentElement
      if (parent) {
        const cs = getComputedStyle(parent)
        const room = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
        for (const word of (el.textContent ?? '').split(/[\s\u00ad]+/).filter(Boolean)) {
          const probe = document.createElement('span')
          probe.textContent = word
          probe.style.whiteSpace = 'nowrap'
          el.appendChild(probe)
          const width = probe.getBoundingClientRect().width
          probe.remove()
          if (width > room + 0.5) out.push(`«${word}» no cabe (${Math.round(width)} px en ${Math.round(room)} px)`)
        }
      }
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walker.nextNode())) {
        const text = node.textContent ?? ''
        if (!text.trim()) continue
        const range = document.createRange()
        let lastTop: number | null = null
        for (let i = 0; i < text.length; i++) {
          range.setStart(node, i)
          range.setEnd(node, i + 1)
          const rect = range.getClientRects()[0]
          if (!rect || rect.width === 0) continue
          const top = Math.round(rect.top)
          if (lastTop !== null && top > lastTop + 2) {
            const before = text[i - 1] ?? ''
            const okBreak = /[\s\-‐‑­/]/.test(before) || /\s/.test(text[i]!)
            if (!okBreak) out.push(`«${text.slice(Math.max(0, i - 10), i)}|${text.slice(i, i + 10)}»`)
          }
          lastTop = top
        }
      }
    }
    return out
  })
  expect(problems, label ?? 'palabras partidas a media línea').toEqual([])
}

type Box = { x: number; y: number; w: number; h: number; name: string; fixed: boolean }
/** Cajas en coordenadas del documento (las fijas, en coordenadas de la ventana, marcadas `fixed`). */
const boxesOf = (locator: Locator) =>
  locator.evaluateAll((els) =>
    els
      // Lo fijo (botón flotante, barra inferior) no tiene offsetParent: se mira el rectángulo pintado.
      .filter((el): el is HTMLElement => el instanceof HTMLElement && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
      .map((el) => {
        const r = el.getBoundingClientRect()
        let fixed = false
        for (let n: HTMLElement | null = el; n; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') fixed = true
        const name = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40)
        return { x: r.left + (fixed ? 0 : window.scrollX), y: r.top + (fixed ? 0 : window.scrollY), w: r.width, h: r.height, name, fixed }
      })
      .filter((b) => b.w > 0 && b.h > 0),
  ) as Promise<Box[]>

const T = 1
/**
 * ¿Se solapan en alguna posición del desplazamiento? Una caja fija se mueve respecto al documento:
 * tapa a `b` si existe un desplazamiento `y` en [0, máximo] con el que coinciden en vertical.
 */
function overlapsSomewhere(a: Box, b: Box, maxScroll: number): boolean {
  const horizontal = a.x + T < b.x + b.w && b.x + T < a.x + a.w
  if (!horizontal) return false
  if (a.fixed === b.fixed) return a.y + T < b.y + b.h && b.y + T < a.y + a.h
  const [fixed, doc] = a.fixed ? [a, b] : [b, a]
  // Con desplazamiento y, el elemento del documento queda en (doc.y − y); coincide si
  // doc.y − y < fixed.y + fixed.h  y  doc.y + doc.h − y > fixed.y.
  const from = Math.max(0, doc.y + T - (fixed.y + fixed.h))
  const to = Math.min(maxScroll, doc.y + doc.h - fixed.y - T)
  return from < to
}

/**
 * Las cajas de `a` no tapan ninguna de `b` en NINGUNA posición del desplazamiento (arriba,
 * abajo o en cualquier punto intermedio): un control fijo que cubra un enlace a mitad de
 * página también cuenta. Se calcula con geometría, sin desplazar la página.
 */
export async function expectNoOverlap(page: Page, a: Locator, b: Locator, label?: string) {
  await waitForFonts(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  const maxScroll = await page.evaluate(() => Math.max(0, document.scrollingElement!.scrollHeight - window.innerHeight))
  const as = await boxesOf(a)
  const bs = as.length ? await boxesOf(b) : []
  const overlaps: string[] = []
  for (const x of as) for (const z of bs) if (overlapsSomewhere(x, z, maxScroll)) overlaps.push(`«${x.name}» tapa «${z.name}»`)
  expect(overlaps, label ?? 'elementos solapados').toEqual([])
}

/** Altura de la barra de navegación inferior (0 en escritorio, donde va al lado). */
export async function tabBarHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const nav = document.querySelector('.nav')
    if (!nav) return 0
    const r = nav.getBoundingClientRect()
    return r.top >= window.innerHeight - r.height - 1 && r.width > window.innerWidth / 2 ? r.height : 0
  })
}

/** El elemento cabe en la primera pantalla: su borde inferior queda por encima de la barra inferior. */
export async function expectAboveFold(page: Page, locator: Locator, label?: string) {
  await waitForFonts(page)
  await page.evaluate(() => window.scrollTo(0, 0))
  expect(await locator.count(), `${label ?? 'elemento'}: existe`).toBeGreaterThan(0)
  const box = await locator.first().boundingBox()
  const viewport = page.viewportSize()!
  const limit = viewport.height - (await tabBarHeight(page))
  expect(box, `${label ?? 'elemento'}: visible`).not.toBeNull()
  expect(box!.y + box!.height, `${label ?? 'elemento'}: borde inferior ≤ ${limit}px (primera pantalla)`).toBeLessThanOrEqual(limit)
}

/**
 * Ningún control recorta su texto: botones, chips y pestañas sin `scrollWidth > clientWidth`;
 * en los `<select>`, el texto de la opción elegida cabe en el ancho del control.
 */
export async function expectNoTruncatedControls(page: Page, label?: string) {
  await waitForFonts(page)
  const truncated = await page.evaluate(() => {
    const out: string[] = []
    const visible = (el: HTMLElement) => el.getClientRects().length > 0 && el.clientWidth > 0
    for (const el of document.querySelectorAll<HTMLElement>('button, .chip, .tabs__tab, .segmented__option, a.btn')) {
      if (!visible(el)) continue
      if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName.toLowerCase()} «${(el.textContent ?? '').trim().slice(0, 30)}» (${el.scrollWidth} > ${el.clientWidth})`)
    }
    const probe = document.createElement('span')
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;top:-9999px'
    document.body.appendChild(probe)
    for (const sel of document.querySelectorAll<HTMLSelectElement>('select')) {
      if (!visible(sel)) continue
      const cs = getComputedStyle(sel)
      probe.style.font = cs.font
      probe.textContent = sel.selectedOptions[0]?.textContent ?? ''
      const room = sel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 20
      if (probe.offsetWidth > room) out.push(`select «${probe.textContent.slice(0, 30)}» (${probe.offsetWidth} > ${Math.round(room)})`)
    }
    // Marcadores de posición (G1): el texto de ayuda de un campo vacío tampoco se recorta.
    for (const input of document.querySelectorAll<HTMLInputElement>('input[placeholder]')) {
      if (!visible(input) || input.value) continue
      const cs = getComputedStyle(input)
      probe.style.font = cs.font
      probe.textContent = input.placeholder
      const room = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      if (probe.offsetWidth > room) out.push(`placeholder «${input.placeholder.slice(0, 30)}» (${probe.offsetWidth} > ${Math.round(room)})`)
    }
    probe.remove()
    return out
  })
  expect(truncated, label ?? 'controles con texto recortado').toEqual([])
}

/** Altura de la página en pantallas (1 = cabe sin desplazarse). */
export async function pageHeightInScreens(page: Page): Promise<number> {
  await waitForFonts(page)
  return page.evaluate(() => document.scrollingElement!.scrollHeight / window.innerHeight)
}

/* ------------------------------------------------------------------ */
/* Service worker                                                      */
/* ------------------------------------------------------------------ */

/**
 * Deja la página CONTROLADA por el service worker. `registration.active` existe mientras el
 * worker aún se activa, y una recarga iniciada en ese instante puede quedar sin controlar: se
 * espera a `ready` y se recarga, comprobando `controller`, hasta un máximo de intentos.
 */
export async function waitForServiceWorkerControl(page: Page) {
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready)?.active, undefined, { timeout: 60_000 })
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.reload()
    await page.locator('#page-title, [data-testid="available"]').first().waitFor({ timeout: 30_000 })
    if (await page.evaluate(() => !!navigator.serviceWorker.controller)) return
    await page.waitForTimeout(500 * (attempt + 1))
  }
  throw new Error('La página no quedó controlada por el service worker tras varias recargas')
}

/** La caché de ESTA versión ya tiene archivos (la precarga terminó). */
export async function waitForPrecache(page: Page) {
  await page.waitForFunction(
    async () => {
      for (const key of await caches.keys()) if (key.startsWith('margen-') && (await (await caches.open(key)).keys()).length > 0) return true
      return false
    },
    undefined,
    { timeout: 60_000 },
  )
}

/**
 * Espera a que la app confirme lo guardado («Guardando…» desaparece) antes de seguir. Recargar con una
 * escritura de IndexedDB en curso la aborta: así fallaba a veces «el orden se recuerda» (punto 14).
 */
export async function waitForSaved(page: Page) {
  await expect(page.locator('.save-indicator--saving')).toHaveCount(0)
}

/** Recarga solo cuando lo último quedó guardado (ver `waitForSaved`). */
export async function reloadWhenSaved(page: Page) {
  await waitForSaved(page)
  await page.reload()
}
