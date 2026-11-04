import { mkdirSync } from 'node:fs'
import { test, type Locator, type Page } from '@playwright/test'

/**
 * Captura de evidencia para los informes de QA: solo cuando `QA_LEAD_SHOTS` apunta a una carpeta (la verificación final
 * la fija); en una ejecución normal no hace nada. Una imagen por prueba, tamaño y nombre; nunca cambia lo que se prueba.
 */
export async function shot(page: Page, name: string, focus?: Locator) {
  const dir = process.env.QA_LEAD_SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  if (focus && (await focus.count()) > 0) await focus.first().evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.screenshot({ path: `${dir}/${name}-${test.info().project.name}.jpg`, type: 'jpeg', quality: 70, scale: 'css' })
}
