# Clara nativa para iPhone: plan de trabajo

Plan del encargo «Clara nativa para iPhone: captura automática, varias monedas y todas las mejoras» (12 de noviembre
de 2026). Se actualiza al terminar cada fase. Las decisiones con su porqué están en `docs/DECISIONS.md` (152–167).
El informe de la Fase 1 está en `docs/NATIVE-FASE-1.md`.

> **Regla de honestidad.** Este plan se escribe en un entorno Linux sin Xcode ni iPhone. Nada de `ios/` se ha
> compilado todavía. Cada cosa nativa lleva uno de estos estados: **escrito** (código hecho, sin compilar),
> **compila** (lo compiló Victor en su Mac) o **probado en iPhone** (lo probó Victor). Nunca se salta un estado.

## 1. Estado actual (12-nov-2026)

- **Web (PWA):** React 19 + TypeScript + Vite 8, sin backend, datos en IndexedDB, esquema 14 (15 desde la Fase 2). Publicada en Cloudflare
  Pages. 1 241 pruebas unitarias y 406 de navegador por tamaño, en verde en CI.
- **Rama:** `feat/ios-nativo`. Parte de `main` **más** los commits del PR #16 (auditoría del 2026-11-04, en verde y
  sin fusionar) y el primer commit de la cáscara nativa (`44bd76e`). El motivo está en la decisión 162. Mientras el
  PR #16 no se fusione, el PR de la Fase 1 incluye también sus commits.
- **Ya hecho de la Fase 1 (escrito, sin compilar):** Capacitor 8.6.0, proyecto `ios/` con Swift Package Manager, icono
  y pantalla de arranque (claro y oscuro) desde `public/icon.svg`, textos de permiso de cámara y micrófono, gesto de
  «atrás», y la web reconoce la app para no ofrecer «Instalar Clara».
- **Lo que este plan cambia de ese primer commit:** el identificador de la app pasa a la propuesta del encargo
  (`com.victorli.clara`, pendiente de confirmar), la detección pasa a la capa `src/platform/`, la configuración pasa a
  `capacitor.config.ts`, el destino mínimo sube a iOS 18.0 y la guía pasa a `docs/IOS-NATIVE.md`.
- **Lo que hay hoy para Apple Pay:** un enlace y el portapapeles que solo rellenan un formulario
  (`docs/IOS-SHORTCUTS.md`); la prueba de si el enlace llega a los datos nunca se hizo. Se quedan para la PWA.

## 2. Fases

Las Fases 1, 2 y 3 tienen que estar probadas en el iPhone **antes del 15 de diciembre**. Un PR a `main` por fase; se
fusiona cuando Victor la haya probado.

| Fase | Qué | Estado |
|---|---|---|
| 0 | Rama, este plan, decisiones 152–163, `CLAUDE.md` | Hecho |
| 1 | Clara funciona en el iPhone como app nativa | Escrita y probada en navegador con el puente simulado; **pendiente de compilar y probar en el iPhone** (PR #18) |
| 2 | Los pagos con Apple Pay se registran solos | Pendiente |
| 3 | Varias monedas y modo viaje | Pendiente |
| 4 | Pagos sin Apple Pay y registrar en un toque | Pendiente |
| 5 | Voz, recibos e IA en el iPhone | Pendiente |
| 6 | Widgets, Siri y avisos reales | Pendiente |
| 7 | Préstamos y gastos compartidos | Pendiente |
| 8 | Pulido general en el iPhone | Pendiente |
| 9 | iCloud y TestFlight | No se empieza sin que Victor lo pida |

### Fase 1, por bloques (un commit por bloque)

1. **Arquitectura de la cáscara.** `src/platform/` con `isNativeIOS()` y carga diferida de lo nativo; ningún import
   de Capacitor fuera de esa carpeta; `capacitor.config.ts`; iOS 18.0; guiones `ios:sync` e `ios:open`; el
   *service worker* no se registra en nativo.
2. **Datos duraderos. Hecho (escrito).** Plugin local `ClaraStorage` (Swift, en el target de la app): archivo en
   Application Support con escritura atómica, versión anterior y detección de conflicto por revisión.
   `NativeRepository` implementa `DataRepository`. Primer arranque: migra lo que hubiera en IndexedDB del WebView,
   relee y compara, y no borra nada. 30 pruebas TS con el plugin simulado. Las pruebas Swift (XCTest) llegan con el
   target de pruebas al empezar la Fase 2, cuando la primera compilación haya confirmado la base. Medido aquí:
   serializar 10 000 movimientos (3,14 MB) cuesta 9,6 ms y 50 000 (15,8 MB) 43 ms; puente y disco, pendientes de
   medir en el iPhone.
3. **Textos de la app nativa. Hecho (probado con el puente simulado).** «Instalar Clara» pasa a ser «Clara en este
   iPhone» (dónde están los datos, cómo traer los de la web, cómo se actualiza, la caducidad de 7 días); no se ofrece
   pedir al navegador que conserve los datos; los enlaces de «Atajos de iPhone» no se muestran; y 50 textos que
   hablaban del navegador, de Safari o de pestañas se sustituyen dentro de la app (decisión 164). Todo en el paquete
   diferido `nativeApp`, que la web nunca pide. Prueba de navegador nueva (`tests/e2e/native-shell.spec.ts`) que
   arranca Clara con un doble del puente de Capacitor y del plugin `ClaraStorage`: es la primera vez que el
   repositorio nativo corre entero en un navegador (guardar, reabrir, migrar desde el WebView, aviso sin plugin).
4. **Face ID. Hecho (escrito).** Plugin local `ClaraBiometric` (LocalAuthentication, APIs comprobadas en la
   documentación de Apple) detrás del ajuste `biometricLock` que ya existe: Ajustes › Bloqueo ofrece «Usar Face ID o
   Touch ID» y la pantalla de bloqueo lo pide al abrir; el PIN sigue siendo la alternativa (decisión 165). 10 pruebas
   TS con el plugin simulado y prueba de navegador con el puente simulado.
5. **Tacto del sistema. Hecho (escrito).** Vibración háptica nativa al guardar, deshacer y en errores (respeta
   «reducir movimiento»), barra de estado según el tema de Clara y teclado que redimensiona la vista para no tapar
   los campos, con los plugins oficiales `@capacitor/haptics`, `status-bar` y `keyboard` (decisión 166).
6. **Copias. Hecho (escrito).** En la app no hay descargas: todo archivo (copia, CSV, copia cifrada, datos dañados…)
   se escribe en la caché de la app y abre la hoja Compartir, con `@capacitor/filesystem` y `@capacitor/share`
   (decisión 167). «Restaurar una copia» usa el selector de Archivos del sistema, sin código nativo.
7. **Guía y cierre. Hecho.** `docs/IOS-NATIVE.md` para alguien que nunca usó Xcode (preparar el Mac, primera
   compilación, lista de 19 comprobaciones, errores frecuentes, pasar los datos reales) e informe de la fase
   (`docs/NATIVE-FASE-1.md`).

### Ajustes al plan del encargo tras leer el repositorio

- **Tamaño del JS inicial.** 840,6 de 844,6 KB al cerrar la Fase 1: los textos de «¿Qué cambió?» pasaron a un
  paquete diferido para hacer sitio. Todo lo nativo se carga con `import()` solo dentro de la app, una sola vez desde
  `main.tsx` (decisión 166), y los textos nuevos van en paquetes diferidos (`src/i18n/packs/`). El límite no se sube.
  Las Fases 2 y 3 añaden validación de campos nuevos al arranque (esquema 15): si falta sitio, los siguientes
  candidatos son los textos de escenarios, plan ante faltante y plantillas (unos 15 KB).
- **JSON o SQLite.** Se empieza con un archivo JSON completo por guardado, que es como ya guardan los dos
  repositorios actuales. La parte medible aquí (serializar 10 000 y 50 000 movimientos) se mide en la Fase 1; el
  coste del puente y del disco solo se puede medir en el iPhone y queda como dato pendiente. SQLite solo si esa
  medida lo pide.
- **Copias locales automáticas y copia previa a la migración.** Hoy viven en IndexedDB y `localStorage` del WebView,
  que iOS puede borrar. En la Fase 1 siguen ahí y se dice; pasarlas a nativo es un bloque de la Fase 2 (comparten el
  plugin de almacenamiento).
- **Trabajo en paralelo.** La lógica de dominio de las Fases 2 y 3 (cola de capturas, importes como «¥1,200»,
  conversión con enteros, modo viaje) se puede escribir y probar aquí entera sin iPhone. Se adelanta mientras Victor
  prueba la fase anterior en el teléfono, para llegar al 15 de diciembre.
- **Tipos de cambio en la PWA.** La CSP de la web solo permite conectar con la propia app. La consulta al Banco de
  Canadá se hará desde el lado nativo en la app; en la PWA queda la tasa manual salvo que Victor quiera añadir ese
  origen a la CSP (se pregunta en la Fase 3).
- **Alertas de otras apps (iOS 27).** No se asume ninguna API. Se investiga en la documentación de Apple al empezar
  la Fase 4 y se informa de lo que haya.

## 3. Riesgos

| Riesgo | Qué se hace |
|---|---|
| Nada nativo se compila aquí: el primer intento en Xcode puede fallar | Código Swift mínimo y comprobado contra las fuentes de Capacitor 8 instaladas; Victor pega los errores y se corrigen. Opción: un trabajo de CI en macOS que compile `ios/` (gasta minutos de macOS de GitHub; **se pregunta antes**). |
| Pantalla en blanco: la CSP estricta con el origen `capacitor://localhost` no se pudo probar | La guía explica cómo leer el error con el Inspector web de Safari. Si falla, se ajusta la CSP solo para la compilación nativa. |
| Versión de Xcode: Capacitor 8 se prueba con el SDK de iOS 26 | Si el Xcode de Victor es anterior y no compila, se baja a Capacitor 7 (misma arquitectura). |
| Cuenta gratuita: la app caduca a los 7 días; 10 identificadores cada 7 días | La guía cubre reinstalar. Una sola extensión para widgets y controles. No cambiar el identificador una vez instalado. |
| iOS puede borrar el almacenamiento del WebView | `NativeRepository` (bloque 2). Hasta entonces, solo datos de demostración en la app. |
| Guardar el JSON completo por el puente puede ir lento con muchos movimientos | Medir en el iPhone; SQLite si hace falta. |
| El plazo del 15 de diciembre depende de los turnos de prueba en el iPhone | Dominio de las Fases 2 y 3 adelantado en paralelo; cada entrega lleva pasos de prueba cortos. |
| Subir el esquema (15) impide volver a una versión web anterior | Como en cada subida: `docs/ROLLBACK.md`; la migración solo rellena y lleva prueba. |
| «¥» puede ser yen o yuan; la tasa del Banco de Canadá es indicativa | Nunca se adivina: modo viaje o «Por revisar». La tasa lleva su fecha y su origen, y se puede ajustar al cargo real. |
| El PR #16 sigue sin fusionar y esta rama parte de él | Fusionarlo antes deja limpio el PR de la Fase 1. Si no, se fusionan juntos. |

## 4. Lo que necesito de Victor

1. **Confirmar el identificador de la app y el App Group** antes de la primera compilación: `com.victorli.clara` y
   `group.com.victorli.clara`. Si ya instalaste la app del primer paso (identificador `io.github.vict0rl1.clara`),
   dilo: cambiarlo deja atrás lo que hubiera en esa instalación.
2. **Versiones:** modelo del iPhone y versión de iOS (Ajustes › General › Información) y versión de Xcode (Xcode ›
   About Xcode).
3. **PR #16:** decir si lo fusiono yo o lo fusionas tú.
4. **Primera compilación** con `docs/IOS-NATIVE.md` y devolver la lista de comprobación (o los errores de Xcode).
5. **¿Trabajo de CI en macOS para compilar `ios/`?** Evita turnos de ida y vuelta por errores de compilación, pero
   gasta minutos de macOS de GitHub Actions (cuestan más que los de Linux si el repositorio es privado).
6. Más adelante (Fase 4): ejemplos reales de SMS o alertas del banco, con los números tapados.

## 4 bis. Pendiente anotado durante la Fase 1

- **Imprimir a PDF dentro de la app.** Estadísticas ofrece «Exportar PDF» con la impresión del navegador
  (`window.print()`). La documentación de `WKUIDelegate` no tiene ningún método público para atender esa petición, así
  que dentro de la app probablemente no haga nada (fila 19 de la guía). Si es así: hoja de impresión nativa
  (`UIPrintInteractionController` con el formateador de la vista) o el botón no se muestra en la app.
- **Textos de descargar y exportar:** sustituidos en el bloque 6. Los botones siguen diciendo «Descargar…» aunque
  en la app abran Compartir; si en el iPhone confunde, se cambian.
- **Un fallo al compartir fuera de «Exportar copia»** (CSV, copia cifrada…) no se avisa todavía: esas pantallas
  dicen «generado» al pedirlo, como en la web. Se revisa con lo que diga la prueba en el iPhone.
- **Copia previa a una migración de esquema.** `NativeRepository` la guarda en el archivo nativo (`before-v<N>`), pero
  la fila de Ajustes › Datos y recuperación todavía mira la del WebView. Se conecta antes de subir al esquema 15
  (Fase 2).
- **Las sustituciones llegan un instante después del primer pintado** (se piden al arrancar). En Inicio solo afecta
  al aviso de copia pendiente. Si en el iPhone se nota, se espera al paquete antes de pintar.

## 4 ter. Fase 2: lo que ya se sabe

- **El importe con su moneda.** App Intents tiene `IntentCurrencyAmount` (iOS 16): `amount` es un `Decimal` y
  `currencyCode` el código ISO 4217 (documentación de Apple, comprobado el 12-nov). Si la acción «Registrar pago en
  Clara» recibe ese tipo, el «¥» deja de ser ambiguo en el origen y el Swift pasa el número como texto exacto, sin
  flotantes. Si el «Importe» de la automatización «Transacción» no encaja en ese parámetro, queda el texto que dé
  Atajos. Se prueba en el iPhone; las dos formas se leen igual en la web.
- **Lector de la cola, adelantado** (`src/domain/captureQueue.ts`, 11 pruebas; va en el PR de la Fase 2): una línea
  mala no impide leer las demás y se señala; una última línea a medias se lee la próxima vez; el importe se pasa a
  unidades menores sin flotantes; «¥» suelto con un presupuesto que no es de yenes ni de yuanes es «ambiguo», nunca
  se adivina. Falta que el lector de monedas de `money.ts` reconozca «JP¥» y «CN¥», que es como un iPhone en Canadá
  escribe yenes y yuanes.
- **App Group.** Hace falta para que widgets y controles (Fases 4 y 6) lean la cola. Mientras Victor no confirme
  `group.com.victorli.clara`, la acción puede escribir en la carpeta propia de la app (corre en el mismo proceso).

## 5. Notas del historial de la rama

- El commit `1e80e3c` (documentación del Paso 0) se llevó por error los renombrados de `src/platform/` y de la guía,
  que estaban preparados para el commit siguiente: **por sí solo no pasa `tsc`** (el siguiente lo arregla). Corregirlo
  exigiría reescribir un historial ya publicado, y eso no se hace sin que Victor lo pida. Con «Squash and merge» en el
  PR de la fase no llega a `main`; `git bisect` debe saltarlo.

## 6. Estado de lo nativo

| Pieza | Estado |
|---|---|
| Proyecto `ios/`, icono, pantalla de arranque, permisos | Escrito, sin compilar |
| Detección de la app (`src/platform/`) | Probado en pruebas unitarias; sin probar en iPhone |
| Almacenamiento duradero (`ClaraFileStore.swift`, `ClaraStoragePlugin.swift`, `NativeRepository`) | Swift escrito, sin compilar; TS con 30 pruebas y prueba de navegador con el plugin simulado |
| Face ID / Touch ID (`ClaraBiometricPlugin.swift`, `ui/lock/biometric.ts`) | Swift escrito, sin compilar; TS con 10 pruebas y prueba de navegador con el plugin simulado |
| Vibración, barra de estado, teclado (plugins oficiales, `platform/system.ts`) | Sin Swift propio; probado en navegador con los plugins simulados; sin compilar ni probar en iPhone |
| Copias por la hoja Compartir (plugins oficiales, `platform/files.ts`) | Sin Swift propio; probado en navegador con los plugins simulados; sin compilar ni probar en iPhone |
| Textos y pantallas de la app (`nativeApp`, «Clara en este iPhone») | Solo web: probado en navegador con el puente simulado (3 tamaños, es y en); sin probar en iPhone |
