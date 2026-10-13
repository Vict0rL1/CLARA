# Lukas como referencia: matriz de comparación (12 de octubre de 2026)

**Producto comparado:** «Lukas - Control de gastos» (Google Play: paquete `com.jhotech.smartspend`, título
también «Lukas: AI Expense Tracker»; App Store: id 6758321769), del desarrollador Jhossept Kevin Garay
Rodriguez. No se confunde con «Lukis», «LucasApp», «lukapp» ni otros.

**Cómo se leyó la fuente.** Este entorno no puede abrir `play.google.com` ni `apps.apple.com` (resolución
de nombres bloqueada por la política de red), así que las fichas se leyeron a través de resultados de
búsqueda web del 12-oct-2026 que resumen esas dos páginas (Play Store actualizada el 28-ago-2026; App Store
con historial de versiones hasta la 0.17.11 del 27-sep). Todo lo atribuido a Lukas es **anunciado en su
ficha**: nada se probó de forma independiente (no se instaló la app ni se midió nada en ella). Donde el
resumen no mencionaba algo (Face ID, exportación, widgets, accesibilidad), se dice «no consta», no «no
existe». No se copia su marca, sus recursos ni sus pantallas: la referencia sirve para contrastar
capacidades y decidir qué merece la pena en Clara, con un diseño propio.

**Lo que Clara es:** una PWA local (React, sin backend, sin cuentas, sin banco, sin IA remota activada),
en es/en/pt/fr. Las afirmaciones sobre Clara remiten a código y pruebas del repositorio.

Estado: ✅ cubierto · 🟡 parcial · ❌ no existe · 🚫 fuera del alcance de una app web (se explica). «Hecho
ahora» = en esta ronda (rama `feat/pulido-lukas-benchmark`).

## 1. Registro de movimientos

| Capacidad | Lukas (fuente · plataforma · anunciado/probado) | Clara hoy | Brecha real | Propuesta | Criterio de aceptación |
|---|---|---|---|---|---|
| Texto en lenguaje natural → movimiento | Play + App Store · anunciado | ✅ Analizador local (`domain/parser.ts`, 81 casos), vista previa editable, registro todo o nada, nada se guarda sin importe (`assistant.spec.ts`) | Ninguna funcional; Lukas usa IA remota, Clara reglas locales (sin cuota ni red) | Mantener; el proveedor remoto solo con servicio propio (R-01) | Existente |
| «Editar lo detectado antes de guardar; aprende de las ediciones» | App Store (0.17.x) · anunciado | ✅ Vista previa editable; aprendizaje comercio → categoría (`parser.ts`, `suggestCategoryForMerchant`) | Ninguna | — | Existente |
| Voz | Play + App Store · anunciado | 🟡 Dictado con Web Speech API cuando el navegador la tiene (Chrome; en Safari/PWA iOS puede no estar) y siempre con escritura manual | Disponibilidad real depende del navegador; no se finge | Documentado en Ajustes › Asistente (estado visible) | Existente |
| Foto del recibo (OCR) | Play + App Store · anunciado | 🟡 `TextDetector` en el dispositivo si existe (hoy casi solo Chrome/Android); la imagen reducida se adjunta; fallback manual | OCR real en iOS/Firefox no disponible en web | Roadmap: OCR por servicio propio bajo las reglas de R-01 | Roadmap |
| Entradas repetidas en un toque | Play · anunciado («guarda lo que repites y regístralo en un toque») | 🟡 Favoritos rellenan el formulario; **nunca registran solos** (decisión de producto: 2 toques, confirmar) | Un toque extra, deliberado | Mantener (sin registro silencioso) | `favorites.spec.ts` |
| Posible duplicado al registrar | No consta | ✅ **Hecho ahora**: aviso antes de guardar con el existente a la vista; no bloquea (`domain/duplicates.ts`, `lukas-round.spec.ts`) | — | — | Mismo tipo/cuenta/importe a ±3 días → aviso; guardar sigue posible |
| Casar un registro con un pago programado | No consta | ✅ Selector «Vincular con un pago previsto» + **hecho ahora**: sugerencia automática por importe (o categoría y fecha) con «Sí, vincularlo» / «No, es otro»; el disponible no cambia al pagar lo reservado | — | — | 136,78 antes y después de pagar la renta (prueba) |
| Lectura de notificaciones bancarias | App Store (nota superior) · anunciado | 🚫 Una app web no puede leer notificaciones del sistema | Plataforma | Importar CSV (validación completa, duplicados, moneda) | `bank-import.spec.ts` |
| Transferencias, devoluciones, moneda extranjera, fechas inciertas | No consta | ✅ Tipos explícitos; devolución vinculada; moneda distinta = error, nunca se asume (QA-05); fecha «ayer/mañana» en el analizador | — | — | `audit-regressions.spec.ts` |

## 2. Presupuestos, metas y recurrentes

| Capacidad | Lukas | Clara hoy | Brecha | Propuesta | Aceptación |
|---|---|---|---|---|---|
| Límites mensuales por categoría con aviso temprano | App Store · anunciado | ✅ Planes: varias categorías, periodo, recurrente, alertas 80/100 %, cierre automático, resultado (`plans.test.ts`, `plans.spec.ts`) | Ninguna | — | Existente |
| Metas de ahorro | App Store · anunciado | ✅ Metas con apartados virtuales (sin doble reserva), aporte periódico, fecha estimada, gráfico; **hecho ahora**: arco de progreso accesible en Inicio y en Metas | Ninguna | — | `lukas-round.spec.ts` |
| Recurrentes | Play · anunciado | ✅ Programados: una vez, diario, semanal, cada 2 semanas, mensual, trimestral, anual, cada N días; confirmación automática opcional; pausa | — | — | `scheduled-v2.spec.ts` |
| «Dos veces al mes» (0.17.11) | App Store · anunciado | 🟡 Existe la **quincena del calendario** como periodo (1–15 y 16–fin) pero no como frecuencia de un programado (p. ej. 1 y 15) | Real | Roadmap: frecuencia `semimonthly` (dos días fijos; fin de mes corto → último día), con pruebas de ocurrencias y reserva | Ocurrencias el día 1 y 15 (o los dos días elegidos) en `occurrencesBetween`, sin duplicar reservas |
| Convertir un movimiento en recurrente | Play · anunciado | 🟡 Al crear: «Repetir · cada mes» (D6); desde uno ya guardado: duplicar y marcar repetir | Menor | Propuesto: «Repetir» desde el detalle de un movimiento existente | Crea el programado sin duplicar el movimiento original |
| Etiquetas filtrables en historial y estadísticas (0.17.11) | App Store · anunciado | 🟡 Etiquetas en el formulario y filtro del historial; **Estadísticas no filtra por etiqueta** | Real, menor | Propuesto: chip de etiqueta en Estadísticas reutilizando `matchesTxFilter` | Las tres cifras y el donut respetan la etiqueta elegida |

## 3. Perspectivas, historial y detalle

| Capacidad | Lukas | Clara hoy | Brecha | Propuesta | Aceptación |
|---|---|---|---|---|---|
| Resumen principal | Ficha: saldo, presupuestos (sin detalle en el resumen leído) | ✅ «Puedes gastar» con periodo y días; **hecho ahora**: «En cuentas · Reservado (· Base del periodo)» bajo la cifra; por día/semana/periodo; «¿Cómo?» con cada paso (`computeBudget`) | — | — | 901,57 − 764,79 = 136,78 en la demo |
| Próximos pagos | No consta | ✅ Tarjeta en la vista completa; **hecho ahora**: franja de dos ítems en la vista esencial | — | — | Franja con 2 ítems y «N más» |
| Estadísticas | No consta en el resumen leído | ✅ Donut por categoría, barras de 6 periodos, tendencia vs. periodo anterior (trazo discontinuo), top 5, promedio diario, saldo futuro con banda, tablas alternativas | No se afirma superioridad: la ficha de Lukas no detalla sus gráficos | — | `statistics.spec.ts` |
| Historial y búsqueda | Historial con etiquetas (0.17.11) | ✅ Búsqueda sin acentos, filtros (tipo, estado, cuenta, categorías, etiquetas, importe, origen, fechas), selección múltiple, CSV del filtro, deslizar + deshacer, papelera; **hecho ahora**: filtros y posición se conservan al volver de un detalle | — | — | `lukas-round.spec.ts` |
| Detalle del movimiento | No consta | ✅ **Hecho ahora**: resumen con importe y moneda, fecha, categoría, cuenta, origen, recurrencia y alcance de la edición (solo este movimiento; enlace al programado) | — | — | Prueba con «Renta de habitación» |
| Simulación «¿me alcanza?» y plan ante faltante | No consta | ✅ `/alcanza`, escenarios sobre copia, plan ante faltante con palancas | — | — | `shortfall.spec.ts` |

## 4. Diseño visual, accesibilidad y plataforma

| Capacidad | Lukas | Clara hoy | Brecha | Propuesta | Aceptación |
|---|---|---|---|---|---|
| Modo oscuro | App Store · anunciado | ✅ Oscuro, claro y sistema; tokens únicos (decisión 141); capturas en ambos temas | — | — | `theme-nav.spec.ts` |
| Diseño del sistema | — | ✅ Escalas de radio/sombra/movimiento, cifras tabulares, iconos propios; **hecho ahora**: arcos, franja, resumen, estados pulsados y transición de diálogos | — | — | Guardas de maquetación |
| Accesibilidad | No consta | ✅ axe en 3 tamaños y 2 temas en CI, teclado, foco visible, `prefers-reduced-motion`, 320 px sin desplazamiento horizontal, texto ampliable | — | — | `layout-a11y.spec.ts` |
| Idiomas | EN/ES/FR/PT · anunciado | ✅ es/en/pt/fr con prueba de claves completas | — | — | `i18n.test.ts` |
| Monedas | «50+ con tipos de cambio» · anunciado | 🟡 56 monedas, **una por presupuesto, sin conversión** (deliberado: no se inventan tipos de cambio; QA-01/QA-05) | Real | Roadmap: varias monedas con tasas **manuales fechadas** (ROADMAP § C) | Nunca sumar monedas sin convertir; tasa guardada por movimiento |
| Copias y recuperación | «Local primero + sincronización cifrada opcional» · anunciado | 🟡 Local; copia JSON validada, copia cifrada con frase (acotada, QA-08), copias locales automáticas, restaurar desde la bienvenida, `docs/RESTORE.md`; **sin sincronización** | Real (sincronización) | Roadmap Fase 2 (cuentas, conflictos, tombstones, RPO/RTO) | Ver `docs/ROADMAP.md` |
| Seguridad | Sincronización cifrada · anunciado | 🟡 PIN/biometría = barrera de pantalla (no cifrado en reposo; se dice así); CSP estricta; sin secretos en el paquete (R-01) | — | — | `security.spec.ts`, `docs/RELEASE.md` |
| Integraciones de plataforma | Play: acceso rápido con pulsación larga del icono y panel rápido de Android; app iOS | 🟡 PWA instalable con atajos del manifiesto (gasto, ingreso, asistente), Atajos de iPhone por enlace y portapapeles (`docs/IOS-SHORTCUTS.md`); **sin widgets ni lectura de notificaciones** (web) | Plataforma | Roadmap: envoltorio nativo si alguna vez se decide (cuentas de desarrollador) | — |
| Modelo de negocio | Gratis con anuncios y compras; Pro amplía la cuota de IA | ✅ Sin anuncios; Pro explicado sin botones de compra; modo invitado real | — | — | `account-pro.spec.ts` |

## 5. Qué se hizo en esta ronda a partir de la matriz

Hecho ahora (con pruebas): resumen del tablero (en cuentas / reservado / base), franja de próximos pagos en
la vista esencial, arcos de progreso, aviso de duplicado antes de guardar, sugerencia de vínculo con un
pago programado, detalle del movimiento con origen y alcance, filtros y posición del historial conservados,
estados pulsados y transición de diálogos. Propuesto (pequeño, sin arquitectura): «Repetir» desde un
movimiento existente; etiqueta como filtro en Estadísticas. Roadmap (arquitectura o servicios): frecuencia
«dos veces al mes», varias monedas con tasas manuales, OCR por servicio propio, sincronización, envoltorio
nativo.
