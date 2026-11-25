/** Los servicios de la app de iPhone para una pantalla, que se vuelve a dibujar cuando llegan (en el navegador, ninguno). */
import { useSyncExternalStore } from 'react'
import { nativeServices, subscribeNativeServices, type NativeServices } from '../platform'

export function useNativeServices(): Readonly<NativeServices> {
  return useSyncExternalStore(subscribeNativeServices, nativeServices, nativeServices)
}
