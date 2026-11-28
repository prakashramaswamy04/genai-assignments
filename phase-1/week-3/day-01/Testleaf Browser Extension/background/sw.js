// Ledge-3.0 service worker. Listeners are registered at top level so Chrome
// can wake the worker for them; all state is in chrome.storage.

import { MSG, JOB_PORT } from "../shared/constants.js";
import * as recorder from "./recorder.js";
import * as settings from "./settings.js";
import { listModels, testKey } from "./models.js";
import { servePort, markInterrupted } from "./jobs.js";

markInterrupted().catch(() => {});

const openPanelOnClick = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(openPanelOnClick);
chrome.runtime.onStartup.addListener(openPanelOnClick);
chrome.runtime.onInstalled.addListener(() => recorder.recoverRecording().catch((err) => console.warn("Ledge-3.0: recording recovery failed", err?.message || err)));
chrome.runtime.onStartup.addListener(() => recorder.recoverRecording().catch((err) => console.warn("Ledge-3.0: recording recovery failed", err?.message || err)));

const handlers = {
  [MSG.event]: async (msg, sender) => {
    await recorder.acceptEvent(msg.event, sender);
    return { ok: true };
  },
  [MSG.start]: (msg) => recorder.startRecording(msg.tabId, { reset: Boolean(msg.reset) }),
  [MSG.stop]: async () => {
    await recorder.stopRecording();
    return { ok: true };
  },
  [MSG.clear]: async () => {
    await recorder.clearEvents();
    return { ok: true };
  },
  [MSG.snapshot]: (msg) => recorder.snapshotTab(msg.tabId),
  [MSG.status]: async () => ({ ok: true, providers: await settings.providerStatus() }),
  [MSG.models]: (msg) => listModels(String(msg.provider || ""), Boolean(msg.refresh)),
  [MSG.testKey]: (msg) => testKey(String(msg.provider || "")),
  [MSG.setKey]: async (msg) => {
    await settings.setKey(msg.provider, msg.key);
    return { ok: true };
  },
  [MSG.clearKeys]: async () => {
    await settings.clearKeys();
    return { ok: true };
  },
  [MSG.setRemember]: async (msg) => {
    await settings.setRemember(Boolean(msg.remember));
    return { ok: true };
  },
};

// Only extension pages (the side panel) may touch settings or keys; content
// scripts share the extension id but always carry sender.tab.
const PANEL_ONLY = new Set([MSG.status, MSG.models, MSG.testKey, MSG.setKey, MSG.clearKeys, MSG.setRemember]);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const handler = handlers[msg?.type];
  if (!handler || (PANEL_ONLY.has(msg.type) && sender.tab)) {
    sendResponse({ ok: false, error: "unknown message" });
    return false;
  }
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, status: err?.status, error: String(err?.message || err) }));
  return true; // async response
});

// Generation jobs: side panel only (content-script ports carry sender.tab).
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== JOB_PORT || port.sender?.id !== chrome.runtime.id || port.sender?.tab) return port.disconnect();
  servePort(port);
});

for (const navigationEvent of ["onCommitted", "onHistoryStateUpdated", "onReferenceFragmentUpdated"]) {
  chrome.webNavigation[navigationEvent].addListener((details) => {
    if (details.frameId === 0) recorder.onTabUrl(details.tabId, details.url).catch((err) => console.warn("Ledge-3.0: navigation capture failed", err?.message || err));
  });
}

chrome.tabs.onRemoved.addListener((tabId) => recorder.onTabClosed(tabId));
