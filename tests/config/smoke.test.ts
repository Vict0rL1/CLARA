import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
const e2eDir = new URL('tests/e2e/', root)

/** Títulos de las pruebas marcadas con `{ tag: '@smoke' }` en tests/e2e (por archivo). */
function smokeTests(): string[] {
  const found: string[] = []
  for (const file of readdirSync(e2eDir).filter((f) => f.endsWith('.spec.ts'))) {
    const source = readFileSync(new URL(file, e2eDir), 'utf8')
    for (const [, title] of source.matchAll(/test\(\s*'((?:[^'\\]|\\.)+)',\s*\{\s*tag:\s*'@smoke'\s*\}/g)) {
      found.push(`${file} › ${title}`)
    }
  }
  return found.sort()
}

describe('I3 · pruebas rápidas (@smoke)', () => {
  it('cubren lo esencial: una por cada recorrido de la lista', () => {
    expect(smokeTests()).toEqual(
      [
        'setup.spec.ts › configuración inicial con mis datos y recuperación tras recargar',
        'movements.spec.ts › agregar, buscar, editar y eliminar con deshacer',
        'regressions-round3.spec.ts › pegar tres líneas da tres filas con sus importes',
        'trash.spec.ts › papelera: «Deshacer» restaura; una transferencia vuelve completa a ambas cuentas',
        'personalize.spec.ts › modo privado: oculta importes en pantalla y en etiquetas accesibles, sin cambiar datos ni cifras',
        'english.spec.ts › la app funciona en inglés y se puede volver a español',
        'backup.spec.ts › exportar, rechazar copias inválidas sin tocar datos e importar una válida',
        'offline.spec.ts › tras la primera visita, la app abre sin conexión y conserva los datos',
        'data-safety.spec.ts › H4 · datos de una versión más nueva (esquema 13): se explican, sin «Empezar de nuevo», y ningún botón los toca',
        'shortcut-link.spec.ts › atajo de iPhone: rellena importe, comercio y categoría, avisa y solo guarda al pulsar Guardar',
      ].sort(),
    )
  })

  it('`npm run test:smoke` ejecuta solo las marcadas', () => {
    const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts['test:smoke']).toBe('playwright test --grep @smoke')
  })
})
