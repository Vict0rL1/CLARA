import { describe, expect, it } from 'vitest'
import { recordAiUsage, saveConfirmedEntries } from './assistant'
import { createAiProvider, LocalProvider, RemoteProvider } from './aiProvider'
import { EXPENSE_CATEGORY_IDS, INCOME_CATEGORY_IDS } from './categories'
import { baseData, ctx } from '../test/fixtures'
import { validateAppData } from '../storage/backup'

const pctx = { today: '2026-09-28', currency: 'CAD', language: 'es' as const, categories: [...EXPENSE_CATEGORY_IDS.map((id) => ({ id, kind: 'expense' as const })), ...INCOME_CATEGORY_IDS.map((id) => ({ id, kind: 'income' as const }))] }

describe('asistente: registro todo o nada y contador de uso', () => {
  it('registra varias entradas en una sola operación; una inválida anula todas', () => {
    const data = baseData()
    const ok = saveConfirmedEntries(
      data,
      [
        { id: 'a', kind: 'expense', amountMinor: 4500, date: '2026-09-27', accountId: 'main', categoryId: 'dining', note: 'café', merchant: 'Starbucks', source: 'ai_text' },
        { id: 'b', kind: 'income', amountMinor: 50000, date: '2026-09-28', accountId: 'main', categoryId: 'freelance', source: 'ai_text' },
      ],
      ctx,
    )
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.data.transactions).toHaveLength(2)
    expect(ok.data.transactions[0]).toMatchObject({ status: 'realized', source: 'ai_text', merchant: 'Starbucks', note: 'café' })
    expect(validateAppData(ok.data).ok).toBe(true)
    const bad = saveConfirmedEntries(data, [{ id: 'a', kind: 'expense', amountMinor: 4500, date: '2026-09-27', accountId: 'main', categoryId: 'dining', source: 'ai_text' }, { id: 'b', kind: 'expense', amountMinor: 100, date: '2026-09-28', accountId: 'nope', categoryId: 'dining', source: 'ai_text' }], ctx)
    expect(bad).toMatchObject({ ok: false, issues: [{ path: 'entries[1].accountId' }] })
    expect(saveConfirmedEntries(data, [], ctx).ok).toBe(false)
    // Una fecha futura se registra como prevista (no cambia el saldo).
    const future = saveConfirmedEntries(data, [{ id: 'f', kind: 'expense', amountMinor: 100, date: '2026-10-05', accountId: 'main', categoryId: 'dining', source: 'ai_text' }], ctx)
    expect(future.ok && future.value[0]!.status).toBe('planned')
  })

  it('el contador mensual sube y se reinicia al cambiar de mes', () => {
    let r = recordAiUsage(baseData(), ctx)
    expect(r.ok && r.value).toEqual({ month: '2026-09', count: 1 })
    if (!r.ok) return
    r = recordAiUsage(r.data, ctx)
    expect(r.ok && r.value).toEqual({ month: '2026-09', count: 2 })
    if (!r.ok) return
    const next = recordAiUsage(r.data, { ...ctx, today: '2026-10-01' })
    expect(next.ok && next.value).toEqual({ month: '2026-10', count: 1 })
  })
})

describe('proveedor de IA', () => {
  it('sin credenciales siempre es local; con credenciales y origen declarado, remoto', async () => {
    expect(createAiProvider({}).id).toBe('local')
    expect(createAiProvider({ VITE_AI_ENDPOINT: 'https://x', VITE_AI_KEY: '' }).id).toBe('local')
    // Punto 11: el origen tiene que estar declarado como servicio propio; sin la lista, local.
    expect(createAiProvider({ VITE_AI_ENDPOINT: 'https://x', VITE_AI_KEY: 'k' }).id).toBe('local')
    expect(createAiProvider({ VITE_AI_ENDPOINT: 'https://x', VITE_AI_KEY: 'k', VITE_AI_ALLOWED_ORIGINS: 'https://x' }).id).toBe('remote')
    const local = await new LocalProvider().parseText('café 45', pctx)
    expect(local[0]).toMatchObject({ amountMinor: 4500, categoryId: 'dining' })
  })

  it('el remoto valida la respuesta campo a campo y cae al local si el servicio falla', async () => {
    const fetchOk = (async () => new Response(JSON.stringify({ entries: [{ amountMinor: 4600, categoryId: 'salary', date: '2030-01-01', description: 'Café con Ana', confidence: 2 }] }), { status: 200 })) as unknown as typeof fetch
    const remote = new RemoteProvider({ endpoint: 'https://x', apiKey: 'k' }, fetchOk)
    const [e] = await remote.parseText('café 45', pctx)
    // Importe afinado; categoría de otro tipo y fecha futura rechazadas; confianza acotada.
    expect(e).toMatchObject({ amountMinor: 4600, categoryId: 'dining', date: '2026-09-28', description: 'Café con Ana', confidence: 0.95 })
    const fetchFail = (async () => new Response('', { status: 500 })) as unknown as typeof fetch
    const [f] = await new RemoteProvider({ endpoint: 'https://x', apiKey: 'k' }, fetchFail).parseText('café 45', pctx)
    expect(f).toMatchObject({ amountMinor: 4500, categoryId: 'dining' })
  })
})
