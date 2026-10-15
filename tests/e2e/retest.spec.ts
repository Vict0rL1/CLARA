import { mkdirSync, readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { go, openDetails, startDemo, storedData } from './helpers'

/**
 * Regresiones de navegador de la comprobación independiente de `main` a23b135 (2026-10-15):
 * RT-01 (moneda escrita en todas sus formas), RT-02 (deshacer un reemplazo con un cambio automático
 * justo después, sin retrasos artificiales: el de escritura retenida está en
 * `src/state/replaceUndo.test.ts`) y RT-03 (el reconocimiento de filas omitidas de un CSV pertenece
 * a esa vista previa).
 */
type Stored = { transactions: { id: string; amountMinor: number; currency: string; note?: string; scheduleId?: string }[]; schedules: { id: string; name: string }[]; accounts: { name: string }[] }
const txs = async (page: Page) => (JSON.parse((await storedData(page)) ?? '{}') as Stored).transactions ?? []

/** Captura opcional para el informe (`RT_SHOTS=dir`); no cambia la prueba. */
async function shot(page: Page, name: string) {
  const dir = process.env.RT_SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: `${dir}/${name}-${test.info().project.name}.png`, fullPage: true })
}

for (const [text, field, found] of [
  ['coffee 10€', '€10.00', '€'],
  ['coffee GBP 10', '10.00 GBP', 'GBP'],
  ['coffee EUR ten', '10.00 EUR', 'EUR'],
  ['coffee ten USD', '10.00 USD', 'USD'],
] as const) {
  test(`RT-01 · «${text}» en un presupuesto CAD no se puede registrar como CAD`, async ({ page }) => {
    await startDemo(page)
    const before = await txs(page)
    await go(page, '/asistente')
    await page.getByLabel('Texto').fill(text)
    await page.getByRole('button', { name: 'Analizar' }).click()
    const line = page.getByTestId('assistant-preview').locator('.assistant__line').first()
    await expect(line.getByLabel('Importe')).toHaveValue(field)
    await expect(line.getByText(`El importe está en ${found}; este presupuesto usa CAD. No se convierte.`)).toBeVisible()
    await expect(line.getByTestId('review-currency')).toContainText(`Escribiste ${found}; este presupuesto usa CAD`)
    await expect(page.getByTestId('assistant-currency-blocked')).toBeVisible()
    const register = page.getByRole('button', { name: 'Registrar 1 movimiento' })
    await expect(register).toBeDisabled()
    if (text === 'coffee 10€') await shot(page, 'rt01-coffee-10-euro')
    // Ni un clic forzado ni Intro en el campo guardan nada.
    await register.click({ force: true })
    await line.getByLabel('Importe').press('Enter')
    await page.reload()
    await go(page, '/')
    await expect(page.getByTestId('available')).toBeVisible()
    expect(await txs(page)).toEqual(before)
  })
}

test('RT-01 · control: «coffee 10» y «coffee 10 CAD» se registran en CAD y sobreviven a recargar', async ({ page }) => {
  await startDemo(page)
  await go(page, '/asistente')
  await page.getByLabel('Texto').fill('coffee 10\ntea 4 CAD')
  await page.getByRole('button', { name: 'Analizar' }).click()
  await expect(page.getByTestId('assistant-currency-blocked')).toHaveCount(0)
  await page.getByRole('button', { name: 'Registrar 2 movimientos' }).click()
  await expect(page.getByText('2 movimientos registrados').first()).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
  const saved = (await txs(page)).filter((t) => t.note === 'coffee' || t.note === 'tea')
  expect(saved.map((t) => [t.note, t.amountMinor, t.currency]).sort()).toEqual([['coffee', 1000, 'CAD'], ['tea', 400, 'CAD']])
})

const undoOf = (page: Page, text: string) =>
  page.locator('.toast').filter({ hasText: text }).getByRole('button', { name: 'Deshacer' }).or(page.getByTestId('toast-held').getByRole('button', { name: 'Deshacer' }))

/** La copia lleva «Recibo de luz» (vencido el 27-sep) con confirmación automática: al aplicarla, la app lo registra sola. */
function withAutoBill(backup: { data: { schedules: { name: string; autoConfirm?: boolean }[]; accounts: { name: string }[] } }) {
  backup.data.schedules.find((s) => s.name === 'Recibo de luz')!.autoConfirm = true
  backup.data.accounts[0]!.name = 'Cuenta reemplazada'
  return backup
}

async function expectUndoRefusedAndAutoBillKept(page: Page, toastText: string) {
  // La tarea automática registró el recibo en cuanto se vieron los datos nuevos; su aviso puede
  // sustituir al del reemplazo, cuyo «Deshacer» queda entonces retenido (`toast-held`).
  await expect(page.getByText('1 pago programado se registró solo').first()).toBeVisible()
  await undoOf(page, toastText).first().click()
  await expect(page.getByText('No se deshizo: guardaste cambios después y se perderían.').first()).toBeVisible()
  await go(page, '/')
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
  const stored = JSON.parse((await storedData(page)) ?? '{}') as Stored
  const bill = stored.schedules.find((s) => s.name === 'Recibo de luz')!
  expect(stored.transactions.filter((t) => t.scheduleId === bill.id)).toHaveLength(1)
  expect(stored.accounts[0]!.name).toBe('Cuenta reemplazada')
}

test('RT-02 · importar una copia que dispara un registro automático: «Deshacer» se niega y el registro sobrevive a recargar', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes/copia')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar copia' }).click()])
  const backup = withAutoBill(JSON.parse(readFileSync((await download.path())!, 'utf8')))
  await page.getByTestId('import-file').setInputFiles({ name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await page.getByRole('dialog', { name: '¿Reemplazar tus datos con esta copia?' }).getByRole('button', { name: 'Reemplazar datos' }).click()
  await expectUndoRefusedAndAutoBillKept(page, 'Copia importada')
})

test('RT-02 · restaurar una copia local que dispara un registro automático: «Deshacer» se niega y el registro sobrevive a recargar', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes/copias-locales')
  await page.getByTestId('backup-now').click()
  await expect(page.getByText('Copia local guardada')).toBeVisible()
  // La copia local guardada pasa a llevar el recibo con confirmación automática.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('clara-backups', 1)
        req.onsuccess = () => {
          const tx = req.result.transaction('backups', 'readwrite')
          const store = tx.objectStore('backups')
          const all = store.getAll()
          all.onsuccess = () => {
            for (const rec of all.result as { json: string }[]) {
              const file = JSON.parse(rec.json)
              file.data.schedules.find((s: { name: string }) => s.name === 'Recibo de luz').autoConfirm = true
              file.data.accounts[0].name = 'Cuenta reemplazada'
              store.put({ ...rec, json: JSON.stringify(file) })
            }
          }
          tx.oncomplete = () => {
            req.result.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
        req.onerror = () => reject(req.error)
      }),
  )
  await page.reload()
  await page.getByRole('button', { name: /^Restaurar ?: / }).first().click()
  await page.getByRole('dialog', { name: '¿Restaurar esta copia?' }).getByRole('button', { name: 'Restaurar' }).click()
  await expectUndoRefusedAndAutoBillKept(page, 'Copia restaurada')
})

/**
 * RT-02 con la escritura retenida en el navegador: las transacciones de escritura de los datos de
 * Clara (base `clara`, almacén `kv`) quedan en cola, en orden, hasta `releaseWrites`; la pantalla
 * ya muestra cada cambio (el almacén es optimista). Solo afecta a esta página de prueba.
 */
async function holdDataWrites(page: Page) {
  await page.evaluate(() => {
    type Handler = ((this: IDBTransaction, ev: Event) => unknown) | null
    const realTransaction = IDBDatabase.prototype.transaction
    let open!: () => void
    const gate = new Promise<void>((resolve) => (open = resolve))
    const state = { held: true, queue: Promise.resolve() as Promise<unknown> }
    ;(window as unknown as { __releaseWrites: () => void }).__releaseWrites = () => {
      state.held = false
      open()
    }
    IDBDatabase.prototype.transaction = function (this: IDBDatabase, names: string | string[], mode?: IDBTransactionMode, options?: IDBTransactionOptions) {
      const list = typeof names === 'string' ? [names] : [...names]
      if (!state.held || this.name !== 'clara' || mode !== 'readwrite' || !list.includes('kv')) return realTransaction.call(this, names, mode, options)
      let real: IDBTransaction | null = null
      const handlers: Record<'oncomplete' | 'onerror' | 'onabort', Handler> = { oncomplete: null, onerror: null, onabort: null }
      // La transacción de verdad se crea al soltar la cola, en el mismo orden en que se pidieron.
      const ready = (state.queue = state.queue.then(() => gate).then(() => {
        real = realTransaction.call(this, names, mode, options)
        for (const k of Object.keys(handlers) as (keyof typeof handlers)[]) if (handlers[k]) real[k] = handlers[k]
      }))
      const lazy = {
        get error() {
          return real ? real.error : null
        },
        abort() {
          void ready.then(() => real!.abort())
        },
        objectStore(name: string) {
          return {
            get(key: IDBValidKey) {
              const req: { result: unknown; error: DOMException | null; onsuccess: (() => void) | null; onerror: (() => void) | null } = { result: undefined, error: null, onsuccess: null, onerror: null }
              void ready.then(() => {
                const r = real!.objectStore(name).get(key)
                r.onsuccess = () => {
                  req.result = r.result
                  req.onsuccess?.()
                }
                r.onerror = () => {
                  req.error = r.error
                  req.onerror?.()
                }
              })
              return req
            },
            put: (value: unknown, key?: IDBValidKey) => real!.objectStore(name).put(value, key),
            delete: (key: IDBValidKey) => real!.objectStore(name).delete(key),
          }
        },
      }
      for (const k of Object.keys(handlers) as (keyof typeof handlers)[]) {
        Object.defineProperty(lazy, k, {
          set(f: Handler) {
            handlers[k] = f
            if (real) real[k] = f
          },
          get: () => handlers[k],
        })
      }
      return lazy as unknown as IDBTransaction
    }
  })
}

/** Navega sin esperar al indicador de guardado (aquí la escritura está retenida a propósito). */
async function hashTo(page: Page, hash: string) {
  await page.evaluate((h) => {
    window.location.hash = h
  }, hash)
  await expect(page.locator('#page-title')).toBeVisible()
}

async function cad9WhileReplacementIsPending(page: Page, toastText: string) {
  // La pantalla ya muestra los datos nuevos; su escritura sigue retenida. La persona registra CAD 9.
  await hashTo(page, '/movimientos/nuevo')
  await page.getByLabel('Importe').fill('9')
  await openDetails(page)
  await page.getByLabel('Nota (opcional)').fill('Durante el reemplazo')
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  await page.evaluate(() => (window as unknown as { __releaseWrites: () => void }).__releaseWrites())
  await expect(page.getByText('Movimiento guardado').first()).toBeVisible()
  await undoOf(page, toastText).first().click()
  await expect(page.getByText('No se deshizo: guardaste cambios después y se perderían.').first()).toBeVisible()
  await go(page, '/')
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
  const stored = JSON.parse((await storedData(page)) ?? '{}') as Stored
  expect(stored.transactions.filter((t) => t.note === 'Durante el reemplazo').map((t) => [t.amountMinor, t.currency])).toEqual([[900, 'CAD']])
  expect(stored.accounts[0]!.name).toBe('Cuenta reemplazada')
}

test('RT-02 · importar con la escritura retenida: un gasto de CAD 9 registrado mientras tanto sobrevive a «Deshacer» y a recargar', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes/copia')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar copia' }).click()])
  const backup = JSON.parse(readFileSync((await download.path())!, 'utf8'))
  backup.data.accounts[0].name = 'Cuenta reemplazada'
  await page.getByTestId('import-file').setInputFiles({ name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await holdDataWrites(page)
  await page.getByRole('dialog', { name: '¿Reemplazar tus datos con esta copia?' }).getByRole('button', { name: 'Reemplazar datos' }).click()
  await cad9WhileReplacementIsPending(page, 'Copia importada')
})

test('RT-02 · restaurar una copia local con la escritura retenida: un gasto de CAD 9 registrado mientras tanto sobrevive a «Deshacer» y a recargar', async ({ page }) => {
  await startDemo(page)
  await go(page, '/ajustes/copias-locales')
  await page.getByTestId('backup-now').click()
  await expect(page.getByText('Copia local guardada')).toBeVisible()
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('clara-backups', 1)
        req.onsuccess = () => {
          const tx = req.result.transaction('backups', 'readwrite')
          const store = tx.objectStore('backups')
          const all = store.getAll()
          all.onsuccess = () => {
            for (const rec of all.result as { json: string }[]) {
              const file = JSON.parse(rec.json)
              file.data.accounts[0].name = 'Cuenta reemplazada'
              store.put({ ...rec, json: JSON.stringify(file) })
            }
          }
          tx.oncomplete = () => {
            req.result.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
        req.onerror = () => reject(req.error)
      }),
  )
  await page.reload()
  await page.getByRole('button', { name: /^Restaurar ?: / }).first().click()
  await holdDataWrites(page)
  await page.getByRole('dialog', { name: '¿Restaurar esta copia?' }).getByRole('button', { name: 'Restaurar' }).click()
  await cad9WhileReplacementIsPending(page, 'Copia restaurada')
})

/* RT-03: «Entiendo que N filas quedan fuera» es de la vista previa que se reconoció. */
const csv = (n: number, label = 'Fila') => ['Date,Description,Amount', ...Array.from({ length: n }, (_, i) => `2026-09-27,${label} ${i + 1},-1.00`)].join('\n')

async function openImport(page: Page, name: string, text: string) {
  await page.getByTestId('bank-file').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text) })
  await expect(page.getByRole('heading', { name: '3. Revisa y confirma' })).toBeVisible()
}

const importButton = (page: Page) => page.getByRole('button', { name: /^Importar [\d,]+ movimientos?$/ })

test('RT-03 · reconocer las filas omitidas de un archivo y elegir otro más grande: hay que reconocerlo de nuevo', async ({ page }) => {
  await startDemo(page)
  await go(page, '/movimientos/importar')
  await openImport(page, 'banco-a.csv', csv(5003))
  // Un archivo grande pide reconocerlo desde el principio.
  await expect(page.getByLabel('Entiendo que 3 filas del archivo quedan fuera de esta importación')).not.toBeChecked()
  await expect(importButton(page)).toBeDisabled()
  await page.getByLabel('Entiendo que 3 filas del archivo quedan fuera de esta importación').check()
  await expect(importButton(page)).toBeEnabled()
  await shot(page, 'rt03-a-acknowledged')
  // «Elegir otro archivo» en la misma pantalla: 6,000 filas, 1,000 fuera.
  await openImport(page, 'banco-b.csv', csv(6000, 'Otra'))
  await expect(page.getByText('las filas 5,002 a 6,001 (1,000) no se muestran ni se importarán')).toBeVisible()
  const ack = page.getByLabel('Entiendo que 1000 filas del archivo quedan fuera de esta importación')
  await expect(ack).not.toBeChecked()
  await expect(importButton(page)).toBeDisabled()
  await shot(page, 'rt03-b-needs-ack')
  await ack.check()
  await expect(importButton(page)).toBeEnabled()
})

test('RT-03 · el mismo nombre con otro contenido, o leer la primera fila de otra forma, también piden reconocerlo de nuevo', async ({ page }) => {
  await startDemo(page)
  await go(page, '/movimientos/importar')
  await openImport(page, 'banco.csv', csv(5003))
  await page.getByLabel('Entiendo que 3 filas del archivo quedan fuera de esta importación').check()
  // Mismo nombre y mismas cuentas de filas, otro contenido.
  await openImport(page, 'banco.csv', csv(5003, 'Distinta'))
  await expect(page.getByLabel('Entiendo que 3 filas del archivo quedan fuera de esta importación')).not.toBeChecked()
  await expect(importButton(page)).toBeDisabled()
  await page.getByLabel('Entiendo que 3 filas del archivo quedan fuera de esta importación').check()
  // La primera fila deja de leerse como encabezado: cambian las filas que quedan fuera.
  await page.getByLabel('La primera fila tiene los nombres de las columnas').uncheck()
  await expect(page.getByLabel('Entiendo que 4 filas del archivo quedan fuera de esta importación')).not.toBeChecked()
  await expect(importButton(page)).toBeDisabled()
})

test('RT-03 · cancelar el selector de archivos deja la misma vista previa con su reconocimiento; un archivo pequeño no pide nada', async ({ page }) => {
  await startDemo(page)
  await go(page, '/movimientos/importar')
  await openImport(page, 'banco-a.csv', csv(5003))
  const ack = page.getByLabel('Entiendo que 3 filas del archivo quedan fuera de esta importación')
  await ack.check()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Elegir otro archivo').click()])
  await chooser.setFiles([])
  await expect(page.getByText('las filas 5,002 a 5,004 (3) no se muestran ni se importarán')).toBeVisible()
  await expect(ack).toBeChecked()
  await expect(importButton(page)).toBeEnabled()

  await openImport(page, 'pequeno.csv', csv(3, 'Pequeña'))
  await expect(page.getByLabel(/quedan? fuera de esta importación/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Importar 3 movimientos' }).click()
  await expect(page.getByText('3 movimientos importados').first()).toBeVisible()
})
