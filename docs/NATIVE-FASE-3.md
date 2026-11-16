# Fase 3 de Clara nativa: informe

Fase 3 del encargo «Clara nativa para iPhone» (`docs/NATIVE-PLAN.md` §4 quater): **varias monedas y modo viaje**.
PR #20 (`feat/ios-fase-3`, sobre la Fase 2). Fecha: 14 de noviembre de 2026; Banco de Canadá, 16 de noviembre.

> **Estado: escrito y probado en el navegador con un iPhone simulado; sin probar en el iPhone.** No hay Swift nuevo:
> todo es web. Las cifras de las pruebas están calculadas a mano. Las tasas del Banco de Canadá (Valet) se escribieron
> después de comprobar la API real desde el entorno «clara» (`docs/BOC-VALET.md`); en las pruebas del navegador el
> banco está **simulado**, y dentro del iPhone no se ha probado (§4).

## 1. Qué se hizo

| Bloque | Qué | Commit | Decisión |
|---|---|---|---|
| Datos y cuentas | Esquema 16: un movimiento puede guardar `original` (moneda, importe, tasa exacta en texto, fecha, origen, comisión). Conversión con enteros (BigInt) y un solo redondeo al céntimo, comisión dentro; la validación exige que cuadre al céntimo. «Cargo real» = fracción exacta entre los dos importes | `073d72f` | 175 |
| Presupuesto | Textos de la revisión semanal a un paquete diferido, para que cupiera la validación nueva (844,5 → 840,9 KB) | `7aa2c7a` | 175 |
| Viajes | Un periodo «Viaje» lleva monedas, moneda local actual (lo único que resuelve un «¥» suelto), una tasa escrita por moneda con su fecha y la comisión. Vista del viaje por moneda, total, gasto por día; cambiar una tasa no toca lo registrado | `88c0931` | 176 |
| Capturas | Un pago de Apple Pay en una moneda del viaje con tasa entra «Por revisar», convertido con esa tasa y asociado al viaje; sin tasa, propuesta que se registra con lo que cobró el banco (guarda el original) o con la tasa del viaje. Un importe en otra moneda siempre lleva su código y respeta el modo privado | `5e43150` | 177 |
| Formulario | «Pagado en otra moneda»: con una tasa (se propone la del viaje) o con lo que cobró el banco («ajustar al cargo real»); la cuenta se enseña; sin tasa no se guarda. Textos de Presupuestos por periodo a un paquete diferido (843,7 → 837,4 KB) | `cde0f8c` | 178 |
| Vista del viaje | «Modo viaje» en el formulario del periodo; tarjeta del viaje con «Ahora estás en», gastado por moneda, total, gasto por día, lo que espera tasa y las tasas; la lista de movimientos enseña el original | `9941d49` | 176 |
| Estadísticas y CSV | «Gastado por moneda» en Estadísticas (solo si hay algo en otra moneda); seis columnas del original en el CSV | `49c94a3` | 179 |
| Asistente | Una línea en una moneda del viaje con tasa se convierte con ella y lo dice antes de registrar; sin tasa sigue bloqueada | `8cfba9e` | 180 |
| Arreglos | «Duplicar como borrador» copia también el original; la prueba de la copia previa a la migración sigue al esquema actual | `a0e9f0b`, `d8239f4` | — |
| Banco de Canadá: dominio | API comprobada de verdad (URL, JSON con el valor en texto, festivos, 27 series, CORS `*` sin consulta previa, condiciones de uso) en `docs/BOC-VALET.md`; respuestas reales guardadas; leer la respuesta, la última observación ≤ la fecha del gasto (≤ 10 días antes), conversión con `rateSource: 'boc'` | `9db8216` | 181 |
| Banco de Canadá: red | Interruptor del dispositivo apagado por defecto; GET sin cabeceras propias, credenciales ni Referer; plazo de 8 s; caché acotada solo de lo definitivo, fuera de las copias; CSP `connect-src` abre solo `https://www.bankofcanada.ca` | `f6033d8` | 181 |
| Banco de Canadá: capturas | Sin tasa del viaje, un pago en otra moneda entra «Por revisar» convertido con la tasa del banco pedida antes de importar (la importación sigue pura); sin conexión, propuesta; la vista del viaje cuenta lo convertido con el banco | `8176fcc` | 182 |
| Banco de Canadá: pantallas | Ajustes › Formato › Tasas del Banco de Canadá; «Usar la tasa del Banco de Canadá» en «Pagado en otra moneda» con el aviso «Tasa indicativa del Banco de Canadá del <fecha>»; «Por revisar» lo dice y una propuesta puede pedirla; texto de privacidad (Legal) con la excepción | `e599938`, docs | 182 |

`CLAUDE.md`: la regla «una moneda por presupuesto» con el original y la tasa de cada movimiento está **vigente**, y
también la excepción «sin conexiones a otros sitios» para el Banco de Canadá.

## 2. Archivos principales

- **Dominio:** `src/domain/fx.ts` (tasa exacta, conversión), `fxAdjust.ts` (cargo real, lo que se escribe en el
  formulario, cómo se enseña una tasa), `trips.ts` (viaje en curso, «¥», tasas, vista del viaje, gastado por moneda,
  importe escrito durante un viaje), cambios en `types.ts`, `validation.ts`, `operations.ts`, `periodBudgets.ts`,
  `captureImport.ts`, `assistant.ts`, `csvExport.ts`; `src/storage/backup.ts`, `migrations.ts`.
- **Interfaz:** `src/ui/fxFields.tsx` (sección del formulario, diferida), `tripUi.tsx` y `tripDraft.ts` (viaje),
  `statsCurrency.tsx`, `fxText.ts`, `components/PackBody.tsx` y `packTexts.ts`; cambios en `MovementForm.tsx`,
  `PeriodBudgets.tsx`, `CaptureReview.tsx`, `Assistant.tsx`, `Statistics.tsx`, `Movements.tsx`, `ExportSection.tsx`,
  `format.ts` (`moneyIn`). Textos en los paquetes `fx`, `periods` y `weekly`.
- **Banco de Canadá:** `src/domain/boc.ts` (puro) y `src/domain/__fixtures__/boc/` (respuestas reales),
  `src/state/bocRates.ts` (red, caché, interruptor), `src/ui/screens/settings/BocSetting.tsx`; cambios en
  `captureImport.ts` (`bocRatesNeeded`, `options.boc`), `state/captureSync.ts`, `fxAdjust.ts`, `trips.ts`
  (`bocConverted`), `ui/fxFields.tsx`, `CaptureReview.tsx`, `tripUi.tsx`, `Settings.tsx`, `platform/deviceMirror.ts`,
  `vite.config.ts` (CSP); textos en los paquetes `fx`, `capture`, `periods` y `legal`.
- **Documentación:** `docs/BOC-VALET.md`, `docs/FORMULAS.md` §45–47, `docs/DECISIONS.md` 175–182, `docs/IOS-NATIVE.md`
  («Fase 3», comprobaciones 31–45), `docs/ROLLBACK.md` (esquema 16), `docs/NATIVE-PLAN.md`, `CLAUDE.md`, `CHANGELOG.md`,
  `README.md`.

## 3. Pruebas y resultados

- **Unitarias:** 1 440 pasan, 1 omitida, 0 fallan (`npm test`); 52 nuevas en la fase, con cifras calculadas a mano:
  conversión (¥1 200 a 0,0092 = 11,04 $; ₩15 000 a 0,00098 = 14,70 $; CN¥88,30 a 0,1923 = 16,98 $; las tres = 42,72 $;
  con 2,5 % de comisión ¥145 = 1,37 $ y no 1,36, porque el redondeo es uno solo), cargo real (11,17 $ por ¥1 200 →
  `1117/120000`), tasa ausente, cambio de tasa (lo anterior conserva 0,0092 y lo nuevo usa 0,0095 → 11,69 $),
  devoluciones en otra moneda (¥600 = 5,52 $ que restan en las dos monedas), papelera, sumas que no caben, «¥» con y
  sin moneda local, validación y copias (claves desconocidas fuera, tasa numérica rechazada), migración 15 → 16,
  capturas convertidas y propuestas, asistente, CSV.
- **Navegador, nuevas** (celular, celular 320 px y escritorio, con axe): `foreign-currency.spec.ts` (tasa del viaje,
  cargo real, sin tasa no se guarda, apagar la sección, duplicar), `trips.spec.ts` (crear el viaje, gasto en yenes
  convertido y asociado, vista por moneda, «Ahora estás en»), `stats-currency.spec.ts` (Estadísticas, insignia en la
  lista y CSV), `assistant-trip.spec.ts` y un caso de viaje en `capture-review.spec.ts`.
- **Navegador, la matriz completa:** 1 322 pasan, 4 omitidas y 3 fallaron, las tres la misma prueba
  (`native-device.spec.ts:92`, que buscaba la copia «before-v15» con el esquema ya en 16): arreglada en `d8239f4` y
  vuelta a correr con lo del asistente y las pruebas de moneda del asistente, Atajos y auditorías: 168 pasan, 3
  omitidas, 0 fallan. En una tanda anterior hubo un fallo que no se repitió (ni al volver a correr la tanda entera, 276
  de 276, ni repitiendo las dos pruebas sospechosas 18 y 24 veces en paralelo); no se apuntó su nombre.
- **Tipos, lint, compilación y tamaño:** en verde; JS inicial 838,1 KB de 844,6 (empezó la fase en 842,5: los textos de
  la revisión semanal y de Presupuestos por periodo se cargan aparte).
- **Banco de Canadá, unitarias** (40 nuevas; total 1 480 pasan, 1 omitida, 0 fallan): con las respuestas REALES
  guardadas, el último día hábil (sábado y domingo → viernes; Navidad y el 26 → el 24; Año Nuevo → el 31), fecha antes
  del primer dato, observación de más de 10 días (serie que ya no se publica), valor como texto exacto («0.008940» →
  «0.00894»), serie inexistente (404), respuestas mal formadas (número en vez de texto, coma, exponente, negativo, cero,
  fecha imposible, otra serie), caché (lo definitivo se guarda, hoy no; tocada o ilegible se ignora; acotada), sin
  conexión y plazo vencido, interruptor apagado no pide nada; conversiones a mano: ¥1 200 a 0,00891 = 10,69 $; a
  0,00894 = 10,73 $ y con 2,5 % = 11,00 $; US$25 a 1,3706 = 34,27 $ (la mitad, hacia arriba); capturas convertidas,
  propuestas sin tasa, la tasa del viaje primero, comisión del viaje y asociación, «Guardar automáticamente» apagado,
  presupuesto en USD, `captureSync` con y sin tasa; CSP.
- **Banco de Canadá, navegador** (`boc-rates.spec.ts`, Valet simulado con `page.route`, en los tres tamaños, con axe):
  apagado no pide nada; el ajuste; el formulario usa la tasa (¥1 200 × 0,00923 = 11,08 $) con su aviso, la dirección
  pedida es la esperada y no lleva cookies ni Referer; cambiarla a mano la vuelve manual; sin conexión lo dice y no
  guarda; presupuesto en USD no ofrece el interruptor; captura en la app convertida con `boc`, otra sin conexión queda
  como propuesta y se registra luego con la tasa (¥500 → 4,62 $); la vista del viaje lo cuenta. Con las relacionadas
  (otra moneda, «Por revisar», capturas, viajes, seguridad, Ajustes, dispositivo, guardas de maquetación y
  accesibilidad): 201 de 201.
- **Navegador, la matriz completa tras el Banco de Canadá:** en curso al escribir esto (se completa al terminar).
- **Tamaño:** JS inicial 838,2 KB de 844,6 (todo lo del banco se carga aparte).
- **iPhone:** nada probado. No hay Swift nuevo.

## 4. Qué tengo que hacer yo en mi Mac o iPhone

1. Si aún no está: las Fases 1 y 2 con sus comprobaciones (`docs/IOS-NATIVE.md`, 1–30).
2. `git checkout feat/ios-fase-3`, `git pull`, `npm ci`, `npm run ios:sync` y ▶ en Xcode (no hay Swift nuevo).
3. Recorre las comprobaciones **31–39** de `docs/IOS-NATIVE.md` › «Fase 3». La del encargo es la 33: yen, won y yuan
   con las tasas 0.0092, 0.00098 y 0.1923 dan **42,72 $** en total.
4. Apunta si la acción «Registrar pago en Clara» dejó elegir la moneda del importe (JPY) o si hubo que usar «Importe
   como texto».
5. Recorre las comprobaciones **40–45** (Banco de Canadá): enciéndelo en Ajustes › Formato, usa la tasa en el
   formulario y compárala con https://www.bankofcanada.ca/rates/exchange/daily-exchange-rates/, prueba en modo avión y
   con una captura en USD.
6. Si en la 41 o la 44 dice «No se pudo conectar» con conexión, apúntalo: es la única pieza que solo se comprobó con
   `curl` (CORS desde `capacitor://localhost`).

## 5. Pendiente y por qué

- **Banco de Canadá dentro del iPhone:** sin probar (comprobaciones 40–45). En el navegador el banco está simulado; la
  API real solo se leyó con `curl` el 16-nov.
- **Banco de Canadá, lo que no se hizo:** no hay un límite de peticiones documentado (Clara pide una por moneda y
  fecha, una detrás de otra, y no insiste sin conexión); el asistente de texto no usa la tasa del banco (sigue con la
  del viaje, decisión 180: pedir red mientras se escribe no encaja con un asistente local); no hay botón para vaciar la
  caché de tasas (se vacía sola: 300 resultados, y nunca afecta a lo registrado).
- **Probar en el iPhone** todo lo de las Fases 1–3: solo en el Mac y el iPhone de Victor, antes del 15-dic.
- **El borrador del formulario** (lo que se recupera si se cierra a medias) no guarda la sección «Pagado en otra
  moneda»: al recuperarlo, el importe vuelve en la moneda del presupuesto.
- **Abrir una línea del asistente en el formulario** pasa el importe convertido, no el original.
- **Ajustes › Monedas:** no hizo falta: la comisión es de cada viaje (o de cada movimiento).

## 6. Decisiones nuevas

175 (esquema 16 y conversión exacta), 176 (un viaje es un periodo «Viaje» con monedas, moneda local y tasas), 177
(capturas con la tasa del viaje, y solo esa), 178 (formulario: con una tasa o con el cargo real), 179 (Estadísticas y
CSV con el original), 180 (el asistente con la tasa del viaje), 181 (tasas del Banco de Canadá: opcionales, del
dispositivo, solo la serie y dos fechas, sin capa nativa), 182 (orden viaje → banco → cargo real y dónde se usa).
Detalle en `docs/DECISIONS.md`.
