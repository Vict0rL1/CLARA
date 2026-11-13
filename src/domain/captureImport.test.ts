import { describe, expect, it } from 'vitest'
import { account, baseData, ctx, deepFreeze, EARLIER, NOW, tx } from '../test/fixtures'
import { accountBalance } from './balances'
import {
  accountForCard,
  CAPTURE_DUPLICATE_WINDOW_MS,
  confirmReviews,
  dismissProposals,
  importCaptures,
  registerProposal,
} from './captureImport'
import { readCaptureQueue, type CaptureRecord } from './captureQueue'
import { saveTransaction, trashTransactions } from './operations'
import type { AppData, CaptureProposal } from './types'
import { CAPTURE_PROCESSED_MAX, CAPTURE_PROPOSALS_MAX } from './validation'

/*
 * Datos de las pruebas (fixtures): presupuesto en CAD, zona America/Toronto (UTC−4 en septiembre), hoy 28-sep-2026,
 * «ahora» 16:00Z. La cuenta «main» tiene un saldo de referencia de 1 000,00 escrito el 28-sep a las 13:00Z: un pago
 * posterior a esa hora resta; uno anterior ya estaba incluido en el saldo escrito.
 */

/** Una captura pagada con Apple Pay a las 15:00Z (11:00 en Toronto) en CAD. */
function record(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    captureId: 'cap-00000001',
    createdAt: '2026-09-28T15:00:00Z',
    origin: 'apple_pay',
    rawAmount: '4.25',
    currencyHint: 'CAD',
    merchant: 'Tim Hortons',
    card: 'Visa ••1234',
    ...overrides,
  }
}

function proposal(overrides: Partial<CaptureProposal> = {}): CaptureProposal {
  return {
    captureId: 'cap-prop0001',
    capturedAt: '2026-09-28T15:00:00Z',
    origin: 'apple_pay',
    reason: 'auto_capture',
    amount: { kind: 'budget', minor: 1250 },
    merchant: 'Cineplex',
    accountId: 'main',
    date: '2026-09-28',
    categoryId: 'entertainment',
    receivedAt: EARLIER,
    ...overrides,
  }
}

function imported(data: AppData, records: CaptureRecord[]) {
  const r = importCaptures(deepFreeze(data), records, ctx)
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r
}

const mainOf = (data: AppData) => data.accounts.find((a) => a.id === 'main')!

describe('importCaptures — guardar automáticamente', () => {
  it('un pago en la moneda del presupuesto entra como gasto realizado «Por revisar» y resta del saldo', () => {
    const r = imported(baseData(), [record()])
    expect(r.value).toEqual({ saved: ['cap-00000001'], proposed: [], skipped: [], deferred: [], ack: ['cap-00000001'] })
    expect(r.data.transactions).toEqual([
      {
        id: 'cap-00000001',
        kind: 'expense',
        status: 'realized',
        amountMinor: 425,
        currency: 'CAD',
        date: '2026-09-28',
        accountId: 'main',
        categoryId: 'dining',
        merchant: 'Tim Hortons',
        source: 'apple_pay',
        captureId: 'cap-00000001',
        review: { needed: true, reason: 'auto_capture' },
        realizedAt: '2026-09-28T15:00:00Z',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ])
    // 1 000,00 − 4,25 = 995,75: el pago (15:00Z) es posterior al saldo escrito (13:00Z).
    expect(accountBalance(r.data, mainOf(r.data)).balanceMinor).toBe(99575)
    expect(r.data.captures).toEqual({ processed: [{ id: 'cap-00000001', at: NOW }], proposals: [] })
    expect(r.data.updatedAt).toBe(NOW)
  })

  it('un pago anterior al saldo escrito ese mismo día ya estaba en él: se registra sin volver a restarse', () => {
    const r = imported(baseData(), [record({ createdAt: '2026-09-28T12:00:00Z' })])
    expect(r.data.transactions[0]!.realizedAt).toBe('2026-09-28T12:00:00Z')
    expect(accountBalance(r.data, mainOf(r.data)).balanceMinor).toBe(100000)
  })

  it('la fecha es la del pago en la zona horaria del presupuesto, nunca posterior a hoy', () => {
    // 02:30Z del 28 = 22:30 del 27 en Toronto.
    expect(imported(baseData(), [record({ createdAt: '2026-09-28T02:30:00Z' })]).data.transactions[0]!.date).toBe('2026-09-27')
    // 05:00Z del 29 = 01:00 del 29 en Toronto, pero hoy es 28: un reloj adelantado no deja un gasto en el futuro.
    expect(imported(baseData(), [record({ createdAt: '2026-09-29T05:00:00Z' })]).data.transactions[0]!.date).toBe('2026-09-28')
  })

  it('un aviso del banco guarda su texto hasta revisar y cuenta como «bank_text» (también el origen «notification»)', () => {
    const r = imported(baseData(), [
      record({ captureId: 'cap-sms00001', origin: 'bank_text', rawText: 'Compra por $4.25 en TIM HORTONS' }),
      record({ captureId: 'cap-ntf00001', origin: 'notification', createdAt: '2026-09-28T15:30:00Z', merchant: 'Metro' }),
    ])
    expect(r.data.transactions.map((t) => [t.id, t.source, t.review])).toEqual([
      ['cap-sms00001', 'bank_text', { needed: true, reason: 'auto_capture', rawText: 'Compra por $4.25 en TIM HORTONS' }],
      ['cap-ntf00001', 'bank_text', { needed: true, reason: 'auto_capture' }],
    ])
  })

  it('categoría: la regla de la persona, si no el diccionario, si no «Otros gastos»', () => {
    const rules = [{ id: 'rule-1', pattern: 'tim hortons', kind: 'expense' as const, categoryId: 'groceries', createdAt: EARLIER, updatedAt: EARLIER }]
    expect(imported(baseData({ categoryRules: rules }), [record()]).data.transactions[0]!.categoryId).toBe('groceries')
    expect(imported(baseData(), [record({ merchant: 'Zqxj Holdings' })]).data.transactions[0]!.categoryId).toBe('other_expense')
    const noMerchant = imported(baseData(), [record({ merchant: undefined })]).data.transactions[0]!
    expect(noMerchant.categoryId).toBe('other_expense')
    expect(noMerchant).not.toHaveProperty('merchant')
  })
})

describe('importCaptures — idempotente', () => {
  it('leer la misma cola otra vez no crea nada y confirma los ids para que el iPhone los quite', () => {
    const first = imported(baseData(), [record()])
    const again = importCaptures(first.data, [record()], ctx)
    expect(again).toMatchObject({ ok: true, unchanged: true, value: { saved: [], proposed: [], skipped: ['cap-00000001'], ack: ['cap-00000001'] } })
    expect(again.ok && again.data).toBe(first.data)
  })

  it('reconoce la captura aunque haya salido de la lista de leídas: por el movimiento o por la papelera', () => {
    const first = imported(baseData(), [record()])
    const forgotten: AppData = { ...first.data, captures: { processed: [], proposals: [] } }
    expect(importCaptures(forgotten, [record()], ctx)).toMatchObject({ ok: true, value: { skipped: ['cap-00000001'] } })
    const trashed = trashTransactions(forgotten, ['cap-00000001'], ctx)
    if (!trashed.ok) throw new Error('trash')
    expect(trashed.data.transactions).toEqual([])
    expect(importCaptures(trashed.data, [record()], ctx)).toMatchObject({ ok: true, unchanged: true, value: { skipped: ['cap-00000001'] } })
  })

  it('un id repetido en el mismo lote cuenta una vez', () => {
    const r = imported(baseData(), [record(), record({ rawAmount: '9.99' })])
    expect(r.value).toMatchObject({ saved: ['cap-00000001'], skipped: ['cap-00000001'] })
    expect(r.data.transactions.map((t) => t.amountMinor)).toEqual([425])
  })

  it('la lista de leídas guarda como mucho CAPTURE_PROCESSED_MAX ids: sale el más antiguo', () => {
    const processed = Array.from({ length: CAPTURE_PROCESSED_MAX }, (_, i) => ({ id: `old-${String(i).padStart(8, '0')}`, at: EARLIER }))
    const r = imported(baseData({ captures: { processed, proposals: [] } }), [record()])
    expect(r.data.captures!.processed).toHaveLength(CAPTURE_PROCESSED_MAX)
    expect(r.data.captures!.processed[0]!.id).toBe('old-00000001')
    expect(r.data.captures!.processed.at(-1)).toEqual({ id: 'cap-00000001', at: NOW })
  })
})

describe('importCaptures — posibles duplicados (mismo importe y comercio a 2 minutos o menos)', () => {
  const manual = tx({ id: 'manual-1', amountMinor: 425, merchant: 'Tim Hortons', realizedAt: '2026-09-28T15:00:00.000Z' })

  it('a exactamente 2 minutos es posible duplicado: propuesta que señala el movimiento parecido', () => {
    const r = imported(baseData({ transactions: [manual] }), [record({ createdAt: '2026-09-28T15:02:00Z' })])
    expect(CAPTURE_DUPLICATE_WINDOW_MS).toBe(120_000)
    expect(r.value).toMatchObject({ saved: [], proposed: ['cap-00000001'], ack: ['cap-00000001'] })
    expect(r.data.transactions).toEqual([manual])
    expect(r.data.captures!.proposals).toEqual([
      {
        captureId: 'cap-00000001',
        capturedAt: '2026-09-28T15:02:00Z',
        origin: 'apple_pay',
        reason: 'duplicate',
        amount: { kind: 'budget', minor: 425 },
        merchant: 'Tim Hortons',
        card: 'Visa ••1234',
        accountId: 'main',
        date: '2026-09-28',
        categoryId: 'dining',
        similarTxId: 'manual-1',
        receivedAt: NOW,
      },
    ])
  })

  it('un milisegundo más (y también 2 minutos ANTES más uno) ya no lo es', () => {
    expect(imported(baseData({ transactions: [manual] }), [record({ createdAt: '2026-09-28T15:02:00.001Z' })]).value.saved).toEqual(['cap-00000001'])
    expect(imported(baseData({ transactions: [manual] }), [record({ createdAt: '2026-09-28T14:57:59.999Z' })]).value.saved).toEqual(['cap-00000001'])
    expect(imported(baseData({ transactions: [manual] }), [record({ createdAt: '2026-09-28T14:58:00Z' })]).value.proposed).toEqual(['cap-00000001'])
  })

  it('otro comercio u otro importe no es duplicado; sin comercio en uno de los dos, sí', () => {
    expect(imported(baseData({ transactions: [manual] }), [record({ merchant: 'Starbucks' })]).value.saved).toHaveLength(1)
    expect(imported(baseData({ transactions: [manual] }), [record({ rawAmount: '4.26' })]).value.saved).toHaveLength(1)
    expect(imported(baseData({ transactions: [manual] }), [record({ merchant: undefined })]).value.proposed).toHaveLength(1)
    const noMerchant = tx({ ...manual, merchant: undefined })
    expect(imported(baseData({ transactions: [noMerchant] }), [record()]).value.proposed).toHaveLength(1)
  })

  it('un gasto previsto (no realizado) no es un pago hecho: no cuenta como duplicado', () => {
    const planned = tx({ ...manual, status: 'planned', realizedAt: undefined })
    expect(imported(baseData({ transactions: [planned] }), [record()]).value.saved).toHaveLength(1)
  })

  it('dos capturas del mismo pago en el mismo lote: la primera se guarda, la segunda queda como posible duplicado', () => {
    const r = imported(baseData(), [record(), record({ captureId: 'cap-00000002', createdAt: '2026-09-28T15:00:40Z' })])
    expect(r.value).toMatchObject({ saved: ['cap-00000001'], proposed: ['cap-00000002'] })
    expect(r.data.captures!.proposals[0]).toMatchObject({ reason: 'duplicate', similarTxId: 'cap-00000001' })
    // Solo un 4,25 resta: 100 000 − 425.
    expect(accountBalance(r.data, mainOf(r.data)).balanceMinor).toBe(99575)
  })

  it('también se compara con las propuestas pendientes (sin movimiento que señalar)', () => {
    const pending = proposal({ captureId: 'cap-prop0001', amount: { kind: 'budget', minor: 425 }, merchant: 'Tim Hortons', capturedAt: '2026-09-28T15:01:00Z' })
    const r = imported(baseData({ captures: { processed: [], proposals: [pending] } }), [record()])
    expect(r.data.captures!.proposals[1]).toMatchObject({ captureId: 'cap-00000001', reason: 'duplicate' })
    expect(r.data.captures!.proposals[1]).not.toHaveProperty('similarTxId')
  })
})

describe('importCaptures — propuestas', () => {
  it('con «Guardar automáticamente» apagado nada entra en las cifras: queda como propuesta', () => {
    const data = baseData({ settings: { ...baseData().settings, capture: { autoSave: false, cardAccounts: [] } } })
    const r = imported(data, [record()])
    expect(r.value.proposed).toEqual(['cap-00000001'])
    expect(r.data.transactions).toEqual([])
    expect(r.data.captures!.proposals[0]).toMatchObject({ reason: 'auto_capture', amount: { kind: 'budget', minor: 425 } })
    expect(accountBalance(r.data, mainOf(r.data)).balanceMinor).toBe(100000)
  })

  it('otra moneda, «¥» sin más y un importe sin entender nunca se registran ni se convierten', () => {
    const r = imported(baseData(), [
      record({ captureId: 'cap-usd00001', rawAmount: '12.5', currencyHint: 'USD' }),
      record({ captureId: 'cap-yen00001', rawAmount: '¥1,200', currencyHint: undefined }),
      record({ captureId: 'cap-txt00001', rawAmount: 'doce dólares', currencyHint: undefined }),
    ])
    expect(r.data.transactions).toEqual([])
    expect(r.data.captures!.proposals.map((p) => [p.captureId, p.reason, p.amount])).toEqual([
      ['cap-usd00001', 'currency', { kind: 'foreign', currency: 'USD', minor: 1250 }],
      ['cap-yen00001', 'currency', { kind: 'ambiguous', candidates: ['JPY', 'CNY'], text: '¥1,200' }],
      ['cap-txt00001', 'unparsed', { kind: 'unreadable', text: 'doce dólares' }],
    ])
  })

  it('con el tope de propuestas lleno, lo que no cabe se queda en la cola (sin confirmar) y lo de la moneda del presupuesto entra', () => {
    const full = Array.from({ length: CAPTURE_PROPOSALS_MAX - 1 }, (_, i) => proposal({ captureId: `cap-full${String(i).padStart(4, '0')}`, amount: { kind: 'unreadable', text: 'x' } }))
    const r = imported(baseData({ captures: { processed: [], proposals: full } }), [
      record({ captureId: 'cap-usd00001', currencyHint: 'USD' }),
      record({ captureId: 'cap-usd00002', currencyHint: 'USD' }),
      record({ captureId: 'cap-cad00001', createdAt: '2026-09-28T15:10:00Z' }),
      record({ captureId: 'cap-usd00003', currencyHint: 'USD' }),
    ])
    expect(r.value).toEqual({
      saved: ['cap-cad00001'],
      proposed: ['cap-usd00001'],
      skipped: [],
      deferred: ['cap-usd00002', 'cap-usd00003'],
      ack: ['cap-usd00001', 'cap-cad00001'],
    })
    expect(r.data.captures!.proposals).toHaveLength(CAPTURE_PROPOSALS_MAX)
    expect(r.data.captures!.processed.map((p) => p.id)).toEqual(['cap-cad00001', 'cap-usd00001'])
  })

  it('un gasto que pasaría de la cota de exactitud no se crea: queda como propuesta', () => {
    // Lo que ya sale suma 2⁵³ − 1 − 425: cabe un gasto de 4,25 justo, pero no uno de 4,26.
    const huge = tx({ id: 'huge', amountMinor: Number.MAX_SAFE_INTEGER - 425 - 100000 })
    const data = baseData({ transactions: [huge], accounts: [account({ id: 'main', anchor: { amountMinor: -100000, date: '2026-09-28', setAt: EARLIER } })] })
    expect(imported(data, [record({ rawAmount: '4.25' })]).value.saved).toEqual(['cap-00000001'])
    const over = imported(data, [record({ rawAmount: '4.26' })])
    expect(over.value.proposed).toEqual(['cap-00000001'])
    expect(over.data.captures!.proposals[0]!.reason).toBe('auto_capture')
  })

  it('sin ninguna cuenta activa no hay dónde registrar: todo se queda en la cola y nada cambia', () => {
    const data = baseData({ accounts: [account({ id: 'main', archived: true })] })
    const r = importCaptures(data, [record(), record({ captureId: 'cap-usd00001', currencyHint: 'USD' })], ctx)
    expect(r).toMatchObject({ ok: true, unchanged: true, value: { saved: [], proposed: [], deferred: ['cap-00000001', 'cap-usd00001'], ack: [] } })
  })
})

describe('accountForCard', () => {
  const accounts = [
    account({ id: 'main', order: 2 }),
    account({ id: 'cash', order: 1, includeInBudget: false }),
    account({ id: 'visa', kind: 'credit', order: 3 }),
    account({ id: 'old', order: 0, archived: true }),
  ]
  const settings = (capture?: AppData['settings']['capture']) => ({ ...baseData().settings, ...(capture ? { capture } : {}) })

  it('la tarjeta asignada (sin distinguir mayúsculas ni acentos), si no la de por defecto, si no la primera activa del presupuesto', () => {
    const capture = { autoSave: true, cardAccounts: [{ card: 'Visa ••1234', accountId: 'visa' }], defaultAccountId: 'cash' }
    expect(accountForCard({ accounts, settings: settings(capture) }, 'VISA ••1234')).toBe('visa')
    expect(accountForCard({ accounts, settings: settings(capture) }, 'Amex ••0005')).toBe('cash')
    expect(accountForCard({ accounts, settings: settings(capture) }, undefined)).toBe('cash')
    // Sin ajustes: «old» está archivada y «cash» no es del presupuesto → «main».
    expect(accountForCard({ accounts, settings: settings() }, 'Visa ••1234')).toBe('main')
  })

  it('nunca una cuenta archivada o que ya no existe', () => {
    const capture = { autoSave: true, cardAccounts: [{ card: 'Visa ••1234', accountId: 'old' }], defaultAccountId: 'gone' }
    expect(accountForCard({ accounts, settings: settings(capture) }, 'Visa ••1234')).toBe('main')
    const onlyOffBudget = [account({ id: 'cash', includeInBudget: false })]
    expect(accountForCard({ accounts: onlyOffBudget, settings: settings() }, undefined)).toBe('cash')
    expect(accountForCard({ accounts: [account({ id: 'old', archived: true })], settings: settings() }, undefined)).toBeUndefined()
  })

  it('la importación usa la cuenta de la tarjeta', () => {
    const data = baseData({
      accounts: [account({ id: 'main' }), account({ id: 'visa', kind: 'credit', anchor: { amountMinor: -5000, date: '2026-09-28', setAt: EARLIER } })],
      settings: { ...baseData().settings, capture: { autoSave: true, cardAccounts: [{ card: 'Visa ••1234', accountId: 'visa' }] } },
    })
    const r = imported(data, [record()])
    expect(r.data.transactions[0]!.accountId).toBe('visa')
    // La deuda de la tarjeta crece: −50,00 − 4,25 = −54,25.
    expect(accountBalance(r.data, r.data.accounts[1]!).balanceMinor).toBe(-5425)
  })
})

describe('revisar', () => {
  const captured = () => imported(baseData(), [record({ origin: 'bank_text', rawText: 'Compra TIM HORTONS 4.25' })]).data

  it('«Está bien» quita la marca y el texto original; nada más cambia', () => {
    const data = captured()
    const r = confirmReviews(data, ['cap-00000001', 'unknown'], { ...ctx, now: '2026-09-28T17:00:00.000Z' })
    if (!r.ok) throw new Error('confirm')
    expect(r.value).toEqual(['cap-00000001'])
    const { review: _review, updatedAt: _u, ...rest } = data.transactions[0]!
    expect(r.data.transactions[0]).toEqual({ ...rest, updatedAt: '2026-09-28T17:00:00.000Z' })
    expect(confirmReviews(r.data, ['cap-00000001'], ctx)).toMatchObject({ ok: true, unchanged: true, value: [] })
  })

  it('editar en el formulario conserva la captura; la marca solo se quita si el formulario dice que se revisó', () => {
    const data = captured()
    const { createdAt: _c, updatedAt: _u, currency: _cur, realizedAt: _r, ...draft } = data.transactions[0]!
    const kept = saveTransaction(data, { ...draft, review: undefined, captureId: undefined, categoryId: 'groceries' }, ctx)
    if (!kept.ok) throw new Error('save')
    expect(kept.value).toMatchObject({ captureId: 'cap-00000001', review: { needed: true, reason: 'auto_capture' }, categoryId: 'groceries' })
    const reviewed = saveTransaction(data, { ...draft, reviewed: true }, ctx)
    if (!reviewed.ok) throw new Error('save')
    expect(reviewed.value.captureId).toBe('cap-00000001')
    expect(reviewed.value).not.toHaveProperty('review')
  })

  it('«Fue rechazado» la manda a la papelera: sale de las cifras y la captura no vuelve a entrar', () => {
    const data = captured()
    const r = trashTransactions(data, ['cap-00000001'], ctx)
    if (!r.ok) throw new Error('trash')
    expect(accountBalance(r.data, mainOf(r.data)).balanceMinor).toBe(100000)
    expect(importCaptures(r.data, [record()], ctx)).toMatchObject({ ok: true, unchanged: true })
  })
})

describe('propuestas: descartar y registrar', () => {
  const withProposals = (...proposals: CaptureProposal[]) => baseData({ captures: { processed: proposals.map((p) => ({ id: p.captureId, at: EARLIER })), proposals } })

  it('«Descartar» la quita; su id sigue entre las leídas (al final) y no vuelve aunque siga en la cola', () => {
    const data = withProposals(proposal(), proposal({ captureId: 'cap-prop0002' }))
    const r = dismissProposals(data, ['cap-prop0001'], ctx)
    if (!r.ok) throw new Error('dismiss')
    expect(r.data.captures).toEqual({
      processed: [
        { id: 'cap-prop0002', at: EARLIER },
        { id: 'cap-prop0001', at: NOW },
      ],
      proposals: [proposal({ captureId: 'cap-prop0002' })],
    })
    expect(importCaptures(r.data, [record({ captureId: 'cap-prop0001' })], ctx)).toMatchObject({ ok: true, unchanged: true })
    expect(dismissProposals(r.data, ['cap-prop0001'], ctx)).toMatchObject({ ok: true, unchanged: true })
  })

  it('«Registrar» crea el gasto ya revisado, con la hora del pago, y retira la propuesta', () => {
    const r = registerProposal(withProposals(proposal()), 'cap-prop0001', ctx)
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.value).toEqual({
      id: 'cap-prop0001',
      kind: 'expense',
      status: 'realized',
      amountMinor: 1250,
      currency: 'CAD',
      date: '2026-09-28',
      accountId: 'main',
      categoryId: 'entertainment',
      merchant: 'Cineplex',
      source: 'apple_pay',
      captureId: 'cap-prop0001',
      realizedAt: '2026-09-28T15:00:00Z',
      createdAt: NOW,
      updatedAt: NOW,
    })
    expect(r.data.captures!.proposals).toEqual([])
    expect(accountBalance(r.data, mainOf(r.data)).balanceMinor).toBe(100000 - 1250)
  })

  it('una propuesta en otra moneda no se registra así (se escribe el importe en el formulario)', () => {
    const foreign = proposal({ reason: 'currency', amount: { kind: 'foreign', currency: 'USD', minor: 1000 } })
    expect(registerProposal(withProposals(foreign), 'cap-prop0001', ctx)).toEqual({ ok: false, issues: [{ path: 'amountMinor', code: 'currencyMismatch', params: { expected: 'CAD' } }] })
    expect(registerProposal(withProposals(foreign), 'nope', ctx)).toMatchObject({ ok: false, issues: [{ code: 'notFound' }] })
  })

  it('si su cuenta se archivó, usa la de la tarjeta o la primera activa', () => {
    const data = { ...withProposals(proposal({ accountId: 'old' })), accounts: [account({ id: 'main' }), account({ id: 'old', archived: true })] }
    const r = registerProposal(data, 'cap-prop0001', ctx)
    expect(r.ok && r.value.accountId).toBe('main')
  })

  it('guardarla desde el formulario (con su captura) también la retira', () => {
    const foreign = proposal({ reason: 'currency', amount: { kind: 'foreign', currency: 'USD', minor: 1000 } })
    const data = withProposals(foreign)
    const r = saveTransaction(
      data,
      { id: 'cap-prop0001', kind: 'expense', status: 'realized', amountMinor: 1371, date: '2026-09-28', accountId: 'main', categoryId: 'entertainment', source: 'apple_pay', captureId: 'cap-prop0001' },
      ctx,
    )
    if (!r.ok) throw new Error(JSON.stringify(r.issues))
    expect(r.data.captures).toEqual({ processed: [{ id: 'cap-prop0001', at: EARLIER }], proposals: [] })
    expect(r.value).toMatchObject({ amountMinor: 1371, captureId: 'cap-prop0001' })
    expect(r.value).not.toHaveProperty('review')
  })
})

describe('de la cola a los datos', () => {
  it('lo que escribe el iPhone, leído y aplicado', () => {
    const queue = [
      JSON.stringify({ captureId: 'cap-q0000001', createdAt: '2026-09-28T15:00:00Z', origin: 'apple_pay', rawAmount: '4.25', currencyHint: 'CAD', merchant: 'Tim Hortons', card: 'Visa ••1234' }),
      JSON.stringify({ captureId: 'cap-q0000002', createdAt: '2026-09-28T15:20:00Z', origin: 'siri', rawAmount: 'CA$18.40', merchant: 'Metro' }),
      JSON.stringify({ captureId: 'cap-q0000003', createdAt: '2026-09-28T15:25:00Z', origin: 'apple_pay', rawAmount: '1200', currencyHint: 'JPY', merchant: 'Ichiran' }),
      '{"captureId":"cap-q0000004","createdAt":"2026-09-28T15:3',
    ].join('\n')
    const read = readCaptureQueue(queue)
    expect(read.partialTail).toBe(true)
    const r = imported(baseData(), read.records)
    expect(r.value).toMatchObject({ saved: ['cap-q0000001', 'cap-q0000002'], proposed: ['cap-q0000003'], ack: ['cap-q0000001', 'cap-q0000002', 'cap-q0000003'] })
    expect(r.data.transactions.map((t) => [t.amountMinor, t.categoryId, t.source])).toEqual([
      [425, 'dining', 'apple_pay'],
      [1840, 'groceries', 'siri'],
    ])
    // 1 000,00 − 4,25 − 18,40 = 977,35.
    expect(accountBalance(r.data, mainOf(r.data)).balanceMinor).toBe(97735)
  })
})
