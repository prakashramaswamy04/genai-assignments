// Port of NaviCase resolveModelOptions: provider / model / sampling flags
// common to every generation job.

import { PROVIDERS } from "../../shared/constants.js";
import { SEED } from "../models.js";
import { HttpError } from "./http.js";

export function resolveModelOptions(payload) {
  const provider = String(payload.provider || "").toLowerCase();
  if (!PROVIDERS.includes(provider)) {
    throw new HttpError(400, `Unknown provider "${payload.provider}". Use one of: ${PROVIDERS.join(", ")}`);
  }
  // Inception Labs is pinned to mercury-2 regardless of what the panel sent.
  const model = provider === "inception" ? "mercury-2" : String(payload.model || SEED[provider][0]);
  if (!/^[A-Za-z0-9._:\-/]{1,100}$/.test(model)) throw new HttpError(400, "Invalid model name");
  const temperature = Math.min(2, Math.max(0, Number.isFinite(Number(payload.temperature)) ? Number(payload.temperature) : 0.3));
  const reasoningEffort = ["low", "medium", "high"].includes(payload.reasoningEffort) ? payload.reasoningEffort : "medium";
  return { provider, model, temperature, reasoningEffort };
}
