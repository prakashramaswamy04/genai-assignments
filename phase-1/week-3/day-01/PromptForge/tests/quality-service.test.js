import test from "node:test";
import assert from "node:assert/strict";
import { assessPrompt, parseIcepotMarkdown, renderIcepotMarkdown } from "../services/quality-service.js";

const sections = {
  instruction: "Implement `validate_email(email: str) -> bool` using regex `r'^[\\w.-]+@[\\w.-]+\\.\\w+$'`.",
  context: "Existing Python application.",
  examples: "Valid and invalid email examples based on the supplied rule.",
  persona: "Senior Python developer.",
  outputFormat: "Return a complete Python function and tests.",
  tone: "Precise and technical."
};

test("ICEPOT Markdown renders and parses all six named sections", () => {
  const markdown = renderIcepotMarkdown(sections);
  assert.match(markdown, /^## 1\. Instruction/m);
  assert.match(markdown, /^## 5\. Output Format/m);
  const parsed = parseIcepotMarkdown(markdown);
  assert.deepEqual(parsed, sections);
});

test("quality assessment computes average score across eight dimensions", () => {
  const rawQuality = Object.fromEntries([
    "requirementCompleteness", "technicalAccuracy", "clarity", "contextSufficiency",
    "exampleQuality", "personaSuitability", "outputSpecificity", "constraintCoverage"
  ].map((key) => [key, 80]));
  const result = assessPrompt({ sections, rawQuality, sourceInput: "Use `validate_email(email: str) -> bool` and regex `r'^[\\w.-]+@[\\w.-]+\\.\\w+$'`." });
  assert.equal(result.overall, 80);
  assert.equal(result.dimensions.length, 8);
  assert.equal(result.preservationWarnings.length, 0);
});

test("quality assessment flags missing exact technical literals", () => {
  const reduced = { ...sections, instruction: "Implement an email validator." };
  const result = assessPrompt({
    sections: reduced,
    rawQuality: { technicalAccuracy: 98, requirementCompleteness: 95, clarity: 90, contextSufficiency: 90, exampleQuality: 90, personaSuitability: 90, outputSpecificity: 90, constraintCoverage: 90 },
    sourceInput: "Implement `validate_email(email: str) -> bool` and exact regex `r'^[\\w.-]+@[\\w.-]+\\.\\w+$'`."
  });
  assert.ok(result.preservationWarnings.length > 0);
  assert.ok(result.scores.technicalAccuracy <= 45);
});


test("quality analysis warns when metadata tags are overused", () => {
  const tagged = { ...sections, instruction: "[STRICT] [MANDATORY] [IMPORTANT] [STRICT] [MANDATORY] [IMPORTANT] [STRICT] Keep every requirement." };
  const result = assessPrompt({ sections: tagged, sourceInput: "A simple request." });
  assert.ok(result.preservationWarnings.some((warning) => warning.includes("Metadata tags appear 7 times")));
});
