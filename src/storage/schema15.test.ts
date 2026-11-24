import { describe, expect, it } from 'vitest'
import type { AppData, CaptureProposal } from '../domain/types'
import { SCHEMA_VERSION } from '../domain/types'
import { CAPTURE_PROCESSED_MAX, CAPTURE_PROPOSALS_MAX } from '../domain/validation'
import { baseData, EARLIER, NOW, tx } from '../test/fixtures'
import { backupText, parseBackup, validateAppData } from './backup'
import { MIGRATIONS, migrate } from './migrations'

/** Una propuesta mínima válida (captura que no se registró sola). */
function proposal(overrides: Partial<CaptureProposal> = {}): CaptureProposal {
  return {
    captureId: 'cap-00000001',
    capturedAt: EARLIER,
    origin: 'apple_pay',
    reason: 'currency',
    amount: { kind: 'foreign', currency: 'JPY', minor: 1200 },
    merchant: 'Ichiran',
    card: 'Visa ••1234',
    accountId: 'main',
    date: '2026-09-28',
    receivedAt: NOW,
    ...overrides,
  }
}

/** Datos v15 con todo lo nuevo: movimiento capturado por revisar, ajustes de captura y cola procesada. */
function v15(): AppData {
  return baseData({
    settings: { ...baseData().settings, capture: { autoSave: true, cardAccounts: [{ card: 'Visa ••1234', accountId: 'main' }], defaultAccountId: 'main' } },
    transactions: [tx({ id: 'cap-tx', source: 'apple_pay', captureId: 'cap-00000002', review: { needed: true, reason: 'auto_capture' }, merchant: 'Tim Hortons', amountMinor: 425 })],
    captures: {
      processed: [
        { id: 'cap-00000001', at: NOW },
        { id: 'cap-00000002', at: NOW },
      ],
      proposals: [
        proposal(),
        proposal({ captureId: 'cap-00000003', amount: { kind: 'ambiguous', candidates: ['JPY', 'CNY'], text: '¥1,200' } }),
        proposal({ captureId: 'cap-00000004', reason: 'unparsed', amount: { kind: 'unreadable', text: 'doce' } }),
        proposal({ captureId: 'cap-00000005', reason: 'duplicate', amount: { kind: 'budget', minor: 425 }, similarTxId: 'cap-tx' }),
      ],
    },
  })
}

describe('esquema 15: capturas automáticas (decisión 168)', () => {
  it('la migración 14 → 15 no toca nada: todo lo nuevo es opcional', () => {
    const v14 = JSON.parse(JSON.stringify({ ...baseData(), schemaVersion: 14 })) as Record<string, unknown>
    const out = MIGRATIONS[14]!(v14)
    expect(out.schemaVersion).toBe(15)
    expect({ ...out, schemaVersion: 14 }).toEqual(v14)
    expect(migrate({ ...v14 }).schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('unos datos v14 se cargan sin capturas ni ajustes de captura (ausente = nada capturado, guardar automáticamente)', () => {
    const r = validateAppData({ ...JSON.parse(JSON.stringify(baseData())), schemaVersion: 14 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.schemaVersion).toBe(15)
    expect(r.data.captures).toBeUndefined()
    expect(r.data.settings.capture).toBeUndefined()
  })

  it('una copia con todo lo nuevo se exporta y se restaura igual, campo por campo', () => {
    const data = v15()
    const r = parseBackup(backupText(data, new Date(NOW), 'test'))
    expect(r.ok, JSON.stringify(!r.ok && r.issues)).toBe(true)
    if (!r.ok) return
    expect(r.data.transactions[0]).toMatchObject({ source: 'apple_pay', captureId: 'cap-00000002', review: { needed: true, reason: 'auto_capture' } })
    expect(r.data.settings.capture).toEqual(data.settings.capture)
    expect(r.data.captures).toEqual(data.captures)
  })

  it('las claves desconocidas dentro de lo nuevo se quitan al cargar (como en el resto de los datos)', () => {
    const raw = JSON.parse(JSON.stringify(v15())) as Record<string, any>
    raw.transactions[0].review.extra = 'x'
    raw.captures.proposals[0].extra = 'x'
    raw.captures.proposals[0].amount.extra = 'x'
    raw.settings.capture.extra = 'x'
    raw.settings.capture.cardAccounts[0].extra = 'x'
    const r = validateAppData(raw)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.transactions[0]!.review).toEqual({ needed: true, reason: 'auto_capture' })
    expect(r.data.captures!.proposals[0]).toEqual(proposal())
    expect(r.data.settings.capture).toEqual(v15().settings.capture)
  })

  it('rechaza lo mal formado y dice dónde; nunca lo arregla en silencio', () => {
    const cases: [string, (raw: Record<string, any>) => void][] = [
      ['transactions[0].source', (r) => (r.transactions[0].source = 'email')],
      ['transactions[0].captureId', (r) => (r.transactions[0].captureId = 'con espacios')],
      ['transactions[0].review', (r) => (r.transactions[0].review = { reason: 'auto_capture' })],
      ['transactions[0].review', (r) => (r.transactions[0].review = { needed: true, reason: 'otra' })],
      ['transactions[0].review.rawText', (r) => (r.transactions[0].review.rawText = 'x'.repeat(2001))],
      ['settings.capture', (r) => (r.settings.capture.autoSave = 'sí')],
      ['settings.capture.cardAccounts[1].card', (r) => r.settings.capture.cardAccounts.push({ card: 'VISA ••1234', accountId: 'main' })],
      ['settings.capture.cardAccounts[0].accountId', (r) => (r.settings.capture.cardAccounts[0].accountId = '')],
      ['captures.proposals[1].captureId', (r) => (r.captures.proposals[1].captureId = 'cap-00000001')],
      ['captures.proposals[0].amount', (r) => (r.captures.proposals[0].amount = { kind: 'foreign', currency: 'jpy', minor: 1200 })],
      ['captures.proposals[0].amount', (r) => (r.captures.proposals[0].amount = { kind: 'budget', minor: 12.5 })],
      ['captures.proposals[0].amount', (r) => (r.captures.proposals[0].amount = { kind: 'ambiguous', candidates: ['JPY'], text: '¥1' })],
      ['captures.proposals[0].origin', (r) => (r.captures.proposals[0].origin = 'email')],
      ['captures.proposals[0].reason', (r) => (r.captures.proposals[0].reason = 'otra')],
      ['captures.proposals[0].date', (r) => (r.captures.proposals[0].date = '28/09/2026')],
      ['captures.processed[0].at', (r) => (r.captures.processed[0].at = 'ayer')],
      ['captures', (r) => (r.captures = { processed: [] })],
    ]
    for (const [path, mutate] of cases) {
      const raw = JSON.parse(JSON.stringify(v15())) as Record<string, any>
      mutate(raw)
      const r = validateAppData(raw)
      expect(r.ok, path).toBe(false)
      if (!r.ok) expect(r.issues.map((i) => i.path), path).toContain(path)
    }
  })

  it('las listas de capturas tienen tope: ids procesados y propuestas', () => {
    const many = JSON.parse(JSON.stringify(v15())) as Record<string, any>
    many.captures.processed = Array.from({ length: CAPTURE_PROCESSED_MAX + 1 }, (_, i) => ({ id: `cap-${String(i).padStart(8, '0')}`, at: NOW }))
    expect(validateAppData(many).ok).toBe(false)
    const proposals = JSON.parse(JSON.stringify(v15())) as Record<string, any>
    proposals.captures.proposals = Array.from({ length: CAPTURE_PROPOSALS_MAX + 1 }, (_, i) => proposal({ captureId: `cap-${String(i).padStart(8, '0')}` }))
    expect(validateAppData(proposals).ok).toBe(false)
  })

  it('la marca de prueba de una propuesta se conserva al exportar y solo puede ser true', () => {
    const withTest = { ...v15(), captures: { processed: [], proposals: [proposal({ test: true })] } }
    const back = parseBackup(backupText(withTest, new Date(NOW), 'test'))
    expect(back.ok && back.data.captures!.proposals[0]!.test).toBe(true)
    const bad = JSON.parse(JSON.stringify(withTest)) as Record<string, any>
    bad.captures.proposals[0].test = false
    const r = validateAppData(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.map((i) => i.path)).toContain('captures.proposals[0].test')
  })

  it('una versión anterior (esquema 14) no abre datos v15: los ve como de una versión más nueva y no los toca', () => {
    // `validateAppData` de la versión actual acepta 15; una copia con 16 es «más nueva».
    const r = validateAppData({ ...JSON.parse(JSON.stringify(v15())), schemaVersion: SCHEMA_VERSION + 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0]!.code).toBe('schemaTooNew')
  })
})
