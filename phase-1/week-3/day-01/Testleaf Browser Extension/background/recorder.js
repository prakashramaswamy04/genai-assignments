// Recording state, the captured event log and page snapshots.
// Everything lives in chrome.storage.local, so a service-worker restart loses nothing.

import { KEYS, MAX_EVENTS, MAX_FRAME_SNAPSHOTS, MAX_RECORDING_BYTES, MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_NODES } from "../shared/constants.js";
import { blockedPageMessage } from "../shared/blocked.js";
import { sanitizeEvent, sanitizeSnapshot } from "../shared/security.js";

const CONTENT_SCRIPT = "content/content.js";

// The same selector can exist in different iframes or shadow roots.
const fieldKey = (e) => JSON.stringify([e.target?.selector, e.target?.shadowPath, e.frame]);

// Serialize writes so events arriving in bursts are never lost.
let writeQueue = Promise.resolve();

export function appendEvent(event) {
  writeQueue = writeQueue.then(async () => {
    const { [KEYS.events]: events = [] } = await chrome.storage.local.get(KEYS.events);
    const safeEvent = sanitizeEvent(event);
    const last = events[events.length - 1];
    // Collapse repeated edits of the same field into the latest value.
    if (last && safeEvent.type === "change" && last.type === "change" && fieldKey(last) === fieldKey(safeEvent)) {
      events[events.length - 1] = safeEvent;
    } else {
      // An iframe's first event can arrive late (it waits for its frame path), so keep time order.
      let i = events.length;
      while (i > 0 && events[i - 1].ts > safeEvent.ts) i--;
      events.splice(i, 0, safeEvent);
    }
    const bounded = events.slice(-MAX_EVENTS);
    while (bounded.length > 1 && new TextEncoder().encode(JSON.stringify(bounded)).length > MAX_RECORDING_BYTES) bounded.shift();
    await chrome.storage.local.set({ [KEYS.events]: bounded });
    if (bounded.length < events.length) {
      const rec = await getRecording();
      if (rec.active && !rec.limitReached) await chrome.storage.local.set({ [KEYS.recording]: { ...rec, limitReached: true } });
    }
  }).catch((err) => console.warn("Ledge-3.0: failed to store event", err?.message || err));
  return writeQueue;
}

export async function getRecording() {
  const { [KEYS.recording]: rec = { active: false } } = await chrome.storage.local.get(KEYS.recording);
  return rec;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [CONTENT_SCRIPT] });
  } catch {
    // A frame that cannot be scripted; the declarative content script covers the rest.
  }
}

const hasContent = (s) => s && (s.forms?.length || s.fields?.length || s.buttons?.length || s.links?.length);

function boundSnapshot(snapshot) {
  const nodeLists = new Set(["forms", "fields", "buttons", "links", "headings", "alerts"]);
  let remaining = MAX_SNAPSHOT_NODES;
  const prune = (value, key = "") => {
    if (Array.isArray(value)) {
      const list = nodeLists.has(key) ? value.slice(0, Math.max(0, remaining)) : value;
      if (nodeLists.has(key)) remaining -= list.length;
      return list.map(item => prune(item));
    }
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, prune(child, childKey)]));
  };
  const result = prune(sanitizeSnapshot(snapshot));
  const encoded = () => new TextEncoder().encode(JSON.stringify(result)).length;
  while (encoded() > MAX_SNAPSHOT_BYTES && result.frames?.length) result.frames.pop();
  while (encoded() > MAX_SNAPSHOT_BYTES) {
    const form = result.forms?.findLast(item => item.fields?.length);
    if (form) form.fields.pop();
    else if (result.fields?.length) result.fields.pop();
    else if (result.buttons?.length) result.buttons.pop();
    else if (result.links?.length) result.links.pop();
    else if (result.headings?.length) result.headings.pop();
    else if (result.alerts?.length) result.alerts.pop();
    else break;
  }
  if (encoded() > MAX_SNAPSHOT_BYTES) throw new Error("Page snapshot exceeds the safety limit.");
  if (encoded() >= MAX_SNAPSHOT_BYTES || remaining <= 0) result.truncated = true;
  return result;
}

/** Snapshot every frame in the tab; iframe snapshots are nested under the top page as `frames`. */
export async function snapshotTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const blocked = blockedPageMessage(tab.url);
  if (blocked) return { ok: false, error: blocked };
  await ensureContentScript(tabId);
  const run = (allFrames) =>
    chrome.scripting.executeScript({ target: { tabId, allFrames }, func: () => window.__ledgeSnapshot?.() ?? null });
  let results;
  try {
    results = await run(true);
  } catch {
    // A frame that cannot be scripted can fail the whole call; fall back to the top page.
    results = await run(false);
  }
  const top = results.find((r) => r.frameId === 0)?.result;
  if (!top) return { ok: false, error: "The page did not return a snapshot" };
  const frames = results
    .filter((r) => r.frameId !== 0)
    .map((r) => r.result)
    .filter(hasContent)
    .slice(0, MAX_FRAME_SNAPSHOTS);
  const snapshot = frames.length ? { ...top, frames } : top;
  return { ok: true, snapshot: boundSnapshot(snapshot) };
}

export async function startRecording(tabId, { reset }) {
  const tab = await chrome.tabs.get(tabId);
  const blocked = blockedPageMessage(tab.url);
  if (blocked) return { ok: false, error: blocked };
  if (reset) await chrome.storage.local.set({ [KEYS.events]: [] });
  await chrome.storage.local.set({ [KEYS.recording]: { active: true, tabId, startedAt: Date.now(), limitReached: false } });
  await ensureContentScript(tabId);
  await appendEvent({ type: "navigate", url: tab.url, title: tab.title, ts: Date.now() });
  return { ok: true };
}

export async function stopRecording() {
  const rec = await getRecording();
  await chrome.storage.local.set({ [KEYS.recording]: { ...rec, active: false, stoppedAt: Date.now() } });
}

export async function recoverRecording() {
  const rec = await getRecording();
  if (!rec.active) return;
  await chrome.storage.local.set({
    [KEYS.recording]: { ...rec, active: false, stoppedAt: Date.now(), interrupted: true },
  });
}

export async function clearEvents() {
  const rec = await getRecording();
  if (rec.active) throw new Error("Stop recording before clearing the journey.");
  await chrome.storage.local.set({ [KEYS.events]: [] });
  await chrome.storage.local.set({ [KEYS.recording]: { ...rec, limitReached: false, interrupted: false } });
}

/** Content-script events count only from the tab being recorded. */
export async function acceptEvent(event, sender) {
  const rec = await getRecording();
  if (rec.active && sender.tab?.id === rec.tabId && event && typeof event === "object") await appendEvent(event);
}

/** Full loads and SPA route changes in the recorded tab become navigate steps. */
export async function onTabUrl(tabId, url, title) {
  const rec = await getRecording();
  if (!rec.active || rec.tabId !== tabId || blockedPageMessage(url)) return;
  await appendEvent({ type: "navigate", url, title, ts: Date.now() });
}

export async function onTabClosed(tabId) {
  const rec = await getRecording();
  if (rec.active && rec.tabId === tabId) await stopRecording();
}
