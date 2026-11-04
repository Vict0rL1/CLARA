import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * El tema oscuro está definido dos veces en styles.css: dentro de `@media (prefers-color-scheme:
 * dark)` para «Sistema» y en `:root[data-theme='dark']` para «Oscuro». Deben ser idénticos.
 */
function block(css: string, header: string): Record<string, string> {
  const start = css.indexOf(header)
  expect(start, `bloque «${header}»`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  let depth = 0
  let i = open
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) break
  }
  const body = css.slice(open + 1, i)
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim()
  return out
}

describe('tokens del tema oscuro', () => {
  it('«Sistema» (prefers-color-scheme) y «Oscuro» (data-theme) definen los mismos valores', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    const system = block(css, ":root:not([data-theme='light'])")
    const forced = block(css, ":root[data-theme='dark']")
    expect(Object.keys(system).length).toBeGreaterThan(20)
    expect(forced).toEqual(system)
  })
})

describe('tokens usados', () => {
  it('cada `var(--x)` sin respaldo usa una propiedad definida (12: `--text` y `--danger` no existían)', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!))
    // `var(--x)` o `var(--x, …)`: solo las que no tienen valor de respaldo deben existir.
    const undefinedUses = [...css.matchAll(/var\((--[a-z0-9-]+)\s*\)/g)].map((m) => m[1]!).filter((name) => !defined.has(name))
    expect([...new Set(undefinedUses)]).toEqual([])
  })
})

/**
 * Contraste calculado (auditoría de seguimiento, F-04): «Sin comparación» (`.stat__delta--neutral`, 14 px/600, texto
 * pequeño) sobre la tarjeta de Estadísticas (`.stat`, `--surface`) debe cumplir AA (≥ 4,5:1) en claro, «Sistema» oscuro y
 * «Oscuro». Con `--text-muted` (#64748b sobre #121a2a) daba 3,66:1.
 */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  expect(full, `color hex «${hex}»`).toMatch(/^[0-9a-f]{6}$/i)
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrastRatio(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
/** Sigue `var(--x)` hasta el valor literal del token en ese bloque. */
function resolveToken(name: string, tokens: Record<string, string>): string {
  const value = tokens[name]
  expect(value, `token ${name}`).toBeDefined()
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(value!)
  return ref ? resolveToken(ref[1]!, tokens) : value!
}
function ruleVar(css: string, selector: string, property: string): string {
  // El selector entero (`.stat` no es `.stat__delta`), seguido de su bloque.
  const m = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])\\s*\\{[^}]*?${property}:\\s*var\\((--[a-z0-9-]+)\\)`).exec(css)
  expect(m, `${selector} { ${property}: var(…) }`).not.toBeNull()
  return m![1]!
}

describe('contraste de «Sin comparación» en Estadísticas (F-04)', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
  const fgToken = ruleVar(css, '.stat__delta--neutral', 'color')
  const bgToken = ruleVar(css, '.stat', 'background')
  const light = block(css, ':root {')
  const themes = { claro: light, 'sistema oscuro': { ...light, ...block(css, ":root:not([data-theme='light'])") }, oscuro: { ...light, ...block(css, ":root[data-theme='dark']") } }
  for (const [name, tokens] of Object.entries(themes)) {
    it(`${name}: texto pequeño sobre la tarjeta ≥ 4,5:1`, () => {
      const fg = resolveToken(fgToken, tokens)
      const bg = resolveToken(bgToken, tokens)
      expect(contrastRatio(fg, bg), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5)
    })
  }
  it('la cifra de referencia: en oscuro `--text-muted` sobre la tarjeta queda por debajo de AA (por eso no se usa aquí)', () => {
    const dark = { ...light, ...block(css, ":root[data-theme='dark']") }
    expect(contrastRatio(resolveToken('--text-muted', dark), resolveToken('--card', dark))).toBeLessThan(4.5)
    expect(contrastRatio(resolveToken('--text-secondary', dark), resolveToken('--card', dark))).toBeGreaterThanOrEqual(4.5)
  })
})
