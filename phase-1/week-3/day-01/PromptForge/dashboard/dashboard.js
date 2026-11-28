import { StorageService } from "../services/storage-service.js";
import { PromptService } from "../services/prompt-service.js";
import { AIService, ensureEndpointPermission } from "../services/ai-service.js";
import { assessPrompt, parseIcepotMarkdown, renderIcepotMarkdown } from "../services/quality-service.js";
import { validateInput, validateSettings, validateIcepotSections } from "../utils/validators.js";
import { createFilename, formatDate, getErrorMessage, downloadText } from "../utils/helpers.js";
import { DEFAULT_SETTINGS, ICEPOT_SECTIONS } from "../utils/constants.js";

const storage = new StorageService();
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  settings: { ...DEFAULT_SETTINGS },
  hasApiKey: false,
  activeRecord: null,
  analysis: null,
  sections: null,
  markdown: "",
  quality: null,
  isBusy: false,
  activeView: "create"
};

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  $("#toastRegion").append(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

function showSettingsMessage(message, isError = false) {
  const target = $("#settingsMessage");
  target.textContent = message;
  target.classList.toggle("error", isError);
  target.classList.remove("hidden");
}

function setBusy(busy, scope = "generate") {
  state.isBusy = busy;
  const controls = scope === "generate"
    ? [$("#generateButton"), $("#regeneratePrompt")]
    : [$("#testConnection"), $("#settingsForm button[type='submit']")];
  controls.filter(Boolean).forEach((control) => { control.disabled = busy; });
  if (scope === "generate") $("#generationLoading").classList.toggle("hidden", !busy);
}

function setLoadingStage(stage) {
  const title = $("#loadingTitle");
  const description = $("#loadingDescription");
  if (stage === "analysis") {
    title.textContent = "Analyzing your requirements…";
    description.textContent = "Extracting exact technical details, assumptions, missing information, and contradictions.";
  } else if (stage === "generation") {
    title.textContent = "Building your ICEPOT prompt…";
    description.textContent = "Structuring the six sections, grounded examples, deliverables, and quality assessment.";
  }
}

function navigate(view) {
  const next = ["create", "history", "settings"].includes(view) ? view : "create";
  state.activeView = next;
  $$(".view").forEach((section) => {
    const isActive = section.id === `view-${next}`;
    section.classList.toggle("active", isActive);
    section.classList.toggle("hidden", !isActive);
  });
  $$(".nav-item[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === next));
  $("#currentViewLabel").textContent = next === "create" ? "Create prompt" : next === "history" ? "Prompt history" : "Settings";
  if (next === "history") loadHistory($("#historySearch").value);
  history.replaceState(null, "", `#${next}`);
}

function readSettingsForm() {
  return {
    provider: $("#provider").value,
    endpoint: $("#endpoint").value.trim(),
    model: $("#model").value.trim(),
    timeoutMs: Number($("#timeoutSeconds").value) * 1000,
    maxTokens: Number($("#maxTokens").value),
    credentialStorage: $("#credentialStorage").value,
    temperature: Number($("#temperature").value)
  };
}

function populateSettings(settings) {
  $("#provider").value = settings.provider;
  $("#endpoint").value = settings.endpoint;
  $("#model").value = settings.model;
  $("#timeoutSeconds").value = Math.round(settings.timeoutMs / 1000);
  $("#maxTokens").value = settings.maxTokens;
  $("#credentialStorage").value = settings.credentialStorage;
  $("#temperature").value = settings.temperature;
  updateKeyStatus();
}

function updateKeyStatus() {
  $("#apiKeyStatus").textContent = state.hasApiKey
    ? "A key is saved (hidden). Leave this field empty to keep using it."
    : "No API key is saved yet. Add one to generate or test prompts.";
}

async function saveSettingsFromForm({ silent = false } = {}) {
  const settings = readSettingsForm();
  const validation = validateSettings(settings);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  const key = $("#apiKey").value.trim();
  await storage.saveSettings(settings, key);
  state.settings = settings;
  if (key) state.hasApiKey = true;
  $("#apiKey").value = "";
  updateKeyStatus();
  if (!silent) showSettingsMessage("Settings saved. Your provider configuration is ready.");
  return settings;
}

function buildSectionsCards(sections) {
  const container = $("#sectionCards");
  container.replaceChildren();
  for (const { number, title, key } of ICEPOT_SECTIONS) {
    const card = document.createElement("article");
    card.className = "section-copy-card";
    const header = document.createElement("header");
    const heading = document.createElement("strong");
    heading.textContent = `${String(number).padStart(2, "0")} / ${title}`;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => copyText(sections[key] || "", `${title} section copied.`));
    header.append(heading, copy);
    const preview = document.createElement("p");
    preview.textContent = String(sections[key] || "").replace(/\s+/g, " ").trim().slice(0, 210) || "No content";
    card.append(header, preview);
    container.append(card);
  }
}

function renderQuality(quality) {
  const score = Number.isFinite(Number(quality?.overall)) ? Number(quality.overall) : 0;
  $("#overallScore").textContent = quality ? score : "—";
  $("#qualityScoreLarge").textContent = quality ? score : "—";
  $("#scoreLabel").textContent = !quality ? "Not assessed" : score >= 85 ? "Strong prompt" : score >= 70 ? "Good foundation" : score >= 50 ? "Needs review" : "Significant gaps";
  $("#qualityHeadline").textContent = !quality ? "Awaiting analysis" : score >= 85 ? "Strong foundation" : score >= 70 ? "Promising structure" : "Room to strengthen";
  $("#qualityAssessment").textContent = quality?.completenessAssessment || "Run generation to see the assessment.";
  const degrees = Math.round((quality ? score : 0) * 3.6);
  $("#scoreRing").style.background = `conic-gradient(var(--accent-2) ${degrees}deg, rgba(107,217,202,.14) ${degrees}deg)`;

  const bars = $("#scoreBars");
  bars.replaceChildren();
  for (const dimension of quality?.dimensions || []) {
    const row = document.createElement("div");
    row.className = "score-row";
    const label = document.createElement("span");
    label.textContent = dimension.label;
    const value = document.createElement("b");
    value.textContent = `${dimension.score}%`;
    const track = document.createElement("div");
    track.className = "score-track";
    const fill = document.createElement("i");
    fill.style.width = `${dimension.score}%`;
    track.append(fill);
    row.append(label, value, track);
    bars.append(row);
  }

  const listRoot = $("#qualityLists");
  listRoot.replaceChildren();
  const groups = [
    ["Missing information", quality?.missingInformation || []],
    ["Ambiguities", quality?.detectedAmbiguities || []],
    ["Unresolved contradictions", quality?.unresolvedContradictions || []],
    ["Technical preservation checks", quality?.preservationWarnings || []],
    ["Improvement recommendations", quality?.improvementRecommendations || []]
  ];
  for (const [title, values] of groups) {
    const group = document.createElement("div");
    group.className = "quality-group";
    const heading = document.createElement("strong");
    heading.textContent = `${title} · ${values.length}`;
    group.append(heading);
    if (values.length) {
      const list = document.createElement("ul");
      values.slice(0, 8).forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        list.append(li);
      });
      group.append(list);
    } else {
      const empty = document.createElement("p");
      empty.className = "quality-empty";
      empty.textContent = "No issues reported.";
      group.append(empty);
    }
    listRoot.append(group);
  }
}

function formatUsd(value) {
  if (value === null || value === undefined) return "—";
  return `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

function renderUsage(usage) {
  const input = $("#usageInputTokens");
  const output = $("#usageOutputTokens");
  const cost = $("#usageCost");
  const note = $("#usageNote");
  if (!usage) {
    input.textContent = "—";
    output.textContent = "—";
    cost.textContent = "—";
    note.textContent = "No token usage was recorded for this version.";
    return;
  }
  if (!usage.available) {
    input.textContent = "—";
    output.textContent = "—";
    cost.textContent = "—";
    note.textContent = "The provider did not return token usage for every generation request.";
    return;
  }
  input.textContent = usage.inputTokens.toLocaleString();
  output.textContent = usage.outputTokens.toLocaleString();
  cost.textContent = formatUsd(usage.cost);
  note.textContent = usage.cost === null
    ? `Total: ${usage.totalTokens.toLocaleString()} tokens across ${usage.requestCount} requests. No price is available for this model.`
    : `Total: ${usage.totalTokens.toLocaleString()} tokens across ${usage.requestCount} requests. Cost is an estimate; provider rates may vary.`;
}

function renderAnalysis(analysis) {
  const root = $("#analysisDetails");
  root.replaceChildren();
  const entries = [
    ["Main objective", analysis?.mainObjective ? [analysis.mainObjective] : []],
    ["Explicit requirements", analysis?.explicitRequirements],
    ["Technical details", (analysis?.technicalDetails || []).map((item) => `${item.type || "detail"}: ${item.value}${item.mustPreserve ? " · preserve exactly" : ""}`)],
    ["Business rules & constraints", [...(analysis?.businessRules || []), ...(analysis?.constraints || [])]],
    ["Edge cases", analysis?.edgeCases],
    ["Existing implementation", analysis?.existingImplementation],
    ["Expected deliverables", analysis?.expectedDeliverables],
    ["Reasonable inferences", analysis?.reasonableInferences],
    ["Missing information", analysis?.missingInformation],
    ["Technical uncertainties", analysis?.technicalUncertainties],
    ["Contradictions", (analysis?.contradictions || []).map((item) => `${(item.statements || []).join(" ↔ ")} — ${item.issue || "Unresolved conflict"}`)],
    ["Recommended persona", analysis?.recommendedPersona ? [analysis.recommendedPersona] : []],
    ["Recommended output format", analysis?.recommendedOutputFormat],
    ["Recommended tone", analysis?.recommendedTone ? [analysis.recommendedTone] : []],
    ["Clarification questions", analysis?.clarificationQuestions]
  ];
  for (const [title, values] of entries) {
    if (!values?.length) continue;
    const block = document.createElement("div");
    block.className = "analysis-block";
    const heading = document.createElement("strong");
    heading.textContent = title;
    const list = document.createElement("ul");
    values.slice(0, 12).forEach((value) => {
      const item = document.createElement("li");
      item.textContent = String(value);
      list.append(item);
    });
    block.append(heading, list);
    root.append(block);
  }
  if (!root.childElementCount) {
    const note = document.createElement("p");
    note.textContent = "No additional analysis details were returned.";
    note.className = "quality-empty";
    root.append(note);
  }
}

function renderVersionSelector(record) {
  const selector = $("#compareVersion");
  selector.replaceChildren();
  const prompt = document.createElement("option");
  prompt.value = "";
  prompt.textContent = record.versions.length > 1 ? "Choose a previous version" : "No previous versions";
  selector.append(prompt);
  const versions = record.versions.slice(0, -1).reverse();
  for (const version of versions) {
    const option = document.createElement("option");
    option.value = version.id;
    option.textContent = `Version ${version.versionNumber} · ${formatDate(version.createdAt)}`;
    selector.append(option);
  }
  selector.disabled = versions.length === 0;
  $("#versionLabel").textContent = `Version ${record.versions.at(-1)?.versionNumber || 1} · ${record.versions.length} saved`;
  renderVersionComparison("");
}

function renderVersionComparison(versionId) {
  const root = $("#versionComparison");
  root.replaceChildren();
  const record = state.activeRecord;
  if (!record || !versionId) {
    root.className = "version-comparison empty-state";
    root.textContent = record?.versions?.length > 1 ? "Choose a previous version above to compare it with the current version." : "Save an edit or regenerate to create another version.";
    return;
  }
  const oldVersion = record.versions.find((item) => item.id === versionId);
  const current = record.versions.at(-1);
  if (!oldVersion || !current) return;
  root.className = "version-comparison";
  const columns = document.createElement("div");
  columns.className = "comparison-columns";
  for (const [label, version] of [[`Version ${oldVersion.versionNumber}`, oldVersion], [`Version ${current.versionNumber} · Current`, current]]) {
    const column = document.createElement("div");
    column.className = "comparison-column";
    const heading = document.createElement("h4");
    heading.textContent = label;
    const pre = document.createElement("pre");
    pre.textContent = version.markdown;
    column.append(heading, pre);
    columns.append(column);
  }
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;justify-content:flex-end;margin-top:10px";
  const copy = document.createElement("button");
  copy.className = "icon-button";
  copy.type = "button";
  copy.textContent = "Copy selected previous version";
  copy.addEventListener("click", () => copyText(oldVersion.markdown, `Version ${oldVersion.versionNumber} copied.`));
  actions.append(copy);
  root.append(columns, actions);
}

function renderActiveRecord(record) {
  state.activeRecord = record;
  state.analysis = record.analysis || {};
  const latest = record.versions.at(-1);
  state.sections = latest.sections;
  state.markdown = latest.markdown;
  state.quality = latest.quality;
  $("#generatedPrompt").value = latest.markdown;
  $("#sourceInput").value = record.originalInput;
  $("#originalSourceDisplay").textContent = record.originalInput;
  $("#inputCounter").textContent = `${record.originalInput.length.toLocaleString()} / 50,000`;
  $("#resultMeta").textContent = `${record.versions.length} version${record.versions.length === 1 ? "" : "s"} · Updated ${formatDate(record.updatedAt)}`;
  $("#resultsSection").classList.remove("hidden");
  $("#resultsSection").scrollIntoView({ behavior: "smooth", block: "start" });
  $("#outputCounter").textContent = `${latest.markdown.length.toLocaleString()} characters`;
  buildSectionsCards(latest.sections);
  renderUsage(latest.usage);
  renderQuality(latest.quality);
  renderAnalysis(record.analysis);
  renderVersionSelector(record);
}

function updateOutputCounter() {
  $("#outputCounter").textContent = `${$("#generatedPrompt").value.length.toLocaleString()} characters`;
}

async function runGenerate({ append = false } = {}) {
  if (state.isBusy) return;
  const source = append && state.activeRecord ? state.activeRecord.originalInput : $("#sourceInput").value;
  const validation = validateInput(source);
  if (!validation.valid) { showToast(validation.message, "error"); return; }
  if (!state.hasApiKey) { showToast("Add and save an API key in Settings first.", "error"); navigate("settings"); return; }
  // Request the optional host permission synchronously from this click action.
  const permissionPromise = ensureEndpointPermission(state.settings.endpoint);
  setBusy(true);
  setLoadingStage("analysis");
  try {
    await permissionPromise;
    const key = await storage.getApiKey();
    const service = new PromptService(state.settings, key);
    const inputType = append && state.activeRecord?.inputType ? state.activeRecord.inputType : $("#inputType").value;
    const result = await service.generate(source, { onStage: setLoadingStage, inputType });
    let record;
    if (append && state.activeRecord) {
      record = await storage.appendVersion(state.activeRecord.id, {
        ...result,
        settings: state.settings,
        refinementInstruction: "Regenerated from original source"
      });
      record.analysis = result.analysis;
      state.analysis = result.analysis;
      // Persist the refreshed analysis with the version record.
      record = await updateRecordAnalysis(record.id, result.analysis);
    } else {
      record = await storage.createPrompt({ originalInput: source, inputType: $("#inputType").value, ...result, settings: state.settings });
    }
    renderActiveRecord(record);
    showToast(append ? "A new prompt version has been created." : "Your ICEPOT prompt is ready.");
  } catch (error) {
    showToast(getErrorMessage(error), "error");
  } finally {
    setBusy(false);
  }
}

async function updateRecordAnalysis(promptId, analysis) {
  return storage.updateAnalysis(promptId, analysis);
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(String(text));
    showToast(successMessage || "Copied to clipboard.");
  } catch {
    showToast("Clipboard access failed. Check extension clipboard permission and try again.", "error");
  }
}

async function saveEdits() {
  if (!state.activeRecord) return;
  try {
    const markdown = $("#generatedPrompt").value;
    const sections = parseIcepotMarkdown(markdown);
    const validation = validateIcepotSections(sections);
    if (!validation.valid) throw new Error(`Keep all six ICEPOT headings while editing. ${validation.errors.join(" ")}`);
    const quality = assessPrompt({ sections, rawQuality: state.quality?.scores || {}, sourceInput: state.activeRecord.originalInput, analysis: state.analysis });
    const record = await storage.saveEditedMarkdown(state.activeRecord.id, markdown, state.settings, quality);
    renderActiveRecord(record);
    showToast("Edits saved as a new version.");
  } catch (error) {
    showToast(getErrorMessage(error), "error");
  }
}

async function loadHistory(query = "") {
  const root = $("#historyList");
  let records;
  try { records = await storage.listPrompts(query); }
  catch (error) { root.textContent = getErrorMessage(error); return; }
  root.replaceChildren();
  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "empty-history";
    const heading = document.createElement("strong");
    heading.textContent = query ? "No matching prompts" : "Your prompt library is empty";
    const copy = document.createElement("p");
    copy.textContent = query ? "Try a different search term." : "Generate your first ICEPOT prompt and it will appear here.";
    empty.append(heading, copy);
    root.append(empty);
    return;
  }
  for (const record of records) {
    const item = document.createElement("article");
    item.className = "history-item";
    const main = document.createElement("div");
    main.className = "history-item-main";
    main.tabIndex = 0;
    main.setAttribute("role", "button");
    main.setAttribute("aria-label", `Open ${record.title}`);
    const title = document.createElement("h3");
    title.textContent = record.title;
    const source = document.createElement("p");
    source.textContent = record.originalInput;
    const meta = document.createElement("div");
    meta.className = "history-item-meta";
    const versionMeta = document.createElement("span");
    versionMeta.textContent = `${record.versions?.length || 0} VERSION(S)`;
    const dateMeta = document.createElement("span");
    dateMeta.textContent = formatDate(record.updatedAt).toUpperCase();
    meta.append(versionMeta, dateMeta);
    main.append(title, source, meta);
    main.addEventListener("click", () => openHistoryRecord(record.id));
    main.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openHistoryRecord(record.id); }
    });
    const actions = document.createElement("div");
    actions.className = "history-item-actions";
    const rename = document.createElement("button");
    rename.className = "icon-button";
    rename.type = "button";
    rename.textContent = "Rename";
    rename.addEventListener("click", async () => {
      const nextTitle = window.prompt("Rename this prompt", record.title);
      if (nextTitle === null) return;
      try { await storage.renamePrompt(record.id, nextTitle); await loadHistory($("#historySearch").value); showToast("Prompt renamed."); }
      catch (error) { showToast(getErrorMessage(error), "error"); }
    });
    const remove = document.createElement("button");
    remove.className = "icon-button";
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Delete “${record.title}” and all its versions?`)) return;
      await storage.deletePrompt(record.id);
      if (state.activeRecord?.id === record.id) {
        state.activeRecord = null;
        $("#resultsSection").classList.add("hidden");
      }
      await loadHistory($("#historySearch").value);
      showToast("Prompt deleted.");
    });
    actions.append(rename, remove);
    item.append(main, actions);
    root.append(item);
  }
}

async function openHistoryRecord(promptId) {
  const record = await storage.getPrompt(promptId);
  if (!record) { showToast("That prompt could not be found.", "error"); return; }
  renderActiveRecord(record);
  navigate("create");
  $("#resultsSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function clearHistory() {
  if (!window.confirm("Clear all saved prompts and their version histories? This cannot be undone.")) return;
  await storage.clearHistory();
  state.activeRecord = null;
  $("#resultsSection").classList.add("hidden");
  await loadHistory($("#historySearch").value);
  showToast("Prompt history cleared.");
}

async function testConnection() {
  if (state.isBusy) return;
  const settings = readSettingsForm();
  const validation = validateSettings(settings);
  if (!validation.valid) { showSettingsMessage(validation.errors.join(" "), true); return; }
  const typedKey = $("#apiKey").value.trim();
  setBusy(true, "settings");
  showSettingsMessage("Requesting endpoint access and testing the connection…");
  const permissionPromise = ensureEndpointPermission(settings.endpoint);
  try {
    await permissionPromise;
    const key = typedKey || await storage.getApiKey();
    const service = new AIService(settings, key);
    const message = await service.testConnection();
    showSettingsMessage(message);
    showToast("AI connection successful.");
  } catch (error) {
    showSettingsMessage(getErrorMessage(error), true);
  } finally {
    setBusy(false, "settings");
  }
}

function bindEvents() {
  $$(".nav-item[data-view]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view)));
  $("#openSettingsShortcut").addEventListener("click", () => navigate("settings"));
  $("#sourceInput").addEventListener("input", () => {
    $("#inputCounter").textContent = `${$("#sourceInput").value.length.toLocaleString()} / 50,000`;
  });
  $("#clearInput").addEventListener("click", () => {
    $("#sourceInput").value = "";
    $("#inputCounter").textContent = "0 / 50,000";
    $("#sourceInput").focus();
  });
  $("#generateButton").addEventListener("click", () => runGenerate());
  $("#regeneratePrompt").addEventListener("click", () => runGenerate({ append: true }));
  $("#generatedPrompt").addEventListener("input", () => {
    updateOutputCounter();
    const editedSections = parseIcepotMarkdown($("#generatedPrompt").value);
    if (validateIcepotSections(editedSections).valid) buildSectionsCards(editedSections);
  });
  $("#saveEdits").addEventListener("click", saveEdits);
  $("#copyPrompt").addEventListener("click", () => copyText($("#generatedPrompt").value, "Complete ICEPOT prompt copied."));
  $("#downloadPrompt").addEventListener("click", () => {
    if (!state.activeRecord) return;
    const title = state.activeRecord.title || "promptforge_prompt";
    const markdown = $("#generatedPrompt").value;
    const filename = createFilename(title);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${filename}.`);
  });
  $("#toggleAnalysis").addEventListener("click", () => {
    const isHidden = $("#analysisDetails").classList.toggle("hidden");
    $("#toggleAnalysis").textContent = isHidden ? "Show" : "Hide";
  });
  $("#compareVersion").addEventListener("change", (event) => renderVersionComparison(event.target.value));
  $("#historySearch").addEventListener("input", () => loadHistory($("#historySearch").value));
  $("#clearHistoryButton").addEventListener("click", clearHistory);

  $("#settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveSettingsFromForm();
      showToast("Settings saved.");
    } catch (error) { showSettingsMessage(getErrorMessage(error), true); }
  });
  $("#testConnection").addEventListener("click", testConnection);
  $("#clearApiKey").addEventListener("click", async () => {
    if (!window.confirm("Remove the saved API key from this extension?")) return;
    await storage.clearApiKey();
    state.hasApiKey = false;
    updateKeyStatus();
    showSettingsMessage("Saved API key removed.");
    showToast("API key removed.");
  });
  $("#provider").addEventListener("change", (event) => {
    const endpoints = {
      "openai-compatible": "https://api.openai.com/v1/chat/completions",
      groq: "https://api.groq.com/openai/v1/chat/completions",
      anthropic: "https://api.anthropic.com/v1/messages",
      gemini: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    };
    $("#endpoint").value = endpoints[event.target.value];
  });
}

async function initialize() {
  try {
    state.settings = await storage.getSettings();
    state.hasApiKey = await storage.hasApiKey();
    populateSettings(state.settings);
    await loadHistory();
  } catch (error) {
    showToast(`Initialization warning: ${getErrorMessage(error)}`, "error");
  }
  bindEvents();
  navigate(location.hash.slice(1) || "create");
}

initialize();
