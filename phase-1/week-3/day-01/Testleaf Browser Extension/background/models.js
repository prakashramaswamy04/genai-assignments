// Model catalog: SPEC §P2 seed list (NOT NaviCase's MODEL_CATALOG) plus the
// live list fetched with the user's key (↻). Ported from NaviCase fetchModelList.

import { KEYS, SHORT_TIMEOUT_MS } from "../shared/constants.js";
import { getJson, HttpError } from "./llm/http.js";
import { responsesOnlyModels } from "./llm/caps.js";
import { getKey, secretValues } from "./settings.js";
import { priceFor } from "./pricing.js";

// SEED is also the ALLOWLIST: only these models are ever shown. The live list (↻)
// only confirms which of them the user's key can use; anything else the provider
// offers (speech, guard/safety classifiers, small or retired models) stays hidden.
//
// Groq picks (checked against console.groq.com/docs/models on 2026-11-17). This app
// needs long structured JSON (test-case suites) and code generation (Playwright /
// Selenium) from a large prompt (recording + page snapshot):
//   openai/gpt-oss-120b  — default: best quality, 131K context, 65K output, reasoning
//   openai/gpt-oss-20b   — faster/cheaper, same limits, for small journeys
//   qwen/qwen3.8-27b     — preview; JSON mode + reasoning, 16K output cap
// Not offered: llama-3.3-70b / 3.1-8b (shut down 2026-08-16, enterprise only),
// llama-4-*, qwen3-32b, kimi-k2 (shut down), guard/safeguard, whisper, orpheus.
export const SEED = {
  groq: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"],
  openai: ["gpt-6.1-sol", "gpt-6-luna", "gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4-mini", "gpt-5.4-nano"],
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  gemini: ["gemini-4-argon"],
  inception: ["mercury-2"],
};

// SPEC §P2 exclusions (gpt-5 / -mini / -nano retire Dec 2026, incl. dated snapshots).
const EXCLUDED = [/-chat-latest$/, /-codex/, /^gpt-4/, /^o4-mini/, /^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/];
// Non-text OpenAI families (NaviCase filter).
const NON_TEXT = /(audio|realtime|tts|transcribe|image|search|embedding|instruct)/;

export const isExcluded = (id) => EXCLUDED.some((re) => re.test(id));

// Groq models that are not text chat (speech, TTS, safety classifiers, agents).
const GROQ_NON_TEXT = /(whisper|tts|playai|orpheus|guard|safeguard|distil|compound|allam)/i;

const LIVE = {
  groq: async (key, opts) => {
    const data = await getJson("https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${key}` }, "Groq", opts);
    return (data.data || []).filter((m) => m.active !== false).map((m) => m.id).filter((id) => !GROQ_NON_TEXT.test(id));
  },
  openai: async (key, opts) => {
    const data = await getJson("https://api.openai.com/v1/models", { Authorization: `Bearer ${key}` }, "OpenAI", opts);
    return (data.data || []).map((m) => m.id).filter((id) => /^(gpt-|o\d)/.test(id) && !NON_TEXT.test(id));
  },
  anthropic: async (key, opts) => {
    const data = await getJson(
      "https://api.anthropic.com/v1/models?limit=100",
      { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      "Anthropic",
      opts,
    );
    return (data.data || []).map((m) => m.id);
  },
  gemini: async (key, opts) => {
    const data = await getJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { "x-goog-api-key": key }, "Gemini", opts);
    const ids = (data.models || [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && /gemini/.test(m.name))
      .map((m) => m.name.replace(/^models\//, ""));
    // Gemini 4 only, when the account has any.
    const g4 = ids.filter((id) => /^gemini-4/.test(id));
    return g4.length ? g4 : ids;
  },
  inception: async (key, opts) => {
    const data = await getJson("https://api.inceptionlabs.ai/v1/models", { Authorization: `Bearer ${key}` }, "Inception Labs", opts);
    return (data.data || []).map((m) => m.id);
  },
};

/** Allowlisted (seed) models the live list confirms, in seed order. Nothing else is shown. */
export function mergeLive(provider, ids) {
  const live = new Set(ids.filter((id) => !isExcluded(id)));
  return SEED[provider].filter((id) => live.has(id));
}

async function fetchLive(provider) {
  const key = await getKey(provider);
  const ids = await LIVE[provider](key, { timeoutMs: SHORT_TIMEOUT_MS, secrets: await secretValues() });
  return mergeLive(provider, ids);
}

async function readCache() {
  const { [KEYS.modelCache]: cache = {} } = await chrome.storage.local.get(KEYS.modelCache);
  return cache;
}

async function writeCache(provider, models) {
  const cache = await readCache();
  await chrome.storage.local.set({ [KEYS.modelCache]: { ...cache, [provider]: { models, fetchedAt: Date.now() } } });
}

/** `fqa:models` reply. Inception is pinned to mercury-2 and never refreshed. */
export async function listModels(provider, refresh) {
  if (!SEED[provider]) throw new HttpError(400, "Unknown provider");
  let models = SEED[provider];
  let source = "seed";
  let warning;
  const cached = (await readCache())[provider];
  if (refresh && provider !== "inception") {
    try {
      const live = await fetchLive(provider);
      if (live.length) {
        await writeCache(provider, live);
        models = live;
        source = "live";
      } else {
        warning = "Your key has access to none of the supported models; showing the supported list.";
      }
    } catch (err) {
      warning = `Live model lookup failed (${err.message}); showing ${cached ? "the last list" : "defaults"}.`;
    }
  }
  if (source === "seed" && cached?.models?.length && provider !== "inception") {
    models = cached.models;
    source = "live";
  }
  const hidden = await responsesOnlyModels(provider);
  // Allowlist: drop anything outside SEED (also purges lists cached by older versions).
  models = models.filter((m) => SEED[provider].includes(m) && !hidden.has(m) && !isExcluded(m));
  if (!models.length) models = SEED[provider].filter((m) => !hidden.has(m));
  // Default: first seed model the live list confirms (or the first seed model).
  const defaultModel = SEED[provider].find((m) => models.includes(m)) || models[0] || "";
  const pricing = Object.fromEntries(models.map((m) => [m, priceFor(m)]).filter(([, p]) => p));
  return { ok: true, provider, models, source, default: defaultModel, pricing, ...(warning ? { warning } : {}) };
}

/** Cheap authenticated models-list GET; refreshes the cached list on success. */
export async function testKey(provider) {
  if (!SEED[provider]) throw new HttpError(400, "Unknown provider");
  const live = await fetchLive(provider);
  if (provider !== "inception" && live.length) await writeCache(provider, live);
  return { ok: true, count: live.length };
}
