# QA visual · ronda 2 (antes / después)

Capturas generadas con `npm run shots -- --label=<antes|after>` (`tests/visual/screens.spec.ts`),
en los tres tamaños de las pruebas (Pixel 7 412×915, 320×640 y escritorio 1280×800) y los dos temas.
En el repositorio se versionan las de Pixel 7 en ambos temas y unas pocas de 320 px y escritorio; el
resto se regenera con el mismo comando. Cada captura existe en dos versiones: la pantalla visible
(`.png`) y la página completa (`-full.jpg`).

Las guardas de maquetación que acompañan a estas capturas están en `tests/e2e/layout-guards.spec.ts`
(`npm run test:e2e -- layout-guards`). Sobre `c75532b` fallaban B1, B2, B3, B10, C1, C2 y C3 en los
tres tamaños; al cerrar la ronda deben pasar todas.

Rutas: `docs/screenshots/before/` y `docs/screenshots/after/`, archivo `<proyecto>-<tema>-<pantalla>.png`.

| Pantalla | Antes (Pixel 7, oscuro) | Después | Qué cambió |
|---|---|---|---|
| Bienvenida | `before/celular-dark-bienvenida.png` | `after/celular-dark-bienvenida.png` | Insignia «Prototipo local» solo aquí, en Cuenta y Acerca (C4). |
| Categorías (configuración) | `before/celular-dark-setup-categorias.png` | `after/celular-dark-setup-categorias.png` | Fichas verticales con icono de 40 px y nombre en hasta 3 líneas sin partir palabras (B1). |
| Inicio (primer uso) | `before/celular-dark-inicio-primer-uso.png` | `after/celular-dark-inicio-primer-uso.png` | La cifra «Puedes gastar» es la primera tarjeta; el primer uso es una línea bajo ella (C1); sin botón flotante (B3). |
| Inicio (demo) | `before/celular-dark-inicio-demo.png` | `after/celular-dark-inicio-demo.png` | Avatar en la cabecera (C4); héroe compacto con INGRESOS/GASTOS y «Disponible · N %» (D2), línea «por día», «¿Me alcanza?» + «¿Cómo se calculó?»; primer aviso en la primera pantalla; vista esencial por defecto (C1). |
| Hoja «¿Qué quieres registrar?» | `before/celular-dark-hoja-agregar.png` | `after/celular-dark-hoja-agregar.png` | Única entrada para registrar, desde la pestaña «+» (B3). |
| Formulario de movimiento | `before/celular-dark-formulario-movimiento.png` | `after/celular-dark-formulario-movimiento.png` | Sin cambios de maquetación en este bloque (D5/D6 pendientes). |
| Asistente (vista previa) | `before/celular-dark-asistente-vista-previa.png` | `after/celular-dark-asistente-vista-previa.png` | Sin cambios de maquetación en este bloque. |
| Movimientos | `before/celular-dark-movimientos.png` | `after/celular-dark-movimientos.png` | Búsqueda + «Filtros» en una fila, resumen del mes plegado, menú «⋯», sin botón «Agregar» (C2); tres filas en la primera pantalla. |
| Plan › Planes | `before/celular-dark-plan-planes.png` | `after/celular-dark-plan-planes.png` | «Nuevo plan» en la página en vez del botón flotante (B3); abre en la última pestaña (B11). |
| Plan › Calendario | `before/celular-dark-plan-calendario.png` | `after/celular-dark-plan-calendario.png` | Pestañas sin recorte a 320 px (B10). |
| Plan › Metas | `before/celular-dark-plan-metas.png` | `after/celular-dark-plan-metas.png` | Pestañas sin recorte a 320 px (B10). |
| Plan › Periodos | `before/celular-dark-plan-periodos.png` | `after/celular-dark-plan-periodos.png` | Pestañas sin recorte a 320 px (B10). |
| Plan › Proyección | `before/celular-dark-plan-proyeccion.png` | `after/celular-dark-plan-proyeccion.png` | Pestañas sin recorte a 320 px (B10). |
| Estadísticas | `before/celular-dark-estadisticas.png` | `after/celular-dark-estadisticas.png` | Se abre desde el enlace del héroe o el menú «⋯» de Movimientos (C1/C2). |
| Ajustes (índice) | `before/celular-dark-ajustes.png` | `after/celular-dark-ajustes.png` | Índice agrupado (icono, título, valor, flecha), cuenta y Pro como filas, búsqueda (C3); ≈ 2 pantallas. |
| Ajustes › Categorías | `before/celular-dark-ajustes-categorias.png` | `after/celular-dark-ajustes-categorias.png` | Botones de cada fila en una segunda línea en pantallas estrechas; nombres sin partir (B1). |
| Ajustes › Copia de seguridad | `before/celular-dark-ajustes-copia.png` | `after/celular-dark-ajustes-copia.png` | Subpantalla propia con vuelta al índice (C3). |
| Ajustes › Notificaciones | `before/celular-dark-ajustes-notificaciones.png` | `after/celular-dark-ajustes-notificaciones.png` | Subpantalla propia; el enlace antiguo `?seccion=notificaciones` redirige (B6/C3). |
| Cuenta | `before/celular-dark-cuenta.png` | `after/celular-dark-cuenta.png` | Avatar de la cabecera la abre (D3). |
| Pro | `before/celular-dark-pro.png` | `after/celular-dark-pro.png` | Fila «Descubrir Pro» en el índice de Ajustes (C3). |

## Hallazgos del «antes» (medidos por las guardas)

- **B1** · Categorías partidas a media palabra en la configuración inicial, en los cuatro idiomas y
  en los tres tamaños («Teléfon|o», «Mascot|as», «Combu|stible», «Inversio|nes», «Cuidad|o person|al»).
- **B2** · El botón flotante «Agregar movimiento» tapa, en algún punto del desplazamiento,
  «¿Cómo se calculó?», «¿Me alcanza?», «Marcar pagado…», «Marcar recibido…», «Actualizar saldo» y
  hasta la fila «Agregar movimiento» de su propia hoja; en Planes tapa una meta y «Nuevo plan».
- **B3** · Tres controles «Agregar» en Inicio (pestaña, botón flotante y botón del héroe).
- **B10** · Selectores recortados en Movimientos ya a 412 px («Realizados y previstos»,
  «Todas las categorías») y en Ajustes a 320 px.
- **C1** · En el primer uso la primera tarjeta es «Tu primer movimiento», no la cifra principal; la
  demo no muestra ingresos/gastos en la primera pantalla y ocupa más de 3 pantallas.
- **C2** · En Movimientos el cuadro de búsqueda queda a 1013 px (segunda pantalla) y no se ve
  ninguna fila sin desplazarse.
- **C3** · Ajustes es una sola página de más de 12 pantallas; `/ajustes/<id>` no existe.

## Resultado del «después» (medido por las mismas guardas)

Las guardas pasan en los tres tamaños (`npm run test:e2e -- layout-guards`). Medidas en Pixel 7 (412×915,
primera pantalla = 764 px por encima de la barra inferior):

- **Inicio (demo)**: héroe de 457 px (cabecera, cifra, horizonte, INGRESOS/GASTOS, «Disponible · 6 %»,
  «Por día $22.79», «¿Me alcanza?» + «¿Cómo se calculó?»); el primer aviso termina en 743 px. Vista
  esencial 1,6 pantallas; completa 2,1 (a 320 px: 2,4 y 2,9).
- **Movimientos**: título, búsqueda + «Filtros», resumen del mes plegado (50 px) y la línea de resultados
  antes de 343 px; tres filas visibles (la tercera termina en 759 px). A 320 px cabe la primera fila.
- **Ajustes**: índice de 2,1 pantallas (cuenta y Pro como filas, cuatro grupos de 22 filas); a 320 px, 2,8.
  Cada subpantalla probada (copia, notificaciones, cuentas, programados) queda por debajo de 4.
- **Categorías**: los nombres ya no se parten (los botones de cada fila bajan a una segunda línea).

Lo que la guarda no exige a 320 × 640 queda anotado en DECISIONS 83 (primer aviso, ≥ 1 fila, ≤ 3 pantallas).

## Ronda 3 (antes / después)

Las capturas «después» de esta ronda salen de la prueba «ronda 3» de `tests/visual/screens.spec.ts`
(`npm run shots -- --label=after`). El «antes» es la captura de la ronda 2 de la misma pantalla cuando
existe; los estados nuevos (hoja abierta, periodo anterior) no tenían captura previa.

| Pantalla / estado | Antes (Pixel 7, oscuro) | Después | Qué cambió |
|---|---|---|---|
| Asistente con tres líneas pegadas (F1) | `before/celular-dark-asistente-vista-previa.png` | `after/celular-dark-asistente-tres-lineas.png` | El campo es un `<textarea>` de 4–10 filas; tres líneas dan tres filas en la vista previa; Ctrl/Cmd+Enter analiza. |
| Plan › Planes a 320 px en francés (F3) | `before/celular-pequeno-dark-plan-planes.png` (español) | `after/celular-pequeno-dark-plan-planes-fr.png` | Las tarjetas no fijan ancho mínimo: el valor de la barra se parte en dos líneas y no hay desplazamiento horizontal en ningún idioma (guarda en cuatro idiomas). |
| Inicio › periodo anterior (D1) | `before/celular-dark-inicio-demo.png` | `after/celular-dark-inicio-periodo-anterior.png` | ‹ › en la cabecera del héroe; aviso ámbar «Estás viendo otro periodo» con «Volver al periodo actual»; el resto de Inicio se oculta. |
| Selector de categoría (D5) | `before/celular-dark-formulario-movimiento.png` (`<select>`) | `after/celular-dark-selector-categoria.png` | Hoja con búsqueda, «Recientes», grupos con color e iconos y «+ Nueva categoría». |
| Hoja de filtros (D4) | `before/celular-dark-movimientos.png` | `after/celular-dark-filtros-hoja.png` | Varias categorías y etiquetas, importe mínimo/máximo y origen del registro; las fichas activas resumen el filtro. |
| Plan › Metas con gráfico (D7) | `before/celular-dark-plan-metas.png` | `after/celular-dark-plan-metas-grafico-full.jpg` | Curva de lo apartado frente a la recta ideal, marca de «hoy» y fecha estimada bajo la meta. |

## Pulido visual (12 de octubre de 2026, antes / después)

Capturas de `npm run shots -- --label=v3-before` sobre `main` (`d4827de`) y `--label=v3-after` sobre la
rama del pulido (decisión 141), con los mismos datos de demostración, fecha (28-sep-2026), idioma, tema y
tamaños. En el repositorio quedan las de Pixel 7 en ambos temas (`docs/screenshots/v3-before/` y
`v3-after/`); el resto se regenera con el mismo comando. Las guardas (`layout-guards`, `layout-a11y`)
pasan en los tres tamaños antes y después; ninguna cifra cambia.

| Pantalla | Antes (Pixel 7, oscuro) | Después | Qué cambió |
|---|---|---|---|
| Inicio (demo) | `v3-before/celular-dark-inicio-demo.png` | `v3-after/celular-dark-inicio-demo.png` | Botones «¿Me alcanza?» y «¿Cómo?» a 12 px (las tarjetas siguen a 16); la cifra aparece ya con su valor final, sin conteo. |
| Inicio (primer uso) | `v3-before/celular-dark-inicio-primer-uso.png` | `v3-after/celular-dark-inicio-primer-uso.png` | Mismo radio de control en botones y chips de acción; nada se oculta. |
| Hoja «¿Qué quieres registrar?» | `v3-before/celular-dark-hoja-agregar.png` | `v3-after/celular-dark-hoja-agregar.png` | Sombra `lg` de la hoja con valor propio del tema oscuro. |
| Formulario de movimiento | `v3-before/celular-dark-formulario-movimiento.png` | `v3-after/celular-dark-formulario-movimiento.png` | Campos y opciones segmentadas con radio 12 y borde `--border-input` (3,7:1 en oscuro, 3,6:1 en claro; antes 2,3:1 y 2,6:1). |
| Asistente (vista previa) | `v3-before/celular-dark-asistente-vista-previa.png` | `v3-after/celular-dark-asistente-vista-previa.png` | Idem campos; botones a 12 px. |
| Movimientos | `v3-before/celular-dark-movimientos.png` | `v3-after/celular-dark-movimientos.png` | Pestañas 12/10 anidadas (antes 14/10); la búsqueda sigue en píldora, ahora por el token `pill`. |
| Plan › Proyección | `v3-before/celular-dark-plan-proyeccion.png` | `v3-after/celular-dark-plan-proyeccion.png` | Globo del gráfico con sombra `md` (antes sin sombra en oscuro); trazos con extremos redondeados. |
| Estadísticas | `v3-before/celular-dark-estadisticas.png` | `v3-after/celular-dark-estadisticas.png` | «Periodo anterior» con trazo discontinuo y extremos redondeados; barras y leyendas con la escala `mark`/`xs`. |
| Ajustes (índice) | `v3-before/celular-dark-ajustes.png` | `v3-after/celular-dark-ajustes.png` | Iconos de fila a 10 px (escala `sm`); interruptores en píldora. |
| Categorías (configuración) | `v3-before/celular-dark-setup-categorias.png` | `v3-after/celular-dark-setup-categorias.png` | Botones a 12 px; fichas sin cambios. |

Las mismas pantallas en tema claro: `celular-light-*.png` en las dos carpetas.

## Ronda «Lukas como referencia» (12 de octubre de 2026, antes / después)

Capturas de `npm run shots -- --label=v4-before` sobre `15756ef` (final de la auditoría del 12-oct) y
`--label=v4-after` sobre la rama `feat/pulido-lukas-benchmark`, con los mismos datos de demostración, fecha
(28-sep-2026), idioma, tema y tamaños. En el repositorio quedan las de Pixel 7 en ambos temas de las
pantallas que cambiaron (`docs/screenshots/v4-before/` y `v4-after/`). Las guardas pasan antes y después; las
cifras no cambian (`tests/e2e/lukas-round.spec.ts` las comprueba con la demo).

| Pantalla | Antes (Pixel 7, oscuro) | Después | Qué cambió |
|---|---|---|---|
| Inicio (demo, esencial) | `v4-before/celular-dark-inicio-demo.png` | `v4-after/celular-dark-inicio-demo.png` | Línea «En cuentas $901.57 · Reservado −$764.79» bajo la cifra; franja «Próximos pagos e ingresos» con dos ítems y «2 más en el calendario». |
| Inicio (primer uso) | `v4-before/celular-dark-inicio-primer-uso.png` | `v4-after/celular-dark-inicio-primer-uso.png` | Misma línea de composición; sin pagos programados no hay franja. |
| Plan › Metas | `v4-before/celular-dark-plan-metas.png` | `v4-after/celular-dark-plan-metas.png` | Arco de progreso con el porcentaje en el centro en lugar de la barra; mismas cifras. |
| Formulario de movimiento (edición, demo) | — (sin captura previa de la edición) | `v4-after/celular-dark-movimiento-detalle.png` | Resumen del movimiento (importe con moneda, fecha, categoría, cuenta, origen, recurrencia y alcance). |
| Formulario con posible duplicado | — | `v4-after/celular-dark-movimiento-duplicado.png` | Aviso ámbar con el existente y «Ver el existente»; Guardar sigue activo. |
| Formulario con sugerencia de vínculo | — | `v4-after/celular-dark-movimiento-vinculo.png` | «¿Es el pago programado «Renta de habitación» del 1 oct?» con «Sí, vincularlo» / «No, es otro». |

Las mismas pantallas en tema claro: `celular-light-*.png` en las dos carpetas.

A 320 × 640 (`celular-pequeno`) la suite completa encontró dos cosas que las capturas de Pixel 7 no mostraban: la insignia
«programado · frecuencia» del resumen del movimiento desbordaba la pantalla (347 px) y la vista esencial de la demo subía a
2,77 pantallas. Las insignias del resumen se parten, la franja de próximos pagos lleva el título corto y el enlace en la
misma fila, y la línea «En cuentas · Reservado» cabe en una sola línea; la guarda C1 queda en ≤ 2,75 pantallas a 320 px
para la vista esencial (decisión 146).
