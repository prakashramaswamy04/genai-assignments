// Anthropic Messages API, ported from NaviCase callModel "anthropic".
// Direct calls from an extension need anthropic-dangerous-direct-browser-access.

import { postJson, HttpError } from "../http.js";

export const ENDPOINT = "https://api.anthropic.com/v1/messages";

export function buildRequest({ model, temperature, system, user }, { apiKey, limits }) {
  // max_tokens is always set and kept high so long suites and scripts are not
  // cut off. Current Claude models think adaptively within this budget and
  // reject `temperature`, so it is only forwarded to legacy claude-3* models.
  const body = {
    model,
    max_tokens: limits.maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  };
  if (/^claude-3/.test(model)) body.temperature = Math.min(1, temperature);

  const headers = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  // Server-side refusal fallback for models that support it.
  if (/^claude-(opus-5|sonnet-5-5)/.test(model)) {
    headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
    body.fallbacks = "default";
  }
  return { url: ENDPOINT, headers, body };
}

export async function call(opts, ctx) {
  const { url, headers, body } = buildRequest(opts, ctx);
  const data = await postJson(url, headers, body, "Anthropic", { timeoutMs: ctx.limits.timeoutMs, secrets: ctx.secrets });
  if (data?.stop_reason === "refusal") {
    throw new HttpError(422, "Claude declined this request. Try rephrasing the custom prompt or reference script.");
  }
  const u = data?.usage ?? {};
  return {
    text: (data?.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join(""),
    truncated: data?.stop_reason === "max_tokens",
    inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    outputTokens: u.output_tokens ?? 0,
    reasoningTokens: 0,
  };
}
