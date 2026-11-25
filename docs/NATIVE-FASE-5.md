# Fase 5 nativa: voz, recibos e IA en el iPhone

Informe de la Fase 5 del encargo «Clara nativa para iPhone» (`docs/NATIVE-PLAN.md`), 25-nov-2026. Rama
`feat/ios-fase-5`, desde `feat/ios-fase-4` (PR de la Fase 4 aún sin fusionar). Decisiones 187–190 en
`docs/DECISIONS.md`.

> **Regla de honestidad.** Nada de esta fase se ha compilado ni probado en un iPhone. El Swift está **escrito**
> contra la documentación de Apple. Lo web está probado en el navegador con un iPhone simulado
> (`tests/e2e/nativeShell.ts`), cuyos plugins responden lo que la prueba les dice. Cómo dicta, lee o responde un iPhone
> de verdad solo lo dirán tus comprobaciones.

## 1. Qué hice

1. **Dictado en el teléfono** (decisión 187).
   - `ClaraSpeechPlugin.swift` usa Speech con reconocimiento **solo en el dispositivo**: el audio no sale del iPhone.
   - La web busca, en orden, un idioma de Clara que tu iPhone sepa reconocer sin conexión. Por ejemplo, para español:
     es-MX, es-US y es-ES.
   - Si no hay ninguno, o falta el permiso, no aparece el botón y Clara dice por qué y dónde dar el permiso.
   - Lo dictado aparece mientras hablas. Al tocar «Detener», el asistente de siempre lo analiza y propone. Nada se
     registra sin «Registrar».
   - Dentro de la app ya no se usa el dictado de la web, que puede enviar el audio a un servicio.
   - Sin puntuación automática: probé el analizador con lo que podría escribir el dictado. «Café, 4,50 y Uber, 18
     ayer.» (con comas tras las palabras) daba una sola línea; sin esas comas, dos.
2. **Recibos con Vision** (decisión 188).
   - `ClaraVisionPlugin.swift` lee el texto de la foto y devuelve cada trozo con su recuadro, sin interpretar nada.
   - `domain/ocrLines.ts` junta los trozos en líneas, y `domain/receipt.ts` busca total, fecha y comercio como
     siempre.
   - «Escanear recibos» abre la cámara de documentos de iOS. Lee hasta 5 recibos seguidos y avisa de los que quedan
     fuera. Cada recibo es una línea con su foto.
   - Una foto suelta también se lee con Vision dentro de la app.
   - Una moneda impresa distinta de la del presupuesto bloquea la línea, como siempre.
3. **IA del iPhone, opcional** (decisión 189). `ClaraAIPlugin.swift` usa Foundation Models, el modelo de Apple
   Intelligence que corre en el iPhone (iOS 26). Se usa solo si la enciendes en Ajustes › Asistente; viene apagada.
   - Ayuda con texto desordenado («pues el café de esta mañana fueron 4,50 y luego el uber de ayer 18») y con recibos
     que el lector no entiende del todo.
   - `domain/deviceAi.ts` comprueba **todo** lo que devuelve:
     - cada propuesta tiene que citar su trozo literal de tu texto;
     - el importe lo lee el analizador de siempre;
     - fecha y categoría solo si son válidas, y tus reglas ganan;
     - si falla, tarda más de 20 s o propone menos movimientos que el analizador de siempre, se usa este y se dice.
   - En un recibo, la IA solo completa lo que el lector no encontró con seguridad. El total vale solo si cita su línea
     del recibo, y la línea lo enseña.
   - Cada propuesta lleva «Sugerido por IA en tu iPhone».
   - Si el framework no compila en tu Xcode, `CLARA_NO_AI` la deja fuera y la app compila igual.
4. **Ajustes › Asistente › «En este iPhone»** (decisión 190). Dice lo que de verdad hay en tu iPhone:
   - dictado, fotos de recibos, cámara de documentos e IA, cada uno con el motivo si falta;
   - el interruptor de la IA, que solo aparece si está disponible.
5. **Permisos en 4 idiomas.** Los textos de cámara, micrófono, reconocimiento de voz y Face ID están ahora en
   `InfoPlist.xcstrings` (es/en/pt/fr). La guarda del proyecto lo comprueba sin Xcode.

## 2. Archivos principales

| Qué | Archivos |
|---|---|
| Dominio | `src/domain/ocrLines.ts` (nuevo), `src/domain/deviceAi.ts` (nuevo), `parser.ts` (`suggestedBy`, `aiFields`) |
| Web de la app | `src/platform/nativeAssistant.ts` (contratos), `src/platform/native/assistant.ts`, `src/platform/index.ts` (servicios que avisan al llegar), `src/main.tsx`, `src/ui/useNativeServices.ts`, `src/ui/useDeviceAssistant.ts`, `src/ui/deviceAssistant.tsx`, `src/ui/ocr.ts`, `src/ui/screens/Assistant.tsx`, `src/ui/screens/settings/AssistantSection.tsx`, `src/state/deviceAiSetting.ts`, `src/platform/deviceMirror.ts`, paquete `device` (es/en/pt/fr), `src/i18n/packs.ts` (`usePack(name, enabled)`) |
| iPhone (Swift) | `ios/App/App/ClaraSpeechPlugin.swift`, `ClaraVisionPlugin.swift`, `ClaraAIPlugin.swift`, `InfoPlist.xcstrings`, `Info.plist`, `SceneDelegate.swift`, `project.pbxproj` |
| Pruebas | `ocrLines.test.ts` (7), `deviceAi.test.ts` (12), `nativeAssistant.test.ts` (11), `nativeProject.test.ts` (6), `tests/e2e/native-assistant.spec.ts` (5), `tests/e2e/nativeShell.ts` |
| Documentación | `docs/IOS-NATIVE.md` (Fase 5, comprobaciones 58–71), `docs/DECISIONS.md` (187–190), `docs/NATIVE-PLAN.md`, `CLAUDE.md`, `CHANGELOG.md` |

## 3. Pruebas y resultados

Resultados de la verificación final: ver §7.

- **Unitarias nuevas o ampliadas: 36.**
  - Líneas de Vision (7): renglones, orden, trozos inválidos y tope.
  - IA del iPhone (12): trozo literal, importe del analizador, decimal canónico, moneda escrita, fecha, categoría y
    reglas, forma de la respuesta, «menos movimientos», recibo.
  - Contrato de los plugins con respuestas simuladas (11), entre ellas la del encargo: «café 4,50 y uber 18 ayer»
    dictado da dos propuestas (4,50 hoy y 18,00 ayer), y un recibo leído por Vision da total, fecha y comercio.
  - Proyecto de iPhone (6): permisos en 4 idiomas y los 7 plugins registrados.
- **Navegador (`native-assistant.spec.ts`, 5 casos × 3 tamaños, con axe):**
  - dictado → dos propuestas, sin guardar nada;
  - sin permiso → sin botón y con el motivo;
  - escaneo de 2 recibos (uno de más avisado) y una foto, una línea cada uno;
  - IA encendida desde Ajustes → etiqueta en cada línea, y si falla, el analizador de siempre;
  - IA no disponible → motivo y sin interruptor.
- **Swift:** sin XCTest nuevas (Speech, Vision y Foundation Models solo funcionan en un iPhone). `swift test` debe
  seguir diciendo «Executed 15 tests, with 0 failures».
- **APIs de Apple comprobadas en developer.apple.com (25-nov):**
  - Speech:
    - `SFSpeechRecognizer(locale:)`, `supportsOnDeviceRecognition`, `authorizationStatus()`,
      `requestAuthorization(_:)`;
    - `SFSpeechAudioBufferRecognitionRequest`, con `requiresOnDeviceRecognition`, `shouldReportPartialResults`,
      `addsPunctuation` y `endAudio()`;
    - `recognitionTask(with:resultHandler:)`.
  - `AVAudioApplication.requestRecordPermission(completionHandler:)`.
  - Vision y VisionKit:
    - `VNRecognizeTextRequest` (`.accurate`, `recognitionLanguages`), `VNImageRequestHandler`, `topCandidates(_:)`,
      `boundingBox`;
    - `VNDocumentCameraViewController` (`isSupported`), su delegado e `imageOfPage(at:)`.
  - Foundation Models:
    - `SystemLanguageModel.default`, `availability` y sus motivos, `supportsLocale(_:)`;
    - `LanguageModelSession(instructions:)`, `respond(to:schema:)`;
    - `DynamicGenerationSchema`, `GenerationSchema(root:dependencies:)`, `GeneratedContent.jsonString`.
- **Sin comprobar:** el texto exacto que escribe el dictado de iOS para «cuatro cincuenta» (si pone «4,50», «4.50» o
  palabras), qué idiomas tiene tu iPhone para dictar sin conexión y cuánto tarda la IA. Lo dirán las comprobaciones
  61, 62 y 68.

## 4. Qué tienes que hacer tú en tu Mac o iPhone

1. En el Mac, con Claude Code abierto en la carpeta ALCANZA (o a mano):
   `git checkout feat/ios-fase-5 && git pull && npm ci && npm run ios:sync`, y luego
   `cd ios/ClaraNativeTests && swift test`.
2. Abre Xcode (`npm run ios:open`) y ▶ en tu iPhone. Si da errores en `ClaraAIPlugin.swift`, sigue el paso 2 de
   `docs/IOS-NATIVE.md` › «Fase 5» (`CLARA_NO_AI`) y pásame el error.
3. Sigue las comprobaciones 58–71 de esa sección. Las del encargo son:
   - **61:** dictar «café 4,50 y uber 18 ayer» crea dos propuestas;
   - **64:** la foto de un recibo real propone total, fecha y comercio.
4. Si tu iPhone tiene Apple Intelligence, prueba también 67–70 (la IA).
5. Antes que nada de esto siguen pendientes las comprobaciones 1–57 de las Fases 1–4. Las 1–45 son las del viaje del
   15-dic.

## 5. Qué quedó pendiente y por qué

- **Todo lo del iPhone:** compilar y probar. No hay Xcode en este entorno y las carpetas de tu Mac no se pueden usar
  desde una sesión en la nube.
- **Importes dictados en palabras:** el analizador de siempre entiende mal algunos importes en palabras. Ejemplos:
  «cuatro con cincuenta» da 4,00, y «café cuatro cincuenta y uber dieciocho» da una sola línea de 54,00. Cuando hay
  importe, manda sobre la IA (límite conocido, decisión 189). Lo corriges en la vista previa. Lo normal es que el
  dictado de iOS escriba las cifras con dígitos; cuando sepa qué escribe de verdad (comprobación 61), se mejora el
  analizador con pruebas.
- **Varias fotos a la vez desde la fototeca:** no está. El encargo pide hasta 5 recibos a la vez y lo cubre la cámara
  de documentos; la foto suelta sigue siendo una por vez.
- **Proveedor remoto:** si una compilación tuviera uno configurado, la IA del iPhone no se usa (no se mezclan). Hoy
  ninguna lo tiene.

## 6. Decisiones nuevas

- **187:** dictado solo en el teléfono y nunca el de la web dentro de la app; al parar, propuestas.
- **188:** Vision lee, la web entiende; hasta 5 recibos por escaneo, una línea por recibo.
- **189:** IA del iPhone opcional y apagada al empezar, en el dispositivo, comprobada entera contra el texto. Si algo
  no cuadra, el analizador de siempre.
- **190:** lo que ofrece el iPhone se pregunta, no se supone; los servicios avisan al llegar; textos en el paquete
  `device`.

## 7. Verificación final

En este entorno (Linux, Node 22, Chromium de Playwright), sobre `feat/ios-fase-5`:

- `npm run typecheck`, `npm run lint` y `npm run lint:i18n`: en verde.
- `npm test`: 1 542 pasan y 1 omitida (159 archivos).
- `npm run build` y `npm run size`: JS inicial 839,4 KB de 844,6 (+0,5 KB respecto a la Fase 4; lo nuevo se carga
  aparte).
- Navegador: lo que toca esta fase (`native-assistant.spec.ts`, las pruebas del asistente y las de la app simulada),
  126 de 126 en celular, celular 320 px y escritorio.
- Matriz completa de navegador aquí (tres tamaños, 4 procesos): 1 366 pasan, 4 omitidas y 1 falla. La que falla es
  `audit-nov04` F2 en celular, que no toca esta fase: carga 9 008 programados y se le acabó la espera de 20 s con las
  4 pruebas en paralelo. Repetida sola, pasa (42,7 s). El CI del PR corre la matriz otra vez.
