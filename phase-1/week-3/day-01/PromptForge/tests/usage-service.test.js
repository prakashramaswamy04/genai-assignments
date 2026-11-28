import test from "node:test";
import assert from "node:assert/strict";
import { buildUsage, extractUsage } from "../services/usage-service.js";

test("usage extraction reads OpenAI-compatible and Anthropic token fields", () => {
  assert.deepEqual(extractUsage("openai-compatible", {
    usage: { prompt_tokens: 100, completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 5 } }
  }), { inputTokens: 100, outputTokens: 30, reasoningTokens: 5 });
  assert.deepEqual(extractUsage("anthropic", {
    usage: { input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 10, output_tokens: 30 }
  }), { inputTokens: 130, outputTokens: 30, reasoningTokens: 0 });
});

test("Gemini reasoning tokens count toward output usage", () => {
  assert.deepEqual(extractUsage("gemini", {
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30, thoughtsTokenCount: 5 }
  }), { inputTokens: 100, outputTokens: 35, reasoningTokens: 5 });
});

test("generation usage aggregates both requests and estimates known model cost", () => {
  const usage = buildUsage("openai-compatible", "gpt-4.1-mini", [
    { inputTokens: 200, outputTokens: 30, reasoningTokens: 0 },
    { inputTokens: 100, outputTokens: 40, reasoningTokens: 10 }
  ]);
  assert.deepEqual(usage, {
    available: true,
    inputTokens: 300,
    outputTokens: 70,
    reasoningTokens: 10,
    totalTokens: 370,
    cost: 0.000232,
    requestCount: 2
  });
});

test("unreported usage and unknown model prices remain explicitly unavailable", () => {
  assert.equal(buildUsage("openai-compatible", "gpt-4.1-mini", [null]).available, false);
  const usage = buildUsage("openai-compatible", "custom-model", [
    { inputTokens: 10, outputTokens: 5, reasoningTokens: 0 }
  ]);
  assert.equal(usage.available, true);
  assert.equal(usage.totalTokens, 15);
  assert.equal(usage.cost, null);
});
