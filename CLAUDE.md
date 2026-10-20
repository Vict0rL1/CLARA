# CLAUDE.md — reglas esenciales de Clara

Clara es un **prototipo local** de finanzas personales (React + TypeScript + Vite).
Sin backend, sin cuentas de usuario, sin conexión bancaria y sin IA dentro del producto.
Interfaz en español, inglés, portugués y francés (`src/i18n/es.ts`, `en.ts`, `pt.ts`, `fr.ts`). Antes se llamaba «Margen»: las
claves internas (`margen.data.v1`, `margen-backup`, cachés `margen-`) NO se renombran.

## Comandos (ejecutar antes de cada commit)

```bash
npm run typecheck      # tsc -b (app, pruebas y config)
npm run lint           # oxlint
npm test               # Vitest: lógica financiera y almacenamiento (incluye qa/, la auditoría de 2026-10)
npm run test:e2e       # Playwright: celular, celular 320 px y escritorio (+ axe)
npm run build
```

En entornos con Chromium preinstalado: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/ruta/a/chrome npm run test:e2e`.

## Arquitectura (no mezclar capas)

- `src/domain/` — **lógica financiera pura**. Sin React, sin `localStorage`, sin `Date.now()`
  implícito: "hoy" y "ahora" llegan como parámetros (`OpContext`). Aquí viven todas las
  fórmulas y validaciones. Toda regla nueva lleva prueba en `*.test.ts`.
- `src/storage/` — persistencia detrás de `DataRepository` (IndexedDB; `localStorage` si no hay),
  copias de seguridad (`backup.ts`), migraciones (`migrations.ts`) y borradores (`drafts.ts`).
- `src/state/` — estado en memoria (`AppStore`) y hooks. Aplica resultados de
  `domain/operations.ts`; no calcula dinero.
- `src/ui/` — pantallas y componentes. Solo muestran y llaman operaciones.
- `src/i18n/` — todos los textos visibles. **Nunca** escribir texto de interfaz
  directamente en componentes: añadir cada clave a `es.ts`, `en.ts`, `pt.ts` **y** `fr.ts`
  (el tipo compartido obliga a tener todas las claves en los cuatro).

## Reglas financieras (ver `docs/FORMULAS.md`)

- Dinero = **enteros en unidades menores**. Prohibido usar flotantes para importes.
  Divisiones con `floorDiv`/`ceilDiv`/`mulDivFloor`/`mulDivCeil`; nunca `importe * k` antes de dividir. Un agregado
  que no cabe en un entero exacto (> 2⁵³ − 1) no se redondea ni se recorta: `checkedSumMinor`/`checkedMulDivFloor`
  devuelven `null` y la pantalla dice que no hay cifra (QA V2, FIN-01: `recurringCosts` → `ok: false`;
  `projectBalance` con `stopWhenOutOfRange` → `outOfRangeFrom`).
- Una moneda por presupuesto; cada registro guarda `currency` y se valida.
- Fechas de calendario (`'AAAA-MM-DD'`) separadas de marcas de tiempo (ISO UTC).
  "Hoy" = `todayInTimeZone(settings.timeZone)`.
- Saldo actual = saldo de referencia + movimientos realizados posteriores
  (`txAppliesToAccount`). Los previstos nunca cambian el saldo.
- Disponible = saldo del presupuesto − pagos pendientes/vencidos hasta el día del próximo
  ingreso (incluido) − apartados de metas del presupuesto − colchón de seguridad
  (`settings.safeToSpend.bufferMinor`, 0 por defecto; no es gasto ni mueve dinero). El día del ingreso NO cuenta
  en los días del periodo. Ingresos futuros nunca se suman. Sin ingreso → horizonte;
  nunca dividir entre cero.
- Una ocurrencia programada está pagada si hay un movimiento realizado con su
  `scheduleId` + `occurrenceDate`: cuenta como reserva **o** como movimiento, nunca ambos.
- Transferencias entre cuentas propias no son ingresos ni gastos.
- Tarjetas de crédito: cuenta `credit` con saldo negativo (deuda). Compra = gasto de la
  tarjeta; pago = **transferencia** banco → tarjeta, nunca un gasto.
- Mensuales en 29/30/31 → último día del mes corto. «Dos veces al mes» (`semimonthly`, v13): día de
  `startDate` + `secondDay` (1–31, a ≥ 7 días); el que no existe pasa al último día del mes.
- Cambiar un programado «desde una fecha» (`domain/scheduleFrom.ts`): el de siempre termina el día antes y
  uno nuevo empieza ese día; lo anterior no cambia. Nunca con un pago registrado (ni parcial) en esa fecha o
  después; los vínculos hacia delante pasan al nuevo solo si esa ocurrencia sigue existiendo. Sin cambiar la regla
  (frecuencia, intervalo, segundo día) y en una fecha de la serie, el tramo nuevo conserva la fecha que fija la serie
  (`anchorDate`, v14; `splitKeepsAnchor`): el 31 sigue siendo el 31 aunque empiece un 28-feb movido y «1 y 20»
  siguen siendo 1 y 20 (PR #15, QA-01). `startDate` es solo el límite desde el que cuenta; las fechas, la validación
  de «dos veces al mes» y la ayuda salen de `anchorOf`. Las particiones hechas ANTES de v14 (sin `anchorDate`) no se
  reescriben al migrar: `domain/splitRepair.ts` (`driftedSplits`) las detecta de forma conservadora (tramo activo sin
  `anchorDate`, antecesor del mismo nombre, tipo y regla que termina el día antes, partido en una fecha de la serie y
  con fechas distintas a las de siempre) y Ajustes › Datos las muestra con fechas actuales y propuestas; reparar
  (`repairSplit`) solo pone `anchorDate`, con confirmación, copia local previa y entrada en el historial; «Dejar como
  está» (`dismissSplitRepair`) es un descarte de la bandeja con huella y nunca cambia fechas.
- Operaciones idempotentes: el id se genera al abrir el formulario; guardar dos veces
  actualiza el mismo registro.
- Importación CSV (`domain/bankImport.ts`): huella `importRef` (referencia del banco o descripción
  COMPLETA; las huellas antiguas de 80 caracteres se siguen reconociendo) evita reimportar; posibles
  duplicados desmarcados; filas con error visibles y nunca importadas; lo marcado se guarda todo o
  nada; más de 5000 filas → cuántas y cuáles quedan fuera, y confirmar exige reconocerlo (solo para ESA
  vista previa: archivo elegido + `omissionSignature`; otro archivo, otro contenido o leer la cabecera de
  otra forma lo piden de nuevo, RT-03); el archivo nunca sale del dispositivo.
- Papelera: eliminar saca el movimiento de `transactions` a `trash` (nunca participa en
  cálculos). Restaurar no deja vínculos rotos ni liquida dos veces una ocurrencia; filas
  CSV en la papelera no se reimportan. Sin borrado automático.
- Ajuste de conciliación = `kind: 'adjustment'`: corrige el saldo, NO es ingreso ni gasto.
  Nunca se crea sin confirmación ni se toca el saldo de referencia al conciliar.
- Ingresos variables: el disponible jamás suma ingresos futuros; la proyección usa el
  escenario mínimo por defecto. Cobros parciales con `partialSettlement`; como mucho una
  liquidación final por ocurrencia.
- Favoritos solo rellenan el formulario; nunca registran movimientos.
- Corregir la categoría que proponía una regla (o la de un movimiento al editarlo, o una línea del asistente)
  solo OFRECE «Recordar» (`suggestRuleFromCorrection` / `suggestRulesFromCorrections`); nunca se crea sin pulsar,
  varias se guardan todo o nada (`saveCategoryRules`) y se puede deshacer.
- Parser del asistente (`domain/parser.ts`): las pruebas pasan por `parseText` (lo que usa el
  asistente), no solo por `parseEntry`; una coma entre dígitos es parte del importe. El asistente
  escribe en un `<textarea>` (una línea por movimiento). Moneda escrita (RT-01): un solo lector en
  `money.ts` (`currencyMarksAround`, `currencyMarksIn`, `stripCurrencyMark`) para códigos delante o
  detrás (también pegados), símbolos, nombres, signos locales con letras («kr», «Ft») e importes en
  palabras; si no es la del presupuesto o
  queda sin resolver, el campo la conserva (`withCurrencyMark`) y la línea no se registra. Nunca se convierte.
  Se leen TODAS las marcas (hasta dos a cada lado del importe y las del resto de la frase) y se unen con
  `reconcileMarks`: un código concreto acota a un símbolo genérico («USD $10» = USD, «$10 CAD» = CAD) y dos que se
  contradicen («USD 10 CAD», «€10 CAD») son `currencyConflict` en todos los consumidores (campos, asistente, CSV,
  atajos, recibos): el campo conserva las dos (`withCurrencyMarks`) y nada se registra (QA V2, CUR-01/02). En texto
  libre la segunda marca de un lado solo cuenta si una de las dos se escribió como código (`TextMark.kind`): «Cafe
  Euro $12» y «Peso $10» son 12 y 10 de la moneda del presupuesto (R4). En un
  recibo, junto al importe que una palabra de total/impuesto/pago ETIQUETA (el primero detrás de la palabra), un código
  cuenta aunque sea palabra («TOTAL PEN 10.00») o ISO no admitido; lo que va antes de la palabra en la misma línea es
  mercancía («PEN 2.99 TAX 0.10» es un bolígrafo) y en líneas de artículo no cuenta (CUR-03; auditoría 2026-10-19,
  P2). Un código pegado al importe también a través de la puntuación acotada de `CODE_BEFORE`/`CODE_AFTER`
  («(RUB) 10», «RUB: 10», «10, RUB», «(RUB) $10», «TOTAL RUB: 10.00») cuenta en todos los lectores (`markBefore`,
  `markAfter`, `prefixMark`, `suffixMark`); más lejos («AMD GPU 500», «(RUB) coffee 10») no, y un ISO no admitido
  nunca cuenta lejos del importe (auditoría 2026-10-19, P1). Reglas de categoría: un solo resolutor
  (`rankRuleMatches`: patrón más largo, a igualdad la más antigua) para asistente, revisión y Ajustes; coincide
  el texto tal cual o la clave de comercio (`domain/merchants.ts`: sin prefijo «SQ *», signos ni códigos de
  referencia), siempre un superconjunto de lo de antes.
  La revisión distingue saldo (solo realizado) de disponible (simulado sobre una copia, nunca deducido).
- Gastos planificados = metas `kind: 'expense'` (`domain/plannedExpenses.ts`): el plan es
  solo sugerencia; solo lo apartado descuenta. Vinculados a una ocurrencia, esa ocurrencia
  no se reserva dos veces (`reserves.ts`). Pagar = gasto real + liberar reserva en una
  operación; si se repite, el siguiente periodo no queda financiado. Si la ocurrencia se paga
  desde el calendario, lo pagado consume lo apartado en el cálculo aunque no se haya cerrado.
- Presupuestos por periodo: asignado ≠ disponible; solo guardan ids (`txIds`); solapados
  cuentan una vez en el total; la reserva opcional es una meta que lo gastado consume.
- Análisis (`domain/analysis.ts`): el porcentaje de gasto a fecha equivalente es `checkedMulDivFloor(diferencia, 100,
  anterior)`; si el cociente no cabe en un entero exacto la señal sale sin `percent` y la pantalla lo dice
  (`insights.*.titleNoFigure`), nunca una cifra inexacta ni una pantalla rota (F-03).
- Límite sugerido (`domain/planSuggestion.ts`): mediana del gasto neto de los últimos 3 ciclos completos con
  datos (≥ 2), redondeada hacia arriba a una unidad; sin IA; «Usar» solo rellena el importe.
- Hitos de metas (`domain/goalMilestones.ts`): 25/50/75/100 % en enteros, solo el más alto y solo 7 días desde
  el apartado que lo cruzó; aviso local bajo «Alertas de planes»; no guarda nada.
- Revisión semanal: lunes–domingo en la zona horaria; comparación equivalente; sin
  porcentaje si la base es 0 o faltan datos; reglas fijas, sin IA ni notificaciones.
- Escenarios: se simulan sobre una copia; nunca modifican datos reales ni se aplican solos.
- Filtros de Estadísticas (`domain/statsFilter.ts`): cuenta, etiqueta y comercio filtran los movimientos y todo se
  calcula igual sobre esa copia; el saldo futuro no se filtra y se dice. Las fechas del periodo personalizado también
  van en la dirección (`desde`/`hasta`) y se conservan al filtrar (STAT-01); la dirección manda: chips, «Hoy» y
  atrás/adelante alinean las fechas escritas con ella y nunca se contradicen (R2).
- Búsqueda: local, sin acentos ni mayúsculas; categorías fijas en el idioma activo;
  papelera solo si se pide.
- Compras divididas (`splits`, `domain/splits.ts`): un solo movimiento; Σ líneas = total
  exacto; saldos usan el movimiento, reportes/límites/búsqueda las líneas. Las reglas de
  categoría nunca pisan una división. Devoluciones repartidas sin superar lo pendiente.
- Bandeja de pendientes (`domain/inbox.ts`): avisos CALCULADOS con ids estables; solo se
  guarda posponer/descartar (con huella). Nunca elimina ni combina duplicados. Las sugerencias de pagos
  fijos (`domain/recurringDetect.ts`: mismo comercio, mismo importe exacto, cadencia regular y activa) solo
  abren el formulario relleno; nunca se programa nada solo y no cuentan como pendientes.
- Distribuir un ingreso (`domain/incomeDistribution.ts`): solo ingresos realizados; crea
  apartados virtuales (metas), nunca dinero ni movimientos; pagos ya reservados no se
  restan dos veces; todo o nada; deshacer solo si es coherente.
- Registro de copias (`backup`): no modifica `updatedAt`. Una exportación fallida no se
  registra; «exportada» ≠ «verificada». La copia sin fotos (`withoutReceipts`) tampoco se registra.
- Historial (`domain/history.ts`): `AppStore.commit` registra antes/después de cada registro
  financiero que cambió (máx. 1000 entradas; desde v14 también plantillas, escenarios y aplazamientos de la
  bandeja, para que revertir una partición no deje referencias colgadas: PR #15, QA-05; posponer o retirar un aviso
  por sí solo no crea entrada y un aplazamiento caducado que ya no está no bloquea revertir ni se resucita, R5). Revertir solo si nada cambió después y validando
  todo; importar/demo = corte `replace`. Es local, no una auditoría inviolable. El id de cada cambio sigue el contrato
  de SU colección (`isValidHistoryChangeId`: `inboxSnoozed` → id de la bandeja, hasta `INBOX_ID_MAX` = 300; el resto
  ≤ 64): lo que se guarda tiene que volver a leerse (F-01). Revertir nunca elimina un programado al que plantillas,
  escenarios, gastos planificados vinculados o aplazamientos seguirían apuntando (`revertDependents`, estado
  `dependents` en `canRevert`, código `revertDependents`): se explica qué registros son y nada cambia (F-02); una
  referencia que ya no resolvía antes no cuenta.
- Deshacer importar/restaurar (`state/replaceUndo.ts`): ligado a la revisión que fija el propio reemplazo
  (`AppStore.commitTracked`, antes de esperar al almacenamiento), nunca a lo último guardado. Cualquier
  cambio posterior —de la persona o automático, aunque su escritura siga pendiente— lo invalida (RT-02).
- «¿Qué cambió?» (`domain/whatChanged.ts`): Σ pasos + tiempo + sin explicar = diferencia, al
  céntimo. Nunca inventa causas ni compara antes del historial o de un corte.
- Plantillas (`domain/templates.ts`): solo rellenan formularios; regla de redondeo explícita;
  nunca superan el total; líneas no disponibles no se aplican. Borradores: texto del formulario,
  fuera de cálculos y copias.
- Plan ante faltante (`domain/shortfall.ts`): palancas simuladas sobre copia; pagos programados
  nunca son palanca; aplicar solo planificación, con confirmación, todo o nada, como `plan` en el
  historial.
- Filtros del historial (`domain/txFilters.ts`): categorías y etiquetas «cualquiera», importe inclusivo en
  unidades menores, origen por marcas del registro. Lote (`domain/bulk.ts`): una operación, todo o nada;
  transferencias, ajustes y divididas no se recategorizan; deshacer restaura por id lo exacto.
- Preferencias de presentación y modo privado (`ui/preferences.ts`): del dispositivo; nunca
  cambian cifras, datos ni exportaciones; el modo privado no es autenticación ni cifrado.
- Auditoría 2026-10 (`docs/AUDIT-2026-10-10.md`, decisiones 129–138): cambiar la moneda solo sin
  ningún importe guardado (`domain/currencyChange.ts`; un saldo ≠ 0 ya es un importe) y nunca se
  convierte. La confirmación automática registra solo el remanente (`PlanItem.amountMinor`). Sin
  arrastre, base = mín(asignación del periodo, saldo real) (`spendableBaseMinor`). La instantánea de
  otro periodo filtra apartados por fecha; programados y ajustes son los actuales y se dice. Importar:
  una moneda escrita distinta de la del presupuesto es error `currency`, nunca se asume
  (`stripCurrencyMark`). Los vencidos se recorren aparte de la ventana (`planItemsDetailed`); un
  recorrido truncado se declara (`incompleteScheduleIds`) y no se sugiere importe por día.

## Interfaz y accesibilidad

- Móvil primero; sin desplazamiento horizontal de 320 px a escritorio; texto ampliable (rem). Con texto al 200 %
  en 320 px tampoco (es/en/pt/fr): la barra inferior pasa a dos filas (`useNavHeightVar` ajusta `--nav-h`),
  pestañas y filas se ajustan, y una palabra que no cabe se parte en vez de salirse.
- Estados siempre con icono + texto, nunca solo color. Contraste AA (claro y oscuro), también en texto SVG
  (axe no lo mide: prueba de contraste calculado). Solo tokens definidos: `themeTokens.test.ts` falla con un `var(--x)` inexistente.
- Cada campo con etiqueta, ayuda y error asociados (`FieldShell`). Botones ≥ 40–44 px.
- Cada cifra principal tiene su explicación ("¿Cómo se calculó?").
- No mostrar botones de funciones que no existen. No simular notificaciones,
  sincronización, autenticación ni integraciones.
- Registrar tiene una sola entrada: la pestaña «+» (celular) o «Agregar» (escritorio) abren la hoja
  `AddSheet`; nada de botones flotantes ni «Agregar» en las pantallas.
- Inicio: la cifra principal es la primera tarjeta; vista «esencial» por defecto para quien empieza;
  lo secundario se pliega en «Más en tu Inicio». Ajustes: cada sección es `/ajustes/<id>` y sale de
  `SETTINGS_SECTIONS` (índice, búsqueda, enlaces antiguos `?seccion=`).
- Guardas de maquetación (`tests/e2e/layout-guards.spec.ts`): palabras partidas, controles recortados,
  solapamientos y lo que cabe en la primera pantalla; corren en los tres tamaños.
- Gráficos: seguir la paleta validada (`--series-*`), etiquetas selectivas, tabla alternativa. Valores con signo
  (`signedScale`): el cero dentro del eje, nunca alturas negativas; gráfico y tabla dicen la misma cifra. Eje X de las
  barras (`ui/components/axisLabels.ts`, `pickAxisLabels`): cada punto ofrece sus formas de etiqueta de la más larga a
  la más corta y se dibuja la más larga que cabe en el hueco (si ninguna cabe, una de cada k y siempre la última); la
  fecha completa sigue en el tooltip, el nombre accesible y la tabla (F-05). «Sin comparación» y cualquier texto
  pequeño sobre tarjeta usan tokens con AA calculado en claro y oscuro (`themeTokens.test.ts`; `--text-muted` no
  llega sobre `--card` en oscuro, F-04).
- Calendario: proyecta hasta `CALENDAR_PROJECTION_MAX_DAYS` (400); más allá no hay cifra (`dayBalance` → `beyond`; fuera del
  rango exacto → `outOfRange`; la simulación usa la misma regla, R3),
  nunca el saldo del último día calculado.
- Categorías: un solo dibujo (`CategoryIcon`) y un solo selector (`CategoryPicker`); nada de `<select>` de
  categoría salvo la tabla de la importación CSV. Listas vacías con `EmptyState` (icono, título y una
  línea de texto, ≤ 1 acción). Explicaciones largas: una frase + «¿Por qué?» (`Why`).
- Movimiento: hojas, avisos y la cifra principal respetan `prefers-reduced-motion`; las hojas se cierran con
  Esc, ✕, fondo o deslizando hacia abajo, y devuelven el foco a quien las abrió.

## Seguridad y datos

- Ningún secreto, clave o credencial en el código, el navegador o los registros.
  No hace falta `.env` en esta fase.
- Restaurar una copia valida TODO el archivo y no aplica nada si hay un error. CSV del banco: cada fila
  con error se muestra con su motivo y no se importa; las filas marcadas se guardan todo o nada.
- Cambios de formato de datos: subir `SCHEMA_VERSION` (hoy 14) y añadir migración con prueba.
  Las migraciones solo rellenan campos ausentes; nunca borran datos mal formados.
- Guardado (`indexedDbRepository.ts`, `localStorageRepository.ts`; ver `docs/STORAGE.md`): nunca sobrescribe lo que otra pestaña u otra
  versión guardó después de leer (error `conflict`); si guardar falla, se avisa de forma
  persistente, se conserva lo último guardado y se ofrece descargar una copia. Nunca se
  muestra «Guardado» si no se guardó ni se reemplazan datos por una demo o un estado vacío.
- Datos de demostración siempre marcados con `isDemo: true`.
- CSV exportado: todo texto libre pasa por `safeText` (apóstrofo ante `=`, `+`, `-`, `@`, tabulador);
  fechas, importes e ids no. Copias cifradas: `validateEnvelope` antes de WebCrypto (versión 1,
  iteraciones 1–2 000 000, tamaños de sal/IV/datos); «no válida» ≠ «frase incorrecta».
- Todo lo que empieza por `VITE_` es público. `VITE_AI_KEY` solo puede ser un token de alcance limitado
  para un servicio propio: `checkRemoteAiConfig` (`domain/aiConfig.ts`) hace fallar la compilación con
  una clave con forma de secreto, un endpoint directo a un proveedor de IA (host sin puntos finales),
  credenciales en la URL o un origen que no esté en `VITE_AI_ALLOWED_ORIGINS` (obligatoria).
- El *service worker* (`pwa/sw.template.js`, generado por `vite.config.ts`) solo cachea
  archivos de la app, nunca datos. Solo se registra en producción y contexto seguro.
  Actualizar solo recarga la pestaña que lo pidió y no se ofrece con un formulario abierto. La versión compilada lleva una CSP
  (`vite.config.ts`): sin scripts ni conexiones a otros sitios.
