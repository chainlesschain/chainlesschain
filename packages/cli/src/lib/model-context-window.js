import { resolveModelCapabilityProfile } from "./model-capabilities.js";

export { CONTEXT_WINDOWS } from "./model-context-catalog.js";

export function getContextWindow(model, provider) {
  return resolveModelCapabilityProfile({ model, provider }).contextWindowTokens;
}
