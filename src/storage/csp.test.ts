import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildCsp, remoteOrigin, renderHeaders, safeRemoteEndpoint } from '../../vite.config'

describe('CSP de la versión compilada', () => {
  it('solo conecta con la propia app; con un proveedor remoto https añade exactamente su origen', () => {
    expect(buildCsp()).toContain("connect-src 'self';")
    expect(buildCsp('https://ai.example.com/v1/parse?x=1')).toContain("connect-src 'self' https://ai.example.com;")
    expect(remoteOrigin('http://ai.example.com')).toBeNull()
    expect(remoteOrigin('no es una url')).toBeNull()
    expect(buildCsp('http://ai.example.com')).toContain("connect-src 'self';")
    expect(buildCsp()).toContain("font-src 'self'")
  })
})

describe('J2 · cabeceras de Cloudflare Pages (dist/_headers)', () => {
  const template = readFileSync(new URL('../../public/_headers', import.meta.url), 'utf8')
  const directives = (csp: string) => csp.split(';').map((d) => d.trim()).filter(Boolean)
  const headerCsp = (headers: string) => headers.match(/^\s+Content-Security-Policy: (.+)$/m)?.[1] ?? ''

  it('la CSP de la cabecera es la de la etiqueta <meta> más frame-ancestors (que una <meta> ignora)', () => {
    for (const endpoint of [undefined, 'https://ai.example.com/v1']) {
      const headers = renderHeaders(template, endpoint)
      expect(directives(headerCsp(headers))).toEqual([...directives(buildCsp(endpoint)), "frame-ancestors 'none'"])
      expect(headers).not.toContain('__CSP__')
    }
  })

  it('protege todas las rutas y no deja guardar en caché lo que debe actualizarse', () => {
    const headers = renderHeaders(template)
    for (const line of [
      'X-Content-Type-Options: nosniff',
      'Referrer-Policy: no-referrer',
      'X-Frame-Options: DENY',
      'Cross-Origin-Opener-Policy: same-origin',
      'Permissions-Policy: camera=(self), microphone=(self), geolocation=(), payment=(), usb=()',
      'X-Robots-Tag: noindex',
    ]) {
      expect(headers).toMatch(new RegExp(`^/\\*\\n(?:  .+\\n)*  ${line.replace(/[()*]/g, '\\$&')}$`, 'm'))
    }
    expect(headers).toMatch(/^\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable$/m)
    for (const path of ['/sw.js', '/index.html', '/manifest.webmanifest']) {
      expect(headers).toContain(`\n${path}\n  Cache-Control: no-cache`)
    }
  })

  it('sin la marca __CSP__ en la plantilla la compilación falla (no publica sin CSP)', () => {
    expect(() => renderHeaders('/*\n  X-Frame-Options: DENY\n')).toThrow(/__CSP__/)
  })
})

describe('R-01 · la compilación falla con una configuración insegura del proveedor remoto', () => {
  it('sin variables no hay origen remoto; con un servicio propio seguro se usa ese endpoint', () => {
    expect(safeRemoteEndpoint({})).toBeUndefined()
    expect(safeRemoteEndpoint({ VITE_AI_ENDPOINT: 'https://clara-ai.example.com/parse', VITE_AI_KEY: 'pub_token', VITE_AI_ALLOWED_ORIGINS: 'https://clara-ai.example.com' })).toBe('https://clara-ai.example.com/parse')
    expect(buildCsp(safeRemoteEndpoint({ VITE_AI_ENDPOINT: 'https://clara-ai.example.com/parse', VITE_AI_KEY: 'pub_token', VITE_AI_ALLOWED_ORIGINS: 'https://clara-ai.example.com' }))).toContain("connect-src 'self' https://clara-ai.example.com;")
  })

  it('una clave de proveedor, un endpoint directo a un proveedor, http o una variable suelta detienen la compilación con el motivo', () => {
    expect(() => safeRemoteEndpoint({ VITE_AI_ENDPOINT: 'https://clara-ai.example.com/parse', VITE_AI_KEY: 'sk-ant-api03-ficticia' })).toThrow(/secretKey/)
    expect(() => safeRemoteEndpoint({ VITE_AI_ENDPOINT: 'https://api.openai.com/v1/chat/completions', VITE_AI_KEY: 'pub_token' })).toThrow(/providerHost/)
    expect(() => safeRemoteEndpoint({ VITE_AI_ENDPOINT: 'http://clara-ai.example.com/parse', VITE_AI_KEY: 'pub_token' })).toThrow(/insecureEndpoint/)
    expect(() => safeRemoteEndpoint({ VITE_AI_KEY: 'pub_token' })).toThrow(/incomplete/)
    // 11: punto final en el host, credenciales en la URL y origen no declarado también la detienen.
    expect(() => safeRemoteEndpoint({ VITE_AI_ENDPOINT: 'https://api.openai.com./v1/chat/completions', VITE_AI_KEY: 'pub_token', VITE_AI_ALLOWED_ORIGINS: 'https://api.openai.com.' })).toThrow(/providerHost/)
    expect(() => safeRemoteEndpoint({ VITE_AI_ENDPOINT: 'https://u:p@clara-ai.example.com/parse', VITE_AI_KEY: 'pub_token', VITE_AI_ALLOWED_ORIGINS: 'https://clara-ai.example.com' })).toThrow(/credentialsInUrl/)
    expect(() => safeRemoteEndpoint({ VITE_AI_ENDPOINT: 'https://clara-ai.example.com/parse', VITE_AI_KEY: 'pub_token' })).toThrow(/originNotAllowed/)
    // El mensaje nunca repite la clave.
    try {
      safeRemoteEndpoint({ VITE_AI_ENDPOINT: 'https://clara-ai.example.com/parse', VITE_AI_KEY: 'sk-ant-api03-ficticia' })
    } catch (e) {
      expect(String(e)).not.toContain('ficticia')
    }
  })
})
