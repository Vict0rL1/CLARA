import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { checkRemoteAiConfig, REMOTE_AI_REASON_TEXT, type RemoteAiEnv } from './src/domain/aiConfig.ts'
import { serviceWorker } from './pwa/serviceWorkerPlugin.ts'

/**
 * Política de seguridad de contenido (solo en la versión compilada: el servidor de
 * desarrollo necesita scripts en línea). Solo se cargan archivos de la propia app y
 * no se permite conectar con otros sitios: si alguna vez se colara texto con código,
 * el navegador no lo ejecutaría ni podría enviar datos fuera.
 */
/**
 * Origen permitido para el proveedor remoto del asistente: solo si la compilación define
 * `VITE_AI_ENDPOINT` con https y su origen está en `VITE_AI_ALLOWED_ORIGINS` (lo comprueba
 * `safeRemoteEndpoint`). Sin él, `connect-src` sigue siendo solo la propia app.
 */
export function remoteOrigin(endpoint: string | undefined): string | null {
  if (!endpoint) return null
  try {
    const url = new URL(endpoint)
    return url.protocol === 'https:' ? url.origin : null
  } catch {
    return null
  }
}

/**
 * Endpoint del proveedor remoto solo si la configuración es segura (R-01 y punto 11 de la
 * estabilización): https sin credenciales en la URL, no un host de proveedor de IA (sin puntos finales),
 * un origen declarado en `VITE_AI_ALLOWED_ORIGINS` y una clave que no tenga forma de secreto. Si no lo es, la compilación FALLA con el
 * motivo: no se publica una app con una credencial dentro. Sin variables → sin proveedor.
 */
export function safeRemoteEndpoint(env: RemoteAiEnv): string | undefined {
  const check = checkRemoteAiConfig(env)
  if (check.ok) return check.endpoint
  if (check.reason === 'none') return undefined
  throw new Error(`Proveedor remoto del asistente mal configurado (${check.reason}): ${REMOTE_AI_REASON_TEXT[check.reason]}`)
}

export function buildCsp(aiEndpoint?: string): string {
  const remote = remoteOrigin(aiEndpoint)
  return [
    "default-src 'self'",
    "script-src 'self'",
    // React aplica algunos estilos en línea (atributo style) para gráficos y barras.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${remote ? ` ${remote}` : ''}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

/**
 * `dist/_headers` (Cloudflare Pages) a partir de la plantilla `public/_headers` (J2): la cabecera CSP es
 * la misma de la etiqueta <meta> más `frame-ancestors 'none'`, que una <meta> ignora. Así no pueden
 * divergir. Sin la marca `__CSP__` lanza un error: nunca se publica sin CSP.
 */
export function renderHeaders(template: string, aiEndpoint?: string): string {
  const marks = template.split('__CSP__').length - 1
  if (marks !== 1) throw new Error(`public/_headers debe contener exactamente una marca __CSP__ (tiene ${marks}).`)
  return template.replace('__CSP__', `${buildCsp(aiEndpoint)}; frame-ancestors 'none'`)
}

function contentSecurityPolicy(aiEndpoint?: string): Plugin {
  const csp = buildCsp(aiEndpoint)
  return {
    name: 'margen-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`)
    },
    // Vite ya copió public/ en dist/ cuando se escribe el paquete.
    writeBundle(options) {
      const file = join(options.dir ?? 'dist', '_headers')
      if (!existsSync(file)) this.error('Falta dist/_headers: public/_headers es la plantilla de las cabeceras.')
      writeFileSync(file, renderHeaders(readFileSync(file, 'utf8'), aiEndpoint))
    },
  }
}

/**
 * Versión de package.json (H1). `CLARA_APP_VERSION` solo la usa la prueba de actualización real (J4)
 * para compilar «otra versión» sin tocar package.json.
 */
const APP_VERSION =
  process.env.CLARA_APP_VERSION && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(process.env.CLARA_APP_VERSION)
    ? process.env.CLARA_APP_VERSION
    : (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version

/**
 * Hash corto del commit compilado: el que indica CI (`CLARA_BUILD_SHA`, el commit de la rama del PR),
 * el de GitHub Actions o el de git local; «dev» si no hay git.
 */
function buildHash(): string {
  const fromCi = process.env.CLARA_BUILD_SHA || process.env.GITHUB_SHA
  if (fromCi && /^[0-9a-f]{7,40}$/.test(fromCi)) return fromCi.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __BUILD_HASH__: JSON.stringify(buildHash()),
  },
  plugins: [react(), serviceWorker({ publicDir: 'public' }), contentSecurityPolicy(safeRemoteEndpoint(loadEnv(mode, process.cwd(), 'VITE_')))],
  test: {
    // Las pruebas unitarias cubren la lógica financiera pura (sin navegador).
    // `qa/`: regresiones de la auditoría 2026-10-09 (financieras y de seguridad); forman parte de `npm run check`.
    include: ['src/**/*.test.ts', 'pwa/**/*.test.ts', 'tests/config/**/*.test.ts', 'qa/**/*.test.ts'],
    environment: 'node',
    // En CI, además del resumen, el resultado completo en JSON (artefacto `unit-results`; QA V2).
    reporters: process.env.CI ? ['default', ['json', { outputFile: 'test-results/vitest.json' }]] : ['default'],
  },
}))
