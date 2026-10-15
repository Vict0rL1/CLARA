# Estabilización de la versión candidata (auditoría posterior 2026-10-12/13)

Rama `fix/release-stabilization-2026-10` sobre el candidato auditado `e7c9d87`
(`feat/etapa3-flujo-presupuestos`); PR Vict0rL1/CLARA#14. Durante este trabajo no se fusionó, desplegó
ni activó nada; no se usó ningún dato financiero real ni ningún servicio remoto: solo la demostración y
datos sintéticos. La fusión posterior en `main` (con la publicación que CI hace al fusionar) la pidió
después la persona responsable del repositorio; no cambia ninguna cifra de este informe.

## Cómo se trabajó

- **Cada punto empezó por reproducir el fallo en el código auditado.** Las pruebas unitarias nuevas se
  ejecutaron con los archivos corregidos devueltos a su versión de `e7c9d87` (fallan; registros
  `item*-before.txt`). Las de navegador se ejecutaron contra la compilación de `e7c9d87` servida aparte
  (`BASE_URL=http://localhost:4174`, índice `assets/index-bF-XgfD6.js`): `before-e7c9d87-e2e.txt`.
- **Corrección de evidencia.** Las primeras reproducciones de navegador de REC-01 y de los puntos 7–14 se
  hicieron, por error, contra una compilación anterior (`a2d6c64`, etapa 3 sin la etapa 4) que seguía
  ocupando ese puerto. Se repitieron todas contra `e7c9d87`; solo se conservan las de `e7c9d87`.
- **Un commit por arreglo**, con su explicación y sus pruebas. Ninguna aserción válida se borró ni se
  debilitó; cuando una cambió fue porque el contrato cambió a propósito y lo dice el commit (texto exacto de
  la revisión del asistente, proveedor remoto que ahora exige `VITE_AI_ALLOWED_ORIGINS`).
- Se distingue **defecto del producto** de **defecto de la prueba** (punto 14).

## Tabla de puntos

Pruebas de navegador: `tests/e2e/stabilization.spec.ts` (nombres que empiezan por el id). Pruebas
unitarias: `src/domain/stabilization.test.ts` (bloques por id) salvo donde se indica. «Antes» = resultado
sobre `e7c9d87`; «después» = sobre esta rama.

| Id | Commit | Archivos principales | Pruebas | Antes → después | Límites que quedan |
|---|---|---|---|---|---|
| AS-01 | `afa94d7` | `domain/parser.ts`, `review.ts`, `assistant.ts`, `aiProvider.ts`, `ui/screens/Assistant.tsx`, `ProposalReview.tsx` | 4 unitarias · «AS-01 · café USD 10…» y «…la misma moneda sigue funcionando» | ✘ (se guardaba como CAD 10) → ✓; la de misma moneda pasa en ambos (guarda) | Nunca convierte: quien escribe otra moneda debe corregir el importe. Variantes encontradas después: ver RT-01 más abajo |
| FIN-01 | `f006343` | `domain/operations.ts` (`saveTransaction`) | 4 unitarias · «FIN-01 · vincular un pago del día del saldo…» | ✘ (patrimonio $1,258.77 tras vincular) → ✓ | — |
| FIN-02/03 | `3090218` | `domain/plans.ts`, `ui/screens/Plans.tsx` | 5 unitarias (varias renovaciones, máximo) · «FIN-02 · bajar un límite por debajo de lo arrastrado…» | ✘ → ✓; todo resultado valida con `validateAppData` | Datos ya guardados con base negativa se renuevan con base válida (prueba incluida) |
| REC-01 | `b4f39ff` | `state/replaceUndo.ts`, `ui/screens/Settings.tsx`, `settings/BackupsSection.tsx`, `ui/useAutoBackup.ts` | `src/state/replaceUndo.test.ts` (3) · 3 de navegador (importar, restaurar, sin cambios) | ✘ ✘ (el registro desaparecía) → ✓ ✓; «sin cambios… sí vuelve» pasa en ambos (guarda) | Si se niega, lo anterior está en la copia local «Antes de restaurar». Variantes encontradas después: ver RT-02 más abajo |
| REC-02 | `c6d5e1b` | `storage/backup.ts`, `domain/backupReminder.ts` | 3 unitarias · «REC-02 · una copia con exportedAt inválido…» | ✘ → ✓ | Datos ya guardados por `e7c9d87` con `verifiedExportedAt` inválido entran por la recuperación de datos dañados existente; no se reescriben en silencio |
| 6 | `d661f43` | `domain/history.ts` (`sameValue`) | 3 unitarias · «6 · un gasto recién guardado se puede revertir…» | ✘ (sin «Revertir» tras recargar) → ✓ | — |
| 7 | `27c38ec` | `domain/rules.ts` (`rankRuleMatches`), `parser.ts`, `review.ts`, `ProposalReview.tsx`, `Assistant.tsx`; `stage2-review.spec.ts` actualizado | 5 unitarias · «7 · con uber y uber eats…» | ✘ (5/5 unitarias; navegador elegía transporte) → ✓ | Lo disponible exacto se simula en el asistente; en la importación CSV la fila muestra el efecto en el saldo |
| 8 | `bf79860` | `domain/analysis.ts`, `reconcileSchedules.ts`, `ui/chartScale.ts`, `components/statsCharts.tsx` | 5 unitarias · «8 · con más devoluciones que gastos…» | ✘ (4/5 unitarias; barra con altura −72) → ✓ | — |
| 9 | `7384eb7` | `domain/projection.ts` (`dayBalance`), `ui/screens/Calendar.tsx` | 1 unitaria · «9 · un día más allá de los 400 días…» | ✘ («$4,154.95» para el 20-nov-2027) → ✓ | El límite sigue siendo 400 días: más allá se dice que no hay cifra |
| 10 | `f7f780e` | `domain/bankImport.ts`, `ui/screens/BankImport.tsx`, `docs/FORMULAS.md`, `CLAUDE.md` | 5 unitarias (colisión, repetir/reordenar/solapar, huellas antiguas, referencia del banco, > 5000 filas) · «10 · CSV…» | ✘ (4/5; la de repetir/reordenar/solapar es guarda y pasa en ambos) → ✓ | Archivos de más de 5000 filas se importan por partes (reconociéndolo); ver hoja de ruta. Variantes encontradas después: ver RT-03 más abajo |
| 11 | `e0e010a`, `648a3b4` | `domain/aiConfig.ts`, `vite.config.ts`, `docs/RELEASE.md` | `aiConfig.test.ts` (3 nuevas), `csp.test.ts`, `assistant.test.ts` · `vite build` falla con cada motivo | ✘ (5 pruebas) → ✓ | Sin endpoint ni secretos reales: hay que verificar en el entorno desplegado alcance, cuota y caducidad del token y los controles del servidor antes de activarlo. `e0e010a` se subió con una prueba en rojo; `648a3b4` la corrige |
| 12 | `d25620d` | `src/styles.css` | `ui/themeTokens.test.ts` (ningún `var(--x)` sin definir) · «12 · …tema claro / oscuro» | ✘ (1.21:1 oscuro, 2.56:1 claro; `--text` y `--danger` sin definir) → ✓ (15.88:1 y 6.79:1 en oscuro) | — |
| 13 | `88d572b`, `6c30f3f` | `src/styles.css`, `ui/navHeight.ts`, `App.tsx` | «13 · texto al 200 % en 320 px…» (4 pantallas × 4 idiomas; barra entera, relleno, foco, aviso sin palabras partidas) | ✘ (Cuentas 449 px, Metas 468–499, Datos 338, Calendario 324) → ✓ (320 en todas) | Simulado con `html { font-size: 200% }`; falta probarlo con el tamaño de letra del sistema en teléfonos reales y con lector de pantalla |
| 14 | `fe407cb` | `ui/components/base.tsx` (`SwipeRow`), `App.tsx` (aviso al salir), `tests/e2e/helpers.ts`, `accounts.spec.ts` | «14 · un deslizamiento rápido…» · `accounts.spec.ts` con `reloadWhenSaved` | ✘ (la fila no se abría) → ✓ | Ver «Verificación final»: la suite completa en esta máquina tiene además dos pruebas sensibles a la carga |
| 15 | `e46436e` | `ui/screens/Goals.tsx`, `App.tsx` (bienvenida diferida) | «15 · el historial de una meta con 120 movimientos…» · `npm run size` | ✘ (sin recuento ni forma de ver más de 50) → ✓; JS inicial 847.7 KB → 816.0 KB (límite 844.6 KB sin cambiar) | La bienvenida se descarga al primer uso (el *service worker* la guarda después) |

### Punto 14 · producto o prueba

- **«deslizar… clic interceptado» (celular pequeño): defecto del producto.** `SwipeRow` decidía al soltar
  con el desplazamiento del último render. Si el movimiento y el soltar llegan antes de que React pinte
  (gesto rápido o máquina cargada), leía 0 y la fila quedaba cerrada con su contenido tapando «Eliminar».
  Reproducción determinista (los tres eventos en la misma tarea) en `e7c9d87`; corregido con el
  desplazamiento en vivo.
- **«el orden se recuerda» (×2): carrera de la prueba con IndexedDB**, con una parte de producto. El orden se
  ve al instante y la prueba recargaba antes de que terminara la escritura; recargar la aborta. La prueba
  ahora espera la confirmación de la app («Guardando…» desaparece) — no se alargó ningún tiempo de
  espera. En la app, el aviso del navegador al cerrar o recargar cubre también un guardado en curso (antes
  solo uno fallido). Con 75 repeticiones bajo carga no se reprodujo: la ventana es de milisegundos.
- **Sensibles a la carga, no a esta rama:** «10 000 movimientos: Inicio en < 500 ms» falló en la ejecución
  completa con tres trabajadores (carga media 13–15 en 4 núcleos). Aislado, `e7c9d87` y esta rama dan lo
  mismo (286–344 ms frente a 308–345 ms; `perf-isolated.txt`); en ejecuciones completas anteriores ya
  oscilaba entre 262 y 875 ms. Y una prueba de `security.spec.ts` esperó más de 5 s a que se descargara la
  pantalla de Ajustes con la misma carga. No se tocaron sus límites.

## Capturas antes / después (320 px)

`docs/screenshots/stabilization-2026-10-13/{before,after}/` — `before` = `e7c9d87`, `after` = esta rama.
Medidas en `docs/qa/stabilization-2026-10-13/*.json`.

| Caso | Archivo | Antes | Después |
|---|---|---|---|
| Donut en oscuro | `donut-dark.png` | total 1.21:1 (negro), subtítulo 3.66:1 a 8 px | 15.88:1 y 6.79:1 a 9 px |
| Texto al 200 % | `text200-cuentas-es.png`, `text200-metas-fr.png`, `text200-datos-es.png`, `text200-calendario-es.png` | ancho de página 449 / 499 / 338 / 324 px | 320 px en las cuatro (y en en/pt) |
| Calendario más allá del límite | `calendar-beyond.png` | «Saldo proyectado al cerrar el día: $4,154.95» (20-nov-2027) | «Sin saldo proyectado para este día: la proyección llega hasta el 1 nov 2027 (400 días…)» |
| Gráfico con devoluciones | `refund-bars.png` | barra de gasto con altura −72 (invisible) | barra bajo el cero (44.8) con nota; tabla −$756.82 |

## Comprobación independiente de `main` a23b135 (2026-10-15): RT-01, RT-02 y RT-03

Una nueva comprobación independiente de `main` (`a23b135`) confirmó que los escenarios originales siguen
reparados (las pruebas de AS-01, REC-01 y del punto 10 pasan) y encontró **tres variantes** que esos
arreglos no cubrían. Rama `claude/margen-personal-finance-app-cdvrt3`, un commit por arreglo. El informe y la
carpeta `evidence/` de esa comprobación no estaban accesibles desde este entorno: cada variante se
reprodujo de nuevo aquí a partir de su descripción, sobre la compilación de `a23b135` servida aparte
(`BASE_URL=http://localhost:4174`, índice `assets/index-Dm01Cnwh.js`), y las sondas se convirtieron en
pruebas que se mantienen. Registros en `docs/qa/retest-2026-10-15/`.

| Id | Escenario original (ya reparado el 13-oct) | Variante nueva | Commit | Archivos | Pruebas | Antes (a23b135) → después | Límites |
|---|---|---|---|---|---|---|---|
| RT-01 (P1) | AS-01: «café USD 10» con el código delante | `coffee 10€`, `coffee GBP 10`, `coffee JPY 10`, `coffee CHF 10`, `coffee 10 £`, `coffee EUR ten`, `coffee ten USD`; también `GBP10`, `10GBP`, `10 euros`, `10 pesos`, `RUB 10`, `coffee (USD) 10`, `paid euros coffee 10` y el total de una foto de recibo | `792658c`, `d25fbe3` | `domain/money.ts` (un solo lector: `currencyMarksAround`, `currencyMarksIn`, `stripCurrencyMark`, `withCurrencyMark`), `parser.ts`, `receipt.ts`, `shortcutLink.ts`, `ui/screens/Assistant.tsx` | `src/domain/retest.test.ts` (matriz en es/en/pt/fr, controles CAD, otro presupuesto, ida y vuelta por el campo, recibos, atajos: 9) · `tests/e2e/retest.spec.ts` «RT-01 · …» (€, GBP, «EUR ten», «ten USD» + control CAD) | 18 de 25 frases con otra moneda se podían guardar como CAD → 0 de 25; las 4 de control en CAD se siguen guardando (`rt01-probe-before-a23b135.txt`, `rt01-probe-after.txt`); `coffee 10€` y `coffee GBP 10` se guardaron y siguieron tras recargar (`before-rt01-*.json`); navegador 4 ✘ / control ✓ → todas ✓, campo `€10.00` / `10.00 GBP` y «Registrar» deshabilitado | Nunca convierte. Lejos del importe solo cuentan códigos admitidos en MAYÚSCULAS, símbolos y nombres en plural; en minúsculas no cuentan `pen`, `ron`, `try`, `mad`, `ils`, `bob`; «libra»/«pound» sueltos no son moneda. Un falso positivo bloquea la línea y se corrige quitando la marca del campo |
| RT-02 (P1) | REC-01: registrar algo cuando el reemplazo ya terminó de guardarse | Un cambio que llega mientras la escritura del reemplazo sigue pendiente (gasto de la persona o la tarea automática de programados) | `d7dee26` | `state/store.ts` (`commitTracked`), `state/replaceUndo.ts` | `src/state/replaceUndo.test.ts` «RT-02 · …» (IndexedDB real con escrituras retenidas y en serie, para importar y para restaurar: cambio con el reemplazo pendiente, cambio aún pendiente al deshacer, cambio posterior cuyo guardado falla, tarea automática, sin cambios, reemplazo que no se pudo guardar, cambio posterior al reemplazo, copia «Antes de restaurar» legible: 15) · `tests/e2e/retest.spec.ts` «RT-02 · …» (4: importar y restaurar con la escritura de IndexedDB retenida mientras se registra un gasto de CAD 9; importar y restaurar con el registro automático, sin retraso artificial) | Unidad: `undone` y el gasto de CAD 9 desaparece (`rt02-unit-before-a23b135.txt`) → `stale` y el gasto sigue tras recargar. Navegador con la escritura retenida: «Importación deshecha» / «Restauración deshecha» y el gasto de CAD 9 ya guardado desaparece al recargar → «No se deshizo» y el gasto sigue (900, CAD) (`*-rt02-held-*.json`; 6/6 ✘ → ✓). Con el registro automático: el recibo pasa de 1 a 0 → se conserva (`*-rt02-import.json`; 6/6 ✘ → ✓) | Cualquier cambio posterior, también uno automático o uno cuyo guardado falle, invalida el deshacer: lo anterior se recupera de la copia local «Antes de restaurar». El aviso dice «guardaste cambios después» aunque el cambio fuera automático. Con qué frecuencia ocurre la carrera en un teléfono real no se midió |
| RT-03 (P2) | Punto 10: un archivo de 5,003 filas exige reconocer las 3 que quedan fuera | Reconocer, «Elegir otro archivo» de 6,000 filas en la misma pantalla: la casilla seguía marcada para 1,000 filas | `25b0f5f` | `domain/bankImport.ts` (`omissionSignature`), `ui/screens/BankImport.tsx` | `src/domain/retest.test.ts` «RT-03 · …» (2) · `tests/e2e/retest.spec.ts` «RT-03 · …» (un archivo grande lo pide desde el principio; archivo A → B; mismo nombre con otro contenido; cambiar la lectura de la cabecera; selector cancelado; archivo pequeño) | 2 ✘ (casilla marcada e «Importar 5000 movimientos» habilitado sin reconocer) / 1 ✓ (controles) → 3 ✓ | Cancelar el selector conserva la vista previa y su reconocimiento. Importar por partes más de 5,000 filas sigue siendo trabajo futuro |

### Capturas antes / después (412 px)

`docs/screenshots/retest-2026-10-15/{before,after}/` — `before` = `a23b135`, `after` = esta rama.

| Caso | Archivo | Antes | Después |
|---|---|---|---|
| `coffee 10€` en CAD | `rt01-coffee-10-euro.png` | campo «CAD 10.00», «Saldo de tus cuentas: −$10.00»; se guardó como CAD 10 | campo «€10.00» con «El importe está en €; este presupuesto usa CAD. No se convierte.» |
| `coffee GBP 10` en CAD | `rt01-coffee-GBP-10.png` | campo «10.00»; se guardó como CAD 10 con nota «coffee GBP» | campo «10.00 GBP» con el mismo aviso |
| Importar con la escritura retenida, gasto de CAD 9 y «Deshacer» | `rt02-held-import-undo.png` | «Importación deshecha»; tras recargar, sin el gasto | «No se deshizo…»; tras recargar, el gasto sigue |
| Restaurar una copia local, igual | `rt02-held-restore-undo.png` | «Restauración deshecha»; tras recargar, sin el gasto | «No se deshizo…»; tras recargar, el gasto sigue |
| Importar con registro automático y «Deshacer» | `rt02-import-undo.png` | «Importación deshecha»: el recibo registrado solo se borra | «No se deshizo: guardaste cambios después…» y «Ver copias locales» |
| CSV: A reconocido → B de 6,000 filas | `rt03-file-b-after-ack-of-a.png` | «Entiendo que 1000 filas…» marcada, «Importar 5000 movimientos» habilitado | casilla sin marcar, botón deshabilitado |

## Verificación final

Los resultados de la verificación sobre el commit final (check, compilación, tamaño, auditoría de
dependencias y matriz completa de Playwright) están en la descripción del PR: escribirlos aquí cambiaría el
commit verificado.

## Límites y lo que no se verificó

- **Dispositivos reales:** nada se probó en teléfonos físicos, con lector de pantalla (VoiceOver /
  TalkBack), con el tamaño de letra del sistema al 200 % (se simuló), con la instalación sin conexión real
  ni restaurando copias con el selector de archivos del dispositivo. Son condiciones de lanzamiento
  pendientes, no fallos supuestos.
- **Proveedor remoto de IA:** sin endpoint ni secretos reales; las comprobaciones son de forma
  (`docs/RELEASE.md`).
- **Tiempo real del navegador (RT-02):** la carrera se reprodujo en Vitest (IndexedDB simulado con
  escrituras retenidas), en Chromium reteniendo en cola las transacciones de escritura de IndexedDB (un
  retraso artificial, solo en la prueba) y en Chromium sin ningún retraso (la tarea automática de
  programados justo después de importar o restaurar). No se midió con qué frecuencia una persona registra
  algo a mano dentro de esa ventana en un teléfono real ni con un disco lento real.
- **Ventana de guardado:** un cambio se ve antes de que IndexedDB termine de escribirlo (milisegundos). El
  navegador ahora pide confirmación si se cierra o recarga en ese momento; un cierre forzado del sistema en
  esa ventana sigue pudiendo perder el último cambio.

## Hoja de ruta posterior (NO implementada; no bloquea esta versión)

1. **Línea de tiempo explicable por evento:** cada cifra principal reconstruida evento a evento (ingreso,
   pago, ajuste, reserva) con enlace al registro que la mueve.
2. **Proyección a largo plazo controlada por la persona:** horizonte elegido más allá de 400 días, por
   tramos y con la incertidumbre etiquetada (ingresos variables, estimados, programados sin fin).
3. **Importación de archivos grandes con contabilidad completa:** más de 5000 filas por partes, con un
   resumen único de importadas / omitidas / con error y reanudación.
4. **Historial de metas escalable:** búsqueda, filtro por motivo y agrupación por mes para miles de aportes.
5. **Propuesta de arquitectura y seguridad para cualquier conexión en la nube o bancaria:** modelo de
   amenazas, custodia de credenciales, cifrado de extremo a extremo, consentimiento y revocación, auditoría
   independiente. Clara sigue siendo un prototipo local y no anuncia nada de esto como disponible.
