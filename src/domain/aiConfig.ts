/**
 * Configuración del proveedor remoto del asistente (R-01 de la auditoría 2026-10-09).
 *
 * Todo lo que empiece por `VITE_` acaba en el paquete que descarga cualquier navegador: es público
 * por definición. Por eso `VITE_AI_KEY` solo puede ser un token público de alcance limitado para un
 * servicio PROPIO, que guarde la credencial real del proveedor, imponga cuotas y autorice por
 * usuario. Nunca la clave de OpenAI, Anthropic, Google, Mistral… ni un endpoint que vaya directo a
 * ellos: eso sería regalar una credencial reutilizable a quien abra la app.
 *
 * La comprobación corre dos veces con la misma regla: al compilar (`vite.config.ts`, la
 * compilación falla) y en la app (`createAiProvider`, se usa el análisis local). Nunca se simula un
 * proveedor remoto que no exista.
 */
export type RemoteAiEnv = {
  VITE_AI_ENDPOINT?: string
  VITE_AI_KEY?: string
  /**
   * Orígenes https del servicio PROPIO (separados por comas o espacios). Obligatorio para activar el
   * proveedor remoto: el endpoint tiene que estar en esta lista, que decide quien despliega.
   */
  VITE_AI_ALLOWED_ORIGINS?: string
}

export type RemoteAiReason =
  /** Ni endpoint ni clave: análisis local, sin más. */
  | 'none'
  /** Solo uno de los dos: no se conecta a nada y se avisa (una clave sin endpoint también viajaría en el paquete). */
  | 'incomplete'
  /** El endpoint no es una URL https. */
  | 'insecureEndpoint'
  /** La URL lleva usuario/contraseña (`https://u:p@host`) o un parámetro con forma de credencial (`?key=`). */
  | 'credentialsInUrl'
  /** El origen del endpoint no está en `VITE_AI_ALLOWED_ORIGINS` (o la lista falta). */
  | 'originNotAllowed'
  /** El endpoint apunta directo a un proveedor de IA: la clave sería su credencial. */
  | 'providerHost'
  /** La clave tiene la forma de un secreto de proveedor. */
  | 'secretKey'

export type RemoteAiCheck = { ok: true; endpoint: string; origin: string; host: string } | { ok: false; reason: RemoteAiReason }

/** Hosts (exactos o por sufijo) de proveedores de IA: una clave que vaya directa a ellos es un secreto reutilizable. */
export const PROVIDER_API_HOSTS: readonly string[] = [
  'api.openai.com',
  '.openai.com',
  '.openai.azure.com',
  '.cognitiveservices.azure.com',
  'api.anthropic.com',
  '.anthropic.com',
  'generativelanguage.googleapis.com',
  'aiplatform.googleapis.com',
  '.googleapis.com',
  'api.mistral.ai',
  'api.cohere.com',
  'api.cohere.ai',
  'api.groq.com',
  'openrouter.ai',
  'api.together.xyz',
  'api.deepseek.com',
  'api.x.ai',
  'api.perplexity.ai',
  'api.replicate.com',
  'api-inference.huggingface.co',
  'router.huggingface.co',
  '.amazonaws.com',
]

/** Formas conocidas de claves de proveedor (no de tokens públicos propios). */
export const PROVIDER_SECRET_PATTERNS: readonly RegExp[] = [
  /^sk-/i, // OpenAI (`sk-`, `sk-proj-`), Anthropic (`sk-ant-`), OpenRouter (`sk-or-`), DeepSeek, Mistral…
  /^sk_(live|test)_/i, // Stripe
  /^AIza[0-9A-Za-z_-]{20,}$/, // Google API key
  /^ya29\./, // Google OAuth
  /^gsk_/, // Groq
  /^xai-/i, // xAI
  /^r8_/, // Replicate
  /^hf_/, // Hugging Face
  /^pplx-/i, // Perplexity
  /^AKIA[0-9A-Z]{16}$/, // AWS access key id
  /^(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}$/, // GitHub
  /^github_pat_/,
  /^xox[abprs]-/, // Slack
]

/**
 * Host canónico para comparar: minúsculas y sin puntos finales. `api.openai.com.` (FQDN con punto)
 * resuelve al mismo sitio que `api.openai.com` y no puede saltarse la lista de proveedores.
 */
export function canonicalHost(host: string): string {
  return host.toLowerCase().replace(/\.+$/, '')
}

/** Parámetros de consulta que suelen llevar credenciales: no pueden ir en una URL pública. */
const CREDENTIAL_PARAMS = /^(key|api[-_]?key|apikey|token|access[-_]?token|auth|authorization|secret|client[-_]?secret|password|sig|signature)$/i

/** Origen https canónico (`https://host[:puerto]`) o `null` si la URL no sirve como origen propio. */
function canonicalOrigin(url: URL): string | null {
  const host = canonicalHost(url.hostname)
  if (url.protocol !== 'https:' || !host || url.username || url.password) return null
  return `https://${host}${url.port ? `:${url.port}` : ''}`
}

/** Lista de orígenes permitidos (la decide quien despliega). Entradas no https, con credenciales o de proveedores se ignoran. */
export function allowedOrigins(value: string | undefined): string[] {
  const out: string[] = []
  for (const entry of (value ?? '').split(/[\s,]+/).filter(Boolean)) {
    let url: URL
    try {
      url = new URL(entry)
    } catch {
      continue
    }
    const origin = canonicalOrigin(url)
    if (origin && !isProviderHost(url.hostname) && !out.includes(origin)) out.push(origin)
  }
  return out
}

export function isProviderHost(host: string): boolean {
  const h = canonicalHost(host)
  return PROVIDER_API_HOSTS.some((p) => (p.startsWith('.') ? h.endsWith(p) || h === p.slice(1) : h === p))
}

export function looksLikeProviderSecret(key: string): boolean {
  return PROVIDER_SECRET_PATTERNS.some((p) => p.test(key))
}

export function checkRemoteAiConfig(env: RemoteAiEnv = {}): RemoteAiCheck {
  const endpoint = (env.VITE_AI_ENDPOINT ?? '').trim()
  const key = (env.VITE_AI_KEY ?? '').trim()
  if (!endpoint && !key) return { ok: false, reason: 'none' }
  if (!endpoint || !key) return { ok: false, reason: 'incomplete' }
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return { ok: false, reason: 'insecureEndpoint' }
  }
  // Credenciales en la URL: viajarían en el paquete igual que la clave (y en registros de servidores).
  if (url.username || url.password || [...url.searchParams.keys()].some((k) => CREDENTIAL_PARAMS.test(k))) return { ok: false, reason: 'credentialsInUrl' }
  if (url.protocol !== 'https:') return { ok: false, reason: 'insecureEndpoint' }
  const host = canonicalHost(url.hostname)
  if (!host) return { ok: false, reason: 'insecureEndpoint' }
  if (isProviderHost(host)) return { ok: false, reason: 'providerHost' }
  if (looksLikeProviderSecret(key)) return { ok: false, reason: 'secretKey' }
  // Solo orígenes del servicio propio que quien despliega declara explícitamente.
  url.hostname = host
  const origin = canonicalOrigin(url)
  if (!origin || !allowedOrigins(env.VITE_AI_ALLOWED_ORIGINS).includes(origin)) return { ok: false, reason: 'originNotAllowed' }
  return { ok: true, endpoint: url.toString(), origin, host: url.host }
}

/** Texto para el error de compilación (en el registro de CI, no en la interfaz). */
export const REMOTE_AI_REASON_TEXT: Record<Exclude<RemoteAiReason, 'none'>, string> = {
  incomplete: 'VITE_AI_ENDPOINT y VITE_AI_KEY van juntos: define los dos o ninguno (una clave sin endpoint también viajaría en el paquete).',
  insecureEndpoint: 'VITE_AI_ENDPOINT debe ser una URL https.',
  credentialsInUrl: 'VITE_AI_ENDPOINT no puede llevar usuario, contraseña ni parámetros con credenciales (key, token, secret…): todo lo que empieza por VITE_ es público.',
  originNotAllowed: 'El origen de VITE_AI_ENDPOINT debe figurar en VITE_AI_ALLOWED_ORIGINS (orígenes https de tu propio servicio, separados por comas). Sin esa lista no se activa el proveedor remoto.',
  providerHost: 'VITE_AI_ENDPOINT apunta directo a un proveedor de IA: la clave sería su credencial y cualquiera que abra la app la vería. Usa un servicio propio que guarde la credencial real.',
  secretKey: 'VITE_AI_KEY tiene la forma de una clave secreta de proveedor. Todo lo que empieza por VITE_ es público: usa un token de alcance limitado para un servicio propio.',
}
