// Inception Labs exposes an OpenAI-compatible chat completions API
// (NaviCase callModel "inception"). Pinned to mercury-2 by resolveModelOptions.

import { postJson } from "../http.js";

export const ENDPOINT = "https://api.inceptionlabs.ai/v1/chat/completions";

export function buildRequest({ model, system, user }, { apiKey, limits }) {
  return {
    url: ENDPOINT,
    headers: { Authorization: `Bearer ${apiKey}` },
    body: {
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: limits.maxTokens,
    },
  };
}

export async function call(opts, ctx) {
  const { url, headers, body } = buildRequest(opts, ctx);
  const data = await postJson(url, headers, body, "Inception Labs", { timeoutMs: ctx.limits.timeoutMs, secrets: ctx.secrets });
  const choice = data?.choices?.[0];
  return {
    text: choice?.message?.content ?? "",
    truncated: choice?.finish_reason === "length",
    inputTokens: data?.usage?.prompt_tokens ?? 0,
    outputTokens: data?.usage?.completion_tokens ?? 0,
    reasoningTokens: 0,
  };
}
