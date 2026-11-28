// Standard USD rates per 1M tokens; unknown models deliberately have no estimate.
const RATES_PER_MILLION = {
  "openai-compatible": {
    "gpt-4.1": { input: 2, output: 8 },
    "gpt-4.1-mini": { input: 0.4, output: 1.6 },
    "gpt-4.1-nano": { input: 0.1, output: 0.4 },
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 }
  },
  groq: {
    "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
    "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
    "openai/gpt-oss-120b": { input: 0.15, output: 0.6 },
    "openai/gpt-oss-20b": { input: 0.075, output: 0.3 }
  },
  anthropic: {
    "claude-3-5-sonnet": { input: 3, output: 15 },
    "claude-3-5-haiku": { input: 0.8, output: 4 },
    "claude-3-7-sonnet": { input: 3, output: 15 },
    "claude-sonnet-4": { input: 3, output: 15 },
    "claude-opus-4": { input: 15, output: 75 },
    "claude-haiku-4": { input: 1, output: 5 }
  },
  gemini: {
    "gemini-2.0-flash": { input: 0.1, output: 0.4 },
    "gemini-2.5-flash": { input: 0.3, output: 2.5 },
    "gemini-2.5-pro": { input: 1.25, output: 10 }
  }
};

function tokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function extractUsage(provider, payload) {
  const usage = provider === "anthropic"
    ? payload?.usage
    : provider === "gemini"
      ? payload?.usageMetadata
      : payload?.usage;
  if (!usage || typeof usage !== "object") return null;

  let inputTokens;
  let outputTokens;
  let reasoningTokens = 0;
  if (provider === "anthropic") {
    const input = tokenCount(usage.input_tokens);
    const cacheRead = tokenCount(usage.cache_read_input_tokens ?? 0);
    const cacheCreation = tokenCount(usage.cache_creation_input_tokens ?? 0);
    inputTokens = input === null || cacheRead === null || cacheCreation === null ? null : input + cacheRead + cacheCreation;
    outputTokens = tokenCount(usage.output_tokens);
  } else if (provider === "gemini") {
    inputTokens = tokenCount(usage.promptTokenCount);
    const output = tokenCount(usage.candidatesTokenCount ?? 0);
    reasoningTokens = tokenCount(usage.thoughtsTokenCount ?? 0);
    outputTokens = output === null || reasoningTokens === null ? null : output + reasoningTokens;
  } else {
    inputTokens = tokenCount(usage.prompt_tokens ?? usage.input_tokens);
    outputTokens = tokenCount(usage.completion_tokens ?? usage.output_tokens);
    reasoningTokens = tokenCount(usage.completion_tokens_details?.reasoning_tokens ?? 0);
  }

  if (inputTokens === null || outputTokens === null || reasoningTokens === null) return null;
  return { inputTokens, outputTokens, reasoningTokens };
}

function priceFor(provider, model) {
  const rates = RATES_PER_MILLION[provider];
  if (!rates || typeof model !== "string") return null;
  const key = Object.keys(rates)
    .filter((knownModel) => model === knownModel || model.startsWith(`${knownModel}-`))
    .sort((a, b) => b.length - a.length)[0];
  return key ? rates[key] : null;
}

export function buildUsage(provider, model, requests) {
  if (!requests.length || requests.some((usage) => !usage)) {
    return {
      available: false,
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
      cost: null,
      requestCount: requests.length
    };
  }

  const inputTokens = requests.reduce((total, usage) => total + usage.inputTokens, 0);
  const outputTokens = requests.reduce((total, usage) => total + usage.outputTokens, 0);
  const reasoningTokens = requests.reduce((total, usage) => total + usage.reasoningTokens, 0);
  const price = priceFor(provider, model);
  return {
    available: true,
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens: inputTokens + outputTokens,
    cost: price ? (inputTokens * price.input + outputTokens * price.output) / 1_000_000 : null,
    requestCount: requests.length
  };
}
