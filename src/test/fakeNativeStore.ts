/** Almacén nativo en memoria con el mismo contrato que `ClaraStorage` (revisión, conflicto, fallos a demanda). */
import { NativeStoreError, type NativeTextStore } from '../storage/nativeRepository'

export class FakeStore implements NativeTextStore {
  files = new Map<string, { text: string; revision: number }>()
  writes: string[] = []
  failNext: NativeStoreError | null = null
  /** Simula un disco que devuelve otra cosa al releer. */
  corruptReads = false

  async read(name: string) {
    const f = this.files.get(name)
    if (!f) return null
    return this.corruptReads ? { text: `${f.text} `, revision: f.revision } : { ...f }
  }
  async write(name: string, text: string, revision: number, expectedRevision: number | null) {
    if (this.failNext) {
      const e = this.failNext
      this.failNext = null
      throw e
    }
    const current = this.files.get(name)?.revision ?? null
    if (current !== expectedRevision) throw new NativeStoreError('conflict')
    this.files.set(name, { text, revision })
    this.writes.push(name)
  }
  async remove(name: string) {
    this.files.delete(name)
  }
}
