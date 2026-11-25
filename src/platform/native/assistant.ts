/**
 * Solo dentro de la app de iPhone (`main.tsx` lo carga con `import()`): los plugins locales del asistente (Fase 5,
 * decisiones 187–189). Es de los pocos archivos que importan Capacitor (decisión 152).
 */
import { registerPlugin } from '@capacitor/core'
import { CLARA_AI_PLUGIN, CLARA_SPEECH_PLUGIN, CLARA_VISION_PLUGIN, type ClaraAIPlugin, type ClaraSpeechPlugin, type ClaraVisionPlugin } from '../nativeAssistant'

export const speechPlugin = registerPlugin<ClaraSpeechPlugin>(CLARA_SPEECH_PLUGIN)
export const visionPlugin = registerPlugin<ClaraVisionPlugin>(CLARA_VISION_PLUGIN)
export const aiPlugin = registerPlugin<ClaraAIPlugin>(CLARA_AI_PLUGIN)
