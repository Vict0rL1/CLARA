# Estabilización de la versión candidata (auditoría posterior 2026-10-12/13)

Rama `fix/release-stabilization-2026-10` sobre el candidato auditado `e7c9d87`
(`feat/etapa3-flujo-presupuestos`); PR en borrador Vict0rL1/CLARA#14. Nada se ha fusionado, desplegado
ni activado; no se usó ningún dato financiero real ni ningún servicio remoto: solo la demostración y
datos sintéticos.

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
| AS-01 | `afa94d7` | `domain/parser.ts`, `review.ts`, `assistant.ts`, `aiProvider.ts`, `ui/screens/Assistant.tsx`, `ProposalReview.tsx` | 4 unitarias · «AS-01 · café USD 10…» y «…la misma moneda sigue funcionando» | ✘ (se guardaba como CAD 10) → ✓; la de misma moneda pasa en ambos (guarda) | Nunca convierte: quien escribe otra moneda debe corregir el importe |
| FIN-01 | `f006343` | `domain/operations.ts` (`saveTransaction`) | 4 unitarias · «FIN-01 · vincular un pago del día del saldo…» | ✘ (patrimonio $1,258.77 tras vincular) → ✓ | — |
| FIN-02/03 | `3090218` | `domain/plans.ts`, `ui/screens/Plans.tsx` | 5 unitarias (varias renovaciones, máximo) · «FIN-02 · bajar un límite por debajo de lo arrastrado…» | ✘ → ✓; todo resultado valida con `validateAppData` | Datos ya guardados con base negativa se renuevan con base válida (prueba incluida) |
| REC-01 | `b4f39ff` | `state/replaceUndo.ts`, `ui/screens/Settings.tsx`, `settings/BackupsSection.tsx`, `ui/useAutoBackup.ts` | `src/state/replaceUndo.test.ts` (3) · 3 de navegador (importar, restaurar, sin cambios) | ✘ ✘ (el registro desaparecía) → ✓ ✓; «sin cambios… sí vuelve» pasa en ambos (guarda) | Si se niega, lo anterior está en la copia local «Antes de restaurar» |
| REC-02 | `c6d5e1b` | `storage/backup.ts`, `domain/backupReminder.ts` | 3 unitarias · «REC-02 · una copia con exportedAt inválido…» | ✘ → ✓ | Datos ya guardados por `e7c9d87` con `verifiedExportedAt` inválido entran por la recuperación de datos dañados existente; no se reescriben en silencio |
| 6 | `d661f43` | `domain/history.ts` (`sameValue`) | 3 unitarias · «6 · un gasto recién guardado se puede revertir…» | ✘ (sin «Revertir» tras recargar) → ✓ | — |
| 7 | `27c38ec` | `domain/rules.ts` (`rankRuleMatches`), `parser.ts`, `review.ts`, `ProposalReview.tsx`, `Assistant.tsx`; `stage2-review.spec.ts` actualizado | 5 unitarias · «7 · con uber y uber eats…» | ✘ (5/5 unitarias; navegador elegía transporte) → ✓ | Lo disponible exacto se simula en el asistente; en la importación CSV la fila muestra el efecto en el saldo |
| 8 | `bf79860` | `domain/analysis.ts`, `reconcileSchedules.ts`, `ui/chartScale.ts`, `components/statsCharts.tsx` | 5 unitarias · «8 · con más devoluciones que gastos…» | ✘ (4/5 unitarias; barra con altura −72) → ✓ | — |
| 9 | `7384eb7` | `domain/projection.ts` (`dayBalance`), `ui/screens/Calendar.tsx` | 1 unitaria · «9 · un día más allá de los 400 días…» | ✘ («$4,154.95» para el 20-nov-2027) → ✓ | El límite sigue siendo 400 días: más allá se dice que no hay cifra |
| 10 | `f7f780e` | `domain/bankImport.ts`, `ui/screens/BankImport.tsx`, `docs/FORMULAS.md`, `CLAUDE.md` | 5 unitarias (colisión, repetir/reordenar/solapar, huellas antiguas, referencia del banco, > 5000 filas) · «10 · CSV…» | ✘ (4/5; la de repetir/reordenar/solapar es guarda y pasa en ambos) → ✓ | Archivos de más de 5000 filas se importan por partes (reconociéndolo); ver hoja de ruta |
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
