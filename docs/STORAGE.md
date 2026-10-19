# Almacenamiento, migración y recuperación de Clara

Clara guarda todo en el navegador del dispositivo. No hay servidor ni copia en la nube: la
única protección fuera del navegador son las copias exportadas (`Ajustes › Copia de seguridad`).

## Dónde se guardan los datos

| Navegador | Almacenamiento | Capacidad aproximada |
|---|---|---|
| Con IndexedDB (Chrome, Edge, Firefox, Safari actuales) | IndexedDB, base `clara`, almacén `kv` | Cientos de MB (lo decide el navegador) |
| Sin IndexedDB (algunas ventanas privadas) | `localStorage`, clave `margen.data.v1` | ≈ 5 MB |
| Sin almacenamiento (bloqueado) | Solo memoria, con aviso permanente | Se pierde al cerrar |

### Por qué IndexedDB

No es una preferencia tecnológica. Se midieron dos límites (`docs/PERFORMANCE.md`):

- 50.000 movimientos ocupan 14,8 MB. `localStorage` rechazó guardarlos (`QuotaExceededError`).
- `localStorage` solo permite escrituras síncronas de texto. IndexedDB, en cambio, escribe datos y revisión
  en **una transacción atómica**.

## Garantías al guardar

1. **Todo o nada.** Los datos y su número de revisión se escriben en una transacción. Si
   falla (cuota, permiso, cierre), queda el estado anterior completo.
2. **Sin sobrescrituras silenciosas.** Antes de escribir se comprueba que la revisión
   guardada es la misma que leyó esta pestaña. Si otra pestaña (u otra versión de la app)
   guardó después, se rechaza con `conflict`. La persona ve un aviso y elige: descargar lo
   que ve o cargar lo guardado.
3. **Aviso entre pestañas.** Se envía por `BroadcastChannel`.
4. **Errores visibles.** Si no se puede guardar, un aviso persistente explica el motivo,
   lo almacenado no cambia y se ofrece descargar una copia de lo que se ve. Nunca se muestra
   «Guardado» si no se guardó.
5. **Nunca se reemplazan datos por una demostración ni por un estado vacío.** Abrir con el
   almacenamiento lleno lee los datos igual.

## Migración desde `localStorage` (usuarios de versiones anteriores)

Ocurre una sola vez, al abrir la versión con IndexedDB:

1. Se lee `margen.data.v1` y se **valida completo**. Si está dañado o es de una versión futura,
   no se migra ni se toca nada.
2. Se escribe **tal cual** en IndexedDB, junto con su revisión y un registro de migración
   (`status: 'written'`), en una sola transacción.
3. Se **vuelve a leer** y se compara con el origen. Si no coincide, se detiene y el origen
   queda intacto.
4. Se guarda una copia del texto original en `margen.data.pre-idb` y `margen.data.v1` se
   sustituye por una marca de «versión futura». Así una pestaña con la versión anterior no
   puede sobrescribir nada: muestra «datos de una versión más nueva» y su detección de
   conflictos rechaza guardar. El registro pasa a `status: 'done'`.

- **Interrupciones:** si se cierra entre los pasos 2 y 4, la siguiente apertura encuentra los
  datos en IndexedDB y completa el paso 4. Nunca se importa dos veces: con datos en IndexedDB
  no se vuelve a leer `localStorage`.
- **Sin espacio para la copia:** el original se queda donde estaba (`originKeptInPlace`).
- **Si el navegador borra IndexedDB pero queda la copia del origen:** se recupera desde
  `margen.data.pre-idb` en lugar de mostrar la app vacía.
- La copia del origen **no se borra sola**. En Ajustes se puede descargar o eliminar, con
  confirmación.

Probado en `src/storage/indexedDb.test.ts` y en la prueba de navegador `data-safety.spec.ts`
(usuario de una versión anterior).

## Formato de datos y copias

- Las migraciones de formato (`SCHEMA_VERSION`) se aplican al leer, sobre una copia. La
  versión anterior se conserva en `margen.data.before-v<N>`, en IndexedDB o en
  `localStorage` según el caso.
- Las copias exportadas incluyen todo `AppData`. Se pueden restaurar las de las versiones v1
  a la actual.
- Límite de importación: 100 MB y 500.000 registros por colección. Antes era de 5 MB, y una
  copia de 50.000 movimientos exportada por la propia app no se podía restaurar. Corregido
  y probado en `roundtrip.test.ts`.

## Qué borra «Borrar todos los datos»

- Los datos en IndexedDB y su revisión.
- `margen.data.v1` y la copia del origen `margen.data.pre-idb`; sin esto, reaparecerían al
  abrir.
- No borra las preferencias visuales (tema), que no son datos financieros.

## Límites honestos

- El navegador puede borrar los datos por su cuenta: al limpiar los datos del sitio, con
  poco espacio, o en Safari tras unos 7 días sin abrir el sitio si no está instalado. La
  app puede pedir almacenamiento persistente (`Ajustes`), pero el navegador decide.
- Los datos **no están cifrados** ni protegidos con contraseña.
- Si IndexedDB deja de estar disponible después de migrar (p. ej. al abrir en una ventana
  privada), la app ve la marca de «versión futura» y no toca nada. Los datos siguen en
  IndexedDB del perfil normal.

## Historial de cambios (formato v8)

- Se guarda dentro de `AppData` (`history`, `historyStartedAt`), en la misma transacción que
  los datos: no puede quedar un cambio sin su entrada ni al revés.
- Viaja en las copias exportadas y se restaura con ellas. Importar una copia añade una entrada
  de corte (`replace`).
- «Borrar todos los datos» también lo borra.
- Límite: 1000 entradas. Detalle de reglas en `docs/FORMULAS.md` §26.
- Las versiones anteriores a v8 empiezan con historial vacío: la migración no inventa cambios
  pasados (`historyStartedAt` = última fecha de guardado conocida).
- v14 (auditoría del PR #15, QA-05): cada entrada registra también `templates`, `scenarios` e
  `inboxSnoozed` (los aplazamientos de `inbox.snoozed`), que partir un programado reescribe. Así
  revertir la partición los devuelve y un cambio posterior en ellos es un conflicto. Las entradas
  anteriores no los tienen y siguen pudiendo revertirse; una copia v13 se restaura sin cambios. Los
  aplazamientos solo acompañan a otros cambios (posponer o retirar un aviso no crea entrada) y uno
  caducado que ya no está no cuenta como conflicto ni se resucita al revertir (revisión propia, R5).

## Copias locales automáticas (v2)

- Base IndexedDB aparte: `clara-backups`, almacén `backups` (`storage/autoBackup.ts`). Cada registro guarda el JSON
  completo de una copia (mismo formato que la exportación), su motivo (`auto`, `manual`, `beforeRestore`,
  `beforeDelete`, `beforeMigration`), tamaño, `budgetId` y `updatedAt` de los datos copiados.
- Reglas: automática cada 24 h con la app abierta solo si `updatedAt` cambió y no es la demo; antes de restaurar y
  de borrar todo; se conservan las 10 más recientes (poda en la misma transacción que la escritura).
- Restaurar valida el JSON como cualquier importación (`validateAppData`), guarda antes una copia de lo actual y
  aplica con `commit(..., { source: 'replace' })`, con deshacer inmediato.
- El bloqueo con PIN (`ui/lock/pin.ts`) vive en `localStorage` (`clara.lock.v1`), nunca en estas copias ni en
  las exportaciones.

## Copias cifradas (v2)

- Sobre JSON `{ format: 'clara-encrypted-backup', version: 1, kdf: 'PBKDF2-SHA-256', iterations, salt, iv, cipher: 'AES-GCM-256', data }`
  (`storage/encryptedBackup.ts`). `data` es la copia normal (`clara-backup`) cifrada; sal e IV aleatorios por archivo.
- La frase nunca se guarda ni viaja en el archivo. Al importar, `looksEncrypted` detecta el sobre, se pide la frase, se
  descifra y el resultado pasa por `parseBackup`/`validateAppData` como cualquier copia. Una frase incorrecta y un
  archivo alterado dan el mismo error (AES-GCM no los distingue).
