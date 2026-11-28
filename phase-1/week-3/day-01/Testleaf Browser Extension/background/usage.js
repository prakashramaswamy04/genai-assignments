// Port of NaviCase buildUsage: token usage, this run's cost, and what the same
// token counts would cost on every seed model.

import { SEED } from "./models.js";
import { priceFor, costFor } from "./pricing.js";

export function buildUsage(model, inputTokens, outputTokens, reasoningTokens) {
  const comparison = Object.entries(SEED)
    .flatMap(([provider, models]) => models.map((m) => ({ provider, model: m, price: priceFor(m) })))
    .filter((row) => row.price)
    .map(({ provider, model: m, price }) => ({
      provider,
      model: m,
      inputPerMTok: price.input,
      outputPerMTok: price.output,
      cost: costFor(m, inputTokens, outputTokens),
    }))
    .sort((a, b) => a.cost - b.cost);
  return { inputTokens, outputTokens, reasoningTokens, cost: costFor(model, inputTokens, outputTokens), comparison };
}
