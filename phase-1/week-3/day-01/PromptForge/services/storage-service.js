import { DEFAULT_SETTINGS, LIMITS, PROVIDERS, STORAGE_KEYS } from "../utils/constants.js";
import { createId } from "../utils/helpers.js";
import { parseIcepotMarkdown, renderIcepotMarkdown } from "./quality-service.js";
import { validateIcepotSections } from "../utils/validators.js";

function storageArea(name) {
  const area = globalThis.chrome?.storage?.[name];
  if (!area) throw new Error(`Chrome storage area "${name}" is unavailable.`);
  return area;
}

function compactTitle(input, objective = "") {
  const candidate = String(objective || input || "Untitled prompt").replace(/\s+/g, " ").trim();
  return candidate.slice(0, 72) || "Untitled prompt";
}

async function persistPromptHistory(prompts) {
  const next = [...prompts];
  const estimateBytes = () => JSON.stringify(next).length * 2;
  while (next.length && estimateBytes() > LIMITS.historyBytes) {
    // Preserve the newest version of each prompt; prune old versions from the
    // oldest records first, then discard the oldest record only when needed.
    let recordToTrim = null;
    for (let index = next.length - 1; index >= 0; index -= 1) {
      if (Array.isArray(next[index].versions) && next[index].versions.length > 1) {
        recordToTrim = next[index];
        break;
      }
    }
    if (recordToTrim) recordToTrim.versions = recordToTrim.versions.slice(1);
    else next.pop();
  }
  await storageArea("local").set({ [STORAGE_KEYS.prompts]: next });
  return next;
}

export class StorageService {
  async getSettings() {
    const result = await storageArea("local").get(STORAGE_KEYS.settings);
    const settings = { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.settings] || {}) };
    if (!PROVIDERS[settings.provider]) {
      return { ...settings, provider: DEFAULT_SETTINGS.provider, endpoint: DEFAULT_SETTINGS.endpoint };
    }
    return settings;
  }

  async saveSettings(nextSettings, apiKey = "") {
    const current = await this.getSettings();
    const settings = { ...current, ...nextSettings };
    const key = String(apiKey || "").trim();
    const keyName = "promptforge.apiKey";
    const oldAreaName = current.credentialStorage === "session" ? "session" : "local";
    const newAreaName = settings.credentialStorage === "session" ? "session" : "local";
    const local = storageArea("local");
    const session = globalThis.chrome.storage.session;

    if (newAreaName === "session" && !session) throw new Error("Session-only credential storage is not supported by this Chrome version.");
    if (key) {
      await storageArea(newAreaName).set({ [keyName]: key });
      if (newAreaName !== "local") await local.remove(keyName);
      if (session && newAreaName !== "session") await session.remove(keyName);
    } else if (oldAreaName !== newAreaName) {
      const oldStorage = storageArea(oldAreaName);
      const existing = await oldStorage.get(keyName);
      if (existing[keyName]) {
        if (newAreaName === "session" && !session) throw new Error("Session-only credential storage is not supported by this Chrome version.");
        await storageArea(newAreaName).set({ [keyName]: existing[keyName] });
      }
      await oldStorage.remove(keyName);
    }

    await local.set({ [STORAGE_KEYS.settings]: settings });
    return settings;
  }

  async getApiKey() {
    const settings = await this.getSettings();
    const areaName = settings.credentialStorage === "session" ? "session" : "local";
    const area = globalThis.chrome.storage[areaName];
    if (!area) return "";
    const result = await area.get("promptforge.apiKey");
    return result["promptforge.apiKey"] || "";
  }

  async clearApiKey() {
    await storageArea("local").remove("promptforge.apiKey");
    if (globalThis.chrome.storage.session) await globalThis.chrome.storage.session.remove("promptforge.apiKey");
  }

  async hasApiKey() {
    return Boolean(await this.getApiKey());
  }

  async listPrompts(query = "") {
    const result = await storageArea("local").get(STORAGE_KEYS.prompts);
    const prompts = Array.isArray(result[STORAGE_KEYS.prompts]) ? result[STORAGE_KEYS.prompts] : [];
    const normalized = String(query).trim().toLowerCase();
    const filtered = normalized ? prompts.filter((item) =>
      `${item.title || ""} ${item.originalInput || ""} ${item.versions?.[item.versions.length - 1]?.markdown || ""}`.toLowerCase().includes(normalized)
    ) : prompts;
    return filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async getPrompt(promptId) {
    const prompts = await this.listPrompts();
    return prompts.find((item) => item.id === promptId) || null;
  }

  async createPrompt({ originalInput, inputType = "auto", analysis, markdown, sections, quality, usage, settings }) {
    const validation = validateIcepotSections(sections);
    if (!validation.valid) throw new Error(validation.errors.join(" "));
    const now = new Date().toISOString();
    const version = this.#makeVersion({ markdown, sections, quality, usage, settings, versionNumber: 1 });
    const record = {
      id: createId(),
      title: compactTitle(originalInput, analysis?.mainObjective),
      originalInput,
      inputType,
      analysis: analysis || {},
      createdAt: now,
      updatedAt: now,
      versions: [version]
    };
    const prompts = await this.listPrompts();
    prompts.unshift(record);
    await persistPromptHistory(prompts.slice(0, LIMITS.historyItems));
    return record;
  }

  async appendVersion(promptId, { markdown, sections, quality, usage, settings, refinementInstruction = "", title }) {
    const prompts = await this.listPrompts();
    const index = prompts.findIndex((item) => item.id === promptId);
    if (index < 0) throw new Error("This prompt is no longer in history. Refresh the history list and try again.");
    const validation = validateIcepotSections(sections);
    if (!validation.valid) throw new Error(validation.errors.join(" "));
    const record = prompts[index];
    const versionNumber = (record.versions?.at(-1)?.versionNumber || 0) + 1;
    record.versions = [...(record.versions || []), this.#makeVersion({ markdown, sections, quality, usage, settings, versionNumber, refinementInstruction })].slice(-LIMITS.versionsPerPrompt);
    if (title?.trim()) record.title = String(title).trim().slice(0, 100);
    record.updatedAt = new Date().toISOString();
    prompts[index] = record;
    await persistPromptHistory(prompts);
    return record;
  }

  async saveEditedMarkdown(promptId, markdown, settings, qualityOverride) {
    const sections = parseIcepotMarkdown(markdown);
    const validation = validateIcepotSections(sections);
    if (!validation.valid) throw new Error(`Keep all six ICEPOT headings when editing. ${validation.errors.join(" ")}`);
    const prompt = await this.getPrompt(promptId);
    if (!prompt) throw new Error("Prompt not found in history.");
    return this.appendVersion(promptId, {
      markdown: renderIcepotMarkdown(sections),
      sections,
      quality: qualityOverride || prompt.versions.at(-1)?.quality || {},
      settings,
      refinementInstruction: "Manual edit saved"
    });
  }

  async renamePrompt(promptId, title) {
    const prompts = await this.listPrompts();
    const record = prompts.find((item) => item.id === promptId);
    if (!record) throw new Error("Prompt not found in history.");
    const normalized = String(title || "").trim();
    if (!normalized) throw new Error("Enter a prompt name.");
    record.title = normalized.slice(0, 100);
    record.updatedAt = new Date().toISOString();
    await persistPromptHistory(prompts);
    return record;
  }

  async deletePrompt(promptId) {
    const prompts = await this.listPrompts();
    const next = prompts.filter((item) => item.id !== promptId);
    await persistPromptHistory(next);
    return next.length !== prompts.length;
  }

  async clearHistory() {
    await storageArea("local").set({ [STORAGE_KEYS.prompts]: [] });
  }

  async updateAnalysis(promptId, analysis) {
    const prompts = await this.listPrompts();
    const record = prompts.find((item) => item.id === promptId);
    if (!record) throw new Error("Prompt not found in history.");
    record.analysis = analysis || {};
    record.updatedAt = new Date().toISOString();
    await persistPromptHistory(prompts);
    return record;
  }

  async exportData() {
    return {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      prompts: await this.listPrompts()
    };
  }

  #makeVersion({ markdown, sections, quality, usage, settings, versionNumber, refinementInstruction = "" }) {
    return {
      id: createId(),
      versionNumber,
      createdAt: new Date().toISOString(),
      markdown: String(markdown || renderIcepotMarkdown(sections)),
      sections,
      quality: quality || {},
      ...(usage ? { usage } : {}),
      provider: settings?.provider || "unknown",
      model: settings?.model || "unknown",
      refinementInstruction
    };
  }
}
