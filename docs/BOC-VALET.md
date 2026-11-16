# Banco de Canadá · Valet: lo comprobado

Comprobado el **16 de noviembre de 2026** desde el entorno «clara» (que sí puede abrir www.bankofcanada.ca), leyendo la
documentación oficial y haciendo peticiones reales con `curl`. Lo que usa Clara (`src/domain/boc.ts`,
`src/state/bocRates.ts`; decisión 181) sale solo de aquí. Las respuestas guardadas como datos de prueba están en
`src/domain/__fixtures__/boc/` (tal cual llegaron).

## Documentación leída

- https://www.bankofcanada.ca/valet/docs — Swagger UI; la especificación es
  https://www.bankofcanada.ca/valet/static/swagger/api-en.yml (OpenAPI 3.0.3, «Valet API» 1.0.1, servidor
  `https://www.bankofcanada.ca/valet`).
- https://www.bankofcanada.ca/valet-api-how-to/ — guía: **sin registro ni clave, sin coste**; para los límites de
  peticiones remite a las condiciones de uso y pide empezar despacio y no saturar el sistema.
- https://www.bankofcanada.ca/terms/ — condiciones de uso (ver «Condiciones» abajo).

## La petición

```
GET https://www.bankofcanada.ca/valet/observations/{seriesNames}/json?start_date=AAAA-MM-DD&end_date=AAAA-MM-DD
```

- `seriesNames`: una o varias series separadas por comas, `FX<moneda>CAD` (patrón `^[\w.,-]{1,}$`).
- `format`: `json`, `csv` o `xml` (Clara usa `json`).
- `start_date` / `end_date`: «todas en o después de» / «en o antes de» la fecha (AAAA-MM-DD). El banco exige que el
  fin sea **mayor** que el inicio: `start_date=2026-11-10&end_date=2026-11-01` → HTTP 400 «The End date must be
  greater than the Start date.». Con inicio = fin respondió 200 con esa observación.
- `recent`, `recent_weeks`, `recent_months`, `recent_years`: las N más recientes; **no se pueden usar junto con**
  `start_date`/`end_date` (dice la especificación). Clara no los usa.
- `order_dir`: `asc` o `desc`. Clara no lo usa (no depende del orden).

Clara pide **una serie** y la ventana `fecha del gasto − 10 días … fecha del gasto`, p. ej.
`/observations/FXJPYCAD/json?start_date=2026-10-31&end_date=2026-11-10`.

## La respuesta (JSON)

Real, `FXJPYCAD` del 4 al 10-nov-2026 (`__fixtures__/boc/FXJPYCAD-2026-11-04_2026-11-10.json`, abreviada):

```json
{
  "terms": { "url": "https://www.bankofcanada.ca/terms/" },
  "seriesDetail": {
    "FXJPYCAD": {
      "label": "JPY/CAD",
      "description": "Daily average exchange rate of the Japanese yen in Canadian dollars.",
      "dimension": { "key": "d", "name": "Date" },
      "dateFormat": "daily",
      "metadata": { "unit": "Canadian dollars per Japanese yen", "frequency": "Business daily" }
    }
  },
  "observations": [
    { "d": "2026-11-06", "FXJPYCAD": { "v": "0.008910" } },
    { "d": "2026-11-09", "FXJPYCAD": { "v": "0.008940" } }
  ]
}
```

- La fecha está en `observations[i].d` (AAAA-MM-DD); el valor en `observations[i].<serie>.v`, **como texto**.
- Decimales: 4 para USD/EUR/CNY (`"1.3737"`, `"0.2126"`), 6 para JPY/KRW/IDR/VND (`"0.008940"`, `"0.001056"`,
  `"0.000078"`), 5 para TWD/RUB (`"0.04335"`), con ceros a la derecha. Clara lo lee con `parseRate` (texto exacto,
  nunca un flotante) y lo guarda en forma canónica (`"0.00894"`).
- **Dirección:** «Canadian dollars per Japanese yen»: CAD por 1 unidad de la otra moneda, la misma que la tasa de Clara
  (`convertToBudget`: unidades del presupuesto por 1 unidad de la otra). Una prueba lo comprueba en las respuestas
  guardadas.
- Ventana sin días hábiles (sábado y domingo): HTTP 200 con `"observations": []`
  (`__fixtures__/boc/FXUSDCAD-2026-11-07_2026-11-08-empty.json`).
- Serie que no existe: HTTP 404 con `{"message": "Series FXXXXCAD not found.", "docs": "…"}`
  (`__fixtures__/boc/FXXXXCAD-404.json`).
- Fecha mal escrita: HTTP 400 con `{"message": "Start date contains a value that is not allowed. …"}`.
- Cabeceras: `Content-Type: application/json; charset=utf-8`, `Cache-Control: max-age=30`.

## Fines de semana, festivos y publicación

- No hay observación los fines de semana ni los festivos. Real (`__fixtures__/boc/FXUSDCAD-2025-12-22_2026-01-05.json`):
  hay 24-dic, 29-dic, 30-dic, 31-dic y 2-ene; **no** hay 25, 26, 27 y 28-dic ni 1-ene. El hueco más largo visto: 4 días
  seguidos sin tasa.
- El grupo `FX_RATES_DAILY` dice: «typically published once each business day by 16:30 (ET)» y «All Bank of Canada
  exchange rates are indicative rates only». La documentación avisa además de un posible retraso entre la publicación y
  su llegada a la API («check back later in the day»). El lunes 16-nov a las 19:25 (hora del Este) aún no estaba la del
  día: la última era la del viernes 13.
- Series que dejaron de publicarse siguen en el grupo: `FXVNDCAD` termina el 31-dic-2019 y `FXRUBCAD` el 30-abr-2026
  (con `recent=1`). Por eso Clara solo acepta una observación de como mucho 10 días antes de la fecha del gasto
  (`__fixtures__/boc/FXVNDCAD-2026-10-30_2026-11-09-discontinued.json`: lista vacía).
- Los datos de `FXUSDCAD` empiezan el 3-ene-2017 (pidiendo desde 2010 llega primero el 3-ene-2017).

## Monedas publicadas

`GET https://www.bankofcanada.ca/valet/groups/FX_RATES_DAILY/json` → `groupDetail.groupSeries` con 27 series:
AUD, BRL, CHF, CNY, EUR, GBP, HKD, IDR, INR, JPY, KRW, MXN, MYR, NOK, NZD, PEN, PLN, RUB, SAR, SEK, SGD, THB, TRY, TWD,
USD, VND y ZAR (todas `FX<moneda>CAD`). Clara usa las 26 que admite (no admite el rublo): `BOC_CURRENCIES`.

## CORS (decide si hace falta la capa nativa)

- `curl -sI -H "Origin: https://example.org" …/observations/FXUSDCAD/json?recent=1` → `Access-Control-Allow-Origin: *`.
  La misma cabecera en las respuestas sin `Origin`.
- `OPTIONS` (consulta previa) → **HTTP 302** a `https://maintenance.bankofcanada.ca/index.html`: el servidor no la
  atiende. Por eso la petición de Clara es un GET «simple» **sin cabeceras propias** (sin `Content-Type`, sin
  `Authorization`…): no hay consulta previa y basta `Access-Control-Allow-Origin: *`. Con `credentials: 'omit'`
  y `referrerPolicy: 'no-referrer'` tampoco van cookies ni la dirección de la app.
- Conclusión: la web y el WebView de la app (origen `capacitor://localhost`) pueden pedirla con `fetch`; **no hace
  falta HTTP nativo** ni nada en `src/platform/native/`. Que funcione de verdad dentro del WebView del iPhone está
  **sin probar** (lo prueba Victor: comprobación 40 de `docs/IOS-NATIVE.md`).
- CSP de la versión compilada: `connect-src 'self' https://www.bankofcanada.ca` (solo ese origen, `vite.config.ts`).
  Una redirección (p. ej. a la página de mantenimiento) se rechaza (`redirect: 'error'`) y no hay tasa.

## Condiciones de uso y atribución

De https://www.bankofcanada.ca/terms/ (leído el 16-nov-2026):

- «1.1 Attribution — You must attribute the Bank of Canada as the source of the content … but not in any way that
  suggests that the Bank endorses you or your use of the content.» → Clara dice «Fuente: Banco de Canadá» en Ajustes
  y «tasa indicativa del Banco de Canadá del <fecha>» junto a cada tasa. No usa el logotipo (2.2 lo prohíbe sin
  permiso).
- «All Bank of Canada exchange rates are indicative rates only … do not necessarily reflect the rates at which actual
  market transactions have been or could be conducted … released for statistical and analytical purposes only» → por
  eso Clara la llama «indicativa» y «Con lo que cobró el banco» sigue mandando.
- 1.3 (aviso si se revende el contenido) no aplica: Clara no vende nada.

## Lo que no se pudo comprobar

- Un límite de peticiones concreto: la documentación no da cifras. Clara pide una serie por fecha, una detrás de otra,
  guarda lo definitivo en la caché y deja de insistir si no hay conexión.
- Si el banco revisa una tasa ya publicada: no se vio ninguna revisión; Clara guarda la de cada movimiento en él
  (`original.rate`), así que una revisión posterior no cambiaría nada registrado.
- El comportamiento dentro del WebView del iPhone (CORS con `capacitor://localhost`, sin conexión real): sin probar.
