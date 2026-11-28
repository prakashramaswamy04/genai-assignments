// fetch wrapper for provider calls: AbortController timeout, error mapping
// ("<Label> <status>: <detail>", as NaviCase postJson) and key redaction.

export class HttpError extends Error {
  /** `upstream` = {status, code, param, message} from the provider's error body. */
  constructor(status, message, upstream = null) {
    super(message);
    this.status = status;
    this.upstream = upstream;
  }
}

/** Replace every stored key (and any Bearer token) in `text`. */
export function redact(text, secrets = []) {
  let out = String(text ?? "");
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("[redacted]");
  return out.replace(/Bearer\s+[A-Za-z0-9._\-]+/g, "Bearer [redacted]");
}

function mapError(label, status, data, text, secrets) {
  const e = data?.error;
  const detail = redact((typeof e === "string" ? e : e?.message || e?.type || e?.status) || text.slice(0, 300), secrets);
  const upstream = { status, code: e?.code ?? e?.type ?? null, param: e?.param ?? null, message: detail };
  const prefix = `${label} ${status}: ${detail}`;
  if (status === 401 || status === 403) {
    return new HttpError(401, `${prefix} — the API key was rejected. Check it in Settings.`, upstream);
  }
  if (status === 404 || upstream.code === "model_not_found") {
    return new HttpError(404, `${prefix} — model not found. Click ↻ to refresh the model list.`, upstream);
  }
  if (status === 429) return new HttpError(429, `${prefix} — rate limit or quota reached. Wait a moment, or check your plan and billing.`, upstream);
  if (status === 400) return new HttpError(400, prefix, upstream);
  return new HttpError(502, prefix, upstream);
}

async function request(url, init, label, { timeoutMs, secrets = [] }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  let text;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
    text = await res.text();
  } catch (err) {
    if (controller.signal.aborted) {
      throw new HttpError(504, `${label} request timed out after ${Math.round(timeoutMs / 1000)} s. Try a faster model or raise the timeout in Settings → Advanced.`);
    }
    throw new HttpError(502, `${label} request failed: ${redact(err?.message || err, secrets)}`);
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // handled below
  }
  if (!res.ok) throw mapError(label, res.status, data, text, secrets);
  if (data === null) throw new HttpError(502, `${label} returned a response that is not valid JSON.`);
  return data;
}

export function postJson(url, headers, body, label, opts) {
  return request(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }, label, opts);
}

export function getJson(url, headers, label, opts) {
  return request(url, { method: "GET", headers }, label, opts);
}
