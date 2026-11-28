export function createId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `pf_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

export function createFilename(title = "promptforge-prompt") {
  const normalized = String(title)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return `${normalized || "promptforge_prompt"}.md`;
}

export function getErrorMessage(error) {
  if (error?.name === "AbortError") return "The request timed out. Increase the timeout or try again.";
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function safeJsonParse(input) {
  if (typeof input !== "string") throw new TypeError("Expected a JSON string.");
  const trimmed = input.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch (firstError) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* surface original error */ }
    }
    throw new Error(`The AI returned invalid JSON: ${firstError.message}`);
  }
}

export function downloadText(filename, text, mimeType = "text/markdown;charset=utf-8") {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

export function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function countWords(value) {
  return String(value).trim() ? String(value).trim().split(/\s+/).length : 0;
}
