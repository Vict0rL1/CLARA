/**
 * Proveedor del asistente (§8): `parseText`, `transcribe` y `parseReceipt` detrás de una misma
 * interfaz. `LocalProvider` funciona sin red con el parser local. El proveedor remoto existe solo
 * si hay credenciales en variables de entorno de compilación; sin ellas nunca se simula: la app
 * usa el local y lo dice. Ningún proveedor registra movimientos ni toca saldos.
 */
import { checkRemoteAiConfig, type RemoteAiEnv } from './aiConfig'
import { parseText, type ParseContext, type ParsedEntry } from './parser'

export interface AIProvider {
  readonly id: 'local' | 'remote'
  parseText(text: string, ctx: ParseContext): Promise<ParsedEntry[]>
  /** Audio → texto. El local no transcribe: la voz usa la Web Speech API en el navegador. */
  transcribe?(audio: Blob, language: string): Promise<string>
  /** Imagen de un recibo → texto/entradas. El local se resuelve con OCR en el dispositivo (Fase 9). */
  parseReceipt?(image: Blob, ctx: ParseContext): Promise<ParsedEntry[]>
}

export class LocalProvider implements AIProvider {
  readonly id = 'local' as const
  parseText(text: string, ctx: ParseContext): Promise<ParsedEntry[]> {
    return Promise.resolve(parseText(text, ctx))
  }
}

export interface RemoteConfig {
  endpoint: string
  apiKey: string
}

/**
 * Proveedor remoto: solo se construye con `endpoint` y `apiKey`. Envía el texto a un servicio
 * externo (nada más: ni saldos ni historial) y espera entradas con la misma forma. Si el servicio
 * falla, devuelve el resultado local para que la persona nunca se quede sin asistente.
 */
export class RemoteProvider implements AIProvider {
  readonly id = 'remote' as const
  private readonly local = new LocalProvider()
  private readonly config: RemoteConfig
  private readonly fetchFn: typeof fetch
  constructor(config: RemoteConfig, fetchFn: typeof fetch = fetch) {
    this.config = config
    this.fetchFn = fetchFn
  }

  async parseText(text: string, ctx: ParseContext): Promise<ParsedEntry[]> {
    try {
      const res = await this.fetchFn(this.config.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({ text, today: ctx.today, currency: ctx.currency, language: ctx.language, categories: ctx.categories.map((c) => c.id) }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { entries?: unknown }
      if (!Array.isArray(body.entries)) throw new Error('bad response')
      const local = parseText(text, ctx)
      // La respuesta remota solo puede afinar lo que el local ya sabe hacer; se valida campo a campo.
      return body.entries.map((e, i) => sanitize(e, local[i], ctx))
    } catch {
      return this.local.parseText(text, ctx)
    }
  }
}

function sanitize(remote: unknown, fallback: ParsedEntry | undefined, ctx: ParseContext): ParsedEntry {
  const r = (remote && typeof remote === 'object' ? remote : {}) as Record<string, unknown>
  const base: ParsedEntry = fallback ?? { kind: 'expense', amountMinor: null, description: '', date: ctx.today, confidence: 0.1, raw: '', hints: ['noAmount'] }
  const kind = r.kind === 'income' || r.kind === 'expense' ? r.kind : base.kind
  const allowed = new Set(ctx.categories.filter((c) => c.kind === kind).map((c) => c.id))
  const amount = typeof r.amountMinor === 'number' && Number.isInteger(r.amountMinor) && r.amountMinor > 0 ? r.amountMinor : base.amountMinor
  const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date <= ctx.today ? r.date : base.date
  const categoryId = typeof r.categoryId === 'string' && allowed.has(r.categoryId) ? r.categoryId : base.categoryId
  const description = typeof r.description === 'string' && r.description.trim() ? r.description.trim().slice(0, 120) : base.description
  const confidence = typeof r.confidence === 'number' ? Math.max(0.05, Math.min(0.95, r.confidence)) : base.confidence
  // AS-01: una moneda que el servicio detectó y no es la del presupuesto se conserva (nunca se convierte).
  const remoteCurrency = typeof r.currency === 'string' && /^[A-Za-z]{3}$/.test(r.currency) ? r.currency.toUpperCase() : undefined
  const foreignCurrency = base.foreignCurrency ?? (remoteCurrency && remoteCurrency !== ctx.currency ? remoteCurrency : undefined)
  return { ...base, kind, amountMinor: amount, date, ...(categoryId ? { categoryId } : {}), description, confidence, ...(foreignCurrency ? { foreignCurrency } : {}) }
}

/**
 * Elige proveedor según la configuración de compilación. Sin credenciales → local, sin excepciones.
 * Con una configuración insegura (R-01: clave de proveedor o endpoint directo a un proveedor) también
 * local: la misma regla que hace fallar la compilación (`checkRemoteAiConfig`).
 */
export function createAiProvider(env: RemoteAiEnv = {}): AIProvider {
  const check = checkRemoteAiConfig(env)
  if (check.ok) return new RemoteProvider({ endpoint: check.endpoint, apiKey: (env.VITE_AI_KEY ?? '').trim() })
  return new LocalProvider()
}
