# Fase 4 nativa: pagos sin Apple Pay y registrar en un toque

Informe de la Fase 4 del encargo «Clara nativa para iPhone» (`docs/NATIVE-PLAN.md`), 25-nov-2026. Rama
`feat/ios-fase-4`, desde `main` con las Fases 1–3 ya fusionadas. Decisiones 183–186 en `docs/DECISIONS.md`.

> **Regla de honestidad.** Nada de esta fase se ha compilado ni probado en un iPhone. El Swift está **escrito** contra
> la documentación de Apple; lo web está probado en el navegador con un iPhone simulado (`tests/e2e/nativeShell.ts`).

## 1. Qué hice

1. **«Registrar desde texto en Clara»** (decisión 183). Una acción de Atajos que recibe el texto de un aviso del banco
   (el SMS que le pasa una automatización con el disparador «Mensaje») y solo lo añade a la cola de capturas como
   `bank_text`, sin importe. La web lo lee con `domain/bankAlert.ts`:
   - **Formatos conocidos:** la tabla `BANK_ALERT_PATTERNS` está **vacía** a propósito. El encargo prohíbe inventar
     formatos de bancos y todavía no tengo ejemplos reales. Con un formato conocido, el aviso seguirá el camino de
     Apple Pay: gasto «Por revisar» con comercio y tarjeta.
   - **Texto desconocido:** siempre queda como **propuesta** que no cuenta en ninguna cifra, con su texto. Como ayuda,
     se sugiere el importe solo si el texto trae exactamente uno escrito con su moneda pegada («$4.25», «12,50 €»).
     Con dos (la compra y el saldo) o con números sin moneda (tarjeta, fecha, hora), no se sugiere nada.
2. **El texto del aviso no se guarda más de lo necesario** (decisión 184). Vive en la propuesta o en el movimiento
   «Por revisar» hasta que lo registras, confirmas o descartas. Encontré dos sitios donde se quedaba para siempre y los
   cerré:
   - el **historial** guardaba cada movimiento entero en cada cambio;
   - la **papelera** lo guardaba al marcar «Fue rechazado».

   Ahora ninguno de los dos lo guarda, y revertir sigue funcionando.
3. **«Nuevo gasto en Clara»** (decisión 185). Una acción que abre Clara en el formulario de un gasto: para el botón de
   Acción, «Tocar atrás» y Siri (frases en es/en/pt/fr). No guarda nada hasta que tocas Guardar.
   - El Swift solo dice qué pantalla se pidió.
   - El plugin `ClaraLaunch` se la entrega a la web al arrancar y cuando llega el aviso. Así no se pierde si la app
     estaba cerrada ni se abre dos veces.
   - La web decide la ruta.
4. **Control «Nuevo gasto»** para el Centro de control, la pantalla bloqueada y el botón de Acción (decisión 185).
   - Apple pide que viva en una extensión de widgets y que su acción sea un `OpenIntent` compartido con la app.
   - Las fuentes están en `ios/ClaraWidgetsSources/`.
   - La extensión se crea en Xcode con la plantilla de Apple (guía, «Fase 4», paso 4). No la añadí a mano al proyecto
     porque un error ahí rompería la compilación de la app de las Fases 1–3, que todavía no se ha compilado.
   - Los widgets de la Fase 6 irán en la misma extensión.
5. **Alertas de otras apps en iOS 27** (decisión 186). Las investigué en developer.apple.com y **no hay una API
   pública**:
   - las notas de iOS 27, 27.2 y 27.3 no traen nada para leer notificaciones de otras apps;
   - UserNotifications solo trata las de la propia app.

   Lo que describen fuentes que no son de Apple es un disparador de las automatizaciones de Atajos que la persona
   configura. Si existe en tu iPhone, la misma acción «Registrar desde texto» sirve con el texto de la notificación
   (comprobación 56). No implementé nada aparte ni se pide ningún permiso.
6. **Ajustes › Captura automática:**
   - guía de la automatización con SMS;
   - un estado honesto: «Por ahora Clara no conoce el formato de ningún banco»;
   - **«Probar un aviso»**: pegas un aviso y dice qué haría Clara, sin guardar nada;
   - «Nuevo gasto en un toque».
7. **Una guarda del proyecto de Xcode sin Xcode** (`src/platform/nativeProject.test.ts`). Comprueba que:
   - cada `.swift` de la app está en su fase de compilación;
   - cada texto visible de las acciones y del control tiene es/pt/fr;
   - cada frase de Siri lleva el nombre de la app.

## 2. Archivos principales

| Qué | Archivos |
|---|---|
| Dominio | `src/domain/bankAlert.ts`, `src/domain/captureText.ts`; cambios en `captureQueue.ts` (cola sin importe), `captureImport.ts` (`readCapture`), `history.ts` y `historyRevert.ts` (`historyValue`) y `operations.ts` (papelera) |
| Web de la app | `src/platform/nativeLaunch.ts`, `src/platform/native/launch.ts`, `src/main.tsx`, `src/ui/screens/CaptureReview.tsx`, `src/ui/screens/settings/CaptureSection.tsx`, paquete `capture` (es/en/pt/fr) |
| iPhone (Swift) | `ios/App/App/RecordTextIntent.swift`, `ClaraShortcuts.swift` (frases de Siri y «Nuevo gasto»), `ClaraOpenIntent.swift` (compartido con la extensión), `ClaraLaunchPlugin.swift`, `ClaraCaptureQueue.swift` (texto y recorte UTF-16), `SceneDelegate.swift`, `Localizable.xcstrings`, `AppShortcuts.xcstrings`, `project.pbxproj` |
| Control (fuera del proyecto) | `ios/ClaraWidgetsSources/ClaraWidgetsBundle.swift`, `NewExpenseControl.swift`, `Localizable.xcstrings` |
| Pruebas | `bankAlert.test.ts`, `captureQueue.test.ts`, `captureImport.test.ts`, `nativeLaunch.test.ts`, `nativeProject.test.ts`, `ClaraCaptureQueueTests.swift`, `tests/e2e/native-text-alerts.spec.ts`, `tests/e2e/nativeShell.ts` |
| Documentación | `docs/IOS-NATIVE.md` (Fase 4, comprobaciones 46–57), `docs/DECISIONS.md` (183–186), `docs/NATIVE-PLAN.md`, `CLAUDE.md`, `CHANGELOG.md` |

## 3. Pruebas y resultados

Resultados de la verificación final: ver §7.

- **Unitarias nuevas:**
  - `bankAlert` 13;
  - cola 3 (texto sin importe, solo desde avisos, tope de 2 000);
  - importación 6: propuesta con texto y sugerencia, idempotencia, formato conocido como gasto «Por revisar» (1 000,00 − 4,25 = 995,75), duplicados, «Guardar automáticamente» apagado, y el texto fuera del historial y de la papelera con la importación todavía reversible;
  - `nativeLaunch` 5;
  - proyecto de iPhone 4.

  Los textos de prueba son inventados a propósito y no imitan a ningún banco.
- **Navegador (`native-text-alerts.spec.ts`, 3 casos × 3 tamaños, con axe):**
  - un aviso desconocido llega como propuesta con su texto y 4,25 $ sugeridos;
  - al registrarlo, el texto no queda en ningún sitio de los datos y el disponible es 995,75 $;
  - «Probar un aviso» no guarda nada;
  - «Nuevo gasto» abre el formulario al arrancar y con la app abierta, una sola vez, y un nombre desconocido no abre nada.
- **Swift:** 2 XCTest nuevas (línea con solo el texto; recorte UTF-16 sin partir un emoji). **Sin ejecutar**: en el Mac,
  `swift test` debe decir «Executed 15 tests, with 0 failures».
- **APIs de Apple comprobadas en developer.apple.com (25-nov):**
  - `OpenIntent` (iOS 16) y `AppEnum`;
  - `DisplayRepresentation(title:subtitle:image:)` y `TypeDisplayRepresentation(name:numericFormat:)`;
  - `openAppWhenRun` (iOS 16, obsoleto en 26) y `supportedModes` (iOS 26);
  - `OpenURLIntent` (iOS 18, solo *universal links*);
  - `ControlWidget` y `ControlWidgetConfiguration.displayName/description` (SwiftUI, iOS 18);
  - `StaticControlConfiguration(kind:content:)` y `ControlWidgetButton(action:label:)` con `OpenIntent` (iOS 18);
  - el artículo «Creating controls to perform actions across the system»;
  - las notas de iOS 27.
- **Sin comprobar:** los nombres exactos de los menús de Atajos y de Ajustes de iOS, porque support.apple.com no es
  accesible desde este entorno.

## 4. Qué tienes que hacer tú en tu Mac o iPhone

1. **Pásame 3–6 avisos reales de tu banco**, copiados tal cual y con los números de tarjeta tapados (una compra
   normal, una en otra moneda y, si te ha llegado, una devolución o un pago rechazado). Con ellos escribo el formato y
   sus pruebas; hasta entonces ningún aviso se registra solo.
2. En el Mac, con Claude Code abierto en la carpeta ALCANZA (o a mano):
   `git checkout feat/ios-fase-4 && git pull && npm ci && npm run ios:sync`, y luego `cd ios/ClaraNativeTests && swift test`.
3. Abre Xcode (`npm run ios:open`), ▶ en tu iPhone y sigue `docs/IOS-NATIVE.md` › «Fase 4», comprobaciones 46–56.
   La 49 es la del encargo: un SMS de prueba que te envías.
4. Cuando todo eso funcione, si quieres el control del Centro de control, sigue el paso 4 de esa sección (crear la
   extensión en Xcode) y la comprobación 57.
5. Antes que nada de esto siguen pendientes las comprobaciones 1–45 de las Fases 1–3, que son las del viaje del
   15-dic.

## 5. Qué quedó pendiente y por qué

- **Formatos de tu banco:** esperan tus ejemplos reales (regla del encargo: no inventar formatos).
- **Devoluciones y pagos rechazados por SMS:** el tipo de formato existe solo para compras. Los otros tipos se añaden
  con ejemplos.
- **El control:** escrito, pero la extensión tiene que crearla Xcode. No toco el proyecto a mano para no arriesgar la
  compilación de la app.
- **Origen `notification`:** sin API pública en iOS 27. Si el disparador de Atajos existe, la acción de texto sirve
  igual.
- **«Nuevo gasto» con otro formulario a medias:** la acción lleva al formulario nuevo igual que cambiar de pantalla.
  Un movimiento nuevo a medio escribir se recupera como borrador (si ya estás en «Nuevo movimiento», no cambia nada).
  Los cambios sin guardar de un movimiento que ya existía se pierden, como hoy al salir de él. No añadí un aviso: si
  en el iPhone molesta, se añade.

## 6. Decisiones nuevas

- **183:** el iPhone transporta el texto, la web lo lee, y solo con formatos reales; sin ellos, propuesta con
  sugerencia prudente.
- **184:** el texto del aviso solo se guarda mientras espera revisión; nunca en el historial ni en la papelera.
- **185:** «Nuevo gasto» con `openAppWhenRun`, el control con `OpenIntent` en una extensión creada en Xcode, la
  pantalla por nombre y la ruta en la web.
- **186:** no hay API pública para leer las alertas de otras apps en iOS 27; se usa la misma acción.

## 7. Verificación final

En este entorno (Linux, Node 22, Chromium de Playwright), sobre `feat/ios-fase-4`:

- `npm run typecheck`, `npm run lint` y `npm run lint:i18n`: en verde.
- `npm test`: 1 501 pasan y 1 omitida tras el bloque de dominio (154 archivos); después se añadieron 9 de la
  plataforma, en verde (`src/platform`: 38 de 38).
- Navegador, lo que toca esta fase (app simulada, «Por revisar», guardas de maquetación) en celular y celular 320 px:
  140 de 140.
- `npm run build` y `npm run size`: JS inicial 838,9 KB de 844,6 (+0,7 KB respecto a la Fase 3; lo nuevo se carga
  aparte).
- La matriz completa de navegador (tres tamaños) y el CI del PR se anotan abajo cuando terminen.
