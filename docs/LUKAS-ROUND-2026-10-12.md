# Ronda «Lukas como referencia» (12 de octubre de 2026): diseño, flujos y evidencia

Rama `feat/pulido-lukas-benchmark`, creada desde `fix/ux-02-periodo-contradictorio` en `15756ef` (cierre de la
auditoría del mismo día, PR #8 abierto). Código final: `a2ae30c` (las capturas «después» y este informe van en el commit siguiente). Nada se ha fusionado, desplegado ni
activado; el PR se abre en borrador sobre la rama de la auditoría para que solo muestre esta ronda.

La matriz de comparación con Lukas (fuentes, qué es anunciado y qué no consta, brecha y propuesta por
capacidad) está en `docs/BENCHMARK-LUKAS.md`. Este informe cuenta qué se hizo, con qué evidencia, qué queda
y qué no se afirma.

## 1. Estado de cada punto del encargo

Etiquetas: **Hecho** (en código, con prueba automática) · **Parcial** (existía o se hizo en parte; se dice
qué falta) · **Propuesto** (diseñado, no implementado) · **Verificado sin cambios** (ya existía; se comprobó)
· **No probado** (no se puede desde este entorno).

| Punto | Estado | Evidencia |
|---|---|---|
| 1 Inspección, commit de partida, inventario, separación de hallazgos | Hecho | §2; `15756ef`; `docs/ARCHITECTURE.md`, `GAP-ANALYSIS.md`, auditorías previas |
| 2 Comparativa con Lukas (fichas oficiales) | Hecho, con límite | `docs/BENCHMARK-LUKAS.md`: fichas leídas vía resultados de búsqueda (el entorno no abre las tiendas); nada probado en la app de Lukas |
| 3 Sistema visual coherente (tokens, radios, numerales tabulares, temas) | Verificado sin cambios + pulido | Decisiones 141 (escalas únicas, hecho el mismo día) y 145 (estados pulsados, diálogos); capturas en ambos temas |
| 4 Tablero: resumen claro, entrada visible, próximos pagos, metas, divulgación progresiva | Hecho | `hero-ledger`, `upcoming-strip`, `ProgressArc`; vista esencial/completa conservadas; avisos siempre visibles; «¿Cómo?» sobre `computeBudget` |
| 5 Curvas y movimiento con propósito | Hecho (acotado) | Arcos con extremos redondeados; `:active`; diálogos 160 ms; `prefers-reduced-motion`; cifras sin animación (decisión 141) |
| 6 Gráficos atractivos y exactos | Verificado sin cambios | Unidades y fechas en ejes, tabla alternativa, previsión discontinua, vacío/negativo cubiertos (`statistics.spec.ts`, `plan.spec.ts`); sin gráficos nuevos salvo el arco |
| 7 Registro: rápido y fiable | Hecho | Aviso de duplicado antes de guardar; sugerencia de vínculo con un programado; feedback tras persistir (ya existía: el aviso sale después de `commit`); deshacer (ya existía) |
| 8 Historial y detalle | Hecho | Resumen del movimiento con origen y alcance; filtros y posición conservados; búsqueda/filtros/etiquetas existentes |
| 9 UX-02 y coherencia de explicaciones | Verificado sin cambios | Corregido en `11179a1` (PR #8); `tests/e2e/ux-02-horizon.spec.ts` pasa en esta rama (es/en, 3 tamaños) |
| 10 Diferenciación útil (explicación transparente, presión de pagos, simulación, metas, importación, copias, privacidad) | Verificado sin cambios | Todo existía: «¿Cómo?», proyección y plan ante faltante, «¿Me alcanza?», apartar/liberar, vista previa de importación, `RESTORE.md`, modo privado en todas las pantallas (`regressions-round3.spec.ts`) |
| 11 Límites de plataforma y seguridad | Verificado sin cambios | Sin widgets, sin lectura de notificaciones, sin sincronización, sin conversión de divisas; PIN ≠ cifrado (se dice); nada activado ni contratado |
| 12 Corrección financiera preservada | Verificado sin cambios | QA-01…QA-08, UX-01, R-01: `npm run check` (incluye `qa/`) y `audit-regressions.spec.ts` pasan; `src/domain/` solo suma `duplicates.ts` (+ prueba) |
| 13 Verificación | Hecho / No probado | §4: comandos y resultados; dispositivos físicos **no probados** |
| 14 Entregables | Hecho | Este informe, matriz, capturas, PR en borrador |

## 2. Qué se implementó (y por qué así)

- **Inicio** (decisión 142). Bajo «Puedes gastar», la línea «En cuentas · Reservado · Base del periodo (si
  difiere)» compone la cifra con los mismos valores de `computeBudget`; responde «¿cuánto tengo?» y «¿cuánto
  está comprometido?» sin abrir «¿Cómo?». La vista esencial estrena una franja con los dos próximos pagos o
  ingresos (vencido con insignia, fecha, importe, «N más en el calendario»); la vista completa conserva su
  tarjeta. Las metas muestran un arco (`ProgressArc`) con el porcentaje en el centro y ✓ al completar, con el
  mismo rol y texto accesible que la barra anterior, en Inicio y en Plan › Metas.
- **Registro** (decisión 143). Aviso de posible duplicado antes de guardar, con la regla de la bandeja
  (`domain/duplicates.ts`, 4 pruebas unitarias) y el existente a la vista; nunca bloquea. Sugerencia de
  vínculo con una ocurrencia abierta del calendario cuando coincide el importe (o categoría y fecha):
  «Sí, vincularlo» usa el mismo camino que el selector, así lo reservado no se descuenta dos veces (prueba:
  el disponible queda en 136,78 al pagar la renta; sin vínculo baja a −513,22).
- **Detalle e historial** (decisión 144). Resumen legible al editar (importe con moneda, fecha, categoría,
  cuenta, origen, recurrencia, alcance de la edición con enlace al programado). El historial recuerda
  filtros, búsqueda, filas mostradas y posición en la sesión de la pestaña; un enlace con filtros propios
  manda.
- **Pulido** (decisión 145). Estados pulsados en filas y fichas; entrada breve de diálogos; nada con
  «reducir movimiento».

Lo que **no** se hizo a propósito: registrar favoritos con un toque sin confirmar (Lukas lo anuncia; Clara
no guarda nada sin pulsar Guardar), conversión de divisas, sincronización, widgets, lectura de
notificaciones, IA remota (ver matriz §4 y roadmap §6).

## 3. Antes y después (mismos datos, fecha, idioma, tema y tamaño)

Capturas en `docs/screenshots/v4-before/` (sobre `15756ef`) y `v4-after/` (sobre esta rama), Pixel 7, temas
oscuro y claro; tabla en `docs/VISUAL-QA.md` › «Ronda Lukas». Las capturas son evidencia visual: lo que
cambia de verdad lo comprueban las pruebas de `tests/e2e/lukas-round.spec.ts`.

**Pasos por tarea (Clara, línea base `15756ef` → ahora; toques contados en el flujo real de las pruebas; no
se mide a Lukas porque no se probó):**

| Tarea | Antes | Ahora | Qué cambió |
|---|---|---|---|
| Saber cuánto hay en cuentas y cuánto está reservado | 2 (abrir «¿Cómo?», leer la composición) | 0 (línea bajo la cifra) | `hero-ledger` |
| Ver el próximo pago desde la vista esencial | 2 («Mostrar todo» y bajar a la tarjeta) | 0 (franja) | `upcoming-strip` |
| Registrar un gasto manual (tipo por defecto, categoría por defecto) | 4 (+ · Gasto · importe · Guardar) | 4 | Sin cambios; favoritos: 4 (+ · Gasto · chip · Guardar) |
| Marcar pagada la renta desde un registro manual | 5 (+ · Gasto · importe · abrir selector «Vincular» · elegir · Guardar = 6) | 5 (+ · Gasto · importe · «Sí, vincularlo» · Guardar) | Sugerencia automática |
| Volver al historial filtrado tras ver un detalle | Rehacer el filtro (≥ 3) | 1 («Volver») | Vista recordada |

## 4. Verificación (en este entorno, sobre `a2ae30c`)

Node 22.22.2, npm 10.9.7, Chromium de Playwright; fechas deterministas (28-sep-2026) y datos de demostración.

| Comprobación | Resultado |
|---|---|
| `npm run check` (typecheck, oxlint, lint:i18n, Vitest incl. `qa/`) | **799 aprobadas, 1 omitida, 0 fallidas** (82 archivos; +4 de `duplicates.test.ts`) |
| `npx tsc -p qa/tsconfig.json` | pasa |
| `npm run build` / `npm run size` | pasa · JS inicial **823,2 KB** (gzip 245,4 KB); referencia 767,8 KB, límite 844,6 KB (+7,2 %; el límite no se tocó; +9 KB respecto al cierre de la auditoría por el código y los textos nuevos) |
| `npm audit --json` | 0 vulnerabilidades |
| Playwright, 3 tamaños (`celular`, `celular-pequeno`, `escritorio`) | **818 aprobadas, 1 omitida, 0 fallidas** (15,4 min, 3 trabajadores). La primera pasada completa, sobre `4765c60`, dio 17 fallos: la vista recordada del historial se aplicaba en cada llegada (decisión 146); corregido en `6396f63` y dos guardas a 320 px en `a2ae30c`; nada se omitió ni se relajó salvo la holgura C1 documentada |
| `tests/e2e/lukas-round.spec.ts` (8 recorridos) | 24/24 (8 × 3 tamaños) |
| `layout-guards` + `layout-a11y` (axe, claro y oscuro) | Pasan en los tres tamaños dentro de la suite completa; C1 a 320 px queda en 2,62 pantallas con la holgura 2,75 (decisión 146) |
| Idiomas | Claves completas en es/en/pt/fr (`i18n.test.ts`); UX-02 en inglés; `english.spec.ts` |
| Reducir movimiento, teclado y foco | `regressions-round3.spec.ts` (E4), `layout-a11y`; los elementos nuevos usan `:active` y animaciones con la regla global de `prefers-reduced-motion` |
| Persistencia tras recargar | `setup.spec.ts`, `assistant.spec.ts` (2 195,50), `lukas-round` (vista del historial en `sessionStorage`) |
| Dispositivos físicos (iPhone PWA, Android) | **No probado** (`docs/DEVICE-TEST.md`) |
| Vista previa de Cloudflare | La hace CI en el PR (la red del entorno no llega a `pages.dev`) |

## 5. Defectos y límites que quedan

- La posición del historial se recupera tras el «scroll arriba» de la app con dos cuadros de animación; en
  listas muy largas con «mostrar más» la fila puede quedar unas decenas de píxeles desplazada (la prueba
  tolera 80 px). No afecta a los filtros.
- La sugerencia de vínculo se basa en el importe exacto o en categoría + fecha; un pago parcial de un
  programado no se sugiere (sigue disponible en el selector, con «esperar el resto»).
- El aviso de duplicado compara notas normalizadas: dos notas distintas para el mismo gasto no avisan (la
  bandeja tampoco), por diseño.
- `TrendLines` no rotula los días en el eje (sí en la tabla alternativa); se deja como propuesta P4.
- Lo no verificable aquí: Safari/iPhone, Android real, lector de pantalla real.

## 6. Roadmap priorizado (fuera de esta ronda)

| Prioridad | Capacidad | Dependencias / cambios | Pruebas necesarias |
|---|---|---|---|
| P2 | Frecuencia «dos veces al mes» en programados | `Frequency` nueva en `domain/validation.ts` y `occurrencesBetween`; migración no necesaria (campo opcional `days: [1, 15]`); i18n | Ocurrencias, mes corto, reserva sin duplicar, calendario |
| P3 | Etiqueta como filtro en Estadísticas | `Statistics.tsx` + `matchesTxFilter`; sin modelo nuevo | Las tres cifras y el donut respetan la etiqueta |
| P3 | «Repetir» desde un movimiento existente | Formulario: crear programado a partir del guardado sin duplicarlo | No duplica; vincula la ocurrencia actual |
| P3 | Varias monedas con tasas manuales fechadas | Modelo (tasa por movimiento), validación, exportación; nunca sumar sin convertir | QA-01/QA-05 ampliadas |
| P4 | OCR de recibos por servicio propio | Reglas de R-01 (`RELEASE.md`), contrato de datos, fallback local | Compilación negativa, a11y del flujo |
| P4 | Sincronización cifrada entre dispositivos | Fase 2 del `ROADMAP.md`: cuentas, tombstones, conflictos, RPO/RTO | Integración completa |
| P4 | Envoltorio nativo (widgets, notificaciones) | Cuentas de desarrollador; fuera de la PWA | — |

## 7. Lo que no se afirma

No se afirma que Clara supere a Lukas: la comparación es ficha contra código, no uso contra uso. No se
afirma nada sobre dispositivos físicos. No se declara la app libre de errores: lo validado es lo del §4,
en este entorno, sobre `a2ae30c`.
