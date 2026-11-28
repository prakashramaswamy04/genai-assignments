// Per-model capabilities learned from provider errors, kept in storage so the
// next request (and the model list) uses them:
//   noTemperature / noReasoningEffort — parameter rejected, omit it
//   responsesOnly — model refuses Chat Completions; hidden from the list

import { KEYS } from "../../shared/constants.js";

async function readAll() {
  const { [KEYS.modelCaps]: caps = {} } = await chrome.storage.local.get(KEYS.modelCaps);
  return caps;
}

export async function getCaps(provider, model) {
  return (await readAll())[provider]?.[model] || {};
}

export async function markCaps(provider, model, patch) {
  const all = await readAll();
  const forProvider = all[provider] || {};
  forProvider[model] = { ...forProvider[model], ...patch };
  await chrome.storage.local.set({ [KEYS.modelCaps]: { ...all, [provider]: forProvider } });
}

export async function responsesOnlyModels(provider) {
  const caps = (await readAll())[provider] || {};
  return new Set(Object.keys(caps).filter((m) => caps[m].responsesOnly));
}
