/**
 * Solo dentro de la app de iPhone (`main.tsx` lo carga con `import()`): el plugin local `ClaraLaunch` (Fase 4,
 * decisión 185), que dice qué pantalla se pidió abrir desde Atajos, Siri o el control. Es de los pocos archivos que
 * importan Capacitor (decisión 152).
 */
import { registerPlugin } from '@capacitor/core'
import { CLARA_LAUNCH_PLUGIN, type ClaraLaunchPlugin } from '../nativeLaunch'

export const launchPlugin = registerPlugin<ClaraLaunchPlugin>(CLARA_LAUNCH_PLUGIN)
