/**
 * Solo dentro de la app de iPhone (`main.tsx` lo carga con `import()`): la cola de capturas del plugin local
 * `ClaraCaptures` (Fase 2, decisión 169). Es de los pocos archivos que importan Capacitor (decisión 152).
 */
import { registerPlugin } from '@capacitor/core'
import { CLARA_CAPTURES_PLUGIN, captureQueueFromPlugin, type ClaraCapturesPlugin } from '../nativeCaptures'

export const captureQueue = captureQueueFromPlugin(registerPlugin<ClaraCapturesPlugin>(CLARA_CAPTURES_PLUGIN))
