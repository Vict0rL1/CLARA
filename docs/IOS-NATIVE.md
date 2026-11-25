# Clara como app nativa de iPhone: guía para compilarla e instalarla

Clara sigue siendo la misma aplicación web (React + TypeScript + Vite). La carpeta `ios/` es una **cáscara nativa**
hecha con [Capacitor](https://capacitorjs.com) 8: un proyecto de Xcode que abre las mismas pantallas dentro de una app.
Existe para lo que una web no puede hacer en el iPhone: guardar sola los pagos con Apple Pay, widgets, Siri y avisos
con la app cerrada. El plan completo está en `docs/NATIVE-PLAN.md`; **esta guía cubre la Fase 1: que Clara abra y
funcione como app**: guarda los datos en un archivo propio, habla de la app y no del navegador, Face ID, vibración,
barra de estado, teclado y copias por la hoja Compartir; y la **Fase 2: los pagos con Apple Pay se anotan solos**
(sección «Fase 2», al final de las comprobaciones). Está pensada para alguien que nunca ha usado Xcode.

> **Estado: sin compilar todavía en un Mac.** El proyecto se generó y se revisó en un entorno sin Xcode, así que nadie
> lo ha compilado ni abierto en un iPhone. Lo que sigue son los pasos para hacerlo y lo que hay que mirar. Nada aquí
> afirma que «funciona en el iPhone» hasta que esa prueba esté hecha.

## Qué cambia y qué no

- **No hay servidor ni cuenta.** Los datos siguen solo en el teléfono.
- **La app empieza vacía.** Sus datos están separados de los de Safari y de la Clara de la pantalla de inicio. Para
  este paso usa los **datos de demostración**; tus datos reales se pasan más adelante con una copia de seguridad
  (exportar en la Clara de siempre, importar en la app).
- **La versión web sigue igual** en su dirección de siempre. La app no la reemplaza.
- Dentro de la app no hay *service worker* (no hace falta: los archivos van dentro de la app) ni avisos de
  «instalar Clara». Las copias y los CSV no se descargan: salen por la **hoja Compartir** de iOS (guardar en
  Archivos o iCloud Drive, enviar).

## Requisitos

- Un Mac con **Xcode 26 o posterior** (lo que pide Capacitor 8). Si tu Xcode es anterior y no compila, dilo: se puede
  bajar a Capacitor 7.
- Node 22 o posterior (`node -v`).
- Un Apple ID. Con una cuenta **gratuita** la app deja de abrir a los **7 días** de instalarla; se arregla
  volviendo a pulsar ▶ en Xcode (los datos se conservan si no borras la app). Para uso diario conviene el programa de
  desarrolladores de pago.

## Antes de empezar: preparar el Mac (una sola vez)

Si ya tienes Xcode, Node y el repositorio en el Mac, salta a «La primera vez».

1. **Xcode.** Ábrelo desde el App Store del Mac e instálalo (ocupa más de 10 GB y tarda). Ábrelo una vez: pide
   instalar «componentes adicionales» y aceptar la licencia; acepta. Para ver la versión: **Xcode › About Xcode**.
2. **Terminal.** Es la app «Terminal» (búscala con ⌘ + espacio). Los comandos de esta guía se pegan ahí y se ejecutan
   con ↩. Si un comando pide la contraseña, es la del Mac (no se ve al escribirla).
3. **Node 22 o posterior.** Descarga el instalador «LTS» de nodejs.org y ábrelo. Comprueba en Terminal:

   ```bash
   node -v
   ```

   Tiene que decir `v22` o un número mayor.
4. **El repositorio.** Si no lo tienes en el Mac:

   ```bash
   cd ~/Documents
   git clone https://github.com/Vict0rL1/CLARA.git
   cd CLARA
   ```

   Si `git` pide usuario y contraseña de GitHub, la contraseña no sirve: hace falta un *token* (GitHub › Settings ›
   Developer settings › Personal access tokens) o la app GitHub Desktop («Clone repository»). Si ya lo tenías,
   entra en su carpeta con `cd` (por ejemplo `cd ~/Documents/CLARA`).

## La primera vez (unos 15 minutos)

1. En el Mac, dentro de la carpeta del repositorio:

   ```bash
   git fetch origin
   git checkout feat/ios-nativo
   npm ci
   npm run ios:sync
   npm run ios:open
   ```

   `npm run ios:sync` compila la web y la copia dentro del proyecto de iOS; `npm run ios:open` abre Xcode. La primera
   vez Xcode descarga el paquete de Capacitor (necesita internet).

2. En Xcode, añade tu Apple ID si no está: **Xcode › Settings › Accounts › +**.
3. En la barra lateral, pulsa el proyecto **App** › destino **App** › pestaña **Signing & Capabilities**:
   - marca **Automatically manage signing**;
   - en **Team**, elige tu nombre (**Personal Team**).
   - El identificador es `com.victorli.clara` (**confírmalo antes de esta primera compilación**: los datos de la app
     cuelgan de él y con una cuenta gratuita cada identificador nuevo gasta uno de los 10 de cada 7 días). Si Xcode
     dice que no está disponible, no pruebes otros: avisa y lo decidimos.
4. Conecta el iPhone con el cable y acepta **Confiar en este ordenador**.
5. En el iPhone, activa el modo de desarrollador: **Ajustes › Privacidad y seguridad › Modo de desarrollador**
   (aparece después de conectar el teléfono a Xcode; pide reiniciar).
6. En Xcode, elige tu iPhone arriba (junto a «App») y pulsa **▶**.
7. La primera vez el iPhone dice que el desarrollador no es de confianza: **Ajustes › General › VPN y gestión de
   dispositivos ›** tu Apple ID **› Confiar**. Vuelve a abrir Clara.

No hace falta subir al repositorio los cambios que Xcode haga al elegir el equipo (`DEVELOPMENT_TEAM` en
`project.pbxproj`); si `git status` los muestra, déjalos sin confirmar.

## Cada vez que haya cambios

```bash
git pull
npm ci          # solo si cambió package-lock.json
npm run ios:sync
```

y ▶ en Xcode. (`npm run ios:sync` = compilar la web + `cap sync ios`; `npm run ios:open` abre Xcode.)

## Qué mirar en este paso

Con los datos de demostración (pantalla de bienvenida › «Explorar con datos de demostración»). Apunta lo que falle y en qué pantalla.

| # | Qué | Cómo | ¿Bien? |
|---|---|---|---|
| 1 | La app abre | Icono de Clara en la pantalla de inicio; pantalla de arranque con el logo; aparece la bienvenida | |
| 2 | Bordes de la pantalla | Nada queda tapado por la isla/muesca ni por la barra inferior del iPhone; la barra de pestañas se ve entera | |
| 3 | Navegar | Inicio, Movimientos, «+», Plan, Análisis, Ajustes; Estadísticas; atrás deslizando desde el borde | |
| 4 | Registrar | «+» › Gasto › importe › Guardar; aparece en Movimientos y cambia la cifra de Inicio | |
| 5 | Se conserva | Cierra la app del todo (deslízala fuera) y ábrela: el gasto sigue | |
| 6 | Sin conexión | Modo avión, cierra y abre: la app abre igual | |
| 7 | Teclado | «+» › Gasto: al escribir el importe y la nota, el campo y el botón Guardar no quedan tapados por el teclado | |
| 8 | Exportar copia | Ajustes › Copias de seguridad › «Exportar copia»: sale la hoja Compartir; «Guardar en Archivos» › elige una carpeta › Guardar. Abre la app Archivos: el archivo `clara-…-copia-….json` está ahí. Si cierras la hoja sin elegir, Clara no la cuenta como exportada | |
| 9 | Importar copia | Ajustes › Copias de seguridad › «Importar copia»: se abre Archivos; elige ese archivo (o uno exportado desde la Clara de Safari) y confirma: los datos entran. Cierra la app del todo y ábrela: siguen ahí | |
| 10 | Cámara | «+» › Asistente › foto de un recibo: pide permiso de cámara y no se cierra la app | |
| 11 | Tema y barra de estado | Con Clara en «Oscuro» (lo predeterminado) y el iPhone en claro, la hora y la batería de arriba se leen (texto claro). Ajustes › Formato › «Claro»: pasan a texto oscuro. Con «Sistema», siguen al iPhone | |
| 12 | Textos de Legal | Ajustes › Legal › Privacidad: el texto aparece (se pide como archivo aparte) | |
| 13 | Habla de la app, no del navegador | En Ajustes no existe «Instalar Clara»: en su lugar está «Clara en este iPhone» (dónde están los datos, cómo traerlos de la web, cómo se actualiza, los 7 días). En Inicio no sale la tarjeta de instalar. Ajustes › Datos y recuperación › «Almacenamiento y privacidad» dice «solo en este iPhone, dentro de la app Clara» y no ofrece «Pedir al navegador que conserve los datos» | |
| 14 | Guarda en su archivo propio | Ajustes › Datos y recuperación: la primera fila dice «Guardado en este iPhone, en un archivo propio de la app». Si habla de IndexedDB o avisa de que no pudo usar su archivo, dilo | |
| 15 | Aguanta un reinicio | Registra 3 movimientos, cierra la app del todo, **reinicia el iPhone** y abre: siguen ahí | |
| 16 | Aguanta una reinstalación | Con esos movimientos guardados, pulsa ▶ en Xcode otra vez (instala encima, **sin** eliminar la app del iPhone) y abre: siguen ahí. La app lo afirma en «Clara en este iPhone»; si no fuera así, dilo antes de guardar datos reales | |
| 17 | Face ID | Ajustes › Bloqueo: activa «Pedir PIN al abrir», elige un PIN y toca «Usar Face ID o Touch ID». iOS pregunta si Clara puede usar Face ID: acepta. Cierra la app del todo y ábrela: pide Face ID y entra; si cancelas, se puede entrar con el PIN | |
| 18 | Vibración | Guarda un gasto: el iPhone da un toque suave. Con Ajustes del iPhone › Accesibilidad › Movimiento › «Reducir movimiento» activado, no vibra | |
| 19 | Otros archivos | Movimientos › exportar CSV y Ajustes › Exportar: sale la hoja Compartir con el `.csv`. Estadísticas › «Exportar PDF»: apunta qué pasa (puede que nada) | |

### Si la pantalla se queda en blanco

Es el fallo más probable de este paso (la política de seguridad de contenido de Clara es estricta y aquí la página se
sirve desde `capacitor://localhost`, cosa que no se ha podido probar sin un iPhone). Para ver el motivo:

1. En el iPhone: **Ajustes › Apps › Safari › Avanzado › Inspector web** activado.
2. En el Mac, con la app abierta en el iPhone: **Safari › Desarrollo ›** tu iPhone **› localhost**. (Si no ves el
   menú Desarrollo: Safari › Ajustes › Avanzado › «Mostrar funciones para desarrolladores web».)
3. Copia lo que salga en rojo en la pestaña **Consola**.

## Fase 2: los pagos con Apple Pay se anotan solos

Rama `feat/ios-fase-2` (PR #19). Antes, las 19 comprobaciones de la Fase 1. Una automatización de Atajos ejecuta la
acción **«Registrar pago en Clara»** después de cada pago; la acción solo lo anota en una cola dentro de la app y Clara
lo lee al abrirse. Nada sale del iPhone y Clara no se conecta al banco.

> **Estado: escrito, sin compilar.** La acción y la cola están escritas en Swift contra la documentación de Apple; lo
> web (leer la cola, revisar, Ajustes) está probado en el navegador con un iPhone simulado. Los nombres exactos de los
> menús de Atajos no se pudieron comprobar desde aquí: apunta los que veas.

### 1. Probar el Swift sin el iPhone (2 minutos)

```bash
git checkout feat/ios-fase-2
git pull
cd ios/ClaraNativeTests
swift test
cd ../..
```

Debe terminar con «Executed 13 tests, with 0 failures» (la cola de capturas, también con dos escrituras a la vez, y el
archivo de datos; 15 desde la Fase 4). Si algo falla,
copia la salida tal cual.

### 2. Compilar e instalar

```bash
npm ci
npm run ios:sync
```

y ▶ en Xcode. Si Xcode marca un error en `RecordPaymentIntent.swift`, `ClaraCaptureQueue.swift`,
`ClaraCapturesPlugin.swift` o en `Localizable.xcstrings`/`AppShortcuts.xcstrings`, copia el mensaje tal cual. No hace
falta añadir ningún «Capability» (el App Group no se usa todavía; con cuenta gratuita no se puede activar).

### 3. Preparar Clara

Para probar con pagos, Clara necesita **tus datos o un presupuesto nuevo**: con los datos de demostración no se
importa nada (los pagos esperan en la cola). Abre Clara una vez después de instalar: así iOS conoce la acción.

### 4. Crear la automatización

1. App **Atajos** › **Automatización** › crear una automatización nueva.
2. Elige el disparador de **Wallet** para transacciones (pagos con tus tarjetas) y marca tus tarjetas.
3. Elige que se ejecute **sin pedir confirmación**.
4. Añade la acción: busca «Clara» › **«Registrar pago en Clara»**. En **Importe**, la variable del importe de la
   transacción; en **Comercio**, el comercio; en **Tarjeta** (opcional), la tarjeta.
5. Guarda.

### 5. Qué mirar

| # | Qué | Cómo | ¿Bien? |
|---|---|---|---|
| 20 | La acción existe | Atajos › buscar «Clara»: aparece «Registrar pago en Clara», en el idioma del iPhone | |
| 21 | Probar | Ajustes › **Captura automática** › «Probar ahora»: dice «Funciona» y en Pendientes › Por revisar hay una «Prueba» que no cambia ninguna cifra. Descártala | |
| 22 | La acción a mano | En Atajos, ejecuta «Registrar pago en Clara» con importe 1 y comercio «Prueba»: responde «Clara: 1,00 $ en Prueba, por revisar» (o parecido). Abre Clara: hay un gasto de 1,00 «Por revisar» que ya resta | |
| 23 | Pago real | Paga algo pequeño con Apple Pay. ¿Se ejecutó la automatización sola? Abre Clara: el gasto está «Por revisar» con importe, comercio, fecha y cuenta correctos | |
| 24 | Con Clara abierta | Con Clara en pantalla, ejecuta la acción desde Atajos (o desde el Centro de control): al volver, el gasto ya está | |
| 25 | Revisar | En Pendientes: «Está bien» quita la marca; «Editar» y Guardar también; «Fue rechazado» lo manda a la papelera y la cifra vuelve | |
| 26 | Dos veces el mismo pago | Ejecuta la acción dos veces seguidas con el mismo importe y comercio: el segundo queda como propuesta «puede ser el mismo pago», no resta dos veces | |
| 27 | Otra moneda | Ejecuta la acción con un importe en USD (o paga en otra moneda): queda como propuesta y pide el importe en tu moneda | |
| 28 | Tarjeta nueva | Con dos cuentas o más: el primer pago de una tarjeta pregunta en Pendientes «Tarjeta nueva: …» a qué cuenta va. Elige una: ese pago pasa a esa cuenta y el siguiente entra ahí solo (también se puede cambiar en Ajustes › Captura automática) | |
| 29 | Apagado | Apaga «Guardar automáticamente»: el siguiente pago queda como propuesta y no cambia ninguna cifra hasta «Registrar» | |
| 30 | Copias locales en la app | Ajustes › Copias locales › «Hacer copia ahora»: aparece en la lista. Cierra la app del todo y ábrela: sigue ahí, y el PIN (si lo activaste) se sigue pidiendo | |

Apunta también: qué variables ofrece el disparador de Wallet (y cómo se llaman), si «Importe» encajó directamente en
el campo de la acción o hubo que pasarlo como texto, y qué dice Siri con «Registrar un pago en Clara».

## Fase 3: varias monedas y modo viaje

Rama `feat/ios-fase-3` (PR #20, sobre la Fase 2). Todo es web (formulario, viajes, Estadísticas, CSV, capturas
convertidas): no hay Swift nuevo, así que basta con volver a compilar.

> **Estado: escrito y probado en el navegador con un iPhone simulado (y el Banco de Canadá simulado); sin probar en el
> iPhone.** Las comprobaciones 31–39 son con el Banco de Canadá **apagado** (como viene); las 40–45, encendido.

```bash
git checkout feat/ios-fase-3
git pull
npm ci
npm run ios:sync
```

y ▶ en Xcode. Las cifras de abajo están calculadas a mano (una sola vez al céntimo más cercano).

| # | Qué | Cómo | ¿Bien? |
|---|---|---|---|
| 31 | Crear un viaje | Plan › Periodos › nuevo › «Viaje», con fechas que incluyan hoy. Enciende «Modo viaje», añade JPY, KRW y CNY con las tasas 0.0092, 0.00098 y 0.1923 y comisión 0. Guarda: el detalle dice las tres tasas | |
| 32 | Yen, won y yuan | Desde «+», con «Pagado en otra moneda»: ¥1 200 (la tasa del viaje sale sola), luego KRW 15 000 y CNY 88.30. Cada uno dice su cuenta: 11,04 $, 14,70 $ y 16,98 $ | |
| 33 | Total del viaje | En el detalle del viaje: «Total en CAD: 42,72 $», una línea por moneda con el importe original y el convertido | |
| 34 | Comisión | Edita el viaje: comisión 2.5. Un gasto nuevo de ¥1 200 da 11,32 $; los de antes no cambian | |
| 35 | Cargo real | Edita el gasto de ¥1 200 › «Con lo que cobró el banco» › 11.17: se guarda 11,17 $ y la tasa sale «≈ 0.009308» | |
| 36 | Captura en yenes | En Atajos, ejecuta «Registrar pago en Clara» con un importe en **JPY** (1 200): al abrir Clara está «Por revisar», convertido con la tasa del viaje y dentro del viaje | |
| 37 | Sin tasa | Igual con un importe en USD (no es moneda del viaje), con el Banco de Canadá apagado: queda como propuesta; «Registrar» con lo que cobró el banco guarda los dos importes | |
| 38 | «¥» suelto | En el detalle del viaje, «Ahora estás en» › CNY; ejecuta la acción con el importe como texto «¥88.30»: se lee como yuan. Con «Ninguna», queda como propuesta | |
| 39 | Estadísticas y CSV | Estadísticas › «Gastado por moneda» con las tres monedas; Movimientos › Más › Exportar CSV: cada gasto en otra moneda tiene su importe original, la moneda y la tasa | |

Apunta si el campo de importe de la acción ofreció elegir la moneda (JPY) o si hubo que usar «Importe como texto».

### Tasas del Banco de Canadá (decisión 181)

Opcional y apagado por defecto. Encendido, Clara pide al Banco de Canadá (www.bankofcanada.ca) solo la moneda y dos
fechas; nada tuyo. La tasa es **indicativa**: la del último día hábil publicado hasta la fecha del gasto (el banco
publica hacia las 16:30 de Ottawa; hoy, antes de esa hora, sale la del día hábil anterior). Lo que se comprobó de la
API está en `docs/BOC-VALET.md`. Las cifras dependen de la tasa del día: compruébalas con la que enseña Clara
(importe × tasa, un solo redondeo al céntimo).

| # | Qué | Cómo | ¿Bien? |
|---|---|---|---|
| 40 | Encenderlo | Ajustes › Formato › «Tasas del Banco de Canadá» › «Pedir tasas al Banco de Canadá». Lee la explicación (qué se envía, indicativa, fuente) | |
| 41 | Formulario | Termina el viaje de la 31 (o usa una moneda sin tasa del viaje, p. ej. USD). «+» › «Pagado en otra moneda» › USD 25.00 › «Usar la tasa del Banco de Canadá»: el campo de la tasa se llena, la fecha de la tasa es un día hábil ≤ hoy y debajo dice «Tasa indicativa del Banco de Canadá del <fecha>». Guarda: el importe en CAD es 25 × tasa | |
| 42 | La misma en la web del banco | Abre en Safari https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/ («Daily exchange rates», comprobada el 16-nov) y mira USD/CAD de esa fecha: es la misma cifra | |
| 43 | Sin conexión | Modo avión. Repite la 41: dice «No se pudo conectar con el Banco de Canadá: no hay tasa» y sin tasa no deja guardar | |
| 44 | Captura en otra moneda | Con conexión y sin tasa del viaje para esa moneda, ejecuta la acción con un importe en **USD** (12.50): al abrir Clara está «Por revisar» y dice «Convertido con la tasa indicativa del Banco de Canadá del <fecha>» | |
| 45 | Captura sin conexión | En modo avión, otra captura en USD: queda como propuesta. Quita el modo avión, en Pendientes «Pedir la tasa del Banco de Canadá» › «Registrar con esta tasa» | |

Si en la 41 o la 44 Clara dice que no pudo conectar aunque haya conexión, apúntalo: dentro de la app la petición la
hace el WebView (origen `capacitor://localhost`); el banco responde `Access-Control-Allow-Origin: *`, pero eso solo se
ha comprobado con `curl`, no en el iPhone.

## Fase 4: pagos sin Apple Pay y registrar en un toque

Rama `feat/ios-fase-4`. Tres cosas nuevas, todas **escritas y sin compilar**:

- **«Registrar desde texto en Clara»:** una automatización de Atajos con el disparador «Mensaje» le pasa el SMS de
  aviso de tu banco. Clara lo lee al abrirse. Mientras no conozca el formato de tu banco (hace falta que me pases
  ejemplos reales), cada aviso queda en Pendientes › Por revisar como **propuesta**: no cuenta hasta que la registres,
  con su texto y un importe sugerido si el texto trae uno solo con su moneda. El texto se borra en cuanto registras,
  descartas o confirmas el pago (ni el historial ni la papelera lo guardan).
- **«Nuevo gasto en Clara»:** abre el formulario de un gasto. Para el botón de Acción, «Tocar atrás» y Siri. No guarda
  nada hasta que tocas Guardar.
- **Control «Nuevo gasto»** para el Centro de control y la pantalla bloqueada: opcional y aparte, porque hay que crear
  una extensión en Xcode (abajo). No lo hagas hasta que la app compile y funcione.

> **Estado: escrito, sin compilar.** Lo web está probado en el navegador con un iPhone simulado. Los nombres de los
> menús de Atajos y de Ajustes de iOS no se pudieron comprobar desde aquí (support.apple.com no es accesible desde este
> entorno): apunta los que veas.

### 1. Probar el Swift sin el iPhone

```bash
git checkout feat/ios-fase-4
git pull
cd ios/ClaraNativeTests
swift test
cd ../..
```

Debe terminar con «Executed 15 tests, with 0 failures» (dos nuevas: una línea con solo el texto del aviso y el recorte
a 2 000 caracteres sin partir un emoji).

### 2. Compilar e instalar

```bash
npm ci
npm run ios:sync
npm run ios:open
```

y ▶ en Xcode. Xcode puede avisar de que `openAppWhenRun` está obsoleto en iOS 26: es un aviso, no un error (en iOS 18,
el mínimo de Clara, todavía no existe lo que lo sustituye).

### 3. Qué mirar

| # | Qué | Cómo | ¿Bien? |
|---|---|---|---|
| 46 | Las pruebas Swift | La salida del paso 1 | |
| 47 | La acción existe | En Atajos, busca «Registrar desde texto en Clara» y «Nuevo gasto en Clara» (también en inglés si el iPhone está en inglés) | |
| 48 | Un aviso a mano | En Atajos, crea un atajo con «Registrar desde texto en Clara» y el texto `prueba compra $4.25`; ejecútalo: dice «Clara: aviso anotado para revisar». Abre Clara: Pendientes › Por revisar › «Aviso del banco», con el texto y 4,25 $ sugeridos. No cuenta hasta «Registrar» | |
| 49 | Un SMS de prueba | Atajos › Automatización › nueva › «Mensaje»: remitente, tú mismo (o quien te lo envíe); «El mensaje contiene»: `prueba`; ejecutar sin confirmar; acción «Registrar desde texto en Clara» con el mensaje recibido. Envíate `prueba compra $4.25`: al abrir Clara está como en la 48. Apunta qué variable ofrece Atajos para el texto del mensaje | |
| 50 | Un aviso real de tu banco | Lo mismo con el remitente de tu banco y una palabra de sus avisos de compra. Cuando llegue uno, cópialo **tapando los números de tarjeta** y pásamelo: con 3–6 ejemplos escribo el formato de tu banco y esos avisos entrarán «Por revisar» como un pago de Apple Pay | |
| 51 | Probar un aviso | Ajustes › Captura automática › «Probar un aviso»: pega un aviso y toca «Ver qué entiende Clara». Dice qué haría; no guarda nada | |
| 52 | El texto se va | Registra la propuesta de la 48: el movimiento ya no enseña el texto del aviso | |
| 53 | Nuevo gasto (app cerrada) | Cierra Clara a la fuerza. En Atajos ejecuta «Nuevo gasto en Clara»: Clara se abre en «Nuevo movimiento» | |
| 54 | Nuevo gasto (app abierta) | Con Clara en Inicio, desliza para ir a Atajos y ejecútalo otra vez: vuelve a Clara en el formulario | |
| 55 | Tocar atrás y Siri | Ajustes › Accesibilidad › Tocar › Tocar atrás › Doble toque › «Nuevo gasto en Clara»; da dos toques en la espalda del iPhone. Y «Oye Siri, nuevo gasto en Clara». Si tu iPhone tiene botón de Acción: Ajustes › Botón de Acción › Atajo | |
| 56 | Notificaciones de una app (iOS 27) | Mira si Atajos › Automatización ofrece un disparador para las notificaciones de una app (p. ej. la de tu banco). Si existe, apunta qué datos de la notificación pasa (título, texto) y prueba la acción con el texto: debería comportarse como la 49 | |

### 4. Control «Nuevo gasto» (opcional, cuando todo lo anterior funcione)

Los controles del Centro de control viven en una **extensión de widgets**, que se crea en Xcode (Apple no ofrece otra
forma). Con la cuenta gratuita, la extensión gasta uno de los 10 identificadores de cada 7 días. Los widgets de la
Fase 6 irán en esta misma extensión.

1. En Xcode: File › New › Target… › iOS › **Widget Extension** › Next.
2. Product Name: `ClaraWidgets`. Team: tu Personal Team. Marca **Include Control**; desmarca «Include Live Activity» y
   «Include Configuration App Intent». Finish. Si pregunta por activar el esquema nuevo, elige no activarlo (sigue con
   «App»).
3. A la izquierda, en la carpeta `ClaraWidgets` nueva: borra los `.swift` que creó Xcode (clic derecho › Delete › Move
   to Trash).
4. Arrastra desde Finder a esa carpeta los tres archivos de `ios/ClaraWidgetsSources/` (`ClaraWidgetsBundle.swift`,
   `NewExpenseControl.swift` y `Localizable.xcstrings`). En el cuadro que sale: **sin** marcar «Copy items if needed» y,
   en «Add to targets», solo `ClaraWidgets`.
5. Selecciona `App/ClaraOpenIntent.swift`. En el panel derecho (icono de documento), «Target Membership»: marca
   `ClaraWidgets` **además** de `App`. Apple lo exige para que el control abra la app.
6. Selecciona el proyecto › target `ClaraWidgets` › General › Minimum Deployments: **iOS 18.0**. En «Signing &
   Capabilities», el mismo Team que la app.
7. ▶ con el esquema «App».

| # | Qué | Cómo | ¿Bien? |
|---|---|---|---|
| 57 | El control | Centro de control › mantén pulsado › «Añadir un control» › busca Clara › «Nuevo gasto». Tócalo: Clara se abre en el formulario. Prueba también en la pantalla bloqueada (personalizarla › controles) y, si lo tienes, en el botón de Acción (Ajustes › Botón de Acción › Control) | |

Si Xcode da errores al compilar la extensión, copia el texto del error tal cual. La app no depende de la extensión:
si quieres seguir sin ella, borra el target `ClaraWidgets` (proyecto › target › «−»).

## Tus datos reales

Prueba primero con los datos de demostración y la lista de comprobación. Cuando todo esté bien:

1. En la Clara de siempre (Safari o la de la pantalla de inicio): **Ajustes › Copias de seguridad › Exportar copia**
   y guárdala en Archivos.
2. En la app: **Ajustes › Copias de seguridad › Importar copia** y elige ese archivo.
3. Desde entonces son dos Clara separadas: lo que registres en una no aparece en la otra. Usa una sola.

## Lo que se sabe que aún no está adaptado

- Las copias locales automáticas, el PIN y las preferencias ya no dependen del WebView (decisión 173): si iOS lo
  vaciara, el bloqueo y las preferencias vuelven solos al abrir.
- Los textos que hablaban del navegador, de Safari, de pestañas o de descargas ya se sustituyen dentro de la app
  (decisiones 164 y 167), pero puede quedar alguno suelto: si ves «navegador» o «descarga» en la app, apunta dónde.
  Los botones siguen diciendo «Descargar…» aunque en la app abran la hoja Compartir.
- Los textos de la app llegan un instante después de abrir: si al arrancar ves un texto con «navegador» que cambia
  solo, también apúntalo.
- Estadísticas › «Exportar PDF» usa la impresión del navegador; dentro de la app puede no hacer nada (pendiente).
- Los avisos (pagos por vencer, planes) usan las notificaciones del navegador, que dentro de una app no existen: en
  la app no llegan todavía. Se sustituyen por notificaciones nativas en el paso de la acción «Registrar gasto».
- Los textos con los que iOS pide permiso (cámara, micrófono, Face ID) están solo en español.
- Ajustes › Atajos ya no muestra «Atajos de iPhone» dentro de la app (sus enlaces abren la Clara de la web). La guía
  de captura automática está en Ajustes › Captura automática (Fase 2).

## Si algo falla

Copia el mensaje exacto y dime en qué paso estabas. Los más probables:

| Mensaje (o lo que ves) | Qué pasa | Qué hacer |
|---|---|---|
| `Signing for "App" requires a development team` | Falta elegir el equipo | Paso 3 de «La primera vez» |
| `Failed to register bundle identifier` o `cannot be registered to your development team` | El identificador ya lo usa otra cuenta | **No pruebes otro**: dímelo y lo decidimos (cada identificador nuevo gasta uno de los 10 de cada 7 días) |
| `Developer Mode disabled` o el iPhone no aparece arriba | Falta el modo de desarrollador o confiar en el Mac | Pasos 4 y 5 |
| `Preparing iPhone for development` / `Copying shared cache symbols` | Xcode prepara el iPhone la primera vez | Espera (puede tardar varios minutos) |
| `Untrusted Developer` / «Desarrollador no fiable» al abrir | Falta confiar en tu Apple ID en el iPhone | Paso 7 |
| `Missing package product 'Capacitor'` o `Package resolution failed` | Xcode no pudo descargar Capacitor | Comprueba internet; **File › Packages › Reset Package Caches**; después **Product › Clean Build Folder** y ▶ |
| `maximum number of apps` | Con la cuenta gratuita caben 3 apps de desarrollo a la vez | Borra del iPhone otra app instalada desde Xcode |
| La app no abre pasados 7 días | Caducó (cuenta gratuita) | ▶ en Xcode otra vez, **sin** borrar la app: los datos siguen |
| `npm ci` falla | Versión de Node o archivos a medias | `node -v` (≥ 22); si sigue, copia el error |
| Errores en rojo de Swift al compilar | Código nativo sin compilar antes | Copia la lista completa (icono rojo de la barra superior de Xcode) |
| Pantalla en blanco | Ver «Si la pantalla se queda en blanco» | |

Errores de Swift: copia el error completo (pulsa el icono rojo de la barra superior de Xcode para ver la lista) y
envíalo. El código Swift propio son cuatro archivos de `ios/App/App/`: `SceneDelegate.swift`, `ClaraFileStore.swift`,
`ClaraStoragePlugin.swift` y `ClaraBiometricPlugin.swift`.

## Cómo está hecho

- `capacitor.config.ts`: identificador de la app, nombre y carpeta web (`dist`).
- `ios/App/App.xcodeproj`: proyecto de Xcode generado con `npx cap add ios` (Swift Package Manager, sin CocoaPods).
  `ios/App/App/public/` y `ios/App/App/capacitor.config.json` los escribe `cap sync` y no se versionan.
- `ios/App/App/Assets.xcassets`: icono (1024 px, sin transparencia) y pantalla de arranque en claro y oscuro, hechos
  a partir de `public/icon.svg`.
- `ios/App/App/Info.plist`: idiomas (es, en, pt, fr) y los textos de permiso de cámara, micrófono y Face ID. Sin ellos iOS
  cierra la app al abrir la cámara.
- `ios/App/App/ClaraBiometricPlugin.swift`: Face ID o Touch ID para el bloqueo (LocalAuthentication). Solo responde
  sí o no; no guarda nada.
- Plugins oficiales de Capacitor (`@capacitor/haptics`, `status-bar`, `keyboard`, `filesystem` y `share`): vibración,
  barra de estado, teclado y la hoja Compartir. `cap sync` los añade a `ios/App/CapApp-SPM/Package.swift` apuntando a
  `node_modules/`, por eso hay que hacer `npm ci` antes de abrir Xcode.
- `ios/App/App/ClaraFileStore.swift` y `ClaraStoragePlugin.swift`: los datos se guardan en un archivo propio de la app
  (`Application Support/Clara/data.clara`), no en el WebView, que iOS puede vaciar. Detalle en `docs/STORAGE.md`.
- `src/platform/` (`isNativeIOS`): la única capa de la web que sabe si corre dentro de la app (lo ve por el puente
  nativo, `window.Capacitor`). Ningún import de Capacitor fuera de ella; lo nativo se carga con `import()` solo dentro
  de la app, así el JS inicial de la web no crece. Decide cómo se hace algo y qué se explica; nunca cambia cifras.
- El target de la app exige **iOS 18.0**. El paquete que genera Capacitor (`ios/App/CapApp-SPM/Package.swift`) declara
  iOS 17 porque su manifiesto usa Swift tools 5.9, que no conoce `.v18`; es el mínimo del paquete, no el de la app.
