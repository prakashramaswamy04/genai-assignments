// Groq — OpenAI-compatible Chat Completions (https://console.groq.com/docs/api-reference).
// JSON mode is requested when asked; if the model's output fails Groq's own JSON
// validation (400 json_validate_failed) the call is retried once without it and
// the app's JSON repair takes over.

import { postJson, HttpError } from "../http.js";

export const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const LABEL = "Groq";

// Groq's gpt-oss models accept `reasoning_effort` (low/medium/high).
export const isReasoning = (model) => /^openai\/gpt-oss/i.test(model);

/** Max completion tokens Groq allows per model (console.groq.com/docs/models). */
const MAX_OUTPUT = { "openai/gpt-oss-120b": 65_536, "openai/gpt-oss-20b": 65_536, "qwen/qwen3.8-27b": 16_384 };
const capOutput = (model, n) => Math.min(n, MAX_OUTPUT[model] ?? n);

/** Qwen thinking mode can put <think>…</think> before the answer; keep only the answer. */
const stripThinking = (text) => String(text ?? "").replace(/<think>[\s\S]*?<\/think>\s*/gi, "");

export function buildRequest({ model, temperature, reasoningEffort, system, user, json }, { apiKey, limits }, { noJson = false } = {}) {
  const body = {
    model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: Math.min(2, Math.max(0, temperature)),
    max_completion_tokens: capOutput(model, isReasoning(model) ? limits.reasoningMaxTokens : limits.maxTokens),
  };
  if (isReasoning(model)) body.reasoning_effort = reasoningEffort;
  if (json && !noJson) body.response_format = { type: "json_object" };
  return { url: ENDPOINT, headers: { Authorization: `Bearer ${apiKey}` }, body };
}

const jsonFailed = (err) =>
  err instanceof HttpError && err.upstream?.status === 400 && /json_validate_failed|failed to generate json|response_format/i.test(`${err.upstream.code} ${err.upstream.message}`);

export async function call(opts, ctx) {
  let noJson = false;
  for (;;) {
    const { url, headers, body } = buildRequest(opts, ctx, { noJson });
    let data;
    try {
      data = await postJson(url, headers, body, LABEL, { timeoutMs: ctx.limits.timeoutMs, secrets: ctx.secrets });
    } catch (err) {
      if (!noJson && body.response_format && jsonFailed(err)) {
        noJson = true;
        continue;
      }
      throw err;
    }
    const choice = data?.choices?.[0];
    return {
      text: stripThinking(choice?.message?.content),
      truncated: choice?.finish_reason === "length",
      inputTokens: data?.usage?.prompt_tokens ?? 0,
      outputTokens: data?.usage?.completion_tokens ?? 0,
      reasoningTokens: data?.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    };
  }
}
