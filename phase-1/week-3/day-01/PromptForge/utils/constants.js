export const APP_NAME = "PromptForge";
export const APP_VERSION = "1.1.0";
export const STORAGE_KEYS = Object.freeze({
  prompts: "promptforge.prompts",
  settings: "promptforge.settings",
  schemaVersion: "promptforge.schemaVersion"
});
export const LIMITS = Object.freeze({
  inputCharacters: 50000,
  outputCharacters: 100000,
  historyItems: 100,
  versionsPerPrompt: 30,
  historyBytes: 4 * 1024 * 1024,
  requestTimeoutMs: 120000,
  minTimeoutMs: 10000,
  maxTimeoutMs: 240000,
  defaultMaxTokens: 10000,
  minMaxTokens: 1000,
  maxMaxTokens: 32000
});
export const ICEPOT_SECTIONS = Object.freeze([
  { key: "instruction", title: "Instruction", number: 1 },
  { key: "context", title: "Context", number: 2 },
  { key: "examples", title: "Examples", number: 3 },
  { key: "persona", title: "Persona", number: 4 },
  { key: "outputFormat", title: "Output Format", number: 5 },
  { key: "tone", title: "Tone", number: 6 }
]);
export const DEFAULT_SETTINGS = Object.freeze({
  provider: "openai-compatible",
  endpoint: "https://api.openai.com/v1/chat/completions",
  model: "gpt-4.1-mini",
  timeoutMs: LIMITS.requestTimeoutMs,
  maxTokens: LIMITS.defaultMaxTokens,
  credentialStorage: "local",
  temperature: 0.2
});
export const PROVIDERS = Object.freeze({
  "openai-compatible": {
    label: "OpenAI-compatible API",
    endpoint: "https://api.openai.com/v1/chat/completions",
    auth: "bearer",
    format: "openai"
  },
  groq: {
    label: "Groq API",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    auth: "bearer",
    format: "openai"
  },
  anthropic: {
    label: "Anthropic Messages API",
    endpoint: "https://api.anthropic.com/v1/messages",
    auth: "anthropic",
    format: "anthropic"
  },
  gemini: {
    label: "Google Gemini API",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    auth: "x-goog-api-key",
    format: "gemini"
  }
});
