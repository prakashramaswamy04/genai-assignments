// Shared by the service worker and the side panel. The content script is a
// classic script and keeps its own copies of the names it needs.

export const MSG = {
  event: "fqa:event",
  start: "fqa:start",
  stop: "fqa:stop",
  clear: "fqa:clear",
  snapshot: "fqa:snapshot",
  status: "fqa:status",
  models: "fqa:models",
  testKey: "fqa:testKey",
  setKey: "fqa:setKey",
  clearKeys: "fqa:clearKeys",
  setRemember: "fqa:setRemember",
};

export const KEYS = {
  settings: "fqaSettings",
  keys: "fqaKeys",
  recording: "fqaRecording",
  events: "fqaEvents",
  results: "fqaResults",
  context: "fqaContext",
  modelCache: "fqaModelCache",
  modelCaps: "fqaModelCaps",
  job: "fqaJob",
};

// Groq is the primary provider and listed first; the rest stay available.
export const PROVIDERS = ["groq", "openai", "anthropic", "gemini", "inception"];
export const PRIMARY_PROVIDER = "groq";
export const PROVIDER_LABELS = { groq: "Groq", openai: "OpenAI", anthropic: "Anthropic", gemini: "Gemini", inception: "Inception Labs" };
/** Where each provider issues API keys (shown in Settings). */
export const PROVIDER_KEY_URLS = {
  groq: "https://console.groq.com/keys",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://platform.claude.com/settings/keys",
  gemini: "https://aistudio.google.com/apikey",
  inception: "https://platform.inceptionlabs.ai/",
};

export const APP_NAME = "Ledge-3.0";

/** Request limits (SPEC §P2 Advanced). The 5-minute MV3 task cap bounds the timeout. */
export const ADVANCED_DEFAULTS = { timeoutMs: 280_000, maxTokens: 16_000, reasoningMaxTokens: 32_000 };
export const ADVANCED_RANGE = {
  timeoutMs: [10_000, 280_000],
  maxTokens: [256, 128_000],
  reasoningMaxTokens: [1_024, 128_000],
};
/** Model-list lookups and key tests. */
export const SHORT_TIMEOUT_MS = 15_000;

/** Long-running jobs (generate, automate) run over this port; the panel pings to keep the SW alive. */
export const JOB_PORT = "fqa:job";
export const JOB_PING_MS = 20_000;

export const COVERAGE_TYPES = ["Functional", "Negative", "Boundary", "Validation", "Accessibility", "Security", "Compatibility", "Exploratory", "Edge Case", "UI", "Usability"];
export const PRIORITIES = ["Critical", "High", "Medium", "Low"];
export const LANGUAGES = ["US English", "UK English", "Spanish", "French", "German", "Portuguese (Brazil)", "Hindi", "Japanese"];

/** Settings the panel stores in fqaSettings. */
export const SETTINGS_DEFAULTS = {
  maskValues: false,
  provider: "groq",
  model: "",
  temperature: 0.3,
  reasoningEffort: "medium",
  rememberKeys: true,
  advanced: ADVANCED_DEFAULTS,
  language: "US English",
  maxCases: 15,
  coverage: ["Functional", "Negative", "Boundary"],
  priorities: ["Critical", "High", "Medium"],
  promptMode: "default",
  customPrompt: "",
  automationFramework: "playwright",
  automationMode: "ai",
  automationLanguage: { playwright: "TypeScript", selenium: "Java" },
  // The last reference script per framework.
  referenceScripts: { playwright: "", selenium: "" },
};

/** Recorded events kept in storage (SPEC §P1). Generation also sends at most this many. */
export const MAX_EVENTS = 1_000;
export const MAX_RECORDING_BYTES = 1_048_576;
export const MAX_SCRIPT_BYTES = 512_000;
export const MAX_REFERENCE_BYTES = 256_000;
export const MAX_SNAPSHOT_BYTES = 184_320;
export const MAX_SNAPSHOT_NODES = 250;
/** Iframe snapshots nested under the top page. */
export const MAX_FRAME_SNAPSHOTS = 10;
