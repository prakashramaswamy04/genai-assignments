const MASKED = "••••••";
const SENSITIVE = /pass(word)?|passcode|otp|one.?time|verification|auth|token|secret|api.?key|cvv|cvc|security.?code|card.?number|credit.?card|debit.?card|cc.?number|pin|session|ssn|social.?security|tax.?id|bank.?account|routing.?number|private.?key|\bcode\b/i;
const CARD_DIGITS = /(?:\d[ -]*?){13,19}/;
const OTP_VALUE = /^\d{4,8}$/;

export function sanitizeFreeText(value, maxLength = 2000) {
  return String(value ?? "").slice(0, Math.max(0, maxLength))
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/gi, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[REDACTED TOKEN]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gsk_[A-Za-z0-9_-]{12,}|AIza[\w-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g, "[REDACTED KEY]")
    .replace(/((?:password|passwd|passcode|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|cvv|cvc|otp|pin|ssn|social.?security|bank.?account)\s*(?:is|:|=)\s*)("[^"]*"|'[^']*'|[^,\s;]+)/gi,
      (match, prefix, value) => /^(?:process\.env(?:\.[A-Z0-9_]+|\[['"][A-Z0-9_]+['"]\])|os\.(?:getenv|environ)(?:\([^)]*\)|\[[^\]]+\])|System\.getenv\([^)]*\)|Environment\.GetEnvironmentVariable\([^)]*\)|\$\{?[A-Z_][A-Z0-9_]*\}?)/i.test(value)
        ? match : `${prefix}[REDACTED]`)
    .replace(/(https?:\/\/[^:/@\s]+:)[^@\s/]+@/gi, "$1[REDACTED]@")
    .replace(/((?:otp|one[- ]time|verification|security|auth|login)\s+(?:code|password)?[^0-9]{0,24})\d{4,8}/gi, "$1[REDACTED]")
    .replace(/(\bcode\s*[:#-]?\s*)\d{4,8}\b/gi, "$1[REDACTED]")
    .replace(/(?:\d[ -]*?){13,19}/g, "[REDACTED CARD NUMBER]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]");
}

export function sanitizeUrl(input) {
  try {
    const url = new URL(String(input || ""));
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    if (url.hash.startsWith("#") && url.hash.includes("=")) {
      const fragment = new URLSearchParams(url.hash.slice(1));
      for (const key of [...fragment.keys()]) if (SENSITIVE.test(key)) fragment.set(key, "[REDACTED]");
      url.hash = `#${fragment.toString()}`;
    }
    url.pathname = url.pathname.replace(/(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:token|auth|secret|reset)[=:][^/]{12,})/gi, "[REDACTED]");
    if (url.username) url.username = "[REDACTED]";
    if (url.password) url.password = "[REDACTED]";
    return url.toString();
  } catch {
    return sanitizeFreeText(input, 3000);
  }
}

function isSensitiveTarget(target = {}) {
  const fields = [target.type, target.inputType, target.name, target.id, target.placeholder,
    target.autocomplete, target.ariaLabel, target.label, target.selector].filter(Boolean).join(" ");
  return String(target.type || target.inputType || "").toLowerCase() === "password" || SENSITIVE.test(fields);
}

function sanitizeValue(value, target = {}, maskAll = false) {
  if (value === undefined || value === null) return value;
  const text = String(value);
  return maskAll || isSensitiveTarget(target) || OTP_VALUE.test(text.trim()) || CARD_DIGITS.test(text.replace(/\s/g, ""))
    ? MASKED : sanitizeFreeText(text, 4000);
}

export function sanitizeEvent(event, { maskAll = false } = {}) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return event;
  const target = { ...(event.target || {}) };
  for (const key of ["label", "text", "ariaLabel", "placeholder", "title", "id", "name", "role", "tag", "inputType", "selector"]) {
    if (typeof target[key] === "string") target[key] = sanitizeFreeText(target[key], 500);
  }
  if (target.url) target.url = sanitizeUrl(target.url);
  const result = { ...event, target };
  if (typeof result.url === "string") result.url = sanitizeUrl(result.url);
  if (typeof result.pageUrl === "string") result.pageUrl = sanitizeUrl(result.pageUrl);
  if (typeof result.value === "string") result.value = sanitizeValue(result.value, target, maskAll);
  if (typeof result.title === "string") result.title = sanitizeFreeText(result.title, 500);
  return sanitizeSnapshot(result, { maskAll });
}

export function sanitizeSnapshot(snapshot, { maskAll = false } = {}) {
  const visit = (value, key = "", context = {}, depth = 0) => {
    if (depth > 12) return "[TRUNCATED]";
    if (typeof value === "string") {
      if (key === "url" || key === "href" || key === "src" || key === "action") return sanitizeUrl(value);
      if (key === "value") return sanitizeValue(value, context, maskAll);
      return sanitizeFreeText(value, 2000);
    }
    if (Array.isArray(value)) return value.slice(0, 500).map(item => visit(item, "", context, depth + 1));
    if (!value || typeof value !== "object") return value;
    const nestedTarget = value.target && typeof value.target === "object" ? value.target : {};
    const descriptor = {
      ...context,
      ...Object.fromEntries(["type", "inputType", "name", "id", "label", "ariaLabel", "placeholder", "autocomplete", "selector"]
        .filter(field => typeof (value[field] ?? nestedTarget[field]) === "string")
        .map(field => [field, value[field] ?? nestedTarget[field]])),
    };
    const sensitive = isSensitiveTarget(descriptor);
    const output = {};
    for (const [childKey, child] of Object.entries(value)) {
      if (SENSITIVE.test(childKey)) output[childKey] = MASKED;
      else if (childKey === "value" && sensitive && child !== undefined) output[childKey] = MASKED;
      else output[childKey] = visit(child, childKey, descriptor, depth + 1);
    }
    return output;
  };
  return snapshot && typeof snapshot === "object" ? visit(snapshot) : snapshot;
}
