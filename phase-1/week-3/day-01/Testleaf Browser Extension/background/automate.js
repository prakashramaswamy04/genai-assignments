// Port of NaviCase handleAutomate: selected manual test cases → Playwright /
// Selenium script. Same validation caps, prompt, parsing and result shape.

import { FRAMEWORKS, buildAutomationPrompt, parseScript } from "./prompts/automationPrompt.js";
import { resolveModelOptions } from "./llm/options.js";
import { callModel } from "./llm/callModel.js";
import { HttpError } from "./llm/http.js";
import { buildUsage } from "./usage.js";
import { MAX_EVENTS, MAX_REFERENCE_BYTES, MAX_SCRIPT_BYTES } from "../shared/constants.js";
import { sanitizeEvent, sanitizeFreeText, sanitizeSnapshot } from "../shared/security.js";
import { generateLocalAutomation } from "./localAutomation.js";

export async function handleAutomate(payload, { onStage = () => {} } = {}) {
  const framework = String(payload.framework || "").toLowerCase();
  if (!FRAMEWORKS[framework]) throw new HttpError(400, `Unknown framework "${payload.framework}". Use one of: ${Object.keys(FRAMEWORKS).join(", ")}`);
  const fw = FRAMEWORKS[framework];
  const mode = payload.mode === "template" ? "template" : "ai";
  const allowed = mode === "template" ? fw.languages : fw.supported || fw.languages;
  const language = String(payload.language || allowed[0]);
  if (!allowed.includes(language)) throw new HttpError(400, `${fw.label} code generation is available only in ${allowed.join(" / ")}. Select ${allowed[0]} in the Language dropdown.`);
  const rawReferenceScript = String(payload.referenceScript || "");
  if (new TextEncoder().encode(rawReferenceScript).length > MAX_REFERENCE_BYTES) throw new HttpError(400, "Reference script exceeds the 250 KB limit.");
  const referenceScript = sanitizeFreeText(rawReferenceScript, MAX_REFERENCE_BYTES);
  const testCases = Array.isArray(payload.testCases) ? sanitizeSnapshot(payload.testCases.slice(0, 40)) : [];
  if (!testCases.length) throw new HttpError(400, "Select at least one manual test case to automate");
  const events = Array.isArray(payload.events) ? payload.events.slice(-MAX_EVENTS).map((event) => sanitizeEvent(event)) : [];
  const page = sanitizeSnapshot(payload.page && typeof payload.page === "object" ? payload.page : {});

  if (mode === "template") return generateLocalAutomation({ framework, language, testCases });

  const options = resolveModelOptions(payload);
  const warnings = [];
  const { system, user } = buildAutomationPrompt({ framework, language, referenceScript, testCases, events, page });
  onStage("calling");
  const reply = await callModel({ ...options, system, user, json: false });
  onStage("parsing");

  if (reply.truncated) warnings.push("The model hit its output limit; the script may be cut off. Select fewer test cases and try again.");
  const script = parseScript(reply.text, framework);
  if (!script.code) throw new HttpError(502, "The model returned no script. Try again or pick a different model.");
  if (new TextEncoder().encode(script.code).length > MAX_SCRIPT_BYTES) throw new HttpError(502, "Generated script exceeds the safety limit. Select fewer test cases and try again.");
  if (sanitizeFreeText(script.code, MAX_SCRIPT_BYTES) !== script.code) throw new HttpError(502, "Generated script appears to contain a credential or sensitive value. Output was rejected.");
  if (/[\w$.]+\.(?:fill|send_keys|sendKeys|SendKeys|Input Text|Fill Text)\s*\(\s*["'](?:••••••|<masked>|\[REDACTED\])/i.test(script.code)
      || /(?:Input Text|Fill Text)\s{2,}[^\n]*\s{2,}(?:••••••|<masked>|\[REDACTED\])/i.test(script.code)) {
    throw new HttpError(502, "Generated script attempts to type a redacted value. Output was rejected.");
  }
  assertGroundedOutput(script.code, { testCases, events, page });
  if (language.startsWith("Robot Framework")) {
    const library = language === "Robot Framework (Browser)" ? "Browser" : "SeleniumLibrary";
    if (!/^\*\*\* Settings \*\*\*/m.test(script.code) || !/^\*\*\* Variables \*\*\*/m.test(script.code)
        || !/^\*\*\* Test Cases \*\*\*/m.test(script.code) || !new RegExp(`^Library\\s+${library}$`, "m").test(script.code)) {
      throw new HttpError(502, `Robot Framework output must include Settings, Variables and Test Cases sections and use ${library}.`);
    }
  }
  if (script.fence && script.fence !== language) throw new HttpError(502, `The model returned ${script.fence} code instead of the selected ${language}. Try again.`);
  if (!events.length) warnings.push("No recorded actions were available, so locators come only from the page snapshot.");

  return {
    framework,
    language: referenceScript.trim() && !fw.supported ? script.fence || language : language,
    code: script.code,
    gaps: script.gaps,
    caseIds: testCases.map((tc) => String(tc.id)),
    meta: { provider: options.provider, model: options.model, usedReference: Boolean(referenceScript.trim()), generatedAt: new Date().toISOString() },
    usage: buildUsage(options.model, reply.inputTokens, reply.outputTokens, reply.reasoningTokens),
    warnings,
  };
}

export function assertGroundedOutput(code, { testCases, events, page }) {
  const locators = new Set();
  const urls = new Set();
  const values = new Set();
  const visit = (value, key = "") => {
    if (typeof value === "string") {
      if (["selector", "cssSelector", "id", "name", "label", "ariaLabel", "placeholder", "text", "role"].includes(key)) {
        locators.add(value);
        if (key === "id") locators.add(`#${value}`);
      }
      if (["url", "href"].includes(key) && /^https?:\/\//i.test(value)) urls.add(value);
      if (key === "value" && !["••••••", "<masked>", "[REDACTED]"].includes(value)) values.add(value);
      if (key === "testData") {
        values.add(value);
        const dataValue = value.match(/(?:=|:)\s*["']?(.+?)["']?\s*$/);
        if (dataValue?.[1]) values.add(dataValue[1]);
      }
      return;
    }
    if (Array.isArray(value)) return value.forEach(item => visit(item, key));
    if (value && typeof value === "object") for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
  };
  visit(testCases);
  visit(events);
  visit(page);
  const literal = /(?:locator|Locator|getByLabel|getByPlaceholder|getByText|findElement|FindElement|By\.(?:id|name|css|cssSelector|CSS_SELECTOR|XPATH|ID|NAME)|By\.(?:CssSelector|Id|Name))\s*\(\s*(['"])(.*?)\1/g;
  const failures = [];
  let match;
  while ((match = literal.exec(code))) {
    const value = match[2].replace(/\\(['"\\])/g, "$1");
    if (!locators.has(value)) failures.push(value);
  }
  const pythonLocator = /\bBy\.(?:CSS_SELECTOR|XPATH|ID|NAME)\s*,\s*(['"])(.*?)\1/g;
  while ((match = pythonLocator.exec(code))) {
    if (!locators.has(match[2].replace(/\\(['"\\])/g, "$1"))) failures.push(match[2]);
  }
  const roleLocator = /getByRole\s*\(\s*(['"])(.*?)\1\s*,\s*\{[^}]*?name:\s*(['"])(.*?)\3/g;
  while ((match = roleLocator.exec(code))) {
    if (!locators.has(match[2])) failures.push(match[2]);
    if (!locators.has(match[4])) failures.push(match[4]);
  }
  const navigation = /(?:\.goto|\.get|\.navigate|Go To|GoToAsync|GoToUrl)\s*\(?\s*(['"])(https?:\/\/.*?)\1/g;
  while ((match = navigation.exec(code))) {
    const value = match[2].replace(/\\(['"\\])/g, "$1");
    if (!urls.has(value)) failures.push(value);
  }
  const robotNavigation = /^\s*Go To\s{2,}(https?:\/\/\S+)/gm;
  while ((match = robotNavigation.exec(code))) if (!urls.has(match[1])) failures.push(match[1]);
  const redactedInput = /(?:\.fill|\.send_keys|\.sendKeys|\.SendKeys)\s*\(\s*(['"])(?:••••••|<masked>|\[REDACTED\])\1/i;
  if (redactedInput.test(code)) throw new HttpError(502, "Generated script attempts to type a redacted value. Output was rejected.");
  const inputValue = /(?:\.fill|\.send_keys|\.sendKeys|\.SendKeys|\.selectOption|\.select_option|\.SelectOptionAsync|\.selectByVisibleText|\.SelectByText|\.select_by_visible_text)\s*\(\s*(['"])(.*?)\1/g;
  while ((match = inputValue.exec(code))) {
    const value = match[2].replace(/\\(['"\\])/g, "$1");
    if (!values.has(value)) failures.push(`value: ${value}`);
  }
  const robotValue = /(?:Input Text|Fill Text)\s{2,}(?:\$\{[^}]+\}|[^\s]+)\s{2,}([^\n]+)/g;
  while ((match = robotValue.exec(code))) {
    const value = match[1].trim();
    if (value && !values.has(value)) failures.push(`value: ${value}`);
  }
  if (/^\*\*\* Variables \*\*\*/m.test(code)) {
    const definitions = [...code.matchAll(/^\$\{([^}]+)\}\s{2,}(.+)$/gm)];
    const names = definitions.map(item => item[1]);
    if (new Set(names).size !== names.length) throw new HttpError(502, "Robot Framework locator variables must have unique names.");
    const locatorValues = definitions
      .map(item => item[2].trim().replace(/^(?:css=|css:)/i, ""))
      .filter(value => locators.has(value));
    if (new Set(locatorValues).size !== locatorValues.length) throw new HttpError(502, "Robot Framework output must reuse each unique locator variable once.");
    for (const item of definitions) {
      const value = item[2].trim().replace(/^(?:css=|css:)/i, "");
      if (!locators.has(value) && !urls.has(value) && !values.has(value)) failures.push(value);
    }
  }
  if (failures.length) throw new HttpError(502, `Generated script contains ungrounded locator(s), URL(s), or input value(s): ${[...new Set(failures)].slice(0, 6).join(", ")}. Add the missing page context or use a grounded template.`);
}
