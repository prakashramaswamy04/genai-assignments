import { ProviderConfig, getEnabledProviders, listModels } from './providers'
import { GenerateResponse, GenerateResponseSchema } from '../schemas'

export interface AttemptLog {
  provider: string
  providerName: string
  model: string
  ok: boolean
  reason?: string
}

export interface RoutedResult {
  response: GenerateResponse
  provider: string
  providerName: string
  model: string
  attempts: AttemptLog[]
}

export class LLMCallError extends Error {
  constructor(
    message: string,
    /** 'auth' = key invalid/unauthorized (skip whole provider), 'exhausted' = rate limit / quota, 'other' = anything else */
    public kind: 'auth' | 'exhausted' | 'other',
    public retryAfterMs?: number
  ) {
    super(message)
  }
}

export class AllProvidersFailedError extends Error {
  constructor(public attempts: AttemptLog[], noProviders = false) {
    super(
      attempts.length === 0
        ? noProviders
          ? 'No LLM provider is configured. Add GROQ_API_KEY and/or INCEPTION_API_KEY to .env'
          : 'No models are available from the configured providers. Check your API keys.'
        : `All LLM providers failed: ${attempts.map(a => `${a.providerName}/${a.model} (${a.reason})`).join('; ')}`
    )
  }
}

// ---------- Cooldown tracking for exhausted provider/model combos ----------

const DEFAULT_COOLDOWN_MS = 60 * 1000
const cooldowns = new Map<string, number>() // key "provider::model" or "provider::*" -> until timestamp

function cooldownKey(provider: string, model: string) {
  return `${provider}::${model}`
}

function isCoolingDown(provider: string, model: string): boolean {
  const now = Date.now()
  for (const key of [cooldownKey(provider, model), cooldownKey(provider, '*')]) {
    const until = cooldowns.get(key)
    if (until && until > now) return true
    if (until) cooldowns.delete(key)
  }
  return false
}

function markCooldown(provider: string, model: string, ms: number) {
  cooldowns.set(cooldownKey(provider, model), Date.now() + ms)
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (!Number.isNaN(seconds)) return Math.min(seconds * 1000, 30 * 60 * 1000)
  const date = Date.parse(header)
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  return undefined
}

// ---------- Single provider call ----------

function extractJson(content: string): unknown {
  let text = content.trim()
  // Strip markdown fences / reasoning tags some models add
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1))
    throw new Error('response is not valid JSON')
  }
}

async function callProvider(
  provider: ProviderConfig,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<GenerateResponse & { model: string }> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.2
  }
  if (provider.supportsJsonMode) body.response_format = { type: 'json_object' }

  let res: Response
  try {
    res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS) || 90_000)
    })
  } catch (err) {
    throw new LLMCallError(`network error: ${(err as Error).message}`, 'other')
  }

  if (!res.ok) {
    const errText = (await res.text().catch(() => '')).slice(0, 300)
    const lower = errText.toLowerCase()
    if (res.status === 401 || res.status === 403) {
      throw new LLMCallError(`unauthorized (${res.status})`, 'auth')
    }
    if (
      res.status === 429 || res.status === 402 ||
      lower.includes('rate limit') || lower.includes('quota') || lower.includes('insufficient') || lower.includes('exceeded')
    ) {
      throw new LLMCallError(`quota/rate limit exhausted (${res.status})`, 'exhausted', parseRetryAfter(res.headers.get('retry-after')))
    }
    throw new LLMCallError(`HTTP ${res.status}: ${errText || res.statusText}`, 'other')
  }

  const data = await res.json() as any
  const content: string | undefined = data?.choices?.[0]?.message?.content
  if (!content) throw new LLMCallError('empty response', 'other')

  let parsed: unknown
  try {
    parsed = extractJson(content)
  } catch (err) {
    throw new LLMCallError(`invalid JSON from model`, 'other')
  }

  const withUsage = {
    ...(parsed as object),
    model: data.model || model,
    promptTokens: data.usage?.prompt_tokens || 0,
    completionTokens: data.usage?.completion_tokens || 0
  }
  const validated = GenerateResponseSchema.safeParse(withUsage)
  if (!validated.success || validated.data.cases.length === 0) {
    throw new LLMCallError('response did not match test case schema', 'other')
  }
  return { ...validated.data, model: withUsage.model }
}

// ---------- Routing with automatic fallback ----------

interface Candidate {
  provider: ProviderConfig
  model: string
}

const MAX_ATTEMPTS = Number(process.env.LLM_MAX_ATTEMPTS) || 6

async function buildCandidates(preferredProvider?: string, preferredModel?: string, autoSwitch = true): Promise<Candidate[]> {
  const providers = getEnabledProviders()
  if (providers.length === 0) return []

  // Live model listings for every provider (cached in providers.ts)
  const listings = new Map(await Promise.all(providers.map(async p => [p.id, await listModels(p)] as const)))

  const first = providers.find(p => p.id === preferredProvider) || providers[0]
  const firstModel = preferredModel || listings.get(first.id)?.defaultModel
  const primary: Candidate[] = firstModel ? [{ provider: first, model: firstModel }] : []
  if (!autoSwitch) return primary

  // Order: chosen model -> other providers' default models -> other models of every provider
  const ordered: Candidate[] = [...primary]
  const others = providers.filter(p => p.id !== first.id)
  for (const p of others) {
    const def = listings.get(p.id)?.defaultModel
    if (def) ordered.push({ provider: p, model: def })
  }
  for (const p of [first, ...others]) {
    for (const m of listings.get(p.id)?.models || []) ordered.push({ provider: p, model: m })
  }

  // De-duplicate
  const seen = new Set<string>()
  const unique = ordered.filter(c => {
    const k = cooldownKey(c.provider.id, c.model)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  // Push combos currently cooling down to the end (still tried as a last resort)
  const ready = unique.filter(c => !isCoolingDown(c.provider.id, c.model))
  const cooling = unique.filter(c => isCoolingDown(c.provider.id, c.model))
  return [...ready, ...cooling]
}

export async function generateWithFallback(
  systemPrompt: string,
  userPrompt: string,
  opts: { provider?: string; model?: string; autoSwitch?: boolean } = {}
): Promise<RoutedResult> {
  const candidates = await buildCandidates(opts.provider, opts.model, opts.autoSwitch !== false)
  const attempts: AttemptLog[] = []
  const deadProviders = new Set<string>()

  for (const { provider, model } of candidates) {
    if (attempts.length >= MAX_ATTEMPTS) break
    if (deadProviders.has(provider.id)) continue

    console.log(`🤖 Trying ${provider.name} / ${model}`)
    try {
      const response = await callProvider(provider, model, systemPrompt, userPrompt)
      attempts.push({ provider: provider.id, providerName: provider.name, model, ok: true })
      if (attempts.length > 1) console.log(`🔁 Switched to ${provider.name} / ${model} after ${attempts.length - 1} failed attempt(s)`)
      return { response, provider: provider.id, providerName: provider.name, model: response.model || model, attempts }
    } catch (err) {
      const e = err instanceof LLMCallError ? err : new LLMCallError((err as Error).message, 'other')
      console.warn(`⚠️  ${provider.name} / ${model} failed: ${e.message}`)
      attempts.push({ provider: provider.id, providerName: provider.name, model, ok: false, reason: e.message })

      if (e.kind === 'auth') {
        deadProviders.add(provider.id)
        markCooldown(provider.id, '*', 10 * 60 * 1000)
      } else if (e.kind === 'exhausted') {
        markCooldown(provider.id, model, e.retryAfterMs ?? DEFAULT_COOLDOWN_MS)
      }
    }
  }

  throw new AllProvidersFailedError(attempts, getEnabledProviders().length === 0)
}
