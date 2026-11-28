// Provider dispatch: send one system + user prompt to the provider's official
// endpoint. `json` asks for a JSON object response where the provider supports it.
// Returns {text, truncated, inputTokens, outputTokens, reasoningTokens}.

import * as openai from "./providers/openai.js";
import * as anthropic from "./providers/anthropic.js";
import * as gemini from "./providers/gemini.js";
import * as inception from "./providers/inception.js";
import * as groq from "./providers/groq.js";
import { HttpError } from "./http.js";
import { getKey, getAdvanced, secretValues } from "../settings.js";
import { PROVIDER_LABELS } from "../../shared/constants.js";

export const ADAPTERS = { groq, openai, anthropic, gemini, inception };

export async function callModel({ provider, model, temperature, reasoningEffort, system, user, json }) {
  const adapter = ADAPTERS[provider];
  if (!adapter) throw new HttpError(400, `Unknown provider "${provider}"`);
  const ctx = { apiKey: await getKey(provider), limits: await getAdvanced(), secrets: await secretValues() };
  const reply = await adapter.call({ model, temperature, reasoningEffort, system, user, json }, ctx);
  if (reply.truncated && !reply.text.trim()) {
    throw new HttpError(
      502,
      `${PROVIDER_LABELS[provider]} hit its output limit before returning any text. Raise the max tokens in Settings → Advanced, or lower the reasoning effort.`,
    );
  }
  return reply;
}
