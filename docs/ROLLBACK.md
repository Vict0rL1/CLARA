# Volver atrás un despliegue (rollback)

Clara guarda los datos de cada persona en su propio navegador, con un formato que tiene número:
`SCHEMA_VERSION` (hoy **14**, en `src/domain/types.ts`). Cuando una versión nueva cambia ese número,
al abrirse **convierte** los datos al formato nuevo (antes guarda una copia del original). Por eso
volver a una versión anterior no siempre es seguro.

## La regla

- **Mismo `SCHEMA_VERSION` → se puede volver atrás** desde Cloudflare (pasos abajo).
- **Distinto `SCHEMA_VERSION` → nunca se vuelve atrás. Se corrige hacia delante**: se revierte el
  commit que falla y se despliega una compilación nueva que mantiene el esquema actual.

### Por qué (lo que se comprobó, V2)

Con datos ya convertidos al esquema 12, la compilación anterior de `main` (esquema 8) muestra **una
página en blanco**. Los datos siguen intactos, pero la persona ve una app vacía y cree que los perdió.
Una versión anterior no sabe leer un formato que todavía no existía cuando se escribió.

Desde 1.0.0-beta.1 (H4), una versión que encuentra datos de una versión más nueva ya no se queda en
blanco: explica que los datos son de una versión más nueva y solo ofrece «Recargar la app» o
«Descargar una copia de estos datos», nunca «Empezar de nuevo». Aun así, la regla no cambia: esa
pantalla sirve para que nadie pierda nada, no para usar la app.

## ¿Puedo volver a este despliegue?

Cada despliegue lleva en su mensaje el esquema y la compilación, por ejemplo
`schemaVersion=10 build=0b99c4c` (lo escribe `.github/workflows/deploy.yml`). Compara el actual con
aquel al que quieres volver:

```bash
node scripts/can-rollback.mjs 10 10                  # Sí
node scripts/can-rollback.mjs 10 8                   # No: corrige hacia delante
node scripts/can-rollback.mjs HEAD v1.0.0-beta.1     # también acepta commits o etiquetas de git
node scripts/can-rollback.mjs "schemaVersion=10 build=0b99c4c" "schemaVersion=10 build=1da431c"
```

Responde «Sí» o «No» y por qué (código de salida 0 o 1).

## Volver atrás en Cloudflare (solo con el mismo esquema)

1. Entra en <https://dash.cloudflare.com> › **Workers & Pages** › proyecto **clara** › pestaña
   **Deployments**.
2. Busca en la lista de **Production** el despliegue al que quieres volver y mira su mensaje
   (`schemaVersion=…`). Comprueba con `node scripts/can-rollback.mjs <actual> <destino>` que dice «Sí».
3. En esa fila, menú **⋯** › **Rollback to this deployment** › confirma.
4. Comprueba lo publicado:
   `BASE_URL=https://clara-d3m.pages.dev npm run test:smoke -- --project=celular`
   (usa la dirección real si Cloudflare añadió un sufijo).
5. Quien ya tenga la app abierta verá el aviso «Hay una versión nueva de Clara» y actualizará cuando
   no tenga un formulario a medias: el service worker trata la versión anterior como una más.
6. Arregla el fallo en un PR normal; al fusionarlo, CI vuelve a desplegar `main`.

## Corregir hacia delante (distinto esquema, o cuando dudes)

1. Crea una rama desde `main` y revierte el commit que falla: `git revert <commit>`.
   **No** bajes `SCHEMA_VERSION` ni borres migraciones: los datos de quien ya actualizó están en el
   esquema actual y deben seguir leyéndose.
2. Abre un PR. CI ejecuta todas las pruebas y `deploy-preview` publica una vista previa con la prueba
   rápida.
3. Fusiona en `main`: `deploy-production` despliega y vuelve a ejecutar la prueba rápida.
4. Si el fallo estaba en la migración misma, la copia previa (`margen.data.before-v12` en el
   navegador de cada persona) sigue ahí: el arreglo puede volver a migrar desde ella. Nunca se borra
   para «solucionar» una incompatibilidad.
5. Suelo de la auditoría de seguimiento (F-01): el esquema 14 no cambió, pero las versiones anteriores
   a `7e5e5d0` rechazaban al recargar un historial con ids de aviso de más de 64 caracteres (los de
   `inboxSnoozed`, hasta 300) que ellas mismas habían guardado. Volver a un despliegue anterior a ese
   commit volvería a dejar esos presupuestos como «datos dañados» (sin borrar nada), así que ante un
   problema en v14 se corrige hacia delante: nunca por debajo de `7e5e5d0`.
