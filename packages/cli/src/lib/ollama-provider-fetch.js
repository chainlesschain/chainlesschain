import { Agent } from "undici";
import {
  hasFormalBudgetProviderScope,
  providerFetch,
} from "./formal-budget-provider-scope.js";

let dispatcher;

/**
 * Do not reuse an idle Ollama socket across agent turns. Long synchronous
 * repository work can delay processing a peer's close until the next call.
 * pipelining: 0 disables keep-alive in undici, giving each request a fresh
 * connection without replaying a model call after an ambiguous failure.
 */
export function ollamaProviderFetch(
  input,
  init = {},
  fetchImpl = globalThis.fetch,
) {
  // A governed transport owns its physical HTTP policy and rejects adapter
  // transport overrides. Leave its request shape and dispatcher untouched.
  if (hasFormalBudgetProviderScope())
    return providerFetch(input, init, fetchImpl);
  return providerFetch(
    input,
    {
      ...init,
      dispatcher:
        init.dispatcher ?? (dispatcher ??= new Agent({ pipelining: 0 })),
    },
    fetchImpl,
  );
}
