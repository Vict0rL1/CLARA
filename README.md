# Clara · prototipo local de finanzas personales

[![CI](https://github.com/Vict0rL1/CLARA/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Vict0rL1/CLARA/actions/workflows/ci.yml)

**Dirección pública (beta):** <https://clara-d3m.pages.dev> — se activa con el primer despliegue a
producción (al fusionar en `main`; ver [Cómo publicar](#cómo-publicar)). Cada PR tiene además su vista
previa en `https://<id>.clara-d3m.pages.dev`.

> **Nombre:** la app se llamaba «Margen». El nombre visible ahora es **Clara** (igual en
> español e inglés). Los identificadores internos conservan el nombre anterior
> (`margen.data.v1` en el navegador, formato de copia `margen-backup`, cachés `margen-…`) para
> que los datos guardados y las copias exportadas antes del cambio sigan funcionando.

Clara ayuda a responder, con tus propios números:

- ¿Cuánto puedo gastar después de reservar mis pagos y ahorros?
- ¿Cómo afecta una compra a mi presupuesto?
- ¿Cuánto debo apartar para alcanzar una meta?
- ¿En qué fechas podría quedarme corto de dinero?

Pensado primero para personas con presupuestos ajustados, estudiantes e ingresos
variables, pero útil para cualquiera.

> **Estado: prototipo local.** Funciona solo en tu navegador. No hay cuentas de usuario,
> ni servidor, ni conexión con bancos, ni IA. Los datos se guardan en este navegador
> (IndexedDB; `localStorage` si no hay): **si borras los datos del navegador se pierden** y
> **no se sincronizan entre dispositivos**. Usa *Ajustes → Copias de seguridad* para exportarlos
> y [`docs/RESTORE.md`](docs/RESTORE.md) para llevarlos a otro dispositivo.

---

## 1. Requisitos

- **Node.js 22.12 o superior** (recomendado: la versión LTS 22 o 24).
  Descárgalo de <https://nodejs.org> e instálalo con las opciones por defecto.
- **npm** (se instala junto con Node.js).
- Un navegador moderno (Chrome, Edge, Firefox o Safari recientes).

Para comprobarlo, abre una terminal (en Windows: «Símbolo del sistema» o «PowerShell»;
en Mac: «Terminal») y escribe:

```bash
node --version
npm --version
```

`node --version` debe mostrar `v22.12.0` o superior.

> **Copia solo las líneas de comandos.** No copies textos que empiecen con `#`:
> en la terminal de Mac no se ignoran y causan errores como `Invalid tag name "#"`.

No hace falta ninguna cuenta, clave ni archivo `.env`.

## 2. Descargar e instalar (solo la primera vez)

Descarga el proyecto desde GitHub (necesitas `git`; en Mac, si no lo tienes, el sistema
te ofrecerá instalarlo la primera vez que lo uses):

```bash
cd ~/Desktop
git clone https://github.com/Vict0rL1/ALCANZA.git
cd ALCANZA
npm install
```

Esto crea la carpeta `ALCANZA` en tu Escritorio. **Todos los comandos siguientes deben
ejecutarse dentro de esa carpeta.** Si abres una terminal nueva, entra primero con
`cd ~/Desktop/ALCANZA`. Si ves `Could not read package.json`, es que no estás dentro
de la carpeta del proyecto.

## 3. Abrir la aplicación

```bash
npm run dev
```

La terminal mostrará una dirección como `http://localhost:5173/`. Ábrela en el navegador.
Para detener la app, vuelve a la terminal y pulsa `Ctrl + C`.

### Probarla en tu celular (misma red Wi-Fi)

Recomendado: la **versión compilada**, que es la que se probaría con usuarios.

1. Conecta la computadora y el celular a la **misma red Wi-Fi** (no una red de invitados que
   aísle dispositivos).
2. En la carpeta del proyecto ejecuta:

   ```bash
   npm run build
   npm run preview -- --host
   ```

3. La terminal muestra una dirección «Network», por ejemplo `http://192.168.1.20:4173/`.
   Escríbela tal cual en Safari (iPhone) o Chrome (Android). Si no carga, revisa que el
   cortafuegos de la computadora permita conexiones entrantes al puerto 4173.
4. En el celular elige «Explorar con datos de demostración» o configura con **datos
   ficticios**. Los datos del celular son independientes de los de la computadora.
5. Para terminar: en la computadora pulsa `Ctrl + C`. Para borrar los datos del celular:
   *Ajustes › Demostración y reinicio › Borrar todos los datos*.

Limitaciones de esta forma de probar: por `http://` y una IP el navegador **no activa el
uso sin conexión ni la instalación como app** (exigen https o `localhost`), y Safari puede
borrar los datos del sitio tras unos 7 días sin abrirlo. Para probar eso hace falta
publicarla con https (decisión pendiente, ver `docs/ROADMAP.md`). La lista de
comprobaciones manuales para iPhone y Android está en `docs/USER_TESTING.md` §8.

Para desarrollo (recarga al guardar archivos, sin service worker): `npm run dev -- --host`
(puerto 5173).

### Versión optimizada (como quedaría publicada)

```bash
npm run build
npm run preview
```

`build` genera la carpeta `dist/` y `preview` la sirve en `http://localhost:4173/`.

## 4. Cómo usarla

1. **Primera vez:** elige «Configurar con mis datos» (moneda, saldo de hoy, próximo
   ingreso, pagos pendientes y reserva) o «Explorar con datos de demostración».
2. **Inicio:** cuánto puedes gastar hasta tu próximo ingreso, por día y por semana,
   en qué se va tu saldo, avisos y próximos pagos. Un acceso compacto abre la **bandeja de
   pendientes**: movimientos sin categoría, pagos sin confirmar, posibles duplicados,
   saldos por verificar, tarjetas cerca del límite, metas vencidas y revisiones de coherencia, cada uno con su motivo, un acceso para
   resolverlo y opciones de posponer o descartar. Pulsa «¿Cómo se calculó?» para ver
   la cuenta completa: saldo usado por cuenta, pagos comprometidos (y cuáles son estimados),
   apartados, deuda de tarjetas, el supuesto del próximo ingreso e **información pendiente**.
   **¿Qué cambió?** compara el disponible de hoy con el de ayer (u otra fecha) y lo desglosa
   por cada cambio registrado y por el paso del tiempo; el desglose suma exactamente la
   diferencia y, si algo no se puede explicar, lo dice. Con el **icono de candado** («Ocultar
   importes») activas el modo privado. En Ajustes › Inicio y privacidad eliges vista completa o
   esencial, el orden de las secciones (con botones) y hasta 3 accesos rápidos.
3. **Movimientos:** registra gastos, ingresos, transferencias y devoluciones
   (realizados o previstos). El formulario es corto (tipo, importe, cuenta, categoría; el
   resto en «Más detalles»), recuerda la última cuenta usada, propone categorías recientes y
   tiene «Guardar y agregar otro» y «Duplicar como borrador». Si sales a medias, el borrador
   se conserva en el dispositivo para recuperarlo o descartarlo. Atajos de escritorio: `N`
   (nuevo), `/` (buscar), `Ctrl/Cmd + Intro` (guardar). **Plantillas** (Movimientos ›
   Plantillas) con importes fijos o porcentajes para dividir compras y distribuir ingresos:
   solo rellenan el formulario, con una regla de redondeo explícita. Busca, filtra (también por rango de fechas) y edita. **Eliminar envía a la Papelera**
   (enlace arriba en Movimientos): ahí ves la fecha de eliminación y los detalles, puedes
   restaurar incluso después de cerrar la app, o eliminar definitivamente (uno o todos,
   con confirmación). «Deshacer» sigue funcionando como acceso rápido.
   **Favoritos**: plantillas de gastos o ingresos frecuentes («Añadir a favoritos» en el
   formulario, o desde Movimientos › Favoritos). Aparecen como botones en Inicio y en el
   formulario; abren el formulario con la fecha de hoy y tú confirmas. Nunca guardan nada
   solos.
   **Dividir entre categorías**: una compra (por ejemplo, $120 en el súper) puede repartirse
   en líneas (supermercado, hogar, ropa) que deben sumar exactamente el total. Sigue siendo
   un solo movimiento para el saldo; los reportes y límites usan las líneas. Una devolución
   de esa compra se reparte entre sus categorías. Si ya dividiste una compra del mismo
   comercio, se propone «Dividir como la última vez» con la misma proporción.
   **Distribuir este ingreso** (en un ingreso recibido): propone cuánto apartar para pagos
   próximos y metas, muestra el antes y después y solo aplica al confirmar. El saldo no
   cambia; se puede deshacer si es coherente.
   Arriba verás el resumen del mes: ingresos, gasto neto, gasto por categoría y límites
   mensuales opcionales por categoría. Con «Importar CSV» cargas el historial que
   descargas de la web de tu banco: revisas cada fila (nuevas, posibles duplicados, ya
   importadas, con error) y nada se guarda hasta confirmar. Importar el mismo archivo
   dos veces no duplica nada, y se puede deshacer. Las **reglas de categoría** (en
   Ajustes) ponen la categoría sola según la descripción: «si contiene *walmart* →
   Supermercado».
4. **¿Me alcanza?:** escribe un precio y compara antes y después. No guarda nada hasta
   que pulses «Registrar esta compra» y luego «Guardar». **Comparar escenarios** guarda
   simulaciones con nombre (comprar hoy o en otra fecha, subir un pago mensual, reducir un
   gasto previsto, o un ingreso hipotético que solo cambia la proyección) y compara hasta 3 con tu situación actual con las mismas hipótesis.
   Nunca cambian tus datos; si tus datos reales cambian, el escenario se marca para revisar.
   **Plan ante un faltante**: si el saldo proyectado baja de cero, muestra cuándo, cuánto,
   qué lo causa y qué ingresos se suponen, y simula palancas (mover o reducir compras
   previstas, cambiar supuestos de ingresos o del gasto diario). Los pagos programados nunca
   se tocan. Solo se aplican cambios de planificación, con confirmación y deshacer.
   **Revisión semanal** (tarjeta en Inicio, se puede ocultar): ingresos, gastos, balance,
   categorías principales, comparación con la semana anterior, próximos pagos y metas.
   **Buscar** (lupa arriba a la derecha): encuentra movimientos, cuentas, categorías,
   metas, pagos, periodos y favoritos sin importar acentos ni mayúsculas.
5. **Plan:** calendario de pagos (marcar pagado, omitir), metas (apartar/liberar) y
   proyección de 30 días. **Gastos planificados** (en Metas): matrícula, seguro o
   renovaciones con fecha, repetición opcional y vínculo con un pago del calendario;
   «Confirmar aporte» aparta dinero y «Pagar» registra el gasto real y libera lo apartado
   en un paso (decides qué hacer con el sobrante). **Periodos**: presupuestos para un
   semestre, un viaje o un periodo propio; asocias gastos (también al registrarlos) y ves
   gastado, restante y cuánto por día o semana. Una regla opcional por categorías propone
   el periodo al registrar un gasto (puedes desmarcarlo). Asignar no mueve dinero; «Reservar
   dinero» es opcional y explica su efecto. Un ingreso puede ser **variable** (mínimo, esperado y extra):
   la proyección permite elegir el escenario (por defecto el mínimo) y compararlos, sin
   cambiar tu disponible ni tus movimientos. Si recibes solo una parte, eliges si esperas
   el resto o das la previsión por terminada.
6. **Verificar saldo** (botón en Inicio): escribe el saldo que ves en tu banco o en tu
   efectivo y su fecha; Clara lo compara con su cálculo para esa fecha. Si hay
   diferencia, revisa los movimientos cercanos, añade el que falta o crea un **ajuste**
   explícito con motivo (corrige el saldo, pero no cuenta como ingreso ni gasto). Queda
   un historial, y si cambias movimientos de un periodo ya verificado se marca
   «pendiente de revisión».
7. **Ajustes:** idioma, formato de números y fechas, zona horaria, cuentas (y tarjetas con
   límite, tasa y fechas), categorías personalizadas, reglas de categoría, copia de seguridad,
   reinicio de la demo y borrado de datos. **Historial de cambios** (Ajustes › Datos y recuperación):
   qué cambió, cuándo y los valores anteriores; puedes revertir un cambio si nada lo modificó
   después. Es local y editable, no una auditoría inviolable.

### Copias de seguridad (importante)

Guardar en el navegador **no es una copia de seguridad**: si se borran los datos del sitio
o cambias de dispositivo, se pierden. En Ajustes › Copia de seguridad:

- **Exportar copia** descarga un archivo. La app registra que *pidió* la descarga, pero el
  navegador no le dice dónde se guardó; por eso lo muestra así.
- **Verificar una copia**: eliges el archivo que guardaste y la app comprueba que se puede
  leer y que es de este presupuesto (no importa nada).
- **Recordatorio** semanal (por defecto), mensual o desactivado. Aparece solo en Inicio
  cuando hay datos nuevos sin respaldar, y se puede posponer 7 días.

La demostración muestra un aviso morado permanente: **todos sus datos son ficticios**.

## 5. Pruebas

### Pruebas de la lógica financiera (rápidas)

```bash
npm test
```

Comprueban redondeos, saldos negativos, ingreso retrasado, devolución parcial,
transferencias, pagos recurrentes marcados como realizados, reservas que no se
descuentan dos veces, guardado repetido y recuperación, copias inválidas, cambio de mes
y fechas límite (29/30/31, años bisiestos, zona horaria). También la papelera (vínculos,
transferencias, reimportación), favoritos con referencias rotas, recordatorio de copias
(fechas, posponer, exportación fallida), conciliación (exacta, diferencias, ajustes,
tarjetas, cambios retroactivos), ingresos variables (retrasados, parciales, distintos,
escenarios), gastos planificados (sin doble reserva, pago distinto de lo apartado,
repeticiones y vencidos), presupuestos por periodo (solapados, devoluciones, archivo,
reserva), revisión semanal (base cero, datos faltantes, zona horaria), escenarios
(aislados y recalculados si cambian los datos), búsqueda (acentos, traducciones,
papelera y 10 000 movimientos), compras divididas (centavo exacto, reportes, devoluciones,
papelera, reimportación), bandeja de pendientes (aparecen, se resuelven, se posponen, no se
duplican, falsos positivos de duplicados), distribución de ingresos (sin crear dinero ni
duplicar reservas, ingresos gastados, editados o eliminados, deshacer, fallo de guardado) y
migraciones v1–v6 → v7, 30 casos calculados a mano (`independent.test.ts`) y fallos
controlados de almacenamiento y de dos pestañas (`persistence.test.ts`). También corre la suite de
la auditoría externa de octubre de 2026 (`qa/`: 12 escenarios financieros con oráculos a mano y las
ocho regresiones `QA-01`…`QA-08`, ya corregidas; ver `docs/AUDIT-2026-10-10.md`).

### Pruebas en el navegador (celular 390 px, celular 320 px y escritorio)

La primera vez hay que descargar el navegador de pruebas:

```bash
npx playwright install chromium
```

```bash
npm run test:e2e
```

Recorren los flujos principales (configuración, demo, movimientos, «¿Me alcanza?»,
calendario, metas, proyección, copias de seguridad, papelera, favoritos, recordatorio
de copias, verificación de saldos, ingresos variables, gastos planificados, periodos,
revisión semanal, escenarios y búsqueda, en español e inglés), comprueban que no haya
desplazamiento horizontal (también con texto al 200 %), la navegación con teclado y
una auditoría automática de accesibilidad (axe) en modo claro y oscuro.

**Otros navegadores (opcional).** Firefox y WebKit (el motor de Safari) requieren
descargarlos: `npx playwright install firefox webkit` y después
`PLAYWRIGHT_ALL_BROWSERS=1 npm run test:e2e`. WebKit automatizado en una computadora **no
equivale** a Safari en un iPhone real (teclado, instalación, almacenamiento y gestos
cambian): esa prueba es manual (`docs/USER_TESTING.md` §8).

### Todas las comprobaciones

```bash
npm run check
```

Revisa tipos, estilo de código y pruebas de lógica.

Lo mismo se ejecuta en GitHub en cada PR (la insignia «CI» de arriba muestra el estado de
`main`): ver [`docs/RELEASE.md`](docs/RELEASE.md).

## 6. Comandos disponibles

| Comando | Qué hace |
|---|---|
| `npm run dev` | Abre la app en modo desarrollo (se recarga al guardar cambios) |
| `npm run build` | Comprueba tipos y genera la versión optimizada en `dist/` |
| `npm run preview` | Sirve la versión optimizada |
| `npm test` | Pruebas de lógica (Vitest) |
| `npm run test:e2e` | Pruebas en navegador (Playwright) |
| `npm run test:smoke` | Solo las ~10 pruebas esenciales marcadas `@smoke` (1–2 min) |
| `npm run size` | Tras `npm run build`: falla si el JS inicial crece más de un 10 % (`scripts/size-baseline.json`) |
| `npm run typecheck` | Comprobación de tipos de TypeScript |
| `npm run lint` | Revisión de estilo y errores comunes (oxlint) |
| `node scripts/generate-icons.mjs` | Regenera los iconos PNG de la PWA desde `public/icon.svg` |

### Mapa del código con graphify (opcional)

[graphify](https://github.com/Graphify-Labs/graphify) convierte el código en un grafo de
conocimiento que el asistente de programación (Claude Code) consulta en vez de buscar archivo
por archivo. El código se analiza en local con tree-sitter: no hace falta clave de API y nada
sale del equipo. La habilidad `/graphify` ya está en el repositorio
(`.claude/skills/graphify/`); solo falta instalar la herramienta de línea de comandos:

```bash
uv tool install graphifyy            # o: pipx install graphifyy (el paquete es «graphifyy», con doble y)
graphify extract . --code-only       # grafo del código sin IA (~10 s); o `/graphify .` desde Claude Code
graphify cluster-only . --no-label   # genera GRAPH_REPORT.md y graph.html
graphify query "qué conecta el disponible con las metas"
graphify explain "spendableBaseMinor"
graphify path "AppStore" "DataRepository"
graphify update .                    # tras cambiar código, sin coste de IA
```

El resultado (`graphify-out/`, unos 7 MB que se regeneran en segundos) no se versiona. El grafo se
mantiene al día solo: un gancho `Stop` de Claude Code (`.claude/settings.json`) ejecuta
`graphify update .` en segundo plano al terminar cada respuesta, únicamente si `graphify` está
instalado y ya existe `graphify-out/graph.json`. Para tus propios commits, `graphify hook install`
(una vez por clon) añade ganchos de git que lo reconstruyen tras cada commit y cambio de rama. Para
que el asistente consulte siempre el grafo antes de leer archivos (sección en `CLAUDE.md` y ganchos
`PreToolUse`), ejecuta `graphify claude install --project` y revisa esos archivos antes de
confirmarlos: dan error donde `graphify` no esté instalado.

## 7. Estructura del proyecto

```
src/
  domain/      Lógica financiera pura (dinero, fechas, recurrencias, saldos,
               presupuesto, metas, proyección, validación, operaciones) + pruebas
  storage/     Guardado en el navegador, copias de seguridad y migraciones
  state/       Estado de la app y conexión con el almacenamiento
  ui/          Pantallas, componentes, gráficos y formato
  i18n/        Textos en español (es.ts) e inglés (en.ts)
  demo/        Generador de datos de demostración
tests/e2e/     Pruebas en navegador
docs/          FORMULAS.md (cálculos) y ROADMAP.md (siguientes fases)
public/        Manifiesto PWA e iconos
```

La interfaz, la lógica financiera y el almacenamiento están separados: para añadir un
servidor más adelante basta con otra implementación de `DataRepository`
(`src/storage/repository.ts`), sin tocar fórmulas ni pantallas.

## 8. Qué incluye y qué no

**Incluye:** todo lo descrito arriba, persistencia local, validación de copias,
tarjetas de crédito (la compra es un gasto de la tarjeta y el pago una transferencia),
interfaz en español e inglés (se elige en la bienvenida o en Ajustes),
modo oscuro y diseño desde 320 px hasta escritorio. En la versión compilada
(`npm run build` + `npm run preview`, o publicada con https) la app se guarda en el
dispositivo y **abre sin internet** tras la primera visita; cuando hay una versión nueva
aparece el aviso «Actualizar ahora». Nunca se recarga sola: solo se recarga la pestaña donde
se pulsa, y el botón no aparece con un formulario abierto, durante la configuración ni con
cambios sin guardar (las otras pestañas solo reciben un aviso para recargar después; probado
con dos versiones reales en `tests/e2e/pwa-update.spec.ts`). En modo desarrollo (`npm run dev`) y al abrirla por
IP en la red local no se activa el uso sin conexión (el navegador lo exige así).

**Protección de los datos (lo que hay y lo que no):** los datos están solo en este
navegador (IndexedDB; `localStorage` si no está disponible; ver `docs/STORAGE.md`), **sin cifrar y sin contraseña**: cualquiera que use ese
navegador puede verlos. No hay servidor, cuentas ni envío de datos (la versión compilada
declara una política de seguridad que bloquea scripts y conexiones a otros sitios). El
navegador puede borrar los datos (al limpiar datos del sitio, con poco espacio o, en
Safari, tras ~7 días sin uso si no está instalada); por eso existen las copias exportadas.
Si no se puede guardar, la app lo dice, conserva lo último guardado y ofrece descargar una
copia; dos pestañas abiertas no se sobrescriben entre sí.

**No incluye todavía (y la app no finge tenerlo):** cuentas de usuario, sincronización,
conexión bancaria automática (sí se pueden importar archivos CSV descargados), varias
monedas, notificaciones del teléfono, IA. Ver `docs/ROADMAP.md`.

**Rendimiento:** medido con 1.000, 10.000 y 50.000 movimientos sintéticos en la versión
compilada; cifras, cuellos de botella corregidos y límites en `docs/PERFORMANCE.md`.

## Cómo publicar

Clara se publica en Cloudflare Pages desde GitHub Actions; no hay que compilar ni subir nada a mano:

1. Una sola vez, Victor sigue [`docs/RELEASE.md`](docs/RELEASE.md) › «Lo que tienes que hacer tú»
   (proteger `main`, cuenta y proyecto de Cloudflare, token y secretos).
2. Cada PR recibe una vista previa con su dirección en un comentario, tras pasar todas las pruebas.
3. Al fusionar en `main`, CI publica en producción y comprueba lo publicado con las pruebas rápidas.
4. Durante la beta: la prueba en dispositivos reales ([`docs/DEVICE-TEST.md`](docs/DEVICE-TEST.md)),
   un aviso semanal con la plantilla «Beta: comentario semanal», un aviso «Error» por cada fallo y una
   etiqueta `v1.0.0-beta.N` por cada despliegue a producción (`docs/RELEASE.md` › F).

Volver a una versión anterior tiene una regla: solo con el mismo `SCHEMA_VERSION` (los datos del
navegador pueden haber cambiado de formato). Ver [`docs/ROLLBACK.md`](docs/ROLLBACK.md).

## 9. Solución de problemas

- **`npm: command not found` / `node no se reconoce`:** instala Node.js y abre una
  terminal nueva.
- **`Could not read package.json` / `ENOENT`:** no estás dentro de la carpeta del
  proyecto. Ejecuta `cd ~/Desktop/ALCANZA` (o la ruta donde lo descargaste).
- **`Invalid tag name "#"`:** copiaste un comentario que empieza con `#`. Copia solo el
  comando.
- **La versión de Node es menor que 22.12:** instala la LTS actual desde nodejs.org.
- **El puerto 5173 está ocupado:** Vite usará otro (mira la dirección en la terminal).
- **«No se puede guardar en este navegador»:** el navegador bloquea el almacenamiento
  (por ejemplo, navegación privada estricta). Usa una ventana normal.
- **Quiero empezar de cero:** *Ajustes → Borrar todos los datos* (exporta antes una copia).

Las fórmulas y decisiones financieras están en [`docs/FORMULAS.md`](docs/FORMULAS.md).
