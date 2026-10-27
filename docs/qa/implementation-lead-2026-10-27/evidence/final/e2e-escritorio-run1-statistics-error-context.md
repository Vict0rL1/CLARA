# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: statistics.spec.ts >> estadísticas: sin movimientos muestra el estado vacío y el saldo futuro queda oculto; modo privado oculta gráficos
- Location: tests/e2e/statistics.spec.ts:58:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: expect(locator).toBeVisible() failed

Locator:  locator('#page-title')
Expected: visible
Received: undefined

Call log:
  - Expect "toBeVisible" locator('#page-title') with timeout 5000ms
  - waiting for locator('#page-title')

```

# Test source

```ts
  1   | import { expect, type Locator, type Page } from '@playwright/test'
  2   | 
  3   | /** Mediodía del 28-sep-2026 en Toronto. El reloj avanza con normalidad desde aquí. */
  4   | export const START = new Date('2026-09-28T12:00:00-04:00')
  5   | 
  6   | export async function openApp(page: Page, time: Date = START) {
  7   |   await page.clock.install({ time })
  8   |   await page.goto('/')
  9   | }
  10  | 
  11  | /** Abre la app y carga los datos de demostración (fechas relativas a START). */
  12  | export async function startDemo(page: Page, time: Date = START) {
  13  |   await openApp(page, time)
  14  |   await page.getByRole('button', { name: 'Explorar con datos de demostración' }).click()
  15  |   await expect(page.getByTestId('available')).toBeVisible()
  16  | }
  17  | 
  18  | export function nav(page: Page, name: 'Inicio' | 'Movimientos' | 'Plan' | 'Ajustes') {
  19  |   return page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name })
  20  | }
  21  | 
  22  | export async function go(page: Page, hash: string) {
  23  |   // Como una persona: espera a que termine de guardarse lo anterior (el guardado es asíncrono
  24  |   // y, al terminar, el formulario vuelve a su pantalla de origen).
  25  |   await expect(page.locator('.save-indicator--saving')).toHaveCount(0)
  26  |   await page.waitForTimeout(0)
  27  |   await page.evaluate((h) => {
  28  |     window.location.hash = h
  29  |   }, hash)
> 30  |   await expect(page.locator('#page-title')).toBeVisible()
      |                                             ^ Error: expect(locator).toBeVisible() failed
  31  | }
  32  | 
  33  | export async function available(page: Page) {
  34  |   await go(page, '/')
  35  |   return page.getByTestId('available')
  36  | }
  37  | 
  38  | /** Número de movimientos según el resumen de la lista. */
  39  | export async function movementCount(page: Page): Promise<number> {
  40  |   await go(page, '/movimientos')
  41  |   if ((await page.getByText('Todavía no hay movimientos').count()) > 0) return 0
  42  |   const text = (await page.locator('.summary-line').textContent()) ?? ''
  43  |   return Number(/(\d+) movimiento/.exec(text)?.[1] ?? NaN)
  44  | }
  45  | 
  46  | /** Inicio agrupa los avisos secundarios en «N avisos más»: los despliega si existen. */
  47  | export async function showAllNotices(page: Page) {
  48  |   const more = page.getByTestId('more-notices')
  49  |   if ((await more.count()) > 0 && !(await more.evaluate((d) => (d as HTMLDetailsElement).open))) await more.locator('summary').click()
  50  | }
  51  | 
  52  | /* ------------------------------------------------------------------ */
  53  | /* Almacenamiento real de la app (IndexedDB «clara», almacén «kv»).    */
  54  | /* ------------------------------------------------------------------ */
  55  | 
  56  | /** Texto JSON de los datos guardados (o null si no hay). */
  57  | export async function storedData(page: Page): Promise<string | null> {
  58  |   return page.evaluate(
  59  |     () =>
  60  |       new Promise<string | null>((resolve, reject) => {
  61  |         const req = indexedDB.open('clara', 1)
  62  |         req.onsuccess = () => {
  63  |           const get = req.result.transaction('kv', 'readonly').objectStore('kv').get('data')
  64  |           get.onsuccess = () => {
  65  |             resolve(get.result === undefined ? null : JSON.stringify(get.result))
  66  |             req.result.close()
  67  |           }
  68  |           get.onerror = () => reject(get.error)
  69  |         }
  70  |         req.onerror = () => reject(req.error)
  71  |       }),
  72  |   )
  73  | }
  74  | 
  75  | /** Sustituye los datos guardados (como si otra versión o pestaña los hubiera escrito). */
  76  | export async function writeStoredData(page: Page, data: unknown) {
  77  |   await page.evaluate(
  78  |     (d) =>
  79  |       new Promise<void>((resolve, reject) => {
  80  |         const req = indexedDB.open('clara', 1)
  81  |         req.onsuccess = () => {
  82  |           const tx = req.result.transaction('kv', 'readwrite')
  83  |           tx.objectStore('kv').put(d, 'data')
  84  |           tx.objectStore('kv').put({ revision: 1_000_000 + Math.floor(Math.random() * 1000), savedAt: new Date().toISOString() }, 'meta')
  85  |           tx.oncomplete = () => {
  86  |             req.result.close()
  87  |             resolve()
  88  |           }
  89  |           tx.onerror = () => reject(tx.error)
  90  |         }
  91  |         req.onerror = () => reject(req.error)
  92  |       }),
  93  |     data,
  94  |   )
  95  | }
  96  | 
  97  | /**
  98  |  * Siembra datos en el almacenamiento real (IndexedDB) desde la bienvenida y recarga, como una persona
  99  |  * que ya usaba Clara. `data` suele venir de los constructores de `src/test/fixtures.ts`.
  100 |  */
  101 | export async function seedStoredData(page: Page, data: unknown) {
  102 |   await openApp(page)
  103 |   await expect(page.getByRole('heading', { name: 'Hola, esto es Clara' })).toBeVisible()
  104 |   await writeStoredData(page, data)
  105 |   await page.reload()
  106 |   await expect(page.getByTestId('available')).toBeVisible()
  107 | }
  108 | 
  109 | /** Hace que IndexedDB rechace escrituras (como con el almacenamiento lleno). */
  110 | export async function failStorageWrites(page: Page, name: 'QuotaExceededError' | 'InvalidStateError' = 'QuotaExceededError') {
  111 |   await page.evaluate((n) => {
  112 |     const w = window as unknown as { __realPut?: typeof IDBObjectStore.prototype.put }
  113 |     w.__realPut ??= IDBObjectStore.prototype.put
  114 |     IDBObjectStore.prototype.put = function () {
  115 |       throw new DOMException('simulado', n)
  116 |     }
  117 |   }, name)
  118 | }
  119 | 
  120 | export async function restoreStorageWrites(page: Page) {
  121 |   await page.evaluate(() => {
  122 |     const w = window as unknown as { __realPut?: typeof IDBObjectStore.prototype.put }
  123 |     if (w.__realPut) IDBObjectStore.prototype.put = w.__realPut
  124 |   })
  125 | }
  126 | 
  127 | /** Lee cualquier registro del almacén (p. ej. la copia previa a un cambio de formato). */
  128 | export async function storedRecord(page: Page, key: string): Promise<unknown> {
  129 |   return page.evaluate(
  130 |     (k) =>
```