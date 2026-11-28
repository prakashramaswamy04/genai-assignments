// Panel side of the `fqa:job` port: send one job, ping while it runs so the
// service worker stays awake, resolve with the SW's {ok, result | error} reply.

import { JOB_PORT, JOB_PING_MS, MSG, KEYS } from "../shared/constants.js";

export const INTERRUPTED = "Generation interrupted, try again.";

/** Snapshot of the recorded tab (or the active one), as NaviCase pageSnapshot. */
export async function pageSnapshot() {
  const { [KEYS.recording]: rec } = await chrome.storage.local.get(KEYS.recording);
  let tab = null;
  if (rec?.tabId) tab = await chrome.tabs.get(rec.tabId).catch(() => null);
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return {};
  const res = await chrome.runtime.sendMessage({ type: MSG.snapshot, tabId: tab.id }).catch(() => null);
  return res?.ok ? res.snapshot : { url: tab.url, title: tab.title };
}

export function runJob(kind, payload, onStage = () => {}) {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const port = chrome.runtime.connect({ name: JOB_PORT });
    const ping = setInterval(() => port.postMessage({ type: "ping" }), JOB_PING_MS);
    let done = false;
    const finish = (reply, disconnect = true) => {
      if (done) return;
      done = true;
      clearInterval(ping);
      if (disconnect) port.disconnect();
      resolve(reply);
    };
    port.onMessage.addListener((msg) => {
      if (msg?.id !== id) return;
      if (msg.type === "progress") onStage(msg.stage);
      else finish(msg);
    });
    port.onDisconnect.addListener(() => finish({ ok: false, error: INTERRUPTED }, false));
    port.postMessage({ id, kind, payload });
  });
}
