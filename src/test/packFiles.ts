/** Para pruebas: lee el archivo JSON de un paquete desde el disco (en Vitest, `?url` da la ruta dentro del proyecto). Sin red. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PackRequest } from '../i18n/packs'

export const fromDisk: PackRequest = (url) => Promise.resolve(JSON.parse(readFileSync(join(process.cwd(), url.replace(/[?#].*$/, '')), 'utf8')) as unknown)
