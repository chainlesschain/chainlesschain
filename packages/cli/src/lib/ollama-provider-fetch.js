import { Agent } from "undici";
import {
  hasFormalBudgetProviderScope,
  providerFetch,
} from "./formal-budget-provider-scope.js";

let dispatcher;

/**
 * Use the maintained HTTP client for idle-socket validation. Node 22.12's
 * bundled dispatcher can write to a retired keep-alive socket after a long
 * synchronous agent turn, before its pending FIN/RST has been processed.
 * The dispatcher validates before sending; it does not replay a model call.
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
      dispatcher: init.dispatcher ?? (dispatcher ??= new Agent()),
    },
    fetchImpl,
  );
}
