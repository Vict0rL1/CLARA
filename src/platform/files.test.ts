import { describe, expect, it } from 'vitest'
import { isShareCancel, safeFileName, shareTextFile, type FileSharer } from './files'

function fakeSharer(share: () => Promise<unknown>) {
  const written: { filename: string; text: string }[] = []
  const shared: { uri: string; title: string }[] = []
  const sharer: FileSharer = {
    write: async (filename, text) => {
      written.push({ filename, text })
      return `file:///cache/exports/${filename}`
    },
    share: async (uri, title) => {
      shared.push({ uri, title })
      return share()
    },
  }
  return { sharer, written, shared }
}

describe('archivos que salen de la app de iPhone (decisión 167)', () => {
  it('escribe el archivo tal cual y abre Compartir con él', async () => {
    const { sharer, written, shared } = fakeSharer(async () => ({ activityType: 'com.apple.DocumentManagerUICore.SaveToFiles' }))
    expect(await shareTextFile(sharer, 'clara-copia-2026-11-12.json', '{"a":1}')).toBe('shared')
    expect(written).toEqual([{ filename: 'clara-copia-2026-11-12.json', text: '{"a":1}' }])
    expect(shared).toEqual([{ uri: 'file:///cache/exports/clara-copia-2026-11-12.json', title: 'clara-copia-2026-11-12.json' }])
  })

  it('cerrar la hoja sin elegir es «cancelado», no un error', async () => {
    const { sharer } = fakeSharer(async () => {
      throw new Error('Share canceled')
    })
    expect(await shareTextFile(sharer, 'a.json', 'x')).toBe('cancelled')
  })

  it('cualquier otro fallo se lanza: quien llama dice que no se exportó', async () => {
    const { sharer } = fakeSharer(async () => {
      throw new Error('Error sharing item')
    })
    await expect(shareTextFile(sharer, 'a.json', 'x')).rejects.toThrow('Error sharing item')
    const failingWrite: FileSharer = { write: async () => Promise.reject(new Error('no space')), share: async () => ({}) }
    await expect(shareTextFile(failingWrite, 'a.json', 'x')).rejects.toThrow('no space')
  })

  it('reconoce la cancelación solo por su mensaje', () => {
    expect(isShareCancel(new Error('Share canceled'))).toBe(true)
    expect(isShareCancel({ message: 'Share cancelled' })).toBe(true)
    expect(isShareCancel(new Error("Can't share while sharing is in progress"))).toBe(false)
    expect(isShareCancel(null)).toBe(false)
    expect(isShareCancel('Share canceled')).toBe(false)
  })

  it('el nombre nunca sale de la carpeta de exportación ni lleva caracteres raros', () => {
    expect(safeFileName('clara-copia-2026-11-12.json')).toBe('clara-copia-2026-11-12.json')
    expect(safeFileName('../../Documents/clara.json')).toBe('Documents-clara.json')
    expect(safeFileName('clara movimientos/2026.csv')).toBe('clara-movimientos-2026.csv')
    expect(safeFileName('...')).toBe('clara.txt')
    expect(safeFileName('a'.repeat(300)).length).toBe(120)
  })
})
