# Fase 1 de Clara nativa: informe

Fase 1 del encargo «Clara nativa para iPhone» (`docs/NATIVE-PLAN.md`): **Clara funciona en el iPhone como app
nativa**. PR #18 (`feat/ios-nativo`). Fecha: 12 de noviembre de 2026.

> **Estado: escrita, sin compilar.** Este entorno es Linux, sin Xcode ni iPhone. El código nativo se escribió contra
> las fuentes de Capacitor 8.6.0 instaladas y la documentación de Apple, y el lado web se probó con un puente nativo
> simulado. Nada de esto dice que funcione en el iPhone: eso lo dirá la primera compilación de Victor (decisión 163).

## 1. Qué se hizo

| Bloque | Qué | Decisión |
|---|---|---|
| 1 | Capa `src/platform/` (lo único que sabe si corre en la app), `capacitor.config.ts`, iOS 18.0, guiones `ios:sync` e `ios:open`; sin *service worker* en la app | 152, 153 |
| 2 | Datos en un archivo propio de la app (Application Support), con escritura atómica, versión anterior y detección de conflicto (`ClaraStorage` + `NativeRepository`); lo que hubiera en el WebView se trae una vez, verificando | 155, 156 |
| 3 | La app habla de la app: «Clara en este iPhone» en vez de «Instalar Clara», sin pedir nada al navegador, sin los enlaces de Atajos que abren la web; 50 textos sustituidos en es/en/pt/fr (paquete diferido `nativeApp`) | 164 |
| 4 | Face ID o Touch ID en el bloqueo (`ClaraBiometric`, LocalAuthentication); el PIN sigue de alternativa | 165 |
| 5 | Vibración del iPhone al guardar, deshacer y en errores (nunca con «reducir movimiento»), barra de estado según el tema de Clara, teclado que no tapa los campos | 166 |
| 6 | Copias, CSV y demás archivos por la hoja Compartir (en la app no hay descargas); importar abre Archivos | 167 |
| 7 | Guía `docs/IOS-NATIVE.md` para alguien que nunca usó Xcode, y este informe | — |

Además, para no pasar del presupuesto del JS inicial (844,6 KB), los textos de «¿Qué cambió?» pasaron a un paquete
diferido: el JS inicial queda en 840,6 KB con toda la fase.

## 2. Archivos principales

- **Nativo (Swift, escrito sin compilar):** `ios/App/App/SceneDelegate.swift` (registra los plugins propios),
  `ClaraFileStore.swift`, `ClaraStoragePlugin.swift`, `ClaraBiometricPlugin.swift`; `Info.plist` (idiomas y textos de
  permiso de cámara, micrófono y Face ID); `ios/App/CapApp-SPM/Package.swift` (lo escribe `cap sync`).
- **Plugins oficiales (sin Swift propio):** `@capacitor/haptics`, `status-bar`, `keyboard`, `filesystem`, `share`.
- **Web:** `src/platform/` (`index.ts`, `repository.ts`, `nativeStore.ts`, `nativeBiometric.ts`, `biometric.ts`,
  `system.ts`, `files.ts`, `texts.ts` y `native/`, lo único que importa Capacitor), `src/storage/nativeRepository.ts`,
  `src/i18n/nativeTexts.ts` y `packs/nativeApp.*.json`, `src/ui/screens/settings/NativeAppSection.tsx`,
  `src/ui/lock/biometric.ts`, `src/main.tsx` (carga lo nativo una sola vez dentro de la app).
- **Pruebas:** `tests/e2e/native-shell.spec.ts` y `tests/e2e/nativeShell.ts` (doble del puente de Capacitor y de los
  plugins con el mismo contrato que el Swift).
- **Documentación:** `docs/IOS-NATIVE.md`, `docs/NATIVE-PLAN.md`, `docs/DECISIONS.md` (152–167), `docs/STORAGE.md`,
  `CLAUDE.md`, `AGENTS.md`.

## 3. Pruebas y resultados

- **Unitarias:** 1 298 pasan, 1 omitida, 0 fallan (`npm test`). Nuevas en la fase: 63 (frontera de la capa de
  plataforma, elección de almacenamiento, `NativeRepository`, textos de la app, Face ID, vibración y barra de estado,
  compartir archivos).
- **Navegador:** 20 pruebas nuevas de la app simulada (`native-shell.spec.ts`) en los tres tamaños: guardar en el
  archivo propio y reabrir, migrar desde el WebView, aviso sin plugin, textos en es y en, la web no pide el paquete de
  la app, Face ID (activar, entrar, cancelar, sin Face ID), vibración y «reducir movimiento», barra de estado, exportar
  por Compartir (guardar, cerrar sin elegir, fallo), CSV, importar.
- **Matriz completa de navegador** (celular, celular 320 px y escritorio, con axe) sobre el estado final:
  1 274 pasan, 4 omitidas, 0 fallan (26 minutos).
- **Tipos, lint, compilación y tamaño:** en verde; JS inicial 840,6 KB de 844,6.
- **Swift:** sin compilar ni probar. Las pruebas Swift (XCTest) llegan al empezar la Fase 2, cuando la primera
  compilación haya confirmado la base.
- **APIs de Apple comprobadas** en developer.apple.com: LocalAuthentication (`LAContext`, `LAPolicy`, `LAError.Code`,
  `NSFaceIDUsageDescription`); para la Fase 2, App Intents (`AppIntent`, `AppShortcutsProvider`,
  `IntentCurrencyAmount`) y `FileManager.containerURL(forSecurityApplicationGroupIdentifier:)`.

## 4. Qué tengo que hacer yo en mi Mac o iPhone

1. **Confirmar el identificador** `com.victorli.clara` y el App Group `group.com.victorli.clara` (o decir otros) antes
   de compilar. Con la cuenta gratuita, cada identificador nuevo gasta uno de los 10 de cada 7 días.
2. Preparar el Mac una vez: Xcode desde el App Store, Node 22 o posterior, el repositorio (`docs/IOS-NATIVE.md`,
   «Antes de empezar»).
3. En la carpeta del repositorio: `git checkout feat/ios-nativo`, `npm ci`, `npm run ios:sync`, `npm run ios:open`.
4. En Xcode: tu Apple ID en **Signing & Capabilities › Team**, conectar el iPhone, activar el modo de desarrollador y
   pulsar ▶ (pasos 2 a 7 de la guía).
5. Recorrer las **19 comprobaciones** de la guía con los datos de demostración y devolverme la tabla (o los errores
   de Xcode copiados tal cual).
6. Decirme: modelo de iPhone y versión de iOS, versión de Xcode.
7. Si todo va bien: pasar tus datos reales con «Exportar copia» en la Clara de siempre e «Importar copia» en la app.

## 5. Pendiente y por qué

- **Compilar y probar en el iPhone** (todo lo nativo): solo se puede en el Mac de Victor.
- **«Exportar PDF» de Estadísticas** usa `window.print()`; `WKUIDelegate` no ofrece una forma pública de atenderlo, así
  que en la app probablemente no haga nada. Según lo que diga la fila 19: hoja de impresión nativa u ocultar el botón.
- **Copias locales automáticas, PIN y preferencias** siguen en el almacenamiento del WebView (iOS puede vaciarlo); la
  app lo dice. Pasan al lado nativo en la Fase 2.
- **Copia previa a una migración de esquema:** se guarda en el archivo nativo, pero la fila de Datos y recuperación aún
  mira la del WebView. Se conecta antes del esquema 15.
- **Coste real del guardado** (puente y disco con 10 000 movimientos): se mide en el iPhone; decide JSON o SQLite.
- **Textos de permisos de iOS** solo en español (faltan los `InfoPlist.strings` de en, pt y fr).
- **Un fallo al compartir fuera de «Exportar copia»** (CSV, copia cifrada) no se avisa todavía.
- **PR #16** sigue sin fusionar; este PR incluye sus commits hasta entonces.

## 6. Decisiones nuevas

164 (textos de la app como sustitución en un paquete diferido), 165 (Face ID del sistema detrás del mismo ajuste),
166 (plugins oficiales cargados una sola vez desde `main.tsx`, registrados por nombre; por qué), 167 (todo archivo sale
por la hoja Compartir). Detalle en `docs/DECISIONS.md`.
