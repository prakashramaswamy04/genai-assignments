// Port of NaviCase handleGenerate: manual test cases from the recorded journey.
// Same validation caps, prompt, parsing, priority filter and result shape.

import { buildPrompt, normalizeResult } from "./prompts/prompt.js";
import { parseModelJsonLenient } from "./jsonRepair.js";
import { resolveModelOptions } from "./llm/options.js";
import { callModel } from "./llm/callModel.js";
import { HttpError } from "./llm/http.js";
import { buildUsage } from "./usage.js";
import { COVERAGE_TYPES, PRIORITIES, MAX_EVENTS } from "../shared/constants.js";
import { sanitizeEvent, sanitizeSnapshot, sanitizeFreeText } from "../shared/security.js";

export async function handleGenerate(payload, { onStage = () => {} } = {}) {
  const options = resolveModelOptions(payload);
  const events = Array.isArray(payload.events) ? payload.events.slice(-MAX_EVENTS).map((event) => sanitizeEvent(event)) : [];
  const coverage = Array.isArray(payload.coverage) ? payload.coverage.filter((c) => COVERAGE_TYPES.includes(c)) : [];
  const requested = Array.isArray(payload.priorities) ? PRIORITIES.filter((p) => payload.priorities.includes(p)) : [];
  const priorities = requested.length ? requested : PRIORITIES;
  const language = String(payload.language || "US English").slice(0, 40);
  const customPrompt = payload.useCustomPrompt ? sanitizeFreeText(String(payload.customPrompt || ""), 6000) : "";
  const maxCases = Math.min(40, Math.max(1, Number(payload.maxCases) || 15));
  const page = sanitizeSnapshot(payload.page && typeof payload.page === "object" ? payload.page : {});
  const recordedCase = events.length ? buildRecordedCase(events) : null;
  const requestedVariations = maxCases - Number(Boolean(recordedCase));

  const warnings = [];
  let result = { summary: "", testCases: [], usage: null };
  if (requestedVariations > 0) {
    const { system, user } = buildPrompt({ events, page, language, coverage, priorities, customPrompt, maxCases: requestedVariations });
    onStage("calling");
    const reply = await callModel({ ...options, system, user, json: true });
    onStage("parsing");
    if (reply.truncated) warnings.push("The model hit its output limit; the response may be incomplete.");
    try {
      const raw = parseModelJsonLenient(reply.text);
      validateGeneratedCases(raw, requestedVariations);
      result = sanitizeSnapshot(normalizeResult(raw, requestedVariations));
      result.usage = buildUsage(options.model, reply.inputTokens, reply.outputTokens, reply.reasoningTokens);
    } catch (err) {
      throw new HttpError(502, `${err.message}. Try again or pick a different model.`);
    }
  }

  const kept = result.testCases.filter((tc) => priorities.includes(tc.priority));
  if (kept.length !== result.testCases.length) {
    throw new HttpError(502, `The model returned a priority outside your selected set (${priorities.join(", ")}). Try again.`);
  }
  result.testCases = [...(recordedCase ? [recordedCase] : []), ...kept]
    .map((tc, i) => ({ ...tc, id: `TC-${String(i + 1).padStart(3, "0")}` }));
  if (result.testCases.length !== maxCases) throw new HttpError(502, `Expected ${maxCases} test case(s), but generation produced ${result.testCases.length}. Try again.`);
  if (recordedCase && requestedVariations === 0) result.summary = "Recorded browser journey.";

  return {
    ...result,
    meta: {
      provider: options.provider,
      model: options.model,
      priorities,
      eventCount: events.length,
      generatedAt: new Date().toISOString(),
    },
    warnings,
  };
}

export function validateGeneratedCases(raw, expectedCount) {
  if (!Array.isArray(raw?.testCases)) throw new Error("The model response must include a testCases array.");
  if (raw.testCases.length !== expectedCount) throw new Error(`Expected ${expectedCount} test case(s), but the model returned ${raw.testCases.length}.`);
  const ids = new Set();
  for (const [index, item] of raw.testCases.entries()) {
    const number = index + 1;
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Test case ${number} is not an object.`);
    for (const field of ["id", "title", "module", "type", "priority", "preconditions", "testData", "steps", "expectedResult"]) {
      if (item[field] === undefined || item[field] === null) throw new Error(`Test case ${number} is missing required field "${field}".`);
    }
    for (const field of ["title", "module", "type", "priority", "expectedResult"]) {
      if (typeof item[field] !== "string" || !item[field].trim()) throw new Error(`Test case ${number} has an invalid or empty "${field}".`);
    }
    if (!COVERAGE_TYPES.includes(item.type) && item.type !== "End-to-End") throw new Error(`Test case ${number} has unsupported type "${item.type}".`);
    if (!PRIORITIES.includes(item.priority)) throw new Error(`Test case ${number} has unsupported priority "${item.priority}".`);
    if (!Array.isArray(item.steps) || !item.steps.length) throw new Error(`Test case ${number} must include at least one step.`);
    if (!Array.isArray(item.preconditions) || item.preconditions.some(value => typeof value !== "string")
        || !Array.isArray(item.testData) || item.testData.some(value => typeof value !== "string")
        || typeof item.expectedResult !== "string" || !item.expectedResult.trim()) {
      throw new Error(`Test case ${number} has an invalid preconditions, testData, or expectedResult field.`);
    }
    for (const [stepIndex, step] of item.steps.entries()) {
      if (!step || typeof step !== "object" || typeof step.action !== "string" || !step.action.trim()
          || typeof step.expected !== "string" || !step.expected.trim()) {
        throw new Error(`Test case ${number}, step ${stepIndex + 1} is incomplete.`);
      }
      if (step.actionType !== undefined && !["navigate", "click", "change", "select", "check", "submit", "keydown", "input", "unknown"].includes(step.actionType)) {
        throw new Error(`Test case ${number}, step ${stepIndex + 1} has an unsupported action type.`);
      }
    }
    const id = String(item.id);
    if (ids.has(id)) throw new Error("The model response contains duplicate test-case IDs.");
    ids.add(id);
  }
}

function targetName(target = {}) {
  return target.label || target.text || target.ariaLabel || target.placeholder || target.name || target.id || target.selector || target.tag || "page";
}

function buildRecordedCase(events) {
  const steps = events.map((event, index) => {
    const name = targetName(event.target);
    let action;
    if (event.type === "navigate") action = `Navigate to ${event.url || event.pageUrl || "the recorded page"}`;
    else if (event.type === "click") action = `Click ${name}`;
    else if (event.type === "change") action = `Enter ${event.value === "••••••" ? "the recorded value" : `"${event.value ?? ""}"`} in ${name}`;
    else if (event.type === "select") action = `Select "${event.value ?? ""}" in ${name}`;
    else if (event.type === "check") action = `${event.checked ? "Check" : "Uncheck"} ${name}`;
    else if (event.type === "submit") action = `Submit ${name}`;
    else if (event.type === "keydown") action = `Press ${event.key || "the recorded key"} in ${name}`;
    else action = `${event.type || "Perform"} on ${name}`;
    return {
      step: index + 1,
      action,
      expected: "Recorded interaction is performed; no application outcome was independently asserted.",
      actionType: event.type,
      target: event.target,
      ...(event.url ? { url: event.url } : {}),
      ...(event.value !== undefined ? { value: event.value } : {}),
      ...(event.checked !== undefined ? { checked: event.checked } : {}),
      ...(event.key ? { key: event.key } : {}),
      ...(event.frame ? { frame: event.frame } : {}),
    };
  });
  return {
    id: "TC-001",
    title: "User Input",
    module: "Recorded Journey",
    type: "End-to-End",
    priority: "High",
    preconditions: ["The browser is on the starting page of the recorded journey."],
    testData: events.filter(event => event.value !== undefined).map(event => `${targetName(event.target)} = ${event.value}`),
    steps,
    expectedResult: "All captured interactions are replayed in chronological order.",
  };
}
