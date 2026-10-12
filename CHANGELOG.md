# Registro de cambios

Todos los cambios importantes de Clara se anotan aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones siguen
[SemVer](https://semver.org/lang/es/). Los detalles y los porqués están en `docs/DECISIONS.md`.

## [Sin publicar]

### Novedades

- **Inicio** (ronda «Lukas como referencia», `docs/BENCHMARK-LUKAS.md`): bajo la cifra principal, «En cuentas», «Reservado»
  y, si difiere, «Base del periodo»; en la vista esencial, una franja con los dos próximos pagos o ingresos; las metas
  muestran un arco de progreso en Inicio y en Plan › Metas.
- **Registro**: aviso de posible duplicado antes de guardar (con el existente a la vista; no bloquea) y, si el importe
  coincide con un pago programado abierto, «¿Es el pago programado «X»?» con «Sí, vincularlo» / «No, es otro».
- **Detalle del movimiento**: al editar, un resumen con importe y moneda, fecha, categoría, cuenta, origen, recurrencia y
  el alcance de la edición cuando viene del calendario (solo este movimiento; enlace al programado).
- **Historial**: al volver de un detalle se conservan los filtros, la búsqueda, las filas mostradas y la posición.
- **Copia de seguridad por la hoja Compartir**: en el iPhone (y donde el navegador lo permita),
  «Exportar copia» abre Compartir para **Guardar en Archivos**; cancelar no es un error.
- **Ajustes › Instalar Clara**: explica solo lo que ese navegador permite (botón de instalar, los pasos
  de Safari o «ya está instalada») y avisa de que la app instalada del iPhone empieza vacía.
- **«Protege tus datos»** en Inicio: pide al navegador que no borre los datos y propone la primera
  copia.
- **Restaurar una copia desde la bienvenida**, también cifrada: para estrenar otro dispositivo o la
  app instalada sin inventar una configuración.
- **Enlaces de Atajos de iPhone**: `#/movimientos/nuevo?importe=12,50&comercio=Starbucks&source=shortcut`
  rellena el formulario y sugiere la categoría; nunca guarda solo. Origen «Atajo» en los filtros.
- **«Pegar del atajo»** en la hoja «+»: lee lo que copió un atajo (tras un toque) y abre la vista
  previa del asistente. Ajustes › **Atajos** explica los dos caminos (portapapeles y enlace) y copia las plantillas.
- **Ajustes › Enviar comentarios**: un correo con datos técnicos (versión, navegador, pantalla) que
  ves entero antes de enviarlo.
- **Ajustes › Acerca de › Informe de errores**: los últimos 20 fallos en este dispositivo, sin
  importes, notas, comercios ni nombres, con «Copiar informe» y «Borrar informe».

### Cambios

- **Pulido visual** (auditoría 2026-10-12): una sola escala de radios (botones y campos a 12 px, tarjetas a 16,
  píldoras solo en chips e insignias), tres niveles de sombra con valores propios del tema oscuro, movimiento
  entre 120 y 220 ms, bordes de campo con contraste 3:1 en ambos temas, extremos redondeados y trazo
  discontinuo para «periodo anterior» en los gráficos. La cifra principal muestra el importe final de inmediato
  (antes contaba durante medio segundo). Sin cambios de maquetación ni de cálculo.
- **Importar CSV**: una fila que parece el pago de una tarjeta («PAGO TARJETA VISA» en el banco, «PAYMENT -
  THANK YOU» en la tarjeta) se señala y queda desmarcada, con la explicación de que se registra como
  transferencia para no contar la compra y el pago como dos gastos.
- **Periodo «quincenal»** se llama ahora «Quincena del calendario (1–15 y 16–fin)» y un aviso explica que no
  es lo mismo que cobrar «cada 2 semanas»; las frecuencias de programados y metas dicen «Cada 2 semanas».
- Ejemplos breves en «Ya incluido en el saldo» y en «Los apartados son virtuales»; la copia exportada se
  distingue de las copias locales y «Borrar todos los datos» dice qué se conserva.
- El CSV del historial tiene una columna final **«Origen»** (Manual, Asistente, Importado, Programado, Favorito o Atajo).
- La versión se publica en Cloudflare Pages desde GitHub Actions: cada PR pasa comprobaciones,
  pruebas en tres tamaños y un presupuesto de tamaño, y obtiene un despliegue de prueba con pruebas
  rápidas (`docs/RELEASE.md`). Volver atrás solo si el esquema de datos es el mismo (`docs/ROLLBACK.md`).

### Correcciones

Auditoría externa del 9–10 de octubre de 2026 (`docs/AUDIT-2026-10-10.md`; sus pruebas viven en `qa/` y
forman parte de `npm run check`):

- **Moneda (QA-01):** ya no se puede cambiar la moneda con importes guardados, tampoco con solo un saldo de
  referencia: CAD 2 000 no se convertía en JPY 200 000 sin que nadie lo decidiera. Con saldo en cero sí.
- **Registro automático (QA-02):** tras un cobro parcial, el programado con «registrar solo cuando venza»
  registra únicamente lo que falta (400 recibidos de 1 000 → 600, no 1 000 más). Si ya hubiera datos con
  ese exceso, la Bandeja de pendientes lo señala; no se corrige nada solo.
- **Sin arrastre (QA-03):** «Puedes gastar» nunca supera el saldo real: con deuda previa de −500 e ingreso de
  1 000, la base es 500, no 1 000. «¿Cómo se calculó?» muestra el saldo real y cuándo limitó la base.
- **Inicio en otro periodo (QA-04):** un apartado hecho en septiembre ya no reduce el disponible de agosto;
  la pancarta dice qué parte de la reconstrucción usa los ajustes actuales.
- **Importar CSV (QA-05):** una fila en otra moneda («USD 100.00», «12,50 €») es un error y no se importa
  como si fuera la del presupuesto; moneda del archivo y columna de moneda; aviso de cuánto cambiará el saldo.
- **Programados antiguos (QA-06):** un pago diario desde 2020 con 2 000 ocurrencias pagadas ya no pierde
  los vencidos ni el pago de hoy; si algún recorrido no se puede completar, Inicio lo dice.
- **Exportar CSV (QA-07):** una nota que empiece por `=`, `+`, `-`, `@` o tabulador sale como texto
  (con apóstrofo) y la hoja de cálculo no la ejecuta; los importes siguen siendo números.
- **Copias cifradas (QA-08):** un archivo con parámetros imposibles (iteraciones desmesuradas, sal o IV
  mal formados, versión desconocida) se rechaza al instante, antes de derivar la clave, con un mensaje
  propio distinto de «frase incorrecta».
- **Textos (UX-01):** la sección «Puedes gastar» se llama como la cifra de Inicio en cada idioma (ya no
  «Safe to spend» en español, portugués y francés) y el nombre de la moneda sigue al idioma, no al formato
  numérico.
- **Compilación (R-01):** `npm run build` falla si `VITE_AI_KEY` tiene forma de clave secreta de un
  proveedor de IA o `VITE_AI_ENDPOINT` apunta directo a uno: nada que empiece por `VITE_` es secreto
  (`docs/RELEASE.md`). La beta no configura ningún proveedor.
- Sin conexión: la app abre aunque el servidor añada `Vary: Origin` a sus archivos.
- Fichas de categoría de la configuración repartidas según el ancho real: ninguna palabra se parte ni se
  sale; sin guiones automáticos en las pestañas. En francés, «Aides publiques».
- Contraste suficiente en el botón secundario de la guía al pasar el puntero.

Auditoría del 11–12 de octubre de 2026 (`docs/AUDIT-2026-10-12.md`):

- **Resumen de la configuración (UX-02):** con periodo mensual y sin fecha de ingreso, el resumen decía
  «se usa un periodo de 14 días» mientras calculaba con los 21 días que quedaban del mes. Ahora explica el
  horizonte que de verdad usó (el periodo y su último día, o los días elegidos y su fecha final), el paso
  «Tu próximo ingreso» solo pide un número de días con «hasta mi próximo ingreso» y ese valor no se guarda
  si no se pidió. Las cifras no cambian.

## [1.0.0-beta.1] — primera beta pública

Clara es un prototipo local de finanzas personales: tus datos viven solo en este navegador, sin
cuentas, sin servidor, sin conexión con el banco y sin IA. Esta beta reúne tres rondas de trabajo.

### Novedades

- **«Puedes gastar»**: lo que queda hasta tu próximo ingreso después de reservar pagos y apartados,
  con «¿Cómo se calculó?», ingresos y gastos del periodo y un resumen por día.
- **Navegar periodos** en Inicio con ‹ ›: los periodos pasados se ven al cierre y en solo lectura.
- **Registrar** desde una sola entrada (la pestaña «+»): gasto, ingreso, transferencia, devolución,
  favoritos, plantillas y el asistente que entiende «café 4.50» o varias líneas pegadas.
- **Repetir** un movimiento al guardarlo crea su programado sin contarlo dos veces.
- **Selector de categoría** con búsqueda, recientes, grupos y alta rápida, el mismo en toda la app.
- **Historial** con búsqueda, filtros combinables (categorías, etiquetas, importe y origen), acciones
  en lote con «Deshacer», deslizar para eliminar o editar, papelera y exportación CSV.
- **Plan**: límites por categoría con alertas, metas con gráfico y fecha estimada, gastos
  planificados, calendario de pagos, presupuestos por periodo, proyección a 30 días y escenarios.
- **Estadísticas** por periodo con comparación, gráficos accesibles con tabla y exportación a PDF.
- **Ajustes** por secciones con búsqueda: cuentas y tarjetas de crédito, categorías, reglas,
  etiquetas, copias locales automáticas, copia cifrada con contraseña, bloqueo con PIN, idioma
  (español, inglés, portugués y francés), moneda y formato, modo privado y tema claro u oscuro.
- **Sin conexión**: la app funciona sin internet una vez abierta y avisa cuando hay una versión nueva.
- **Datos guardados en IndexedDB**, con migración probada desde las versiones anteriores y una copia
  de los datos originales antes de migrar.

### Correcciones

- Pegar varias líneas en el asistente ya no pierde movimientos; una coma entre dígitos
  («rent 1,450») nunca parte un importe.
- Plan sin desplazamiento horizontal a 320 px en los cuatro idiomas; avisos en el idioma elegido.
- «Transferencia a ahorros» se sugiere como transferencia y nunca como gasto; un importe
  desproporcionado pide confirmación una vez.
- Agrupar los miles al escribir nunca cambia el importe; un texto inválido muestra su error.
- Las hojas se cierran con Esc o deslizando y devuelven el foco; con «reducir movimiento» no hay
  animaciones.
- Dos pestañas (o dos versiones) ya no se sobrescriben en silencio, y un fallo al guardar se avisa
  sin perder lo último guardado.

### Conocido

- Los datos están solo en este navegador: si se borran los datos del sitio, se pierden. Exporta una
  copia con frecuencia. En iPhone, la app instalada en la pantalla de inicio tiene datos separados de
  Safari.
- No hay sincronización, cuentas, notificaciones del teléfono ni conexión con el banco.
- El dictado y la foto del recibo dependen de lo que ofrezca el navegador; si no hay soporte, se
  escribe a mano.
- Volver a una versión anterior después de una migración de datos no es posible: la versión vieja no
  sabe leer los datos nuevos (ver `docs/ROLLBACK.md`).
