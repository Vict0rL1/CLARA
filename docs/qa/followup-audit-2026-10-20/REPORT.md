# Auditoría independiente de seguimiento — informe de implementación

- Punto de partida: `46fe617b98c93902751bcf1949b226adfed65dce` (fuentes = `d28de42`), rama `claude/margen-personal-finance-app-cdvrt3`, PR #15.
- SHA final del código de esta auditoría: `1e23b8eb5796a6874d43b7e9d899f15c00592b5c` (seis commits, uno por hallazgo, sobre `46fe617`). La verificación final (§4) se hizo en `58e4b79ed526db0b98714cb27a14f6cc5b80dd74`, que añade encima los tres commits de la pasada correctiva del 2026-10-19 (`docs/qa/corrective-pass-2026-10-20/`): el presupuesto de tamaño del JS inicial, que estos seis commits habían pasado en 1,3 KB, se corrige allí (`58e4b79`). Este informe y la evidencia van en el commit de documentación inmediatamente posterior al código (solo documentación: no cambia ninguna fuente).
- Nada se ha empujado ni publicado: el PR no se actualiza sin autorización.
- Datos sintéticos en todas las pruebas; fechas fijas; sin IA; sin límites subidos ni afirmaciones retiradas.

## 1. Resumen por hallazgo

| Id | Prioridad | Causa raíz | Corrección | Archivos | Commit |
|---|---|---|---|---|---|
| F-01 | P1 (bloqueante) | `validateHistory` exigía ≤ 64 caracteres a TODOS los ids de cambio; los de `inboxSnoozed` son ids de la bandeja (`due:schedule:<id>:<fecha>`, hasta 300). Con un programado de id ≥ 41 y un aviso pospuesto, partirlo se guardaba y al recargar se clasificaba como dañado; la copia no se importaba. | Contrato de id por colección (`isValidHistoryChangeId`), compartido con `validateInbox` (`INBOX_ID_MAX`). Sin acortar ids, sin descartar historial ni aplazamientos, sin subir el esquema. | `src/domain/validation.ts`, `docs/STORAGE.md`, `CLAUDE.md`, pruebas | `7e5e5d0` |
| QA-01 histórico | P1 | La migración 13 → 14 (conservadora) no toca particiones antiguas sin `anchorDate`: siguen contando desde la fecha movida. | Revisión y reparación confirmada: `domain/splitRepair.ts` detecta, Ajustes › Datos muestra fechas actuales y propuestas; reparar pone `anchorDate` (copia local previa, historial, revertible); «Dejar como está» = descarte con huella. | `src/domain/splitRepair.ts`, `src/ui/screens/settings/SplitRepairCard.tsx`, `DataCenterSection.tsx`, i18n ×4, `docs/FORMULAS.md` §44, `CLAUDE.md` | `36d0441` |
| F-02 | P2 | `revertEntry` restauraba instantáneas sin evaluar el estado resultante: una entrada antigua (solo programados) o una plantilla/escenario/meta creados después dejaban referencias a la serie eliminada. | `revertDependents` evalúa el estado candidato; `canRevert` → `dependents`; la pantalla lista qué registros (es/en/pt/fr) y no ofrece «Revertir»; `revertEntry` falla con `revertDependents` sin cambiar nada. | `src/domain/history.ts`, `src/domain/validation.ts`, `src/ui/screens/History.tsx`, i18n ×4, `docs/FORMULAS.md` §26, `CLAUDE.md` | `426de6a` |
| F-03 | P3 | `floorDiv((actual − anterior) × 100, anterior)`: el producto salía del rango exacto y lanzaba. | `checkedMulDivFloor(actual − anterior, 100, anterior)`; cociente irrepresentable → señal sin `percent` y texto explícito (`insights.*.titleNoFigure`). | `src/domain/analysis.ts`, `src/ui/screens/Insights.tsx`, i18n ×4, `docs/FORMULAS.md` §38, `CLAUDE.md` | `dfd241c` |
| F-04 | P3 | `.stat__delta--neutral` usaba `--text-muted`: 3,66:1 en oscuro (#64748b sobre #121a2a) y 2,56:1 en claro (#94a3b8 sobre #ffffff) para 14 px/600. | `--text-secondary` (7,5:1 oscuro, 7,6:1 claro). Solo esa regla; variaciones positiva/negativa y el resto de tokens intactos. | `src/styles.css`, `src/ui/themeTokens.test.ts`, `CLAUDE.md` | `cb12d02` |
| F-05 | P3 | Etiquetas del eje con fecha completa y año («1 jul 2026») en seis huecos de ≈ 50 unidades del viewBox: se solapaban a cualquier anchura (la escala es uniforme). | `pickAxisLabels`: cada punto ofrece formas de la más larga a la más corta y se dibuja la más larga que cabe en todos los huecos; si ninguna cabe, una de cada k y siempre la última. Tooltip, nombre accesible y tabla conservan la fecha completa. | `src/ui/components/axisLabels.ts`, `src/ui/components/statsCharts.tsx`, `src/ui/screens/Statistics.tsx`, `CLAUDE.md` | `1e23b8e` |

## 2. Reproducción y evidencia (antes → después)

Cada hallazgo se reprodujo con una prueba que falla sobre `46fe617` y pasa sobre el SHA final. Los registros «antes» están en `evidence/` (ejecuciones de las mismas pruebas sobre `46fe617` o su compilación); los «después» autorizados son los de la verificación final en el SHA del código (`evidence/final/`: `check.txt` para las unitarias y `e2e-celular.txt`, `e2e-celular-pequeno.txt`, `e2e-escritorio.txt` para el navegador, que incluyen `tests/e2e/qa-followup.spec.ts` entero en los tres tamaños).

### F-01

- Unitario (`src/domain/qaFollowUp.test.ts`, «F-01 · un programado con un id largo…»): ids anterior/nuevo 64/64, 47/36, 41/36, 40/36, 36/36: partir → guardar → recargar (validación entera) → deshacer → recargar → exportar → reimportar.
  - Antes (`evidence/unit-f01-before.txt`): 64, 47 y 41 fallan en «tras partir» con `history[0].changes[2]`/`[3]` → `invalidValue`; 40 y 36 pasan (24 + 40 = 64 es justo el límite).
  - Después: los cinco pasan. Además cada colección del historial valida en su límite exacto (64/65; `inboxSnoozed` 300/301) y una copia escrita por la versión con el fallo (ids de aviso de 88 y 60 en el historial) se importa sin cambios en sus datos.
- Navegador (`tests/e2e/qa-followup.spec.ts`, F-01, ids 64 y 47, reloj 28-sep-2026, factura CAD 400 mensual, aviso del 1-oct pospuesto, importe 420 «desde» el 1-oct, «Guardado», recargar, deshacer, exportar, reimportar), en celular (412), celular 320 y escritorio (1280):
  - Antes (`evidence/e2e-f01-before.txt`, misma prueba contra la compilación de `46fe617`): las seis fallan en «tras partir»: la pantalla «No pudimos leer tus datos guardados» aparece (esperado 0, recibido 1).
  - Después: las seis pasan (`evidence/final/e2e-*.txt`).
- Recuperación de los datos ya guardados por la versión con el fallo: no hace falta migración ni reparación. Lo escrito era correcto; solo la lectura lo rechazaba. La pantalla de datos dañados nunca borra ni reemplaza nada (solo «Empezar de nuevo», confirmado, y guardando antes la copia interna), así que con esta versión el mismo almacenamiento vuelve a cargar tal cual y las copias exportadas entonces se importan sin cambios (prueba «una copia exportada por la versión anterior…»). `SCHEMA_VERSION` no sube: el formato no cambió.
- Decisión sobre una comprobación al guardar: no se añade una validación entera en `commit` (O(registros) por guardado: con 10 000–50 000 movimientos rompe el presupuesto de 500 ms y convertiría un error del validador en «no se puede guardar»; descartar la entrada o recortar el id serían los atajos prohibidos). En su lugar, los dos contratos comparten la constante `INBOX_ID_MAX`, una prueba fija cada colección en su límite exacto y la prueba de navegador cubre el recorrido completo. Detalle en `docs/STORAGE.md`.

### QA-01 histórico

- Fixture de la auditoría: saldo CAD 1 800, seguro de 1 250 el 29-mar, sueldo mensual del 31 partido el 28-feb solo por importe (esquema 13), reloj 15-mar-2026.
- Unitario («QA-01 histórico · particiones hechas por 819eaa9…»): se detecta (`current` 28-mar, 28-abr, 28-may; `proposed` 31-mar, 30-abr, 31-may); antes de reparar `computeBudget` da horizonte 28-mar, 0 reservados, 180 000 disponibles (lo que vio la auditoría tras importar); reparado: 31-mar, 125 000, 55 000, también tras guardar/recargar y en la copia exportada e importada; la reparación se revierte desde el historial; «Dejar como está» conserva el 28, deja de proponerse (descarte `int:split:salary-new` con huella) y valida. No se señalan: particiones hechas por v14, reanclajes explícitos (fecha ajena a la serie), tramos terminados ni series sin partir; una cadena 31 → 28-feb → 28-abr propone el 31; una partición nueva con la versión corregida nunca aparece.
- Navegador (QA-01, tres tamaños): datos v13 migran al abrir; Inicio $1,800.00; Ajustes › Datos muestra «28 mar» frente a «31 mar» y «30 abr»; «Restaurar las fechas de siempre» → diálogo con las fechas → «Fechas de siempre restauradas» → tarjeta desaparece; almacenamiento con `anchorDate: 2026-01-31` en el tramo nuevo y el antiguo intacto; recargar → $550.00; historial con «Revertir»; Copias locales con la copia «antes de restaurar»; exportar e importar conserva $550.00. Declinar: toast «Se deja como está», la tarjeta no vuelve tras recargar, `inbox.dismissed = ['int:split:salary-new']`, $1,800.00.
- Límite declarado (sin resolver a propósito): solo se revisan particiones reconocibles por su forma (tramo anterior del mismo nombre, tipo y regla terminando el día antes, partido en una fecha de la serie). Una partición antigua cuyo tramo anterior se borró, renombró o cambió de regla no se distingue de una serie nueva y no se propone; se edita a mano. La migración sigue sin reescribir fechas.

### F-02

- Unitario («F-02 · deshacer no elimina un programado…»): entrada antigua (solo instantáneas de programados) → `canRevert` = `dependents`, `revertDependents` lista plantilla «Quincena», escenario «Si sube» y aviso del 2026-10-01 apuntando a `next`; `revertEntry` → `revertDependents` (count 3) y el JSON de los datos no cambia. Plantilla, escenario o meta creados DESPUÉS de una partición corregida también bloquean (count 1); la partición de siempre (QA-05) sigue revirtiéndose; una referencia que ya no resolvía antes no cuenta; una entrada que no elimina programados no calcula nada.
  - Antes (`evidence/unit-f02-before-46fe617.txt`, prueba de observación sobre `46fe617`): la entrada antigua se revierte (`ok`) y deja plantilla, escenario y aplazamiento apuntando a `next`.
- Navegador (F-02, tres tamaños): el historial muestra «No se puede revertir: 3 registros seguirían apuntando…», las tres líneas, ningún botón «Revertir»; tras recargar, programados, plantilla y aplazamiento siguen igual.

### F-03

- Unitario («F-03 · Análisis…»): 1 gasto de `MAX_AMOUNT_MINOR` el 10-ago frente a 100 el 10-sep (seguimiento desde el 1-jul, al 28-sep) → `spendingUp` con `percent: 9900`, `current` 100·MAX, `previous` MAX, «porque» exacto. Cociente irrepresentable (1 unidad menor frente a 100·MAX) → señal sin `percent` con los importes. Subidas/bajadas normales iguales (200 → 150 = −25 %; 100 → 108 no avisa).
  - Antes (`evidence/unit-followup-before-46fe617.txt`): «floorDiv requiere enteros y divisor distinto de cero».
- Navegador (F-03, tres tamaños): Análisis muestra «Este mes llevas un 9 900 % más de gasto…».

### F-04

- Unitario (`src/ui/themeTokens.test.ts`, «contraste de “Sin comparación”…»): contraste calculado desde `styles.css` del color de `.stat__delta--neutral` sobre el fondo de `.stat` (`--surface` → `--card`) en claro, «Sistema» oscuro y «Oscuro» ≥ 4,5:1; y la cifra de referencia (`--text-muted` sobre `--card` en oscuro < 4,5).
  - Antes (`evidence/unit-f04-before-46fe617.txt`): claro 2,56:1 (#94a3b8 sobre #ffffff), oscuro 3,66:1 — los tres fallan.
- Navegador (F-04, tres tamaños): Estadísticas, periodo personalizado 1–31 de julio sin ingresos previos, «Sin comparación» visible; contraste calculado en el navegador ≥ 4,5:1 y axe (`color-contrast`, `#main`) sin fallos en «Oscuro» explícito (`clara.theme = dark`), «Sistema» con el sistema en oscuro (`clara.theme = system`, sin `data-theme`, `colorScheme: dark`) y «Claro» (`clara.theme = light`); la variación con tono sigue teniendo su color. (La app arranca en «Oscuro» si no hay preferencia guardada, por eso cada prueba fija la suya.)
  - Antes (`evidence/e2e-f04-before.txt`, misma prueba contra la compilación de `46fe617`): oscuro explícito y sistema oscuro 3,66:1 (rgb(100, 116, 139) sobre rgb(18, 26, 42), 14 px/600); claro 2,56:1 (rgb(148, 163, 184) sobre rgb(255, 255, 255)); las nueve fallan.

### F-05

- Unitario (`src/ui/components/axisLabels.test.ts`): seis fechas con año no caben en huecos de (320 − 16)/6 → forma corta y las seis visibles; formas cortas que caben se conservan; si ninguna cabe, una de cada k y siempre la última, nunca dos vecinas; en/fr caben; sin puntos nada y hueco 0 sin dividir entre cero.
- Navegador (F-05, es/en/pt/fr × tres tamaños): seis etiquetas `text.stats-axis`, ninguna solapada (borde izquierdo ≥ borde derecho de la anterior + 1 px) ni recortada; la tabla (abierta con «Ver tabla»), el nombre accesible de cada grupo y el tooltip contienen la etiqueta completa.
  - Antes: la causa está en el código (`fmt.date(…, { compact: true })` sin `today` → año siempre; seis etiquetas de 10–11 caracteres en huecos de ≈ 50 unidades); la prueba unitaria de la forma larga lo fija (`estimateAxisTextWidth(full) > SLOT` para las seis).

## 3. Hallazgos cerrados que se conservan

- QA-01 (mensual 29/30/31, trimestral 31, 29-feb bisiesto, «dos veces al mes», particiones repetidas, re-guardar, reanclaje explícito; CAD 1 800 − 1 250 = 550), QA-02 (colchón bloquea cambiar moneda), QA-03 (fechas personalizadas con filtros/dirección), QA-04 (marcas contradictorias; «Cafe Euro $12»), QA-05 (deshacer una partición corregida devuelve plantillas, escenarios y aplazamientos): sus pruebas (`qaPr15Anchor.test.ts`, `qaPr15Undo.test.ts`, `qaV2.test.ts`, `tests/e2e/qa-pr15.spec.ts`, `tests/e2e/qa-v2.spec.ts`) siguen en verde en la verificación final (§4).
- R1–R7 y S1–S4 (revisiones propias anteriores) sin cambios.

## 4. Verificación final en el SHA del código

- SHA verificado: `58e4b79ed526db0b98714cb27a14f6cc5b80dd74` (código: seis commits de la auditoría de seguimiento `7e5e5d0`…`1e23b8e` y tres de la pasada correctiva `20beaf0`, `8f78494`, `58e4b79`). Árbol en ese momento: ninguna fuente pendiente; solo documentación sin confirmar (`AGENTS.md`, `docs/ROLLBACK.md` y los dos directorios de informes; `evidence/final/status.txt`).
- Ejecución: 2026-10-20T06:07:47Z → 06:58:40Z, en serie y sin nada más en marcha (resumen en `evidence/final/verification.txt`; cada registro completo en `evidence/final/`).
- Cada commit por separado (árbol temporal con `tsc -b`, `oxlint .` y Vitest): `7e5e5d0`, `36d0441`, `426de6a`, `dfd241c`, `cb12d02`, `1e23b8e`, `20beaf0`, `8f78494`, `58e4b79` → los nueve con salida 0 (de 1 061 a 1 094 pruebas; `evidence/final/worktree-*.txt`).
- `npm run check` (typecheck, oxlint, literales i18n, Vitest): 109 archivos, 1 094 pruebas y 1 omitida → 0.
- `npm run build`: 231 módulos; id de la compilación (sha256 de la lista ordenada de sha256 de cada archivo de `dist`) `65842df8ee9d21624723cd5b362ddc2553c97df4d8ecf283c9953df8bba038cd`, 75 archivos.
- `npm run size`: JS inicial 842,1 KB en 13 archivos (gzip 252,5 KB) frente al tope de 844,6 KB (referencia 767,8 KB, +9,7 %); tope y referencia sin tocar.
- `npm audit --audit-level=high`: 0 vulnerabilidades.
- Playwright, un proyecto cada vez, `--workers=2 --fail-on-flaky-tests`, contra UNA vista previa de esa compilación: celular (412 px) 362 pasan y 1 omitida (12,8 min); celular 320 px 363 pasan (11,4 min); escritorio (1 280 px) 359 pasan, 3 omitidas y **1 falla** (12,9 min): `performance-10k.spec.ts` («10 000 movimientos: Inicio interactivo en < 500 ms»), mejor de dos cargas 540 ms (540 / 608) frente al presupuesto de 500 ms. Todo lo demás de la matriz —`qa-pr15`, `qa-v2`, `qa-followup`, `qa-corrective`, guardas de maquetación, axe, migraciones, copias— en verde en los tres tamaños.
- Ese único fallo, con su registro original conservado (`evidence/final/e2e-escritorio.txt`): en esa cadena las tres mediciones del arranque con 10 000 movimientos salieron altas a la vez (celular 510 / 449, 320 px 491 / 433, escritorio 540 / 608 ms) frente a los 247–518 ms de todas las verificaciones anteriores en este mismo contenedor, y ninguno de los nueve commits toca el arranque de Inicio (el JS inicial baja de 845,9 a 842,1 KB; el lector de monedas y los recibos no se ejecutan al cargar; la validación por colección del historial añade una llamada por cambio). Para no suponerlo se midió A/B en serie, en escritorio y sin nada más en marcha (`evidence/final/perf-10k-ab-old-vs-final.txt`): compilación anterior a todo esto (`46fe617`) 316 / 212, 256 / 232 y 270 / 231 ms; compilación final (`58e4b79`) 243 / 208, 242 / 203 y 214 / 199 ms. La final es igual o más rápida en las tres rondas y muy por debajo del presupuesto: variación del entorno durante la cadena, no un defecto del producto. El presupuesto (500 ms) y la afirmación de la prueba no se tocan. Re-ejecución permitida (una sola, el proyecto de escritorio entero, misma compilación `65842df8…38cd`, en serie y sin nada más en marcha; `evidence/final/e2e-escritorio-rerun.txt`): 360 pasan, 3 omitidas, 0 fallos en 9,6 min, con el arranque de 10k en 345 / 255 ms. El registro original con el fallo se conserva tal cual.

## 5. Implicaciones de migración y recuperación

- F-01: sin migración; datos y copias escritos por la versión con el fallo vuelven a leerse tal cual.
- QA-01 histórico: sin migración; la reparación es por registro y confirmada; «Dejar como está» es un descarte de la bandeja (formato existente); la copia local previa usa el mecanismo «antes de restaurar».
- F-02: sin cambios de datos; una entrada rechazada por dependientes vuelve a ser revertible cuando esos registros se cambian o borran.
- F-03/F-04/F-05: sin cambios de datos.
- `SCHEMA_VERSION` sigue en 14.

## 6. Límites que quedan

- QA-01 histórico: particiones antiguas no reconocibles (ver §2) no se proponen; la migración no adivina.
- F-02: no se reconstruyen instantáneas omitidas; la persona resuelve las referencias y vuelve a revertir.
- F-05: la anchura de las etiquetas se estima (sin DOM al decidir); la guarda de maquetación la comprueba en es/en/pt/fr y tres tamaños. Fuentes del sistema muy distintas podrían cambiar el margen; la tabla y el tooltip siempre llevan la fecha completa.
- F-04: solo se ha corregido la regla señalada; `--text-muted` sigue existiendo para texto grande o decorativo.

## 7. Pruebas de control frente a observación

- Control (fijan comportamiento): todas las de `qaFollowUp.test.ts`, `axisLabels.test.ts`, `themeTokens.test.ts` (F-04) y `tests/e2e/qa-followup.spec.ts`.
- Observación (solo documentan el «antes», no viven en la rama): `evidence/unit-f02-before-46fe617.txt` (prueba ad hoc sobre `46fe617`) y las ejecuciones «antes» de las demás pruebas contra la compilación de `46fe617`.
