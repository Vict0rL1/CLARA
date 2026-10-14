# Publicar Clara (beta)

Clara sigue siendo un **prototipo local**: los datos viven solo en el dispositivo de cada persona.
Publicar significa poner los archivos de la app en una dirección web; no hay servidor que guarde datos.

Este documento tiene dos partes:

- **Lo que tienes que hacer tú**: pasos que solo puede hacer el dueño del repositorio (Victor), con los
  valores exactos. Nada de esto se hace solo.
- **Cómo funciona**: qué comprueba cada parte de la automatización.

---

## Lo que tienes que hacer tú

### A. Proteger la rama `main` (una sola vez)

Hazlo después de que el PR de la beta tenga CI en verde al menos una vez: GitHub solo te deja elegir
comprobaciones que ya se ejecutaron alguna vez.

0. **Rama por defecto = `main`.** Hoy la rama por defecto del repositorio es
   `claude/margen-personal-finance-app-cdvrt3` (de una fase anterior). En GitHub › **Settings** ›
   **General** › **Default branch** › botón ⇄ › elige `main` › **Update** › confirma. Así los PR nuevos
   apuntan a `main` y la insignia y las reglas hablan de la misma rama. No borra ninguna rama.
1. Abre el repositorio en GitHub › **Settings** › **Rules** › **Rulesets** › **New ruleset** ›
   **New branch ruleset** (en la versión antigua: **Settings** › **Branches** › **Add branch protection rule**).
   - Nombre: `main protegida`. **Enforcement status**: `Active`.
   - **Target branches** › **Add target** › **Include default branch** (o escribe el patrón `main`).
2. Marca **Require a pull request before merging**.
3. Marca **Require status checks to pass** y añade estas comprobaciones (escríbelas tal cual):
   - `check`
   - `e2e (celular)`
   - `e2e (celular-pequeno)`
   - `e2e (escritorio)`
   - `deploy-preview / Cloudflare Pages` (el despliegue de prueba; aparece cuando se haya ejecutado
     una vez, es decir, después de los pasos de B)
4. Marca **Block force pushes** (en la versión antigua: deja **Allow force pushes** sin marcar).
5. Pulsa **Create** (o **Save changes**).

Para comprobarlo: en un PR, el botón de fusionar debe quedar bloqueado mientras alguna de esas
comprobaciones no esté en verde.

### B. Cloudflare Pages (una sola vez)

Clara se publica en Cloudflare Pages desde GitHub Actions: GitHub compila, prueba y sube la carpeta
`dist/`. Cloudflare no lee el repositorio ni compila nada. El plan gratuito basta y no pide tarjeta.

1. **Cuenta y proyecto.**
   1. Crea una cuenta gratuita en <https://dash.cloudflare.com/sign-up> y confirma el correo.
   2. En el panel: **Workers & Pages** › **Create**. En la pantalla «Make something new», **no** elijas
      «Upload your static files» (crea un *Worker*, no un proyecto de Pages): pulsa el enlace de abajo
      **Continue to Pages** (en «Need to use the legacy Pages workflow?») › **Use direct upload**
      («Subir recursos», **no** «Connect to Git»). En paneles más antiguos: pestaña **Pages** ›
      **Use direct upload**.
   3. **Project name**: `clara`. Pulsa **Create project**. Si después te pide subir archivos, sube la
      carpeta `dist/` de una compilación local (`npm run build`) o cierra esa pantalla: el primer
      despliegue real lo hará GitHub.
   4. Si prefieres la terminal, lo mismo en un solo paso:
      `npx wrangler login` y luego `npx wrangler pages project create clara --production-branch=main`.
   5. La rama de producción debe ser `main` (proyecto `clara` › **Settings** › **Builds & deployments**
      › **Production branch**).
2. **Token de la API con un solo permiso.**
   1. Arriba a la derecha: tu perfil › **My Profile** › **API Tokens** › **Create Token** ›
      **Create Custom Token** › **Get started**.
   2. **Token name**: `clara-github-deploy`.
   3. **Permissions**: `Account` · `Cloudflare Pages` · `Edit`. **Ningún otro permiso.**
   4. **Account Resources**: `Include` · tu cuenta.
   5. **Continue to summary** › **Create Token**. Copia el token: Cloudflare solo lo muestra una vez.
      No lo pegues en ningún archivo, chat ni correo.
3. **Secretos en GitHub.**
   1. Copia tu **Account ID**: **Workers & Pages** › columna derecha › **Account ID** (también es el
      número largo que aparece en la dirección del panel, `dash.cloudflare.com/<Account ID>/…`).
   2. En GitHub: el repositorio › **Settings** › **Secrets and variables** › **Actions** ›
      **New repository secret**, dos veces:
      - Name `CLOUDFLARE_API_TOKEN` · Secret: el token del paso 2.
      - Name `CLOUDFLARE_ACCOUNT_ID` · Secret: el Account ID.
4. **Deja Cloudflare Web Analytics desactivado** (proyecto `clara` › **Metrics** › **Web Analytics**:
   no lo actives). Su script lo bloquearía la CSP de Clara y rompería la promesa de «sin terceros».
5. **Dirección pública.** Tras el primer despliegue a producción, la app queda en
   **`https://clara-d3m.pages.dev`** (`clara.pages.dev` ya estaba ocupado y Cloudflare añadió el sufijo
   `-d3m`; el nombre del proyecto sigue siendo `clara`). Ya está escrita en el README.

Hasta que existan los dos secretos, el trabajo `deploy-preview` de cada PR falla con el mensaje
«Faltan los secretos de Cloudflare»: no se despliega nada y no se finge que se desplegó.

### C. Dirección para «Enviar comentarios» (opcional, 1 minuto)

Ajustes › **Enviar comentarios** abre la app de correo con un texto técnico ya escrito. Para que el
destinatario venga relleno:

1. GitHub › el repositorio › **Settings** › **Secrets and variables** › **Actions** › pestaña
   **Variables** › **New repository variable**.
2. Name `CLARA_FEEDBACK_EMAIL` · Value: la dirección donde quieres recibir los comentarios.
3. **Add variable**. Se usa desde la siguiente compilación.

Es una **variable**, no un secreto: la dirección queda escrita en la app publicada y cualquiera que la
abra puede verla. Usa una dirección que no te importe publicar (por ejemplo, un alias para la beta).
Sin ella, el correo se abre sin destinatario y Clara lo dice.

### D. Prueba de Atajos en tu iPhone (unos 10 minutos, cuando haya dirección pública)

1. Sigue `docs/IOS-SHORTCUTS.md` para crear el atajo A (Apple Pay) y el B (Tocar atrás).
2. Haz las cuatro pruebas de la tabla (Clara instalada y en una pestaña de Safari) y rellénala.
3. Pega la tabla en el PR o en un issue: con eso se decide si queda el enlace o el paso por el
   portapapeles (L3).

### E. Prueba en tus dispositivos (unos 20 minutos, con la dirección pública)

Sigue `docs/DEVICE-TEST.md` en el iPhone (pestaña de Safari y app instalada), en un Android con la app
instalada y en la computadora. Pega la tabla en el primer aviso semanal (F).

### F. Semanas 1–3: usar Clara de verdad

La beta sirve si Clara se usa con dinero real todos los días. Durante tres semanas:

1. **Cada día: registra todos tus gastos reales en Clara** (la app instalada en tu teléfono), el mismo
   día. Si un gasto se te pasó, regístralo igualmente con su fecha. Haz una copia (Ajustes › Copias de
   seguridad › Exportar copia › Guardar en Archivos) al menos una vez por semana.
2. **Cada semana** (por ejemplo, el domingo): GitHub › **Issues** › **New issue** › **Beta: comentario
   semanal**. Rellena dispositivo, modo, qué hiciste, qué esperabas, qué pasó y pega el informe de
   errores (Ajustes › Acerca de › Informe de errores › **Copiar informe**). Después pulsa **Borrar
   informe** para que la semana siguiente empiece vacía. Aunque todo haya ido bien, abre el aviso.
3. **Cada fallo concreto**, en cuanto lo veas: **New issue** › **Error** (pasos, qué esperabas, qué
   pasó, el informe de errores). Si el fallo cambió o perdió datos, dilo arriba del todo.
4. **Cada despliegue a producción** lleva su etiqueta `v1.0.0-beta.N` (N = 2, 3, …):
   1. En el PR que se va a fusionar en `main`: sube la versión con
      `npm version 1.0.0-beta.N --no-git-tag-version` (cambia `package.json` y `package-lock.json`) y en
      `CHANGELOG.md` convierte «[Sin publicar]» en «[1.0.0-beta.N] — AAAA-MM-DD» con un «[Sin publicar]»
      vacío encima. Fusiona.
   2. Espera a que `deploy-production` termine en verde (GitHub › **Actions**).
   3. GitHub › **Releases** › **Draft a new release** › **Choose a tag** › escribe `v1.0.0-beta.N` ›
      **Create new tag on publish** · **Target**: `main` · título `Clara 1.0.0-beta.N` · pega la sección
      del CHANGELOG · marca **Set as a pre-release** › **Publish release**.
      (En la terminal: `git tag v1.0.0-beta.N <commit de main> && git push origin v1.0.0-beta.N`.)
   4. Comprueba que Ajustes › Acerca de en la dirección pública muestra `1.0.0-beta.N` y la compilación
      de ese commit. La etiqueta es la que usa `docs/ROLLBACK.md` para saber a qué volver.
5. **Al final de la semana 3**: repasa los avisos, decide qué se arregla antes de invitar a nadie más y
   anótalo en `docs/ROADMAP.md`.

---

## Cómo funciona

### Integración continua (`.github/workflows/ci.yml`)

Se ejecuta en cada PR y en cada `push` a `main`. Si llega un `push` nuevo a la misma rama, la ejecución
anterior se cancela.

| Trabajo | Qué hace | Límite |
|---|---|---|
| `check` | `npm ci`, `npm run check` (tipos, lint, textos sin traducir, pruebas unitarias), `npm run build`, `npm run size` (presupuesto de tamaño) y sube `dist/` como artefacto | 15 min |
| `e2e (celular)`, `e2e (celular-pequeno)`, `e2e (escritorio)` | Instala Chromium y ejecuta todas las pruebas de navegador de ese tamaño con `--fail-on-flaky-tests` | 30 min |

- En CI cada prueba se reintenta **una** vez. Si falla y luego pasa, cuenta como **inestable** y el
  trabajo falla igualmente: una prueba inestable es un error que hay que entender, no ruido.
- Si un trabajo de navegador falla, GitHub guarda durante 7 días el artefacto
  `playwright-<tamaño>` con las trazas (`test-results/`) y el informe HTML (`playwright-report/`).
  Para verlo: descárgalo desde la ejecución en la pestaña **Actions** y ábrelo con
  `npx playwright show-report playwright-report` o `npx playwright show-trace <archivo>.zip`.
- Si algún trabajo de navegador tarda más de 15 minutos en GitHub, se divide en dos mitades
  (`--shard=1/2` y `--shard=2/2`) en lugar de subir el límite.

### Proveedor remoto del asistente (`VITE_AI_ENDPOINT` y `VITE_AI_KEY`)

La beta no lo configura: el asistente analiza el texto en el dispositivo. Si algún día se activa, dos
reglas que la compilación comprueba sola (`npm run build` falla con el motivo; no se publica nada):

- Todo lo que empieza por `VITE_` **viaja dentro de la app**: cualquiera que la abra puede leerlo. Por eso
  `VITE_AI_KEY` solo puede ser un **token público de alcance limitado** para un servicio propio (que
  guarde la credencial real del proveedor, imponga cuotas y autorice por usuario). Una clave con forma
  de secreto de proveedor (`sk-…`, `AIza…`, `gsk_…`, `AKIA…`, `ghp_…`) detiene la compilación.
- `VITE_AI_ENDPOINT` debe ser `https` y **no** el host de un proveedor de IA (OpenAI, Anthropic, Google,
  Mistral, Groq, OpenRouter, Azure, Bedrock…): si fuera directo, la clave sería la credencial de ese
  proveedor. Las dos variables van juntas o ninguna. El host se compara sin mayúsculas ni puntos finales
  (`api.openai.com.` es `api.openai.com`), y la URL no puede llevar usuario/contraseña
  (`https://u:p@…`) ni parámetros con forma de credencial (`?key=`, `?token=`, `?api_key=`…).
- `VITE_AI_ALLOWED_ORIGINS` (orígenes https **del servicio propio**, separados por comas) es obligatoria:
  el origen de `VITE_AI_ENDPOINT` tiene que estar en esa lista, que decide quien despliega. Sin lista, con
  otro origen u otro puerto, la compilación falla (`originNotAllowed`). Una entrada que sea un proveedor de
  IA, no https o con credenciales se ignora.

La política de seguridad de contenido solo añade ese origen cuando la configuración pasa, y la app usa
el análisis local en cualquier otro caso sin fingir un proveedor (`src/domain/aiConfig.ts`, decisión 138).

**Límite de estas comprobaciones (auditoría 2026-10-12, R-01 condicional).** Son guardas de forma: un token
opaco (sin forma de secreto conocido) en un host `https` que no esté en la lista de proveedores **pasa**, y
la compilación no puede saber qué hay detrás de esa dirección. Por eso activar el proveedor exige, antes
de definir las variables y fuera de este repositorio, un servicio propio que cumpla todo esto (ninguno
existe hoy y aquí no se afirma lo contrario):

1. Guarda la credencial real del proveedor en su servidor; el token público solo identifica a la app.
2. Autoriza por usuario o por instalación y limita el uso (cuotas y ritmo), de modo que un token copiado
   del paquete no sirva para gastar la cuota de otros.
3. No registra ni conserva el texto financiero más allá de la respuesta; el contrato de datos se documenta
   antes de activarlo y se refleja en Ajustes › Privacidad (hoy dice que el análisis es local).
4. Responde con el mismo formato que `aiProvider.ts` sanea (`sanitize`): la app sigue sin aceptar importes,
   fechas o categorías fuera de lo permitido, y sigue cayendo al análisis local ante cualquier error.
5. Se prueba contra la vista previa de Cloudflare con `VITE_AI_ENDPOINT`/`VITE_AI_KEY` definidos como
   **variables de repositorio** (nunca secretos) y se comprueba en el navegador que `connect-src` solo
   añade ese origen.

Estabilización 2026-10-13 (punto 11): la auditoría no tuvo un endpoint real ni secretos, y aquí tampoco.
Antes de activar la función hay que verificar **en el entorno desplegado**: el alcance real del token
público (qué puede pedir y a quién), su cuota y ritmo por usuario, su caducidad y rotación, y los controles
del servidor (autorización, registros sin texto financiero, errores que no filtran la credencial). Las
comprobaciones de este repositorio son de forma y no sustituyen esa verificación.

Hasta entonces la beta compila sin proveedor: no hay ningún servicio activado, contratado ni probado.

### Despliegues (`.github/workflows/deploy.yml`)

`ci.yml` llama a `deploy.yml` solo cuando `check` y los tres `e2e` están en verde, así que nada sin
pruebas llega a Cloudflare y el resultado aparece como una comprobación más del mismo commit:

| Cuándo | Trabajo | Qué hace |
|---|---|---|
| Cada PR | `deploy-preview / Cloudflare Pages` | Sube el `dist/` ya probado como vista previa de la rama (`wrangler pages deploy dist --project-name=clara --branch=<rama>`), ejecuta `npm run test:smoke -- --project=celular` contra esa dirección y deja la dirección en un comentario del PR (uno solo, que se actualiza). |
| Cada push a `main` | `deploy-production / Cloudflare Pages` | Lo mismo como despliegue de producción y prueba rápida contra él. |

- Las pruebas rápidas se ejecutan contra la dirección única de ese despliegue
  (`https://<id>.clara-d3m.pages.dev`): es exactamente lo que se acaba de subir.
- Sin los secretos de Cloudflare el trabajo falla con «Faltan los secretos de Cloudflare» y no sube nada.
- Para probar a mano cualquier dirección: `BASE_URL=https://… npm run test:smoke -- --project=celular`
  (con `BASE_URL` no se compila ni se sirve nada en local).

Si algo sale mal después de publicar: [`docs/ROLLBACK.md`](ROLLBACK.md). Cada despliegue lleva en su
mensaje `schemaVersion=N build=<hash>`, y solo se vuelve a uno con el mismo esquema.

### Pruebas rápidas (`npm run test:smoke`)

Unas diez pruebas marcadas con `@smoke` recorren lo esencial: configuración inicial, agregar un gasto,
pegar varias líneas en el asistente, eliminar y «Deshacer», modo privado, cambio de idioma, exportar
una copia, recargar sin conexión y la pantalla de datos de una versión más nueva. Sirven para el ciclo
local rápido y para comprobar cada despliegue.

```bash
npm run test:smoke                       # los tres tamaños
npm run test:smoke -- --project=celular  # solo celular
```

### Presupuesto de tamaño (`npm run size`)

`scripts/check-size.mjs` suma el JavaScript que `index.html` carga al abrir la app y falla si pasa de
la referencia de `scripts/size-baseline.json` en más de un 10 %. Si el aumento es intencionado:

```bash
npm run build
npm run size -- --update
```

y guarda `scripts/size-baseline.json` **en su propio commit**, explicando el motivo.
