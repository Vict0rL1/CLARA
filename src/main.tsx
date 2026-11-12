import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { registerServiceWorker } from './pwa/register'
import { captureInstallPrompt } from './ui/install'
import { collectUserStrings, installErrorLog } from './ui/errorLog'
import { APP_VERSION } from './ui/version'
import { enablePseudoLocale } from './i18n'
import { AppStore, getStore, setStore } from './state/store'
import { isNativeIOS, provideNativeServices } from './platform'
import { createPlatformRepository } from './platform/repository'
import './styles.css'
import { watchThemeChanges } from './ui/theme'

// Informe de errores (M3): antes que nada, para ver también los fallos al arrancar. Los textos de la
// persona (si ya hay datos cargados) se quitan de cada mensaje.
installErrorLog({
  version: APP_VERSION,
  userStrings: () => {
    const data = getStore().data
    return data ? collectUserStrings(data) : []
  },
})
registerServiceWorker()
captureInstallPrompt()
watchThemeChanges()
// En la app de iPhone, la barra de estado sigue el tema de Clara y la vibración usa el motor del iPhone. En el navegador
// no se carga nada.
if (isNativeIOS()) {
  void Promise.all([import('./platform/system'), import('./platform/native/system')])
    .then(([system, native]) => {
      system.followThemeInStatusBar(native.nativeSystem)
      provideNativeServices({ haptic: (kind) => system.nativeHaptic(native.nativeSystem, kind) })
    })
    .catch(() => {})
}
// Pseudo-locale solo en desarrollo: `?pseudo=1` marca todo texto que pasa por i18n.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('pseudo') === '1') enablePseudoLocale(true)

// En el navegador: IndexedDB si se puede; si no, localStorage (docs/STORAGE.md). En la app de iPhone: un archivo propio.
void createPlatformRepository().then((repo) => {
  const store = new AppStore(repo)
  setStore(store)
  void store.init()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
