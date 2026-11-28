// Ledge-3.0 addition (not in NaviCase): fallback when parseModelJson fails.
// Some models (e.g. mercury-2) leave quotes inside strings unescaped, emit raw
// newlines in strings, add trailing commas, or drop commas between values.
// Never completes truncated JSON.

import { parseModelJson } from "./prompts/prompt.js";

export function parseModelJsonLenient(text) {
  try {
    return parseModelJson(text);
  } catch (err) {
    const start = text?.indexOf("{") ?? -1;
    const end = text?.lastIndexOf("}") ?? -1;
    if (start === -1 || end <= start) throw err;
    try {
      return JSON.parse(repairJson(text.slice(start, end + 1)));
    } catch {
      throw new Error("The model response was not valid JSON");
    }
  }
}

/** Escape stray quotes / raw control chars inside strings, drop trailing commas, insert missing commas. */
export function repairJson(src) {
  let out = "";
  let inString = false;
  let last = ""; // last non-whitespace char written outside a string
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (!inString) {
      if (ch === "," && /^\s*[}\]]/.test(src.slice(i + 1, i + 200))) continue;
      if (/["{[]/.test(ch) && /["}\]\del]/.test(last)) out += ",";
      if (ch === '"') inString = true;
      if (!/\s/.test(ch)) last = ch;
      out += ch;
      continue;
    }
    if (ch === "\\") {
      out += ch + (src[i + 1] ?? "");
      i++;
    } else if (ch === '"') {
      if (closesString(src, i + 1)) {
        inString = false;
        last = '"';
        out += ch;
      } else out += '\\"';
    } else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else out += ch;
  }
  return out;
}

// A quote ends a string only if what follows is JSON structure. A quote, `{` or `[`
// on a later line is treated as the next value with its comma missing.
function closesString(src, j) {
  const from = j;
  while (/\s/.test(src[j] || "")) j++;
  const c = src[j];
  if (c === undefined || c === ":" || c === "}" || c === "]") return true;
  if (/["{[]/.test(c) && src.slice(from, j).includes("\n")) return true;
  if (c !== ",") return false;
  j++;
  while (/\s/.test(src[j] || "")) j++;
  return /["{}[\]\d\-tfn]/.test(src[j] || "");
}
