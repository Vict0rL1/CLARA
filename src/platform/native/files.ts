/**
 * Solo dentro de la app de iPhone (`main.tsx` lo carga con `import()`): escribe el archivo en la caché de la app y abre
 * la hoja Compartir con los plugins oficiales `@capacitor/filesystem` y `@capacitor/share` (decisión 167). Es de los
 * pocos archivos que importan Capacitor (decisión 152).
 *
 * Como en `system.ts`, los plugins se registran por su nombre y de sus paquetes solo se usan los TIPOS (su versión web
 * se carga con `import()` y no se usa nunca dentro de la app). `'CACHE'` y `'utf8'` son los valores de `Directory.Cache`
 * y `Encoding.UTF8` del paquete (8.x; el Swift los lee con esos nombres).
 */
import { registerPlugin } from '@capacitor/core'
import type { Directory, Encoding, FilesystemPlugin } from '@capacitor/filesystem'
import type { SharePlugin } from '@capacitor/share'
import type { FileSharer } from '../files'

const Filesystem = registerPlugin<FilesystemPlugin>('Filesystem')
const Share = registerPlugin<SharePlugin>('Share')

/** Carpeta de la caché de la app para lo que se comparte. Se vacía antes de cada archivo: como mucho queda uno. */
const EXPORTS = 'exports'
const CACHE = 'CACHE' as Directory

export const fileSharer: FileSharer = {
  write: async (filename, text) => {
    await Filesystem.rmdir({ path: EXPORTS, directory: CACHE, recursive: true }).catch(() => {})
    const { uri } = await Filesystem.writeFile({ path: `${EXPORTS}/${filename}`, data: text, directory: CACHE, encoding: 'utf8' as Encoding, recursive: true })
    return uri
  },
  share: (uri, title) => Share.share({ files: [uri], title }),
}
