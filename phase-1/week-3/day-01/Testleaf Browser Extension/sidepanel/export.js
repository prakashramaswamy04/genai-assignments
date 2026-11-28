// Exports, ported from NaviCase sidepanel.js (toCsv / toMarkdown / exportAs).
// Pure functions so they can be tested in Node; download/copy need a DOM.

const AUTOMATION_LABELS = { playwright: "Playwright", selenium: "Selenium" };
export const frameworkLabel = (fw) => AUTOMATION_LABELS[fw] || (fw ? fw[0].toUpperCase() + fw.slice(1) : "Automation");

const csvCell = (v) => {
  const text = String(v ?? "");
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function toCsv(result) {
  const header = ["ID", "Title", "Module", "Type", "Priority", "Preconditions", "Test Data", "Steps", "Step Expected Results", "Expected Result"];
  const rows = result.testCases.map((tc) => [
    tc.id, tc.title, tc.module, tc.type, tc.priority,
    tc.preconditions.join("\n"),
    tc.testData.join("\n"),
    tc.steps.map((s) => `${s.step}. ${s.action}`).join("\n"),
    tc.steps.map((s) => `${s.step}. ${s.expected}`).join("\n"),
    tc.expectedResult,
  ]);
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export function toMarkdown(result) {
  const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const out = [`# Test cases`, "", result.summary || "", ""];
  for (const tc of result.testCases) {
    out.push(`## ${tc.id} — ${tc.title}`, "", `**Type:** ${tc.type} · **Priority:** ${tc.priority}${tc.module ? ` · **Module:** ${tc.module}` : ""}`, "");
    if (tc.preconditions.length) out.push("**Preconditions**", "", ...tc.preconditions.map((p) => `- ${p}`), "");
    if (tc.testData.length) out.push("**Test data**", "", ...tc.testData.map((p) => `- ${p}`), "");
    out.push("| # | Action | Expected |", "|---|---|---|", ...tc.steps.map((s) => `| ${s.step} | ${esc(s.action)} | ${esc(s.expected)} |`), "");
    if (tc.expectedResult) out.push(`**Expected result:** ${tc.expectedResult}`, "");
  }
  if (result.automation?.code) {
    const auto = result.automation;
    out.push(`## ${frameworkLabel(auto.framework)} script${auto.caseIds?.length ? ` (${auto.caseIds.join(", ")})` : ""}`, "", "```" + (auto.language || "").toLowerCase(), auto.code, "```", "");
    if (auto.gaps?.length) out.push("**Gaps to complete by hand**", "", ...auto.gaps.map((g) => `- ${g}`), "");
  }
  return out.join("\n");
}

/** `ledge-3.0-testcases-<date>.<ext>`; date as NaviCase's stamp (YYYY-MM-DD-HH-MM). */
export function exportFile(kind, result, now = new Date()) {
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const name = (ext) => `ledge-3.0-testcases-${stamp}.${ext}`;
  if (kind === "csv") return { filename: name("csv"), content: toCsv(result), type: "text/csv;charset=utf-8" };
  if (kind === "md") return { filename: name("md"), content: toMarkdown(result), type: "text/markdown;charset=utf-8" };
  if (kind === "json") return { filename: name("json"), content: JSON.stringify(result, null, 2), type: "application/json" };
  return null;
}

/** A filename the framework's runner will pick up; Java uses the class name from the code. */
export function scriptFilename(auto) {
  const cls = auto.code.match(/\bclass\s+([A-Za-z_]\w*)/)?.[1];
  switch (auto.language) {
    case "TypeScript": return "ledge.spec.ts";
    case "JavaScript": return "ledge.spec.js";
    case "Python": return "test_ledge.py";
    case "Java": return `${cls || "LedgeTest"}.java`;
    case "C#": return "LedgeTests.cs";
    case "Robot Framework (Browser)":
    case "Robot Framework (SeleniumLibrary)": return "ledge.robot";
    default: return "ledge-3.0-script.txt";
  }
}

export function download({ filename, content, type }) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text, button) {
  await navigator.clipboard.writeText(text);
  const target = button.querySelector(".btn-label") || button;
  const original = target.textContent;
  target.textContent = "Copied!";
  button.classList.add("copied");
  setTimeout(() => {
    target.textContent = original;
    button.classList.remove("copied");
  }, 1200);
}
