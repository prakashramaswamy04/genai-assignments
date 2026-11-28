import test from "node:test";
import assert from "node:assert/strict";
import { AIService, getOriginPattern } from "../services/ai-service.js";
import { DEFAULT_SETTINGS } from "../utils/constants.js";

const originalFetch = globalThis.fetch;

test("origin permission pattern is scoped to endpoint origin", () => {
  assert.equal(getOriginPattern("https://api.example.com/v1/chat/completions"), "https://api.example.com/*");
  assert.equal(getOriginPattern("http://localhost:3000/api"), "http://localhost/*");
});

test("OpenAI-compatible adapter sends JSON request and parses model JSON", async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ status: "ok" }) } }] }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const service = new AIService({ ...DEFAULT_SETTINGS }, "test-key");
    const result = await service.complete([{ role: "user", content: "Return JSON" }]);
    assert.deepEqual(result, { status: "ok" });
    assert.match(request.url, /chat\/completions$/);
    assert.equal(request.options.headers.Authorization, "Bearer test-key");
    assert.equal(JSON.parse(request.options.body).response_format.type, "json_object");
    assert.equal(JSON.parse(request.options.body).max_completion_tokens, DEFAULT_SETTINGS.maxTokens);
    assert.equal(JSON.parse(request.options.body).max_tokens, undefined);
    assert.equal(request.options.credentials, "omit");
    assert.equal(request.options.redirect, "error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Groq adapter uses bearer auth and max_tokens", async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ status: "ok" }) } }] }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const settings = {
      ...DEFAULT_SETTINGS,
      provider: "groq",
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      model: "llama-3.3-70b-versatile"
    };
    const service = new AIService(settings, "groq-secret");
    const result = await service.complete([{ role: "user", content: "Return JSON" }]);
    const body = JSON.parse(request.options.body);
    assert.deepEqual(result, { status: "ok" });
    assert.equal(request.url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(request.options.headers.Authorization, "Bearer groq-secret");
    assert.equal(body.model, "llama-3.3-70b-versatile");
    assert.equal(body.max_tokens, DEFAULT_SETTINGS.maxTokens);
    assert.equal(body.max_completion_tokens, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider error messages redact API credentials", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "bad key test-secret" } }), { status: 401 });
  try {
    const service = new AIService({ ...DEFAULT_SETTINGS }, "test-secret");
    await assert.rejects(service.complete([{ role: "user", content: "hi" }]), (error) => {
      assert.match(error.message, /\[REDACTED\]/);
      assert.doesNotMatch(error.message, /test-secret/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gemini adapter puts its API key in the x-goog-api-key header, not the URL", async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{\"status\":\"ok\"}" }] } }] }), { status: 200 });
  };
  try {
    const settings = {
      ...DEFAULT_SETTINGS,
      provider: "gemini",
      endpoint: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
      model: "gemini-test"
    };
    const service = new AIService(settings, "gemini-secret");
    const result = await service.complete([{ role: "user", content: "Return JSON" }]);
    assert.deepEqual(result, { status: "ok" });
    assert.match(request.url, /models\/gemini-test:generateContent$/);
    assert.doesNotMatch(request.url, /gemini-secret/);
    assert.equal(request.options.headers["x-goog-api-key"], "gemini-secret");
  } finally { globalThis.fetch = originalFetch; }
});
