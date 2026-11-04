import { afterEach, describe, expect, it, vi } from 'vitest'

/** Carga playwright.config.ts con las variables de entorno indicadas (el archivo las lee al importarse). */
async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules()
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value as string)
  return (await import('../../playwright.config')).default
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('I2 · playwright.config en CI y en local', () => {
  it('en CI reintenta una vez (para que --fail-on-flaky-tests detecte la inestabilidad) y deja un informe HTML sin abrirlo y un JUnit', async () => {
    const config = await loadConfig({ CI: 'true' })
    expect(config.retries).toBe(1)
    // QA V2: el JUnit (`test-results/junit.xml`) se sube como artefacto para leer una ejecución remota.
    expect(config.reporter).toEqual([['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]])
  })

  it('en local no reintenta y solo usa la lista', async () => {
    const config = await loadConfig({ CI: '' })
    expect(config.retries).toBe(0)
    expect(config.reporter).toEqual([['list']])
  })

  it('las capturas visuales quedan fuera de la ejecución por defecto', async () => {
    const config = await loadConfig({ CI: '' })
    expect(config.testDir).toBe('./tests/e2e')
    expect((config.projects ?? []).map((p) => p.name)).toEqual(['celular', 'celular-pequeno', 'escritorio'])
  })
})

describe('J3 · pruebas contra lo publicado (BASE_URL)', () => {
  it('con BASE_URL prueba esa dirección y no arranca el servidor local', async () => {
    const config = await loadConfig({ CI: 'true', BASE_URL: 'https://abc123.clara.pages.dev' })
    expect(config.use?.baseURL).toBe('https://abc123.clara.pages.dev')
    expect(config.webServer).toBeUndefined()
  })

  it('sin BASE_URL compila y sirve la versión local', async () => {
    const config = await loadConfig({ CI: '', BASE_URL: '' })
    expect(config.use?.baseURL).toBe('http://localhost:4173')
    expect(config.webServer).toMatchObject({ url: 'http://localhost:4173' })
  })
})
