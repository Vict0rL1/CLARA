# Clara nativa para iPhone: plan de trabajo

Plan del encargo «Clara nativa para iPhone: captura automática, varias monedas y todas las mejoras» (12 de noviembre
de 2026). Se actualiza al terminar cada fase. Las decisiones con su porqué están en `docs/DECISIONS.md` (152–163).

> **Regla de honestidad.** Este plan se escribe en un entorno Linux sin Xcode ni iPhone. Nada de `ios/` se ha
> compilado todavía. Cada cosa nativa lleva uno de estos estados: **escrito** (código hecho, sin compilar),
> **compila** (lo compiló Victor en su Mac) o **probado en iPhone** (lo probó Victor). Nunca se salta un estado.

## 1. Estado actual (12-nov-2026)

- **Web (PWA):** React 19 + TypeScript + Vite 8, sin backend, datos en IndexedDB, esquema 14. Publicada en Cloudflare
  Pages. 1 241 pruebas unitarias y 406 de navegador por tamaño, en verde en CI.
- **Rama:** `feat/ios-nativo`. Parte de `main` **más** los commits del PR #16 (auditoría del 2026-11-04, en verde y
  sin fusionar) y el primer commit de la cáscara nativa (`44bd76e`). El motivo está en la decisión 162. Mientras el
  PR #16 no se fusione, el PR de la Fase 1 incluye también sus commits.
- **Ya hecho de la Fase 1 (escrito, sin compilar):** Capacitor 8.6.0, proyecto `ios/` con Swift Package Manager, icono
  y pantalla de arranque (claro y oscuro) desde `public/icon.svg`, textos de permiso de cámara y micrófono, gesto de
  «atrás», y la web reconoce la app para no ofrecer «Instalar Clara».
- **Lo que este plan cambia de ese primer commit:** el identificador de la app pasa a la propuesta del encargo
  (`com.victorli.clara`, pendiente de confirmar), la detección pasa a la capa `src/platform/`, la configuración pasa a
  `capacitor.config.ts`, el destino mínimo sube a iOS 18.0 y la guía pasa a `docs/IOS-NATIVE.md`.
- **Lo que hay hoy para Apple Pay:** un enlace y el portapapeles que solo rellenan un formulario
  (`docs/IOS-SHORTCUTS.md`); la prueba de si el enlace llega a los datos nunca se hizo. Se quedan para la PWA.

## 2. Fases

Las Fases 1, 2 y 3 tienen que estar probadas en el iPhone **antes del 15 de diciembre**. Un PR a `main` por fase; se
fusiona cuando Victor la haya probado.

| Fase | Qué | Estado |
|---|---|---|
| 0 | Rama, este plan, decisiones 152–163, `CLAUDE.md` | Hecho |
| 1 | Clara funciona en el iPhone como app nativa | En curso |
| 2 | Los pagos con Apple Pay se registran solos | Pendiente |
| 3 | Varias monedas y modo viaje | Pendiente |
| 4 | Pagos sin Apple Pay y registrar en un toque | Pendiente |
| 5 | Voz, recibos e IA en el iPhone | Pendiente |
| 6 | Widgets, Siri y avisos reales | Pendiente |
| 7 | Préstamos y gastos compartidos | Pendiente |
| 8 | Pulido general en el iPhone | Pendiente |
| 9 | iCloud y TestFlight | No se empieza sin que Victor lo pida |

### Fase 1, por bloques (un commit por bloque)

1. **Arquitectura de la cáscara.** `src/platform/` con `isNativeIOS()` y carga diferida de lo nativo; ningún import
   de Capacitor fuera de esa carpeta; `capacitor.config.ts`; iOS 18.0; guiones `ios:sync` e `ios:open`; el
   *service worker* no se registra en nativo.
2. **Datos duraderos.** Plugin local `ClaraStorage` (Swift, en el target de la app): archivo JSON en Application
   Support con escritura atómica, copia previa y detección de conflicto por revisión. `NativeRepository` implementa
   `DataRepository`. Primer arranque: migra lo que hubiera en IndexedDB del WebView, relee y compara, y no borra
   nada. Pruebas TS con el plugin simulado y pruebas Swift de la escritura.
3. **Textos de la app nativa.** «Instalar Clara», la persistencia del navegador y los textos sobre Safari se
   sustituyen por explicaciones de la app (cómo se actualiza, la caducidad de 7 días, dónde están los datos). Van en
   un paquete de texto diferido para no subir el JS inicial.
4. **Face ID.** LocalAuthentication detrás del ajuste `biometricLock` que ya existe.
5. **Tacto del sistema.** Vibración háptica al guardar, deshacer y en errores (respeta «reducir movimiento»), barra
   de estado según el tema y teclado que no tapa los campos.
6. **Copias.** «Exportar copia» abre la hoja Compartir nativa; «Restaurar una copia» con un archivo de la app
   Archivos.
7. **Guía y cierre.** `docs/IOS-NATIVE.md` para alguien que nunca usó Xcode; informe de la fase.

### Ajustes al plan del encargo tras leer el repositorio

- **Tamaño del JS inicial.** Quedan 3,4 KB hasta el límite (841,2 de 844,6 KB). Todo lo nativo (plugins de
  Capacitor, repositorio nativo, textos) se carga con `import()` solo dentro de la app, y los textos nuevos van en
  paquetes diferidos (`src/i18n/packs/`). El límite no se sube.
- **JSON o SQLite.** Se empieza con un archivo JSON completo por guardado, que es como ya guardan los dos
  repositorios actuales. La parte medible aquí (serializar 10 000 y 50 000 movimientos) se mide en la Fase 1; el
  coste del puente y del disco solo se puede medir en el iPhone y queda como dato pendiente. SQLite solo si esa
  medida lo pide.
- **Copias locales automáticas y copia previa a la migración.** Hoy viven en IndexedDB y `localStorage` del WebView,
  que iOS puede borrar. En la Fase 1 siguen ahí y se dice; pasarlas a nativo es un bloque de la Fase 2 (comparten el
  plugin de almacenamiento).
- **Trabajo en paralelo.** La lógica de dominio de las Fases 2 y 3 (cola de capturas, importes como «¥1,200»,
  conversión con enteros, modo viaje) se puede escribir y probar aquí entera sin iPhone. Se adelanta mientras Victor
  prueba la fase anterior en el teléfono, para llegar al 15 de diciembre.
- **Tipos de cambio en la PWA.** La CSP de la web solo permite conectar con la propia app. La consulta al Banco de
  Canadá se hará desde el lado nativo en la app; en la PWA queda la tasa manual salvo que Victor quiera añadir ese
  origen a la CSP (se pregunta en la Fase 3).
- **Alertas de otras apps (iOS 27).** No se asume ninguna API. Se investiga en la documentación de Apple al empezar
  la Fase 4 y se informa de lo que haya.

## 3. Riesgos

| Riesgo | Qué se hace |
|---|---|
| Nada nativo se compila aquí: el primer intento en Xcode puede fallar | Código Swift mínimo y comprobado contra las fuentes de Capacitor 8 instaladas; Victor pega los errores y se corrigen. Opción: un trabajo de CI en macOS que compile `ios/` (gasta minutos de macOS de GitHub; **se pregunta antes**). |
| Pantalla en blanco: la CSP estricta con el origen `capacitor://localhost` no se pudo probar | La guía explica cómo leer el error con el Inspector web de Safari. Si falla, se ajusta la CSP solo para la compilación nativa. |
| Versión de Xcode: Capacitor 8 se prueba con el SDK de iOS 26 | Si el Xcode de Victor es anterior y no compila, se baja a Capacitor 7 (misma arquitectura). |
| Cuenta gratuita: la app caduca a los 7 días; 10 identificadores cada 7 días | La guía cubre reinstalar. Una sola extensión para widgets y controles. No cambiar el identificador una vez instalado. |
| iOS puede borrar el almacenamiento del WebView | `NativeRepository` (bloque 2). Hasta entonces, solo datos de demostración en la app. |
| Guardar el JSON completo por el puente puede ir lento con muchos movimientos | Medir en el iPhone; SQLite si hace falta. |
| El plazo del 15 de diciembre depende de los turnos de prueba en el iPhone | Dominio de las Fases 2 y 3 adelantado en paralelo; cada entrega lleva pasos de prueba cortos. |
| Subir el esquema (15) impide volver a una versión web anterior | Como en cada subida: `docs/ROLLBACK.md`; la migración solo rellena y lleva prueba. |
| «¥» puede ser yen o yuan; la tasa del Banco de Canadá es indicativa | Nunca se adivina: modo viaje o «Por revisar». La tasa lleva su fecha y su origen, y se puede ajustar al cargo real. |
| El PR #16 sigue sin fusionar y esta rama parte de él | Fusionarlo antes deja limpio el PR de la Fase 1. Si no, se fusionan juntos. |

## 4. Lo que necesito de Victor

1. **Confirmar el identificador de la app y el App Group** antes de la primera compilación: `com.victorli.clara` y
   `group.com.victorli.clara`. Si ya instalaste la app del primer paso (identificador `io.github.vict0rl1.clara`),
   dilo: cambiarlo deja atrás lo que hubiera en esa instalación.
2. **Versiones:** modelo del iPhone y versión de iOS (Ajustes › General › Información) y versión de Xcode (Xcode ›
   About Xcode).
3. **PR #16:** decir si lo fusiono yo o lo fusionas tú.
4. **Primera compilación** con `docs/IOS-NATIVE.md` y devolver la lista de comprobación (o los errores de Xcode).
5. **¿Trabajo de CI en macOS para compilar `ios/`?** Evita turnos de ida y vuelta por errores de compilación, pero
   gasta minutos de macOS de GitHub Actions (cuestan más que los de Linux si el repositorio es privado).
6. Más adelante (Fase 4): ejemplos reales de SMS o alertas del banco, con los números tapados.

## 5. Notas del historial de la rama

- El commit `1e80e3c` (documentación del Paso 0) se llevó por error los renombrados de `src/platform/` y de la guía,
  que estaban preparados para el commit siguiente: **por sí solo no pasa `tsc`** (el siguiente lo arregla). Corregirlo
  exigiría reescribir un historial ya publicado, y eso no se hace sin que Victor lo pida. Con «Squash and merge» en el
  PR de la fase no llega a `main`; `git bisect` debe saltarlo.

## 6. Estado de lo nativo

| Pieza | Estado |
|---|---|
| Proyecto `ios/`, icono, pantalla de arranque, permisos | Escrito, sin compilar |
| Detección de la app (`src/platform/`) | Probado en pruebas unitarias; sin probar en iPhone |
