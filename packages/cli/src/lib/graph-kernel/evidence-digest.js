import { createHash } from "node:crypto";

function stableValue(value, state = { seen: new WeakSet(), nodes: 0 }) {
  state.nodes += 1;
  if (state.nodes > 250_000) {
    throw new TypeError("Graph evidence exceeds canonicalization limits");
  }
  if (Array.isArray(value))
    return value.map((item) => stableValue(item, state));
  if (!value || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("Graph evidence contains a non-finite number");
    }
    if (["bigint", "function", "symbol", "undefined"].includes(typeof value)) {
      throw new TypeError("Graph evidence contains a non-JSON value");
    }
    return value;
  }
  if (state.seen.has(value)) {
    throw new TypeError("Graph evidence contains a cycle or repeated object");
  }
  state.seen.add(value);
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    throw new TypeError("Graph evidence must contain plain JSON objects");
  }
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, stableValue(value[key], state)]),
  );
}

export function canonicalGraphEvidenceJson(value) {
  return JSON.stringify(stableValue(value));
}

export function graphEvidenceDigest(value, domain) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonicalGraphEvidenceJson(value))
    .digest("hex")}`;
}
