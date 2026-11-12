# Clara como app nativa de iPhone: guía para compilarla e instalarla

Clara sigue siendo la misma aplicación web (React + TypeScript + Vite). La carpeta `ios/` es una **cáscara nativa**
hecha con [Capacitor](https://capacitorjs.com) 8: un proyecto de Xcode que abre las mismas pantallas dentro de una app.
Existe para lo que una web no puede hacer en el iPhone: guardar sola los pagos con Apple Pay, widgets, Siri y avisos
con la app cerrada. El plan completo está en `docs/NATIVE-PLAN.md`; **esta guía cubre la Fase 1: que Clara abra y
funcione como app**. Se completa al cerrar la fase.

> **Estado: sin compilar todavía en un Mac.** El proyecto se generó y se revisó en un entorno sin Xcode, así que nadie
> lo ha compilado ni abierto en un iPhone. Lo que sigue son los pasos para hacerlo y lo que hay que mirar. Nada aquí
> afirma que «funciona en el iPhone» hasta que esa prueba esté hecha.

## Qué cambia y qué no

- **No hay servidor ni cuenta.** Los datos siguen solo en el teléfono.
- **La app empieza vacía.** Sus datos están separados de los de Safari y de la Clara de la pantalla de inicio. Para
  este paso usa los **datos de demostración**; tus datos reales se pasan más adelante con una copia de seguridad
  (exportar en la Clara de siempre, importar en la app).
- **La versión web sigue igual** en su dirección de siempre. La app no la reemplaza.
- Dentro de la app no hay *service worker* (no hace falta: los archivos van dentro de la app) ni avisos de
  «instalar Clara».

## Requisitos

- Un Mac con **Xcode 26 o posterior** (lo que pide Capacitor 8). Si tu Xcode es anterior y no compila, dilo: se puede
  bajar a Capacitor 7.
- Node 22 o posterior (`node -v`).
- Un Apple ID. Con una cuenta **gratuita** la app deja de abrir a los **7 días** de instalarla; se arregla
  volviendo a pulsar ▶ en Xcode (los datos se conservan si no borras la app). Para uso diario conviene el programa de
  desarrolladores de pago.

## La primera vez (unos 15 minutos)

1. En el Mac, dentro de la carpeta del repositorio:

   ```bash
   git fetch origin
   git checkout feat/ios-nativo
   npm ci
   npm run ios:sync
   npm run ios:open
   ```

   `npm run ios:sync` compila la web y la copia dentro del proyecto de iOS; `npm run ios:open` abre Xcode. La primera
   vez Xcode descarga el paquete de Capacitor (necesita internet).

2. En Xcode, añade tu Apple ID si no está: **Xcode › Settings › Accounts › +**.
3. En la barra lateral, pulsa el proyecto **App** › destino **App** › pestaña **Signing & Capabilities**:
   - marca **Automatically manage signing**;
   - en **Team**, elige tu nombre (**Personal Team**).
   - El identificador es `com.victorli.clara` (**confírmalo antes de esta primera compilación**: los datos de la app
     cuelgan de él y con una cuenta gratuita cada identificador nuevo gasta uno de los 10 de cada 7 días). Si Xcode
     dice que no está disponible, no pruebes otros: avisa y lo decidimos.
4. Conecta el iPhone con el cable y acepta **Confiar en este ordenador**.
5. En el iPhone, activa el modo de desarrollador: **Ajustes › Privacidad y seguridad › Modo de desarrollador**
   (aparece después de conectar el teléfono a Xcode; pide reiniciar).
6. En Xcode, elige tu iPhone arriba (junto a «App») y pulsa **▶**.
7. La primera vez el iPhone dice que el desarrollador no es de confianza: **Ajustes › General › VPN y gestión de
   dispositivos ›** tu Apple ID **› Confiar**. Vuelve a abrir Clara.

No hace falta subir al repositorio los cambios que Xcode haga al elegir el equipo (`DEVELOPMENT_TEAM` en
`project.pbxproj`); si `git status` los muestra, déjalos sin confirmar.

## Cada vez que haya cambios

```bash
git pull
npm ci          # solo si cambió package-lock.json
npm run ios:sync
```

y ▶ en Xcode. (`npm run ios:sync` = compilar la web + `cap sync ios`; `npm run ios:open` abre Xcode.)

## Qué mirar en este paso

Con los datos de demostración (pantalla de bienvenida › «Explorar con datos de demostración»). Apunta lo que falle y en qué pantalla.

| # | Qué | Cómo | ¿Bien? |
|---|---|---|---|
| 1 | La app abre | Icono de Clara en la pantalla de inicio; pantalla de arranque con el logo; aparece la bienvenida | |
| 2 | Bordes de la pantalla | Nada queda tapado por la isla/muesca ni por la barra inferior del iPhone; la barra de pestañas se ve entera | |
| 3 | Navegar | Inicio, Movimientos, «+», Plan, Análisis, Ajustes; Estadísticas; atrás deslizando desde el borde | |
| 4 | Registrar | «+» › Gasto › importe › Guardar; aparece en Movimientos y cambia la cifra de Inicio | |
| 5 | Se conserva | Cierra la app del todo (deslízala fuera) y ábrela: el gasto sigue | |
| 6 | Sin conexión | Modo avión, cierra y abre: la app abre igual | |
| 7 | Teclado | Al escribir un importe, el campo no queda tapado por el teclado | |
| 8 | Exportar copia | Ajustes › Copia de seguridad › «Exportar copia»: sale la hoja de compartir y se puede guardar en Archivos | |
| 9 | Importar copia | Ajustes › Copia de seguridad › «Importar copia»: se abre el selector de archivos y la copia entra | |
| 10 | Cámara | «+» › Asistente › foto de un recibo: pide permiso de cámara y no se cierra la app | |
| 11 | Tema | Cambia el iPhone a modo oscuro/claro: la app y la pantalla de arranque lo siguen | |
| 12 | Textos de Legal | Ajustes › Legal › Privacidad: el texto aparece (se pide como archivo aparte) | |
| 13 | No ofrece instalarse | Ajustes › Instalar Clara dice que ya está instalada; en Inicio no sale la tarjeta de instalar | |

### Si la pantalla se queda en blanco

Es el fallo más probable de este paso (la política de seguridad de contenido de Clara es estricta y aquí la página se
sirve desde `capacitor://localhost`, cosa que no se ha podido probar sin un iPhone). Para ver el motivo:

1. En el iPhone: **Ajustes › Apps › Safari › Avanzado › Inspector web** activado.
2. En el Mac, con la app abierta en el iPhone: **Safari › Desarrollo ›** tu iPhone **› localhost**. (Si no ves el
   menú Desarrollo: Safari › Ajustes › Avanzado › «Mostrar funciones para desarrolladores web».)
3. Copia lo que salga en rojo en la pestaña **Consola**.

## Lo que se sabe que aún no está adaptado

- Algunos textos dicen «este navegador» donde en la app sería «este iPhone».
- Los avisos (pagos por vencer, planes) usan las notificaciones del navegador, que dentro de una app no existen: en
  la app no llegan todavía. Se sustituyen por notificaciones nativas en el paso de la acción «Registrar gasto».
- Los textos con los que iOS pide permiso de cámara y micrófono están solo en español.
- Ajustes › Atajos › «Atajos de iPhone» sigue mostrando los enlaces de la versión web; se reemplaza por la guía nueva.
- El bloqueo con Face ID de la versión web (WebAuthn) puede no estar disponible dentro de la app; el PIN sí debería.

## Cómo está hecho

- `capacitor.config.ts`: identificador de la app, nombre y carpeta web (`dist`).
- `ios/App/App.xcodeproj`: proyecto de Xcode generado con `npx cap add ios` (Swift Package Manager, sin CocoaPods).
  `ios/App/App/public/` y `ios/App/App/capacitor.config.json` los escribe `cap sync` y no se versionan.
- `ios/App/App/Assets.xcassets`: icono (1024 px, sin transparencia) y pantalla de arranque en claro y oscuro, hechos
  a partir de `public/icon.svg`.
- `ios/App/App/Info.plist`: idiomas (es, en, pt, fr) y los textos de permiso de cámara y micrófono. Sin ellos iOS
  cierra la app al abrir la cámara.
- `src/platform/` (`isNativeIOS`): la única capa de la web que sabe si corre dentro de la app (lo ve por el puente
  nativo, `window.Capacitor`). Ningún import de Capacitor fuera de ella; lo nativo se carga con `import()` solo dentro
  de la app, así el JS inicial de la web no crece. Decide cómo se hace algo y qué se explica; nunca cambia cifras.
- El target de la app exige **iOS 18.0**. El paquete que genera Capacitor (`ios/App/CapApp-SPM/Package.swift`) declara
  iOS 17 porque su manifiesto usa Swift tools 5.9, que no conoce `.v18`; es el mínimo del paquete, no el de la app.
