/**
 * Lectura de texto en fotos (§8 · Recibos) SIN enviar la imagen a ningún sitio. En la app de iPhone, Vision lee el texto
 * en el teléfono (`nativeServices().receipts`, Fase 5, decisión 188). En el navegador se usa la API de detección de
 * texto (`TextDetector`, Shape Detection) cuando existe. Si no hay ninguna, no se simula: la foto se puede adjuntar
 * igual y el total se escribe a mano. Ver decisión 45 sobre por qué no se incluye Tesseract.js.
 */
import type { Language } from '../domain/types'
import { nativeServices } from '../platform'
export interface OcrResult {
  text: string
  lines: string[]
}

interface DetectedText {
  rawValue: string
  boundingBox?: { x: number; y: number; width: number; height: number }
}

type TextDetectorCtor = new () => { detect: (image: ImageBitmapSource) => Promise<DetectedText[]> }

export function ocrAvailable(): boolean {
  return !!nativeServices().receipts || typeof (globalThis as { TextDetector?: unknown }).TextDetector === 'function'
}

/** Reconoce el texto de una imagen en el dispositivo; `null` si no hay con qué (ni Vision ni el detector del navegador). */
export async function recognizeText(image: Blob, language: Language = 'es'): Promise<OcrResult | null> {
  const receipts = nativeServices().receipts
  if (receipts) {
    const base64 = await imageForOcr(image)
    return base64 ? receipts.read(base64, language) : null
  }
  const Ctor = (globalThis as { TextDetector?: TextDetectorCtor }).TextDetector
  if (!Ctor) return null
  const bitmap = await createImageBitmap(image)
  try {
    const detected = await new Ctor().detect(bitmap)
    const lines = [...detected]
      .sort((a, b) => (a.boundingBox?.y ?? 0) - (b.boundingBox?.y ?? 0) || (a.boundingBox?.x ?? 0) - (b.boundingBox?.x ?? 0))
      .map((d) => d.rawValue.trim())
      .filter(Boolean)
    return { text: lines.join('\n'), lines }
  } finally {
    bitmap.close()
  }
}

/** Lado mayor de la imagen que se manda a Vision: suficiente para la letra pequeña de un recibo. */
const OCR_MAX_SIDE = 2048

/** La foto en JPEG (base64 sin `data:`) de ≤ `OCR_MAX_SIDE` px, para leerla en el iPhone; `null` si no se pudo. */
async function imageForOcr(image: Blob): Promise<string | null> {
  if (typeof document === 'undefined') return null
  const bitmap = await createImageBitmap(image)
  try {
    const scale = Math.min(1, OCR_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return null
    ctx2d.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const url = canvas.toDataURL('image/jpeg', 0.9)
    const comma = url.indexOf(',')
    return url.startsWith('data:image/jpeg;base64,') && comma > 0 ? url.slice(comma + 1) : null
  } finally {
    bitmap.close()
  }
}

/** Un archivo en base64 (sin `data:`) como `Blob`, para reducirlo con `compressReceipt`. */
export function base64Blob(base64: string, type: string): Blob {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return new Blob([bytes], { type })
}

export const RECEIPT_MAX_BYTES = 200_000
const RECEIPT_MAX_SIDE = 1024

/**
 * Reduce la foto a un JPEG de ≤ 1024 px y ≈ ≤ 200 KB (data URL) para guardarla con el movimiento.
 * Las copias de seguridad crecen con cada recibo: la interfaz lo avisa.
 */
export async function compressReceipt(image: Blob): Promise<string | null> {
  if (typeof document === 'undefined') return null
  const bitmap = await createImageBitmap(image)
  try {
    const scale = Math.min(1, RECEIPT_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return null
    ctx2d.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.7, 0.5, 0.35, 0.2]) {
      const url = canvas.toDataURL('image/jpeg', quality)
      if (url.length <= RECEIPT_MAX_BYTES) return url
    }
    return null
  } finally {
    bitmap.close()
  }
}
