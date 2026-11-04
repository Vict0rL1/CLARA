# Pasada correctiva — hallazgos de la auditoría independiente del 2026-10-19 (P1 y P2)

- Auditoría: `43b4d74` frente al candidato `54f9b69`; la cabeza posterior `46fe617` solo cambia AGENTS.md. Antes de esta pasada
  la rama llevaba además los seis commits de la auditoría de seguimiento (`7e5e5d0`…`1e23b8e`, fuentes distintas de `54f9b69`
  en otros ficheros), así que **cada hallazgo se reprodujo sobre la cabeza real, `1e23b8eb5796a6874d43b7e9d899f15c00592b5c`**,
  con el árbol limpio salvo documentación sin confirmar (`AGENTS.md`, `docs/ROLLBACK.md`, `docs/qa/followup-audit-2026-10-20/`).
- Evidencia externa (`…/CLARA-AUDIT-2026-10-19/evidence/`) y su `REPORT.md`: **no accesibles en este entorno**; no se inspeccionó
  ninguna captura ni registro de allí. Las entradas sintéticas se reconstruyeron tal cual las describe el encargo y se corrieron
  como sondas (`evidence/corrective.probe.test.ts.txt`). Las ejecuciones de la matriz interrumpida por el host no se han
  reclasificado ni borrado: no se tocan.
- SHA final del código: `58e4b79ed526db0b98714cb27a14f6cc5b80dd74` (commits ``20beaf0` P1, `8f78494` P2, `58e4b79` tamaño`). Este informe y la evidencia van en el commit de documentación inmediatamente posterior al código (solo documentación: no cambia ninguna fuente).
- Nada se ha fusionado, empujado ni desplegado.

## 1. Resumen

| Id | Prioridad | Clasificación | Causa raíz | Corrección | Commit |
|---|---|---|---|---|---|
| P1 | P1 | Hueco preexistente de la familia de hallazgos de moneda (los contratos nuevos también fallan en `43b4d74`), no una regresión nueva. | `markBefore`/`markAfter` (`money.ts`) solo admitían espacios entre el código y el importe y `currencyMarksIn` descarta a propósito los ISO no admitidos lejos del importe: «coffee (RUB) 10», «coffee RUB: 10», «coffee (RUB) $10» y «TOTAL RUB: 10.00»/«TOTAL (RUB) 10.00» quedaban como 10 CAD sin marca. | Puntuación monetaria acotada en el lector compartido (`CODE_BEFORE`/`CODE_AFTER`: paréntesis o corchete alrededor del código y, como mucho, dos puntos, igual o coma) en `markBefore`, `markAfter`, `prefixMark` y `suffixMark`. RUB sigue sin admitirse y bloquea hasta corregir a mano; nada se convierte ni se reetiqueta. Más lejos del importe nada cuenta («AMD GPU 500»). | `20beaf0` |
| P2 | P2 | Regresión nueva de `54f9b69` (el contrato correcto pasa en `43b4d74` y falla en `1e23b8e`). | `receiptMarks` (`receipt.ts`) activaba la lectura de códigos para TODA la línea si contenía cualquier palabra de total/impuesto/pago: en «PEN 2.99 TAX 0.10» el «TAX» de la columna del impuesto convertía el artículo «PEN» en soles → `currencyConflict: ['PEN','CAD']`. | Clasificación por tramo: cada palabra etiqueta el primer importe que la sigue (o el último anterior si no hay ninguno detrás) y solo junto a ESE importe un código cuenta aunque sea palabra o ISO no admitido; lo anterior a la palabra es mercancía. Límites de palabra Unicode (`À PAYER`, `ESPÈCES`). | `8f78494` |
| Tamaño | — | Presupuesto (`npm run size`): en `1e23b8e` el JS inicial era 845,9 KB frente al tope 844,6 KB (los commits de la auditoría de seguimiento lo habían pasado en 1,3 KB). | Medido, no supuesto (`evidence/initial-chunks-by-module-1e23b8e.txt`): la exportación CSV se carga al pulsar (solo la usaba `Movements.tsx`) y las funciones de revertir del historial pasan a `domain/historyRevert.ts` (solo las usan pantallas que ya se cargan aparte). Sin cambio de comportamiento. 845,9 → 844,8 → **842,1 KB** (tope sin tocar). | `58e4b79` |

## 2. Reproducción (antes) y evidencia (después)

### P1

- Sonda (`evidence/unit-probe-before-1e23b8e.txt`, sobre `1e23b8e`): «coffee (RUB) 10», «coffee RUB: 10» y «coffee (RUB) $10» →
  `[1000, null, null]` (10 CAD sin marca); «TOTAL RUB: 10.00» y «TOTAL (RUB) 10.00» → total 1000 sin `foreignCurrency`;
  controles «coffee (USD) 10», «TOTAL USD: 10.00», «TOTAL RUB 10.00», «AMD GPU 500» correctos (5 fallos, 1 pasa).
- Contrato mantenido (`src/domain/qaCorrective.test.ts`, «P1 ·»): asistente «(RUB) 10», «RUB: 10», «[RUB] 10», «RUB = 10»,
  «10, RUB», «10 (RUB)» → 10 RUB, el campo escribe «10.00 RUB» y lo vuelve a leer como `unknownCurrency`; «(RUB) $10» →
  conflicto RUB/«$» (el rublo no es «$»: se conservan las dos marcas, el campo escribe «RUB 10.00 $» y se bloquea); recibos
  «TOTAL RUB: 10.00», «TOTAL (RUB) 10.00», «TOTAL: RUB 10.00», «TOTAL 10.00 (RUB)», «MONTANT RUB: 10.00», «IMPORTE (RUB)
  10,00» → RUB; código admitido con la misma sintaxis → USD; la del presupuesto con puntuación no bloquea; acotado («AMD GPU
  500», «coffee (RUB) large 10», «(RUB) coffee 10», «RUB rate 10», «GST 10», «IVA 10», «PEN (RUB) 2.99» en artículo);
  contradicciones («USD 10 CAD», «€10 CAD»), repeticiones compatibles («CAD $10», «$10 CAD»), monedas admitidas e importes
  en palabras (es/en/pt/fr) iguales; campo/CSV/atajos: «(RUB) 10», «RUB: 10», «10, RUB», «10 (RUB)», «[RUB] 10» →
  `unknownCurrency`; «CAD: 10» vale; «RUB -10» conserva el signo; «(10.00)» no cambia.
- Navegador (`tests/e2e/qa-corrective.spec.ts`, tres tamaños): asistente «coffee (RUB) 10» y «coffee RUB: 10» → campo
  «10.00 RUB», error «“RUB” no es una moneda conocida…», aviso «1 línea está en otra moneda…», «Registrar» desactivado; Enter en
  el campo y clic forzado sobre el botón desactivado no cambian el almacenamiento (comparación byte a byte) ni muestran
  «registrado»; corregido a «10» se registra en CAD y sigue tras recargar. «coffee (RUB) $10»: campo «RUB 10.00 $» y error de
  dos monedas. Recibo OCR sintético «TOTAL RUB: 10.00» y «TOTAL (RUB) 10.00»: igual. OCR y cámara reales: no probados.

### P2

- Sonda: «SHOP / PEN 2.99 TAX 0.10 / TOTAL CAD 3.09» → `[309, null, ['PEN','CAD']]`; la variante «TOTAL 3.09» →
  `[309, 'PEN', null]` (2 fallos).
- Contrato mantenido («P2 ·»): los dos recibos → 3,09 sin moneda ni conflicto, también con «IVA» y «TIP» en la columna;
  controles «TOTAL PEN 10.00», «SUBTOTAL PEN 9.00», «CASH USD 20.00», «VISA RUB 10.00», «TOTAL 10.00 PEN», «TAX PEN 0.10»
  siguen contando; dos monedas impresas → conflicto; etiquetas es/en/pt/fr con acento al principio («À PAYER RUB 10.00»,
  «ESPÈCES USD 20.00», «DÉBITO PEN 10.00», «TROCO PEN 1.00», «IMPORTE PEN 10,00», «MONTO (RUB) 10,00»); los controles de
  nombres de artículo y texto engañoso que ya existían, intactos.
- Navegador (tres tamaños): ambos recibos proponen «3.09», sin aviso de moneda, «Registrar» activo, se registra y persiste en
  CAD tras recargar; control «TOTAL PEN 10.00» en el mismo recibo sigue bloqueado.

### Primer intento de navegador (error de prueba, no de producto)

`evidence/e2e-corrective-run1-test-mistakes.txt`: 18 fallos por dos errores de la propia prueba, no del producto: (a) el texto
esperado para RUB era el de «moneda distinta» en vez de «no es una moneda conocida» (el campo ya valía «10.00 RUB»); (b) la
ayuda `movementCount` navega a Movimientos, así que el intento de registrar por teclado buscaba un campo que ya no estaba
(tiempo de espera agotado). La prueba se corrigió (comparación del almacenamiento entero antes y después, sin navegar); los
seis casos de P2 pasaron ya en ese intento. Se conserva el original.

## 3. Lo que se conserva (controles existentes en verde)

Esquema 14 y `anchorDate` (copias, validación, retroceso), 31 de fin de mes, bisiestos, «dos veces al mes» en ambas
orientaciones, particiones repetidas/encadenadas y re-guardados, reanclaje explícito, vínculos de pagos/metas/plantillas/
escenarios y deshacer atómico con conflictos y aplazamientos caducados, copias antiguas, colchón de seguridad frente al cambio
de moneda, fechas personalizadas de Estadísticas con cada filtro y combinación, dinero entero, reservas del disponible,
transferencias y devoluciones, liquidación parcial automática, conflictos de guardado y deshacer tras importar/restaurar:
`qaPr15Anchor`, `qaPr15Undo`, `qaV2`, `retest`, `qaFollowUp`, `stabilization`, `tests/e2e/qa-pr15.spec.ts`,
`tests/e2e/qa-v2.spec.ts`, `tests/e2e/qa-followup.spec.ts` y el resto de la matriz, en la verificación final (§4).

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

## 5. Límites que quedan y recomendación

- La puntuación reconocida es deliberadamente corta (paréntesis/corchetes, dos puntos, igual, coma). Un código con otra
  palabra entre medias («coffee (RUB) large 10») o lejos del importe sigue sin contar: así «AMD GPU 500» y los nombres de
  comercio siguen funcionando. Nombres de moneda y símbolos no ganan puntuación (no lo pedía ningún hallazgo).
- En un recibo, una palabra de total/pago que no vaya seguida de ningún importe etiqueta el último anterior; una línea con
  varias palabras y varios importes se lee por tramos y no se intenta nada más listo que eso.
- OCR, cámara, Safari/Android físicos, lectores de pantalla, escalado del sistema, selectores de archivos nativos y el ciclo de
  vida PWA en dispositivo: no se han ejercitado; las pruebas de recibo usan un `TextDetector` falso con texto sintético.
- Recomendación: **apta para revisión humana y fusión**. Los dos hallazgos están corregidos con reproducción antes/después en código y navegador, todo lo anterior sigue en verde, el presupuesto de tamaño vuelve a cumplirse sin tocar el tope y la matriz completa pasa en los tres tamaños (la única excepción, el presupuesto de arranque con 10k en escritorio, está explicada, medida A/B y re-ejecutada). Fuera de alcance y sin verificar: OCR y cámara reales, Safari/Android físicos, lectores de pantalla, escalado del sistema, selectores de archivos nativos y el ciclo PWA en dispositivo. El PR #15 sigue en `46fe617`: nada se empuja sin autorización.
