// Ledge-3.0 side panel: tab shell + Record tab.

import { MSG, KEYS } from "../shared/constants.js";
import { blockedPageMessage } from "../shared/blocked.js";

const $ = (id) => document.getElementById(id);

/** Tiny DOM builder; text always goes through textContent. */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

function showBanner(kind, text) {
  const b = $("banner");
  b.hidden = !text;
  b.className = `banner${kind ? ` ${kind}` : ""}`;
  b.textContent = text;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const tabs = [...document.querySelectorAll('[role="tab"]')];

function selectTab(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute("aria-controls")).hidden = !on;
  }
}

tabs.forEach((t, i) => {
  t.addEventListener("click", () => selectTab(t));
  t.addEventListener("keydown", (e) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const next = tabs[(i + step + tabs.length) % tabs.length];
    selectTab(next);
    next.focus();
  });
});

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

const EVENT_TEXT = {
  navigate: (e) => e.title || e.url,
  click: (e) => targetLabel(e.target),
  change: (e) => `${targetLabel(e.target)} = ${e.value ?? ""}`,
  select: (e) => `${targetLabel(e.target)} → ${e.value}`,
  check: (e) => `${e.checked ? "☑" : "☐"} ${targetLabel(e.target)}`,
  submit: (e) => targetLabel(e.target) || "form",
  keydown: (e) => `${e.key} in ${targetLabel(e.target)}`,
};

function targetLabel(t = {}) {
  return t.label || t.text || t.ariaLabel || t.placeholder || t.name || t.id || t.selector || t.tag || "";
}

function renderEvents(events) {
  $("eventCount").textContent = events.length;
  $("eventsEmpty").hidden = events.length > 0;
  const list = $("eventList");
  list.replaceChildren(
    ...events.slice(-100).map((e) => {
      const text = (EVENT_TEXT[e.type] || (() => e.type))(e);
      const where = [e.frame?.length ? "iframe" : null, e.target?.shadowPath?.length ? "shadow" : null].filter(Boolean);
      return el("li", {}, [
        el("span", { class: `ev-type t-${e.type}${e.type === "navigate" ? " nav" : ""}`, text: e.type === "navigate" ? "nav" : e.type }),
        el("span", { class: "ev-text", title: text }, [...where.map((w) => el("span", { class: "ev-ctx", text: w })), text]),
      ]);
    }),
  );
  list.scrollTop = list.scrollHeight;
}

let recTimer = null;
let recording = false;

function renderRecording(rec) {
  recording = Boolean(rec?.active);
  $("recorderCard").classList.toggle("is-recording", recording);
  $("recordBtnText").textContent = recording ? "Stop recording" : "Start recording";
  $("recIndicator").hidden = !recording;
  $("recorderStatus").textContent = rec?.limitReached
    ? "Recording limit reached; the oldest actions may have been trimmed."
    : recording
      ? "Recording clicks, inputs, selections and navigation in this tab."
    : rec?.interrupted ? "Recording was interrupted; captured actions were preserved."
      : "Idle. Start recording, then walk through the feature.";

  clearInterval(recTimer);
  if (recording) {
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - rec.startedAt) / 1000));
      $("recTimer").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    };
    tick();
    recTimer = setInterval(tick, 1000);
  }
  refreshBlocked();
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Warn up front when the active tab is a page Chrome won't let us record. */
async function refreshBlocked() {
  const tab = await activeTab().catch(() => null);
  const reason = recording ? null : blockedPageMessage(tab?.url);
  $("blocked").hidden = !reason;
  $("blocked").textContent = reason || "";
  $("recordBtn").disabled = Boolean(reason);
}

async function toggleRecording() {
  if (recording) {
    await chrome.runtime.sendMessage({ type: MSG.stop });
    showBanner("", "Recording stopped. Review the captured actions, then generate.");
    return;
  }
  const tab = await activeTab();
  const reason = blockedPageMessage(tab?.url);
  if (!tab?.id || reason) {
    showBanner("err", reason || "Open the web page you want to test before recording.");
    return;
  }
  // A new session replaces the previous one; navigation inside the tab is
  // captured continuously, so multi-page journeys need only one recording.
  const res = await chrome.runtime.sendMessage({ type: MSG.start, tabId: tab.id, reset: true }).catch((err) => ({ ok: false, error: err.message }));
  showBanner(res?.ok ? "" : "err", res?.ok ? "" : res?.error || "Could not start recording.");
}

async function setMaskValues(on) {
  const { [KEYS.settings]: settings = {} } = await chrome.storage.local.get(KEYS.settings);
  await chrome.storage.local.set({ [KEYS.settings]: { ...settings, maskValues: on } });
}

$("recordBtn").addEventListener("click", () => toggleRecording().catch((err) => showBanner("err", err.message)));
$("clearBtn").addEventListener("click", () => {
  if (confirm("Clear the captured browser journey? This cannot be undone.")) {
    chrome.runtime.sendMessage({ type: MSG.clear })
      .then((response) => response?.ok ? showBanner("", "Captured journey cleared.") : showBanner("err", response?.error || "Could not clear the journey."))
      .catch((err) => showBanner("err", err.message));
  }
});
$("maskValues").addEventListener("change", (e) => setMaskValues(e.target.checked));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[KEYS.events]) renderEvents(changes[KEYS.events].newValue || []);
  if (changes[KEYS.recording]) renderRecording(changes[KEYS.recording].newValue);
  if (changes[KEYS.settings]) $("maskValues").checked = Boolean(changes[KEYS.settings].newValue?.maskValues);
});
chrome.tabs.onActivated.addListener(refreshBlocked);
chrome.tabs.onUpdated.addListener((_id, info, tab) => tab.active && info.url && refreshBlocked());
chrome.windows.onFocusChanged.addListener(refreshBlocked);

$("copyrightYear").textContent = String(new Date().getFullYear());

(async function init() {
  const stored = await chrome.storage.local.get([KEYS.settings, KEYS.events, KEYS.recording]);
  $("maskValues").checked = Boolean(stored[KEYS.settings]?.maskValues);
  renderEvents(stored[KEYS.events] || []);
  renderRecording(stored[KEYS.recording]);
})();
