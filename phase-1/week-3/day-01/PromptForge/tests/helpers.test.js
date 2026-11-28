import test from "node:test";
import assert from "node:assert/strict";
import { createFilename, safeJsonParse } from "../utils/helpers.js";

test("filename generation creates a safe Markdown name", () => {
  assert.equal(createFilename("My Prompt: API / Design!"), "my_prompt_api_design.md");
  assert.equal(createFilename("  "), "promptforge_prompt.md");
});

test("JSON parser accepts fenced JSON and rejects malformed content", () => {
  assert.deepEqual(safeJsonParse("```json\n{\"ok\":true}\n```"), { ok: true });
  assert.throws(() => safeJsonParse("not json"), /invalid JSON/i);
});
