import { ICEPOT_SECTIONS, LIMITS, PROVIDERS } from "./constants.js";

export function validateInput(input) {
  if (typeof input !== "string" || !input.trim()) {
    return { valid: false, message: "Add an idea, prompt, code snippet, or requirement to get started." };
  }
  if (input.length > LIMITS.inputCharacters) {
    return { valid: false, message: `Input is too large. Keep it under ${LIMITS.inputCharacters.toLocaleString()} characters.` };
  }
  return { valid: true, message: "" };
}

export function validateSettings(settings) {
  const errors = [];
  if (!settings || !PROVIDERS[settings.provider]) errors.push("Choose a supported AI provider.");
  if (!String(settings?.endpoint || "").trim()) errors.push("Enter an API endpoint.");
  else {
    try {
      const url = new URL(settings.endpoint);
      const isLoopback = ["localhost", "127.0.0.1"].includes(url.hostname);
      if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
        errors.push("Use HTTPS for remote API endpoints. HTTP is allowed only for localhost or 127.0.0.1.");
      }
      if (url.username || url.password || [...url.searchParams.keys()].some((key) => /(?:api[_-]?key|token|secret|password|authorization)/i.test(key))) {
        errors.push("Do not put credentials in the endpoint URL.");
      }
    } catch {
      errors.push("Enter a valid absolute API endpoint URL.");
    }
  }
  if (!String(settings?.model || "").trim()) errors.push("Enter a model name.");
  if (!Number.isFinite(Number(settings?.timeoutMs)) || Number(settings.timeoutMs) < LIMITS.minTimeoutMs || Number(settings.timeoutMs) > LIMITS.maxTimeoutMs) {
    errors.push(`Timeout must be between ${LIMITS.minTimeoutMs / 1000} and ${LIMITS.maxTimeoutMs / 1000} seconds.`);
  }
  if (!Number.isFinite(Number(settings?.maxTokens)) || Number(settings.maxTokens) < LIMITS.minMaxTokens || Number(settings.maxTokens) > LIMITS.maxMaxTokens) {
    errors.push(`Token limit must be between ${LIMITS.minMaxTokens} and ${LIMITS.maxMaxTokens}.`);
  }
  if (!Number.isFinite(Number(settings?.temperature)) || Number(settings.temperature) < 0 || Number(settings.temperature) > 1) errors.push("Temperature must be between 0 and 1.");
  if (!["local", "session"].includes(settings?.credentialStorage)) errors.push("Choose local or session-only credential storage.");
  return { valid: errors.length === 0, errors };
}

export function validateIcepotSections(sections) {
  if (!sections || typeof sections !== "object" || Array.isArray(sections)) {
    return { valid: false, errors: ["ICEPOT sections must be an object."] };
  }
  const errors = [];
  for (const section of ICEPOT_SECTIONS) {
    if (typeof sections[section.key] !== "string" || !sections[section.key].trim()) {
      errors.push(`Missing or empty ICEPOT section: ${section.title}.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateStructuredResponse(response) {
  const errors = [];
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return { valid: false, errors: ["AI response must be a JSON object."] };
  }
  if (response.sections) errors.push(...validateIcepotSections(response.sections).errors);
  return { valid: errors.length === 0, errors };
}
