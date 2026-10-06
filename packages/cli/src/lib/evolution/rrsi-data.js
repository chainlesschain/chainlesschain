import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

export const RRSI_STRUCTURAL_FLAGS = Object.freeze({
  structuralOnly: true,
  authenticated: false,
  readyForExecution: false,
  qualifiesForPromotion: false,
});

export class RrsiContractError extends TypeError {
  constructor(message, code = "CC_RRSI_INVALID") {
    super(message);
    this.name = "RrsiContractError";
    this.code = code;
  }
}

export function rrsiFail(message, code) {
  throw new RrsiContractError(message, code);
}

/** Copy descriptors, never call input getters, toJSON, or proxy traps. */
export function snapshotRrsiData(input) {
  const ancestors = new WeakSet();
  let nodes = 0;
  let bytes = 0;
  const charge = (text) => {
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > 2 * 1024 * 1024) rrsiFail("RRSI data exceeds byte limit");
  };
  const copy = (value, depth) => {
    if (++nodes > 100_000 || depth > 16)
      rrsiFail("RRSI data exceeds structural limits");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (value.length > 8192) rrsiFail("RRSI string exceeds limit");
      charge(value);
      return value;
    }
    if (typeof value === "number") {
      if (
        !Number.isFinite(value) ||
        Object.is(value, -0) ||
        (Number.isInteger(value) && !Number.isSafeInteger(value))
      )
        rrsiFail("RRSI numbers must be finite and safe");
      return value;
    }
    if (!value || typeof value !== "object" || isProxy(value))
      rrsiFail("RRSI input must be plain data");
    if (ancestors.has(value)) rrsiFail("RRSI data must be acyclic");
    const array = Array.isArray(value);
    if (
      Object.getPrototypeOf(value) !==
      (array ? Array.prototype : Object.prototype)
    )
      rrsiFail("RRSI input has an unsupported prototype");
    if (array && value.length > 5000) rrsiFail("RRSI array exceeds limit");
    const keys = Reflect.ownKeys(value);
    if (
      (!array && keys.length > 64) ||
      (array && keys.length !== value.length + 1)
    )
      rrsiFail("RRSI input has extra fields or array holes");
    ancestors.add(value);
    const result = array ? [] : {};
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== "string" ||
        key.length > 128 ||
        !descriptor?.enumerable ||
        !("value" in descriptor) ||
        ["__proto__", "constructor", "prototype"].includes(key) ||
        (array && (!/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length))
      )
        rrsiFail("RRSI input has accessor, symbol, or noncanonical fields");
      charge(key);
      Object.defineProperty(result, key, {
        value: copy(descriptor.value, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    ancestors.delete(value);
    return result;
  };
  return copy(input, 0);
}

export function rrsiExact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    rrsiFail(`${label} must be a record`);
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key))
  )
    rrsiFail(`${label} has missing or unexpected fields`);
}

export function rrsiId(value, label) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9._:-]{0,127}$/u.test(value))
    rrsiFail(`${label} is invalid`);
  return value;
}

export function rrsiDigest(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value))
    rrsiFail(`${label} must be a sha256 digest`);
  return value;
}

export function rrsiInteger(
  value,
  label,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    rrsiFail(`${label} is outside its allowed range`);
  return value;
}

export function rrsiFinite(value, label, min = 0, max = 1) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    rrsiFail(`${label} is outside its allowed range`);
  return value;
}

export function rrsiBoolean(value, label) {
  if (typeof value !== "boolean") rrsiFail(`${label} must be boolean`);
  return value;
}

export function rrsiCanonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(rrsiCanonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${rrsiCanonical(value[key])}`)
    .join(",")}}`;
}

export function rrsiHash(domain, value) {
  return `sha256:${createHash("sha256").update(domain).update("\0").update(rrsiCanonical(value)).digest("hex")}`;
}

export function freezeRrsiData(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeRrsiData);
    Object.freeze(value);
  }
  return value;
}

export function rrsiEnvelope(schema, digestField, core) {
  const record = { schema, ...core, ...RRSI_STRUCTURAL_FLAGS };
  return freezeRrsiData({ ...record, [digestField]: rrsiHash(schema, record) });
}

export function verifyRrsiEnvelope(
  input,
  schema,
  digestField,
  inputKeys,
  rebuild,
  derivedKeys = [],
) {
  const value = snapshotRrsiData(input);
  rrsiExact(
    value,
    [
      "schema",
      ...inputKeys,
      ...derivedKeys,
      ...Object.keys(RRSI_STRUCTURAL_FLAGS),
      digestField,
    ],
    schema,
  );
  if (value.schema !== schema) rrsiFail("RRSI schema mismatch");
  const core = Object.fromEntries(inputKeys.map((key) => [key, value[key]]));
  const result = rebuild(core);
  if (rrsiCanonical(result) !== rrsiCanonical(value))
    rrsiFail("RRSI envelope, digest, or structural flags mismatch");
  return result;
}
