// OpenAI — Chat Completions ONLY. Ledge-3.0 never calls /v1/responses.
// Ported from NaviCase callModel "openai" (RE-NOTES §4) plus the SPEC §P2
// unsupported-parameter retry and Responses-only detection.

import { postJson, HttpError } from "../http.js";
import { getCaps, markCaps } from "../caps.js";

export const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const LABEL = "OpenAI";

// gpt-5*, gpt-6* and o-series are reasoning models: they reject
// `temperature`, so it is stripped and `reasoning_effort` is sent instead.
// The legacy o1-preview / o1-mini snapshots also reject `reasoning_effort`
// and system/developer messages.
export const isReasoning = (model) => /^(o\d|gpt-5|gpt-6)/i.test(model);
const isLegacyO1 = (model) => /^o1-(preview|mini)/i.test(model);

export function buildRequest({ model, temperature, reasoningEffort, system, user, json }, { apiKey, limits, caps = {} }) {
  const body = { model };
  if (isReasoning(model)) {
    const legacy = isLegacyO1(model);
    body.messages = legacy
      ? [{ role: "user", content: `${system}\n\n${user}` }]
      : [{ role: "developer", content: system }, { role: "user", content: user }];
    if (!legacy && !caps.noReasoningEffort) body.reasoning_effort = reasoningEffort;
    body.max_completion_tokens = limits.reasoningMaxTokens;
  } else {
    body.messages = [{ role: "system", content: system }, { role: "user", content: user }];
    if (!caps.noTemperature) body.temperature = temperature;
    body.max_completion_tokens = limits.maxTokens;
    if (json) body.response_format = { type: "json_object" };
  }
  return { url: ENDPOINT, headers: { Authorization: `Bearer ${apiKey}` }, body };
}

/** "temperature" / "reasoning_effort" when a 400 says that parameter is unsupported. */
export function unsupportedParam(err) {
  const u = err?.upstream;
  if (!u || u.status !== 400) return null;
  for (const param of ["temperature", "reasoning_effort"]) {
    if (u.param === param) return param;
    if (u.message.includes(param) && /unsupported|not supported|does not support|only the default/i.test(u.message)) return param;
  }
  return null;
}

/** The model only works on the Responses API. */
export function isResponsesOnly(err) {
  const m = err?.upstream?.message || "";
  return /v1\/responses|responses api/i.test(m) && /only|not supported|unsupported/i.test(m);
}

export async function call(opts, ctx) {
  const { model } = opts;
  let caps = await getCaps("openai", model);
  let retried = false;
  for (;;) {
    const { url, headers, body } = buildRequest(opts, { ...ctx, caps });
    let data;
    try {
      data = await postJson(url, headers, body, LABEL, { timeoutMs: ctx.limits.timeoutMs, secrets: ctx.secrets });
    } catch (err) {
      if (isResponsesOnly(err)) {
        await markCaps("openai", model, { responsesOnly: true });
        throw new HttpError(400, `${model}: Not supported (Responses-only). Ledge-3.0 uses Chat Completions; pick another model.`, err.upstream);
      }
      const param = !retried && unsupportedParam(err);
      if (param && param in body) {
        const patch = param === "temperature" ? { noTemperature: true } : { noReasoningEffort: true };
        await markCaps("openai", model, patch);
        caps = { ...caps, ...patch };
        retried = true;
        continue;
      }
      throw err;
    }
    const choice = data?.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      truncated: choice?.finish_reason === "length",
      inputTokens: data?.usage?.prompt_tokens ?? 0,
      outputTokens: data?.usage?.completion_tokens ?? 0,
      reasoningTokens: data?.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
    };
  }
}
