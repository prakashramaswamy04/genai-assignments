import { DEFAULT_SETTINGS, PROVIDERS, LIMITS } from "../utils/constants.js";
import { safeJsonParse } from "../utils/helpers.js";
import { validateSettings } from "../utils/validators.js";
import { extractUsage } from "./usage-service.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function getOriginPattern(endpoint) {
  const url = new URL(endpoint);
  const host = url.hostname.includes(":") ? `[${url.hostname}]` : url.hostname;
  return `${url.protocol}//${host}/*`;
}

export async function ensureEndpointPermission(endpoint) {
  if (!globalThis.chrome?.permissions) return true; // Allows service-level tests outside Chrome.
  const pattern = getOriginPattern(endpoint);
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    throw new Error("Remote AI endpoints must use HTTPS.");
  }
  // Call permissions.request immediately from the initiating button handler so
  // Chrome can associate a first-time host grant with the user's gesture.
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) throw new Error(`Host access was not granted for ${url.origin}. You can enable it in the extension's site access settings.`);
  return true;
}

function redactSecret(message, secret) {
  const text = String(message || "Unknown API error");
  return secret ? text.split(secret).join("[REDACTED]") : text;
}

function buildOpenAIBody({ provider, model, messages, maxTokens, temperature }) {
  const body = {
    model,
    messages,
    temperature,
    response_format: { type: "json_object" }
  };
  body[provider === "groq" ? "max_tokens" : "max_completion_tokens"] = maxTokens;
  return body;
}

function buildAnthropicBody({ model, messages, maxTokens, temperature }) {
  const system = messages.filter((item) => item.role === "system").map((item) => item.content).join("\n\n");
  const userMessages = messages.filter((item) => item.role !== "system");
  return {
    model,
    system,
    messages: userMessages,
    max_tokens: maxTokens,
    temperature
  };
}

function buildGeminiBody({ messages, maxTokens, temperature }) {
  const systemInstruction = messages.filter((item) => item.role === "system").map((item) => item.content).join("\n\n");
  const contents = messages.filter((item) => item.role !== "system").map((item) => ({
    role: item.role === "assistant" ? "model" : "user",
    parts: [{ text: item.content }]
  }));
  return {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json"
    }
  };
}

function extractProviderText(provider, payload) {
  if (provider === "anthropic") {
    return (payload?.content || []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
  }
  if (provider === "gemini") {
    return (payload?.candidates?.[0]?.content?.parts || []).map((item) => item.text || "").join("\n");
  }
  return payload?.choices?.[0]?.message?.content ?? payload?.output_text ?? "";
}

export class AIService {
  constructor(settings, apiKey) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.apiKey = String(apiKey || "").trim();
    const validation = validateSettings(this.settings);
    if (!validation.valid) throw new Error(validation.errors.join(" "));
    if (!this.apiKey) throw new Error("Add an API key in Settings before generating a prompt.");
  }

  async #complete(messages, { json = true } = {}) {
    const provider = PROVIDERS[this.settings.provider];
    const timeoutMs = Math.min(LIMITS.maxTimeoutMs, Math.max(LIMITS.minTimeoutMs, Number(this.settings.timeoutMs)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let endpoint = this.settings.endpoint;
    const headers = { "Content-Type": "application/json" };
    let body;

    if (provider.format === "openai") {
      headers.Authorization = `Bearer ${this.apiKey}`;
      body = buildOpenAIBody({ ...this.settings, provider: this.settings.provider, messages });
      if (!json) delete body.response_format;
    } else if (provider.format === "anthropic") {
      headers["x-api-key"] = this.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
      body = buildAnthropicBody({ ...this.settings, messages });
    } else {
      endpoint = endpoint.replaceAll("{model}", encodeURIComponent(this.settings.model));
      headers["x-goog-api-key"] = this.apiKey;
      body = buildGeminiBody({ ...this.settings, messages });
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: "error",
        credentials: "omit",
        cache: "no-store"
      });
      const raw = await response.text();
      let payload;
      try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { rawText: raw.slice(0, 1000) }; }
      if (!response.ok) {
        const detail = payload?.error?.message || payload?.message || payload?.rawText || `HTTP ${response.status}`;
        throw new Error(redactSecret(`AI provider request failed (${response.status}): ${detail}`, this.apiKey));
      }
      const text = extractProviderText(this.settings.provider, payload);
      if (!text.trim()) throw new Error("The AI provider returned an empty response. Check the selected model and provider endpoint.");
      return {
        result: json ? safeJsonParse(text) : text,
        usage: extractUsage(this.settings.provider, payload)
      };
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`The AI request exceeded the ${Math.round(timeoutMs / 1000)}-second timeout.`);
      if (error instanceof TypeError && /fetch/i.test(error.message)) {
        throw new Error("Could not reach the AI endpoint. Check the URL, internet connection, and granted site access.");
      }
      throw new Error(redactSecret(error?.message || "AI request failed.", this.apiKey));
    } finally {
      clearTimeout(timer);
    }
  }

  async complete(messages, options = {}) {
    return (await this.#complete(messages, options)).result;
  }

  async completeWithUsage(messages, options = {}) {
    return this.#complete(messages, options);
  }

  async testConnection() {
    const providerName = PROVIDERS[this.settings.provider].label;
    const response = await this.complete([
      { role: "system", content: "Return only valid JSON with a single property: {\"status\":\"ok\"}." },
      { role: "user", content: "Test the connection. Return {\"status\":\"ok\"}." }
    ]);
    if (response?.status !== "ok") throw new Error("The endpoint responded, but the connection test returned an unexpected response.");
    return `${providerName} connection successful for model ${this.settings.model}.`;
  }
}
