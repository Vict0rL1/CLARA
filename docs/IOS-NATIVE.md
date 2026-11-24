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
archivo de datos). Si algo falla,
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
