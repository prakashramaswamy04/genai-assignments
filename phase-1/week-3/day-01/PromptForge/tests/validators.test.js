import test from "node:test";
import assert from "node:assert/strict";
import { validateInput, validateSettings, validateIcepotSections, validateStructuredResponse } from "../utils/validators.js";
import { DEFAULT_SETTINGS, LIMITS } from "../utils/constants.js";

const sections = {
  instruction: "Implement the requested task.",
  context: "Use the supplied project context.",
  examples: "Use only grounded examples.",
  persona: "Act as a senior engineer.",
  outputFormat: "Return source code and documentation.",
  tone: "Be precise and technical."
};

test("input validation rejects empty and oversized input", () => {
  assert.equal(validateInput("   ").valid, false);
  assert.equal(validateInput("build a test").valid, true);
  assert.equal(validateInput("x".repeat(LIMITS.inputCharacters + 1)).valid, false);
});

test("settings validation accepts secure defaults", () => {
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS }).valid, true);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, endpoint: "http://example.com/api" }).valid, false);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, endpoint: "http://localhost:1234/api" }).valid, true);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, endpoint: "https://user:pass@example.com/api" }).valid, false);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, endpoint: "https://example.com/api?api_key=secret" }).valid, false);
  assert.equal(validateSettings({ ...DEFAULT_SETTINGS, provider: "unknown" }).valid, false);
});

test("ICEPOT section validation requires all six non-empty sections", () => {
  assert.equal(validateIcepotSections(sections).valid, true);
  assert.equal(validateIcepotSections({ ...sections, tone: "" }).valid, false);
  assert.equal(validateIcepotSections(null).valid, false);
});

test("structured response validation checks section payload", () => {
  assert.equal(validateStructuredResponse({ sections }).valid, true);
  assert.equal(validateStructuredResponse({ sections: { instruction: "Only one" } }).valid, false);
  assert.equal(validateStructuredResponse("nope").valid, false);
});
