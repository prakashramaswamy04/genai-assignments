import test from "node:test";
import assert from "node:assert/strict";
import { StorageService } from "../services/storage-service.js";
import { DEFAULT_SETTINGS } from "../utils/constants.js";

function makeArea() {
  const values = new Map();
  return {
    async get(keys) {
      if (keys === undefined) return Object.fromEntries(values);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => values.has(key)).map((key) => [key, values.get(key)]));
    },
    async set(entries) { for (const [key, value] of Object.entries(entries)) values.set(key, value); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key); }
  };
}

const originalChrome = globalThis.chrome;
function installChromeMock() {
  globalThis.chrome = { storage: { local: makeArea(), session: makeArea() } };
}
function restoreChrome() {
  if (originalChrome === undefined) delete globalThis.chrome;
  else globalThis.chrome = originalChrome;
}

test("API key is saved to local storage and survives saveSettings", async () => {
  installChromeMock();
  try {
    const storage = new StorageService();
    await storage.saveSettings({ ...DEFAULT_SETTINGS }, "local-test-key");
    assert.equal(await storage.getApiKey(), "local-test-key");
    assert.equal(await storage.hasApiKey(), true);
  } finally { restoreChrome(); }
});

test("credential preference changes migrate keys without deleting the new copy", async () => {
  installChromeMock();
  try {
    const storage = new StorageService();
    await storage.saveSettings({ ...DEFAULT_SETTINGS }, "migrate-me");
    await storage.saveSettings({ ...DEFAULT_SETTINGS, credentialStorage: "session" });
    assert.equal(await storage.getApiKey(), "migrate-me");
    assert.deepEqual(await globalThis.chrome.storage.local.get("promptforge.apiKey"), {});
    assert.deepEqual(await globalThis.chrome.storage.session.get("promptforge.apiKey"), { "promptforge.apiKey": "migrate-me" });
    await storage.saveSettings({ ...DEFAULT_SETTINGS, credentialStorage: "local" });
    assert.equal(await storage.getApiKey(), "migrate-me");
    assert.deepEqual(await globalThis.chrome.storage.session.get("promptforge.apiKey"), {});
  } finally { restoreChrome(); }
});

test("prompt history stores generations and appends versions without overwriting", async () => {
  installChromeMock();
  try {
    const storage = new StorageService();
    const sections = {
      instruction: "Do the task.", context: "Use the supplied context.", examples: "Use grounded examples.",
      persona: "Senior engineer.", outputFormat: "Return code.", tone: "Precise."
    };
    const record = await storage.createPrompt({
      originalInput: "Build a small tool.", inputType: "rough_idea", analysis: { mainObjective: "Build a small tool" },
      sections, markdown: "## 1. Instruction\n\nDo the task.", quality: { overall: 75 },
      usage: { available: true, inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0.001, requestCount: 2 },
      settings: DEFAULT_SETTINGS
    });
    assert.equal(record.versions[0].usage.totalTokens, 150);
    const second = await storage.appendVersion(record.id, {
      sections: { ...sections, tone: "Concise and technical." },
      markdown: "## 1. Instruction\n\nDo the task.\n\n## 2. Context\n\nUse the supplied context.",
      quality: { overall: 82 },
      usage: { available: true, inputTokens: 120, outputTokens: 60, totalTokens: 180, cost: 0.002, requestCount: 2 },
      settings: DEFAULT_SETTINGS, refinementInstruction: "Tighten the tone."
    });
    assert.equal(second.versions.length, 2);
    assert.equal(second.versions[0].versionNumber, 1);
    assert.equal(second.versions[1].versionNumber, 2);
    assert.equal(second.versions[0].usage.totalTokens, 150);
    assert.equal(second.versions[1].usage.totalTokens, 180);
    assert.equal((await storage.getPrompt(record.id)).inputType, "rough_idea");
    assert.equal((await storage.listPrompts("small tool")).length, 1);
    await storage.renamePrompt(record.id, "Renamed prompt");
    assert.equal((await storage.getPrompt(record.id)).title, "Renamed prompt");
    assert.equal(await storage.deletePrompt(record.id), true);
    assert.equal(await storage.getPrompt(record.id), null);
  } finally { restoreChrome(); }
});

test("history is pruned within the configured local-storage budget", async () => {
  installChromeMock();
  try {
    const storage = new StorageService();
    const common = { context: "ctx", examples: "ex", persona: "persona", outputFormat: "out", tone: "tone" };
    for (let index = 0; index < 12; index += 1) {
      const largeText = `PROMPT-${index} ` + "x".repeat(230000);
      const sections = { instruction: largeText, ...common };
      await storage.createPrompt({
        originalInput: `Source ${index} ` + "r".repeat(30000),
        analysis: { mainObjective: `Large prompt ${index}` },
        sections,
        markdown: `## 1. Instruction\\n\\n${largeText}`,
        quality: { overall: 80 },
        settings: DEFAULT_SETTINGS
      });
    }
    const stored = await globalThis.chrome.storage.local.get("promptforge.prompts");
    const serializedBytes = JSON.stringify(stored["promptforge.prompts"]).length * 2;
    assert.ok(serializedBytes <= 4 * 1024 * 1024);
    assert.ok(stored["promptforge.prompts"].length < 12);
    assert.ok(stored["promptforge.prompts"].every((record) => record.versions.length >= 1));
  } finally { restoreChrome(); }
});
