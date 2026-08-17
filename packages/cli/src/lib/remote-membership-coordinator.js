/**
 * Server-authoritative membership and one-shot execution leases for Remote
 * Approval across independent hosts.
 *
 * This is a single strongly consistent coordinator, not quorum consensus. A
 * host must remain online to ACK and consume a lease immediately before it
 * dispatches the approved side effect. The coordinator signs every statement
 * with a pinned Ed25519 key; WebSocket delivery is transport only and never an
 * authority by itself.
 *
 * Production integration: the Remote Session registry and WebSocket protocol
 * use this coordinator, the client-hosted approval bridge durably adopts and
 * ACKs its signed leases, and Agent shell dispatch consumes the exact one-shot
 * lease online immediately before the side effect. Side-effect paths without
 * that consume boundary reject Remote approval instead of falling back to a
 * cached decision. This provides cross-host revoke fencing under one online,
 * strongly consistent coordinator; it does not claim quorum availability or
 * undo an external effect after a successful consume has linearized dispatch.
 */

import fs from "node:fs";
import path from "node:path";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import { getMachineSecurityAnchorDir } from "./paths.js";
import {
  mutateSecurityStore,
  readSecurityStore,
} from "./durable-security-store.js";
import { withFileLock } from "./with-file-lock.js";
import { consumeRemoteRelayPossessionCapability } from "../harness/remote-session-crypto.js";

export const REMOTE_MEMBERSHIP_COORDINATOR_VERSION =
  "server-signed-membership-execution-lease-v1";
export const REMOTE_MEMBERSHIP_STATEMENT_SCHEMA =
  "chainlesschain.remote-membership-statement/v1";
export const REMOTE_MEMBERSHIP_COORDINATOR_UNAVAILABLE_CODE =
  "CC_REMOTE_MEMBERSHIP_COORDINATOR_UNAVAILABLE";
export const REMOTE_MEMBERSHIP_COORDINATOR_ROLLBACK_CODE =
  "CC_REMOTE_MEMBERSHIP_COORDINATOR_ROLLBACK";
export const REMOTE_MEMBERSHIP_NOT_ACTIVE_CODE =
  "CC_REMOTE_MEMBERSHIP_NOT_ACTIVE";

const STORE_VERSION = 1;
const KEY_VERSION = 1;
const WITNESS_VERSION = 2;
const EVENT_SCHEMA = "chainlesschain.remote-membership-event/v1";
const AUTHENTICATION_CHALLENGE_SCHEMA =
  "chainlesschain.remote-membership-authentication-challenge/v1";
const AUTHENTICATION_CHALLENGE_DOMAIN =
  "chainlesschain.remote-membership-authentication-challenge.v1\0";
const STORE_LABEL = "Remote membership coordinator";
const KEY_LABEL = "Remote membership coordinator signing key";
const WITNESS_LABEL = "Remote membership coordinator rollback witness";
const DIGEST_RE = /^[0-9a-f]{64}$/;
const POSITIVE_RE = /^[1-9]\d*$/;
const NON_NEGATIVE_RE = /^(?:0|[1-9]\d*)$/;
const VALID_SCOPES = new Set(["observe", "prompt", "approve", "interrupt"]);
const VALID_TYPES = new Set([
  "session.created",
  "session.reenabled",
  "member.joined",
  "member.revoked",
  "session.closed",
  "lease.created",
  "lease.acked",
  "lease.consumed",
  "lease.cancelled",
]);
const DEFAULT_LEASE_TTL_MS = 30_000;
const MAX_LEASE_TTL_MS = 60_000;
const DEFAULT_CHALLENGE_TTL_MS = 30_000;
const MAX_CHALLENGE_TTL_MS = 60_000;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
export const REMOTE_APPROVAL_BINDING_CAPABILITY = "approval-binding-v1";
const DEFAULT_JOIN_POLICY_VERSION = "remote-session-policy:unrestricted-v1";
const JOIN_POLICY_EVENT_FIELDS = Object.freeze([
  "policyAllowedScopes",
  "policyAllowRelayPairing",
  "policyMaxDevices",
  "policyVersion",
]);
const MEMBER_JOIN_AUTHORITY_FIELDS = Object.freeze([
  "capabilities",
  "joinVia",
  ...JOIN_POLICY_EVENT_FIELDS,
]);

const COMMON_EVENT_FIELDS = Object.freeze([
  "eventHash",
  "eventId",
  "generation",
  "occurredAtMs",
  "previousEventHash",
  "previousGeneration",
  "schema",
  "sessionId",
  "type",
]);
const EVENT_FIELDS = Object.freeze({
  "session.created": Object.freeze([
    ...COMMON_EVENT_FIELDS,
    "agentSessionId",
    "expiresAt",
    "hostCredentialDigest",
    "hostCredentialPublicKey",
    "hostCredentialType",
    "hostPrincipalId",
    "membershipEpoch",
    ...JOIN_POLICY_EVENT_FIELDS,
    "scopes",
    "sessionEpoch",
  ]),
  "session.reenabled": Object.freeze([
    ...COMMON_EVENT_FIELDS,
    "expectedHostMembershipEpoch",
    "expectedSessionEpoch",
    "expiresAt",
    "hostPrincipalId",
    "membershipEpoch",
    "nextHostCredentialDigest",
    "nextHostCredentialPublicKey",
    "nextHostCredentialType",
    "nextHostPrincipalId",
    ...JOIN_POLICY_EVENT_FIELDS,
    "scopes",
    "sessionEpoch",
  ]),
  "member.joined": Object.freeze([
    ...COMMON_EVENT_FIELDS,
    "credentialDigest",
    "credentialPublicKey",
    "credentialType",
    "expectedSessionEpoch",
    "membershipEpoch",
    "previousMembershipEpoch",
    "principalId",
    ...MEMBER_JOIN_AUTHORITY_FIELDS,
    "scopes",
  ]),
  "member.revoked": Object.freeze([
    ...COMMON_EVENT_FIELDS,
    "cancelledLeaseIds",
    "expectedHostMembershipEpoch",
    "expectedMembershipEpoch",
    "expectedSessionEpoch",
    "hostPrincipalId",
    "membershipEpoch",
    "principalId",
  ]),
  "session.closed": Object.freeze([
    ...COMMON_EVENT_FIELDS,
    "cancelledLeaseIds",
    "expectedHostMembershipEpoch",
    "expectedSessionEpoch",
    "hostPrincipalId",
    "sessionEpoch",
  ]),
  "lease.created": Object.freeze([
    ...COMMON_EVENT_FIELDS,
    "binding",
    "expectedSessionEpoch",
    "expiresAt",
    "fingerprint",
    "hostPrincipalId",
    "leaseId",
    "membershipEpoch",
    "principalId",
    "requestId",
  ]),
  "lease.acked": Object.freeze([
    ...COMMON_EVENT_FIELDS,
    "expectedCreatedGeneration",
    "expectedHostMembershipEpoch",
    "expectedSessionEpoch",
    "hostPrincipalId",
    "hostReceiptDigest",
    "leaseId",
  ]),
  "lease.consumed": Object.freeze([
    ...COMMON_EVENT_FIELDS,
    "binding",
    "expectedAckedGeneration",
    "expectedHostMembershipEpoch",
    "expectedMembershipEpoch",
    "expectedSessionEpoch",
    "fingerprint",
    "hostPrincipalId",
    "leaseId",
    "requestId",
  ]),
  "lease.cancelled": Object.freeze([
    ...COMMON_EVENT_FIELDS,
    "expectedHostMembershipEpoch",
    "expectedSessionEpoch",
    "hostPrincipalId",
    "leaseId",
    "reason",
  ]),
});

const LEGACY_EVENT_FIELDS = Object.freeze({
  "session.created": Object.freeze(
    EVENT_FIELDS["session.created"].filter(
      (field) => !JOIN_POLICY_EVENT_FIELDS.includes(field),
    ),
  ),
  "member.joined": Object.freeze(
    EVENT_FIELDS["member.joined"].filter(
      (field) => !MEMBER_JOIN_AUTHORITY_FIELDS.includes(field),
    ),
  ),
});

function coordinatorError(code, message, cause = null, details = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = "RemoteMembershipCoordinatorError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function unavailable(cause, filePath) {
  if (
    cause?.code === REMOTE_MEMBERSHIP_COORDINATOR_UNAVAILABLE_CODE ||
    cause?.code === REMOTE_MEMBERSHIP_COORDINATOR_ROLLBACK_CODE ||
    cause?.code === REMOTE_MEMBERSHIP_NOT_ACTIVE_CODE
  ) {
    return cause;
  }
  return coordinatorError(
    REMOTE_MEMBERSHIP_COORDINATOR_UNAVAILABLE_CODE,
    "Remote membership coordinator is unavailable; remote execution is denied",
    cause,
    { filePath, commitState: cause?.commitState || null },
  );
}

function rollback(message, details = {}) {
  return coordinatorError(
    REMOTE_MEMBERSHIP_COORDINATOR_ROLLBACK_CODE,
    `Remote membership coordinator rollback detected: ${message}`,
    null,
    details,
  );
}

function requiredString(value, label, maximum = 1024) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.includes("\0")
  ) {
    throw new TypeError(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function canonicalEpoch(value, label, { zero = false } = {}) {
  const pattern = zero ? NON_NEGATIVE_RE : POSITIVE_RE;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new TypeError(`${label} must be a canonical integer string`);
  }
  return BigInt(value);
}

function safeTimestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe timestamp`);
  }
  return value;
}

function normalizeScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new TypeError("membership scopes must be a non-empty array");
  }
  const normalized = [...new Set(scopes.map(String))].sort();
  for (const scope of normalized) {
    if (!VALID_SCOPES.has(scope)) {
      throw new TypeError(`unsupported membership scope: ${scope}`);
    }
  }
  return normalized;
}

function normalizeCapabilities(capabilities) {
  if (capabilities == null) return [];
  if (!Array.isArray(capabilities) || capabilities.length > 32) {
    throw new TypeError("membership capabilities must be a bounded array");
  }
  return [
    ...new Set(
      capabilities.map((capability) => {
        if (typeof capability !== "string") {
          throw new TypeError("membership capability must be a string");
        }
        return requiredString(capability, "membership capability", 128);
      }),
    ),
  ].sort();
}

function normalizeJoinPolicy(policy = null) {
  const value = policy || {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("membership join policy must be an object");
  }
  const allowedScopes =
    value.allowedScopes == null ? null : normalizeScopes(value.allowedScopes);
  const maxDevices = value.maxDevices == null ? null : value.maxDevices;
  if (
    maxDevices !== null &&
    (!Number.isSafeInteger(maxDevices) ||
      maxDevices < 0 ||
      maxDevices > 1_000_000)
  ) {
    throw new TypeError(
      "membership policy maxDevices must be a bounded integer",
    );
  }
  if (
    value.allowRelayPairing != null &&
    typeof value.allowRelayPairing !== "boolean"
  ) {
    throw new TypeError("membership policy allowRelayPairing must be boolean");
  }
  return Object.freeze({
    policyVersion:
      value.policyVersion == null
        ? DEFAULT_JOIN_POLICY_VERSION
        : requiredString(value.policyVersion, "policyVersion", 512),
    allowedScopes:
      allowedScopes === null ? null : Object.freeze([...allowedScopes]),
    maxDevices,
    allowRelayPairing: value.allowRelayPairing !== false,
  });
}

function joinPolicyEventFields(policy) {
  const normalized = normalizeJoinPolicy(policy);
  return {
    policyVersion: normalized.policyVersion,
    policyAllowedScopes:
      normalized.allowedScopes === null ? null : [...normalized.allowedScopes],
    policyMaxDevices: normalized.maxDevices,
    policyAllowRelayPairing: normalized.allowRelayPairing,
  };
}

function joinPolicyFromEvent(event, label) {
  const present = JOIN_POLICY_EVENT_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(event, field),
  );
  if (present.length === 0) return null;
  if (present.length !== JOIN_POLICY_EVENT_FIELDS.length) {
    throw new TypeError(`${label} has an incomplete membership join policy`);
  }
  return normalizeJoinPolicy({
    policyVersion: event.policyVersion,
    allowedScopes: event.policyAllowedScopes,
    maxDevices: event.policyMaxDevices,
    allowRelayPairing: event.policyAllowRelayPairing,
  });
}

function joinPoliciesMatch(left, right) {
  return (
    canonicalJson(normalizeJoinPolicy(left)) ===
    canonicalJson(normalizeJoinPolicy(right))
  );
}

function enforceJoinAuthority(session, { scopes, via, capabilities, policy }) {
  const normalizedPolicy = normalizeJoinPolicy(policy);
  if (
    session.joinPolicy &&
    !joinPoliciesMatch(session.joinPolicy, normalizedPolicy)
  ) {
    throw new Error("Remote membership policy version or authority changed");
  }
  if (via !== "direct" && via !== "relay") {
    throw new TypeError("membership join transport is unsupported");
  }
  if (via === "relay" && !normalizedPolicy.allowRelayPairing) {
    throw new Error("Relay pairing is disabled by membership policy");
  }
  const normalizedCapabilities = normalizeCapabilities(capabilities);
  let grantedScopes = normalizeScopes(scopes);
  if (normalizedPolicy.allowedScopes !== null) {
    grantedScopes = grantedScopes.filter((scope) =>
      normalizedPolicy.allowedScopes.includes(scope),
    );
  }
  if (!normalizedCapabilities.includes(REMOTE_APPROVAL_BINDING_CAPABILITY)) {
    grantedScopes = grantedScopes.filter((scope) => scope !== "approve");
  }
  if (grantedScopes.length === 0) {
    throw new Error(
      "Remote membership scopes are denied by policy or capability",
    );
  }
  const deviceCount = [...session.members.values()].filter(
    (member) =>
      member.principalId !== session.hostPrincipalId &&
      member.status === "active",
  ).length;
  if (
    normalizedPolicy.maxDevices !== null &&
    deviceCount >= normalizedPolicy.maxDevices
  ) {
    throw new Error("Remote membership device limit reached");
  }
  return Object.freeze({
    policy: normalizedPolicy,
    scopes: Object.freeze([...grantedScopes]),
    capabilities: Object.freeze([...normalizedCapabilities]),
    via,
  });
}

function canonicalJson(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new TypeError("canonical JSON numbers must be safe integers");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`unsupported canonical JSON value: ${typeof value}`);
  }
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) {
      throw new TypeError("canonical JSON arrays must be dense and unadorned");
    }
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("canonical JSON objects must have a plain prototype");
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function hasExactKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) ===
      canonicalJson([...expected].sort())
  );
}

function decodeBase64Url(value, label, maximum = 8192) {
  const encoded = requiredString(value, label, maximum);
  if (!BASE64URL_RE.test(encoded)) {
    throw new TypeError(`${label} is not canonical base64url`);
  }
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== encoded) {
    throw new TypeError(`${label} is not canonical base64url`);
  }
  return decoded;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function eventHash(event) {
  const core = { ...event };
  delete core.eventHash;
  return sha256(
    Buffer.concat([
      Buffer.from("chainlesschain.remote-membership-event.v1\0", "utf8"),
      Buffer.from(canonicalJson(core), "utf8"),
    ]),
  );
}

export function createRemoteMembershipPrincipalCredential() {
  const pair = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return Object.freeze({
    type: "ed25519",
    publicKey: pair.publicKey.toString("base64url"),
    privateKeyPkcs8: pair.privateKey.toString("base64url"),
  });
}

function authenticationChallengeBytes(challenge) {
  return Buffer.concat([
    Buffer.from(AUTHENTICATION_CHALLENGE_DOMAIN, "utf8"),
    Buffer.from(canonicalJson(challenge), "utf8"),
  ]);
}

export function signRemoteMembershipAuthenticationChallenge(
  challenge,
  privateKeyPkcs8,
) {
  const privateDer = decodeBase64Url(privateKeyPkcs8, "privateKeyPkcs8");
  const privateKey = createPrivateKey({
    key: privateDer,
    type: "pkcs8",
    format: "der",
  });
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("privateKeyPkcs8 must contain an Ed25519 private key");
  }
  return sign(
    null,
    authenticationChallengeBytes(challenge),
    privateKey,
  ).toString("base64url");
}

function normalizePrincipalCredential(
  { type = "ed25519", publicKey } = {},
  label = "principalCredential",
) {
  if (!new Set(["ed25519", "relay-x25519"]).has(type)) {
    throw new TypeError(`${label}.type is unsupported`);
  }
  const encoded = requiredString(publicKey, `${label}.publicKey`, 4096);
  let der;
  try {
    der = decodeBase64Url(encoded, `${label}.publicKey`, 4096);
    const key = createPublicKey({ key: der, type: "spki", format: "der" });
    if (key.asymmetricKeyType !== (type === "ed25519" ? "ed25519" : "x25519")) {
      throw new TypeError("wrong asymmetric key type");
    }
  } catch (cause) {
    throw new TypeError(`${label}.publicKey is not a ${type} SPKI key`, {
      cause,
    });
  }
  const digest = sha256(der);
  return Object.freeze({
    type,
    publicKey: encoded,
    digest,
    principalId: `${type}:${digest}`,
  });
}

function publicMember(member) {
  return Object.freeze({
    principalId: member.principalId,
    membershipEpoch: member.membershipEpoch,
    status: member.status,
    scopes: Object.freeze([...member.scopes]),
    credentialKeySha256: member.credentialDigest,
  });
}

function publicLease(lease) {
  return Object.freeze({ ...lease });
}

function publicSessionSnapshot(session, generation) {
  return Object.freeze({
    sessionId: session.sessionId,
    agentSessionId: session.agentSessionId,
    hostPrincipalId: session.hostPrincipalId,
    sessionEpoch: session.sessionEpoch,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    status: session.status,
    authorityGeneration: String(generation),
    members: Object.freeze(
      [...session.members.values()]
        .map(publicMember)
        .sort((left, right) =>
          left.principalId.localeCompare(right.principalId),
        ),
    ),
    leases: Object.freeze(
      [...session.leases.values()]
        .map(publicLease)
        .sort((left, right) => left.leaseId.localeCompare(right.leaseId)),
    ),
  });
}

function replayStore(store, coordinatorId, { missing = false } = {}) {
  if (missing && Object.keys(store).length === 0) {
    return {
      generation: 0n,
      headHash: null,
      events: [],
      sessions: new Map(),
      lastOccurredAtMs: 0,
    };
  }
  if (
    !hasExactKeys(store, [
      "coordinatorId",
      "events",
      "generation",
      "headHash",
      "version",
    ]) ||
    store.version !== STORE_VERSION ||
    store.coordinatorId !== coordinatorId ||
    !Array.isArray(store.events)
  ) {
    throw new TypeError(
      "Remote membership coordinator store identity is invalid",
    );
  }
  const declaredGeneration = canonicalEpoch(store.generation, "generation", {
    zero: true,
  });
  if (store.headHash !== null && !DIGEST_RE.test(String(store.headHash))) {
    throw new TypeError("Remote membership coordinator head hash is invalid");
  }

  const sessions = new Map();
  let generation = 0n;
  let previousHash = null;
  let lastOccurredAtMs = 0;
  const seenEventIds = new Set();
  const seenLeaseIds = new Set();

  for (const [index, event] of store.events.entries()) {
    const label = `events[${index}]`;
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new TypeError(`${label} must be an object`);
    }
    if (event.schema !== EVENT_SCHEMA || !VALID_TYPES.has(event.type)) {
      throw new TypeError(`${label} has an unsupported schema or type`);
    }
    if (
      !hasExactKeys(event, EVENT_FIELDS[event.type]) &&
      !(
        LEGACY_EVENT_FIELDS[event.type] &&
        hasExactKeys(event, LEGACY_EVENT_FIELDS[event.type])
      )
    ) {
      throw new TypeError(
        `${label} has non-canonical fields for ${event.type}`,
      );
    }
    const currentGeneration = canonicalEpoch(
      event.generation,
      `${label}.generation`,
    );
    const priorGeneration = canonicalEpoch(
      event.previousGeneration,
      `${label}.previousGeneration`,
      { zero: true },
    );
    if (
      priorGeneration !== generation ||
      currentGeneration !== generation + 1n ||
      event.previousEventHash !== previousHash
    ) {
      throw new TypeError(`${label} breaks the append-only chain`);
    }
    requiredString(event.eventId, `${label}.eventId`);
    if (seenEventIds.has(event.eventId)) {
      throw new TypeError(`${label} repeats an event id`);
    }
    seenEventIds.add(event.eventId);
    safeTimestamp(event.occurredAtMs, `${label}.occurredAtMs`);
    if (event.occurredAtMs < lastOccurredAtMs) {
      throw new TypeError(
        `${label}.occurredAtMs moves authority time backward`,
      );
    }
    if (!DIGEST_RE.test(String(event.eventHash))) {
      throw new TypeError(`${label}.eventHash is invalid`);
    }
    if (eventHash(event) !== event.eventHash) {
      throw new TypeError(`${label}.eventHash does not cover the event`);
    }

    const sessionId = requiredString(event.sessionId, `${label}.sessionId`);
    if (event.type === "session.created") {
      if (sessions.has(sessionId)) {
        throw new TypeError(`${label} recreates a session`);
      }
      const hostPrincipalId = requiredString(
        event.hostPrincipalId,
        `${label}.hostPrincipalId`,
      );
      const hostCredential = normalizePrincipalCredential(
        {
          type: event.hostCredentialType,
          publicKey: event.hostCredentialPublicKey,
        },
        `${label}.hostCredential`,
      );
      if (
        hostCredential.digest !== event.hostCredentialDigest ||
        hostCredential.principalId !== hostPrincipalId
      ) {
        throw new TypeError(`${label}.hostPrincipalId is not key-bound`);
      }
      const sessionEpoch = String(
        canonicalEpoch(event.sessionEpoch, `${label}.sessionEpoch`),
      );
      const membershipEpoch = String(
        canonicalEpoch(event.membershipEpoch, `${label}.membershipEpoch`),
      );
      if (sessionEpoch !== "1" || membershipEpoch !== "1") {
        throw new TypeError(`${label} must start epochs at one`);
      }
      const expiresAt = safeTimestamp(event.expiresAt, `${label}.expiresAt`);
      if (expiresAt <= event.occurredAtMs) {
        throw new TypeError(`${label}.expiresAt must be in the future`);
      }
      sessions.set(sessionId, {
        sessionId,
        agentSessionId: requiredString(
          event.agentSessionId,
          `${label}.agentSessionId`,
        ),
        hostPrincipalId,
        sessionEpoch,
        createdAt: event.occurredAtMs,
        expiresAt,
        status: "active",
        joinPolicy: joinPolicyFromEvent(event, label),
        members: new Map([
          [
            hostPrincipalId,
            {
              principalId: hostPrincipalId,
              membershipEpoch,
              status: "active",
              scopes: normalizeScopes(event.scopes),
              credentialType: hostCredential.type,
              credentialPublicKey: hostCredential.publicKey,
              credentialDigest: hostCredential.digest,
              capabilities: [],
            },
          ],
        ]),
        leases: new Map(),
      });
    } else {
      const session = sessions.get(sessionId);
      if (!session) throw new TypeError(`${label} targets an unknown session`);
      const expectedSessionEpoch = String(
        canonicalEpoch(
          event.expectedSessionEpoch,
          `${label}.expectedSessionEpoch`,
        ),
      );
      if (expectedSessionEpoch !== session.sessionEpoch) {
        throw new TypeError(`${label} has a stale session epoch`);
      }
      if (
        event.type !== "session.closed" &&
        event.type !== "session.reenabled" &&
        event.occurredAtMs >= session.expiresAt
      ) {
        throw new TypeError(`${label} occurs after session expiry`);
      }

      if (event.type === "session.reenabled") {
        if (session.status !== "closed") {
          throw new TypeError(`${label} re-enables an active session`);
        }
        const currentHost = session.members.get(session.hostPrincipalId);
        if (
          event.hostPrincipalId !== session.hostPrincipalId ||
          !currentHost ||
          event.expectedHostMembershipEpoch !== currentHost.membershipEpoch
        ) {
          throw new TypeError(
            `${label} was not re-enabled by the current host`,
          );
        }
        const nextSessionEpoch = String(
          canonicalEpoch(event.sessionEpoch, `${label}.sessionEpoch`),
        );
        if (nextSessionEpoch !== String(BigInt(session.sessionEpoch) + 1n)) {
          throw new TypeError(`${label} does not advance the session epoch`);
        }
        const nextHost = normalizePrincipalCredential(
          {
            type: event.nextHostCredentialType,
            publicKey: event.nextHostCredentialPublicKey,
          },
          `${label}.nextHostCredential`,
        );
        if (
          nextHost.digest !== event.nextHostCredentialDigest ||
          nextHost.principalId !== event.nextHostPrincipalId
        ) {
          throw new TypeError(`${label}.nextHostPrincipalId is not key-bound`);
        }
        const priorNextHost = session.members.get(nextHost.principalId) || null;
        const nextMembershipEpoch = String(
          canonicalEpoch(event.membershipEpoch, `${label}.membershipEpoch`),
        );
        const expectedMembershipEpoch = priorNextHost
          ? String(BigInt(priorNextHost.membershipEpoch) + 1n)
          : "1";
        if (nextMembershipEpoch !== expectedMembershipEpoch) {
          throw new TypeError(`${label} does not advance the new host epoch`);
        }
        const expiresAt = safeTimestamp(event.expiresAt, `${label}.expiresAt`);
        if (expiresAt <= event.occurredAtMs) {
          throw new TypeError(`${label}.expiresAt must be in the future`);
        }
        for (const member of session.members.values()) {
          if (member.status === "active") {
            member.status = "revoked";
            member.membershipEpoch = String(
              BigInt(member.membershipEpoch) + 1n,
            );
          }
        }
        session.members.set(nextHost.principalId, {
          principalId: nextHost.principalId,
          membershipEpoch: nextMembershipEpoch,
          status: "active",
          scopes: normalizeScopes(event.scopes),
          credentialType: nextHost.type,
          credentialPublicKey: nextHost.publicKey,
          credentialDigest: nextHost.digest,
          capabilities: [],
        });
        session.hostPrincipalId = nextHost.principalId;
        session.sessionEpoch = nextSessionEpoch;
        session.expiresAt = expiresAt;
        session.status = "active";
        session.joinPolicy = joinPolicyFromEvent(event, label);
      } else if (event.type === "member.joined") {
        if (session.status !== "active") {
          throw new TypeError(`${label} joins a closed session`);
        }
        const principalId = requiredString(
          event.principalId,
          `${label}.principalId`,
        );
        if (principalId === session.hostPrincipalId) {
          throw new TypeError(`${label} replaces the host principal`);
        }
        const credential = normalizePrincipalCredential(
          {
            type: event.credentialType,
            publicKey: event.credentialPublicKey,
          },
          `${label}.credential`,
        );
        if (
          credential.digest !== event.credentialDigest ||
          credential.principalId !== principalId
        ) {
          throw new TypeError(`${label}.principalId is not key-bound`);
        }
        const prior = session.members.get(principalId) || null;
        if (prior?.status === "active") {
          throw new TypeError(`${label} replaces an active principal`);
        }
        const previousMembershipEpoch =
          event.previousMembershipEpoch === null
            ? null
            : String(
                canonicalEpoch(
                  event.previousMembershipEpoch,
                  `${label}.previousMembershipEpoch`,
                ),
              );
        if (previousMembershipEpoch !== (prior?.membershipEpoch || null)) {
          throw new TypeError(`${label} has a stale previous membership epoch`);
        }
        const membershipEpoch = String(
          canonicalEpoch(event.membershipEpoch, `${label}.membershipEpoch`),
        );
        const expected = prior
          ? String(BigInt(prior.membershipEpoch) + 1n)
          : "1";
        if (membershipEpoch !== expected) {
          throw new TypeError(`${label} does not advance the principal epoch`);
        }
        const eventPolicy = joinPolicyFromEvent(event, label);
        const joinVia = Object.prototype.hasOwnProperty.call(event, "joinVia")
          ? requiredString(event.joinVia, `${label}.joinVia`, 16)
          : "direct";
        const capabilities = Object.prototype.hasOwnProperty.call(
          event,
          "capabilities",
        )
          ? normalizeCapabilities(event.capabilities)
          : [];
        const declaredScopes = normalizeScopes(event.scopes);
        // Pre-capability stores could persist `approve` without proving that the
        // client understood the exact approval tuple. Preserve non-approval
        // membership on upgrade, but never grandfather that authority through
        // replay. A legacy approve-only member remains counted as active with no
        // usable scopes rather than silently freeing the device-cap slot.
        const replayedScopes = eventPolicy
          ? declaredScopes
          : declaredScopes.filter((scope) => scope !== "approve");
        if (eventPolicy) {
          if (
            session.joinPolicy &&
            !joinPoliciesMatch(session.joinPolicy, eventPolicy)
          ) {
            throw new TypeError(`${label} changes the session join policy`);
          }
          session.joinPolicy = eventPolicy;
          const authority = enforceJoinAuthority(session, {
            scopes: event.scopes,
            via: joinVia,
            capabilities,
            policy: eventPolicy,
          });
          if (
            canonicalJson(authority.scopes) !== canonicalJson(declaredScopes)
          ) {
            throw new TypeError(
              `${label} grants scopes outside join authority`,
            );
          }
        }
        session.members.set(principalId, {
          principalId,
          membershipEpoch,
          status: "active",
          scopes: replayedScopes,
          credentialType: credential.type,
          credentialPublicKey: credential.publicKey,
          credentialDigest: credential.digest,
          capabilities,
        });
      } else if (event.type === "member.revoked") {
        if (session.status !== "active") {
          throw new TypeError(`${label} revokes within a closed session`);
        }
        const principalId = requiredString(
          event.principalId,
          `${label}.principalId`,
        );
        const member = session.members.get(principalId);
        if (!member || member.status !== "active") {
          throw new TypeError(`${label} targets an inactive member`);
        }
        if (principalId === session.hostPrincipalId) {
          throw new TypeError(`${label} revokes the host principal`);
        }
        const host = session.members.get(session.hostPrincipalId);
        if (
          event.hostPrincipalId !== session.hostPrincipalId ||
          !host ||
          host.status !== "active" ||
          event.expectedHostMembershipEpoch !== host.membershipEpoch
        ) {
          throw new TypeError(
            `${label} was not authorized by the current host`,
          );
        }
        if (event.expectedMembershipEpoch !== member.membershipEpoch) {
          throw new TypeError(`${label} has a stale membership epoch`);
        }
        const nextEpoch = String(
          canonicalEpoch(event.membershipEpoch, `${label}.membershipEpoch`),
        );
        if (nextEpoch !== String(BigInt(member.membershipEpoch) + 1n)) {
          throw new TypeError(`${label} does not advance the principal epoch`);
        }
        const cancellable = [...session.leases.values()]
          .filter(
            (lease) =>
              lease.principalId === principalId &&
              (lease.status === "active" || lease.status === "acked"),
          )
          .map((lease) => lease.leaseId)
          .sort();
        if (
          canonicalJson(event.cancelledLeaseIds) !== canonicalJson(cancellable)
        ) {
          throw new TypeError(`${label} does not cancel every active lease`);
        }
        member.status = "revoked";
        member.membershipEpoch = nextEpoch;
        for (const leaseId of cancellable) {
          const lease = session.leases.get(leaseId);
          lease.status = "cancelled";
          lease.cancelReason = "membership-revoked";
          lease.terminalGeneration = event.generation;
        }
      } else if (event.type === "session.closed") {
        if (session.status !== "active") {
          throw new TypeError(`${label} closes an inactive session`);
        }
        const host = session.members.get(session.hostPrincipalId);
        if (
          event.hostPrincipalId !== session.hostPrincipalId ||
          !host ||
          host.status !== "active" ||
          event.expectedHostMembershipEpoch !== host.membershipEpoch
        ) {
          throw new TypeError(`${label} was not closed by the host`);
        }
        const nextEpoch = String(
          canonicalEpoch(event.sessionEpoch, `${label}.sessionEpoch`),
        );
        if (nextEpoch !== String(BigInt(session.sessionEpoch) + 1n)) {
          throw new TypeError(`${label} does not advance the session epoch`);
        }
        const cancellable = [...session.leases.values()]
          .filter(
            (lease) => lease.status === "active" || lease.status === "acked",
          )
          .map((lease) => lease.leaseId)
          .sort();
        if (
          canonicalJson(event.cancelledLeaseIds) !== canonicalJson(cancellable)
        ) {
          throw new TypeError(`${label} does not cancel every session lease`);
        }
        session.status = "closed";
        session.sessionEpoch = nextEpoch;
        for (const leaseId of cancellable) {
          const lease = session.leases.get(leaseId);
          lease.status = "cancelled";
          lease.cancelReason = "session-closed";
          lease.terminalGeneration = event.generation;
        }
      } else if (event.type === "lease.created") {
        if (session.status !== "active") {
          throw new TypeError(`${label} creates a lease for a closed session`);
        }
        const leaseId = requiredString(event.leaseId, `${label}.leaseId`);
        if (seenLeaseIds.has(leaseId) || session.leases.has(leaseId)) {
          throw new TypeError(`${label} repeats a lease id`);
        }
        seenLeaseIds.add(leaseId);
        const principalId = requiredString(
          event.principalId,
          `${label}.principalId`,
        );
        const member = session.members.get(principalId);
        if (
          !member ||
          member.status !== "active" ||
          member.membershipEpoch !== event.membershipEpoch ||
          !member.scopes.includes("approve")
        ) {
          throw new TypeError(`${label} is not bound to an active approver`);
        }
        if (event.hostPrincipalId !== session.hostPrincipalId) {
          throw new TypeError(`${label} has the wrong host principal`);
        }
        const expiresAt = safeTimestamp(event.expiresAt, `${label}.expiresAt`);
        if (expiresAt <= event.occurredAtMs || expiresAt > session.expiresAt) {
          throw new TypeError(`${label}.expiresAt is outside the session`);
        }
        const requestId = requiredString(event.requestId, `${label}.requestId`);
        const existingRequest = [...session.leases.values()].find(
          (lease) => lease.requestId === requestId,
        );
        if (existingRequest) {
          throw new TypeError(`${label} repeats an approval request`);
        }
        session.leases.set(leaseId, {
          leaseId,
          sessionId,
          sessionEpoch: session.sessionEpoch,
          principalId,
          membershipEpoch: member.membershipEpoch,
          hostPrincipalId: session.hostPrincipalId,
          requestId,
          fingerprint: requiredString(
            event.fingerprint,
            `${label}.fingerprint`,
          ),
          binding: requiredString(event.binding, `${label}.binding`),
          createdAt: event.occurredAtMs,
          expiresAt,
          createdGeneration: event.generation,
          status: "active",
          ackedGeneration: null,
          consumedGeneration: null,
          terminalGeneration: null,
          cancelReason: null,
          hostReceiptDigest: null,
        });
      } else {
        const leaseId = requiredString(event.leaseId, `${label}.leaseId`);
        const lease = session.leases.get(leaseId);
        if (!lease) throw new TypeError(`${label} targets an unknown lease`);
        if (event.type === "lease.acked") {
          if (lease.status !== "active") {
            throw new TypeError(`${label} targets a non-active lease`);
          }
          const host = session.members.get(session.hostPrincipalId);
          if (
            event.hostPrincipalId !== lease.hostPrincipalId ||
            !host ||
            host.status !== "active" ||
            event.expectedHostMembershipEpoch !== host.membershipEpoch ||
            event.expectedCreatedGeneration !== lease.createdGeneration ||
            !DIGEST_RE.test(String(event.hostReceiptDigest))
          ) {
            throw new TypeError(`${label} has an invalid host ACK binding`);
          }
          if (event.occurredAtMs >= lease.expiresAt) {
            throw new TypeError(`${label} ACKs an expired lease`);
          }
          lease.status = "acked";
          lease.ackedGeneration = event.generation;
          lease.hostReceiptDigest = event.hostReceiptDigest;
        } else if (event.type === "lease.consumed") {
          if (lease.status !== "acked") {
            throw new TypeError(`${label} targets a non-ACKed lease`);
          }
          const host = session.members.get(session.hostPrincipalId);
          if (
            event.hostPrincipalId !== lease.hostPrincipalId ||
            !host ||
            host.status !== "active" ||
            event.expectedHostMembershipEpoch !== host.membershipEpoch ||
            event.expectedAckedGeneration !== lease.ackedGeneration ||
            event.expectedMembershipEpoch !== lease.membershipEpoch ||
            event.requestId !== lease.requestId ||
            event.fingerprint !== lease.fingerprint ||
            event.binding !== lease.binding
          ) {
            throw new TypeError(`${label} has a stale execution binding`);
          }
          if (event.occurredAtMs >= lease.expiresAt) {
            throw new TypeError(`${label} consumes an expired lease`);
          }
          const member = session.members.get(lease.principalId);
          if (
            session.status !== "active" ||
            !member ||
            member.status !== "active" ||
            member.membershipEpoch !== lease.membershipEpoch
          ) {
            throw new TypeError(`${label} consumes after revocation`);
          }
          lease.status = "consumed";
          lease.consumedGeneration = event.generation;
          lease.terminalGeneration = event.generation;
        } else {
          if (lease.status !== "active" && lease.status !== "acked") {
            throw new TypeError(`${label} targets a terminal lease`);
          }
          requiredString(event.reason, `${label}.reason`);
          const host = session.members.get(session.hostPrincipalId);
          if (
            event.hostPrincipalId !== lease.hostPrincipalId ||
            !host ||
            host.status !== "active" ||
            event.expectedHostMembershipEpoch !== host.membershipEpoch
          ) {
            throw new TypeError(`${label} was not cancelled by the host`);
          }
          lease.status = "cancelled";
          lease.cancelReason = event.reason;
          lease.terminalGeneration = event.generation;
        }
      }
    }

    generation = currentGeneration;
    previousHash = event.eventHash;
    lastOccurredAtMs = event.occurredAtMs;
  }

  if (generation !== declaredGeneration || previousHash !== store.headHash) {
    throw new TypeError(
      "Remote membership coordinator head does not match events",
    );
  }
  return {
    generation,
    headHash: previousHash,
    events: [...store.events],
    sessions,
    lastOccurredAtMs,
  };
}

function loadOrCreateSigningKey(keyFile, lockOptions, lock) {
  let result;
  try {
    result = mutateSecurityStore(
      keyFile,
      KEY_LABEL,
      (draft) => {
        if (Object.keys(draft).length === 0) {
          const pair = generateKeyPairSync("ed25519", {
            publicKeyEncoding: { type: "spki", format: "der" },
            privateKeyEncoding: { type: "pkcs8", format: "der" },
          });
          draft.version = KEY_VERSION;
          draft.algorithm = "ed25519";
          draft.publicKeySpki = pair.publicKey.toString("base64url");
          draft.privateKeyPkcs8 = pair.privateKey.toString("base64url");
        }
        if (
          draft.version !== KEY_VERSION ||
          draft.algorithm !== "ed25519" ||
          typeof draft.publicKeySpki !== "string" ||
          typeof draft.privateKeyPkcs8 !== "string"
        ) {
          throw new TypeError("Remote membership signing key is invalid");
        }
        const publicDer = decodeBase64Url(
          draft.publicKeySpki,
          "signingKey.publicKeySpki",
          4096,
        );
        const privateDer = decodeBase64Url(
          draft.privateKeyPkcs8,
          "signingKey.privateKeyPkcs8",
          4096,
        );
        const publicKey = createPublicKey({
          key: publicDer,
          type: "spki",
          format: "der",
        });
        const privateKey = createPrivateKey({
          key: privateDer,
          type: "pkcs8",
          format: "der",
        });
        if (
          publicKey.asymmetricKeyType !== "ed25519" ||
          privateKey.asymmetricKeyType !== "ed25519" ||
          !createPublicKey(privateKey)
            .export({ type: "spki", format: "der" })
            .equals(publicDer)
        ) {
          throw new TypeError(
            "Remote membership signing key pair does not match",
          );
        }
        const keyDigest = sha256(publicDer);
        draft.keyId = `ed25519:${keyDigest}`;
        return {
          publicDer,
          publicKey,
          privateKey,
          keyDigest,
          keyId: draft.keyId,
        };
      },
      { ...lockOptions, lock },
    );
  } catch (cause) {
    throw unavailable(cause, keyFile);
  }
  return result;
}

function membershipVerdict(session, binding, requiredScope, now) {
  if (!session) return { ok: false, reason: "membership-session-unknown" };
  if (session.status !== "active") {
    return { ok: false, reason: "membership-session-closed" };
  }
  if (session.expiresAt <= now) {
    return { ok: false, reason: "membership-session-expired" };
  }
  if (session.sessionEpoch !== binding.sessionEpoch) {
    return { ok: false, reason: "stale-session-epoch" };
  }
  const member = session.members.get(binding.principalId);
  if (!member) return { ok: false, reason: "membership-unknown" };
  if (member.status !== "active") {
    return { ok: false, reason: "membership-revoked" };
  }
  if (member.membershipEpoch !== binding.membershipEpoch) {
    return { ok: false, reason: "stale-membership-epoch" };
  }
  if (requiredScope && !member.scopes.includes(requiredScope)) {
    return { ok: false, reason: "membership-scope-denied" };
  }
  return {
    ok: true,
    reason: null,
    binding: Object.freeze({
      authorityVersion: REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
      sessionId: session.sessionId,
      sessionEpoch: session.sessionEpoch,
      principalId: member.principalId,
      membershipEpoch: member.membershipEpoch,
      scopes: Object.freeze([...member.scopes]),
    }),
  };
}

export function getRemoteMembershipCoordinatorPaths() {
  const root = path.join(getMachineSecurityAnchorDir(), "remote-membership-v2");
  return Object.freeze({
    stateFile: path.join(root, "coordinator.json"),
    keyFile: path.join(root, "coordinator-ed25519.json"),
    witnessFile: path.join(root, "coordinator-witness.json"),
  });
}

export class DurableRemoteMembershipCoordinator {
  constructor({
    stateFile,
    keyFile,
    witnessFile,
    authorityLockFile = null,
    now = () => Date.now(),
    createId = randomUUID,
    createSecret = () => randomBytes(32).toString("base64url"),
    defaultLeaseTtlMs = DEFAULT_LEASE_TTL_MS,
    maxLeaseTtlMs = MAX_LEASE_TTL_MS,
    defaultChallengeTtlMs = DEFAULT_CHALLENGE_TTL_MS,
    maxChallengeTtlMs = MAX_CHALLENGE_TTL_MS,
    lockOptions,
    lock = withFileLock,
    faultHooks = null,
  } = {}) {
    const defaults = getRemoteMembershipCoordinatorPaths();
    this.stateFile = path.resolve(stateFile || defaults.stateFile);
    this.keyFile = path.resolve(keyFile || defaults.keyFile);
    this.witnessFile = path.resolve(witnessFile || defaults.witnessFile);
    this.authorityLockFile = path.resolve(
      authorityLockFile || `${this.stateFile}.authority`,
    );
    this._now = now;
    this._createId = createId;
    this._createSecret = createSecret;
    this._defaultLeaseTtlMs = Math.max(1, Number(defaultLeaseTtlMs));
    this._maxLeaseTtlMs = Math.max(
      this._defaultLeaseTtlMs,
      Number(maxLeaseTtlMs),
    );
    this._defaultChallengeTtlMs = Math.max(1, Number(defaultChallengeTtlMs));
    this._maxChallengeTtlMs = Math.max(
      this._defaultChallengeTtlMs,
      Number(maxChallengeTtlMs),
    );
    this._lockOptions = lockOptions;
    this._lock = lock;
    this._faultHooks = faultHooks || {};
    this._quarantined = false;
    this._serverInstanceId = `server-${requiredString(
      this._createSecret(),
      "serverInstanceId",
      4096,
    )}`;
    this._authenticationChallenges = new Map();
    fs.mkdirSync(path.dirname(this.authorityLockFile), {
      recursive: true,
      mode: 0o700,
    });
    this._key = this._withAuthorityLock(() =>
      loadOrCreateSigningKey(this.keyFile, this._lockOptions, this._lock),
    );
    this.coordinatorId = this._key.keyId;
    this._observedGeneration = 0n;
    this._observedAuthorityTimeMs = 0;
  }

  _withAuthorityLock(task) {
    if (this._quarantined) {
      throw coordinatorError(
        REMOTE_MEMBERSHIP_COORDINATOR_UNAVAILABLE_CODE,
        "Remote membership coordinator is quarantined after an unknown commit; restart and reconcile before reuse",
        null,
        { filePath: this.stateFile, commitState: "unknown" },
      );
    }
    return this._lock(this.authorityLockFile, task, {
      timeoutMs: 30_000,
      staleMs: 30_000,
      failIfUnavailable: true,
      ...this._lockOptions,
    });
  }

  _authorityNow(snapshot, label = "coordinator clock") {
    const now = safeTimestamp(this._now(), label);
    const durableAtMs = Math.max(
      snapshot.lastOccurredAtMs,
      this._observedAuthorityTimeMs,
    );
    if (now < durableAtMs) {
      throw rollback("authority clock moved backward", {
        observedAtMs: now,
        durableAtMs,
      });
    }
    this._observedAuthorityTimeMs = now;
    return now;
  }

  trustDescriptor() {
    return Object.freeze({
      authorityVersion: REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
      algorithm: "ed25519",
      coordinatorId: this.coordinatorId,
      keyId: this._key.keyId,
      publicKeySpki: this._key.publicDer.toString("base64url"),
      publicKeySha256: this._key.keyDigest,
    });
  }

  relayAuthorityDescriptor() {
    return Object.freeze({
      authorityVersion: REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
      coordinatorId: this.coordinatorId,
      serverInstanceId: this._serverInstanceId,
    });
  }

  _observe(snapshot) {
    if (snapshot.generation < this._observedGeneration) {
      throw rollback("live coordinator generation moved backward", {
        observedGeneration: String(snapshot.generation),
        currentGeneration: String(this._observedGeneration),
        filePath: this.stateFile,
      });
    }
    this._observedGeneration = snapshot.generation;
  }

  _validateWitness(witness) {
    if (
      !hasExactKeys(witness, [
        "coordinatorId",
        "generation",
        "headHash",
        "pending",
        "version",
      ]) ||
      witness.version !== WITNESS_VERSION ||
      witness.coordinatorId !== this.coordinatorId ||
      !NON_NEGATIVE_RE.test(String(witness.generation)) ||
      (witness.headHash !== null && !DIGEST_RE.test(String(witness.headHash)))
    ) {
      throw new TypeError("Remote membership witness is invalid");
    }
    if (witness.pending !== null) {
      if (
        !hasExactKeys(witness.pending, [
          "generation",
          "headHash",
          "previousGeneration",
          "previousHeadHash",
        ]) ||
        !POSITIVE_RE.test(String(witness.pending.generation)) ||
        !NON_NEGATIVE_RE.test(String(witness.pending.previousGeneration)) ||
        !DIGEST_RE.test(String(witness.pending.headHash)) ||
        (witness.pending.previousHeadHash !== null &&
          !DIGEST_RE.test(String(witness.pending.previousHeadHash))) ||
        BigInt(witness.pending.generation) !==
          BigInt(witness.generation) + 1n ||
        witness.pending.previousGeneration !== witness.generation ||
        witness.pending.previousHeadHash !== witness.headHash
      ) {
        throw new TypeError(
          "Remote membership witness pending commit is invalid",
        );
      }
    }
    return witness;
  }

  _writeInitialWitness() {
    mutateSecurityStore(
      this.witnessFile,
      WITNESS_LABEL,
      (draft) => {
        if (Object.keys(draft).length !== 0) {
          this._validateWitness(draft);
          return;
        }
        draft.version = WITNESS_VERSION;
        draft.coordinatorId = this.coordinatorId;
        draft.generation = "0";
        draft.headHash = null;
        draft.pending = null;
      },
      { ...this._lockOptions, lock: this._lock },
    );
  }

  _reconcileWitness(snapshot) {
    const filePath = this.witnessFile;
    try {
      let witness = readSecurityStore(filePath, WITNESS_LABEL);
      if (Object.keys(witness).length === 0) {
        if (snapshot.generation !== 0n || snapshot.headHash !== null) {
          throw rollback("durable coordinator state has no rollback witness", {
            observedGeneration: String(snapshot.generation),
            filePath: this.stateFile,
            witnessFile: filePath,
          });
        }
        this._writeInitialWitness();
        witness = readSecurityStore(filePath, WITNESS_LABEL);
      }
      this._validateWitness(witness);
      const committedMatches =
        BigInt(witness.generation) === snapshot.generation &&
        witness.headHash === snapshot.headHash;
      const pendingMatches =
        witness.pending !== null &&
        BigInt(witness.pending.generation) === snapshot.generation &&
        witness.pending.headHash === snapshot.headHash;
      if (!committedMatches && !pendingMatches) {
        throw rollback(
          "state and witness do not describe one recoverable commit",
          {
            witnessedGeneration: witness.generation,
            pendingGeneration: witness.pending?.generation || null,
            observedGeneration: String(snapshot.generation),
            filePath: this.stateFile,
            witnessFile: filePath,
          },
        );
      }
      if (witness.pending !== null) {
        mutateSecurityStore(
          filePath,
          WITNESS_LABEL,
          (draft) => {
            this._validateWitness(draft);
            if (canonicalJson(draft) !== canonicalJson(witness)) {
              throw rollback("coordinator witness changed during recovery");
            }
            if (pendingMatches) {
              draft.generation = witness.pending.generation;
              draft.headHash = witness.pending.headHash;
            }
            draft.pending = null;
          },
          { ...this._lockOptions, lock: this._lock },
        );
      }
    } catch (cause) {
      if (cause?.code === REMOTE_MEMBERSHIP_COORDINATOR_ROLLBACK_CODE) {
        throw cause;
      }
      throw unavailable(cause, filePath);
    }
  }

  _prepareWitness(previous, next) {
    try {
      mutateSecurityStore(
        this.witnessFile,
        WITNESS_LABEL,
        (draft) => {
          this._validateWitness(draft);
          if (
            draft.pending !== null ||
            BigInt(draft.generation) !== previous.generation ||
            draft.headHash !== previous.headHash ||
            next.generation !== previous.generation + 1n
          ) {
            throw rollback(
              "coordinator witness cannot prepare the next commit",
            );
          }
          draft.pending = {
            generation: String(next.generation),
            headHash: next.headHash,
            previousGeneration: String(previous.generation),
            previousHeadHash: previous.headHash,
          };
        },
        { ...this._lockOptions, lock: this._lock },
      );
    } catch (cause) {
      if (cause?.code === REMOTE_MEMBERSHIP_COORDINATOR_ROLLBACK_CODE) {
        throw cause;
      }
      throw unavailable(cause, this.witnessFile);
    }
  }

  _commitWitness(snapshot) {
    try {
      mutateSecurityStore(
        this.witnessFile,
        WITNESS_LABEL,
        (draft) => {
          this._validateWitness(draft);
          if (
            draft.pending === null ||
            BigInt(draft.pending.generation) !== snapshot.generation ||
            draft.pending.headHash !== snapshot.headHash
          ) {
            throw rollback("coordinator witness lost its prepared commit");
          }
          draft.generation = draft.pending.generation;
          draft.headHash = draft.pending.headHash;
          draft.pending = null;
        },
        { ...this._lockOptions, lock: this._lock },
      );
    } catch (cause) {
      if (cause?.code === REMOTE_MEMBERSHIP_COORDINATOR_ROLLBACK_CODE) {
        throw cause;
      }
      throw unavailable(cause, this.witnessFile);
    }
  }

  _readLocked() {
    try {
      const existed = fs.existsSync(this.stateFile);
      const snapshot = replayStore(
        readSecurityStore(this.stateFile, STORE_LABEL),
        this.coordinatorId,
        { missing: !existed },
      );
      this._observe(snapshot);
      this._reconcileWitness(snapshot);
      return snapshot;
    } catch (cause) {
      throw unavailable(cause, this.stateFile);
    }
  }

  _read() {
    try {
      return this._withAuthorityLock(() => this._readLocked());
    } catch (cause) {
      throw unavailable(cause, this.stateFile);
    }
  }

  _withRead(task) {
    try {
      return this._withAuthorityLock(() => {
        const snapshot = this._readLocked();
        const now = this._authorityNow(snapshot);
        return task(snapshot, now);
      });
    } catch (cause) {
      throw unavailable(cause, this.stateFile);
    }
  }

  _mutate(buildEvent) {
    let prepared = false;
    try {
      return this._withAuthorityLock(() => {
        const previous = this._readLocked();
        const now = this._authorityNow(previous);
        const generation = previous.generation + 1n;
        const event = {
          schema: EVENT_SCHEMA,
          eventId: requiredString(this._createId(), "eventId"),
          generation: String(generation),
          previousGeneration: String(previous.generation),
          previousEventHash: previous.headHash,
          occurredAtMs: now,
          ...buildEvent(previous, String(generation), now),
        };
        event.eventHash = eventHash(event);
        const nextStore = {
          version: STORE_VERSION,
          coordinatorId: this.coordinatorId,
          generation: String(generation),
          headHash: event.eventHash,
          events: [...previous.events, event],
        };
        const verified = replayStore(nextStore, this.coordinatorId);
        this._prepareWitness(previous, verified);
        prepared = true;
        const result = mutateSecurityStore(
          this.stateFile,
          STORE_LABEL,
          (draft) => {
            const current = replayStore(draft, this.coordinatorId, {
              missing: !fs.existsSync(this.stateFile),
            });
            if (
              current.generation !== previous.generation ||
              current.headHash !== previous.headHash
            ) {
              throw rollback(
                "coordinator state changed outside its authority lock",
              );
            }
            for (const key of Object.keys(draft)) delete draft[key];
            Object.assign(draft, structuredClone(nextStore));
            return { snapshot: verified, event };
          },
          { ...this._lockOptions, lock: this._lock },
        );
        this._faultHooks.afterStateCommit?.({
          event: structuredClone(result.event),
          stateFile: this.stateFile,
          witnessFile: this.witnessFile,
        });
        this._observe(result.snapshot);
        this._commitWitness(result.snapshot);
        prepared = false;
        return result;
      });
    } catch (cause) {
      if (prepared) {
        this._quarantined = true;
        cause.commitState = "unknown";
      }
      throw unavailable(cause, this.stateFile);
    }
  }

  _statement(kind, payload, generation, issuedAtMs) {
    const core = {
      schema: REMOTE_MEMBERSHIP_STATEMENT_SCHEMA,
      authorityVersion: REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
      algorithm: "ed25519",
      coordinatorId: this.coordinatorId,
      keyId: this._key.keyId,
      generation: String(generation),
      issuedAtMs: safeTimestamp(issuedAtMs, "statement clock"),
      kind,
      payload,
    };
    const signature = sign(
      null,
      Buffer.from(canonicalJson(core), "utf8"),
      this._key.privateKey,
    ).toString("base64url");
    return Object.freeze({ ...core, signature });
  }

  _snapshotStatement(session, generation, issuedAtMs) {
    return this._statement(
      "session.snapshot",
      publicSessionSnapshot(session, generation),
      generation,
      issuedAtMs,
    );
  }

  _newAuthenticationChallenge({
    purpose,
    session,
    member,
    credential,
    scopes = null,
    capabilities = null,
    joinPolicy = null,
    joinVia = null,
    nextCredential = null,
    nextSessionExpiresAt = null,
    connectionNonce,
    now,
    ttlMs = null,
  }) {
    const requestedTtl =
      ttlMs === null
        ? this._defaultChallengeTtlMs
        : safeTimestamp(ttlMs, "challengeTtlMs");
    if (requestedTtl <= 0) {
      throw new TypeError("challengeTtlMs must be positive");
    }
    const expiresAtMs = Math.min(
      now + Math.min(requestedTtl, this._maxChallengeTtlMs),
      session.expiresAt,
    );
    if (expiresAtMs <= now) {
      throw new Error("Remote membership authentication challenge expired");
    }
    for (const [id, prior] of this._authenticationChallenges) {
      if (prior.expiresAtMs <= now) this._authenticationChallenges.delete(id);
    }
    const challengeId = `challenge-${requiredString(
      this._createId(),
      "challengeId",
    )}`;
    if (this._authenticationChallenges.has(challengeId)) {
      throw new Error("Remote membership authentication challenge id collided");
    }
    const challenge = Object.freeze({
      schema: AUTHENTICATION_CHALLENGE_SCHEMA,
      authorityVersion: REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
      coordinatorId: this.coordinatorId,
      serverInstanceId: this._serverInstanceId,
      challengeId,
      purpose,
      sessionId: session.sessionId,
      sessionEpoch: session.sessionEpoch,
      principalId: credential.principalId,
      membershipEpoch: member.membershipEpoch,
      credentialType: credential.type,
      credentialPublicKey: credential.publicKey,
      credentialKeySha256: credential.digest,
      connectionNonce: requiredString(connectionNonce, "connectionNonce", 4096),
      serverNonce: requiredString(this._createSecret(), "serverNonce", 4096),
      scopes: scopes === null ? null : Object.freeze([...scopes]),
      capabilities:
        capabilities === null
          ? null
          : Object.freeze([...normalizeCapabilities(capabilities)]),
      joinPolicy:
        joinPolicy === null
          ? null
          : Object.freeze({ ...normalizeJoinPolicy(joinPolicy) }),
      joinVia,
      nextCredentialType: nextCredential?.type || null,
      nextCredentialPublicKey: nextCredential?.publicKey || null,
      nextCredentialKeySha256: nextCredential?.digest || null,
      nextPrincipalId: nextCredential?.principalId || null,
      nextSessionExpiresAt,
      issuedAtMs: now,
      expiresAtMs,
    });
    this._authenticationChallenges.set(challengeId, challenge);
    return challenge;
  }

  issueMemberJoinChallenge({
    sessionId,
    expectedSessionEpoch,
    scopes,
    credentialPublicKey,
    connectionNonce,
    ttlMs = null,
    capabilities = null,
    joinPolicy = null,
  } = {}) {
    const normalizedSessionId = requiredString(sessionId, "sessionId");
    const sessionEpoch = String(
      canonicalEpoch(expectedSessionEpoch, "expectedSessionEpoch"),
    );
    const normalizedScopes = normalizeScopes(scopes);
    const normalizedCapabilities = normalizeCapabilities(capabilities);
    const normalizedJoinPolicy = normalizeJoinPolicy(joinPolicy);
    const credential = normalizePrincipalCredential(
      { type: "ed25519", publicKey: credentialPublicKey },
      "credential",
    );
    return this._withRead((snapshot, now) => {
      const session = snapshot.sessions.get(normalizedSessionId);
      if (
        !session ||
        session.status !== "active" ||
        session.sessionEpoch !== sessionEpoch ||
        session.expiresAt <= now
      ) {
        throw new Error("Remote membership join challenge denied");
      }
      const prior = session.members.get(credential.principalId) || null;
      if (prior?.status === "active") {
        throw new Error("Remote membership principal is already active");
      }
      enforceJoinAuthority(session, {
        scopes: normalizedScopes,
        via: "direct",
        capabilities: normalizedCapabilities,
        policy: normalizedJoinPolicy,
      });
      return this._newAuthenticationChallenge({
        purpose: "member.join",
        session,
        member: {
          membershipEpoch: prior
            ? String(BigInt(prior.membershipEpoch) + 1n)
            : "1",
        },
        credential,
        scopes: normalizedScopes,
        capabilities: normalizedCapabilities,
        joinPolicy: normalizedJoinPolicy,
        joinVia: "direct",
        connectionNonce,
        now,
        ttlMs,
      });
    });
  }

  issueSessionResumeChallenge({
    sessionId,
    principalId,
    connectionNonce,
    ttlMs = null,
  } = {}) {
    const normalizedSessionId = requiredString(sessionId, "sessionId");
    const normalizedPrincipal = requiredString(principalId, "principalId");
    return this._withRead((snapshot, now) => {
      const session = snapshot.sessions.get(normalizedSessionId);
      const member = session?.members.get(normalizedPrincipal);
      if (
        !session ||
        session.status !== "active" ||
        session.expiresAt <= now ||
        !member ||
        member.status !== "active" ||
        member.credentialType !== "ed25519"
      ) {
        throw coordinatorError(
          REMOTE_MEMBERSHIP_NOT_ACTIVE_CODE,
          "Remote membership is not active for resume",
        );
      }
      return this._newAuthenticationChallenge({
        purpose: "session.resume",
        session,
        member,
        credential: normalizePrincipalCredential(
          {
            type: member.credentialType,
            publicKey: member.credentialPublicKey,
          },
          "memberCredential",
        ),
        connectionNonce,
        now,
        ttlMs,
      });
    });
  }

  issueSessionReenableChallenge({
    sessionId,
    principalId,
    connectionNonce,
    newHostCredentialPublicKeySpki = null,
    scopes,
    expiresAt,
    joinPolicy = null,
    ttlMs = null,
  } = {}) {
    const normalizedSessionId = requiredString(sessionId, "sessionId");
    const normalizedPrincipal = requiredString(principalId, "principalId");
    const normalizedScopes = normalizeScopes(scopes);
    const normalizedExpiresAt = safeTimestamp(expiresAt, "expiresAt");
    const normalizedJoinPolicy = normalizeJoinPolicy(joinPolicy);
    return this._withRead((snapshot, now) => {
      const session = snapshot.sessions.get(normalizedSessionId);
      const member = session?.members.get(normalizedPrincipal);
      if (
        !session ||
        session.status !== "closed" ||
        session.hostPrincipalId !== normalizedPrincipal ||
        !member ||
        member.status !== "active" ||
        member.credentialType !== "ed25519" ||
        normalizedExpiresAt <= now
      ) {
        throw new Error("Remote membership session re-enable challenge denied");
      }
      const nextCredential = normalizePrincipalCredential(
        {
          type: "ed25519",
          publicKey:
            newHostCredentialPublicKeySpki || member.credentialPublicKey,
        },
        "nextHostCredential",
      );
      return this._newAuthenticationChallenge({
        purpose: "session.reenable",
        session,
        member,
        credential: normalizePrincipalCredential(
          {
            type: member.credentialType,
            publicKey: member.credentialPublicKey,
          },
          "memberCredential",
        ),
        scopes: normalizedScopes,
        joinPolicy: normalizedJoinPolicy,
        nextCredential,
        nextSessionExpiresAt: normalizedExpiresAt,
        connectionNonce,
        now,
        ttlMs,
      });
    });
  }

  _consumeAuthenticationChallenge(
    snapshot,
    now,
    { challengeId, connectionNonce, signature },
    expectedPurpose,
  ) {
    const normalizedId = requiredString(challengeId, "challengeId");
    const challenge = this._authenticationChallenges.get(normalizedId);
    // Delete before any validation. A malformed signature, stale epoch, or
    // failed state commit consumes the nonce and therefore fails closed.
    this._authenticationChallenges.delete(normalizedId);
    if (
      !challenge ||
      challenge.purpose !== expectedPurpose ||
      challenge.connectionNonce !==
        requiredString(connectionNonce, "connectionNonce", 4096) ||
      now < challenge.issuedAtMs ||
      challenge.expiresAtMs <= now
    ) {
      throw new Error("Remote membership authentication challenge denied");
    }
    const session = snapshot.sessions.get(challenge.sessionId);
    const reenable = expectedPurpose === "session.reenable";
    if (
      !session ||
      (reenable ? session.status !== "closed" : session.status !== "active") ||
      (!reenable && session.expiresAt <= now) ||
      session.sessionEpoch !== challenge.sessionEpoch
    ) {
      throw new Error("Remote membership authentication session is stale");
    }
    const current = session.members.get(challenge.principalId) || null;
    if (expectedPurpose === "member.join") {
      if (
        current?.status === "active" ||
        challenge.membershipEpoch !==
          (current ? String(BigInt(current.membershipEpoch) + 1n) : "1")
      ) {
        throw new Error("Remote membership join challenge is stale");
      }
    } else if (
      !current ||
      current.status !== "active" ||
      current.membershipEpoch !== challenge.membershipEpoch ||
      current.credentialDigest !== challenge.credentialKeySha256 ||
      (reenable && session.hostPrincipalId !== challenge.principalId)
    ) {
      throw new Error("Remote membership resume challenge is stale");
    }
    const credential = normalizePrincipalCredential(
      {
        type: challenge.credentialType,
        publicKey: challenge.credentialPublicKey,
      },
      "challengeCredential",
    );
    const signatureBytes = decodeBase64Url(signature, "signature", 256);
    if (
      credential.type !== "ed25519" ||
      signatureBytes.length !== 64 ||
      !verify(
        null,
        authenticationChallengeBytes(challenge),
        createPublicKey({
          key: decodeBase64Url(
            credential.publicKey,
            "challengeCredential.publicKey",
            4096,
          ),
          type: "spki",
          format: "der",
        }),
        signatureBytes,
      )
    ) {
      throw new Error("Remote membership possession proof is invalid");
    }
    return { challenge, session, current, credential };
  }

  createSession({
    sessionId,
    agentSessionId,
    scopes,
    expiresAt,
    hostPrincipalId = null,
    hostCredentialPublicKeySpki,
    joinPolicy = null,
  } = {}) {
    const normalizedSessionId = requiredString(sessionId, "sessionId");
    const normalizedAgent = requiredString(agentSessionId, "agentSessionId");
    const normalizedScopes = normalizeScopes(scopes);
    const normalizedExpiresAt = safeTimestamp(expiresAt, "expiresAt");
    const normalizedJoinPolicy = normalizeJoinPolicy(joinPolicy);
    const hostCredential = normalizePrincipalCredential(
      {
        type: "ed25519",
        publicKey: hostCredentialPublicKeySpki,
      },
      "hostCredential",
    );
    const normalizedHost = hostPrincipalId
      ? requiredString(hostPrincipalId, "hostPrincipalId")
      : hostCredential.principalId;
    if (normalizedHost !== hostCredential.principalId) {
      throw new TypeError(
        "hostPrincipalId must be derived from its Ed25519 key",
      );
    }
    const result = this._mutate((snapshot, _generation, now) => {
      if (snapshot.sessions.has(normalizedSessionId)) {
        throw new Error("Remote membership session already exists");
      }
      if (normalizedExpiresAt <= now) {
        throw new TypeError("expiresAt must be in the future");
      }
      return {
        type: "session.created",
        sessionId: normalizedSessionId,
        agentSessionId: normalizedAgent,
        hostPrincipalId: normalizedHost,
        hostCredentialType: hostCredential.type,
        hostCredentialPublicKey: hostCredential.publicKey,
        hostCredentialDigest: hostCredential.digest,
        sessionEpoch: "1",
        membershipEpoch: "1",
        ...joinPolicyEventFields(normalizedJoinPolicy),
        scopes: normalizedScopes,
        expiresAt: normalizedExpiresAt,
      };
    });
    const session = result.snapshot.sessions.get(normalizedSessionId);
    return Object.freeze({
      authorityVersion: REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
      trust: this.trustDescriptor(),
      sessionId: normalizedSessionId,
      sessionEpoch: session.sessionEpoch,
      hostPrincipalId: normalizedHost,
      membershipEpoch: session.members.get(normalizedHost).membershipEpoch,
      hostCredentialPublicKeySpki: hostCredential.publicKey,
      statement: this._snapshotStatement(
        session,
        result.snapshot.generation,
        result.event.occurredAtMs,
      ),
    });
  }

  resumeSession({ challengeId, connectionNonce, signature } = {}) {
    try {
      return this._withAuthorityLock(() => {
        const snapshot = this._readLocked();
        const now = this._authorityNow(snapshot);
        const authenticated = this._consumeAuthenticationChallenge(
          snapshot,
          now,
          { challengeId, connectionNonce, signature },
          "session.resume",
        );
        const session = authenticated.session;
        return Object.freeze({
          authorityVersion: REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
          trust: this.trustDescriptor(),
          session: publicSessionSnapshot(session, snapshot.generation),
          principalId: authenticated.challenge.principalId,
          membershipEpoch: authenticated.challenge.membershipEpoch,
          nextConnectionNonce: requiredString(
            this._createSecret(),
            "nextConnectionNonce",
            4096,
          ),
          statement: this._snapshotStatement(session, snapshot.generation, now),
        });
      });
    } catch (cause) {
      throw unavailable(cause, this.stateFile);
    }
  }

  reenableSession({ challengeId, connectionNonce, signature } = {}) {
    const result = this._mutate((snapshot, _generation, now) => {
      const authenticated = this._consumeAuthenticationChallenge(
        snapshot,
        now,
        { challengeId, connectionNonce, signature },
        "session.reenable",
      );
      const { challenge, session } = authenticated;
      const nextCredential = normalizePrincipalCredential(
        {
          type: challenge.nextCredentialType,
          publicKey: challenge.nextCredentialPublicKey,
        },
        "nextHostCredential",
      );
      if (
        nextCredential.digest !== challenge.nextCredentialKeySha256 ||
        nextCredential.principalId !== challenge.nextPrincipalId ||
        challenge.nextSessionExpiresAt <= now
      ) {
        throw new Error("Remote membership session re-enable binding changed");
      }
      const priorNextHost =
        session.members.get(nextCredential.principalId) || null;
      return {
        type: "session.reenabled",
        sessionId: session.sessionId,
        expectedSessionEpoch: session.sessionEpoch,
        hostPrincipalId: session.hostPrincipalId,
        expectedHostMembershipEpoch: challenge.membershipEpoch,
        nextHostPrincipalId: nextCredential.principalId,
        nextHostCredentialType: nextCredential.type,
        nextHostCredentialPublicKey: nextCredential.publicKey,
        nextHostCredentialDigest: nextCredential.digest,
        sessionEpoch: String(BigInt(session.sessionEpoch) + 1n),
        membershipEpoch: priorNextHost
          ? String(BigInt(priorNextHost.membershipEpoch) + 1n)
          : "1",
        scopes: [...challenge.scopes],
        expiresAt: challenge.nextSessionExpiresAt,
        ...joinPolicyEventFields(challenge.joinPolicy),
      };
    });
    const session = result.snapshot.sessions.get(result.event.sessionId);
    const host = session.members.get(session.hostPrincipalId);
    return Object.freeze({
      authorityVersion: REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
      trust: this.trustDescriptor(),
      sessionId: session.sessionId,
      sessionEpoch: session.sessionEpoch,
      hostPrincipalId: session.hostPrincipalId,
      membershipEpoch: host.membershipEpoch,
      hostCredentialPublicKeySpki: host.credentialPublicKey,
      nextConnectionNonce: requiredString(
        this._createSecret(),
        "nextConnectionNonce",
        4096,
      ),
      statement: this._snapshotStatement(
        session,
        result.snapshot.generation,
        result.event.occurredAtMs,
      ),
    });
  }

  joinMember({ challengeId, connectionNonce, signature } = {}) {
    const result = this._mutate((snapshot, _generation, now) => {
      const authenticated = this._consumeAuthenticationChallenge(
        snapshot,
        now,
        { challengeId, connectionNonce, signature },
        "member.join",
      );
      const { challenge, session, current: prior, credential } = authenticated;
      if (session.hostPrincipalId === challenge.principalId) {
        throw new Error("Cannot replace the host membership");
      }
      const authority = enforceJoinAuthority(session, {
        scopes: challenge.scopes,
        via: challenge.joinVia,
        capabilities: challenge.capabilities,
        policy: challenge.joinPolicy,
      });
      return {
        type: "member.joined",
        sessionId: session.sessionId,
        expectedSessionEpoch: challenge.sessionEpoch,
        principalId: challenge.principalId,
        previousMembershipEpoch: prior?.membershipEpoch || null,
        membershipEpoch: challenge.membershipEpoch,
        credentialType: credential.type,
        credentialPublicKey: credential.publicKey,
        credentialDigest: credential.digest,
        ...joinPolicyEventFields(authority.policy),
        joinVia: authority.via,
        capabilities: [...authority.capabilities],
        scopes: [...authority.scopes],
      };
    });
    const session = result.snapshot.sessions.get(result.event.sessionId);
    const member = session.members.get(result.event.principalId);
    return Object.freeze({
      authorityVersion: REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
      principalId: member.principalId,
      credentialType: member.credentialType,
      credentialPublicKey: member.credentialPublicKey,
      sessionEpoch: session.sessionEpoch,
      membershipEpoch: member.membershipEpoch,
      scopes: Object.freeze([...member.scopes]),
      capabilities: Object.freeze([...(member.capabilities || [])]),
      nextConnectionNonce: requiredString(
        this._createSecret(),
        "nextConnectionNonce",
        4096,
      ),
      statement: this._snapshotStatement(
        session,
        result.snapshot.generation,
        result.event.occurredAtMs,
      ),
    });
  }

  joinRelayMember({
    sessionId,
    expectedSessionEpoch,
    scopes,
    mobilePeerId,
    mobilePublicKey,
    pairingTokenDigest,
    possessionCapability,
    capabilities = null,
    joinPolicy = null,
  } = {}) {
    const normalizedSessionId = requiredString(sessionId, "sessionId");
    const sessionEpoch = String(
      canonicalEpoch(expectedSessionEpoch, "expectedSessionEpoch"),
    );
    const normalizedScopes = normalizeScopes(scopes);
    const normalizedCapabilities = normalizeCapabilities(capabilities);
    const normalizedJoinPolicy = normalizeJoinPolicy(joinPolicy);
    const normalizedPeer = requiredString(mobilePeerId, "mobilePeerId");
    if (!DIGEST_RE.test(String(pairingTokenDigest))) {
      throw new TypeError("pairingTokenDigest must be a SHA-256 digest");
    }
    const credential = normalizePrincipalCredential(
      { type: "relay-x25519", publicKey: mobilePublicKey },
      "relayCredential",
    );
    const result = this._mutate((snapshot, _generation, now) => {
      const proof = consumeRemoteRelayPossessionCapability(
        possessionCapability,
        {
          sessionId: normalizedSessionId,
          mobilePeerId: normalizedPeer,
          mobilePublicKey: credential.publicKey,
          pairingTokenDigest,
          ...this.relayAuthorityDescriptor(),
        },
      );
      const session = snapshot.sessions.get(normalizedSessionId);
      if (
        !session ||
        session.status !== "active" ||
        session.sessionEpoch !== sessionEpoch
      ) {
        throw new Error("Remote relay membership join denied");
      }
      const prior = session.members.get(credential.principalId) || null;
      if (prior?.status === "active") {
        throw new Error("Remote relay principal is already active");
      }
      if (
        proof.envelopeSequence <= 0 ||
        !DIGEST_RE.test(proof.envelopeTranscriptHash) ||
        proof.pairingExpiresAtMs <= now ||
        canonicalJson(proof.authorizedScopes) !==
          canonicalJson(normalizeScopes(proof.authorizedScopes)) ||
        normalizedScopes.some(
          (scope) => !proof.authorizedScopes.includes(scope),
        )
      ) {
        throw new Error(
          "Remote relay transcript proof is malformed, expired, or over-scoped",
        );
      }
      const authority = enforceJoinAuthority(session, {
        scopes: normalizedScopes,
        via: "relay",
        capabilities: normalizedCapabilities,
        policy: normalizedJoinPolicy,
      });
      return {
        type: "member.joined",
        sessionId: normalizedSessionId,
        expectedSessionEpoch: sessionEpoch,
        principalId: credential.principalId,
        previousMembershipEpoch: prior?.membershipEpoch || null,
        membershipEpoch: prior
          ? String(BigInt(prior.membershipEpoch) + 1n)
          : "1",
        credentialType: credential.type,
        credentialPublicKey: credential.publicKey,
        credentialDigest: credential.digest,
        ...joinPolicyEventFields(authority.policy),
        joinVia: authority.via,
        capabilities: [...authority.capabilities],
        scopes: [...authority.scopes],
      };
    });
    const session = result.snapshot.sessions.get(normalizedSessionId);
    const member = session.members.get(result.event.principalId);
    return Object.freeze({
      authorityVersion: REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
      principalId: member.principalId,
      credentialType: member.credentialType,
      credentialPublicKey: member.credentialPublicKey,
      sessionEpoch: session.sessionEpoch,
      membershipEpoch: member.membershipEpoch,
      scopes: Object.freeze([...member.scopes]),
      capabilities: Object.freeze([...(member.capabilities || [])]),
      statement: this._snapshotStatement(
        session,
        result.snapshot.generation,
        result.event.occurredAtMs,
      ),
    });
  }

  readMembership(binding, requiredScope = null) {
    let normalized;
    try {
      normalized = {
        sessionId: requiredString(binding?.sessionId, "sessionId"),
        sessionEpoch: String(
          canonicalEpoch(binding?.sessionEpoch, "sessionEpoch"),
        ),
        principalId: requiredString(binding?.principalId, "principalId"),
        membershipEpoch: String(
          canonicalEpoch(binding?.membershipEpoch, "membershipEpoch"),
        ),
      };
    } catch {
      return { ok: false, reason: "membership-binding-required" };
    }
    return this._withRead((snapshot, now) =>
      membershipVerdict(
        snapshot.sessions.get(normalized.sessionId),
        normalized,
        requiredScope,
        now,
      ),
    );
  }

  revokeMember({
    sessionId,
    principalId,
    hostPrincipalId,
    expectedSessionEpoch,
    expectedMembershipEpoch,
    expectedHostMembershipEpoch,
  } = {}) {
    const normalizedSessionId = requiredString(sessionId, "sessionId");
    const normalizedPrincipal = requiredString(principalId, "principalId");
    const sessionEpoch = String(
      canonicalEpoch(expectedSessionEpoch, "expectedSessionEpoch"),
    );
    const membershipEpoch = String(
      canonicalEpoch(expectedMembershipEpoch, "expectedMembershipEpoch"),
    );
    const normalizedHost = requiredString(hostPrincipalId, "hostPrincipalId");
    const hostMembershipEpoch = String(
      canonicalEpoch(
        expectedHostMembershipEpoch,
        "expectedHostMembershipEpoch",
      ),
    );
    const result = this._mutate((snapshot, _generation, now) => {
      const session = snapshot.sessions.get(normalizedSessionId);
      const verdict = membershipVerdict(
        session,
        {
          sessionId: normalizedSessionId,
          sessionEpoch,
          principalId: normalizedPrincipal,
          membershipEpoch,
        },
        null,
        now,
      );
      const host = session?.members.get(normalizedHost);
      if (
        !verdict.ok ||
        normalizedPrincipal === session.hostPrincipalId ||
        normalizedHost !== session.hostPrincipalId ||
        !host ||
        host.status !== "active" ||
        host.membershipEpoch !== hostMembershipEpoch
      ) {
        throw new Error(`Remote membership revoke denied: ${verdict.reason}`);
      }
      const cancelledLeaseIds = [...session.leases.values()]
        .filter(
          (lease) =>
            lease.principalId === normalizedPrincipal &&
            (lease.status === "active" || lease.status === "acked"),
        )
        .map((lease) => lease.leaseId)
        .sort();
      return {
        type: "member.revoked",
        sessionId: normalizedSessionId,
        expectedSessionEpoch: sessionEpoch,
        hostPrincipalId: normalizedHost,
        expectedHostMembershipEpoch: hostMembershipEpoch,
        principalId: normalizedPrincipal,
        expectedMembershipEpoch: membershipEpoch,
        membershipEpoch: String(BigInt(membershipEpoch) + 1n),
        cancelledLeaseIds,
      };
    });
    const session = result.snapshot.sessions.get(normalizedSessionId);
    return Object.freeze({
      authorityVersion: REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
      revokedMembershipEpoch:
        session.members.get(normalizedPrincipal).membershipEpoch,
      cancelledLeaseIds: Object.freeze([...result.event.cancelledLeaseIds]),
      statement: this._snapshotStatement(
        session,
        result.snapshot.generation,
        result.event.occurredAtMs,
      ),
    });
  }

  closeSession({
    sessionId,
    hostPrincipalId,
    expectedSessionEpoch,
    expectedHostMembershipEpoch,
  } = {}) {
    const normalizedSessionId = requiredString(sessionId, "sessionId");
    const normalizedHost = requiredString(hostPrincipalId, "hostPrincipalId");
    const sessionEpoch = String(
      canonicalEpoch(expectedSessionEpoch, "expectedSessionEpoch"),
    );
    const hostMembershipEpoch = String(
      canonicalEpoch(
        expectedHostMembershipEpoch,
        "expectedHostMembershipEpoch",
      ),
    );
    let result;
    try {
      result = this._mutate((snapshot) => {
        const session = snapshot.sessions.get(normalizedSessionId);
        const host = session?.members.get(normalizedHost);
        if (
          !session ||
          session.status !== "active" ||
          session.hostPrincipalId !== normalizedHost ||
          session.sessionEpoch !== sessionEpoch ||
          !host ||
          host.status !== "active" ||
          host.membershipEpoch !== hostMembershipEpoch
        ) {
          throw new Error("Remote membership session close denied");
        }
        const cancelledLeaseIds = [...session.leases.values()]
          .filter(
            (lease) => lease.status === "active" || lease.status === "acked",
          )
          .map((lease) => lease.leaseId)
          .sort();
        return {
          type: "session.closed",
          sessionId: normalizedSessionId,
          expectedSessionEpoch: sessionEpoch,
          hostPrincipalId: normalizedHost,
          expectedHostMembershipEpoch: hostMembershipEpoch,
          sessionEpoch: String(BigInt(sessionEpoch) + 1n),
          cancelledLeaseIds,
        };
      });
    } catch (cause) {
      if (cause?.commitState === "unknown") throw cause;
      const terminal = this._withRead((snapshot, now) => {
        const session = snapshot.sessions.get(normalizedSessionId);
        const host = session?.members.get(normalizedHost);
        if (
          !session ||
          session.status !== "closed" ||
          session.hostPrincipalId !== normalizedHost ||
          session.sessionEpoch !== String(BigInt(sessionEpoch) + 1n) ||
          !host ||
          host.membershipEpoch !== hostMembershipEpoch
        ) {
          return null;
        }
        return Object.freeze({
          authorityVersion: REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
          sessionEpoch: session.sessionEpoch,
          cancelledLeaseIds: Object.freeze(
            [...session.leases.values()]
              .filter(
                (lease) =>
                  lease.cancelReason === "session-closed" &&
                  lease.terminalGeneration === String(snapshot.generation),
              )
              .map((lease) => lease.leaseId)
              .sort(),
          ),
          terminal: true,
          alreadyClosed: true,
          statement: this._snapshotStatement(session, snapshot.generation, now),
        });
      });
      if (terminal) return terminal;
      throw cause;
    }
    const session = result.snapshot.sessions.get(normalizedSessionId);
    return Object.freeze({
      authorityVersion: REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
      sessionEpoch: session.sessionEpoch,
      cancelledLeaseIds: Object.freeze([...result.event.cancelledLeaseIds]),
      terminal: true,
      alreadyClosed: false,
      statement: this._snapshotStatement(
        session,
        result.snapshot.generation,
        result.event.occurredAtMs,
      ),
    });
  }

  createApprovalLease({
    sessionId,
    sessionEpoch,
    principalId,
    membershipEpoch,
    hostPrincipalId,
    requestId,
    fingerprint,
    binding,
    expiresAt = null,
  } = {}) {
    const normalized = {
      sessionId: requiredString(sessionId, "sessionId"),
      sessionEpoch: String(canonicalEpoch(sessionEpoch, "sessionEpoch")),
      principalId: requiredString(principalId, "principalId"),
      membershipEpoch: String(
        canonicalEpoch(membershipEpoch, "membershipEpoch"),
      ),
      hostPrincipalId: requiredString(hostPrincipalId, "hostPrincipalId"),
      requestId: requiredString(requestId, "requestId"),
      fingerprint: requiredString(fingerprint, "fingerprint"),
      binding: requiredString(binding, "binding"),
    };
    const requestedExpiry =
      expiresAt == null ? null : safeTimestamp(expiresAt, "expiresAt");
    const result = this._mutate((snapshot, _generation, now) => {
      const boundedExpiry = Math.min(
        requestedExpiry == null
          ? now + this._defaultLeaseTtlMs
          : requestedExpiry,
        now + this._maxLeaseTtlMs,
      );
      const session = snapshot.sessions.get(normalized.sessionId);
      const verdict = membershipVerdict(session, normalized, "approve", now);
      if (
        !verdict.ok ||
        session.hostPrincipalId !== normalized.hostPrincipalId
      ) {
        throw new Error(`Remote approval lease denied: ${verdict.reason}`);
      }
      if (boundedExpiry <= now)
        throw new Error("Remote approval lease expired");
      const prior = [...session.leases.values()].find(
        (lease) => lease.requestId === normalized.requestId,
      );
      if (prior) {
        const same =
          prior.principalId === normalized.principalId &&
          prior.membershipEpoch === normalized.membershipEpoch &&
          prior.sessionEpoch === normalized.sessionEpoch &&
          prior.hostPrincipalId === normalized.hostPrincipalId &&
          prior.fingerprint === normalized.fingerprint &&
          prior.binding === normalized.binding;
        if (!same) throw new Error("Approval request lease binding changed");
        throw new Error("Approval request already has an execution lease");
      }
      return {
        type: "lease.created",
        sessionId: normalized.sessionId,
        expectedSessionEpoch: normalized.sessionEpoch,
        leaseId: `lease-${this._createId()}`,
        principalId: normalized.principalId,
        membershipEpoch: normalized.membershipEpoch,
        hostPrincipalId: normalized.hostPrincipalId,
        requestId: normalized.requestId,
        fingerprint: normalized.fingerprint,
        binding: normalized.binding,
        expiresAt: Math.min(boundedExpiry, session.expiresAt),
      };
    });
    const session = result.snapshot.sessions.get(normalized.sessionId);
    const lease = session.leases.get(result.event.leaseId);
    return Object.freeze({
      authorityVersion: REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
      lease: publicLease(lease),
      statement: this._statement(
        "lease.created",
        publicLease(lease),
        result.snapshot.generation,
        result.event.occurredAtMs,
      ),
    });
  }

  ackApprovalLease({
    sessionId,
    leaseId,
    hostPrincipalId,
    expectedHostMembershipEpoch,
    expectedCreatedGeneration,
    hostReceiptDigest,
  } = {}) {
    const normalizedSessionId = requiredString(sessionId, "sessionId");
    const normalizedLeaseId = requiredString(leaseId, "leaseId");
    const normalizedHost = requiredString(hostPrincipalId, "hostPrincipalId");
    const createdGeneration = String(
      canonicalEpoch(expectedCreatedGeneration, "expectedCreatedGeneration"),
    );
    const hostMembershipEpoch = String(
      canonicalEpoch(
        expectedHostMembershipEpoch,
        "expectedHostMembershipEpoch",
      ),
    );
    if (!DIGEST_RE.test(String(hostReceiptDigest))) {
      throw new TypeError("hostReceiptDigest must be a SHA-256 digest");
    }
    const result = this._mutate((snapshot, _generation, now) => {
      const session = snapshot.sessions.get(normalizedSessionId);
      const lease = session?.leases.get(normalizedLeaseId);
      const host = session?.members.get(normalizedHost);
      if (
        !session ||
        session.status !== "active" ||
        !lease ||
        lease.status !== "active" ||
        lease.hostPrincipalId !== normalizedHost ||
        !host ||
        host.status !== "active" ||
        host.membershipEpoch !== hostMembershipEpoch ||
        lease.createdGeneration !== createdGeneration ||
        lease.expiresAt <= now
      ) {
        throw new Error("Remote approval lease ACK denied");
      }
      const member = session.members.get(lease.principalId);
      if (
        !member ||
        member.status !== "active" ||
        member.membershipEpoch !== lease.membershipEpoch
      ) {
        throw new Error("Remote approval lease was revoked before ACK");
      }
      return {
        type: "lease.acked",
        sessionId: normalizedSessionId,
        expectedSessionEpoch: session.sessionEpoch,
        leaseId: normalizedLeaseId,
        hostPrincipalId: normalizedHost,
        expectedHostMembershipEpoch: hostMembershipEpoch,
        expectedCreatedGeneration: createdGeneration,
        hostReceiptDigest,
      };
    });
    const lease = result.snapshot.sessions
      .get(normalizedSessionId)
      .leases.get(normalizedLeaseId);
    return Object.freeze({
      authorityVersion: REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
      lease: publicLease(lease),
      statement: this._statement(
        "lease.acked",
        publicLease(lease),
        result.snapshot.generation,
        result.event.occurredAtMs,
      ),
    });
  }

  consumeApprovalLease({
    sessionId,
    leaseId,
    hostPrincipalId,
    expectedHostMembershipEpoch,
    expectedAckedGeneration,
    expectedMembershipEpoch,
    requestId,
    fingerprint,
    binding,
  } = {}) {
    const normalized = {
      sessionId: requiredString(sessionId, "sessionId"),
      leaseId: requiredString(leaseId, "leaseId"),
      hostPrincipalId: requiredString(hostPrincipalId, "hostPrincipalId"),
      expectedHostMembershipEpoch: String(
        canonicalEpoch(
          expectedHostMembershipEpoch,
          "expectedHostMembershipEpoch",
        ),
      ),
      expectedAckedGeneration: String(
        canonicalEpoch(expectedAckedGeneration, "expectedAckedGeneration"),
      ),
      expectedMembershipEpoch: String(
        canonicalEpoch(expectedMembershipEpoch, "expectedMembershipEpoch"),
      ),
      requestId: requiredString(requestId, "requestId"),
      fingerprint: requiredString(fingerprint, "fingerprint"),
      binding: requiredString(binding, "binding"),
    };
    const result = this._mutate((snapshot, _generation, now) => {
      const session = snapshot.sessions.get(normalized.sessionId);
      const lease = session?.leases.get(normalized.leaseId);
      const host = session?.members.get(normalized.hostPrincipalId);
      if (
        !session ||
        session.status !== "active" ||
        !lease ||
        lease.status !== "acked" ||
        lease.hostPrincipalId !== normalized.hostPrincipalId ||
        !host ||
        host.status !== "active" ||
        host.membershipEpoch !== normalized.expectedHostMembershipEpoch ||
        lease.ackedGeneration !== normalized.expectedAckedGeneration ||
        lease.membershipEpoch !== normalized.expectedMembershipEpoch ||
        lease.requestId !== normalized.requestId ||
        lease.fingerprint !== normalized.fingerprint ||
        lease.binding !== normalized.binding ||
        lease.expiresAt <= now
      ) {
        throw new Error("Remote approval execution lease consume denied");
      }
      const member = session.members.get(lease.principalId);
      if (
        !member ||
        member.status !== "active" ||
        member.membershipEpoch !== lease.membershipEpoch
      ) {
        throw new Error("Remote approval execution lease was revoked");
      }
      return {
        type: "lease.consumed",
        sessionId: normalized.sessionId,
        expectedSessionEpoch: session.sessionEpoch,
        leaseId: normalized.leaseId,
        hostPrincipalId: normalized.hostPrincipalId,
        expectedHostMembershipEpoch: normalized.expectedHostMembershipEpoch,
        expectedAckedGeneration: normalized.expectedAckedGeneration,
        expectedMembershipEpoch: normalized.expectedMembershipEpoch,
        requestId: normalized.requestId,
        fingerprint: normalized.fingerprint,
        binding: normalized.binding,
      };
    });
    const lease = result.snapshot.sessions
      .get(normalized.sessionId)
      .leases.get(normalized.leaseId);
    return Object.freeze({
      authorityVersion: REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
      dispatchAuthorized: true,
      lease: publicLease(lease),
      statement: this._statement(
        "lease.consumed",
        publicLease(lease),
        result.snapshot.generation,
        result.event.occurredAtMs,
      ),
    });
  }

  cancelApprovalLease({
    sessionId,
    leaseId,
    hostPrincipalId,
    expectedHostMembershipEpoch,
    reason,
  } = {}) {
    const normalizedSessionId = requiredString(sessionId, "sessionId");
    const normalizedLeaseId = requiredString(leaseId, "leaseId");
    const normalizedHost = requiredString(hostPrincipalId, "hostPrincipalId");
    const hostMembershipEpoch = String(
      canonicalEpoch(
        expectedHostMembershipEpoch,
        "expectedHostMembershipEpoch",
      ),
    );
    const normalizedReason = requiredString(reason, "reason");
    const result = this._mutate((snapshot) => {
      const session = snapshot.sessions.get(normalizedSessionId);
      const lease = session?.leases.get(normalizedLeaseId);
      const host = session?.members.get(normalizedHost);
      if (
        !session ||
        !lease ||
        (lease.status !== "active" && lease.status !== "acked") ||
        lease.hostPrincipalId !== normalizedHost ||
        !host ||
        host.status !== "active" ||
        host.membershipEpoch !== hostMembershipEpoch
      ) {
        throw new Error("Remote approval lease cancellation denied");
      }
      return {
        type: "lease.cancelled",
        sessionId: normalizedSessionId,
        expectedSessionEpoch: session.sessionEpoch,
        leaseId: normalizedLeaseId,
        hostPrincipalId: normalizedHost,
        expectedHostMembershipEpoch: hostMembershipEpoch,
        reason: normalizedReason,
      };
    });
    const lease = result.snapshot.sessions
      .get(normalizedSessionId)
      .leases.get(normalizedLeaseId);
    return Object.freeze({
      authorityVersion: REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
      lease: publicLease(lease),
      statement: this._statement(
        "lease.cancelled",
        publicLease(lease),
        result.snapshot.generation,
        result.event.occurredAtMs,
      ),
    });
  }

  snapshotSession(sessionId) {
    const normalizedSessionId = requiredString(sessionId, "sessionId");
    return this._withRead((snapshot, now) => {
      const session = snapshot.sessions.get(normalizedSessionId);
      if (!session) throw new Error("Remote membership session not found");
      return Object.freeze({
        session: publicSessionSnapshot(session, snapshot.generation),
        statement: this._snapshotStatement(session, snapshot.generation, now),
      });
    });
  }

  getSessionSnapshot(sessionId) {
    const normalizedSessionId = requiredString(sessionId, "sessionId");
    return this._withRead((snapshot, now) => {
      const session = snapshot.sessions.get(normalizedSessionId);
      if (!session) return null;
      return Object.freeze({
        session: publicSessionSnapshot(session, snapshot.generation),
        statement: this._snapshotStatement(session, snapshot.generation, now),
      });
    });
  }

  /**
   * Enumerate coordinator-owned session snapshots for server-process recovery.
   * The caller receives immutable public projections only; live transport
   * attachment remains a registry concern and is deliberately not persisted
   * here. Reading also exercises the normal clock/witness rollback checks.
   */
  listSessionSnapshots({ activeOnly = true } = {}) {
    return this._withRead((snapshot) =>
      Object.freeze(
        [...snapshot.sessions.values()]
          .filter((session) => !activeOnly || session.status === "active")
          .map((session) => publicSessionSnapshot(session, snapshot.generation))
          .sort((left, right) => left.sessionId.localeCompare(right.sessionId)),
      ),
    );
  }
}

export const _remoteMembershipCoordinatorInternals = Object.freeze({
  authenticationChallengeBytes,
  canonicalJson,
  eventHash,
  normalizePrincipalCredential,
  replayStore,
  sha256,
});
