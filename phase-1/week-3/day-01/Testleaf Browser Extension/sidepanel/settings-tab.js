// Ledge-3.0 side panel — Settings tab: API keys (Groq featured as the
// primary provider, the rest under "Other providers"), Advanced; plus the model
// picker, which sits on the Generate tab.
// The panel never reads keys: it sends a key to the service worker once when
// saving and afterwards only sees per-provider booleans.

import { MSG, KEYS, PROVIDERS, PRIMARY_PROVIDER, PROVIDER_LABELS, PROVIDER_KEY_URLS, SETTINGS_DEFAULTS, ADVANCED_DEFAULTS } from "../shared/constants.js";

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

const send = (msg) => chrome.runtime.sendMessage(msg).catch((err) => ({ ok: false, error: err.message }));

function banner(kind, text, id = "settingsBanner") {
  const b = $(id);
  b.hidden = !text;
  b.className = `banner${kind ? ` ${kind}` : ""}`;
  b.textContent = text || "";
}

async function getSettings() {
  const { [KEYS.settings]: stored = {} } = await chrome.storage.local.get(KEYS.settings);
  return { ...SETTINGS_DEFAULTS, ...stored };
}

async function saveSettings(patch) {
  const settings = await getSettings();
  await chrome.storage.local.set({ [KEYS.settings]: { ...settings, ...patch } });
}

/** <svg class="ic"><use href="#i-name"/></svg> from the sprite in sidepanel.html. */
function icon(name) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "ic");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(NS, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

let status = {};

function renderStatus() {
  const n = PROVIDERS.filter((p) => status[p]).length;
  const primary = Boolean(status[PRIMARY_PROVIDER]);
  $("keysPillText").textContent = primary ? "Groq ready" : n ? `${n} key${n > 1 ? "s" : ""} · add Groq` : "Add Groq key";
  $("keysPill").title = `${n}/${PROVIDERS.length} API keys configured — open Settings`;
  $("keysPill").classList.toggle("ok", primary);
  const others = PROVIDERS.filter((p) => p !== PRIMARY_PROVIDER);
  const otherN = others.filter((p) => status[p]).length;
  $("otherCount").textContent = `${otherN}/${others.length}`;
  $("otherCount").className = `chip${otherN ? "" : " off"}`;
  for (const p of PROVIDERS) {
    const input = $(`key-${p}`);
    input.placeholder = "Paste API key";
    // A saved key shows as dots; one being typed is left alone.
    if (status[p] && (input.dataset.masked === "1" || !input.value)) setMasked(p, true);
    else if (!status[p] && input.dataset.masked === "1") setMasked(p, false);
    $(`keyState-${p}`).textContent = status[p] ? "Saved" : "Not set";
    $(`keyState-${p}`).className = `chip${status[p] ? "" : " off"}`;
    $(`test-${p}`).disabled = !status[p];
  }
}

async function refreshStatus() {
  const res = await send({ type: MSG.status });
  if (res?.ok) status = res.providers;
  renderStatus();
}

/**
 * Saved-key mask. The panel never receives stored keys, so a saved key is shown as a
 * fixed run of dots: a placeholder value in a password field. It can't be revealed
 * (Show is disabled) or re-saved, and typing or pasting replaces it.
 */
const MASK_VALUE = "•".repeat(28);

function setMasked(p, on) {
  const input = $(`key-${p}`);
  input.type = "password";
  input.value = on ? MASK_VALUE : "";
  input.dataset.masked = on ? "1" : "0";
  input.setAttribute("aria-label", `${PROVIDER_LABELS[p]} API key${on ? " (saved)" : ""}`);
  const show = $(`show-${p}`);
  if (show) {
    show.disabled = on;
    show.setAttribute("aria-pressed", "false");
    show.querySelector(".btn-label").textContent = "Show";
  }
}

function keyNote(p, kind, text) {
  const note = $(`keyNote-${p}`);
  note.className = `hint${kind ? ` ${kind}` : ""}`;
  note.textContent = text;
}

function buildKeyRow(p) {
  const input = el("input", { id: `key-${p}`, type: "password", autocomplete: "off", spellcheck: "false", "aria-describedby": `keyNote-${p}` });
  const showLabel = el("span", { class: "btn-label", text: "Show" });
  const show = el("button", { id: `show-${p}`, class: "btn ghost sm", type: "button", "aria-pressed": "false" }, [icon("eye"), showLabel]);
  const primary = p === PRIMARY_PROVIDER;
  const save = el("button", { class: `btn ${primary ? "primary" : "ghost"} sm`, type: "button" }, [icon("check"), "Save key"]);
  const test = el("button", { id: `test-${p}`, class: "btn ghost sm", type: "button" }, [icon("check-circle"), "Test key"]);
  const getKey = el("a", { class: "btn link", href: PROVIDER_KEY_URLS[p], target: "_blank", rel: "noopener" }, ["Get a key", icon("external")]);

  show.addEventListener("click", () => {
    if (input.dataset.masked === "1") return;
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    showLabel.textContent = visible ? "Hide" : "Show";
    show.setAttribute("aria-pressed", String(visible));
  });
  save.addEventListener("click", async () => {
    if (input.dataset.masked === "1") {
      keyNote(p, "", "This key is already saved. Paste a new key to replace it.");
      return;
    }
    const res = await send({ type: MSG.setKey, provider: p, key: input.value });
    if (res?.ok) {
      // Turn the field back into dots straight away (input type → password, value masked).
      setMasked(p, true);
      keyNote(p, "ok", "Saved.");
      await refreshStatus();
    } else keyNote(p, "err", res?.error || "Could not save the key.");
  });
  input.addEventListener("keydown", (e) => e.key === "Enter" && save.click());
  // Typing or pasting over the saved dots replaces them with the new key (still shown as dots).
  input.addEventListener("focus", () => input.dataset.masked === "1" && input.select());
  input.addEventListener("beforeinput", () => {
    if (input.dataset.masked !== "1") return;
    input.value = "";
    input.dataset.masked = "0";
    show.disabled = false;
  });
  // Leaving the field empty restores the dots for a key that is still saved.
  input.addEventListener("blur", () => !input.value && status[p] && setMasked(p, true));
  test.addEventListener("click", async () => {
    keyNote(p, "", "Testing…");
    test.disabled = true;
    const res = await send({ type: MSG.testKey, provider: p });
    test.disabled = !status[p];
    keyNote(p, res?.ok ? "ok" : "err", res?.ok ? `Key works — ${res.count} supported model${res.count === 1 ? "" : "s"} available.` : res?.error || "Test failed.");
    if (res?.ok && p === $("provider").value) loadModels(false);
  });

  return el("div", { class: "key-row" }, [
    el("div", { class: "key-head" }, [
      el("label", { for: `key-${p}`, text: PROVIDER_LABELS[p] }),
      el("span", { id: `keyState-${p}`, class: "chip off", text: "Not set" }),
    ]),
    el("div", { class: "row" }, [input, show]),
    el("div", { class: "key-actions" }, [save, test, getKey]),
    el("p", { id: `keyNote-${p}`, class: "hint", "aria-live": "polite" }),
  ]);
}

function buildKeyRows() {
  $("groqKeyRow").replaceChildren(buildKeyRow(PRIMARY_PROVIDER));
  $("keyRows").replaceChildren(...PROVIDERS.filter((p) => p !== PRIMARY_PROVIDER).map(buildKeyRow));
}

// ---------------------------------------------------------------------------
// Model picker
// ---------------------------------------------------------------------------

const money = (n) => `$${n < 1 ? n.toFixed(2) : String(Number(n.toFixed(2)))}`;

function priceText(price) {
  if (!price) return "—";
  const text = `${money(price.input)} in / ${money(price.output)} out per 1M tokens`;
  return price.verified ? text : `${text} · check pricing`;
}

let modelList = { models: [], pricing: {} };

function renderModelInfo() {
  const m = $("model").value;
  const parts = [m ? priceText(modelList.pricing?.[m]) : "No models — add a key and click ↻."];
  if (modelList.source) parts.push(modelList.source === "live" ? "live list" : "default list");
  $("modelInfo").textContent = parts.join(" · ");
  const p = $("provider").value;
  const reasoning = p === "openai" && /^(o\d|gpt-5|gpt-6)/i.test(m);
  // Groq gpt-oss models take both a temperature and a reasoning effort.
  const groqReasoning = p === "groq" && /^openai\/gpt-oss/i.test(m);
  // OpenAI reasoning models take an effort level instead of a temperature.
  $("temperatureField").hidden = reasoning;
  $("effortField").hidden = !reasoning && !groqReasoning;
  $("samplingHint").textContent =
    p === "groq" ? (groqReasoning ? "Groq reasoning model: temperature and reasoning effort are both sent." : "Groq: fast inference on open models.")
    : p === "inception" ? "Inception Labs always uses mercury-2."
      : reasoning ? "Reasoning model: temperature is not sent; reasoning effort is."
        : p === "anthropic" ? "Current Claude models ignore temperature."
          : "";
}

async function loadModels(refresh) {
  const provider = $("provider").value;
  const btn = $("refreshModels");
  btn.disabled = true;
  const res = await send({ type: MSG.models, provider, refresh });
  btn.disabled = provider === "inception";
  if (!res?.ok) {
    banner("err", res?.error || "Could not load models.", "genBanner");
    return;
  }
  banner(res.warning ? "err" : "", res.warning || "", "genBanner");
  modelList = res;
  const settings = await getSettings();
  const keep = settings.provider === provider && res.models.includes(settings.model) ? settings.model : res.default;
  $("model").replaceChildren(...res.models.map((m) => el("option", { value: m, text: m })));
  $("model").value = keep;
  if (keep !== settings.model || settings.provider !== provider) await saveSettings({ provider, model: keep });
  renderModelInfo();
}

// ---------------------------------------------------------------------------
// Advanced
// ---------------------------------------------------------------------------

const ADV_FIELDS = Object.keys(ADVANCED_DEFAULTS);

function renderAdvanced(adv) {
  for (const k of ADV_FIELDS) $(k).value = adv?.[k] ?? ADVANCED_DEFAULTS[k];
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

$("keysPill").addEventListener("click", () => $("tab-settings").click());

$("clearKeysBtn").addEventListener("click", async () => {
  if (!confirm("Remove every saved API key from this browser?")) return;
  const res = await send({ type: MSG.clearKeys });
  banner(res?.ok ? "" : "err", res?.ok ? "All keys cleared." : res?.error);
  await refreshStatus();
});

$("rememberKeys").addEventListener("change", async (e) => {
  const res = await send({ type: MSG.setRemember, remember: e.target.checked });
  if (!res?.ok) banner("err", res?.error || "Could not change where keys are kept.");
  await refreshStatus();
});

$("provider").addEventListener("change", async () => {
  await saveSettings({ provider: $("provider").value, model: "" });
  await loadModels(false);
});
$("model").addEventListener("change", async () => {
  await saveSettings({ model: $("model").value });
  renderModelInfo();
});
$("refreshModels").addEventListener("click", () => loadModels(true));
$("temperature").addEventListener("input", (e) => {
  $("temperatureValue").textContent = Number(e.target.value).toFixed(1);
});
$("temperature").addEventListener("change", (e) => saveSettings({ temperature: Number(e.target.value) }));
$("reasoningEffort").addEventListener("change", (e) => saveSettings({ reasoningEffort: e.target.value }));

$("saveAdvanced").addEventListener("click", async () => {
  const advanced = Object.fromEntries(ADV_FIELDS.map((k) => {
    const input = $(k);
    const n = Math.round(Number(input.value));
    const v = Number.isFinite(n) ? Math.min(Number(input.max), Math.max(Number(input.min), n)) : ADVANCED_DEFAULTS[k];
    input.value = v;
    return [k, v];
  }));
  await saveSettings({ advanced });
  banner("", "Advanced settings saved.");
});
$("resetAdvanced").addEventListener("click", async () => {
  renderAdvanced(ADVANCED_DEFAULTS);
  await saveSettings({ advanced: ADVANCED_DEFAULTS });
  banner("", "Advanced settings reset to defaults.");
});

(async function init() {
  buildKeyRows();
  $("provider").replaceChildren(
    ...PROVIDERS.map((p) => el("option", { value: p, text: p === PRIMARY_PROVIDER ? `★ ${PROVIDER_LABELS[p]} (recommended)` : PROVIDER_LABELS[p] })),
  );
  const settings = await getSettings();
  $("provider").value = PROVIDERS.includes(settings.provider) ? settings.provider : SETTINGS_DEFAULTS.provider;
  $("temperature").value = settings.temperature;
  $("temperatureValue").textContent = Number(settings.temperature).toFixed(1);
  $("reasoningEffort").value = settings.reasoningEffort;
  $("rememberKeys").checked = settings.rememberKeys !== false;
  renderAdvanced(settings.advanced);
  await refreshStatus();
  // Open "Other providers" only when one of them already has a key.
  $("otherProviders").open = PROVIDERS.some((p) => p !== PRIMARY_PROVIDER && status[p]);
  await loadModels(false);
})();
