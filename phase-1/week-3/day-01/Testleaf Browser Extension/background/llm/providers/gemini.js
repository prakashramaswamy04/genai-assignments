// Gemini generateContent, ported from NaviCase callModel "gemini".
// The key travels in the x-goog-api-key header, never in the query string.

import { postJson, HttpError } from "../http.js";

export const endpoint = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

export function buildRequest({ model, temperature, system, user, json }, { apiKey, limits }) {
  const generationConfig = { temperature, maxOutputTokens: limits.maxTokens };
  if (json) generationConfig.responseMimeType = "application/json";
  return {
    url: endpoint(model),
    headers: { "x-goog-api-key": apiKey },
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig,
    },
  };
}

export async function call(opts, ctx) {
  const { url, headers, body } = buildRequest(opts, ctx);
  const data = await postJson(url, headers, body, "Gemini", { timeoutMs: ctx.limits.timeoutMs, secrets: ctx.secrets });
  const candidate = data?.candidates?.[0];
  if (!candidate) {
    throw new HttpError(422, `Gemini returned no candidates${data?.promptFeedback?.blockReason ? ` (${data.promptFeedback.blockReason})` : ""}`);
  }
  const meta = data?.usageMetadata ?? {};
  const reasoningTokens = meta.thoughtsTokenCount ?? 0;
  return {
    text: (candidate.content?.parts ?? []).filter((p) => !p.thought && p.text).map((p) => p.text).join(""),
    truncated: candidate.finishReason === "MAX_TOKENS",
    inputTokens: meta.promptTokenCount ?? 0,
    outputTokens: (meta.candidatesTokenCount ?? 0) + reasoningTokens,
    reasoningTokens,
  };
}
