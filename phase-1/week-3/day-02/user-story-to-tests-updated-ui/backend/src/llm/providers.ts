/**
 * Registry of OpenAI-compatible LLM providers.
 *
 * - A provider is only "enabled" when its API key is present in .env.
 * - Models are NOT hard-coded: they are fetched live from the provider's
 *   GET {baseUrl}/models endpoint using your API key, so the list always
 *   matches what your account can actually use.
 * - The default model is <PREFIX>_MODEL from .env if that model exists in the
 *   live list, otherwise the first model the provider returns.
 *
 * To add another OpenAI-compatible provider, add an entry to PROVIDER_DEFS.
 */

export interface ProviderDef {
  id: string
  name: string
  /** Env var prefix, e.g. GROQ -> GROQ_API_KEY / GROQ_API_BASE / GROQ_MODEL */
  envPrefix: string
  defaultBaseUrl: string
  /** Whether to send response_format: { type: 'json_object' } */
  supportsJsonMode: boolean
  /**
   * The /models endpoint also returns non-chat models (speech-to-text, TTS,
   * safety classifiers, embeddings). They cannot generate test cases, so ids
   * matching these patterns are hidden.
   */
  excludeModelPatterns?: RegExp[]
}

export interface ProviderConfig extends ProviderDef {
  apiKey: string
  baseUrl: string
  /** Preferred model from .env (<PREFIX>_MODEL), may be undefined */
  preferredModel?: string
}

const PROVIDER_DEFS: ProviderDef[] = [
  {
    id: 'groq',
    name: 'Groq',
    envPrefix: 'GROQ',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    supportsJsonMode: true,
    excludeModelPatterns: [/whisper/i, /tts/i, /guard/i, /orpheus/i, /playai/i, /distil/i, /embed/i]
  },
  {
    id: 'inception',
    name: 'Inception Labs',
    envPrefix: 'INCEPTION',
    defaultBaseUrl: 'https://api.inceptionlabs.ai/v1',
    supportsJsonMode: false,
    excludeModelPatterns: [/embed/i]
  }
]

/** Reads an env var, accepting both UPPER_CASE and the legacy lower-case prefix (e.g. groq_API_KEY). */
function readEnv(prefix: string, suffix: string): string | undefined {
  const candidates = [`${prefix}_${suffix}`, `${prefix.toLowerCase()}_${suffix}`]
  for (const name of candidates) {
    const value = process.env[name]
    if (value && value.trim()) return value.trim()
  }
  return undefined
}

export function getEnabledProviders(): ProviderConfig[] {
  const order = (process.env.LLM_PROVIDER_ORDER || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)

  const enabled = PROVIDER_DEFS.flatMap(def => {
    const apiKey = readEnv(def.envPrefix, 'API_KEY')
    if (!apiKey) return []
    return [{
      ...def,
      apiKey,
      baseUrl: (readEnv(def.envPrefix, 'API_BASE') || def.defaultBaseUrl).replace(/\/+$/, ''),
      preferredModel: readEnv(def.envPrefix, 'MODEL')
    }]
  })

  if (order.length === 0) return enabled
  const rank = (p: ProviderConfig) => {
    const i = order.indexOf(p.id)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return [...enabled].sort((a, b) => rank(a) - rank(b))
}

// ---------- Live model discovery ----------

export interface ModelListing {
  models: string[]
  defaultModel: string
  /** Set when the provider's /models call failed (e.g. invalid key) */
  error?: string
}

const SUCCESS_TTL_MS = 10 * 60 * 1000
const FAILURE_TTL_MS = 30 * 1000
const modelCache = new Map<string, { listing: ModelListing; expires: number }>()

export async function listModels(provider: ProviderConfig): Promise<ModelListing> {
  const cacheKey = `${provider.id}|${provider.baseUrl}|${provider.apiKey.slice(-6)}`
  const cached = modelCache.get(cacheKey)
  if (cached && cached.expires > Date.now()) return cached.listing

  let models: string[] = []
  let error: string | undefined
  try {
    const res = await fetch(`${provider.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      signal: AbortSignal.timeout(10_000)
    })
    if (res.ok) {
      const data = await res.json() as { data?: Array<{ id: string; active?: boolean }> }
      models = (data.data || [])
        .filter(m => m && typeof m.id === 'string' && m.active !== false)
        .map(m => m.id)
        .filter(id => !(provider.excludeModelPatterns || []).some(rx => rx.test(id)))
        .sort((a, b) => a.localeCompare(b))
      if (models.length === 0) error = 'provider returned no chat models'
    } else {
      error = res.status === 401 || res.status === 403
        ? `API key rejected (${res.status})`
        : `could not list models (HTTP ${res.status})`
    }
  } catch (err) {
    error = `could not reach provider: ${(err as Error).message}`
  }

  if (error) console.warn(`[${provider.name}] ${error}`)

  const preferred = provider.preferredModel
  let defaultModel = ''
  if (preferred && models.includes(preferred)) {
    defaultModel = preferred
  } else if (models.length > 0) {
    if (preferred) console.warn(`[${provider.name}] model "${preferred}" from .env is not available; using "${models[0]}"`)
    defaultModel = models[0]
  }

  const listing: ModelListing = {
    // Put the default model first in the dropdown
    models: defaultModel ? [defaultModel, ...models.filter(m => m !== defaultModel)] : models,
    defaultModel,
    ...(error ? { error } : {})
  }
  modelCache.set(cacheKey, { listing, expires: Date.now() + (error ? FAILURE_TTL_MS : SUCCESS_TTL_MS) })
  return listing
}
