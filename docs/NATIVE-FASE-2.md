# Fase 2 de Clara nativa: informe

Fase 2 del encargo «Clara nativa para iPhone» (`docs/NATIVE-PLAN.md`): **los pagos con Apple Pay se anotan solos**.
PR #19 (`feat/ios-fase-2`, sobre la Fase 1). Fecha: 13 de noviembre de 2026.

> **Estado: lo web, probado en el navegador; lo nativo, escrito y sin compilar.** Este entorno es Linux, sin Xcode, sin
> Swift y sin iPhone. La acción de Atajos y la cola están escritas contra la documentación de Apple
> (developer.apple.com) y las fuentes de Capacitor 8.6.0; la web se probó con un iPhone simulado. Nada de esto dice
> que funcione en el iPhone: eso lo dirá la prueba de Victor (decisión 163).

## 1. Qué se hizo

| Bloque | Qué | Commit | Decisión |
|---|---|---|---|
| Adelanto | Lector de la cola (`captureQueue.ts`): una línea mala no impide leer las demás, nada de flotantes, «¥» suelto nunca se adivina; el lector de monedas reconoce «JP¥» y «CN¥» | `7be6234` | — |
| Presupuesto | Textos del plan ante faltante a un paquete diferido, para que cupiera lo nuevo (845,2 → 839,7 KB) | `eac7327` | — |
| Datos | Esquema 15, todo opcional: marca «Por revisar», id de captura, orígenes Apple Pay / aviso del banco / Siri, ajustes de captura, propuestas | `8919679` | 168 |
| Reglas | Importar capturas: movimiento «Por revisar» o propuesta; posible duplicado a ≤ 2 min; tarjeta → cuenta; idempotente; todo o nada | `968903b` | 169 |
| Revisar | «Por revisar» arriba de Pendientes: «Está bien», «Editar», «Fue rechazado» (papelera), «Registrar» (con importe escrito si es otra moneda), «Descartar», todo con deshacer donde aplica | `72d07c0` | 170 |
| iPhone | Acción «Registrar pago en Clara» (App Intents), cola `captures.jsonl`, plugin `ClaraCaptures`, textos en es/en/pt/fr, pruebas XCTest como paquete aparte | `d240345` | 171 |
| Conexión | La web lee la cola al abrir, al volver a la app y cuando la acción avisa; solo vacía la cola después de guardar. Ajustes › Captura automática (solo en la app) con guía y «Probar» | `0239c7f` | 171, 172 |
| Encargo | Tarjeta nueva: se pregunta su cuenta la primera vez; la acción responde con el importe y el comercio; pruebas de los importes del encargo y de dos escrituras a la vez en Swift | este PR | 174 |
| Deuda de la Fase 1 | Copias locales automáticas en archivos de la app; PIN y preferencias con copia fuera del WebView que vuelve sola si iOS lo vacía; Datos y recuperación ve la copia previa a una migración (también la de IndexedDB en el navegador) | este PR | 173 |

`CLAUDE.md`: la excepción «Guardar automáticamente» de la Fase 2 está **vigente**.

## 2. Archivos principales

- **Dominio:** `src/domain/captureQueue.ts`, `captureImport.ts` (importar, confirmar, deshacer, descartar, registrar),
  `captureReview.ts` (contar; lo único en el JS inicial), cambios en `operations.ts` (`saveTransaction` conserva la
  captura y la marca), `inbox.ts`, `txFilters.ts`, `types.ts`, `validation.ts`, `money.ts`.
- **Estado y plataforma:** `src/state/captureSync.ts`, `src/platform/nativeCaptures.ts`,
  `src/platform/native/captures.ts`, `src/main.tsx`.
- **Interfaz:** `src/ui/screens/CaptureReview.tsx`, `settings/CaptureSection.tsx`, `Inbox.tsx`, `Home.tsx`,
  `Movements.tsx`, `MovementForm.tsx`; textos en `src/i18n/packs/capture.*.json`.
- **iPhone (sin compilar):** `ios/App/App/RecordPaymentIntent.swift`, `ClaraCaptureQueue.swift`,
  `ClaraCapturesPlugin.swift`, `Localizable.xcstrings`, `AppShortcuts.xcstrings`, `SceneDelegate.swift`,
  `project.pbxproj`; pruebas en `ios/ClaraNativeTests/`.
- **Documentación:** `docs/IOS-NATIVE.md` (sección «Fase 2» con las comprobaciones 20–29), `docs/NATIVE-PLAN.md`,
  `docs/DECISIONS.md` (168–172), `CLAUDE.md`.

## 3. Pruebas y resultados

- **Unitarias:** 1 388 pasan, 1 omitida, 0 fallan (`npm test`); 90 nuevas en la fase (lector de la cola, esquema 15,
  importar con cifras calculadas a mano, deshacer, conexión con la cola, adaptador del plugin, Ajustes, bandeja, copias
  locales y ajustes del dispositivo en archivos de la app, copia previa a una migración en los tres almacenamientos).
- **Navegador, nuevas:** `capture-review.spec.ts` (revisar, deshacer, editar, rechazar, registrar en otra moneda,
  descartar; la prueba de Ajustes) y `native-captures.spec.ts` (la cola entra al abrir y no se duplica al reabrir, con
  la app abierta, al volver a primer plano, nada en la demostración, Ajustes › Captura automática con «Probar», y que
  en el navegador no existe) y `native-device.spec.ts` (copias locales en archivos de la app; el PIN vuelve si iOS vacía
  el WebView, también con la app suspendida, y quitarlo se conserva; la fila de la copia previa a una migración), en
  celular, celular 320 px y escritorio, con axe.
- **Navegador, lo relacionado** (en los tres tamaños, con axe): con la conexión web ya hecha, app simulada, revisión,
  guardas de maquetación y accesibilidad: 198 pasan, 0 fallan; antes, Pendientes, filtros, Atajos, auditorías y la
  app simulada: 380 pasan, 1 omitida, 0 fallan; con las copias y el PIN fuera del WebView, app simulada, copias,
  seguridad de datos y Ajustes: 138 pasan, 0 fallan. La matriz completa la corre la integración continua del PR (en
  verde en `122a8b9`).
- **Tipos, lint, compilación y tamaño:** en verde; JS inicial 842,5 KB de 844,6.
- **Swift:** 13 pruebas XCTest escritas (cola, también con dos escrituras a la vez, y archivo de datos), **sin ejecutar**: aquí no hay Swift ni se puede
  descargar. La acción y el plugin, sin compilar.
- **APIs de Apple comprobadas** en developer.apple.com: `AppIntent` (`title`, `description`, `perform()`),
  `IntentParameter.needsValueError(_:)`, `IntentCurrencyAmount` (`amount: Decimal`, `currencyCode`),
  `ProvidesDialog`, `result(dialog:)`, `AppShortcutsProvider`, `AppShortcut(intent:phrases:shortTitle:
  systemImageName:)` (iOS 17), `AppShortcutPhraseToken.applicationName`. Capacitor: evento `resume` del documento,
  `notifyListeners`, `getArray`.
- **Sin comprobar:** los menús de Atajos para el disparador de transacciones de Wallet y sus variables
  (support.apple.com no es accesible desde este entorno).

## 4. Qué tengo que hacer yo en mi Mac o iPhone

1. Si aún no está: la Fase 1 (`feat/ios-nativo`) con sus 19 comprobaciones (`docs/IOS-NATIVE.md`).
2. En la carpeta del repositorio: `git checkout feat/ios-fase-2`, `git pull`, y `cd ios/ClaraNativeTests && swift
   test`. Debe decir «Executed 13 tests, with 0 failures»; si no, copia la salida.
3. `npm ci`, `npm run ios:sync` y ▶ en Xcode. Si sale un error, cópialo tal cual.
4. En la app, usa tus datos o un presupuesto nuevo (con los de demostración no se importa nada) y ábrela una vez.
5. Crea la automatización de Atajos (guía, «Fase 2», paso 4).
6. Recorre las comprobaciones **20–30** y apunta qué variables ofrece el disparador de Wallet, si «Importe» encajó
   directo y qué dice Siri.
7. Dime el modelo de iPhone, la versión de iOS y la de Xcode.

## 5. Pendiente y por qué

- **Compilar y probar en el iPhone** todo lo nativo de las Fases 1 y 2: solo en el Mac de Victor.
- **Nombres de menús de Atajos** sin comprobar: support.apple.com está bloqueado en este entorno. Si Victor quiere, se
  puede permitir ese sitio en la configuración del entorno y se revisa la guía.
- **El origen «Siri»:** la acción marca todo como Apple Pay; distinguir una llamada por voz llega con Siri (Fase 6).
- **En la lista de movimientos**, un pago capturado sin nota se titula con su categoría (como cualquier movimiento sin
  nota); el comercio se ve en «Por revisar» y en el detalle. Cambiar el título de todos los movimientos es otra
  decisión.
- **Copias locales de una compilación anterior** que hubieran quedado en el WebView no se traen a los archivos nuevos:
  esa compilación nunca llegó a usarse.
- **Textos de permisos de iOS** en en, pt y fr (`InfoPlist.strings`), pendiente desde la Fase 1.
- **App Group:** confirmado, sin usar hasta los widgets (Fase 6); con cuenta gratuita no se puede activar.

## 6. Decisiones nuevas

168 (esquema 15), 169 (cómo entra un pago capturado), 170 (la revisión en Pendientes), 171 (la acción solo anota; sin
App Group en esta fase; cuándo lee la web), 172 (Ajustes › Captura automática solo en la app; «Probar»), 173 (copias
locales, PIN y preferencias fuera del WebView), 174 (tarjeta nueva y respuesta con el pago). Detalle en
`docs/DECISIONS.md`.
