# Fase 3 de Clara nativa: informe

Fase 3 del encargo «Clara nativa para iPhone» (`docs/NATIVE-PLAN.md` §4 quater): **varias monedas y modo viaje**.
PR #20 (`feat/ios-fase-3`, sobre la Fase 2). Fecha: 14 de noviembre de 2026.

> **Estado: escrito y probado en el navegador con un iPhone simulado; sin probar en el iPhone.** No hay Swift nuevo:
> todo es web. Las cifras de las pruebas están calculadas a mano. El Banco de Canadá **no está**: este entorno no puede
> abrir www.bankofcanada.ca y no se escribe contra un formato que no se haya leído (ver §5).

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

`CLAUDE.md`: la regla «una moneda por presupuesto» con el original y la tasa de cada movimiento está **vigente**.

## 2. Archivos principales

- **Dominio:** `src/domain/fx.ts` (tasa exacta, conversión), `fxAdjust.ts` (cargo real, lo que se escribe en el
  formulario, cómo se enseña una tasa), `trips.ts` (viaje en curso, «¥», tasas, vista del viaje, gastado por moneda,
  importe escrito durante un viaje), cambios en `types.ts`, `validation.ts`, `operations.ts`, `periodBudgets.ts`,
  `captureImport.ts`, `assistant.ts`, `csvExport.ts`; `src/storage/backup.ts`, `migrations.ts`.
- **Interfaz:** `src/ui/fxFields.tsx` (sección del formulario, diferida), `tripUi.tsx` y `tripDraft.ts` (viaje),
  `statsCurrency.tsx`, `fxText.ts`, `components/PackBody.tsx` y `packTexts.ts`; cambios en `MovementForm.tsx`,
  `PeriodBudgets.tsx`, `CaptureReview.tsx`, `Assistant.tsx`, `Statistics.tsx`, `Movements.tsx`, `ExportSection.tsx`,
  `format.ts` (`moneyIn`). Textos en los paquetes `fx`, `periods` y `weekly`.
- **Documentación:** `docs/FORMULAS.md` §45–46, `docs/DECISIONS.md` 175–180, `docs/IOS-NATIVE.md` («Fase 3»,
  comprobaciones 31–39), `docs/ROLLBACK.md` (esquema 16), `docs/NATIVE-PLAN.md`, `CLAUDE.md`, `CHANGELOG.md`.

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
- **iPhone:** nada probado. No hay Swift nuevo.

## 4. Qué tengo que hacer yo en mi Mac o iPhone

1. Si aún no está: las Fases 1 y 2 con sus comprobaciones (`docs/IOS-NATIVE.md`, 1–30).
2. `git checkout feat/ios-fase-3`, `git pull`, `npm ci`, `npm run ios:sync` y ▶ en Xcode (no hay Swift nuevo).
3. Recorre las comprobaciones **31–39** de `docs/IOS-NATIVE.md` › «Fase 3». La del encargo es la 33: yen, won y yuan
   con las tasas 0.0092, 0.00098 y 0.1923 dan **42,72 $** en total.
4. Apunta si la acción «Registrar pago en Clara» dejó elegir la moneda del importe (JPY) o si hubo que usar «Importe
   como texto».
5. Si quieres el Banco de Canadá: dime y lo hago desde una sesión en el entorno «clara» (ese sí puede abrir
   www.bankofcanada.ca).

## 5. Pendiente y por qué

- **Banco de Canadá (Valet):** sin hacer. Este entorno bloquea www.bankofcanada.ca y esta sesión no puede pasarse al
  entorno «clara» que lo permite. No se escribe contra un formato de respuesta sin haber leído su documentación
  («no inventes APIs»). Hasta entonces, las tasas se escriben a mano (y no hay ningún botón del Banco de Canadá). Hará
  falta además abrir ese sitio en la CSP de la versión compilada, como excepción opcional y apagada por defecto.
- **Probar en el iPhone** todo lo de las Fases 1–3: solo en el Mac y el iPhone de Victor, antes del 15-dic.
- **El borrador del formulario** (lo que se recupera si se cierra a medias) no guarda la sección «Pagado en otra
  moneda»: al recuperarlo, el importe vuelve en la moneda del presupuesto.
- **Abrir una línea del asistente en el formulario** pasa el importe convertido, no el original.
- **Ajustes › Monedas:** no hizo falta: la comisión es de cada viaje (o de cada movimiento).

## 6. Decisiones nuevas

175 (esquema 16 y conversión exacta), 176 (un viaje es un periodo «Viaje» con monedas, moneda local y tasas), 177
(capturas con la tasa del viaje, y solo esa), 178 (formulario: con una tasa o con el cargo real), 179 (Estadísticas y
CSV con el original), 180 (el asistente con la tasa del viaje). Detalle en `docs/DECISIONS.md`.
