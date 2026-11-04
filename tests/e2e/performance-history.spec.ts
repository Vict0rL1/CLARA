import { expect, test } from '@playwright/test'
import type { AppData, HistoryEntry, Schedule, Transaction } from '../../src/domain/types'
import { createSyntheticData } from '../../src/test/synthetic'
import { bill, tx } from '../../src/test/fixtures'
import { go } from './helpers'

/**
 * Historial con un libro grande (revisión de seguridad QA27, O-9): desde QA27-01 cada entrada mostrada que toca un
 * programado compara las liquidaciones del estado actual con las del estado revertido, recorriendo los movimientos.
 * Con 10 000 movimientos, 100 programados mensuales, 1 000 pagos vinculados y 30 entradas que cambian programados
 * (15 solo el importe, 15 la fecha de inicio: esas dejan pagos sin fecha y listan dependientes), navegar desde Inicio a
 * Historial tiene que mostrar la primera entrada en menos de 300 ms (la mejor de dos navegaciones); el arranque con el
 * libro grande lo cubre el presupuesto de Inicio (`performance-10k.spec.ts`).
 */
const seed = (text: string) =>
  new Promise<string>((resolve) => {
    const req = indexedDB.open('clara', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => {
      const d = JSON.parse(text) as { revision?: number }
      const tx = req.result.transaction('kv', 'readwrite')
      tx.objectStore('kv').put(d, 'data')
      tx.objectStore('kv').put({ revision: d.revision ?? 1, savedAt: new Date().toISOString() }, 'meta')
      tx.oncomplete = () => resolve('ok')
      tx.onerror = () => resolve(String(tx.error))
    }
    req.onerror = () => resolve(String(req.error))
  })

function bigLedger(): AppData {
  const base = createSyntheticData({ movements: 10_000, today: '2026-09-28' })
  const accountId = base.accounts[0]!.id
  const schedules: Schedule[] = []
  const payments: Transaction[] = []
  for (let i = 0; i < 100; i++) {
    const day = (i % 28) + 1
    const dd = String(day).padStart(2, '0')
    const s = bill(`2025-12-${dd}`, 1000 + i * 37, { id: `bulk-s${i}`, name: `Servicio ${i}`, frequency: 'monthly', accountId, categoryId: 'utilities' })
    schedules.push(s)
    // Diez ocurrencias pagadas por programado (dic-2025 … sep-2026): 1 000 pagos vinculados.
    for (let m = 0; m < 10; m++) {
      const month = ((11 + m) % 12) + 1
      const year = 11 + m >= 12 ? 2026 : 2025
      const date = `${year}-${String(month).padStart(2, '0')}-${dd}`
      payments.push(tx({ id: `bulk-p${i}-${m}`, kind: 'expense', status: 'realized', amountMinor: s.amountMinor, date, accountId, categoryId: 'utilities', scheduleId: s.id, occurrenceDate: date, note: s.name }))
    }
  }
  const last = base.history.at(-1)?.at ?? '2026-09-28T12:00:00.000Z'
  const entries: HistoryEntry[] = schedules.slice(0, 30).map((s, i) => {
    const at = new Date(new Date(last).getTime() + (i + 1) * 60_000).toISOString()
    const before: Schedule = i < 15 ? { ...s, amountMinor: s.amountMinor - 100 } : { ...s, startDate: '2026-06-01', anchorDate: s.startDate }
    return { id: `bulk-h${i}`, at, source: 'app', changes: [{ collection: 'schedules', id: s.id, before, after: s }] }
  })
  return { ...base, schedules: [...base.schedules, ...schedules], transactions: [...base.transactions, ...payments], history: [...base.history, ...entries] }
}

test('Historial con 10 000 movimientos, 100 programados, 1 000 pagos vinculados y 30 cambios de programados: desde Inicio, la primera entrada en < 300 ms', async ({ page }) => {
  test.setTimeout(180_000)
  const data = bigLedger()
  expect(data.transactions.length).toBeGreaterThan(10_000)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Hola, esto es Clara' })).toBeVisible()
  expect(await page.evaluate(seed, JSON.stringify(data))).toBe('ok')
  // Arranque con el libro grande (lo mide el presupuesto de Inicio); aquí se mide lo propio de la pantalla: desde que se
  // navega a Historial con la app ya en pie hasta que la primera entrada está en el DOM, la mejor de dos navegaciones.
  await page.reload()
  await expect(page.getByTestId('available')).toBeVisible()
  const times: number[] = []
  for (let i = 0; i < 2; i++) {
    await go(page, '/')
    await expect(page.getByTestId('available')).toBeVisible()
    const ms = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const t0 = performance.now()
          const observer = new MutationObserver(() => {
            if (document.querySelector('article.history-entry')) {
              observer.disconnect()
              resolve(performance.now() - t0)
            }
          })
          observer.observe(document, { childList: true, subtree: true })
          window.location.hash = '#/ajustes/historial'
        }),
    )
    times.push(ms)
    await expect(page.locator('article.history-entry').first()).toBeVisible()
  }
  // Las 30 entradas nuevas están arriba: 15 revertibles, 15 que listan pagos dependientes.
  await expect(page.locator('article.history-entry').first().getByText(/Servicio/)).toBeVisible()
  const dependents = await page.getByTestId('history-dependents').count()
  console.log(`Historial con libro grande: primera entrada a los ${times.map(Math.round).join(' / ')} ms desde Inicio; ${dependents} entradas con dependientes a la vista`)
  expect(dependents).toBe(15)
  expect(Math.min(...times)).toBeLessThan(300)
})
