// Per-model list prices in USD per 1M tokens (standard tier, no caching/batch
// discounts), keyed to the SPEC §P2 seed list. Checked against each provider's
// pricing page on PRICES_CHECKED; `verified: false` = not confirmed there (panel
// shows "check pricing"). OpenAI rates are the short-context (≤272K input) tier.
// `longContext` applies when the prompt exceeds `above` input tokens;
// `changes` lists announced price changes that take effect on `from`.

export const PRICES_CHECKED = "2026-10-24";

export const PRICING = {
  // Groq (console.groq.com/docs/models, checked 2026-11-17)
  "openai/gpt-oss-120b": { input: 0.15, output: 0.6, verified: true },
  "openai/gpt-oss-20b": { input: 0.075, output: 0.3, verified: true },
  "qwen/qwen3.8-27b": { input: 0.8, output: 4, verified: true },

  // OpenAI (developers.openai.com/api/docs/pricing)
  "gpt-6.1-sol": { input: 2, output: 10, verified: true },
  "gpt-6-luna": { input: 0.1, output: 0.5, verified: true },
  "gpt-6-astra": { input: 10, output: 50, verified: true },
  "gpt-5.6-sol": { input: 4, output: 20, verified: true },
  "gpt-5.6-terra": { input: 2, output: 12, verified: true },
  "gpt-5.6-luna": { input: 0.2, output: 1.2, verified: true },
  "gpt-5.5": { input: 5, output: 30, verified: true },
  "gpt-5.4-mini": { input: 0.75, output: 4.5, verified: true },
  "gpt-5.4-nano": { input: 0.2, output: 1.25, verified: true },

  // Anthropic (platform.claude.com/docs/en/about-claude/pricing)
  "claude-opus-5-5": { input: 4, output: 20, verified: true },
  "claude-sonnet-5-5": { input: 2, output: 10, verified: true },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, verified: true, longContext: { above: 100_000, input: 0.5, output: 2.5 } },

  // Google Gemini (ai.google.dev/gemini-api/docs/pricing)
  "gemini-4-argon": { input: 2, output: 10, verified: true, changes: [{ from: "2026-12-01", input: 4, output: 20 }] },

  // Inception Labs (SPEC §P2 figure; not confirmed on the pricing page)
  "mercury-2": { input: 0.25, output: 0.75, verified: false },
};

/** Exact match first, then the longest known id the model starts with (e.g. dated snapshots). */
export function priceFor(model, now = new Date()) {
  let p = PRICING[model];
  if (!p) {
    const key = Object.keys(PRICING)
      .filter((k) => model.startsWith(`${k}-`))
      .sort((a, b) => b.length - a.length)[0];
    p = key ? PRICING[key] : null;
  }
  if (!p) return null;
  const today = now.toISOString().slice(0, 10);
  const change = (p.changes || []).filter((c) => c.from <= today).at(-1);
  const { changes, ...base } = p;
  return change ? { ...base, input: change.input, output: change.output } : base;
}

/** Cost in USD for one request, or null when the model has no known price. */
export function costFor(model, inputTokens, outputTokens, now) {
  const p = priceFor(model, now);
  if (!p) return null;
  const rate = p.longContext && inputTokens > p.longContext.above ? p.longContext : p;
  return (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
}
