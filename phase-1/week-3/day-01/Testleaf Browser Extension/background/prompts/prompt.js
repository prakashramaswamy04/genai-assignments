// Prompt construction and response parsing for manual test-case generation.
// Prompt is structured with ICEPOT: Instruction, Context, Example, Persona, Output format, Tone.
// Automation scripts are generated separately (see automationPrompt.js).

const ALL_TYPES = ["Functional", "Negative", "Boundary", "Validation", "Accessibility", "Security", "Compatibility", "Exploratory", "Edge Case", "UI", "Usability"];
const ALL_PRIORITIES = ["Critical", "High", "Medium", "Low"];

// ---------- P: Persona ----------
const PERSONA = `You are a senior QA engineer with 10+ years of experience writing manual test cases for web applications.
You are precise, exhaustive within scope, and you always deliver exactly the number of test cases requested.`;

// Kept for the side panel ("built-in prompt" preview) and backward compatibility.
export const DEFAULT_INSTRUCTIONS = `Derive test cases from the recorded user journey and the page snapshot.
Cover the happy path first, then negative, boundary, validation, UI-state and accessibility scenarios that the page supports.
Every step must be concrete and executable by a manual tester: name the exact field, button or link as it appears on the page.
Do not invent features, fields or endpoints that the recording and snapshot do not show.`;

// Simple ICEPOT view of the built-in prompt, shown in the side panel.
export const ICEPOT_PREVIEW = [
  { key: "I", name: "Instruction", text: DEFAULT_INSTRUCTIONS },
  { key: "C", name: "Context", text: "The page snapshot (fields, buttons, links) and the recorded user actions, in order." },
  { key: "E", name: "Example", text: 'TC-001 · Sign in with valid email and password\n1. Enter the email in the "Email" field\n2. Enter the password in the "Password" field\n3. Click the "Sign in" button → Dashboard page loads' },
  { key: "P", name: "Persona", text: "Senior QA engineer with 10+ years of experience writing manual test cases for web applications." },
  { key: "O", name: "Output", text: "One JSON object: summary + test cases (id, title, type, priority, steps, expected result)." },
  { key: "T", name: "Tone", text: 'Professional, precise and imperative ("Enter", "Click", "Verify"). No filler.' },
];

// ---------- E: Example (one compact case to anchor shape and granularity) ----------
const EXAMPLE_CASE = `{
  "id": "TC-001",
  "title": "Sign in with valid email and password",
  "module": "Login",
  "type": "Functional",
  "priority": "High",
  "preconditions": ["A registered account exists"],
  "testData": ["Email = user@example.com", "Password = Valid@123"],
  "steps": [
    { "step": 1, "action": "Enter the email in the \\"Email\\" field", "expected": "Value is shown in the field" },
    { "step": 2, "action": "Enter the password in the \\"Password\\" field", "expected": "Value is masked" },
    { "step": 3, "action": "Click the \\"Sign in\\" button", "expected": "Dashboard page loads" }
  ],
  "expectedResult": "User is signed in and lands on the dashboard"
}`;

/** Split n cases across the given buckets as evenly as possible. */
function distribute(n, list) {
  const base = Math.floor(n / list.length);
  let extra = n % list.length;
  return list.map((t) => ({ type: t, count: base + (extra-- > 0 ? 1 : 0) })).filter((d) => d.count > 0);
}

export function buildPrompt({ events, page, language, coverage, priorities, customPrompt, maxCases }) {
  const n = Math.max(1, Number(maxCases) || 10);
  const types = (coverage ?? []).filter((t) => ALL_TYPES.includes(t));
  const plan = distribute(n, types.length ? types : ["Functional", "Negative", "Boundary", "UI", "Accessibility"]);
  const planText = plan.map((d) => `  - ${d.type}: ${d.count}`).join("\n");
  const prios = ALL_PRIORITIES.filter((p) => (priorities ?? ALL_PRIORITIES).includes(p));
  const allowed = prios.length ? prios : ALL_PRIORITIES;
  const excluded = ALL_PRIORITIES.filter((p) => !allowed.includes(p));
  const prioPlanText = distribute(n, allowed).map((d) => `  - ${d.type}: ${d.count}`).join("\n");
  const lastId = `TC-${String(n).padStart(3, "0")}`;
  const instructions = customPrompt?.trim() ? customPrompt.trim() : DEFAULT_INSTRUCTIONS;
  const example = EXAMPLE_CASE.replace('"priority": "High"', `"priority": "${allowed[0]}"`);

  const system = `# PERSONA
${PERSONA}

# INSTRUCTION
${instructions}

HARD REQUIREMENT — TEST CASE COUNT:
- Generate EXACTLY ${n} test cases. Not fewer, not more.
- IDs must run consecutively from TC-001 to ${lastId}.
- Use this distribution by type (total ${n}):
${planText}

HARD REQUIREMENT — PRIORITY:
- Every test case's "priority" must be one of: ${allowed.join(" | ")}.${excluded.length ? `\n- Do NOT generate any ${excluded.join(" or ")} priority test cases.` : ""}
- Use this distribution by priority (total ${n}), assigning each case the priority its business risk actually warrants:
${prioPlanText}
- If the recorded journey looks too small for ${n} distinct cases, still reach ${n} by adding valid variations the page supports: other valid/invalid data per field, empty/whitespace input, min/max/length limits, special characters, field-level validation messages, keyboard-only navigation, focus order, labels, repeat submission, browser back/refresh, error-state recovery.
- Every case must be distinct (different data, condition or expected result). No duplicates or near-duplicates.
- Keep each case compact (3–6 steps, short sentences) so all ${n} cases fit in one response. Prefer more cases over longer cases.

# CONTEXT
- The user message contains the page snapshot (forms, fields with constraints, buttons, links, alerts; content of embedded iframes is under "frames") and the recorded user actions in order.
- When an action happened inside an iframe (marked "inside iframe"), say so in the step if it helps the tester find the element, e.g. "In the payment frame, enter …".
- Use only UI elements that appear there. Name them exactly as shown.
- Test data: reuse the exact values the user entered in the recorded actions. For other variations, derive values from field labels, placeholders, select options and constraints (required, min/max, length, pattern) in the snapshot. Values shown as "••••••" or "<masked>" were hidden on purpose: describe them (e.g. "Password = valid password of the account") instead of inventing one.
- Write all human-readable text in ${language}.

# EXAMPLE (shape and level of detail for ONE test case)
${example}

# OUTPUT FORMAT
Respond with a single JSON object only. No markdown fences, no text before or after it.
{
  "summary": "one-paragraph description of the feature under test",
  "caseCount": ${n},
  "testCases": [ /* exactly ${n} objects shaped like the EXAMPLE */ ]
}
- "type" is one of: ${ALL_TYPES.join(" | ")}.
- "Edge Case" means unusual-but-possible conditions, distinct from Boundary (min/max limits): double-click or repeated submit, browser back/refresh mid-flow, multiple tabs, session expiry, slow or dropped network, leading/trailing whitespace, Unicode/emoji or very long text, empty or first-use states.
- "priority" is one of: ${allowed.join(" | ")}.

Before you finish, verify silently: testCases.length === ${n}, last id is ${lastId}, type and priority distributions match the plan, no case uses a priority outside ${allowed.join("/")}. If not, fix it before responding.

# TONE
Professional, precise and imperative ("Enter", "Click", "Verify"). No filler, no explanations outside the JSON.`;

  const userSections = [
    `Generate exactly ${n} test cases (TC-001 to ${lastId}), priorities limited to ${allowed.join(", ")}.`,
    "",
    "## Page under test",
    JSON.stringify(page ?? {}, null, 1),
    "",
    `## Recorded user actions (${events.length})`,
    events.length
      ? events.map((e, i) => `${i + 1}. ${describeEvent(e)}`).join("\n")
      : "No actions were recorded; derive test cases from the page structure.",
    "",
    `Reminder: the testCases array must contain exactly ${n} items.`,
  ];

  return { system, user: userSections.join("\n") };
}

/**
 * Follow-up prompt when the model returned fewer cases than requested.
 * Server can call the same provider again with this and merge via mergeTopUp().
 */
export function buildTopUpPrompt({ existing, missing, startIndex, language }) {
  const from = `TC-${String(startIndex).padStart(3, "0")}`;
  const titles = existing.map((tc) => `- ${tc.id}: ${tc.title} [${tc.type}]`).join("\n");
  return {
    system: `${PERSONA}
Generate EXACTLY ${missing} additional test cases, numbered from ${from}, in ${language}.
They must not duplicate any existing case listed by the user.
Respond with a single JSON object only: { "testCases": [ ... ] } using the same test case shape as before.
Keep each case to 3–6 steps.`,
    user: `Existing test cases:\n${titles}\n\nAdd ${missing} new, distinct test cases starting at ${from}.`,
  };
}

export function mergeTopUp(result, raw, maxCases) {
  const extra = normalizeResult(raw).testCases;
  const merged = [...result.testCases, ...extra].slice(0, maxCases);
  return { ...result, testCases: renumber(merged) };
}

function describeEvent(e) {
  const hop = e.frame?.[e.frame.length - 1];
  const where = hop ? ` (inside iframe "${hop.title || hop.name || hop.id || hop.selector || hop.src || "unknown"}")` : "";
  return describeAction(e) + where;
}

function describeAction(e) {
  const t = e.target ?? {};
  const label = t.label || t.text || t.ariaLabel || t.placeholder || t.name || t.id || t.selector || t.tag;
  switch (e.type) {
    case "navigate":
      return `Navigated to ${e.url}${e.title ? ` ("${e.title}")` : ""}`;
    case "click":
      return `Clicked ${t.role || t.tag} "${label}"`;
    case "input":
    case "change":
      return `Entered ${e.value === undefined ? "a value" : `"${e.value}"`} in ${t.inputType || t.tag} "${label}"`;
    case "select":
      return `Selected "${e.value}" in "${label}"`;
    case "check":
      return `${e.checked ? "Checked" : "Unchecked"} "${label}"`;
    case "submit":
      return `Submitted form "${label}"`;
    case "keydown":
      return `Pressed ${e.key} in "${label}"`;
    default:
      return `${e.type} on "${label}"`;
  }
}

/** Extract the JSON object from a model reply, tolerating fences or preamble. */
export function parseModelJson(text) {
  if (!text) throw new Error("The model returned an empty response");
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("The model response was not valid JSON");
  }
}

/** maxCases is optional; when given, extra cases are trimmed and a shortfall is reported. */
export function normalizeResult(raw, maxCases) {
  const cases = Array.isArray(raw?.testCases) ? raw.testCases : [];
  let testCases = cases.map((tc, i) => ({
    id: tc.id || `TC-${String(i + 1).padStart(3, "0")}`,
    title: tc.title || "Untitled test case",
    module: tc.module || "",
    type: tc.type || "Functional",
    priority: normalizePriority(tc.priority),
    preconditions: asList(tc.preconditions),
    testData: asList(tc.testData),
    steps: (Array.isArray(tc.steps) ? tc.steps : []).map((s, j) =>
      typeof s === "string"
        ? { step: j + 1, action: s, expected: "" }
        : { step: s.step ?? j + 1, action: s.action ?? "", expected: s.expected ?? "" },
    ),
    expectedResult: tc.expectedResult || "",
  }));

  if (maxCases) testCases = testCases.slice(0, maxCases);

  return {
    summary: typeof raw?.summary === "string" ? raw.summary : "",
    testCases,
    shortfall: maxCases ? Math.max(0, maxCases - testCases.length) : 0,
  };
}

function renumber(cases) {
  return cases.map((tc, i) => ({ ...tc, id: `TC-${String(i + 1).padStart(3, "0")}` }));
}

/** "high", "HIGH", "P1 - High" -> "High"; unknown values fall back to Medium. */
function normalizePriority(v) {
  const s = String(v ?? "").toLowerCase();
  return ALL_PRIORITIES.find((p) => s.includes(p.toLowerCase())) || "Medium";
}

const asList = (v) => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);