// Ledge-3.0 side panel — Generate + Results tabs (P3). Generation flow and
// result rendering follow NaviCase sidepanel.js; the call goes to the service
// worker over the job port instead of a local server.

import { KEYS, SETTINGS_DEFAULTS, COVERAGE_TYPES, PRIORITIES, LANGUAGES } from "../shared/constants.js";
import { ICEPOT_PREVIEW } from "../background/prompts/prompt.js";
import { runJob, pageSnapshot } from "./job.js";
import { exportFile, toMarkdown, download, copyText } from "./export.js";
import { selection } from "./selection.js";

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  node.append(...[].concat(children).filter((c) => c !== null && c !== undefined));
  return node;
}

function banner(kind, text) {
  const b = $("genBanner");
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

const formatUsd = (v) => (v === null || v === undefined ? "—" : `$${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`);
const formatRate = (v) => `$${Number(v).toFixed(2)}`;

// ---------------------------------------------------------------------------
// Generate tab: output options and prompt mode
// ---------------------------------------------------------------------------

function buildControls() {
  $("language").replaceChildren(...LANGUAGES.map((l) => el("option", { value: l, text: l })));
  $("coverage").replaceChildren(
    ...COVERAGE_TYPES.map((c) => el("button", { type: "button", class: "chip toggle-chip", "data-value": c, "aria-pressed": "false", text: c })),
  );
  $("priorities").replaceChildren(
    ...PRIORITIES.map((p) => el("label", { class: `check prio-${p.toLowerCase()}` }, [el("input", { type: "checkbox", value: p }), el("span", { text: p })])),
  );
  $("defaultPrompt").replaceChildren(
    ...ICEPOT_PREVIEW.map((p) =>
      el("li", { class: "icepot-row" }, [
        el("span", { class: "icepot-key", text: p.key }),
        el("div", {}, [el("strong", { text: p.name }), el("p", { text: p.text })]),
      ]),
    ),
  );
}

function applySettings(s) {
  $("language").value = LANGUAGES.includes(s.language) ? s.language : SETTINGS_DEFAULTS.language;
  $("maxCases").value = s.maxCases;
  for (const c of $("coverage").children) c.setAttribute("aria-pressed", String(s.coverage.includes(c.dataset.value)));
  for (const cb of $("priorities").querySelectorAll("input")) cb.checked = s.priorities.includes(cb.value);
  const mode = s.promptMode === "custom" ? "custom" : "default";
  document.querySelector(`input[name="promptMode"][value="${mode}"]`).checked = true;
  $("customPrompt").value = s.customPrompt;
  $("customPrompt").hidden = mode !== "custom";
}

$("language").addEventListener("change", (e) => saveSettings({ language: e.target.value }));
$("maxCases").addEventListener("change", (e) => {
  const parsed = Number(e.target.value);
  const v = Number.isFinite(parsed) ? Math.min(40, Math.max(1, Math.round(parsed))) : 15;
  e.target.value = v;
  saveSettings({ maxCases: v });
});
$("coverage").addEventListener("click", async (e) => {
  const chip = e.target.closest("[data-value]");
  if (!chip) return;
  const on = chip.getAttribute("aria-pressed") !== "true";
  chip.setAttribute("aria-pressed", String(on));
  const coverage = [...$("coverage").children].filter((c) => c.getAttribute("aria-pressed") === "true").map((c) => c.dataset.value);
  await saveSettings({ coverage });
});
$("priorities").addEventListener("change", async (e) => {
  const selected = [...$("priorities").querySelectorAll("input:checked")].map((i) => i.value);
  if (!selected.length) {
    // At least one priority must stay selected.
    e.target.checked = true;
    banner("warn", "Select at least one priority.");
    return;
  }
  banner("", "");
  await saveSettings({ priorities: selected });
});
for (const r of document.querySelectorAll('input[name="promptMode"]')) {
  r.addEventListener("change", async () => {
    $("customPrompt").hidden = r.value !== "custom";
    await saveSettings({ promptMode: r.value });
  });
}
$("customPrompt").addEventListener("input", (e) => saveSettings({ customPrompt: e.target.value }));

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

const STAGE_TEXT = { calling: "Waiting for the model…", parsing: "Reading the response…" };

function setGenerating(on) {
  $("generateBtn").disabled = on;
  ($("generateBtn").querySelector(".btn-label") || $("generateBtn")).textContent = on ? "Generating…" : "Generate test cases";
  $("generateBtn").classList.toggle("is-busy", on);
  $("genProgress").hidden = !on;
  $("generateBtn").querySelector(".btn-ico use")?.setAttribute("href", on ? "#i-loader" : "#i-sparkles");
}

async function generate() {
  setGenerating(true);
  banner("", "Generating test cases…");
  try {
    const s = await getSettings();
    const [{ [KEYS.events]: events = [] }, page] = await Promise.all([chrome.storage.local.get(KEYS.events), pageSnapshot()]);
    if (!events.length && !page?.url) throw new Error("Nothing to analyse yet. Record a journey or open a page first.");

    const payload = {
      provider: s.provider,
      model: $("model").value,
      temperature: Number(s.temperature),
      reasoningEffort: s.reasoningEffort,
      language: s.language,
      maxCases: Number(s.maxCases),
      coverage: s.coverage,
      priorities: s.priorities,
      useCustomPrompt: s.promptMode === "custom",
      customPrompt: s.customPrompt,
      events,
      page,
    };
    const reply = await runJob("generate", payload, (stage) => banner("", STAGE_TEXT[stage] || "Generating test cases…"));
    if (!reply.ok) throw new Error(reply.error || "Generation failed.");
    // The SW has already stored the result and its context; render it now
    // rather than waiting for storage.onChanged.
    renderResults(reply.result);
    const r = reply.result;
    const cost = r.usage?.cost !== null && r.usage?.cost !== undefined ? ` · ${formatUsd(r.usage.cost)}` : "";
    banner("", `Generated ${r.testCases.length} test cases in ${(r.meta.durationMs / 1000).toFixed(1)}s${cost}.`);
    $("tab-results").click();
  } catch (err) {
    banner("err", err.message);
  } finally {
    setGenerating(false);
  }
}

$("generateBtn").addEventListener("click", generate);

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

let lastResult = null;
let shownIds = [];

function renderResults(result) {
  const previous = lastResult?.meta?.generatedAt;
  lastResult = result?.testCases?.length ? result : null;
  // A new generation starts with nothing ticked; saving a script re-renders the same result.
  if (!lastResult || lastResult.meta?.generatedAt !== previous) selection.clear();
  selection.useCases(lastResult?.testCases);
  $("emptyResults").hidden = Boolean(lastResult);
  $("resultsView").hidden = !lastResult;
  if (!lastResult) return;

  const m = result.meta || {};
  $("resultsTotal").textContent = result.testCases.length;
  $("resultsMeta").textContent = [
    m.model,
    m.priorities?.length ? `${m.priorities.join("/")} priority` : null,
    m.eventCount !== undefined ? `${m.eventCount} actions` : null,
    m.durationMs !== undefined ? `${(m.durationMs / 1000).toFixed(1)}s` : null,
    m.generatedAt ? new Date(m.generatedAt).toLocaleString() : null,
  ].filter(Boolean).join(" · ");
  $("resultsSummary").textContent = result.summary || "";
  $("resultsSummary").hidden = !result.summary;
  $("resultWarnings").replaceChildren(...(result.warnings || []).map((w) => el("div", { class: "banner warn", role: "alert", text: w })));

  renderUsage(result.usage, m.model);
  renderCaseList();
}

function renderUsage(usage, model) {
  $("usageCard").hidden = !usage;
  if (!usage) return;
  $("usageInput").textContent = usage.inputTokens.toLocaleString();
  $("usageOutput").textContent = usage.outputTokens.toLocaleString();
  $("usageCost").textContent = formatUsd(usage.cost);
  $("usageNote").textContent = [
    usage.reasoningTokens ? `Output includes ${usage.reasoningTokens.toLocaleString()} reasoning tokens.` : null,
    usage.cost === null || usage.cost === undefined ? `No list price is known for ${model}.` : null,
  ].filter(Boolean).join(" ");
  $("usageNote").hidden = !$("usageNote").textContent;
  $("compareBody").replaceChildren(
    ...(usage.comparison || []).map((row) =>
      el("tr", { class: row.model === model ? "is-current" : null }, [
        el("td", {}, [row.model, el("span", { class: "prov", text: row.provider })]),
        el("td", { text: formatRate(row.inputPerMTok) }),
        el("td", { text: formatRate(row.outputPerMTok) }),
        el("td", { text: formatUsd(row.cost) }),
      ]),
    ),
  );
}

function renderCaseList() {
  if (!lastResult) return;
  const q = $("search").value.trim().toLowerCase();
  const prio = $("priorityFilter").value;
  const type = $("typeFilter").value;
  const cases = lastResult.testCases.filter(
    (tc) => (!prio || tc.priority === prio) && (!type || tc.type === type) && (!q || JSON.stringify(tc).toLowerCase().includes(q)),
  );
  $("caseList").replaceChildren(...cases.map(caseCard));
  $("filterCount").textContent = cases.length === lastResult.testCases.length ? "" : `Showing ${cases.length} of ${lastResult.testCases.length}.`;
  shownIds = cases.map((tc) => tc.id);
  renderSelection();
}

function renderSelection() {
  const all = $("selectAll");
  const shownSelected = shownIds.filter((id) => selection.has(id)).length;
  all.checked = shownIds.length > 0 && shownSelected === shownIds.length;
  all.indeterminate = shownSelected > 0 && shownSelected < shownIds.length;
  $("selectedCount").textContent = `${selection.size} selected for automation`;
  for (const cb of $("caseList").querySelectorAll(".case-check")) {
    cb.checked = selection.has(cb.value);
    cb.closest(".case").classList.toggle("is-selected", cb.checked);
  }
}

function caseCard(tc) {
  const section = (title, content) => (content ? el("div", { class: "case-section" }, [el("h4", { text: title }), content]) : null);
  const list = (items) => (items?.length ? el("ul", {}, items.map((i) => el("li", { text: i }))) : null);
  const steps = tc.steps?.length
    ? el("table", { class: "grid" }, [
        el("thead", {}, el("tr", {}, [el("th", { text: "#" }), el("th", { text: "Action" }), el("th", { text: "Expected" })])),
        el("tbody", {}, tc.steps.map((s) => el("tr", {}, [el("td", { text: s.step }), el("td", { text: s.action }), el("td", { text: s.expected })]))),
      ])
    : null;

  const check = el("input", { type: "checkbox", class: "case-check", value: tc.id, "aria-label": `Select ${tc.id} for automation` });
  check.checked = selection.has(tc.id);
  // Ticking the box must not expand/collapse the card.
  check.addEventListener("click", (e) => e.stopPropagation());
  check.addEventListener("change", () => selection.set(tc.id, check.checked));

  return el("details", { class: `case${check.checked ? " is-selected" : ""}` }, [
    el("summary", {}, [
      check,
      el("span", { class: "case-id", text: tc.id }),
      el("div", { class: "case-head" }, [
        el("div", { class: "case-title", text: tc.title }),
        el("div", { class: "case-sub", text: [tc.type, tc.module].filter(Boolean).join(" · ") }),
      ]),
      el("span", { class: `prio prio-${String(tc.priority).toLowerCase()}`, text: tc.priority }),
    ]),
    el("div", { class: "case-body" }, [
      section("Preconditions", list(tc.preconditions)),
      section("Test data", list(tc.testData)),
      section("Steps", steps),
      section("Expected result", tc.expectedResult ? el("p", { class: "expected", text: tc.expectedResult }) : null),
    ]),
  ]);
}

$("search").addEventListener("input", renderCaseList);
$("priorityFilter").addEventListener("change", renderCaseList);
$("typeFilter").addEventListener("change", renderCaseList);
$("selectAll").addEventListener("change", (e) => selection.setMany(shownIds, e.target.checked));
selection.subscribe(renderSelection);
for (const b of document.querySelectorAll("[data-export]")) {
  b.addEventListener("click", () => {
    if (!lastResult) return;
    const cases = $("exportScope").value === "selected" ? selection.selectedCases() : lastResult.testCases;
    if (!cases.length) {
      banner("warn", "Select at least one test case to export.");
      return;
    }
    download(exportFile(b.dataset.export, { ...lastResult, testCases: cases }));
  });
}
$("copyAll").addEventListener("click", (e) => lastResult && copyText(toMarkdown(lastResult), e.currentTarget).catch((err) => banner("err", err.message)));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[KEYS.results]) renderResults(changes[KEYS.results].newValue);
});

(async function init() {
  buildControls();
  const [settings, stored, session] = await Promise.all([
    getSettings(),
    chrome.storage.local.get(KEYS.results),
    chrome.storage.session.get(KEYS.job).catch(() => ({})),
  ]);
  applySettings(settings);
  renderResults(stored[KEYS.results]);
  const job = session[KEYS.job]?.kind === "generate" ? session[KEYS.job] : null;
  if (job?.interrupted) {
    banner("err", "Generation interrupted, try again.");
    await chrome.storage.session.remove(KEYS.job);
  } else if (job) {
    banner("", "A generation started earlier is still running; its results will appear in Results.");
  }
})();
