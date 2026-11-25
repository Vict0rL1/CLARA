import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { baseData } from '../../src/test/fixtures'
import { expectNoHorizontalScroll, go, openApp } from './helpers'
import { asNativeApp, fakeDictation, nativeCalls, nativeFile, seedNativeData, setFakeDevice } from './nativeShell'
import { tinyPng } from './png'

/**
 * Fase 5 en la app simulada (`nativeShell.ts`): dictado, recibos y la IA del iPhone con respuestas SIMULADAS de los
 * plugins `ClaraSpeech`, `ClaraVision` y `ClaraAI`. Comprueba lo que hace la web con ellas; el Swift (Speech, Vision,
 * Foundation Models) no se prueba aquí: eso es Xcode y el iPhone de Victor. Hoy: 28-sep-2026, presupuesto en CAD.
 */
const stored = async (page: Parameters<typeof nativeFile>[0]) => JSON.parse((await nativeFile(page, 'data'))!.text) as ReturnType<typeof baseData>
/** Un recuadro de Vision: normalizado, origen abajo a la izquierda. */
const box = (text: string, x: number, y: number) => ({ text, x, y, width: 0.25, height: 0.03 })
const PNG_BASE64 = tinyPng(16).toString('base64')

async function openNative(page: Parameters<typeof asNativeApp>[0]) {
  await asNativeApp(page)
  await openApp(page)
  await seedNativeData(page, baseData())
}

test('dictado en el iPhone: «café 4,50 y uber 18 ayer» → dos propuestas en la vista previa; nada se guarda solo', async ({ page }) => {
  await openNative(page)
  await setFakeDevice(page, { speech: { available: true, final: 'café 4,50 y uber 18 ayer' } })
  await go(page, '/asistente')
  await expect(page.getByText('Se dicta en este iPhone: el audio no sale del teléfono.', { exact: false })).toBeVisible()
  // El dictado de la web no se ofrece en la app ni se dice que «este navegador» no puede.
  await expect(page.getByText('Este navegador no permite dictar', { exact: false })).toHaveCount(0)

  await page.getByTestId('device-voice').click()
  await expect(page.getByTestId('device-voice')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('voice-meter')).toBeVisible()
  await fakeDictation(page, 'café 4,50')
  await expect(page.getByTestId('assistant-text')).toHaveValue('café 4,50')
  await page.getByTestId('device-voice').click()

  // Al parar, lo dictado completo queda escrito y se analiza: dos líneas para revisar.
  await expect(page.getByTestId('assistant-text')).toHaveValue('café 4,50 y uber 18 ayer')
  const lines = page.getByTestId('assistant-preview').locator('.assistant__line')
  await expect(lines).toHaveCount(2)
  await expect(lines.nth(0).getByLabel('Importe')).toHaveValue('4.50')
  await expect(lines.nth(1).getByLabel('Importe')).toHaveValue('18.00')
  await expect(lines.nth(1).getByLabel('Fecha')).toHaveValue('2026-09-27')
  // Sin la IA encendida: ninguna etiqueta de la IA.
  await expect(page.getByTestId('device-ai-line')).toHaveCount(0)
  expect((await stored(page)).transactions).toEqual([])
  expect((await nativeCalls(page, 'ClaraSpeech')).map((c) => [c.call, c.options.locale])).toEqual([
    ['ClaraSpeech.start', 'es-MX'],
    ['ClaraSpeech.stop', undefined],
  ])
  await expectNoHorizontalScroll(page, 'asistente con dictado del iPhone')
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([])
})

test('sin permiso para el dictado: no hay botón y se dice por qué y dónde darlo', async ({ page }) => {
  await openNative(page)
  await setFakeDevice(page, { speech: { available: false, reason: 'denied', final: '' } })
  await go(page, '/asistente')
  await expect(page.getByTestId('device-voice-unavailable')).toHaveText('Dictado: Clara no tiene permiso para el micrófono o el reconocimiento de voz. Puedes darlo en la app Ajustes del iPhone › Clara.')
  await expect(page.getByTestId('device-voice')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Dictar' })).toHaveCount(0)
})

test('recibos: la cámara de documentos lee 2 recibos (uno de más se avisa) y una foto se lee con Vision; cada uno, una línea', async ({ page }) => {
  await openNative(page)
  const cafe = [box('CAFE CENTRAL', 0.1, 0.9), box('27/09/2026', 0.1, 0.85), box('TOTAL', 0.1, 0.5), box('4.25', 0.7, 0.5)]
  const bakery = [box('PANADERIA LA ESPIGA', 0.1, 0.9), box('PAN 3.00', 0.1, 0.6), box('TOTAL 12.00', 0.1, 0.4)]
  await setFakeDevice(page, {
    vision: { scanner: true, observations: bakery, skipped: 1, pages: [{ image: PNG_BASE64, observations: cafe }, { image: PNG_BASE64, observations: bakery }] },
  })
  await go(page, '/asistente')
  await expect(page.getByText('La cámara de documentos lee hasta 5 recibos seguidos en este iPhone', { exact: false })).toBeVisible()
  await page.getByTestId('device-scan').click()
  await expect(page.getByText('Solo se leen 5 recibos a la vez: 1 quedaron fuera.', { exact: false })).toBeVisible()
  const lines = page.getByTestId('assistant-preview').locator('.assistant__line')
  await expect(lines).toHaveCount(2)
  await expect(lines.nth(0)).toContainText('«foto: recibo escaneado 1»')
  await expect(lines.nth(0).getByLabel('Importe')).toHaveValue('4.25')
  await expect(lines.nth(0).getByLabel('Fecha')).toHaveValue('2026-09-27')
  await expect(lines.nth(0).getByLabel('Nota (opcional)')).toHaveValue('CAFE CENTRAL')
  await expect(lines.nth(0).getByRole('img', { name: 'Foto del recibo adjunta' })).toBeVisible()
  await expect(lines.nth(1).getByLabel('Importe')).toHaveValue('12.00')
  expect((await nativeCalls(page, 'ClaraVision.scan')).map((c) => [c.options.max, c.options.languages])).toEqual([[5, ['es-ES', 'en-US']]])

  // Una foto suelta también se lee en el iPhone (Vision), no con el detector del navegador.
  await page.getByTestId('photo-input').setInputFiles({ name: 'recibo.png', mimeType: 'image/png', buffer: tinyPng(16) })
  await expect(lines).toHaveCount(3)
  await expect(lines.nth(2).getByLabel('Importe')).toHaveValue('12.00')
  expect(await nativeCalls(page, 'ClaraVision.recognize')).toHaveLength(1)
  expect((await stored(page)).transactions).toEqual([])
})

test('IA del iPhone: Ajustes dice lo que hay y la enciende; propone con su etiqueta, y si falla manda el analizador de siempre', async ({ page }) => {
  await openNative(page)
  const text = 'pues el café de esta mañana fueron 4,50 y luego el uber de ayer 18'
  await setFakeDevice(page, {
    ai: {
      available: true,
      extract: {
        entries: [
          { fragment: 'el café de esta mañana fueron 4,50', kind: 'expense', amount: '4.50', description: 'Café', category: 'dining' },
          { fragment: 'el uber de ayer 18', kind: 'expense', amount: '18', description: 'Uber', category: 'transport', date: '2026-09-27' },
          // Un movimiento que el texto no dice: se descarta.
          { fragment: 'cena 80', kind: 'expense', amount: '80', description: 'Cena' },
        ],
      },
    },
  })
  await go(page, '/ajustes/asistente')
  const status = page.getByTestId('device-assistant-status')
  await expect(status.getByRole('heading', { name: 'En este iPhone' })).toBeVisible()
  await expect(status.getByTestId('device-status-voice')).toHaveText('Dictado: en el iPhone, sin enviar el audio.')
  await expect(status.getByTestId('device-status-ai')).toHaveText('IA de Apple Intelligence en este iPhone: disponible.')
  // Lo del navegador no se dice dentro de la app.
  await expect(page.getByText('reconocimiento de voz del navegador', { exact: false })).toHaveCount(0)
  const toggle = status.getByRole('switch', { name: 'Usar la IA de este iPhone en el asistente' })
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked()
  await expectNoHorizontalScroll(page, 'Ajustes › Asistente en la app')
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([])

  await go(page, '/asistente')
  await expect(page.getByTestId('device-ai-on')).toBeVisible()
  await page.getByTestId('assistant-text').fill(text)
  await page.getByRole('button', { name: 'Analizar' }).click()
  const lines = page.getByTestId('assistant-preview').locator('.assistant__line')
  await expect(lines).toHaveCount(2)
  await expect(page.getByTestId('device-ai-outcome')).toHaveAttribute('data-outcome', 'deviceAi')
  await expect(lines.nth(0).getByTestId('device-ai-line')).toContainText('Sugerido por IA en tu iPhone')
  await expect(lines.nth(0).getByLabel('Importe')).toHaveValue('4.50')
  await expect(lines.nth(1).getByLabel('Importe')).toHaveValue('18.00')
  await expect(lines.nth(1).getByLabel('Fecha')).toHaveValue('2026-09-27')
  expect((await nativeCalls(page, 'ClaraAI.extract')).map((c) => [c.options.text, c.options.today])).toEqual([[text, '2026-09-28']])
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([])

  // La IA no responde: el analizador de siempre, y se dice.
  await setFakeDevice(page, { ai: { available: true } })
  await page.getByTestId('assistant-text').fill('café 4,50 y uber 18')
  await page.getByRole('button', { name: 'Analizar' }).click()
  await expect(page.getByTestId('device-ai-outcome')).toHaveAttribute('data-outcome', 'aiFailed')
  await expect(lines).toHaveCount(2)
  await expect(page.getByTestId('device-ai-line')).toHaveCount(0)
  expect((await stored(page)).transactions).toEqual([])
})

test('IA no disponible en este iPhone: se dice por qué y no hay interruptor', async ({ page }) => {
  await openNative(page)
  await setFakeDevice(page, { ai: { available: false, reason: 'appleIntelligenceNotEnabled' }, vision: { scanner: false, observations: [], pages: [], skipped: 0 } })
  await go(page, '/ajustes/asistente')
  const status = page.getByTestId('device-assistant-status')
  await expect(status.getByTestId('device-status-ai')).toHaveText('IA del iPhone: Apple Intelligence está apagada en la app Ajustes del iPhone.')
  await expect(status.getByTestId('device-status-scan')).toHaveText('Cámara de documentos: no disponible en este iPhone; la foto funciona igual.')
  await expect(status.getByRole('switch')).toHaveCount(0)
  await go(page, '/asistente')
  await expect(page.getByTestId('device-scan')).toHaveCount(0)
  await expect(page.getByTestId('device-ai-on')).toHaveCount(0)
})
