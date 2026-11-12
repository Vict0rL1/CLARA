/**
 * Archivos que salen de la app de iPhone (Fase 1, bloque 6; decisión 167). Dentro de la app no hay descargas: el
 * WebView ignora `<a download>` (Capacitor no las atiende). Cada archivo que en la web se descarga —copia, CSV, copia
 * cifrada, datos dañados…— se escribe en la caché de la app y se abre la hoja Compartir de iOS, desde donde se guarda
 * en Archivos, iCloud Drive o se envía. `main.tsx` pide este archivo y `native/files.ts` (los plugins oficiales
 * `@capacitor/filesystem` y `@capacitor/share`) con `import()` solo dentro de la app y deja `shareTextFile` en
 * `provideNativeServices`. Aquí no hay ningún `import()` (decisión 166: así no se arrastra nada al JS inicial).
 */

export type ShareOutcome = 'shared' | 'cancelled'

/** El lado nativo, separado para poder probarlo con un doble. */
export interface FileSharer {
  /** Escribe el texto en la caché de la app y devuelve su dirección `file://`. */
  write(filename: string, text: string): Promise<string>
  /** Abre la hoja Compartir con ese archivo. Rechaza si la persona la cierra sin elegir nada. */
  share(uri: string, title: string): Promise<unknown>
}

/** El plugin de Compartir rechaza con «Share canceled» al cerrar la hoja sin elegir (fuente de `@capacitor/share` 8). */
export function isShareCancel(error: unknown): boolean {
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && /cancel/i.test(message)
}

/** Un nombre de archivo sin carpetas ni caracteres raros: el archivo siempre queda dentro de la carpeta de exportación. */
export function safeFileName(filename: string): string {
  const clean = filename.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '')
  return clean.length > 0 ? clean.slice(0, 120) : 'clara.txt'
}

/**
 * Comparte un archivo de texto. `shared`: la persona eligió un destino (iOS no dice si se guardó de verdad);
 * `cancelled`: cerró la hoja. Cualquier otro fallo se lanza (quien llama dice que no se exportó).
 */
export async function shareTextFile(sharer: FileSharer, filename: string, text: string): Promise<ShareOutcome> {
  const name = safeFileName(filename)
  const uri = await sharer.write(name, text)
  try {
    await sharer.share(uri, name)
    return 'shared'
  } catch (error) {
    if (isShareCancel(error)) return 'cancelled'
    throw error
  }
}
