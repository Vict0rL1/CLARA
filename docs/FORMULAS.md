# Fórmulas y decisiones financieras de Clara

Este documento explica **cómo se calcula cada cifra** y qué decisiones tomamos para
evitar errores y dobles conteos. El código que implementa cada regla está en
`src/domain/` (funciones puras, sin interfaz) y está cubierto por pruebas en
`src/domain/*.test.ts`.

> Regla general: **ninguna IA calcula ni modifica saldos.** Todas las cifras salen de
> las fórmulas de este documento.

---

## 0. Saldo, patrimonio, disponible y proyección: qué es cada cifra

Son cifras distintas y la app nunca las mezcla:

| Cifra | Qué incluye | Dónde se ve |
|---|---|---|
| **Saldo de una cuenta** | Saldo de referencia + movimientos realizados posteriores (§3). En una tarjeta es negativo: la deuda. | Ajustes › Cuentas, Conciliar |
| **Saldo para gastar (S)** | Suma de los saldos de las cuentas que **cuentan para el presupuesto**. Una tarjeta incluida resta su deuda. | Explicación de Inicio |
| **Patrimonio neto** | Suma de **todas** las cuentas no archivadas (también ahorro y tarjetas fuera del presupuesto): los saldos positivos son «lo que tienes» y los negativos «lo que debes» (`netPosition`, §4). Las archivadas se informan aparte y no suman. Las pruebas lo usan para comprobar que transferir o apartar no crea ni destruye dinero. | Ajustes › Cuentas (con «¿Cómo se calculó?») |
| **Disponible («Puedes gastar»)** | S − pagos pendientes o vencidos hasta el día del próximo ingreso − apartados del presupuesto (§6, §7). Nunca suma ingresos futuros ni crédito disponible. | Inicio |
| **Proyección** | Parte de S y aplica, día a día, los ingresos y pagos **previstos** (§9). Los apartados no se restan (el dinero sigue en la cuenta); se marca si el saldo proyectado cae por debajo de ellos. Los ingresos retrasados no se suman. | Plan › Proyección |
| **Crédito disponible** | Límite − deuda de una tarjeta. **No es dinero propio**: nunca entra en S, en el disponible ni en el patrimonio. | Tarjeta |

Por eso, por ejemplo, transferir al ahorro baja S y el disponible pero no el patrimonio;
apartar para una meta baja el disponible pero no S ni el patrimonio; y un ingreso previsto
aparece en la proyección pero no en el disponible.

## 1. Dinero: enteros en unidades menores

- Todo importe se guarda como **número entero de unidades menores** (centavos para
  CAD, USD, MXN…; unidades enteras para CLP). Ejemplo: `12,50 $` → `1250`.
- Nunca se usan decimales de punto flotante para sumar, restar o dividir.
  Las divisiones usan aritmética entera (`BigInt`) con redondeo explícito.
- Los decimales de cada moneda están **fijados en el código** (`SUPPORTED_CURRENCIES`),
  no se leen del navegador, para que los datos guardados no cambien de significado.
- Límite por importe: 10¹² unidades menores (10 000 millones de CAD).
- Al escribir importes se aceptan `12,50`, `12.50`, `1,234.56`, `1.234,56`, `$ 45`.
  Si hay un solo separador seguido de exactamente 3 dígitos (`1,234`) se usa el
  formato elegido en Ajustes para decidir si son miles o decimales.
- **Un presupuesto usa una sola moneda.** Cada registro guarda su moneda y se rechaza
  cualquier registro con una moneda distinta. Nunca se suman monedas diferentes.

## 2. Fechas y zona horaria

- **Fechas de calendario** (`LocalDate`, texto `AAAA-MM-DD`): fecha de un movimiento,
  de un pago, de una meta. No tienen hora ni zona.
- **Marcas de tiempo** (`Timestamp`, ISO 8601 en UTC): cuándo se creó o registró algo.
- "Hoy" se calcula con la **zona horaria elegida en Ajustes** (por defecto, la del
  dispositivo). La app vuelve a calcular "hoy" cada 30 segundos y al volver a la
  pestaña, así el cambio de día y de mes se refleja sin recargar.
- La aritmética de días se hace en UTC, por lo que el horario de verano nunca suma
  ni resta un día.

## 3. Saldo actual (sin doble conteo)

Cada cuenta tiene un **saldo de referencia**: el importe que la persona escribe
(copiado de su banco) con su fecha y el momento en que lo registró (`setAt`).

```
Saldo actual de la cuenta = saldo de referencia + Σ efectos de movimientos REALIZADOS posteriores
```

Un movimiento realizado es **posterior** si:

1. su fecha es posterior a la fecha del saldo de referencia, **o**
2. es del mismo día y se marcó como realizado (`realizedAt`) **después** de `setAt`.

Todo lo anterior se considera **ya incluido** en el saldo que escribió la persona.
Consecuencias prácticas:

- Al **actualizar el saldo**, todos los movimientos anteriores quedan incluidos y no
  se vuelven a restar.
- Si registras hoy un gasto que ya aparecía en el saldo que escribiste hoy, marca
  «Ya estaba incluido en el saldo…» y no se resta dos veces.
- Los movimientos **previstos nunca** cambian el saldo.

Efecto de cada tipo sobre una cuenta:

| Tipo | Efecto |
|---|---|
| Ingreso | + importe en su cuenta |
| Gasto | − importe en su cuenta |
| Devolución | + importe en su cuenta (y reduce el gasto de su categoría) |
| Transferencia | − en la cuenta de origen, + en la de destino |

## 4. Cuentas del presupuesto y transferencias

- Cada cuenta indica si **cuenta para el presupuesto** (`includeInBudget`).
- **Archivada** (`archived`, v11): conserva su saldo y todo su historial (sus movimientos siguen en
  Movimientos, marcados «(archivada)» en el filtro), pero **no cuenta para el presupuesto ni para el
  patrimonio** aunque siga marcada como incluida (`isBudgetAccount = includeInBudget && !archived`),
  y no se ofrece para registrar, programar, importar ni conciliar. Un registro nuevo o un cambio de
  cuenta hacia una archivada se rechaza (`accountArchived`); editar lo que ya tenía sigue permitido.
  No se archiva la última cuenta del presupuesto (`lastBudgetAccount`) ni una con pagos programados
  activos (`accountHasSchedules`: no pausados y sin fecha de fin pasada). Con saldo ≠ 0 se puede, y la
  interfaz lo avisa. Restaurar la deja exactamente como estaba.
- **Orden** (`order`, v11): posición en todas las listas y selectores (`sortedAccounts`,
  `activeAccounts`); sin `order`, la posición en la lista. Reordenar (`reorderAccounts`) recibe todos
  los ids una vez y solo cambia `order`.
- **Patrimonio neto** (`netPosition`): activos = Σ saldos > 0 de las no archivadas; pasivos =
  Σ |saldos < 0| (deuda de tarjetas, sobregiros); neto = activos − pasivos; «de esto, para el
  presupuesto» = S. El crédito disponible de una tarjeta nunca es activo.
- **Saldo del presupuesto (S)** = Σ saldos actuales de las cuentas incluidas y no archivadas.
- Las **transferencias entre cuentas propias no son ingresos ni gastos**:
  - entre dos cuentas incluidas → S no cambia;
  - de una cuenta incluida a una excluida (por ejemplo, ahorro) → S baja;
  - de una excluida a una incluida → S sube.

## 5. Pagos e ingresos previstos

Hay dos fuentes de elementos previstos:

1. **Programados** (calendario): únicos o recurrentes (diaria, semanal, cada 2 semanas,
   dos veces al mes, mensual, trimestral, anual o cada N días). «Dos veces al mes» (v13) usa el
   día de `startDate` y `secondDay` (1–31, a 7 días o más del primero); un día que el mes no tiene
   pasa al último (15 y 31 → 15 y 28 de febrero, 29 en bisiesto) y el mes siguiente vuelve al
   original. Sin `secondDay`, `saveSchedule` usa 15 días después (o antes, si no cabe). El campo
   «Segundo día del mes» (`SecondDayField`) es el mismo en programados, configuración inicial y «Repetir»,
   dice siempre los dos días y valida con la misma regla que el dominio (`isValidSecondDay`).
2. **Movimientos con estado «previsto»**.

Cada ocurrencia tiene un estado:

| Estado | Significado | ¿Cuenta en el presupuesto? |
|---|---|---|
| Pendiente | fecha hoy o futura | Pagos: se reservan. Ingresos: **no** se suman. |
| Vencido | fecha pasada, sin marcar | Pagos: se siguen reservando (postura prudente). Ingresos: **no** se suman y se avisa. |
| Pagado / Recibido | existe un movimiento realizado vinculado | Ya está en el saldo; deja de reservarse. |
| Omitido | la persona decidió saltar esa vez | No cuenta. |

**Sin doble conteo:** una ocurrencia está pagada si existe un movimiento realizado con
el mismo `scheduleId` y `occurrenceDate`. Por eso cuenta **o** como reserva **o** como
movimiento, nunca ambas. Marcarla dos veces (o un doble clic) no crea un segundo
movimiento: la operación es idempotente. Si se elimina ese movimiento, la ocurrencia
vuelve a estar pendiente. Al actualizar el saldo se pueden marcar pagos vencidos como
«ya incluidos», y se registran sin volver a restarse.

**Días 29, 30 y 31:** en los pagos mensuales, si un mes no tiene ese día se usa el
**último día del mes**, y el mes siguiente se vuelve al día original
(31-ene → 28/29-feb → 31-mar → 30-abr). En los anuales, el 29-feb pasa al 28-feb en
años no bisiestos.

**Primera fecha:** la «próxima fecha» de un programado es la primera ocurrencia que se
controla; las anteriores no se consideran.

**Topes de recorrido (QA-06, `domain/recurrence.ts` y `domain/planItems.ts`):** una ventana
normal (calendario, reservas hasta el próximo ingreso) se recorre con un tope de 2 000
ocurrencias por programado (`MAX_OCCURRENCES`, ~5 años de un pago diario). Los **vencidos**
desde el inicio del programado se recorren **aparte**, con un tope propio de 20 000
(`OVERDUE_SCAN_LIMIT`, ~55 años de un pago diario): así un programado antiguo con miles de
ocurrencias pagadas nunca consume el tope de la ventana actual y el pago de hoy sigue
reservado. Si aun así se alcanza un tope, el resultado se marca **truncado**
(`truncatedScheduleIds` en el calendario, `incompleteScheduleIds` en `computeBudget`): lo
reservado puede estar incompleto, no se sugiere importe por día ni por semana e Inicio avisa.
Nunca se presenta una cifra incompleta como si estuviera completa.

## 6. Disponible hasta el próximo ingreso

```
Próximo ingreso (I) = primera ocurrencia PROGRAMADA de ingreso, pendiente, con fecha > hoy
Días del periodo (D) = días desde hoy (incluido) hasta I (EXCLUIDO)      → D ≥ 1
Pagos reservados (P) = Σ pagos pendientes y vencidos con fecha ≤ I      (incluye el día I)
Apartados (A)        = Σ dinero apartado en metas que se descuentan del presupuesto
Colchón (C)          = settings.safeToSpend.bufferMinor (v13; 0 por defecto)
Disponible           = S − P − A − C
Por día              = floor(Disponible / D)                (0 si Disponible ≤ 0)
Por semana           = floor(Disponible × min(7, D) / D)    (0 si Disponible ≤ 0)
```

Decisiones:

- **El día del ingreso queda EXCLUIDO del periodo** (ese día ya cuenta con el dinero
  nuevo), pero **los pagos de ese mismo día SÍ se reservan**, porque el dinero puede
  llegar después de que se cobre el pago.
- **Los ingresos futuros nunca se suman** al disponible. Solo cuenta el dinero que ya
  está en las cuentas.
- Solo los **ingresos programados** definen el periodo. Un ingreso previsto suelto
  (por ejemplo, un reembolso de un amigo) no acorta el periodo.
- **Ingreso de hoy sin marcar:** no se cuenta; el periodo va hasta el siguiente
  ingreso programado y se muestra un aviso para marcarlo como recibido.
- **Ingreso retrasado** (fecha pasada sin marcar): no se cuenta; se muestra un aviso
  con acciones «Marcar como recibido», «No llegará (omitir)» y «Cambiar fecha».
- **Sin próximo ingreso:** no se divide entre cero. Se pide agregar un ingreso o
  elegir un **horizonte** (7, 14 o 30 días); con horizonte, D = días elegidos y se
  reservan los pagos hasta esa fecha.
- **Con un periodo de calendario (§31) el horizonte en días no participa:** D = días que
  quedan del periodo (hoy incluido) y el último día del periodo está INCLUIDO. La explicación
  (resumen de la configuración, Inicio) describe el horizonte que `computeBudget` devolvió
  (`horizon.source`: `income`, `fallback` o `period`), nunca un valor del formulario que no
  participó en el cálculo; el selector de días solo se muestra con «hasta mi próximo ingreso»
  y `fallbackHorizonDays` solo se guarda si se mostró (UX-02, decisión 140).
- **Colchón de seguridad (C, Clara 2.0 §10):** dinero que la persona quiere conservar siempre. Se
  resta del disponible (y, en un periodo de calendario, de `committedFor`, aunque no se resten
  programados ni metas), pero **no es un gasto, no mueve dinero y no cambia ningún saldo**. Con
  C = 0 las cifras son exactamente las de antes. Se explica en «¿Cómo se calculó?» y en la barra
  de composición (segmento neutro, con texto, nunca solo color). Si el disponible es negativo pero
  Disponible + C ≥ 0, pagos y apartados están cubiertos: Inicio muestra un **aviso** («Estás usando X
  de tu colchón de C»), no la alarma de faltante; la alarma solo aparece si Disponible + C < 0 y su
  importe es −(Disponible + C). El historial registra `settings.safeToSpend` como ajuste financiero,
  así «¿Qué cambió?» atribuye un cambio del colchón al paso «ajustes» y se puede revertir.
- **Redondeo hacia abajo** en «por día» y «por semana»: así nunca se sugiere gastar
  más de lo disponible.
- **Saldo negativo:** se permite (sobregiro). El disponible puede ser negativo; en ese
  caso por día = 0 y se muestra cuánto falta.
- **Saldo antiguo:** si el saldo de referencia tiene 3 días o más, se avisa.

Ejemplo (la demo): S = 901.57; P = 42.80 (vencido) + 650.00 + 11.99 = 704.79;
A = 60.00 → Disponible = 136.78; D = 6 → por día = floor(136.78 / 6) = 22.79.

## 7. Metas y apartados virtuales

- Un apartado **no mueve dinero en el banco**; solo marca una parte del saldo.
- Metas **«del presupuesto»**: su dinero apartado se resta del disponible.
- Metas **«en otra cuenta»**: el dinero ya está fuera del presupuesto; solo se
  registra el progreso y **no se resta** (evita descontarlo dos veces).
- **No se puede apartar dos veces el mismo dinero:** un apartado nuevo en una meta del
  presupuesto no puede superar el disponible libre (S − P − A). Tampoco se puede
  apartar más de lo que le falta a la meta ni liberar más de lo apartado.
- Cada apartado tiene un identificador; reintentar la misma operación no la duplica.

Cuota necesaria (si la meta tiene fecha):

```
Restante      = objetivo − apartado
Semanas       = max(1, ceil(días hasta la fecha / 7))
Meses         = max(1, meses completos hasta la fecha)
Por semana    = ceil(Restante / Semanas)
Por mes       = ceil(Restante / Meses)
Por ingreso   = ceil(Restante / nº de ingresos programados hasta la fecha)
```

Se redondea **hacia arriba** al centavo para llegar a tiempo.

## 8. «¿Me alcanza?» (simulación)

La simulación **no modifica ningún registro**. Registrar la compra requiere pulsar
«Registrar esta compra» y luego «Guardar» en el formulario.

```
Disponible después = Disponible − Precio
Por día después    = floor(Disponible después / D)   (0 si ≤ 0)
```

| Veredicto | Condición |
|---|---|
| Sí, te alcanza | Disponible después ≥ la mitad del disponible actual **y** la proyección a 30 días no baja de cero |
| Te alcanza, pero queda justo | Disponible después ≥ 0, pero usa más de la mitad o la proyección a 30 días baja de cero |
| Solo alcanza usando tu colchón | (v13) Colchón > 0, Disponible después < 0 pero Disponible después + colchón ≥ 0 |
| Solo alcanza usando dinero apartado | Disponible después (+ colchón) < 0 pero Disponible después + colchón + apartados ≥ 0 |
| No te alcanza por ahora | Ni con los apartados alcanza |

Si la proyección ya bajaba de cero **antes** de la compra, se dice explícitamente
(la compra no es la causa, pero empeora el mínimo).

## 9. Proyección a 30 días

```
Punto de partida = S (saldo REAL de hoy)
Para cada día d (hoy … hoy+29):
  saldo(d) = saldo(d−1) + Σ ingresos previstos de d − Σ pagos previstos de d − gasto diario estimado
```

Suposiciones (se muestran en pantalla):

- Los pagos vencidos sin marcar se restan hoy.
- Los ingresos retrasados **no** se suman.
- Los importes aproximados se usan tal cual y se señalan.
- El gasto diario estimado es opcional: por defecto, el promedio de gastos
  variables realizados (sin pagos programados, sin transferencias, menos
  devoluciones) de los últimos 30 días, excluyendo hoy. Con menos de 7 días de
  historial no se ofrece el promedio.
- Los apartados no se restan (el dinero sigue en la cuenta), pero se avisa si el
  saldo proyectado cae por debajo de ellos.
- El gráfico distingue el **punto real de hoy** (círculo) de la **proyección** (línea
  discontinua). Hay una tabla con los mismos valores.

## 10. Devoluciones y tarjetas de crédito

- Una **devolución** suma al saldo. Si se vincula a un gasto, la suma de devoluciones
  no puede superar el importe del gasto (devoluciones parciales permitidas).
- **Tarjeta de crédito** = cuenta de tipo `credit` cuyo saldo es la **deuda**, guardada
  como número negativo (deber 100.00 → `-10000`). En pantalla se escribe y se muestra
  la deuda en positivo («Debes $100.00»).
- **Compra con tarjeta** = gasto de la cuenta tarjeta (la deuda crece).
- **Pago de la tarjeta** = **transferencia** desde el banco hacia la tarjeta. No es un
  gasto: así la compra se cuenta una sola vez.
- Si la tarjeta **cuenta para el presupuesto** (recomendado), su deuda se resta de S y
  el disponible baja en el momento de la compra; el pago posterior no cambia S.
  Si no cuenta, la compra no afecta hasta que se paga (la transferencia baja S).
- Una cuenta no puede convertirse en tarjeta ni al revés (cambiaría el signo del saldo).
- Datos opcionales de la tarjeta (`card`): límite, tasa anual, día de corte, día de
  pago y regla del pago mínimo. Con ellos se muestra (sin cambiar el disponible):

```
Deuda                     = max(0, −saldo)
Crédito disponible        = límite − deuda            (negativo = sobre el límite)
Pago mínimo ESTIMADO      = min(deuda, max(importe fijo, ceil(deuda × % / 100)))   (por defecto 3 % y 10,00)
Interés de un mes ESTIMADO = ceil(deuda × tasa anual / 12)   (si no se paga nada)
Próximo corte / pago      = el día indicado de este mes o del siguiente; en meses cortos, el último día
```

- Las tasas y porcentajes se guardan como **enteros en puntos básicos**
  (19,99 % = 1999), sin decimales flotantes.
- Son estimaciones orientativas: los bancos calculan con saldo diario promedio y
  reglas propias. La app lo dice junto a cada cifra.
- Recordatorio dentro de la app: si hay deuda y el pago vence en los próximos 7 días.

## 10 b. Categorías personalizadas

- Además de las fijas, la persona puede crear categorías de gasto o de ingreso
  (id `c_…`, nombre único por tipo). El tipo no cambia después de crearlas.
- **Archivar** la oculta de los formularios; los movimientos antiguos siguen siendo
  válidos y conservan su nombre. Solo se puede **eliminar** si nadie la usa.
- Las devoluciones usan las categorías de gasto (fijas y personalizadas).

## 10 c. Resumen mensual (Movimientos)

```
Ingresos del mes          = Σ ingresos realizados del mes
Gasto neto de categoría   = Σ gastos realizados − Σ devoluciones realizadas del mes
Gasto neto del mes        = Σ gasto neto de todas las categorías
```

Las transferencias (incluidos los pagos de tarjeta) y los previstos no cuentan.
Incluye todas las cuentas, también las que están fuera del presupuesto.

**Límites mensuales por categoría** (opcionales, solo categorías de gasto):

```
Gastado     = max(0, gasto neto de la categoría en el mes)
Queda       = límite − gastado        (negativo = «pasado por»)
Cerca       = gastado ≥ 80 % del límite y sin pasarse
```

Son informativos: **no** cambian «Puedes gastar». Inicio avisa si en el mes actual
alguna categoría se pasó de su límite.

## 10 d. Importar movimientos del banco (CSV)

El archivo se lee **solo en el dispositivo** (`src/domain/bankImport.ts`); nada se
guarda hasta confirmar la vista previa. Límites: 2 MB y 5000 filas.

- **Lectura:** separador `,`, `;` o tabulador (el más frecuente fuera de comillas),
  comillas dobles con `""`, CRLF, BOM; UTF-8 o, si no lo es, Windows-1252.
- **Fechas:** `AAAA-MM-DD` (también `/`, `.`, compacta o con hora), día/mes/año,
  mes/día/año y `28 Sep 2026`. Solo se proponen los formatos con los que **todas** las
  fechas son válidas; si caben día/mes y mes/día, la persona elige.
- **Importe:** con `parseMoney` (enteros, sin flotantes) y el formato numérico de
  Ajustes. Una columna con signo (− = gasto) o dos columnas (cargo resta, abono suma,
  sin importar su signo). `(12.34)` = −12.34. Opción de invertir el signo (tarjetas).
  Positivo → ingreso; negativo → gasto; cero, fecha futura o inválida → fila con error.
- **Moneda (QA-05):** Clara no convierte. Una moneda escrita que no es la del presupuesto
  es una fila con error `currency` (se muestra la marca encontrada y la esperada), nunca se
  asume la del presupuesto. Se reconoce: un **código** junto al importe (`USD 100`,
  `100 EUR`), un **prefijo con dólar** (`CA$`, `US$`, `R$`), un **símbolo** suelto
  (`€12`, `12,50 €`, `¥100`) y una **columna de moneda** del archivo (cabecera
  «Moneda», «Currency», «Devise», «Ccy»…, detectada sola o elegida). Un símbolo suelto se
  acepta solo si puede ser el de la moneda del presupuesto: `$` vale para CAD, USD, MXN,
  COP, CLP, ARS, AUD o BRL y no para EUR, GBP, JPY, PEN o CHF; `€` solo para EUR; `¥`
  para JPY y CNY. Cualquier otro símbolo de moneda (`₽`, `₹`, `₩`…) se lee igual, y también un
  nombre sin ambigüedad (`10 euros`, `10 pesos`, `10 pounds sterling`; no «libra» ni «pound» sueltos,
  que también son pesos). Un código que no es una moneda conocida (`XYZ 10`) también es error. La
  persona puede declarar la **moneda de todo el archivo**: si no es la del presupuesto,
  ninguna fila se importa; si coincide, es como no decirlo. Las columnas de cargo y abono
  siguen la misma regla cada una. Los movimientos importados llevan siempre la moneda del
  presupuesto (§11), y la vista previa dice cuánto cambiará el saldo con las filas marcadas
  posteriores al saldo de referencia.
- **Huella** `importRef`. Con **referencia del banco** (columna opcional: «Referencia»,
  «Transaction ID», «FITID», «Número de operación»…, detectada sola solo con cabecera exacta o
  elegida): `cuenta | ref | referencia | fecha | importe con signo | nº de repetición`. Sin ella:
  `cuenta | fecha | importe con signo | descripción normalizada COMPLETA | nº de repetición`
  (minúsculas, sin acentos, espacios simples; hasta 200 caracteres). El nº de repetición
  distingue dos filas idénticas del mismo archivo (dos cafés iguales el mismo día). Siempre se
  calcula también la huella por contenido, así que reimportar con o sin la columna de referencia
  no duplica.
- **Duplicado exacto:** ya existe un movimiento con alguna de las huellas de la fila → no se
  puede importar. Importar dos veces el mismo archivo, reordenado o solapado, no crea nada.
- **Huellas anteriores (80 caracteres):** hasta octubre de 2026 la descripción se cortaba en 80
  caracteres y dos filas distintas que empezaban igual chocaban (la segunda se omitía). Se siguen
  reconociendo: un movimiento importado (o en la papelera) de la misma cuenta, fecha e importe con
  los mismos 80 primeros caracteres es duplicado (o «en la papelera») si su nota es idéntica a la
  descripción completa, y **posible duplicado** si no lo es. Una huella antigua cuyo contenido no
  se puede comprobar (nota editada) también es posible duplicado; nunca se reimporta en silencio.
  Una fila con referencia del banco no se empareja así con otra que tenía otra referencia.
- **Posible duplicado:** movimiento realizado de la misma cuenta, mismo tipo e importe,
  fecha a ±3 días y sin huella (registrado a mano), o el caso anterior. Cada movimiento
  empareja una sola fila. Se muestra **desmarcado**.
- **Más de 5000 filas:** se analizan las primeras 5000; la vista previa da el total, cuántas
  quedan fuera y qué líneas (p. ej. «las filas 5,002 a 5,004 (3)»). Importar exige marcar «Entiendo
  que N filas quedan fuera» y el aviso final lo repite. Lo marcado vale solo para esa vista previa
  (RT-03): elegir otro archivo —aunque se llame igual— o leer la primera fila de otra forma deja la
  casilla sin marcar; cancelar el selector no cambia nada. Las restantes se importan en otro archivo
  (lo ya importado se reconoce como duplicado).
- **Filas con error** (fecha, importe, cero, futura, moneda, demasiado grande): se muestran con su
  motivo y nunca se importan; no impiden importar las demás filas marcadas.
- **Saldo:** se guardan como realizados y siguen la regla del §3. Las filas anteriores a
  la fecha del saldo de referencia quedan como historial y no cambian el saldo. Las del
  mismo día: por defecto «ya incluidas» (`realizedAt = setAt`), con casilla para cambiarlo.
- **Todo o nada:** si una fila elegida no pasa la validación, no se importa ninguna.
  «Deshacer» quita exactamente los movimientos creados. Editar un movimiento importado
  conserva su huella.

## 10 e. Reglas de categoría

```
coincide  = normalizar(descripción) contiene normalizar(texto de la regla)
normalizar = minúsculas, sin acentos, espacios simples
```

- Solo se consideran reglas del mismo tipo (gasto o ingreso; las devoluciones usan las
  de gasto) cuya categoría exista y no esté archivada. El texto tiene al menos 2
  caracteres y no se repite para el mismo tipo.
- Si varias coinciden, gana el texto **más largo** («uber eats» antes que «uber»); si
  empatan, la regla más antigua.
- Una regla solo **propone**: en la importación CSV (cada fila, cambiable) y en la nota de
  un movimiento nuevo mientras no se elija la categoría a mano. Nunca cambia movimientos
  guardados ni importes. Al eliminar una categoría personalizada se quitan sus reglas.
- **Aprender de una corrección (Clara 2.0 §7, `suggestRuleFromCorrection`):** si al guardar la
  categoría final es distinta de la que se proponía (la de la regla aplicada a la nota, o la que
  tenía el movimiento antes de editarlo), el aviso de «guardado» **ofrece** «Recordar» una regla con
  la descripción entera (2–40 caracteres, con alguna letra). Nunca se guarda sola: solo al pulsar,
  con «Deshacer». No se ofrece con transferencias, ajustes ni divisiones, si ya existe una regla con
  ese texto y tipo, ni si la regla nueva no ganaría para ese texto (patrón más largo).
  En la revisión del asistente se juntan las correcciones de todas las líneas
  (`suggestRulesFromCorrections`): una propuesta por texto y tipo, ninguna si dos líneas corrigen el
  mismo texto a categorías distintas; «Recordar» las guarda todas o ninguna (`saveCategoryRules`) y
  «Deshacer» quita exactamente esas. En la importación CSV, cambiar la categoría que proponía una regla
  muestra «Crear regla» con el diálogo ya relleno (existía antes de Clara 2.0).

## 11. Integridad de datos

- Identificadores únicos (UUID v4) generados al abrir cada formulario: guardar dos
  veces actualiza el mismo registro (idempotencia).
- Un movimiento realizado no puede tener fecha futura.
- La importación de copias valida todo el archivo (tipos, importes enteros, moneda,
  fechas reales, referencias entre registros, duplicados) y **no aplica nada si hay un
  solo error**.

## 12. Papelera

- Eliminar un movimiento lo **saca de `transactions`** y lo guarda en `trash` con la fecha
  de eliminación. Por eso deja de contar en saldos, disponible, proyección, resúmenes,
  límites y conciliaciones sin que cada cálculo tenga que acordarse de filtrarlo.
- La papelera es persistente (se guarda con los datos y en las copias de seguridad). No hay
  borrado automático por antigüedad: solo «Eliminar definitivamente» (uno) o «Vaciar
  papelera» (todos), ambos con confirmación explícita.
- **Transferencias**: son un único registro con origen y destino, así que se eliminan y
  restauran completas (ambas cuentas a la vez, de forma atómica).
- **Devoluciones**: si se elimina un gasto, sus devoluciones siguen contando (el dinero sí
  volvió) pero pierden el vínculo; la lista se guarda en la papelera y al restaurar el
  gasto se vuelven a vincular si siguen existiendo, sin vínculo y sin superar el importe.
  Una devolución restaurada cuyo gasto ya no existe (o no admite más devoluciones) se
  restaura **sin vínculo**. Nunca quedan referencias rotas.
- **Pagos del calendario**: eliminar el movimiento que liquidó una ocurrencia la deja otra
  vez pendiente o vencida (vuelve a reservarse). Si después se registra otro pago para esa
  misma ocurrencia, restaurar el primero se **bloquea** (`occurrenceAlreadySettled`): se
  contaría dos veces.
- **Ajustes de conciliación**: eliminarlos deja la conciliación «pendiente de revisión».
- **Importaciones CSV**: una fila cuyo movimiento está en la papelera aparece como «En la
  papelera» y no se puede importar (se restaura desde la papelera). Al eliminar
  definitivamente solo se conserva su huella `importRef` (sin importes ni descripciones);
  si se vuelve a importar el archivo, la fila aparece «Eliminado antes», **desmarcada**.
- No se puede eliminar una cuenta ni una categoría usada por movimientos de la papelera.
- «Deshacer» tras eliminar es un acceso rápido a la misma restauración. Deshacer una
  creación (marcar pagado, importar) descarta el registro sin pasar por la papelera.

## 13. Favoritos

- Plantilla de gasto o ingreso: nombre, tipo, cuenta, categoría, importe y nota opcionales,
  y un orden. Abrir un favorito rellena el formulario con la **fecha de hoy**; la persona
  revisa y pulsa Guardar. No es un pago recurrente y **nunca crea movimientos solo**.
- Si su cuenta ya no existe o su categoría fue archivada o eliminada, el formulario deja
  ese campo vacío y pide elegir uno válido; guardar sin elegir da error.
- El id se genera al abrir el diálogo: pulsar Guardar dos veces actualiza el mismo favorito.

## 14. Conciliación de saldos

```
Saldo calculado al final del día D = saldo de referencia
                                   + Σ movimientos REALIZADOS aplicados a ese saldo con fecha ≤ D
Diferencia = saldo observado − saldo calculado
```

- D ≥ fecha del saldo de referencia (antes de esa fecha la app no conoce el saldo) y D ≤ hoy.
- Solo movimientos realizados; nunca previstos ni pagos programados. La regla de «ya
  incluido en el saldo» (§3) es la misma que usa el saldo actual, así que para D = hoy el
  saldo calculado coincide con el saldo de la cuenta.
- **Qué saldo comparar**: el contabilizado o «actual» del banco al final de ese día. El
  «disponible» puede descontar retenciones o movimientos pendientes; esos pendientes
  pueden explicar una diferencia.
- **Tarjetas**: el saldo es negativo = deuda. La persona escribe lo que debe (positivo) y se
  guarda en negativo. El crédito disponible nunca se compara: no es dinero propio.
- **Resolución**: `matched` (diferencia 0), `unresolved` (se guarda la diferencia para
  revisarla) o `adjusted`. Nunca se cambia el saldo de referencia ni se crea un ajuste
  sin confirmación.
- **Ajuste** (`kind: 'adjustment'`): importe = |diferencia|, fecha D, dirección sube/baja,
  motivo obligatorio y `reconciliationId`. Corrige el saldo de la cuenta (y el disponible
  si la cuenta está en el presupuesto) pero **no es ingreso ni gasto**: no entra en el
  resumen del mes, límites, promedio de gasto diario ni proyección de ingresos.
- **Huella**: al conciliar se guarda una huella del saldo de referencia y de los
  movimientos (id, tipo, importe, fecha, cuentas) que forman el saldo hasta D. Si cambia
  (editar importe o fecha, eliminar, restaurar, añadir un movimiento con fecha ≤ D), la
  conciliación pasa a «pendiente de revisión». Cambiar solo una nota no la altera. Un
  saldo de referencia posterior a D la deja «reemplazada».
- **Inicio** muestra por separado «Último movimiento registrado» (fecha del último
  movimiento realizado) y «Saldos verificados» (fecha verificada más antigua entre las
  cuentas del presupuesto, o cuántas faltan). La antigüedad se muestra en días, sin
  porcentajes de confianza inventados.

## 15. Recordatorio de copia de seguridad

- Guardar en el navegador **no es una copia de seguridad**.
- `lastExportAt`: la app generó el archivo y **pidió** al navegador descargarlo; no puede
  comprobar dónde se guardó. Si generar o pedir la descarga falla, no se registra nada.
- `lastVerifiedAt`: la persona eligió un archivo y la app comprobó que es una copia válida
  de **este** presupuesto (`budgetId`). No se importa nada.
- Cambios sin respaldar = `updatedAt` de los datos > `updatedAt` en el momento de exportar.
  Registrar copias, verificarlas o posponer no cuentan como datos nuevos.
- Recordatorio (semanal por defecto; mensual o desactivado): aparece solo en Inicio si hay
  cambios sin respaldar y pasaron 7 / 30 días desde la última exportación (o desde que se
  crearon los datos si nunca se exportó). «Recordar en 7 días» lo pospone. No se muestra
  con datos de demostración y no usa notificaciones del sistema.

## 16. Ingresos variables

- Un ingreso programado puede tener rango: **mínimo ≤ esperado ≤ extra** (enteros ≥ 0; el
  esperado es el importe principal y debe ser > 0). Incluso el mínimo es una estimación.
- **Disponible** (§6): no cambia. Nunca suma ingresos futuros en ningún escenario.
- **Proyección** (§9): usa el escenario elegido; por defecto el **mínimo** (prudente). La
  tabla «Comparar escenarios» muestra, para cada uno, ingresos estimados, saldo más bajo,
  saldo final y primer faltante. «¿Me alcanza?» también usa el mínimo. Cambiar de
  escenario nunca modifica movimientos ni saldos reales.
- **Retrasado**: si pasa la fecha sin registrarlo, queda «vencido»: no se suma al
  disponible ni a la proyección (§9) y el periodo pasa a terminar en el siguiente ingreso
  pendiente. Inicio avisa y ofrece registrarlo, omitirlo o cambiar la fecha.
- **Importe distinto**: se registra lo real y la ocurrencia se cierra con ese importe.
- **Parcial**: si llega menos de lo que falta, la persona elige:
  - «Espero el resto»: movimiento con `partialSettlement: true`; la ocurrencia sigue
    abierta por `esperado − recibido` (y en la proyección, `escenario − recibido`, nunca
    negativo). Se pueden registrar más parciales y una liquidación final.
  - «Dar por terminado»: se cierra con lo recibido (el último parcial pasa a ser final,
    sin crear movimientos).
- Como mucho **una** liquidación final por ocurrencia (se valida también en las copias).
- **Vincular**: al registrar un ingreso (o gasto) a mano, el formulario ofrece vincularlo
  con una ocurrencia abierta cercana; así la previsión queda liquidada y no se cuenta dos
  veces. Una ocurrencia ya cerrada no se ofrece.

## 17. Formato de datos y migraciones

- Versión actual: **13**. Migraciones encadenadas v1 → … → v13 en
  `src/storage/migrations.ts`, con pruebas.
- v4 → v5 añade `trash`, `purgedImportRefs`, `favorites`, `reconciliations` y `backup`
  solo si **faltan**; si existen con un formato incorrecto se conservan para que la
  validación rechace el archivo. Nunca se borran datos para resolver un error de esquema.
- v5 → v6 añade `periodBudgets: []`, `scenarios: []` y `settings.weeklyReview: true`
  solo si faltan (una preferencia ya guardada se respeta). Las metas antiguas no cambian:
  `allocations[].reason` y `goal.plan` son opcionales.
- v6 → v7 añade `inbox: { snoozed: [], dismissed: [] }` e `incomeDistributions: []` solo
  si faltan. Las compras divididas (`transactions[].splits`), `allocations[].distributionId`
  y `trash[].unlinkedRefundSplits` son opcionales: los datos anteriores no cambian.
- v10 → v11 añade a cada cuenta `archived: false` y `order: <posición>` solo si **faltan**; una
  cuenta ya archivada u ordenada no cambia y una entrada mal formada se conserva tal cual para que
  la validación la señale. Ningún importe, fecha ni movimiento se toca: las cifras son las mismas
  antes y después (`migrations.test.ts`, `roundtrip.test.ts`, `migration-main.spec.ts`).
- v11 → v12 añade a cada límite (`plans[]`) `rollover: 'none'` solo si **falta**; `carriedMinor` es
  opcional y solo lo escribe la renovación de un límite con arrastre. Ningún importe, fecha ni
  movimiento se toca (`stage3.test.ts`, `migration-main.spec.ts`).
- v12 → v13 añade `settings.safeToSpend.bufferMinor = 0` solo si **falta** (un valor ya guardado se
  respeta y unos ajustes mal formados se conservan tal cual para que la validación los señale). Con 0
  el disponible es idéntico al de v12. Son opcionales y no necesitan migración: `schedules[].secondDay`
  (solo con `frequency: 'semimonthly'`), los tipos de cuenta `wallet`, `prepaid` e `investment` y
  `accounts[].institution` (texto, nunca una conexión) y `plans[].alertLevels` (avisos 50/75/90). Una versión v12 no sabe leer esos valores, por
  eso el número sube y no se vuelve atrás (`docs/ROLLBACK.md`). Pruebas: `clara2.test.ts`,
  `ledger.property.test.ts`, `tests/e2e/clara2.spec.ts`.
- Antes de guardar por primera vez datos migrados, se conserva el texto original en
  `localStorage` (`margen.data.before-v<versión nueva>`, hoy `before-v13`).
- Datos o copias de una versión futura se rechazan (`schemaTooNew`) sin tocar los datos
  actuales; si una migración falla, se informa (`migrationFailed`) y no se modifica nada.
- Copias, importación y «Borrar todos los datos» incluyen las entidades nuevas
  (presupuestos por periodo, escenarios y el plan de los gastos planificados); la
  importación valida todo el archivo y no aplica nada si hay un error.

## 18. Gastos planificados (anuales o poco frecuentes)

Son metas con `kind: 'expense'` y `plan` (`src/domain/plannedExpenses.ts`). Reutilizan
los apartados, así que nunca hay una segunda reserva:

- **Plan sugerido** (solo cálculo, no aparta nada): por semana = `ceil(falta / semanas)`,
  por mes = `ceil(falta / meses)` (mismo cálculo que las metas, §7).
- **Confirmado** = suma de `allocations` (aportes confirmados − liberaciones − usos).
  Solo esto se descuenta de «Puedes gastar» (si la meta es del presupuesto).
- Estado: *Pagado* (ciclo único ya pagado) › *Cubierto* (apartado ≥ objetivo) ›
  *Vencido* (hoy ≥ vencimiento) › *Vence en menos de una semana* (< 7 días) › *En camino*.
- **Vínculo opcional** con una ocurrencia abierta de un gasto programado: la fecha pasa
  a ser la de la ocurrencia y esa ocurrencia **no se reserva dos veces**: su reserva en
  el disponible se reduce en lo que la meta ya cubre (`reserves.ts`, `scheduleCoverage`):
  `reserva de la ocurrencia = importe − min(importe, apartado de la meta)`.
  Una ocurrencia solo puede estar vinculada a una meta.
- **Pagada desde el calendario (u otro formulario) sin cerrar el gasto planificado:** lo
  pagado de esa ocurrencia (incluidos pagos parciales, con efecto sobre las cuentas del
  presupuesto) **consume** lo apartado en el cálculo, aunque la persona aún no lo haya
  cerrado: `reserva efectiva = max(0, apartado − pagado)` (`linkedPaidFromBudgetPool`).
  En versiones anteriores la reserva seguía descontándose y el pago restaba dos veces
  hasta cerrar el aviso de la bandeja (corregido; prueba en `independent.test.ts` §6).
  Cerrar («Cerrar con el pago registrado») ya no cambia «Puedes gastar»: libera el
  sobrante y guarda el ciclo en el historial.
- **Aportar a un gasto vinculado** (`maxBudgetAllocation`): la parte que cubre un pago ya
  reservado no cuesta dinero libre (solo pasa de «reservado para el pago» a «apartado en la
  meta»): `máximo = min(falta, parte neutral + dinero libre)`.
- **Pagar** (una operación, idempotente por el id del gasto generado al abrir el diálogo):
  1. registra el gasto real (o liquida la ocurrencia vinculada con `markOccurrence`);
  2. usa de la reserva `min(apartado, pagado)` (`reason: 'payment'`);
  3. sobrante `apartado − pagado`: se **libera** (`reason: 'release'`) o, si se repite,
     se puede **guardar para el siguiente periodo**; faltante `pagado − apartado`: sale
     del dinero disponible como cualquier gasto y se avisa antes de confirmar;
  4. guarda el ciclo en `plan.history` (vencimiento, objetivo, apartado, pagado, gasto,
     decisión). Si se repite cada *N* meses, el vencimiento avanza *N* meses (o a la
     siguiente ocurrencia vinculada) **sin marcarse como financiado**; si no se repite,
     queda como pagado.

## 19. Presupuestos por periodo (semestre, viaje, personalizado)

`src/domain/periodBudgets.ts`. Una moneda (la del presupuesto).

- **Gastado** = Σ gastos realizados asociados − Σ devoluciones realizadas asociadas.
  Las devoluciones de un gasto asociado cuentan aunque no se asocien.
- **Restante** = asignado − gastado (negativo = excedido, con aviso).
- **Por día** = `floor(restante / días que quedan)`, contando hoy y el último día;
  **por semana** = `mulDivFloor(restante, min(7, días), días)`. Periodo futuro: días
  totales. Terminado: sin cuota.
- **Asignado ≠ disponible:** crear o editar un presupuesto no crea ingresos,
  transferencias ni reservas. Solo «Reservar dinero» (opcional) crea o reutiliza una meta
  del presupuesto vinculada (`goalId`) y aparta dinero con el control habitual de dinero
  libre. Lo gastado en el periodo desde cuentas del presupuesto va **consumiendo** esa
  reserva: `reserva efectiva = max(0, apartado − gastado del periodo)`, para que el
  mismo dinero no se descuente dos veces (una por el gasto y otra por la reserva).
- **Asociación:** solo se guarda el id (`txIds`); el movimiento no se copia ni cambia.
  Solo gastos y devoluciones (transferencias, ingresos y ajustes no).
- **Fuera de fechas:** un movimiento asociado fuera del rango cuenta (se asoció a
  propósito) y se señala. **Previstos** asociados se muestran aparte y no cuentan como
  gastado. **Papelera:** no cuenta; al restaurarlo vuelve a contar; al purgarlo se quita
  la asociación.
- **Sugerencias:** gastos y devoluciones sin asociar **dentro de las fechas** (opcionalmente de
  una categoría). Solo se proponen; «Asociar N gastos sugeridos» los asocia en una operación
  (todo o nada) y se puede deshacer.
- **Regla opcional** (`ruleCategoryIds`): al registrar un gasto o devolución de esas
  categorías dentro de las fechas de un periodo activo, el formulario **marca** el periodo
  como propuesta (`periodsProposedFor`); la persona puede desmarcarlo. Nunca se asocia
  nada sin guardar el formulario.
- **Solapados:** un movimiento en dos presupuestos cuenta en cada uno, pero en el total
  combinado (`consolidatedSpent`) **una sola vez**.
- **Archivar** conserva todo el historial y deja de ofrecerlo en el formulario de
  movimientos; eliminar no toca movimientos ni la meta de reserva y se puede deshacer.

## 20. Revisión semanal

`src/domain/weeklyReview.ts`. Reglas fijas, sin IA; solo dentro de la app (se puede
ocultar en Inicio o en Ajustes; no hay correos ni notificaciones).

- Semana = **lunes a domingo** en fechas de calendario de la zona horaria elegida.
- Ingresos = ingresos realizados; gasto = gastos − devoluciones realizados; balance =
  ingresos − gasto. Transferencias hacia cuentas fuera del presupuesto se muestran como
  «a ahorro» y los apartados para metas aparte: **no son gasto**. Los ajustes de
  conciliación y los previstos no cuentan.
- **Comparación equivalente:** semana en curso = lunes…hoy contra lunes…el mismo día de
  la semana anterior; semanas cerradas = 7 contra 7 días.
- **Datos faltantes:** «desde cuándo hay registros» = el menor entre la fecha de alta,
  los saldos de referencia y el primer movimiento. Si una semana empieza antes, se marca
  «faltan datos» y no se compara. Sin movimientos no significa «sin gastos».
- **Porcentaje** = `floor(diferencia × 100 / anterior)` solo si ambas semanas tienen datos
  completos y la anterior tiene movimientos y es > 0. Nunca se divide entre cero.
- Próximos pagos: 7 días desde hoy (solo en la semana en curso). Metas: progreso real
  (apartado) y lo apartado esa semana (sin contar los usos al pagar).

## 21. Comparador de escenarios

`src/domain/scenarios.ts`. Amplía «¿Me alcanza?» reutilizando `computeBudget` y
`projectBalance`.

- Cada escenario se evalúa sobre una **copia** de los datos: una compra = gasto
  **previsto simulado** en la cuenta elegida (por defecto, la primera del presupuesto) y la
  fecha elegida; cambiar
  un pago programado = otro importe para todas sus ocurrencias; un **ingreso hipotético**
  = ingreso **previsto simulado**: cambia el saldo proyectado y el posible faltante, pero
  «Puedes gastar» nunca lo suma (los ingresos futuros no se cuentan, §6). Guardar, editar o
  eliminar escenarios solo toca `scenarios`.
- Situación actual y hasta **3** escenarios con las **mismas hipótesis**: horizonte (30,
  60 o 90 días), escenario de ingresos variables (mínimo por defecto) y gasto diario
  estimado.
- Resultados: saldo al final, saldo más bajo y su fecha, faltante posible
  (`max(0, −más bajo)`) desde el primer día negativo, «Puedes gastar» y su diferencia con
  la situación actual, y primer día en que se tocaría lo apartado para metas.
- **Datos cambiados:** al guardar se registra una huella (FNV-1a) de cuentas,
  movimientos, programados, metas, presupuestos por periodo y horizonte. Si la huella
  actual es distinta, el escenario se recalcula igualmente y se marca «Datos cambiados»
  hasta que la persona lo revisa.
- Cambios que ya no se pueden aplicar (compra en el pasado, pago eliminado) se ignoran y
  se avisan. Nada se aplica solo; «Crear gasto previsto» abre el formulario normal
  (acción explícita) y antes avisa si ya hay un previsto del mismo importe a ±3 días.
- Nunca se dice que una compra es «segura» o «garantizada».

## 22. Búsqueda global

`src/domain/search.ts`. Todo en el dispositivo.

- Normalización: NFD sin marcas diacríticas, minúsculas, espacios colapsados
  (`normalizeText`). Cada palabra de la consulta debe aparecer (Y lógico, cualquier
  orden). Mínimo 2 caracteres.
- Dónde busca: movimientos (nota/comercio, categoría, cuentas), cuentas, categorías
  (fijas por su nombre **en el idioma activo**; personalizadas tal como se escribieron),
  metas y gastos planificados, pagos programados (nombre y nota), presupuestos por
  periodo y favoritos. La **papelera** solo si se marca «Incluir la papelera».
- **Importes:** una palabra con forma de importe («4.25», «4,25», «$4.25», «650») se compara
  con el importe exacto (texto decimal sin flotantes), no como subcadena: «25» no encuentra
  todos los importes que contienen 25.
- Resultados agrupados por tipo (máximo 50 visibles por grupo con el total); movimientos
  del más reciente al más antiguo.
- **Rendimiento:** el índice (cadenas ya normalizadas) se construye una vez por versión
  de datos e idioma y la escritura usa `useDeferredValue`. Verificado en
  `search.test.ts` con 10 000 movimientos (la prueba falla si el índice supera 1 s o una
  búsqueda 200 ms). Medido en el contenedor de desarrollo (Node, 3 repeticiones):
  índice 18–27 ms; búsqueda concreta («autobus») 3–10 ms; búsqueda amplia («ca») 6–10 ms.

## 23. Compras divididas entre categorías

`src/domain/splits.ts`. Una compra dividida sigue siendo **un solo movimiento** (cuenta,
fecha, nota/comercio, importe total y huella de importación). `splits` solo reparte ese
importe:

- **Σ líneas = total exacto en centavos** (`splitMismatch` si difiere aunque sea 1 centavo).
  Al menos 2 líneas en un gasto; categorías de gasto válidas; `categoryId` = la de la 1.ª
  línea (compatibilidad). Solo gastos (y devoluciones de compras divididas): una
  transferencia o un ingreso con líneas se rechaza.
- **Saldos, disponible y proyección** usan el movimiento: cuenta **una vez**.
- **Reportes, límites, revisión semanal, búsqueda y filtro por categoría** usan las líneas
  (`categoryAllocations`, `txCategoryIds`).
- Cambiar el total sin ajustar las líneas se bloquea (la interfaz muestra «Falta asignar» o
  «Sobran» y ofrece «Asignar el resto aquí» como acción explícita). Quitar la división deja
  el movimiento con la categoría de la 1.ª línea.
- **Sugerencia desde el historial:** si hay una compra dividida anterior con la misma
  descripción, se ofrece «Dividir como la última vez» (solo propone; hay que guardar).
  Reescalado sin flotantes: `línea = floor(total × línea anterior / total anterior)` y el
  resto del redondeo va a la 1.ª línea, así Σ líneas = total exacto.
- Una **regla de categoría** nunca sobrescribe una división (solo propone mientras no hay
  división ni elección manual). **Reimportar** el CSV reconoce la compra por su `importRef`.
- **Papelera:** las líneas viajan dentro del movimiento (atómico). Si se elimina una compra
  con devoluciones repartidas, estas pierden vínculo y reparto (el dinero devuelto sigue
  contando) y el reparto se guarda en `unlinkedRefundSplits`; al restaurar la compra se
  recupera si sigue siendo coherente.
- **Devoluciones:** una devolución de una compra dividida se reparte entre sus categorías:
  `pendiente(c) = línea(c) − Σ devoluciones repartidas en c`; ninguna línea puede superarlo
  (`refundExceeds`). El reparto se deduce solo si no hay ambigüedad (devolución total → cada
  categoría su pendiente; una sola categoría con pendiente → esa); si no, se pide a la
  persona. Editar la compra de forma que una devolución quede inválida se bloquea.
- **Fechas en reportes:** el gasto cuenta en el periodo de la fecha de la compra; la
  devolución, en el de la fecha de la devolución (resta en sus categorías ese periodo). Una
  devolución nunca es ingreso ni se descuenta dos veces.

## 24. Bandeja de pendientes

`src/domain/inbox.ts`. Los avisos **se calculan** a partir de los datos (no hay una
segunda copia de la información) con un **id estable** (`cat:<tx>`, `due:<clave del
pago>`, `dup:<a>:<b>`, `bal:<cuenta>:<motivo>`, `int:…`), así nunca aparecen dos veces.

- **Sin categoría:** gasto o ingreso realizado, sin dividir, en «Otros gastos/ingresos».
- **Sin confirmar:** pago o ingreso del calendario (o previsto) cuya fecha pasó sin
  registrarse ni omitirse. Texto neutral: «puede que ya lo hayas pagado».
- **Posibles duplicados:** mismo tipo, cuenta e importe, a ±3 días y misma nota (o sin
  nota). Nunca: transferencias, ajustes, líneas de una compra dividida ni pagos parciales
  de la misma ocurrencia. Solo es una sugerencia: nada se elimina ni combina.
- **Saldos por verificar:** cuentas del presupuesto y tarjetas nunca verificadas, verificadas
  hace más de 30 días o con la verificación «por revisar». Muestra por separado el
  **último movimiento registrado** y la **última verificación con el banco**.
- **Para tener en cuenta:** tarjetas con deuda ≥ 90 % del límite (`deuda × 100 ≥ límite × 90`,
  descartable; si luego supera el límite aparece otro aviso que no se descarta) y metas cuya
  fecha pasó sin completarse (descartable; desaparece al completarla o cambiar la fecha).
  También: **límites de categoría superados este mes** (mismo gasto neto del resumen
  mensual, con las líneas de compras divididas; un aviso por categoría y mes, id
  `limit:<categoría>:<AAAA-MM>`, importe = exceso; descartable mientras no cambie el límite)
  y **reglas de categoría que no hacen nada**: su categoría está archivada o no existe, o
  llevan ≥ 90 días creadas (fecha de creación pasada a la zona horaria) y ningún movimiento
  realizado de los últimos 90 días contiene su texto (sin acentos ni mayúsculas; las reglas
  de gasto cuentan gastos y devoluciones). Solo se sugiere revisarlas; nunca se borran.
- **Coherencia:** gasto planificado cuyo pago vinculado ya se registró pero sigue con dinero
  apartado (se descontaría dos veces; «Cerrar con el pago registrado» lo resuelve sin crear
  otro gasto) y distribuciones cuyo ingreso cambió o se eliminó.
- **Posponer** guarda `{id, hasta}`: no cambia cifras y el aviso vuelve en esa fecha si el
  problema sigue. **Descartar** («Está bien así», «Son distintos», «Ya lo revisé») guarda
  `{id, huella}`; si cambian los datos relevantes (importe, fecha, cuenta, nota…), el aviso
  vuelve. Los pagos vencidos y los saldos no se pueden descartar, solo posponer.
- **Resolver** (categorizar, registrar el pago, verificar…) retira el aviso porque deja de
  calcularse. En Inicio solo aparece un acceso compacto con el número de pendientes.

## 25. Distribuir un ingreso recibido

`src/domain/incomeDistribution.ts`. Solo ingresos **realizados**.

- **No crea dinero:** el ingreso ya está en el saldo. Distribuir solo crea apartados
  virtuales con las metas existentes (sin transferencias ni movimientos nuevos).
- **Pagos:** se apartan con un gasto planificado vinculado a esa ocurrencia (se reutiliza
  si ya existe). Si el pago ya se descontaba del disponible (antes del próximo ingreso), la
  cobertura de §18 hace que **no se reste dos veces**: el disponible no cambia.
- **Necesidades:** pago = importe − ya apartado para él; meta = objetivo − apartado.
- **Límites:** Σ asignado ≤ ingreso − lo ya distribuido de ese ingreso; cada apartado que
  sí cuesta dinero libre pasa por el control de siempre (`maxBudgetAllocation`), así que
  nunca supera «Puedes gastar». Si el ingreso ya se gastó en parte, se explica cuánto queda
  libre de verdad.
- **Propuesta** (editable; el orden lo elige la persona): pagos por fecha con lo que les
  falta; metas por fecha objetivo con su propia cuota por ingreso (§7) o lo que les falta.
  Sin porcentajes fijos. Lo no asignado queda libre.
- **Vista previa** antes/después de «Puedes gastar», reservado y saldo; se aplica solo al
  confirmar, en **una operación** (todo o nada) e idempotente (id generado al abrir).
- **Vínculos e historial:** `incomeDistributions[]` guarda el ingreso, su huella (importe,
  fecha, cuenta, estado) y cada línea (meta, apartado, importe); cada apartado lleva
  `distributionId`. Reabrir el asistente muestra lo ya repartido y no lo ofrece de nuevo.
- **Cambios posteriores:** si el ingreso se edita o se elimina, la distribución se marca
  para revisar (bandeja y asistente).
- **Deshacer:** libera cada apartado (movimiento de liberación, sin borrar historial) y
  quita la meta que la distribución creó si no tuvo otros movimientos. Si algún apartado
  ya se usó para pagar o la meta ya no tiene ese dinero, **no se revierte nada** y se
  explica el conflicto (`distributionConflict`).

## 26. Historial local de cambios (v8)

Código: `src/domain/history.ts`. Pantalla: `Ajustes › Historial de cambios`.

- **Qué se registra.** En cada guardado se compara el estado anterior con el nuevo, por id, en
  las colecciones financieras (cuentas, movimientos, programados, metas, papelera,
  conciliaciones, distribuciones, presupuestos por periodo) y en los ajustes que cambian
  cifras (`currency`, `timeZone`, `fallbackHorizonDays`). Se guarda cada registro cambiado con
  su valor **anterior y nuevo completos**. Sin cambios financieros no se añade entrada (cambiar
  el idioma no aparece).
- **Origen.** `app` (uso normal), `revert` (con `revertOf`), `plan` (aplicado desde un plan) y
  `replace` (importar una copia o reiniciar la demo). `replace` es un **corte**: no se puede
  revertir ni reconstruir el estado anterior a él.
- **Revertir.** Solo si cada registro de la entrada sigue *exactamente* como la entrada lo
  dejó; si no, se muestra cuántos registros cambiaron después y no se toca nada. El resultado
  se valida completo (`validateAppData`) antes de guardar: nunca quedan una ocurrencia pagada
  dos veces ni una devolución sin su compra. La reversión es otra entrada (también reversible);
  una entrada ya revertida no se ofrece de nuevo.
- **Estado anterior** (`stateBefore`): deshaciendo en orden inverso las entradas posteriores
  a un punto se obtiene el estado en ese momento, base de «¿Qué cambió?». Devuelve `null` si
  hay un corte por medio.
- **Límites.** Como mucho 1000 entradas (`HISTORY_MAX_ENTRIES`); al superarlas sale la más
  antigua y `historyStartedAt` avanza. El historial es local, viaja en las copias y se puede
  editar: **no es una auditoría inviolable**.

## 27. «¿Qué cambió?»

Código: `src/domain/whatChanged.ts`. Pantalla: `Inicio › ¿Qué cambió desde ayer?` (`/cambios`).

1. **Punto de comparación**: el inicio de un día (hoy, ayer, hace 7 o 30 días, otra fecha), el
   inicio del historial o la última restauración. El estado de entonces (`S0`) se reconstruye
   deshaciendo las entradas posteriores (§26). Si el historial empezó ese día o después
   (`beforeHistory`) o hay un corte por medio (`cut`), **no se compara** y se dice por qué.
2. **Pasos**: se rehacen las entradas una a una y se recalcula el disponible con la fecha de
   entonces `t0`. La diferencia de cada paso es el efecto de esa entrada. Se clasifica por el
   registro principal: ingresos, gastos, devoluciones, pagos de compromisos, transferencias,
   apartados y metas, programados, ajustes de saldo, cuentas, ediciones y ajustes.
3. **Paso del tiempo** = disponible(Sn, hoy) − disponible(Sn, t0). Se listan los pagos que
   entraron o salieron del periodo y, aparte, cualquier resto (`otherMinor`).
4. **Sin explicar** = disponible(datos actuales, hoy) − disponible(Sn, hoy). Es 0 cuando el
   historial es coherente. Si no lo es, se muestra como importe sin causa.

`total = Σ pasos + tiempo + sin explicar` se cumple siempre, al céntimo. El valor por día se
descompone igual: cambios (a `t0`) + tiempo + sin explicar.

Con más de 60 entradas se agrupan las consecutivas de la misma clase (el total no cambia).
Ambas cifras usan las reglas actuales. Pruebas con cifras calculadas a mano en
`whatChanged.test.ts`.

**«¿Cómo se calculó?»** también muestra:

- la deuda de las tarjetas que cuentan para el presupuesto;
- qué pagos reservados son estimados;
- el supuesto del horizonte (cuándo debería llegar el próximo ingreso);
- la información pendiente: ingresos vencidos o de hoy sin marcar (no se cuentan), pagos
  vencidos (se siguen reservando) y saldos sin verificar.

## 28. Registro rápido, borradores y plantillas

**Registro rápido** (`MovementForm`, `domain/quickEntry.ts`):

- **Formulario corto.** Tipo, importe, cuenta y categoría a la vista. Fecha, estado, nota,
  presupuestos por periodo y «ya incluido en el saldo» van en «Más detalles», con un resumen
  visible. Se abre solo si hay un error en esos campos.
- **Categorías recientes.** Las últimas distintas de ese tipo, incluidas las de compras
  divididas. Las archivadas no aparecen.
- **Última cuenta usada** para ese tipo. Para transferencias, si no hay ninguna, se propone una
  cuenta que no sea tarjeta. Cambia con el tipo hasta que la persona elige una cuenta.
- **«Guardar y agregar otro»** guarda y abre un formulario nuevo (id nuevo) con el mismo tipo,
  cuenta, categoría y fecha.
- **«Duplicar como borrador»** copia los campos con la fecha de hoy y un id nuevo. No copia el
  vínculo con un pago programado ni con la compra devuelta.
- **Doble envío.** El id se genera al abrir y hay un bloqueo mientras se guarda: pulsar dos
  veces actualiza el mismo registro.
- **Borradores** (`storage/drafts.ts`). Es el texto del formulario, guardado en este
  dispositivo y ligado al presupuesto. No cuenta en ningún cálculo, no viaja en las copias y
  no entra en el historial. Al volver se ofrece **recuperar** o **descartar**. Se borra al
  guardar, al descartarlo y con «Borrar todos los datos».

**Plantillas** (`domain/templates.ts`, `Movimientos › Plantillas`). Una plantilla **nunca**
registra movimientos ni aparta dinero: solo rellena un formulario que se revisa y se guarda
aparte.

Regla de importes:

1. Importe fijo: tal cual.
2. Porcentaje: del total de la compra (o del ingreso recibido), redondeado **hacia abajo** al
   céntimo.
3. Si solo hay porcentajes y suman 100 %, los céntimos del redondeo van a la línea con el
   porcentaje más alto (la primera si empatan). Así la división cuadra exacta.
4. En otro caso, lo que sobra queda **sin asignar** y se muestra. En una compra hay que
   repartirlo antes de guardar.
5. Si la suma supera el total, o lo que queda por repartir del ingreso, **no se aplica nada**.
6. Distribución: cada línea se limita a lo que le falta a su meta o pago, y se avisa.
7. Líneas con categoría archivada o eliminada, meta eliminada o no disponible, o pago sin
   ocurrencia abierta: no se aplican, se avisan y su parte queda sin asignar.

Pruebas: `templates.test.ts`, `quickEntry.test.ts` y e2e `quick-entry.spec.ts`.

## 29. Plan ante un faltante

Código: `src/domain/shortfall.ts`. Pantalla: `¿Me alcanza? › Escenarios › Ver plan ante el
faltante` (`/alcanza/faltante`). También se llega desde el aviso de disponible negativo en
Inicio.

**Diagnóstico.** Usa la misma proyección y las mismas hipótesis que el comparador:
horizonte, gasto diario estimado y escenario de ingresos variables (mínimo por defecto).
Muestra:

- el primer día con saldo proyectado negativo y lo que falta al terminar ese día;
- el peor día;
- las salidas previstas hasta ese día, marcadas como pago programado (obligación), compra
  prevista o transferencia, y si son estimadas;
- los ingresos que se suponen y los retrasados que no se cuentan.

Los apartados para metas no cambian el saldo proyectado, y se dice.

**Palancas.** Cada una se simula sobre una copia. Se pueden combinar y editar.

| Palanca | Se puede aplicar | Propuesta por defecto |
|---|---|---|
| Mover una compra prevista | Sí | Al próximo ingreso tras el peor día |
| Reducir una compra prevista | Sí (a 0 = quitarla: va a la papelera) | Importe − lo que falta en el peor día (mínimo 0) |
| Importe de un ingreso estimado (sin rango) | Sí (cambia el programado) | El que escriba la persona |
| Importe esperado de un ingreso variable | No (es un escenario) | El esperado en lugar del mínimo |
| Fecha de un ingreso | No (solo supuesto) | El primer día negativo |
| Gasto diario variable | No (es una estimación) | `ceil(faltante del peor día ÷ días hasta él)` menos al día |

- Los **pagos programados nunca** son palanca: si con lo elegido sigue faltando, se listan
  como restricciones sin resolver (hasta el primer día negativo de la simulación combinada).
- No se sugieren préstamos, tarjetas ni deuda nueva.
- Un ingreso hipotético o adelantado nunca entra en el disponible.

**Aplicar.**

- Solo palancas aplicables, mostrando cada cambio y con confirmación en la app.
- Una operación, todo o nada.
- Si un registro cambió desde que se calculó la propuesta (huella `leverBasis`), no se aplica
  nada y se explica.
- Se guarda en el historial como `plan`, y se deshace con el aviso «Deshacer» o desde el
  historial (con su detección de conflictos).
- Nunca cambia movimientos realizados.

Pruebas con cifras a mano en `shortfall.test.ts`; e2e `shortfall.spec.ts`.

## 30. Personalización y modo privado

Código: `src/ui/preferences.ts`. Ajustes: `Ajustes › Inicio y privacidad`. Son preferencias de
**presentación de este dispositivo**: no cambian ninguna cifra, no se guardan con los datos
ni viajan en las copias.

- **Vista completa o esencial.** La esencial muestra el disponible, «¿Cómo se calculó?»,
  «Agregar movimiento» y todos los avisos importantes. El resto queda en «Más herramientas».
- **Secciones secundarias de Inicio.** Se ocultan con casillas y se ordenan con botones
  Subir/Bajar (sin arrastrar ni gestos ocultos). Siempre se ven: el disponible y su
  explicación, registrar un movimiento y los avisos críticos (ingresos sin confirmar, pagos
  vencidos, copia de seguridad, saldo antiguo, apartados que superan el dinero).
  La revisión semanal mantiene su ajuste de siempre, guardado con los datos.
- **Accesos rápidos.** Hasta 3 junto a «Agregar movimiento», que siempre está.
- **Restaurar diseño predeterminado.** Solo restablece estas preferencias y vuelve a mostrar la
  revisión semanal. Se puede deshacer. No toca datos financieros.
- **Modo privado.** `fmt.money` devuelve `•••` en tarjetas, listas, avisos, textos accesibles
  y descripciones de gráficos. Los gráficos se sustituyen por una nota, porque sus
  proporciones revelarían importes. Los campos donde se escribe un importe lo siguen
  mostrando. **No** es autenticación ni cifrado: no cambia lo guardado ni lo exportado. El
  porcentaje de avance de una meta sigue visible porque no es un importe.

Pruebas: `ui/preferences.test.ts` y e2e `personalize.spec.ts`.

## 31. Periodos de presupuesto y *safe to spend* (v2)

- Tipos: semana (día de inicio configurable), quincena (1–15 / 16–fin), mes, trimestre, semestre y año alineados al calendario, personalizado (el rango se repite con la misma duración hasta contener hoy) y «hasta mi próximo ingreso» (modelo original: hoy … día anterior al ingreso).
- `daysLeft` cuenta hoy y el último día del periodo. Si hoy ya pasó el fin, es 0 y no se divide.
- Saldo del periodo: `netoPresupuesto = Σ efecto sobre las cuentas del presupuesto de los movimientos realizados del periodo` (ingresos y devoluciones recibidos en cuentas del presupuesto − gastos desde ellas − transferencias hacia cuentas excluidas + transferencias desde ellas, ajustes incluidos). `carryOver = saldo real de hoy − netoPresupuesto` (lo que había en esas cuentas al empezar). Con arrastre, `base = saldo real` (= carryOver + netoPresupuesto). **Sin arrastre, `base = min(netoPresupuesto, saldo real)`** (QA-03, decisión 131): la asignación del periodo nunca supera el dinero que de verdad hay en las cuentas. `availablePct = base disponible / (carryOver + ingresos)` solo si el denominador es > 0.
  - Ejemplos sin arrastre (mes): saldo de referencia −500 e ingreso 1 000 → saldo real 500, neto 1 000 → **base 500** (antes: 1 000, más de lo que había). Saldo previo 2 000, ingreso 1 000, gasto 200 → saldo 2 800, neto 800 → **base 800** (manda la asignación). Ingreso de 1 000 en una cuenta excluida → neto 0 → **base 0**, y «¿Cómo se calculó?» muestra la diferencia con los ingresos de Estadísticas. Deuda previa −1 500 e ingreso 1 000 → **base −500**: el déficit se ve, no se recorta a cero.
  - Lo comprometido (pagos reservados y apartados) se resta UNA vez de esa base, igual que con arrastre.
- Disponible = `base − pagos reservados hasta el fin del periodo (incluido) − apartados de metas`. Las mismas reservas que §1; nada cambia para `untilIncome`.
- *Safe to spend* = `max(disponible − comprometido, 0)`; por día = `floor(safe / daysLeft)`; por semana = `floor(safe × min(7, daysLeft) / daysLeft)`; por periodo = `safe`.

## 32. Asistente de registro (parser local)

- Entradas: líneas, «;», y «,» o conectores («y», «and», «e», «et») solo cuando cada parte tiene un número. Máximo 200.
- Importe: primer número con moneda escrita, decimales o «k»; si no, el primero. Separadores regionales (`1.234,56`, `1,234.56`, `1 234,56`), «k»/«mil»/«M», números en palabras (es/en/pt/fr). Monedas sin decimales redondean a entero. Sin importe, la entrada lo pide y su confianza queda ≤ 0,25.
- Moneda escrita (AS-01, RT-01): se lee con las mismas definiciones que los campos de importe (`money.ts`), pegada al importe delante o detrás —también sin espacio y con importes en palabras—: código ISO (`GBP 10`, `10GBP`, `EUR ten`, `ten USD`), símbolo (`10€`, `£10`, `¥1000`, `10 ₽`), prefijo con dólar (`US$10`), nombre (`10 euros`, `diez euros`, `10 pesos`) o signo local escrito con letras (`10 kr`, `1000 Ft`, `Rp 1000`, `10 zł`; distingue mayúsculas: `10 ft` son pies). Sin nada pegado, una moneda explícita en la frase (código admitido en MAYÚSCULAS, símbolo o nombre en plural: `coffee (USD) 10`) deja la línea sin resolver. Si no es la del presupuesto, el campo «Importe» la conserva (`10.00 GBP`, `€10.00`) y la línea no se registra hasta escribir el importe en la moneda del presupuesto; nunca se convierte. Un ISO real no admitido (`RUB 10`) también bloquea; en minúsculas no cuentan los códigos que son palabras (`pen`, `ron`, `try`, `mad`, `ils`, `bob`). Lo mismo para el total de una foto de recibo (solo símbolos sueltos y códigos admitidos pegados al importe, porque los recibos van en mayúsculas).
- Tipo: ingreso si aparece una palabra clave de ingreso en cualquiera de los cuatro idiomas; si no, gasto.
- Fecha: ISO, `d/m(/a)`, «15 de octubre» / «oct 15» (en inglés manda mes-día), relativas (hoy, ayer, anteayer…) y días de la semana (el más reciente, hoy incluido). Una fecha futura se sustituye por hoy. Sin fecha: hoy.
- Categoría, por prioridad: regla de la persona → palabra aprendida del historial (≥ 2 veces y mayoría) → diccionario por palabra clave (gana la más larga). Solo categorías activas del tipo detectado; si nada coincide, no se inventa.
- Confianza: 0,5 con importe (0,15 sin él) + 0,3 regla / 0,25 aprendida / 0,2 diccionario + 0,1 fecha + 0,05 ingreso explícito − 0,1 importe en palabras; acotada a [0,05, 0,95].

## 33. Programados v2 y avisos locales

- Confirmación automática: ocurrencias abiertas (ni pagadas ni omitidas) con fecha en `[hoy − 7, hoy]` de programados con `autoConfirm` y sin pausa → movimiento realizado por **lo que falta** de la ocurrencia (previsto − cobros parciales, el mismo `PlanItem.amountMinor` del calendario), `source: 'scheduled'`; si no falta nada, la ocurrencia se cierra sin crear movimiento (QA-02). Idempotente: una ocurrencia liquidada u omitida no se registra. Los vencidos se revisan con los topes del §5.
- Pausa: un programado en pausa no genera ocurrencias ni reservas; al reanudar vuelven las futuras y las vencidas no omitidas.
- Avisos: con `scheduledAlerts`, vencidos (desde las 09:00) y los que vencen hoy o mañana; `dailyReminder` a su hora solo si hoy no hay movimientos realizados; `dailySummary` a su hora con gastos − devoluciones del día. En horas de silencio (rango que puede cruzar medianoche) no se emite nada; al salir del rango se emiten los pendientes. Cada aviso tiene una clave por día para no repetirse.

## 34. Planes de gasto (v2, `domain/plans.ts`)

- **Ciclo** = periodo que contiene «hoy» para el tipo elegido (semana, quincena, mes, trimestre,
  semestre, año; mismo cálculo que §31) o fechas explícitas si es personalizado. Se guarda en
  `startDate`/`endDate` al crear y se renueva al cerrar. Un plan migrado sin ciclo recibe el de hoy en
  el primer cierre.
- **Gastado** = Σ gastos − Σ devoluciones realizados en las categorías del plan (vacío = todas las
  de gasto), con las líneas de compras divididas, entre inicio y fin del ciclo (incluidos); nunca
  negativo. Los previstos no cuentan.
- **Estado**: superado si gastado > límite; cerca si gastado ≥ 80 % del límite; completado si el
  plan cerró; en pausa si la persona lo pausó. Restante = límite − gastado (negativo = superado).
- **Ritmo ideal** al día *d* del ciclo (contando hoy) = ⌊límite × d / días del ciclo⌋. Solo se compara;
  no limita ni cambia el disponible.
- **Cierre automático** (al abrir la app y al cambiar el día): un plan activo cuyo fin es anterior a
  hoy pasa a `completed` con `result = { spentMinor, achieved: gastado ≤ límite, deltaMinor: límite −
  gastado, closedAt }`. Si es recurrente se crea un plan nuevo (`previousPlanId`) en el ciclo que
  contiene hoy; si pasaron varios ciclos no se inventan cierres intermedios. Los pausados no se
  cierran. Idempotente: una segunda pasada el mismo día no cambia nada.
- **Repetir** = plan nuevo con los mismos ajustes en el ciclo de hoy (los personalizados conservan su
  duración a partir de hoy).
- **Alertas**: con `alertAt80`/`alertAt100` y el ajuste «Alertas de planes» activo, se avisa una vez
  por ciclo y umbral (clave `plan<umbral>:<id>:<inicio del ciclo>`); respetan las horas de silencio.
  v13 (Clara 2.0 §11): `alertLevels` opcional añade 50, 75 y/o 90 (apagados por defecto; sin repetir,
  guardados en orden). Se avisa solo del umbral activado **más alto** ya alcanzado
  (`gastado × 100 ≥ límite × umbral`, en enteros): si el gasto salta del 40 % al 95 % hay un único
  aviso, el del 90 %. Editar sin enviar `alertLevels` los conserva, una lista vacía los quita y la
  renovación de un plan recurrente los hereda. Sin `alertLevels` todo es como en v12.
- **Metas**: `contribution` (importe + frecuencia) es un recordatorio; «Aportar ahora» solo propone el
  importe. Sugerencia diaria de una meta = ⌈restante / días hasta la fecha⌉.
- Un plan nunca mueve dinero ni cambia el disponible; los límites mensuales anteriores
  (`categoryLimits`) se convirtieron en planes mensuales recurrentes en la migración v9 → v10.

## 35. Estadísticas (v2, `domain/statistics.ts`)

- **Rango** = periodo de calendario que contiene la fecha ancla (mismo cálculo que §31) o fechas
  explícitas si es personalizado (por defecto los últimos 30 días). Anterior/siguiente = el periodo
  que contiene el día previo al inicio / posterior al fin; los personalizados se desplazan su duración.
- **Tres cifras**: ingresos = Σ ingresos realizados; gastos = gasto neto (§15); neto = ingresos − gastos.
  Delta = actual − anterior; porcentaje entero = ⌊delta × 100 / anterior⌋ solo si anterior > 0 y el
  periodo anterior empieza en o después de `trackedSince` (si no, se indica «no comparable»).
- **Por categoría**: netos positivos ordenados de mayor a menor; porcentaje entero sobre su suma.
  Tocar una categoría abre el historial filtrado por categoría y fechas del rango.
- **Series de 6 periodos**: ingresos y gasto neto por periodo, del más antiguo al actual.
- **Tendencia**: acumulado diario del gasto neto (nunca negativo) del periodo frente al anterior,
  alineados por día del periodo; los días futuros del actual quedan vacíos.
- **Top 5**: agrupa por comercio (o nota si no hay) sin acentos ni mayúsculas; resta devoluciones;
  sin texto no se cuenta.
- **Promedio diario** = ⌊gasto neto / días transcurridos (hasta hoy, mínimo 1)⌋. Día de la semana con
  más gasto = suma por fecha del periodo.
- **Saldo futuro (90 días)**: base = proyección (§8) con el gasto diario estimado (§9, 30 días) y el
  escenario mínimo de ingresos variables; optimista = 75 % del gasto diario con ingresos esperados;
  pesimista = 125 % con mínimos. Marcas en hoy, 30, 60 y 90 días. Oculto con menos de 14 días desde
  `trackedSince`, menos de 7 días de gasto observado o sin movimientos.
- **PDF** = impresión del navegador de la vista (hoja de estilos `@media print`); no hay servicio.

## 36. Recibos (foto → propuesta, `domain/receipt.ts`)

- **Importes**: números con separadores de miles o decimales; un año (1900–2099) sin decimales y las horas no cuentan.
  En monedas sin decimales (COP…) un número con decimales se descarta.
- **Total** = mayor importe de una línea con «total / importe / monto / amount due / montant / a pagar…» que no sea
  subtotal, impuesto, propina, cambio, efectivo o tarjeta; «gran total» pesa más. Sin línea de total, la cifra mayor
  (y se avisa). Sin importes, nada: la persona lo escribe.
- **Fecha**: `AAAA-MM-DD`, `DD/MM/AAAA` o `DD-MM-AA`; nunca posterior a hoy.
- **Comercio**: primera de las seis primeras líneas con ≥ 60 % de mayúsculas (o capitalizada), con letras, sin importes
  ni palabras de total/identificación fiscal. La categoría se sugiere pasando el comercio por el parser (diccionario,
  aprendizaje y reglas); sin coincidencia, «otros gastos».
- **Confianza** = 0,5 si el total viene de una línea «total» (0,3 si es solo la mayor) + 0,25 si hay fecha + 0,25 si hay comercio.
- Todo es propuesta: la línea entra en la vista previa del asistente y pasa la validación normal al confirmar.

## 37. Formato compacto de importes y versiones de ICU

`formatMoney(…, { compact: true })` es solo para mostrar (etiquetas de gráficos): delega en
`Intl.NumberFormat` con `notation: 'compact'`. El orden entre símbolo y cifra en esa notación
depende de los datos CLDR de la versión de ICU del navegador o de Node (`$1.3 M` en unas,
`1.3 M$` en otras), así que ninguna prueba fija ese texto: se compara con lo que `Intl` devuelve en
la misma máquina y se exige la cifra abreviada y el símbolo. Los importes reales nunca se muestran
compactos ni se redondean para calcular.

## 38. Cifras del héroe: ingresos, gastos y «Disponible · N %» (`domain/heroFigures.ts`)

- **Periodo** = el periodo de presupuesto configurado; con «hasta mi próximo ingreso» (sin periodo de
  calendario), el mes natural de hoy (el mismo que abre Estadísticas).
- **Ingresos** y **gastos** = `periodSummary` del periodo: solo realizados, transferencias y ajustes
  fuera, devoluciones restadas del gasto. Son las mismas sumas que Estadísticas.
- **Saldo al empezar** = saldo del presupuesto hoy − (ingresos − gastos) del periodo transcurrido
  (reconstruido hacia atrás; no se guarda).
- **Base** = saldo al empezar + ingresos del periodo.
- **N %** = ⌊disponible × 100 ÷ base⌋ acotado a 0–100; **0 si la base no es positiva** (nunca se
  divide entre cero ni se muestra un porcentaje negativo). La línea «¿Cómo se calculó?» repite las tres
  cifras y el periodo.

## 39. Importes inverosímiles (`domain/plausibility.ts`, G5)

- Un **gasto** es inverosímil si `importe ≥ 20 × max(0, disponible)` **y** `importe ≥ 1 000` en la unidad mayor
  de la moneda (1 000,00 en CAD/MXN; 1 000 en COP, sin decimales). Por debajo de 1 000 nunca se pregunta.
- Se pide confirmación una sola vez por movimiento («¿Seguro? Es N veces lo que puedes gastar»,
  N = ⌊importe ÷ disponible⌋; sin disponible positivo, «más de lo que puedes gastar ahora»). Confirmar
  guarda el importe tal cual: no se corrige ni se bloquea. En la vista previa del asistente la fila queda
  marcada con el mismo aviso.

## 40. Inicio en otro periodo (`domain/homeSnapshot.ts`, D1)

- **Periodos navegables** = los del ajuste de periodo; con «hasta mi próximo ingreso», meses naturales.
  Hacia atrás sin límite; hacia delante solo hasta el periodo que contiene hoy (el futuro no se navega).
- **Instantánea al cierre** de un periodo pasado: se calcula sobre una copia de los datos en la que
  (1) no existen los movimientos **realizados** con fecha posterior al cierre (los previstos se conservan:
  nunca cambian saldos y, como entonces, se reservan si caen en el horizonte) y (2) cada cuenta cuyo saldo
  de referencia es posterior al cierre lo retrocede: `referencia − Σ efecto(realizados incluidos en la
  referencia con fecha > cierre)`, con fecha de referencia = cierre. Sobre esa copia se aplican
  `computeBudget` y `heroFigures` con «hoy» = cierre: saldo, reservado, disponible, ingresos y gastos
  tal como se habrían visto ese día.
- **Apartados (QA-04):** los apartados de metas tienen fecha, así que en la copia solo existen los
  de fecha ≤ cierre (aportes, liberaciones y pagos desde una meta por igual); una meta creada después
  del cierre (`createdAt` en la zona horaria del presupuesto) no existe, y un gasto planificado cerrado
  después sigue abierto. Un apartado de septiembre ya no reduce el disponible de agosto.
- **Límite declarado:** los programados y los ajustes (tipo de periodo, arrastre, cuentas incluidas)
  no tienen historial propio, así que la instantánea usa los actuales. La pancarta del periodo lo dice.
- El periodo actual no usa la instantánea: Inicio muestra las cifras vivas. La navegación nunca escribe.

## 41. «Repetir» al guardar un movimiento (`domain/repeat.ts`, D6)

- Guardar con «Repetir» = `saveSchedule` + `saveTransaction` en **una** operación (todo o nada): si el
  programado no es válido, tampoco se guarda el movimiento.
- El programado empieza en la fecha del movimiento (`startDate = date`) con su importe, cuenta y
  categoría; el movimiento se guarda con `scheduleId` + `occurrenceDate = date`, así esa ocurrencia es
  **un movimiento y nunca además una reserva** (regla de §CLAUDE: pagada si hay movimiento realizado con
  su `scheduleId` + `occurrenceDate`). La siguiente ocurrencia es la primera que se reserva y la que
  aparece en el calendario.
- Solo en movimientos nuevos, realizados, de gasto o ingreso, sin división ni vínculo previo.

- «Próximo» en la lista de programados del calendario = primera ocurrencia en o después de hoy que no
  está liquidada (sin movimiento realizado con su `scheduleId` + `occurrenceDate`, cobros parciales
  aparte) ni omitida (`nextPendingOccurrence`). Tras «Repetir», la de hoy ya está pagada y el próximo es
  el del periodo siguiente.

## 42. Progreso de una meta y fecha estimada (`domain/goalChart.ts`, D7)

- Curva «Apartado»: acumulado de `allocations` por fecha, empezando en 0 el día de inicio (primer
  apartado o creación de la meta, lo anterior). Las liberaciones y pagos cuentan en el acumulado con su
  signo; solo las aportaciones positivas cuentan como «aportes».
- Recta ideal: `ideal(d) = ⌊objetivo × (d − inicio) ÷ (fecha objetivo − inicio)⌋`, 0 antes del inicio y
  el objetivo después del fin. Sin fecha objetivo no hay recta.
- Fecha estimada: solo con ≥ 2 aportes. `Σ30` = aportes de los últimos 30 días (hoy incluido). Si
  `Σ30 = 0` no se estima («sin aportes recientes»). Si no, `días = ceilDiv(restante × 30, Σ30)` y
  `fecha = hoy + días`; «al día» = `⌊Σ30 ÷ 30⌋`. Enteros en unidades menores, nunca flotantes ni
  división entre cero. Meta completa → sin estimación.
- La estimación es orientativa: cambia con cada aporte y no es una promesa ni un plan.

## 43. Exportación CSV sin fórmulas (`domain/csvExport.ts`, QA-07)

- Un CSV se abre en hojas de cálculo que **ejecutan** lo que empieza por `=`, `+`, `-`, `@`,
  tabulador o retorno de carro. Una nota o un comercio escritos (o importados de un banco) con
  ese inicio podrían convertirse en una fórmula al abrir la exportación.
- Toda celda de **texto libre** (tipo, estado, categoría, cuenta, destino, nota, comercio, origen,
  nombres de categorías y planes, títulos de sección) pasa por `safeText`: si el texto, tras los
  espacios iniciales, empieza por uno de esos caracteres, se antepone un apóstrofo (`'`), la
  convención de Excel, LibreOffice y Google Sheets para «esto es texto»; los caracteres de control
  (salvo tabulador y saltos de línea, que se entrecomillan) se quitan. Después se entrecomilla como
  siempre si contiene `"`, `,`, `;` o saltos de línea.
- **Fechas, importes, moneda e ids no pasan por `safeText`:** los importes siguen siendo números
  con signo (`-12.50`) para que las sumas de la hoja funcionen. El contenido numérico no cambia.
- Fidelidad: una nota que empiece por «-» o «+» se verá con el apóstrofo delante en la hoja; es el
  coste de no ejecutar nada. Las copias de seguridad (JSON) no se tocan: no son hojas de cálculo.

## 36. Revisión única de propuestas, reglas explicadas, programados e historial (etapa 2)

- **Revisión única** (`domain/review.ts`): toda propuesta de registro —fila de CSV, línea de texto o
  voz del asistente, foto de recibo— pasa por las mismas comprobaciones antes de guardarse:
  validación del formulario (`validateTransaction` + cuenta archivada), posibles duplicados
  (`similarTransactions`, ±3 días, mismo tipo, cuenta e importe), coincidencia con un pago o ingreso
  programado abierto (misma regla que el formulario: importe igual, o misma categoría y fecha; ventana
  14 días hacia delante y 45 hacia atrás; solo para propuestas realizadas), efecto sobre lo
  disponible (`txEffectOnBudgetPool`) y, si la categoría viene de una regla, cuál y por qué. Nada se
  guarda desde aquí. **Vincular** una propuesta con la ocurrencia es decisión de la persona (casilla
  desmarcada): al guardarse lleva `scheduleId` + `occurrenceDate` y la ocurrencia cuenta como
  movimiento, no como reserva (§5). **Reintentos**: los ids se generan al abrir la vista previa y
  `saveTransaction` es idempotente por id, así que confirmar dos veces no duplica; una propuesta cuyo
  id ya está guardado se marca «ya registrado». Nada ambiguo se guarda solo: sin importe no hay
  registro, y una línea que parece transferencia sigue bloqueada hasta cambiar el tipo (§32).
- **Reglas explicadas** (`domain/rules.ts`): `explainRuleMatch` da la misma decisión que
  `matchCategoryRule` con el porqué (`only`, `longest`, `oldest`) y las reglas que perdieron;
  `ruleConflicts` lista pares del mismo tipo con categorías distintas cuyos patrones se contienen o
  son iguales (gana el más largo; a igualdad, la más antigua) y se muestran en Ajustes › Reglas sin
  corregirse solos; `previewRule` cuenta los movimientos ya registrados cuya nota o comercio contiene
  el patrón y cuántos tienen otra categoría: **una regla nunca recategoriza lo existente**, solo
  propone en registros nuevos. Detectar un patrón repetido nunca crea un programado.
- **Programados** (`domain/scheduledJobs.ts`): `endSchedule` fija `endDate` (≥ `startDate`); no hay
  ocurrencias después, las pagadas y sus movimientos se conservan y **las vencidas sin marcar siguen
  pendientes** (terminar no borra una deuda en silencio). `scheduleSummary` da próximas fechas (sin
  pausadas, omitidas ni pagadas), historial de ocurrencias liquidadas (con «parcial»), recuentos y
  vencidas; es lo que enseña la hoja de detalle del calendario con marcar, pausar/reanudar, terminar
  y editar la serie (editar cambia todas las próximas; para una sola, marcar con otro importe u omitir).
- **Historial** (`domain/history.ts`): `historyOfRecord` lista, para un registro, lo que el historial
  local guardó (creado, campos que cambiaron sin `updatedAt`, enviado a la papelera), lo más reciente
  primero. Solo cubre desde que el dispositivo empezó a guardar historial o desde el último corte:
  nunca inventa un «antes». En Movimientos, el orden (fecha o importe, ascendente o descendente) y el
  **neto del día** (ingresos y devoluciones suman, gastos restan, ajustes según su sentido,
  transferencias no cuentan) son presentación: no cambian ningún saldo.

## 37. Flujo de caja en el calendario, límites con arrastre y ritmo de las metas (etapa 3)

- **Saldo proyectado por día** (`projectBalance`, §9): el calendario usa la misma proyección que
  Plan › Proyección, sin gasto diario estimado, desde hoy hasta el final del mes visible y como
  mínimo 60 días. Cada día enseña el saldo al cerrarlo (`endMinor`); los días anteriores a hoy no
  se proyectan (el saldo real está en Cuentas). El **primer día en negativo** es `firstNegativeDate`
  con el saldo de ese día; si no lo hay, se dice hasta qué fecha llega la proyección. Un día con
  saldo proyectado negativo lleva la marca «−» y texto accesible, nunca solo color.
- **Simulación** (`ProjectionOptions.extraOutflows`): un pago extra en una fecha concreta se resta
  ese día (una fecha pasada cuenta hoy) sobre una copia; el resultado dice el saldo al cerrar ese
  día y el primer negativo que provoca. No se guarda nada: «Registrar como previsto» solo abre el
  formulario relleno (gasto previsto en esa fecha) y la persona decide. La proyección y el
  disponible del calendario no cambian mientras se simula.
- **Conciliación de programados** (`domain/reconcileSchedules.ts`): `unlinkedSettlements` propone,
  para cada ocurrencia abierta (pendiente o vencida, de 45 días atrás a 14 adelante), el movimiento
  realizado sin `scheduleId` del mismo sentido e importe a ±3 días (el más cercano; cada movimiento
  se propone una sola vez). `linkSettlement` solo añade `scheduleId` + `occurrenceDate` al
  movimiento (operación idempotente, §5): la ocurrencia pasa a contar como movimiento, no como
  reserva, y lo disponible sube justo lo reservado. Si la ocurrencia ya tiene liquidación final, se
  rechaza (`occurrenceAlreadySettled`): nunca se liquida dos veces. Nada se vincula solo.
- **Arrastre de un límite** (`Plan.rollover`, v12): con `'none'` (valor por defecto) cada ciclo
  empieza con el límite base; con `'carry'`, al cerrar un ciclo recurrente el siguiente parte de
  `máx(0, base + (límite − gastado))`: lo que sobró se suma y lo excedido se resta. `carriedMinor`
  guarda esa diferencia y `planBaseMinor = amountMinor − carriedMinor`; editar el límite conserva el
  arrastre. El detalle lo desglosa («Límite base · arrastre = límite»). Es una regla del plan: no
  mueve dinero, no es un apartado y no cambia lo disponible (asignado ≠ disponible, §16).
- **Comprometido en el ciclo** (`planUpcoming`): pagos programados pendientes o vencidos del ciclo
  en las categorías del plan (sentido gasto). Es compromiso previsto, no gasto: «gastado» no lo
  incluye; «restante tras lo previsto» = límite − gastado − comprometido (puede ser negativo).
- **Comparación con el ciclo anterior** (`planComparison`): mismo número de días transcurridos
  sobre el ciclo anterior (`equivalentDate`); se enseña lo gastado hasta ese día en los dos ciclos,
  la diferencia y el cierre del anterior. Sin ciclo anterior o sin ningún movimiento anterior al
  ciclo actual en esas categorías no hay comparación (nunca se asume 0).
- **Ritmo de una meta** (`goalPace`, §42): `ideal` = punto de la recta desde el inicio de la meta
  hasta su fecha objetivo evaluado hoy; `delta = ahorrado − ideal`. Tolerancia del 1 % del objetivo
  (mínimo 1 unidad menor): por debajo «por detrás» (se dice cuánto tocaría llevar), por encima «por
  delante», si no «al ritmo». Sin fecha objetivo no hay ritmo. El **efecto en el disponible** es el
  de §7: una meta del presupuesto resta lo apartado; una externa, nada. El historial de aportes lista
  `allocations` con su motivo (`reason`; sin motivo, por el signo) y es solo presentación.

## 38. Análisis explicable y centro de datos y recuperación (etapa 4)

- **Señales** (`domain/analysis.ts`, `analysisItems`): reglas fijas, sin IA ni notificaciones, recalculadas
  al abrir Análisis; cada señal lleva su id estable (regla + registro), gravedad (urgente › atención ›
  para saber), parámetros y un desglose «porque» con las cifras exactas que la producen. Reglas:
  pagos vencidos sin marcar (los mismos que el calendario: Σ importes); saldo proyectado en negativo
  o por debajo de los apartados (misma proyección de §9 a 60 días: saldo real + ingresos previstos −
  pagos previstos hasta ese día = saldo de ese día, al céntimo); límite superado o ≥ umbral «cerca»
  (`planProgress`); meta por detrás del ritmo (`goalPace`, §37); gasto del mes a fecha equivalente del
  mes anterior (gasto neto del día 1 a hoy frente a los mismos días del mes anterior; solo si los datos
  cubren ambos tramos y la base no es 0; aviso desde ±10 %); categoría dominante (≥ 30 % del gasto
  neto del mes); copia de seguridad pendiente (misma regla que el recordatorio; nunca en la demo).
  Nada de esto se guarda ni se posterga: la bandeja de pendientes (§24) sigue siendo el sitio de los
  avisos accionables con posponer/descartar.
- **Navegación**: «Análisis» es destino primario (barra inferior y lateral) y agrupa Avisos,
  Estadísticas, Revisión semanal y ¿Qué cambió? con pestañas; las rutas antiguas no cambian. Cada
  gráfico de Estadísticas lleva su «¿Cómo se calculó?» (categorías, barras, tendencia, comercios).
- **Centro de datos y recuperación** (`domain/recovery.ts`, `recoveryStatus`): estado por filas, cada
  una con icono + texto y enlace a su sección: guardado (IndexedDB / almacenamiento local / solo
  memoria = crítico), copia exportada (nunca = crítico; cambios posteriores = aviso; demo = informativo),
  copia verificada (ninguna = aviso; última exportación sin verificar o > 90 días = informativo),
  copias locales automáticas (sin soporte = aviso), copia previa a la migración
  (`margen.data.before-v<esquema>`), esquema, recuento de registros, papelera, historial local,
  errores registrados (saneados) y modo sin conexión. El estado general es el peor de las filas. El
  orden de recuperación es fijo y honesto: copia exportada › copia local automática › copia previa a
  la migración › papelera › revertir desde el historial; cada paso dice si está disponible ahora.
  Exportar desde el centro es la misma acción (y el mismo registro) que en Copias de seguridad; la
  copia previa a la migración se puede descargar desde el centro (texto exacto, nunca se modifica).
  La antigua sección «Almacenamiento y privacidad» (dónde viven los datos, guardado persistente,
  copia del origen) vive dentro del centro; `/ajustes/almacenamiento` sigue llegando. Nunca hay
  sincronización ni cuenta: si el navegador borra sus datos, solo se recupera lo exportado.

