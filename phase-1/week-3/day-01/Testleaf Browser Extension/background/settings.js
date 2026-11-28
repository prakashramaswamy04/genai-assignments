// Settings and API keys. Only the service worker reads keys: the panel sends a
// key once when saving it and afterwards only sees booleans.
// "Remember keys" ON → chrome.storage.local, OFF → chrome.storage.session
// (cleared when the browser closes; not readable by content scripts).

import { KEYS, PROVIDERS, PROVIDER_LABELS, SETTINGS_DEFAULTS, ADVANCED_DEFAULTS, ADVANCED_RANGE } from "../shared/constants.js";
import { HttpError } from "./llm/http.js";

export async function getSettings() {
  const { [KEYS.settings]: stored = {} } = await chrome.storage.local.get(KEYS.settings);
  return { ...SETTINGS_DEFAULTS, ...stored };
}

const clampInt = (value, [min, max], fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Timeout and token limits, clamped to ADVANCED_RANGE. */
export async function getAdvanced() {
  const adv = (await getSettings()).advanced || {};
  return Object.fromEntries(
    Object.entries(ADVANCED_DEFAULTS).map(([k, def]) => [k, clampInt(adv[k], ADVANCED_RANGE[k], def)]),
  );
}

async function readKeys(area) {
  const { [KEYS.keys]: keys = {} } = await chrome.storage[area].get(KEYS.keys);
  return keys;
}

async function activeArea() {
  return (await getSettings()).rememberKeys === false ? "session" : "local";
}

/** Keys from both areas (session wins); a toggle mid-way never loses one. */
async function allKeys() {
  return { ...(await readKeys("local")), ...(await readKeys("session")) };
}

export async function getKey(provider) {
  const key = (await allKeys())[provider];
  if (!key) throw new HttpError(400, `Add your ${PROVIDER_LABELS[provider] || provider} API key in Settings.`);
  return key;
}

/** Every stored key, for scrubbing error text. */
export async function secretValues() {
  return Object.values(await allKeys()).filter(Boolean);
}

export async function setKey(provider, key) {
  if (!PROVIDERS.includes(provider)) throw new HttpError(400, "Unknown provider");
  const value = String(key ?? "").trim();
  if (!value) throw new HttpError(400, "Enter a key first.");
  if (value.length > 512 || /\s/.test(value)) throw new HttpError(400, "That does not look like an API key.");
  const area = await activeArea();
  const other = area === "local" ? "session" : "local";
  await chrome.storage[area].set({ [KEYS.keys]: { ...(await readKeys(area)), [provider]: value } });
  const rest = await readKeys(other);
  if (provider in rest) {
    delete rest[provider];
    await chrome.storage[other].set({ [KEYS.keys]: rest });
  }
}

export async function clearKeys() {
  await Promise.all([chrome.storage.local.remove(KEYS.keys), chrome.storage.session.remove(KEYS.keys)]);
}

/** Switch where keys live and move the existing ones there. */
export async function setRemember(remember) {
  const keys = await allKeys();
  const settings = await getSettings();
  await chrome.storage.local.set({ [KEYS.settings]: { ...settings, rememberKeys: Boolean(remember) } });
  await clearKeys();
  if (Object.keys(keys).length) await chrome.storage[remember ? "local" : "session"].set({ [KEYS.keys]: keys });
}

export async function providerStatus() {
  const keys = await allKeys();
  return Object.fromEntries(PROVIDERS.map((p) => [p, Boolean(keys[p])]));
}
