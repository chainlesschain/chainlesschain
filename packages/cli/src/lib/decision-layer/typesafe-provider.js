import { createDecisionProvider } from "./providers.js";

export function createTypeSafeDecisionProvider({
  apiKey,
  baseUrl,
  model,
  fetchImpl,
} = {}) {
  return createDecisionProvider({
    provider: "typesafe",
    apiKey,
    baseUrl,
    model,
    fetchImpl,
  });
}
