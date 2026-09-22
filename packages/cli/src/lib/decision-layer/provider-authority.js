import { types as utilTypes } from "node:util";

export const DECISION_PROVIDER_AUTHORITY_SCHEMA =
  "chainlesschain.decision-provider-authority/v1";

const AUTHORITIES = new WeakSet();

function boundedText(value, label) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > 160 ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError(`${label} is invalid or unbounded`);
  }
  return value.trim();
}

export function openDecisionProviderAuthority({
  provider,
  model,
  decide,
} = {}) {
  if (typeof decide !== "function" || utilTypes.isProxy(decide)) {
    throw new TypeError("decision provider decide() is required");
  }
  const operation = (...args) => Reflect.apply(decide, undefined, args);
  const authority = Object.freeze({
    schema: DECISION_PROVIDER_AUTHORITY_SCHEMA,
    provider: boundedText(provider, "provider"),
    model: boundedText(model, "model"),
    decide: operation,
  });
  AUTHORITIES.add(authority);
  return authority;
}

export function captureDecisionProviderAuthority(value) {
  if (!AUTHORITIES.has(value)) {
    throw new TypeError("a branded decision provider authority is required");
  }
  return value;
}
