// Job runner for the long-running calls (NaviCase /api/generate, /api/automate).
// Jobs run over a port so the panel's pings keep the SW alive past the 30 s idle
// window. The running job is noted in storage.session; a SW restart finds the
// note and marks it interrupted so the panel never waits forever.

import { KEYS } from "../shared/constants.js";
import { handleGenerate } from "./generate.js";
import { handleAutomate } from "./automate.js";
import { sanitizeEvent, sanitizeSnapshot } from "../shared/security.js";

const KINDS = {
  generate: {
    run: handleGenerate,
    // Saved here as well as shown, so a result survives the panel closing mid-run.
    // The context is the exact recording the cases came from (NaviCase navicaseContext).
    save: (result, payload) => ({
      [KEYS.results]: result,
      [KEYS.context]: {
        events: Array.isArray(payload.events) ? payload.events.map(event => sanitizeEvent(event)) : [],
        page: sanitizeSnapshot(payload.page || {}),
      },
    }),
  },
  automate: {
    run: handleAutomate,
    // NaviCase keeps the last script on the result as `.automation`.
    save: async (result) => {
      const { [KEYS.results]: results } = await chrome.storage.local.get(KEYS.results);
      return results ? { [KEYS.results]: { ...results, automation: result } } : {};
    },
  },
};

/** Run one job; resolves {ok:true, result} or {ok:false, status, error}. Router-style durationMs. */
export async function runJob(kind, payload, { onStage } = {}) {
  const job = KINDS[kind];
  if (!job) return { ok: false, status: 400, error: `Unknown job "${kind}"` };
  if (!payload || typeof payload !== "object") return { ok: false, status: 400, error: "Invalid request" };
  const started = Date.now();
  try {
    const result = await job.run(payload, { onStage });
    result.meta.durationMs = Date.now() - started;
    if (job.save) await chrome.storage.local.set(await job.save(result, payload));
    return { ok: true, result };
  } catch (err) {
    return { ok: false, status: err?.status || 500, error: String(err?.message || err) };
  }
}

/** Serve one panel port: `{id, kind, payload}` in; progress and the final reply out. */
export function servePort(port) {
  let alive = true;
  port.onDisconnect.addListener(() => (alive = false));
  const post = (msg) => {
    if (!alive) return;
    try {
      port.postMessage(msg);
    } catch {
      alive = false;
    }
  };
  port.onMessage.addListener(async (msg) => {
    if (msg?.type === "ping" || !msg?.id) return; // pings only reset the idle timer
    const { id, kind, payload } = msg;
    await chrome.storage.session.set({ [KEYS.job]: { id, kind, startedAt: Date.now() } });
    const reply = await runJob(kind, payload, { onStage: (stage) => post({ id, type: "progress", stage }) });
    await chrome.storage.session.remove(KEYS.job);
    post({ id, ...reply });
  });
}

/** Called once per SW start: any job still noted belonged to a worker that died. */
export async function markInterrupted() {
  const { [KEYS.job]: job } = await chrome.storage.session.get(KEYS.job);
  if (job && !job.interrupted) await chrome.storage.session.set({ [KEYS.job]: { ...job, interrupted: true } });
}
