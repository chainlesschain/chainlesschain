import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { types as utilTypes } from "node:util";

export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_IPC_CAPABILITY_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-ipc-capability/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const AUTHORIZATION = /^[A-Za-z0-9_-]{43}$/u;
const MAX_TTL_MS = 15 * 60 * 1000;
const FUTURE_SKEW_MS = 30 * 1000;
const CAPABILITY_KEYS = new Set(["expiresAt", "id", "issuedAt", "maxUses"]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function validToken(value) {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length >= 32 &&
    value.length <= 4096 &&
    !value.includes("\0")
  );
}

function timestamp(value, label) {
  const milliseconds = Date.parse(value);
  if (
    typeof value !== "string" ||
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return milliseconds;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function capabilityMessage({
  action,
  capabilityId,
  payload,
  requestId,
  schema,
}) {
  return `${GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_IPC_CAPABILITY_SCHEMA}\0${canonical(
    { action, capabilityId, payload, requestId, schema },
  )}`;
}

export function governedSkillSynthesisAttestorTrustIpcCapabilityId({
  service,
  token,
}) {
  if (typeof service !== "string" || service.length < 1 || !validToken(token)) {
    throw new TypeError("attestor trust IPC capability identity is invalid");
  }
  return `sha256:${createHash("sha256")
    .update(GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_IPC_CAPABILITY_SCHEMA)
    .update("\0")
    .update(service)
    .update("\0")
    .update(token)
    .digest("hex")}`;
}

export function createGovernedSkillSynthesisAttestorTrustIpcAuthorization({
  action,
  capabilityId,
  payload,
  requestId,
  schema,
  token,
}) {
  if (!DIGEST.test(capabilityId ?? "") || !validToken(token)) {
    throw new TypeError("attestor trust IPC capability is invalid");
  }
  return createHmac("sha256", token)
    .update(
      capabilityMessage({ action, capabilityId, payload, requestId, schema }),
    )
    .digest("base64url");
}

export function verifyGovernedSkillSynthesisAttestorTrustIpcAuthorization({
  authorization,
  ...input
}) {
  if (!AUTHORIZATION.test(authorization ?? "")) return false;
  let expected;
  try {
    expected = createGovernedSkillSynthesisAttestorTrustIpcAuthorization(input);
  } catch {
    return false;
  }
  return safeEqual(authorization, expected);
}

export function normalizeGovernedSkillSynthesisAttestorTrustIpcCapability({
  capability,
  maxUsesLimit,
  now = Date.now(),
  service,
  token,
}) {
  if (
    !capability ||
    typeof capability !== "object" ||
    Array.isArray(capability) ||
    utilTypes.isProxy(capability) ||
    Object.getPrototypeOf(capability) !== Object.prototype
  ) {
    throw new TypeError("attestor trust IPC capability descriptor is invalid");
  }
  const keys = Reflect.ownKeys(capability);
  if (
    keys.length !== CAPABILITY_KEYS.size ||
    keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(capability, key);
      return (
        typeof key !== "string" ||
        !CAPABILITY_KEYS.has(key) ||
        !descriptor ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      );
    }) ||
    !DIGEST.test(capability.id ?? "") ||
    !Number.isSafeInteger(capability.maxUses) ||
    capability.maxUses < 1 ||
    capability.maxUses > maxUsesLimit ||
    !Number.isFinite(now)
  ) {
    throw new TypeError("attestor trust IPC capability descriptor is invalid");
  }
  const issuedAt = timestamp(capability.issuedAt, "capability issuedAt");
  const expiresAt = timestamp(capability.expiresAt, "capability expiresAt");
  if (
    issuedAt > now + FUTURE_SKEW_MS ||
    expiresAt <= now ||
    expiresAt <= issuedAt ||
    expiresAt > issuedAt + MAX_TTL_MS ||
    capability.id !==
      governedSkillSynthesisAttestorTrustIpcCapabilityId({ service, token })
  ) {
    throw new TypeError("attestor trust IPC capability is invalid or expired");
  }
  return Object.freeze({ ...capability });
}

export function createGovernedSkillSynthesisAttestorTrustIpcCapability({
  expiresAt,
  issuedAt,
  maxUses,
  maxUsesLimit,
  now = Date.now(),
  service,
  token,
}) {
  return normalizeGovernedSkillSynthesisAttestorTrustIpcCapability({
    capability: {
      id: governedSkillSynthesisAttestorTrustIpcCapabilityId({
        service,
        token,
      }),
      issuedAt,
      expiresAt,
      maxUses,
    },
    maxUsesLimit,
    now,
    service,
    token,
  });
}
