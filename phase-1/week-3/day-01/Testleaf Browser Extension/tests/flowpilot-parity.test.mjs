import test from "node:test";
import assert from "node:assert/strict";
import { handleGenerate, validateGeneratedCases } from "../background/generate.js";
import { assertGroundedOutput, handleAutomate } from "../background/automate.js";
import { generateLocalAutomation } from "../background/localAutomation.js";
import { toCsv } from "../sidepanel/export.js";
import { sanitizeEvent, sanitizeFreeText, sanitizeSnapshot, sanitizeUrl } from "../shared/security.js";
import { MAX_EVENTS, MAX_RECORDING_BYTES } from "../shared/constants.js";

const sampleCase = {
  id: "TC-001",
  title: "Recorded sign in",
  steps: [
    { step: 1, action: "Open sign-in page", actionType: "navigate", url: "https://example.test/login" },
    { step: 2, action: "Enter email", actionType: "change", target: { selector: "#email", id: "email" }, value: "qa@example.test" },
    { step: 3, action: "Click submit", actionType: "click", target: { selector: "#submit" } },
  ],
};

test("recorded events and snapshots redact sensitive values and URL credentials", () => {
  const event = sanitizeEvent({
    type: "change",
    url: "https://user:pass@example.test/login?access_token=secret",
    target: { inputType: "text", name: "verification_code", label: "Verification code" },
    value: "482913",
  });
  assert.equal(event.value, "••••••");
  assert.doesNotMatch(event.url, /user|pass|secret/);
  assert.doesNotMatch(sanitizeUrl("https://example.test/?api_key=private"), /private/);

  const snapshot = sanitizeSnapshot({ fields: [{ type: "password", name: "password", value: "not-for-storage" }] });
  assert.equal(snapshot.fields[0].value, "••••••");
  assert.doesNotMatch(JSON.stringify(snapshot), /not-for-storage/);
  assert.match(sanitizeFreeText("const PASSWORD = process.env.SHOP_PASSWORD;"), /process\.env\.SHOP_PASSWORD/);
});

test("recording a journey creates the first User Input case without an AI request", async () => {
  let stages = 0;
  const result = await handleGenerate({
    provider: "groq",
    maxCases: 1,
    events: [
      { type: "navigate", url: "https://example.test/login", ts: 1 },
      { type: "change", target: { inputType: "text", name: "email" }, value: "qa@example.test", ts: 2 },
    ],
    priorities: ["High"],
  }, { onStage: () => stages++ });

  assert.equal(stages, 0);
  assert.equal(result.testCases.length, 1);
  assert.equal(result.testCases[0].title, "User Input");
  assert.deepEqual(result.testCases[0].steps.map(step => step.step), [1, 2]);
  assert.equal(result.usage, null);
});

test("AI results are checked for exact count, required fields and duplicate IDs", () => {
  const generated = {
    testCases: [{
      id: "TC-001", title: "Valid case", module: "Login", type: "Functional", priority: "High",
      preconditions: [], testData: [], steps: [{ step: 1, action: "Open page", expected: "Page appears" }],
      expectedResult: "Login page appears",
    }],
  };
  assert.doesNotThrow(() => validateGeneratedCases(generated, 1));
  assert.throws(() => validateGeneratedCases(generated, 2), /Expected 2 test case/);
  assert.throws(() => validateGeneratedCases({ testCases: [{ ...generated.testCases[0], title: "" }] }, 1), /title/);
  assert.throws(() => validateGeneratedCases({ testCases: [generated.testCases[0], generated.testCases[0]] }, 2), /duplicate/);
});

test("local templates cover all FlowPilot framework-language pairs and never type masked data", () => {
  const options = [
    ["playwright", "TypeScript"], ["playwright", "JavaScript"], ["playwright", "Python"], ["playwright", "Java"],
    ["playwright", "C#"], ["playwright", "Robot Framework (Browser)"],
    ["selenium", "Java"], ["selenium", "Python"], ["selenium", "JavaScript"], ["selenium", "C#"],
    ["selenium", "Robot Framework (SeleniumLibrary)"],
  ];
  for (const [framework, language] of options) {
    const result = generateLocalAutomation({ framework, language, testCases: [sampleCase] });
    assert.ok(result.filename);
    assert.ok(result.code.includes("example.test"));
    if (language === "JavaScript") assert.doesNotThrow(() => new Function(result.code));
  }

  const maskedCase = { ...sampleCase, steps: [{ ...sampleCase.steps[1], value: "••••••" }] };
  const output = generateLocalAutomation({ framework: "playwright", language: "TypeScript", testCases: [maskedCase] });
  assert.ok(output.gaps.some(gap => /masked/i.test(gap)));
  assert.doesNotMatch(output.code, /\.fill\(["']••••••/);
});

test("local automation runs without provider credentials and AI grounding rejects invented selectors", async () => {
  const local = await handleAutomate({
    mode: "template",
    framework: "playwright",
    language: "Python",
    testCases: [sampleCase],
  });
  assert.equal(local.filename, "test_ledge.py");
  assert.equal(local.language, "Python");

  const context = {
    testCases: [{ testData: ["Email = qa@example.test"], steps: [{ target: { selector: "#email" } }] }],
    events: [],
    page: {},
  };
  assert.doesNotThrow(() => assertGroundedOutput(`await page.locator("#email").fill("qa@example.test");`, context));
  assert.throws(() => assertGroundedOutput(`await page.locator("#made-up").click();`, context), /ungrounded/);
  assert.throws(() => assertGroundedOutput(`await page.locator("#email").fill("••••••");`, context), /redacted value/);
  assert.doesNotThrow(() => assertGroundedOutput(`driver.find_element(By.CSS_SELECTOR, "#email").send_keys("qa@example.test")`, context));

  const robot = `*** Settings ***
Library    Browser

*** Variables ***
\${BASE_URL}    https://example.test/login
\${EMAIL_LOCATOR}    css=#email

*** Test Cases ***
Recorded sign in
    Go To    https://example.test/login
    Fill Text    \${EMAIL_LOCATOR}    qa@example.test`;
  const robotContext = {
    ...context,
    testCases: [{ url: "https://example.test/login", testData: ["Email = qa@example.test"], steps: [{ target: { selector: "#email" } }] }],
  };
  assert.doesNotThrow(() => assertGroundedOutput(robot, robotContext));
  assert.throws(() => assertGroundedOutput(robot.replace("\${BASE_URL}    https://example.test/login", "\${LOCATOR_A}    css=#email\n\${LOCATOR_B}    css=#email"), robotContext), /reuse each unique locator/);
});

test("Robot templates define each captured locator once and CSV neutralizes formulas", () => {
  const repeated = [sampleCase, { ...sampleCase, id: "TC-002", title: "Repeat" }];
  const script = generateLocalAutomation({
    framework: "playwright",
    language: "Robot Framework (Browser)",
    testCases: repeated,
  }).code;
  assert.equal((script.match(/^\$\{LOCATOR_01\}\s+/gm) || []).length, 1);
  assert.equal((script.match(/\$\{LOCATOR_01\}/g) || []).length, 3);

  const csv = toCsv({ testCases: [{ ...sampleCase, title: '=HYPERLINK("https://example.test")', module: "", type: "Functional", priority: "High", preconditions: [], testData: [], expectedResult: "" }] });
  assert.match(csv, /'=HYPERLINK/);
  assert.ok(MAX_EVENTS >= 1_000);
  assert.ok(MAX_RECORDING_BYTES >= 1_048_576);
});
