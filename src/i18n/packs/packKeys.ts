/**
 * Comprobación de tipos de los paquetes de texto diferidos (`packs/*.json`, uno por paquete e idioma; ver
 * `src/i18n/packs.ts`): las cuatro versiones de cada paquete tienen EXACTAMENTE las mismas claves, y `tsc -b` falla si
 * en alguna falta o sobra una. Es solo una comprobación de tipos: ninguna pantalla importa este archivo (los paquetes se
 * piden con `fetch` al abrir la pantalla y nunca van en el JS inicial; auditoría del 2026-11-04, F3).
 */
import bankImportEn from './bankImport.en.json'
import bankImportEs from './bankImport.es.json'
import bankImportFr from './bankImport.fr.json'
import bankImportPt from './bankImport.pt.json'
import galleryEn from './gallery.en.json'
import galleryEs from './gallery.es.json'
import galleryFr from './gallery.fr.json'
import galleryPt from './gallery.pt.json'
import legalEn from './legal.en.json'
import legalEs from './legal.es.json'
import legalFr from './legal.fr.json'
import legalPt from './legal.pt.json'

export type LegalPackKey = keyof typeof legalEs
export type GalleryPackKey = keyof typeof galleryEs
export type BankImportPackKey = keyof typeof bankImportEs

/** `true` solo si A y B tienen las mismas claves (ninguna falta en ninguno de los dos). */
type SameKeys<A, B> = Record<keyof A, string> extends Record<keyof B, string> ? (Record<keyof B, string> extends Record<keyof A, string> ? true : never) : never

/** Si un idioma pierde o gana una clave, esta tupla deja de compilar. */
export const PACK_KEY_CHECKS: [
  SameKeys<typeof legalEs, typeof legalEn>,
  SameKeys<typeof legalEs, typeof legalPt>,
  SameKeys<typeof legalEs, typeof legalFr>,
  SameKeys<typeof galleryEs, typeof galleryEn>,
  SameKeys<typeof galleryEs, typeof galleryPt>,
  SameKeys<typeof galleryEs, typeof galleryFr>,
  SameKeys<typeof bankImportEs, typeof bankImportEn>,
  SameKeys<typeof bankImportEs, typeof bankImportPt>,
  SameKeys<typeof bankImportEs, typeof bankImportFr>,
] = [true, true, true, true, true, true, true, true, true]
