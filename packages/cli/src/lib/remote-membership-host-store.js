/**
 * Host-side durable receipt store for server-signed Remote Membership leases.
 *
 * The coordinator and this store intentionally live on different hosts/state
 * roots. A WebSocket frame is never sufficient: the host pins the Ed25519 key,
 * verifies the statement, fsyncs an append-only receipt, and ACKs that exact
 * receipt before an approval may be returned. A separate machine-security
 * witness detects rollback of the ordinary host state file.
 */

import fs from "node:fs";
import path from "node:path";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  verify,
} from "node:crypto";
import { getMachineSecurityAnchorDir, getStatePath } from "./paths.js";
import {
  mutateSecurityStore,
  readSecurityStore,
} from "./durable-security-store.js";
import { withFileLock } from "./with-file-lock.js";
import {
  REMOTE_MEMBERSHIP_COORDINATOR_VERSION,
  REMOTE_MEMBERSHIP_STATEMENT_SCHEMA,
  _remoteMembershipCoordinatorInternals,
  signRemoteMembershipAuthenticationChallenge,
} from "./remote-membership-coordinator.js";

export const REMOTE_MEMBERSHIP_HOST_STORE_VERSION =
  "pinned-signed-receipt-high-water-v1";
export const REMOTE_MEMBERSHIP_HOST_UNAVAILABLE_CODE =
  "CC_REMOTE_MEMBERSHIP_HOST_STATE_UNAVAILABLE";
export const REMOTE_MEMBERSHIP_HOST_ROLLBACK_CODE =
  "CC_REMOTE_MEMBERSHIP_HOST_ROLLBACK";
export const REMOTE_MEMBERSHIP_HOST_TRUST_CODE =
  "CC_REMOTE_MEMBERSHIP_HOST_TRUST_REJECTED";

const STORE_VERSION = 1;
const WITNESS_VERSION = 2;
const RECORD_SCHEMA = "chainlesschain.remote-membership-host-record/v1";
const STORE_LABEL = "Remote membership host receipts";
const WITNESS_LABEL = "Remote membership host rollback witness";
const DIGEST_RE = /^[0-9a-f]{64}$/;
const POSITIVE_RE = /^[1-9]\d*$/;
const NON_NEGATIVE_RE = /^(?:0|[1-9]\d*)$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const VALID_STATEMENT_KINDS = new Set([
  "session.snapshot",
  "lease.created",
  "lease.acked",
  "lease.consumed",
  "lease.cancelled",
]);
const STATEMENT_FIELDS = Object.freeze([
  "algorithm",
  "authorityVersion",
  "coordinatorId",
  "generation",
  "issuedAtMs",
  "keyId",
  "kind",
  "payload",
  "schema",
  "signature",
]);
const SNAPSHOT_FIELDS = Object.freeze([
  "agentSessionId",
  "authorityGeneration",
  "createdAt",
  "expiresAt",
  "hostPrincipalId",
  "leases",
  "members",
  "sessionEpoch",
  "sessionId",
  "status",
]);
const MEMBER_FIELDS = Object.freeze([
  "credentialKeySha256",
  "membershipEpoch",
  "principalId",
  "scopes",
  "status",
]);
const LEASE_FIELDS = Object.freeze([
  "ackedGeneration",
  "binding",
  "cancelReason",
  "consumedGeneration",
  "createdAt",
  "createdGeneration",
  "expiresAt",
  "fingerprint",
  "hostPrincipalId",
  "hostReceiptDigest",
  "leaseId",
  "membershipEpoch",
  "principalId",
  "requestId",
  "sessionEpoch",
  "sessionId",
  "status",
  "terminalGeneration",
]);
const AUTHENTICATION_CHALLENGE_FIELDS = Object.freeze([
  "authorityVersion",
  "challengeId",
  "connectionNonce",
  "coordinatorId",
  "credentialKeySha256",
  "credentialPublicKey",
  "credentialType",
  "expiresAtMs",
  "issuedAtMs",
  "membershipEpoch",
  "principalId",
  "purpose",
  "schema",
  "scopes",
  "serverInstanceId",
  "serverNonce",
  "sessionEpoch",
  "sessionId",
]);
const COMMON_RECORD_FIELDS = Object.freeze([
  "previousRecordHash",
  "recordHash",
  "recordedAtMs",
  "revision",
  "schema",
  "type",
]);
const RECORD_FIELDS = Object.freeze({
  "trust.pinned": Object.freeze([...COMMON_RECORD_FIELDS, "trust"]),
  "session.bootstrap": Object.freeze([
    ...COMMON_RECORD_FIELDS,
    "bootstrap",
    "statement",
  ]),
  "statement.adopted": Object.freeze([
    ...COMMON_RECORD_FIELDS,
    "statement",
    "statementDigest",
  ]),
});
const BOOTSTRAP_FIELDS = Object.freeze([
  "agentSessionId",
  "coordinatorId",
  "hostCredentialPrivateKeyPkcs8",
  "hostCredentialPublicKeySpki",
  "hostPrincipalId",
  "sessionId",
]);

const { canonicalJson, sha256 } = _remoteMembershipCoordinatorInternals;

function hostError(code, message, cause = null, details = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = "RemoteMembershipHostStoreError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function unavailable(cause, filePath) {
  if (
    cause?.code === REMOTE_MEMBERSHIP_HOST_ROLLBACK_CODE ||
    cause?.code === REMOTE_MEMBERSHIP_HOST_TRUST_CODE ||
    cause?.code === REMOTE_MEMBERSHIP_HOST_UNAVAILABLE_CODE
  ) {
    return cause;
  }
  return hostError(
    REMOTE_MEMBERSHIP_HOST_UNAVAILABLE_CODE,
    "Remote membership host state is unavailable; remote execution is denied",
    cause,
    { filePath, commitState: cause?.commitState || null },
  );
}

function rollback(message, details = {}) {
  return hostError(
    REMOTE_MEMBERSHIP_HOST_ROLLBACK_CODE,
    `Remote membership host rollback detected: ${message}`,
    null,
    details,
  );
}

function trustRejected(message, details = {}) {
  return hostError(
    REMOTE_MEMBERSHIP_HOST_TRUST_CODE,
    `Remote membership coordinator trust rejected: ${message}`,
    null,
    details,
  );
}

function requiredString(value, label, maximum = 4096) {
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

function hasExactKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) ===
      canonicalJson([...expected].sort())
  );
}

function canonicalInteger(value, label, { zero = false } = {}) {
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

function recordHash(record) {
  const core = { ...record };
  delete core.recordHash;
  return sha256(
    Buffer.concat([
      Buffer.from("chainlesschain.remote-membership-host-record.v1\0"),
      Buffer.from(canonicalJson(core), "utf8"),
    ]),
  );
}

function statementDigest(statement) {
  return sha256(
    Buffer.concat([
      Buffer.from("chainlesschain.remote-membership-statement.v1\0"),
      Buffer.from(canonicalJson(statement), "utf8"),
    ]),
  );
}

function validateTrustDescriptor(trust) {
  if (
    !trust ||
    typeof trust !== "object" ||
    Array.isArray(trust) ||
    !hasExactKeys(trust, [
      "algorithm",
      "authorityVersion",
      "coordinatorId",
      "keyId",
      "publicKeySha256",
      "publicKeySpki",
    ]) ||
    trust.authorityVersion !== REMOTE_MEMBERSHIP_COORDINATOR_VERSION ||
    trust.algorithm !== "ed25519" ||
    typeof trust.publicKeySpki !== "string" ||
    !DIGEST_RE.test(String(trust.publicKeySha256)) ||
    trust.coordinatorId !== `ed25519:${trust.publicKeySha256}` ||
    trust.keyId !== trust.coordinatorId
  ) {
    throw trustRejected("descriptor is malformed");
  }
  let publicKey;
  let publicDer;
  try {
    publicDer = decodeBase64Url(
      trust.publicKeySpki,
      "trust.publicKeySpki",
      4096,
    );
    publicKey = createPublicKey({
      key: publicDer,
      type: "spki",
      format: "der",
    });
  } catch (cause) {
    throw trustRejected("public key cannot be imported", {
      causeCode: cause?.code || null,
    });
  }
  const actualDigest = createHash("sha256").update(publicDer).digest("hex");
  if (
    publicKey.asymmetricKeyType !== "ed25519" ||
    actualDigest !== trust.publicKeySha256
  ) {
    throw trustRejected("public key fingerprint does not match");
  }
  return Object.freeze({
    authorityVersion: trust.authorityVersion,
    algorithm: trust.algorithm,
    coordinatorId: trust.coordinatorId,
    keyId: trust.keyId,
    publicKeySpki: trust.publicKeySpki,
    publicKeySha256: trust.publicKeySha256,
    publicKey,
  });
}

function validateHostBootstrapCredential(bootstrap, label = "bootstrap") {
  let publicDer;
  try {
    publicDer = decodeBase64Url(
      bootstrap.hostCredentialPublicKeySpki,
      `${label}.hostCredentialPublicKeySpki`,
      4096,
    );
    const publicKey = createPublicKey({
      key: publicDer,
      type: "spki",
      format: "der",
    });
    if (publicKey.asymmetricKeyType !== "ed25519") {
      throw new TypeError("credential is not Ed25519");
    }
    if (bootstrap.hostCredentialPrivateKeyPkcs8 !== null) {
      const privateKey = createPrivateKey({
        key: decodeBase64Url(
          bootstrap.hostCredentialPrivateKeyPkcs8,
          `${label}.hostCredentialPrivateKeyPkcs8`,
          4096,
        ),
        type: "pkcs8",
        format: "der",
      });
      if (
        privateKey.asymmetricKeyType !== "ed25519" ||
        !createPublicKey(privateKey)
          .export({ type: "spki", format: "der" })
          .equals(publicDer)
      ) {
        throw new TypeError("private credential does not match public key");
      }
    }
  } catch (cause) {
    throw trustRejected(`${label} Ed25519 credential is invalid`, {
      causeCode: cause?.code || null,
    });
  }
  const digest = createHash("sha256").update(publicDer).digest("hex");
  if (bootstrap.hostPrincipalId !== `ed25519:${digest}`) {
    throw trustRejected(`${label} host principal is not key-bound`);
  }
}

function validateMemberPayload(member, label) {
  if (
    !hasExactKeys(member, MEMBER_FIELDS) ||
    !["active", "revoked"].includes(member.status) ||
    !Array.isArray(member.scopes) ||
    member.scopes.length === 0
  ) {
    throw trustRejected(`${label} is malformed`);
  }
  requiredString(member.principalId, `${label}.principalId`);
  canonicalInteger(member.membershipEpoch, `${label}.membershipEpoch`);
  if (
    !DIGEST_RE.test(String(member.credentialKeySha256)) ||
    !new Set([
      `ed25519:${member.credentialKeySha256}`,
      `relay-x25519:${member.credentialKeySha256}`,
    ]).has(member.principalId)
  ) {
    throw trustRejected(
      `${label} principal is not bound to its credential key`,
    );
  }
  const scopes = [...new Set(member.scopes.map(String))].sort();
  if (canonicalJson(scopes) !== canonicalJson(member.scopes)) {
    throw trustRejected(`${label}.scopes are not canonical`);
  }
}

function validateLeasePayload(lease, statementKind, generation, label) {
  if (
    !hasExactKeys(lease, LEASE_FIELDS) ||
    !["active", "acked", "consumed", "cancelled"].includes(lease.status)
  ) {
    throw trustRejected(`${label} is malformed`);
  }
  for (const field of [
    "leaseId",
    "sessionId",
    "principalId",
    "hostPrincipalId",
    "requestId",
    "fingerprint",
    "binding",
  ]) {
    requiredString(lease[field], `${label}.${field}`);
  }
  for (const field of [
    "sessionEpoch",
    "membershipEpoch",
    "createdGeneration",
  ]) {
    canonicalInteger(lease[field], `${label}.${field}`);
  }
  for (const field of [
    "ackedGeneration",
    "consumedGeneration",
    "terminalGeneration",
  ]) {
    if (lease[field] !== null) {
      canonicalInteger(lease[field], `${label}.${field}`);
    }
  }
  safeTimestamp(lease.createdAt, `${label}.createdAt`);
  safeTimestamp(lease.expiresAt, `${label}.expiresAt`);
  if (lease.expiresAt <= lease.createdAt) {
    throw trustRejected(`${label} has an empty validity window`);
  }
  if (
    lease.hostReceiptDigest !== null &&
    !DIGEST_RE.test(String(lease.hostReceiptDigest))
  ) {
    throw trustRejected(`${label}.hostReceiptDigest is invalid`);
  }
  if (lease.cancelReason !== null) {
    requiredString(lease.cancelReason, `${label}.cancelReason`);
  }
  const createdGeneration = BigInt(lease.createdGeneration);
  const ackedGeneration =
    lease.ackedGeneration === null ? null : BigInt(lease.ackedGeneration);
  const consumedGeneration =
    lease.consumedGeneration === null ? null : BigInt(lease.consumedGeneration);
  const terminalGeneration =
    lease.terminalGeneration === null ? null : BigInt(lease.terminalGeneration);
  const coherent = {
    active:
      ackedGeneration === null &&
      consumedGeneration === null &&
      terminalGeneration === null &&
      lease.hostReceiptDigest === null &&
      lease.cancelReason === null,
    acked:
      ackedGeneration !== null &&
      ackedGeneration > createdGeneration &&
      consumedGeneration === null &&
      terminalGeneration === null &&
      lease.hostReceiptDigest !== null &&
      lease.cancelReason === null,
    consumed:
      ackedGeneration !== null &&
      consumedGeneration !== null &&
      terminalGeneration === consumedGeneration &&
      ackedGeneration > createdGeneration &&
      consumedGeneration > ackedGeneration &&
      lease.hostReceiptDigest !== null &&
      lease.cancelReason === null,
    cancelled:
      consumedGeneration === null &&
      terminalGeneration !== null &&
      terminalGeneration > (ackedGeneration ?? createdGeneration) &&
      lease.cancelReason !== null &&
      ((ackedGeneration === null && lease.hostReceiptDigest === null) ||
        (ackedGeneration !== null &&
          ackedGeneration > createdGeneration &&
          lease.hostReceiptDigest !== null)),
  }[lease.status];
  if (!coherent) {
    throw trustRejected(`${label} has incoherent lease state fields`);
  }
  const expectedStatus = {
    "lease.created": "active",
    "lease.acked": "acked",
    "lease.consumed": "consumed",
    "lease.cancelled": "cancelled",
  }[statementKind];
  if (lease.status !== expectedStatus) {
    throw trustRejected(`${label}.status does not match ${statementKind}`);
  }
  const generationField = {
    "lease.created": "createdGeneration",
    "lease.acked": "ackedGeneration",
    "lease.consumed": "consumedGeneration",
    "lease.cancelled": "terminalGeneration",
  }[statementKind];
  if (lease[generationField] !== generation) {
    throw trustRejected(
      `${label}.${generationField} is not statement generation`,
    );
  }
}

function validateSnapshotPayload(snapshot, generation, label) {
  if (
    !hasExactKeys(snapshot, SNAPSHOT_FIELDS) ||
    !["active", "closed"].includes(snapshot.status) ||
    !Array.isArray(snapshot.members) ||
    !Array.isArray(snapshot.leases) ||
    snapshot.authorityGeneration !== generation
  ) {
    throw trustRejected(`${label} is malformed`);
  }
  requiredString(snapshot.sessionId, `${label}.sessionId`);
  requiredString(snapshot.agentSessionId, `${label}.agentSessionId`);
  requiredString(snapshot.hostPrincipalId, `${label}.hostPrincipalId`);
  canonicalInteger(snapshot.sessionEpoch, `${label}.sessionEpoch`);
  safeTimestamp(snapshot.createdAt, `${label}.createdAt`);
  safeTimestamp(snapshot.expiresAt, `${label}.expiresAt`);
  if (snapshot.expiresAt <= snapshot.createdAt) {
    throw trustRejected(`${label} has an empty validity window`);
  }
  const principals = new Set();
  let previousPrincipal = null;
  for (const [index, member] of snapshot.members.entries()) {
    validateMemberPayload(member, `${label}.members[${index}]`);
    if (principals.has(member.principalId)) {
      throw trustRejected(`${label} repeats a member principal`);
    }
    if (
      previousPrincipal !== null &&
      previousPrincipal.localeCompare(member.principalId) >= 0
    ) {
      throw trustRejected(`${label}.members are not canonically ordered`);
    }
    principals.add(member.principalId);
    previousPrincipal = member.principalId;
  }
  const leases = new Set();
  const requests = new Set();
  let previousLeaseId = null;
  for (const [index, lease] of snapshot.leases.entries()) {
    if (!hasExactKeys(lease, LEASE_FIELDS)) {
      throw trustRejected(`${label}.leases[${index}] is malformed`);
    }
    // Snapshot leases may be in any durable state. Validate by their state-
    // corresponding statement kind while retaining the snapshot generation.
    const kind = {
      active: "lease.created",
      acked: "lease.acked",
      consumed: "lease.consumed",
      cancelled: "lease.cancelled",
    }[lease.status];
    const stateGeneration = {
      active: lease.createdGeneration,
      acked: lease.ackedGeneration,
      consumed: lease.consumedGeneration,
      cancelled: lease.terminalGeneration,
    }[lease.status];
    validateLeasePayload(
      lease,
      kind,
      stateGeneration,
      `${label}.leases[${index}]`,
    );
    if (
      lease.sessionId !== snapshot.sessionId ||
      lease.hostPrincipalId !== snapshot.hostPrincipalId ||
      leases.has(lease.leaseId)
    ) {
      throw trustRejected(`${label} has a foreign or duplicate lease`);
    }
    if (requests.has(lease.requestId)) {
      throw trustRejected(`${label} repeats an approval request`);
    }
    if (
      previousLeaseId !== null &&
      previousLeaseId.localeCompare(lease.leaseId) >= 0
    ) {
      throw trustRejected(`${label}.leases are not canonically ordered`);
    }
    leases.add(lease.leaseId);
    requests.add(lease.requestId);
    previousLeaseId = lease.leaseId;
    const principal = snapshot.members.find(
      (member) => member.principalId === lease.principalId,
    );
    if (
      !principal ||
      BigInt(principal.membershipEpoch) < BigInt(lease.membershipEpoch) ||
      BigInt(lease.sessionEpoch) > BigInt(snapshot.sessionEpoch) ||
      lease.expiresAt > snapshot.expiresAt
    ) {
      throw trustRejected(`${label} has a lease outside its membership tuple`);
    }
    const snapshotGeneration = BigInt(generation);
    for (const leaseGeneration of [
      lease.createdGeneration,
      lease.ackedGeneration,
      lease.consumedGeneration,
      lease.terminalGeneration,
    ]) {
      if (
        leaseGeneration !== null &&
        BigInt(leaseGeneration) > snapshotGeneration
      ) {
        throw trustRejected(`${label} has a lease generation from the future`);
      }
    }
  }
  const host = snapshot.members.find(
    (member) => member.principalId === snapshot.hostPrincipalId,
  );
  if (!host || host.status !== "active") {
    throw trustRejected(`${label} omits the active host principal`);
  }
}

function validateStatement(statement, trust) {
  if (
    !statement ||
    typeof statement !== "object" ||
    Array.isArray(statement) ||
    !hasExactKeys(statement, STATEMENT_FIELDS) ||
    statement.schema !== REMOTE_MEMBERSHIP_STATEMENT_SCHEMA ||
    statement.authorityVersion !== REMOTE_MEMBERSHIP_COORDINATOR_VERSION ||
    statement.algorithm !== "ed25519" ||
    statement.coordinatorId !== trust.coordinatorId ||
    statement.keyId !== trust.keyId ||
    !POSITIVE_RE.test(String(statement.generation)) ||
    !VALID_STATEMENT_KINDS.has(statement.kind) ||
    !statement.payload ||
    typeof statement.payload !== "object" ||
    Array.isArray(statement.payload) ||
    typeof statement.signature !== "string"
  ) {
    throw trustRejected("signed statement is malformed");
  }
  safeTimestamp(statement.issuedAtMs, "statement.issuedAtMs");
  const { signature, ...core } = statement;
  let signatureBytes;
  try {
    signatureBytes = decodeBase64Url(signature, "statement.signature", 256);
  } catch {
    throw trustRejected("statement signature encoding is invalid");
  }
  if (
    signatureBytes.length !== 64 ||
    !verify(
      null,
      Buffer.from(canonicalJson(core), "utf8"),
      trust.publicKey,
      signatureBytes,
    )
  ) {
    throw trustRejected("statement signature is invalid");
  }
  if (statement.kind === "session.snapshot") {
    validateSnapshotPayload(statement.payload, statement.generation, "payload");
  } else {
    validateLeasePayload(
      statement.payload,
      statement.kind,
      statement.generation,
      "payload",
    );
  }
  return Object.freeze({
    statement: structuredClone(statement),
    generation: BigInt(statement.generation),
    digest: statementDigest(statement),
  });
}

function validateBootstrapStatement(bootstrap, statement, trust, label) {
  const validated = validateStatement(statement, trust);
  const payload = validated.statement.payload;
  const host =
    validated.statement.kind === "session.snapshot" &&
    Array.isArray(payload.members)
      ? payload.members.find(
          (member) => member.principalId === bootstrap.hostPrincipalId,
        )
      : null;
  const publicDigest = createHash("sha256")
    .update(
      decodeBase64Url(
        bootstrap.hostCredentialPublicKeySpki,
        `${label}.hostCredentialPublicKeySpki`,
        4096,
      ),
    )
    .digest("hex");
  if (
    validated.statement.kind !== "session.snapshot" ||
    payload.sessionId !== bootstrap.sessionId ||
    payload.agentSessionId !== bootstrap.agentSessionId ||
    payload.hostPrincipalId !== bootstrap.hostPrincipalId ||
    !host ||
    host.status !== "active" ||
    host.credentialKeySha256 !== publicDigest
  ) {
    throw trustRejected(`${label} is not authorized by its signed bootstrap`);
  }
  return validated;
}

function cloneLease(lease) {
  return lease ? { ...lease } : null;
}

function replayHostStore(store, { missing = false } = {}) {
  if (missing && Object.keys(store).length === 0) {
    return {
      revision: 0n,
      headHash: null,
      trust: null,
      lastAuthorityGeneration: 0n,
      lastStatementIssuedAtMs: 0,
      bootstrap: null,
      records: [],
      statementDigests: new Set(),
      statementReceipts: new Map(),
      leases: new Map(),
      leaseCreatedReceipts: new Map(),
      sessionSnapshot: null,
      lastRecordedAtMs: 0,
    };
  }
  if (
    !hasExactKeys(store, [
      "headHash",
      "lastAuthorityGeneration",
      "lastStatementIssuedAtMs",
      "records",
      "revision",
      "version",
    ]) ||
    store.version !== STORE_VERSION ||
    !Array.isArray(store.records) ||
    !NON_NEGATIVE_RE.test(String(store.revision)) ||
    !NON_NEGATIVE_RE.test(String(store.lastAuthorityGeneration)) ||
    !Number.isSafeInteger(store.lastStatementIssuedAtMs) ||
    store.lastStatementIssuedAtMs < 0 ||
    (store.headHash !== null && !DIGEST_RE.test(String(store.headHash)))
  ) {
    throw new TypeError("Remote membership host store identity is invalid");
  }

  let trust = null;
  let bootstrap = null;
  let revision = 0n;
  let headHash = null;
  let lastAuthorityGeneration = 0n;
  let lastStatementIssuedAtMs = 0;
  let sessionSnapshot = null;
  let lastRecordedAtMs = 0;
  const statementDigests = new Set();
  const statementReceipts = new Map();
  const leases = new Map();
  const leaseCreatedReceipts = new Map();

  for (const [index, record] of store.records.entries()) {
    const label = `records[${index}]`;
    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      record.schema !== RECORD_SCHEMA ||
      !hasExactKeys(record, RECORD_FIELDS[record.type] || []) ||
      !POSITIVE_RE.test(String(record.revision)) ||
      !DIGEST_RE.test(String(record.recordHash))
    ) {
      throw new TypeError(`${label} is invalid`);
    }
    const currentRevision = BigInt(record.revision);
    if (
      currentRevision !== revision + 1n ||
      record.previousRecordHash !== headHash ||
      recordHash(record) !== record.recordHash
    ) {
      throw new TypeError(`${label} breaks the receipt chain`);
    }
    safeTimestamp(record.recordedAtMs, `${label}.recordedAtMs`);
    if (record.recordedAtMs < lastRecordedAtMs) {
      throw new TypeError(`${label}.recordedAtMs moves host time backward`);
    }

    if (record.type === "trust.pinned") {
      const normalized = validateTrustDescriptor(record.trust);
      if (trust && trust.publicKeySha256 !== normalized.publicKeySha256) {
        throw new TypeError(`${label} rotates a pinned coordinator key`);
      }
      trust = normalized;
    } else if (record.type === "session.bootstrap") {
      if (!trust) throw new TypeError(`${label} precedes coordinator trust`);
      const candidate = record.bootstrap;
      if (
        !candidate ||
        !hasExactKeys(candidate, BOOTSTRAP_FIELDS) ||
        candidate.coordinatorId !== trust.coordinatorId ||
        typeof candidate.sessionId !== "string" ||
        typeof candidate.agentSessionId !== "string" ||
        typeof candidate.hostPrincipalId !== "string" ||
        typeof candidate.hostCredentialPublicKeySpki !== "string" ||
        (candidate.hostCredentialPrivateKeyPkcs8 !== null &&
          typeof candidate.hostCredentialPrivateKeyPkcs8 !== "string")
      ) {
        throw new TypeError(`${label} has an invalid bootstrap`);
      }
      validateHostBootstrapCredential(candidate, `${label}.bootstrap`);
      validateBootstrapStatement(
        candidate,
        record.statement,
        trust,
        `${label}.statement`,
      );
      if (bootstrap && canonicalJson(bootstrap) !== canonicalJson(candidate)) {
        throw new TypeError(`${label} changes an existing session bootstrap`);
      }
      bootstrap = { ...candidate };
    } else if (record.type === "statement.adopted") {
      if (!trust) throw new TypeError(`${label} precedes coordinator trust`);
      if (!bootstrap) {
        throw new TypeError(`${label} precedes the host session bootstrap`);
      }
      const validated = validateStatement(record.statement, trust);
      if (
        validated.digest !== record.statementDigest ||
        validated.generation < lastAuthorityGeneration
      ) {
        throw new TypeError(`${label} is stale or has the wrong digest`);
      }
      if (validated.statement.issuedAtMs < lastStatementIssuedAtMs) {
        throw new TypeError(`${label} moves signed authority time backward`);
      }
      if (statementDigests.has(validated.digest)) {
        throw new TypeError(`${label} repeats a signed statement`);
      }
      statementDigests.add(validated.digest);
      statementReceipts.set(validated.digest, {
        receiptRevision: record.revision,
        receiptHash: record.recordHash,
      });
      lastAuthorityGeneration = validated.generation;
      lastStatementIssuedAtMs = validated.statement.issuedAtMs;
      const payload = validated.statement.payload;
      if (bootstrap) {
        if (
          payload.sessionId !== bootstrap.sessionId ||
          (validated.statement.kind === "session.snapshot" &&
            (payload.agentSessionId !== bootstrap.agentSessionId ||
              payload.hostPrincipalId !== bootstrap.hostPrincipalId)) ||
          (validated.statement.kind !== "session.snapshot" &&
            payload.hostPrincipalId !== bootstrap.hostPrincipalId)
        ) {
          throw new TypeError(`${label} is not bound to the host bootstrap`);
        }
      }
      if (validated.statement.kind === "session.snapshot") {
        if (!Array.isArray(payload.members) || !Array.isArray(payload.leases)) {
          throw new TypeError(`${label} has an invalid session snapshot`);
        }
        if (sessionSnapshot) {
          if (
            payload.sessionId !== sessionSnapshot.sessionId ||
            payload.agentSessionId !== sessionSnapshot.agentSessionId ||
            payload.hostPrincipalId !== sessionSnapshot.hostPrincipalId ||
            payload.createdAt !== sessionSnapshot.createdAt ||
            payload.expiresAt !== sessionSnapshot.expiresAt ||
            BigInt(payload.sessionEpoch) < BigInt(sessionSnapshot.sessionEpoch)
          ) {
            throw new TypeError(`${label} rolls back the session identity`);
          }
          const currentMembers = new Map(
            payload.members.map((member) => [member.principalId, member]),
          );
          const previousPrincipals = new Set(
            sessionSnapshot.members.map((member) => member.principalId),
          );
          for (const previous of sessionSnapshot.members) {
            const current = currentMembers.get(previous.principalId);
            if (
              !current ||
              BigInt(current.membershipEpoch) < BigInt(previous.membershipEpoch)
            ) {
              throw new TypeError(`${label} rolls back a principal epoch`);
            }
            const priorEpoch = BigInt(previous.membershipEpoch);
            const nextEpoch = BigInt(current.membershipEpoch);
            if (
              nextEpoch > priorEpoch + 1n ||
              current.credentialKeySha256 !== previous.credentialKeySha256 ||
              (nextEpoch === priorEpoch &&
                canonicalJson(current) !== canonicalJson(previous)) ||
              (nextEpoch === priorEpoch + 1n &&
                current.status === previous.status)
            ) {
              throw new TypeError(`${label} forks or skips a principal epoch`);
            }
          }
          for (const current of payload.members) {
            if (
              !previousPrincipals.has(current.principalId) &&
              current.membershipEpoch !== "1"
            ) {
              throw new TypeError(
                `${label} introduces a future principal epoch`,
              );
            }
          }
          const priorSessionEpoch = BigInt(sessionSnapshot.sessionEpoch);
          const nextSessionEpoch = BigInt(payload.sessionEpoch);
          if (
            nextSessionEpoch > priorSessionEpoch + 1n ||
            (nextSessionEpoch === priorSessionEpoch &&
              payload.status !== sessionSnapshot.status) ||
            (nextSessionEpoch === priorSessionEpoch + 1n &&
              (sessionSnapshot.status !== "active" ||
                payload.status !== "closed")) ||
            sessionSnapshot.status === "closed"
          ) {
            throw new TypeError(`${label} forks or reopens the session epoch`);
          }
          const currentLeases = new Map(
            payload.leases.map((lease) => [lease.leaseId, lease]),
          );
          for (const previous of sessionSnapshot.leases) {
            const current = currentLeases.get(previous.leaseId);
            if (!current) {
              throw new TypeError(`${label} omits a durable lease`);
            }
            for (const field of [
              "sessionId",
              "sessionEpoch",
              "principalId",
              "membershipEpoch",
              "hostPrincipalId",
              "requestId",
              "fingerprint",
              "binding",
              "createdGeneration",
              "createdAt",
              "expiresAt",
            ]) {
              if (current[field] !== previous[field]) {
                throw new TypeError(`${label} changes lease.${field}`);
              }
            }
            const rank = { active: 0, acked: 1, consumed: 2, cancelled: 2 };
            if (rank[current.status] < rank[previous.status]) {
              throw new TypeError(`${label} rolls back a lease state`);
            }
            if (
              rank[current.status] === rank[previous.status] &&
              current.status !== previous.status
            ) {
              throw new TypeError(`${label} forks a terminal lease state`);
            }
          }
        }
        sessionSnapshot = structuredClone(payload);
        leases.clear();
        for (const lease of payload.leases) {
          if (!lease || typeof lease.leaseId !== "string") {
            throw new TypeError(`${label} has an invalid snapshot lease`);
          }
          leases.set(lease.leaseId, { ...lease });
        }
      } else {
        if (!payload || typeof payload.leaseId !== "string") {
          throw new TypeError(`${label} has an invalid lease payload`);
        }
        const prior = leases.get(payload.leaseId) || null;
        if (validated.statement.kind === "lease.created") {
          if (prior) throw new TypeError(`${label} recreates a lease`);
          const principal = sessionSnapshot?.members.find(
            (member) => member.principalId === payload.principalId,
          );
          if (
            !sessionSnapshot ||
            sessionSnapshot.status !== "active" ||
            payload.sessionEpoch !== sessionSnapshot.sessionEpoch ||
            !principal ||
            principal.status !== "active" ||
            principal.membershipEpoch !== payload.membershipEpoch ||
            !principal.scopes.includes("approve") ||
            payload.expiresAt > sessionSnapshot.expiresAt
          ) {
            throw new TypeError(`${label} creates a lease outside membership`);
          }
          leaseCreatedReceipts.set(payload.leaseId, record.recordHash);
        } else if (!prior) {
          throw new TypeError(`${label} updates an unknown lease`);
        } else {
          const immutable = [
            "sessionId",
            "sessionEpoch",
            "principalId",
            "membershipEpoch",
            "hostPrincipalId",
            "requestId",
            "fingerprint",
            "binding",
            "createdGeneration",
            "createdAt",
            "expiresAt",
          ];
          for (const field of immutable) {
            if (prior[field] !== payload[field]) {
              throw new TypeError(`${label} changes lease.${field}`);
            }
          }
          if (
            validated.statement.kind === "lease.acked" &&
            (prior.status !== "active" ||
              payload.status !== "acked" ||
              payload.hostReceiptDigest !==
                leaseCreatedReceipts.get(payload.leaseId))
          ) {
            throw new TypeError(`${label} has an invalid ACK transition`);
          }
          if (
            validated.statement.kind === "lease.consumed" &&
            (prior.status !== "acked" || payload.status !== "consumed")
          ) {
            throw new TypeError(`${label} has an invalid consume transition`);
          }
          if (
            validated.statement.kind === "lease.cancelled" &&
            !["active", "acked"].includes(prior.status)
          ) {
            throw new TypeError(`${label} cancels a terminal lease`);
          }
        }
        leases.set(payload.leaseId, { ...payload });
      }
    } else {
      throw new TypeError(`${label}.type is unsupported`);
    }

    revision = currentRevision;
    headHash = record.recordHash;
    lastRecordedAtMs = record.recordedAtMs;
  }

  if (
    revision !== BigInt(store.revision) ||
    headHash !== store.headHash ||
    lastAuthorityGeneration !== BigInt(store.lastAuthorityGeneration) ||
    lastStatementIssuedAtMs !== store.lastStatementIssuedAtMs
  ) {
    throw new TypeError("Remote membership host store head is inconsistent");
  }
  return {
    revision,
    headHash,
    trust,
    lastAuthorityGeneration,
    lastStatementIssuedAtMs,
    bootstrap,
    records: [...store.records],
    statementDigests,
    statementReceipts,
    leases,
    leaseCreatedReceipts,
    sessionSnapshot,
    lastRecordedAtMs,
  };
}

export function getRemoteMembershipHostPaths(agentSessionId) {
  const id = requiredString(agentSessionId, "agentSessionId");
  const digest = sha256(Buffer.from(id, "utf8"));
  return Object.freeze({
    stateFile: path.join(
      getStatePath(),
      "remote-membership-host-v1",
      `${digest}.json`,
    ),
    witnessFile: path.join(
      getMachineSecurityAnchorDir(),
      "remote-membership-host-v1",
      `${digest}.witness.json`,
    ),
  });
}

export class DurableRemoteMembershipHostStore {
  constructor({
    agentSessionId,
    stateFile,
    witnessFile,
    authorityLockFile = null,
    expectedPublicKeySha256 = null,
    now = () => Date.now(),
    lockOptions,
    lock = withFileLock,
    faultHooks = null,
  } = {}) {
    const defaults = getRemoteMembershipHostPaths(agentSessionId);
    this.stateFile = path.resolve(stateFile || defaults.stateFile);
    this.witnessFile = path.resolve(witnessFile || defaults.witnessFile);
    this.authorityLockFile = path.resolve(
      authorityLockFile || `${this.stateFile}.authority`,
    );
    if (
      expectedPublicKeySha256 !== null &&
      !DIGEST_RE.test(String(expectedPublicKeySha256))
    ) {
      throw new TypeError("expectedPublicKeySha256 must be a SHA-256 digest");
    }
    this.expectedPublicKeySha256 = expectedPublicKeySha256;
    this._now = now;
    this._lockOptions = lockOptions;
    this._lock = lock;
    this._faultHooks = faultHooks || {};
    this._quarantined = false;
    fs.mkdirSync(path.dirname(this.authorityLockFile), {
      recursive: true,
      mode: 0o700,
    });
    this._observedRevision = 0n;
    this._observedAuthorityGeneration = 0n;
  }

  _withAuthorityLock(task) {
    if (this._quarantined) {
      throw hostError(
        REMOTE_MEMBERSHIP_HOST_UNAVAILABLE_CODE,
        "Remote membership host state is quarantined after an unknown commit; restart and reconcile before reuse",
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

  _observe(snapshot) {
    if (snapshot.revision < this._observedRevision) {
      throw rollback("live receipt revision moved backward", {
        observedRevision: String(snapshot.revision),
        currentRevision: String(this._observedRevision),
      });
    }
    if (snapshot.lastAuthorityGeneration < this._observedAuthorityGeneration) {
      throw rollback("live authority high-water moved backward", {
        observedGeneration: String(snapshot.lastAuthorityGeneration),
        currentGeneration: String(this._observedAuthorityGeneration),
      });
    }
    this._observedRevision = snapshot.revision;
    this._observedAuthorityGeneration = snapshot.lastAuthorityGeneration;
  }

  _validateWitness(witness) {
    if (
      !hasExactKeys(witness, [
        "headHash",
        "lastAuthorityGeneration",
        "pending",
        "revision",
        "version",
      ]) ||
      witness.version !== WITNESS_VERSION ||
      !NON_NEGATIVE_RE.test(String(witness.revision)) ||
      !NON_NEGATIVE_RE.test(String(witness.lastAuthorityGeneration)) ||
      (witness.headHash !== null && !DIGEST_RE.test(String(witness.headHash)))
    ) {
      throw new TypeError("Remote membership host witness is invalid");
    }
    if (witness.pending !== null) {
      if (
        !hasExactKeys(witness.pending, [
          "headHash",
          "lastAuthorityGeneration",
          "previousHeadHash",
          "previousLastAuthorityGeneration",
          "previousRevision",
          "revision",
        ]) ||
        !POSITIVE_RE.test(String(witness.pending.revision)) ||
        !NON_NEGATIVE_RE.test(
          String(witness.pending.lastAuthorityGeneration),
        ) ||
        !NON_NEGATIVE_RE.test(String(witness.pending.previousRevision)) ||
        !NON_NEGATIVE_RE.test(
          String(witness.pending.previousLastAuthorityGeneration),
        ) ||
        !DIGEST_RE.test(String(witness.pending.headHash)) ||
        (witness.pending.previousHeadHash !== null &&
          !DIGEST_RE.test(String(witness.pending.previousHeadHash))) ||
        BigInt(witness.pending.revision) !== BigInt(witness.revision) + 1n ||
        witness.pending.previousRevision !== witness.revision ||
        witness.pending.previousHeadHash !== witness.headHash ||
        witness.pending.previousLastAuthorityGeneration !==
          witness.lastAuthorityGeneration
      ) {
        throw new TypeError("Remote membership host pending commit is invalid");
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
        draft.revision = "0";
        draft.headHash = null;
        draft.lastAuthorityGeneration = "0";
        draft.pending = null;
      },
      { ...this._lockOptions, lock: this._lock },
    );
  }

  _reconcileWitness(snapshot) {
    try {
      let witness = readSecurityStore(this.witnessFile, WITNESS_LABEL);
      if (Object.keys(witness).length === 0) {
        if (
          snapshot.revision !== 0n ||
          snapshot.headHash !== null ||
          snapshot.lastAuthorityGeneration !== 0n
        ) {
          throw rollback("durable host state has no rollback witness", {
            observedRevision: String(snapshot.revision),
            filePath: this.stateFile,
            witnessFile: this.witnessFile,
          });
        }
        this._writeInitialWitness();
        witness = readSecurityStore(this.witnessFile, WITNESS_LABEL);
      }
      this._validateWitness(witness);
      const committedMatches =
        BigInt(witness.revision) === snapshot.revision &&
        witness.headHash === snapshot.headHash &&
        BigInt(witness.lastAuthorityGeneration) ===
          snapshot.lastAuthorityGeneration;
      const pendingMatches =
        witness.pending !== null &&
        BigInt(witness.pending.revision) === snapshot.revision &&
        witness.pending.headHash === snapshot.headHash &&
        BigInt(witness.pending.lastAuthorityGeneration) ===
          snapshot.lastAuthorityGeneration;
      if (!committedMatches && !pendingMatches) {
        throw rollback(
          "host state and witness do not describe one recoverable commit",
          {
            witnessedRevision: witness.revision,
            pendingRevision: witness.pending?.revision || null,
            observedRevision: String(snapshot.revision),
          },
        );
      }
      if (witness.pending !== null) {
        mutateSecurityStore(
          this.witnessFile,
          WITNESS_LABEL,
          (draft) => {
            this._validateWitness(draft);
            if (canonicalJson(draft) !== canonicalJson(witness)) {
              throw rollback("host witness changed during recovery");
            }
            if (pendingMatches) {
              draft.revision = witness.pending.revision;
              draft.headHash = witness.pending.headHash;
              draft.lastAuthorityGeneration =
                witness.pending.lastAuthorityGeneration;
            }
            draft.pending = null;
          },
          { ...this._lockOptions, lock: this._lock },
        );
      }
    } catch (cause) {
      throw unavailable(cause, this.witnessFile);
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
            BigInt(draft.revision) !== previous.revision ||
            draft.headHash !== previous.headHash ||
            BigInt(draft.lastAuthorityGeneration) !==
              previous.lastAuthorityGeneration ||
            next.revision !== previous.revision + 1n
          ) {
            throw rollback("host witness cannot prepare the next commit");
          }
          draft.pending = {
            revision: String(next.revision),
            headHash: next.headHash,
            lastAuthorityGeneration: String(next.lastAuthorityGeneration),
            previousRevision: String(previous.revision),
            previousHeadHash: previous.headHash,
            previousLastAuthorityGeneration: String(
              previous.lastAuthorityGeneration,
            ),
          };
        },
        { ...this._lockOptions, lock: this._lock },
      );
    } catch (cause) {
      if (cause?.code === REMOTE_MEMBERSHIP_HOST_ROLLBACK_CODE) throw cause;
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
            BigInt(draft.pending.revision) !== snapshot.revision ||
            draft.pending.headHash !== snapshot.headHash ||
            BigInt(draft.pending.lastAuthorityGeneration) !==
              snapshot.lastAuthorityGeneration
          ) {
            throw rollback("host witness lost its prepared commit");
          }
          draft.revision = draft.pending.revision;
          draft.headHash = draft.pending.headHash;
          draft.lastAuthorityGeneration = draft.pending.lastAuthorityGeneration;
          draft.pending = null;
        },
        { ...this._lockOptions, lock: this._lock },
      );
    } catch (cause) {
      if (cause?.code === REMOTE_MEMBERSHIP_HOST_ROLLBACK_CODE) throw cause;
      throw unavailable(cause, this.witnessFile);
    }
  }

  _readLocked() {
    try {
      const existed = fs.existsSync(this.stateFile);
      const snapshot = replayHostStore(
        readSecurityStore(this.stateFile, STORE_LABEL),
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

  _appendLocked(buildRecord) {
    let prepared = false;
    try {
      const previous = this._readLocked();
      const recordedAtMs = safeTimestamp(this._now(), "host receipt clock");
      if (recordedAtMs < previous.lastRecordedAtMs) {
        throw rollback("host receipt clock moved backward", {
          observedAtMs: recordedAtMs,
          durableAtMs: previous.lastRecordedAtMs,
        });
      }
      const revision = previous.revision + 1n;
      const record = {
        schema: RECORD_SCHEMA,
        revision: String(revision),
        previousRecordHash: previous.headHash,
        recordedAtMs,
        ...buildRecord(previous),
      };
      record.recordHash = recordHash(record);
      const nextStore = {
        version: STORE_VERSION,
        revision: String(revision),
        headHash: record.recordHash,
        lastAuthorityGeneration: String(
          record.type === "statement.adopted"
            ? BigInt(record.statement.generation)
            : previous.lastAuthorityGeneration,
        ),
        lastStatementIssuedAtMs:
          record.type === "statement.adopted"
            ? record.statement.issuedAtMs
            : previous.lastStatementIssuedAtMs,
        records: [...previous.records, record],
      };
      const verified = replayHostStore(nextStore);
      this._prepareWitness(previous, verified);
      prepared = true;
      const result = mutateSecurityStore(
        this.stateFile,
        STORE_LABEL,
        (draft) => {
          const current = replayHostStore(draft, {
            missing: !fs.existsSync(this.stateFile),
          });
          if (
            current.revision !== previous.revision ||
            current.headHash !== previous.headHash
          ) {
            throw rollback("host state changed outside its authority lock");
          }
          for (const key of Object.keys(draft)) delete draft[key];
          Object.assign(draft, structuredClone(nextStore));
          return { snapshot: verified, record };
        },
        { ...this._lockOptions, lock: this._lock },
      );
      this._faultHooks.afterStateCommit?.({
        record: structuredClone(result.record),
        stateFile: this.stateFile,
        witnessFile: this.witnessFile,
      });
      this._observe(result.snapshot);
      this._commitWitness(result.snapshot);
      prepared = false;
      return result;
    } catch (cause) {
      if (prepared) {
        this._quarantined = true;
        cause.commitState = "unknown";
      }
      throw unavailable(cause, this.stateFile);
    }
  }

  _append(buildRecord) {
    try {
      return this._withAuthorityLock(() => this._appendLocked(buildRecord));
    } catch (cause) {
      throw unavailable(cause, this.stateFile);
    }
  }

  pinTrust(trustDescriptor) {
    const trust = validateTrustDescriptor(trustDescriptor);
    if (
      this.expectedPublicKeySha256 &&
      trust.publicKeySha256 !== this.expectedPublicKeySha256
    ) {
      throw trustRejected("key does not match the configured pin", {
        expectedPublicKeySha256: this.expectedPublicKeySha256,
        observedPublicKeySha256: trust.publicKeySha256,
      });
    }
    const serializable = {
      authorityVersion: trust.authorityVersion,
      algorithm: trust.algorithm,
      coordinatorId: trust.coordinatorId,
      keyId: trust.keyId,
      publicKeySpki: trust.publicKeySpki,
      publicKeySha256: trust.publicKeySha256,
    };
    return this._withAuthorityLock(() => {
      const current = this._readLocked();
      if (current.trust) {
        if (current.trust.publicKeySha256 !== trust.publicKeySha256) {
          throw trustRejected("a different coordinator key is already pinned");
        }
        return Object.freeze({
          coordinatorId: current.trust.coordinatorId,
          publicKeySha256: current.trust.publicKeySha256,
          alreadyPinned: true,
        });
      }
      this._appendLocked(() => ({
        type: "trust.pinned",
        trust: serializable,
      }));
      return Object.freeze({
        coordinatorId: trust.coordinatorId,
        publicKeySha256: trust.publicKeySha256,
        alreadyPinned: false,
      });
    });
  }

  recordBootstrap({
    coordinatorId,
    sessionId,
    agentSessionId,
    hostPrincipalId,
    hostCredentialPublicKeySpki,
    hostCredentialPrivateKeyPkcs8 = null,
    statement,
  } = {}) {
    const bootstrap = {
      coordinatorId: requiredString(coordinatorId, "coordinatorId"),
      sessionId: requiredString(sessionId, "sessionId"),
      agentSessionId: requiredString(agentSessionId, "agentSessionId"),
      hostPrincipalId: requiredString(hostPrincipalId, "hostPrincipalId"),
      hostCredentialPublicKeySpki: requiredString(
        hostCredentialPublicKeySpki,
        "hostCredentialPublicKeySpki",
      ),
      hostCredentialPrivateKeyPkcs8:
        hostCredentialPrivateKeyPkcs8 === null
          ? null
          : requiredString(
              hostCredentialPrivateKeyPkcs8,
              "hostCredentialPrivateKeyPkcs8",
            ),
    };
    validateHostBootstrapCredential(bootstrap);
    return this._withAuthorityLock(() => {
      const current = this._readLocked();
      if (!current.trust || current.trust.coordinatorId !== coordinatorId) {
        throw trustRejected("session bootstrap does not match pinned trust");
      }
      const validatedBootstrap = validateBootstrapStatement(
        bootstrap,
        statement,
        current.trust,
        "bootstrapStatement",
      );
      if (current.bootstrap) {
        if (canonicalJson(current.bootstrap) !== canonicalJson(bootstrap)) {
          throw new Error("Remote membership session bootstrap already exists");
        }
        return Object.freeze({ ...current.bootstrap });
      }
      this._appendLocked(() => ({
        type: "session.bootstrap",
        bootstrap: { ...bootstrap },
        statement: validatedBootstrap.statement,
      }));
      return Object.freeze({ ...bootstrap });
    });
  }

  getBootstrap() {
    const bootstrap = this._read().bootstrap;
    return bootstrap ? Object.freeze({ ...bootstrap }) : null;
  }

  signAuthenticationChallenge(challenge) {
    return this._withAuthorityLock(() => {
      const snapshot = this._readLocked();
      const bootstrap = snapshot.bootstrap;
      if (
        !bootstrap ||
        bootstrap.hostCredentialPrivateKeyPkcs8 === null ||
        !hasExactKeys(challenge, AUTHENTICATION_CHALLENGE_FIELDS) ||
        challenge.schema !==
          "chainlesschain.remote-membership-authentication-challenge/v1" ||
        challenge.authorityVersion !== REMOTE_MEMBERSHIP_COORDINATOR_VERSION ||
        challenge.coordinatorId !== bootstrap.coordinatorId ||
        challenge.sessionId !== bootstrap.sessionId ||
        challenge.principalId !== bootstrap.hostPrincipalId ||
        challenge.credentialType !== "ed25519" ||
        challenge.credentialPublicKey !==
          bootstrap.hostCredentialPublicKeySpki ||
        challenge.purpose !== "session.resume" ||
        challenge.scopes !== null
      ) {
        throw trustRejected("authentication challenge is not host-bound");
      }
      requiredString(challenge.serverInstanceId, "challenge.serverInstanceId");
      requiredString(challenge.challengeId, "challenge.challengeId");
      requiredString(challenge.connectionNonce, "challenge.connectionNonce");
      requiredString(challenge.serverNonce, "challenge.serverNonce");
      canonicalInteger(challenge.sessionEpoch, "challenge.sessionEpoch");
      canonicalInteger(challenge.membershipEpoch, "challenge.membershipEpoch");
      safeTimestamp(challenge.issuedAtMs, "challenge.issuedAtMs");
      safeTimestamp(challenge.expiresAtMs, "challenge.expiresAtMs");
      if (
        challenge.expiresAtMs <= challenge.issuedAtMs ||
        challenge.expiresAtMs <= safeTimestamp(this._now(), "host clock") ||
        challenge.credentialKeySha256 !==
          bootstrap.hostPrincipalId.slice("ed25519:".length) ||
        (snapshot.sessionSnapshot &&
          (challenge.sessionEpoch !== snapshot.sessionSnapshot.sessionEpoch ||
            challenge.membershipEpoch !==
              snapshot.sessionSnapshot.members.find(
                (member) => member.principalId === bootstrap.hostPrincipalId,
              )?.membershipEpoch))
      ) {
        throw trustRejected("authentication challenge is stale or malformed");
      }
      return signRemoteMembershipAuthenticationChallenge(
        challenge,
        bootstrap.hostCredentialPrivateKeyPkcs8,
      );
    });
  }

  adopt(statement, { expectedKind = null, expectedSessionId = null } = {}) {
    return this._withAuthorityLock(() => {
      const current = this._readLocked();
      if (!current.trust) {
        throw trustRejected("no coordinator key is pinned");
      }
      if (!current.bootstrap) {
        throw trustRejected("no host session bootstrap is recorded");
      }
      const validated = validateStatement(statement, current.trust);
      if (expectedKind && validated.statement.kind !== expectedKind) {
        throw trustRejected("statement kind does not match the protocol step", {
          expectedKind,
          observedKind: validated.statement.kind,
        });
      }
      const payloadSessionId = validated.statement.payload.sessionId;
      if (expectedSessionId && payloadSessionId !== expectedSessionId) {
        throw trustRejected("statement session does not match", {
          expectedSessionId,
          observedSessionId: payloadSessionId || null,
        });
      }
      if (validated.generation < current.lastAuthorityGeneration) {
        throw rollback(
          "signed statement is older than the durable high-water",
          {
            statementGeneration: String(validated.generation),
            currentGeneration: String(current.lastAuthorityGeneration),
          },
        );
      }
      if (current.statementDigests.has(validated.digest)) {
        const receipt = current.statementReceipts.get(validated.digest);
        return Object.freeze({
          adopted: false,
          replayed: true,
          statementDigest: validated.digest,
          authorityGeneration: String(validated.generation),
          receiptRevision: receipt.receiptRevision,
          receiptHash: receipt.receiptHash,
          payload: structuredClone(validated.statement.payload),
        });
      }
      const result = this._appendLocked((snapshot) => {
        if (validated.generation < snapshot.lastAuthorityGeneration) {
          throw rollback("statement became stale before durable adoption");
        }
        if (snapshot.statementDigests.has(validated.digest)) {
          throw new Error("statement was adopted concurrently");
        }
        return {
          type: "statement.adopted",
          statementDigest: validated.digest,
          statement: validated.statement,
        };
      });
      return Object.freeze({
        adopted: true,
        replayed: false,
        statementDigest: validated.digest,
        authorityGeneration: String(validated.generation),
        receiptRevision: String(result.snapshot.revision),
        receiptHash: result.snapshot.headHash,
        payload: structuredClone(validated.statement.payload),
      });
    });
  }

  getLease(leaseId) {
    const lease = this._read().leases.get(String(leaseId));
    return lease ? Object.freeze(cloneLease(lease)) : null;
  }

  requireConsumableLease(leaseId) {
    return this._withAuthorityLock(() => {
      const snapshot = this._readLocked();
      const now = safeTimestamp(this._now(), "host execution clock");
      if (now < snapshot.lastRecordedAtMs) {
        throw rollback("host execution clock moved backward", {
          observedAtMs: now,
          durableAtMs: snapshot.lastRecordedAtMs,
        });
      }
      const lease = snapshot.leases.get(String(leaseId));
      if (!lease) throw new Error("Remote execution lease is unknown");
      if (lease.status !== "acked") {
        throw new Error("Remote execution lease is not ACKed or is terminal");
      }
      if (lease.expiresAt <= now) {
        throw new Error("Remote execution lease expired");
      }
      return Object.freeze(cloneLease(lease));
    });
  }

  inspect() {
    const snapshot = this._read();
    return Object.freeze({
      version: REMOTE_MEMBERSHIP_HOST_STORE_VERSION,
      revision: String(snapshot.revision),
      receiptHead: snapshot.headHash,
      lastAuthorityGeneration: String(snapshot.lastAuthorityGeneration),
      coordinatorId: snapshot.trust?.coordinatorId || null,
      publicKeySha256: snapshot.trust?.publicKeySha256 || null,
      bootstrap: snapshot.bootstrap
        ? Object.freeze({ ...snapshot.bootstrap })
        : null,
      leases: Object.freeze(
        [...snapshot.leases.values()].map((lease) =>
          Object.freeze(cloneLease(lease)),
        ),
      ),
    });
  }
}

export const _remoteMembershipHostStoreInternals = Object.freeze({
  replayHostStore,
  statementDigest,
  validateStatement,
  validateTrustDescriptor,
});
