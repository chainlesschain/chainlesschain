"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { types } = require("node:util");

const {
  signPayloadWithIdentity,
  verifyPayloadAgainstDid,
} = require("../did/did-signer");

const CHANNEL = "browser:operator:maintain-quarantine-lock";
const REQUEST_SCHEMA =
  "chainlesschain.browser-quarantine-lock-maintenance-request/v1";
const RESULT_SCHEMA =
  "chainlesschain.browser-quarantine-lock-maintenance-result/v1";
const AUTHORIZATION_SCHEMA =
  "chainlesschain.desktop-browser-quarantine-lock-maintenance-authorization/v1";
const SIGNED_PAYLOAD_SCHEMA =
  "chainlesschain.desktop-browser-quarantine-lock-maintenance-signature/v1";
const PERMISSION = "browser.quarantine.lock.maintain";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ARTIFACT_REF = /^quarantine:[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const ALLOWED_ROLES = new Set(["owner", "admin"]);
const LOCK_STATUSES = new Set([
  "absent",
  "owned-live",
  "owned-dead",
  "owned-invalid",
  "owner-initializing",
  "owner-orphaned",
]);
const LOCK_OPERATIONS = new Set([
  "write",
  "scan",
  "complete",
  "dispose",
  "recover",
]);
const hosts = new WeakMap();

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0`)
    .update(canonical(value))
    .digest("hex")}`;
}

function ownData(owner, name, label) {
  if (!owner || typeof owner !== "object" || types.isProxy(owner))
    throw new TypeError(`${label} owner is invalid`);
  const descriptor = Object.getOwnPropertyDescriptor(owner, name);
  if (!descriptor?.enumerable || !("value" in descriptor))
    throw new TypeError(`${label} must be plain enumerable data`);
  return descriptor.value;
}

function ownFunction(owner, name, label) {
  const value = ownData(owner, name, label);
  if (typeof value !== "function" || types.isProxy(value))
    throw new TypeError(`${label} must be a direct function`);
  return value;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor?.enumerable || !("value" in descriptor);
    })
  )
    throw new TypeError(`${label} has unexpected or accessor fields`);
}

function codedError(code, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = code;
  return error;
}

function normalizeInput(value) {
  exact(
    value,
    [
      "operation",
      "artifactRef",
      "expectedLockStateDigest",
      "caseId",
      "justification",
    ],
    "Desktop quarantine lock maintenance input",
  );
  if (
    !["inspect", "release"].includes(value.operation) ||
    !ARTIFACT_REF.test(value.artifactRef) ||
    (value.operation === "inspect"
      ? value.expectedLockStateDigest !== null
      : !DIGEST.test(value.expectedLockStateDigest)) ||
    !CASE_ID.test(value.caseId) ||
    typeof value.justification !== "string" ||
    value.justification.trim().length < 8 ||
    Buffer.byteLength(value.justification, "utf8") > 2048
  )
    throw new TypeError("Desktop quarantine lock maintenance input is invalid");
  return Object.freeze({
    operation: value.operation,
    artifactRef: value.artifactRef,
    expectedLockStateDigest: value.expectedLockStateDigest,
    caseId: value.caseId,
    justificationDigest: digest(
      "chainlesschain.desktop-browser-quarantine-lock-maintenance-justification/v1",
      value.justification.trim(),
    ),
  });
}

function resolveDatabaseHandle(database) {
  const db =
    database && typeof database.getDatabase === "function"
      ? database.getDatabase()
      : database;
  if (!db || typeof db.prepare !== "function" || types.isProxy(db))
    throw codedError(
      "CC_BROWSER_LOCK_MAINTENANCE_RBAC_UNAVAILABLE",
      "Browser quarantine lock maintenance RBAC database is unavailable",
    );
  return db;
}

function resolveOperatorRole(database, tenantId, operatorDid) {
  let db;
  try {
    db = resolveDatabaseHandle(database);
    const owner = db
      .prepare(
        "SELECT 1 AS ok FROM organizations WHERE org_id = ? AND owner_did = ?",
      )
      .get(tenantId, operatorDid);
    if (owner) return "owner";
    const member = db
      .prepare(
        "SELECT role FROM organization_members WHERE org_id = ? AND member_did = ? AND status = 'active'",
      )
      .get(tenantId, operatorDid);
    if (member && ALLOWED_ROLES.has(member.role)) return member.role;
  } catch (cause) {
    if (cause?.code === "CC_BROWSER_LOCK_MAINTENANCE_RBAC_UNAVAILABLE")
      throw cause;
    throw codedError(
      "CC_BROWSER_LOCK_MAINTENANCE_RBAC_UNAVAILABLE",
      "Browser quarantine lock maintenance RBAC check failed closed",
      cause,
    );
  }
  throw codedError(
    "CC_BROWSER_LOCK_MAINTENANCE_RBAC_DENIED",
    "Current DID is not authorized to maintain browser quarantine locks",
  );
}

function createDesktopBrowserQuarantineLockMaintenanceHost(
  authority,
  captureAuthority,
) {
  if (typeof captureAuthority !== "function" || types.isProxy(captureAuthority))
    throw new TypeError(
      "Browser quarantine lock maintenance authority capture is invalid",
    );
  const captured = Reflect.apply(captureAuthority, undefined, [authority]);
  if (!captured || typeof captured !== "object" || types.isProxy(captured))
    throw new TypeError(
      "Browser quarantine lock maintenance authority port is invalid",
    );
  const descriptor = ownData(
    captured,
    "descriptor",
    "browser quarantine lock maintenance descriptor",
  );
  if (
    !descriptor ||
    typeof descriptor !== "object" ||
    types.isProxy(descriptor) ||
    ownData(descriptor, "approvalMode", "lock maintenance approval mode") !==
      "operator-signed" ||
    ownData(descriptor, "auditMode", "lock maintenance audit mode") !==
      "authenticated-durable-readback" ||
    ownData(descriptor, "effectMode", "lock maintenance effect mode") !==
      "orphan-lock-release"
  )
    throw new TypeError(
      "Browser quarantine lock maintenance descriptor is invalid",
    );
  const tenantId = ownData(descriptor, "tenantId", "lock maintenance tenant");
  if (
    typeof tenantId !== "string" ||
    tenantId.length < 1 ||
    tenantId.length > 128
  )
    throw new TypeError(
      "Browser quarantine lock maintenance tenant is invalid",
    );
  const host = Object.freeze({});
  hosts.set(host, {
    descriptor,
    maintainLock: ownFunction(
      captured,
      "maintainLock",
      "browser quarantine lock maintenance port",
    ),
  });
  return host;
}

function normalizeExecutionContext(value) {
  const {
    didManager,
    database,
    senderId,
    frameUrl,
    now = Date.now,
  } = value ?? {};
  if (
    !didManager ||
    typeof didManager.getCurrentIdentity !== "function" ||
    types.isProxy(didManager) ||
    !Number.isSafeInteger(senderId) ||
    senderId < 1 ||
    typeof frameUrl !== "string" ||
    frameUrl.length < 1 ||
    Buffer.byteLength(frameUrl, "utf8") > 16 * 1024 ||
    typeof now !== "function" ||
    types.isProxy(now)
  )
    throw new TypeError(
      "Desktop quarantine lock maintenance context is invalid",
    );
  return { didManager, database, senderId, frameUrl, now };
}

function validateResult(result, request) {
  exact(
    result,
    [
      "schema",
      "status",
      "operation",
      "artifactRefDigest",
      "lockStatus",
      "ownerOperation",
      "ownerProcessDigest",
      "ownerAcquiredAt",
      "lockStateDigest",
      "releaseReceiptDigest",
      "operatorIdDigest",
      "outcomeRequestDigest",
      "auditEventDigest",
      "durabilityReceiptDigest",
      "resultDigest",
    ],
    "Desktop quarantine lock maintenance result",
  );
  const core = Object.freeze({
    schema: result.schema,
    status: result.status,
    operation: result.operation,
    artifactRefDigest: result.artifactRefDigest,
    lockStatus: result.lockStatus,
    ownerOperation: result.ownerOperation,
    ownerProcessDigest: result.ownerProcessDigest,
    ownerAcquiredAt: result.ownerAcquiredAt,
    lockStateDigest: result.lockStateDigest,
    releaseReceiptDigest: result.releaseReceiptDigest,
    operatorIdDigest: result.operatorIdDigest,
    outcomeRequestDigest: result.outcomeRequestDigest,
    auditEventDigest: result.auditEventDigest,
    durabilityReceiptDigest: result.durabilityReceiptDigest,
  });
  const hasOwner = ["owned-live", "owned-dead"].includes(result.lockStatus);
  if (
    result.schema !== RESULT_SCHEMA ||
    result.operation !== request.operation ||
    result.status !==
      (request.operation === "release" ? "released" : "inspected") ||
    result.artifactRefDigest !==
      digest(
        "chainlesschain.browser-download-artifact-ref/v1",
        request.artifactRef,
      ) ||
    !LOCK_STATUSES.has(result.lockStatus) ||
    (hasOwner
      ? !LOCK_OPERATIONS.has(result.ownerOperation) ||
        !DIGEST.test(result.ownerProcessDigest) ||
        !Number.isFinite(Date.parse(result.ownerAcquiredAt))
      : result.ownerOperation !== null ||
        result.ownerProcessDigest !== null ||
        result.ownerAcquiredAt !== null) ||
    !DIGEST.test(result.lockStateDigest) ||
    (request.operation === "release"
      ? result.lockStateDigest !== request.expectedLockStateDigest ||
        !DIGEST.test(result.releaseReceiptDigest)
      : result.releaseReceiptDigest !== null) ||
    result.operatorIdDigest !== request.operatorIdDigest ||
    !DIGEST.test(result.outcomeRequestDigest) ||
    !DIGEST.test(result.auditEventDigest) ||
    !DIGEST.test(result.durabilityReceiptDigest) ||
    result.resultDigest !== digest(RESULT_SCHEMA, core)
  )
    throw new Error("Desktop quarantine lock maintenance result is invalid");
  return Object.freeze({ ...result });
}

async function maintainDesktopBrowserQuarantineLock(host, input, context) {
  const captured = hosts.get(host);
  if (!captured)
    throw codedError(
      "CC_BROWSER_LOCK_MAINTENANCE_UNAVAILABLE",
      "A signed browser quarantine lock maintenance deployment is required",
    );
  const normalized = normalizeInput(input);
  const { didManager, database, senderId, frameUrl, now } =
    normalizeExecutionContext(context);
  const identity = didManager.getCurrentIdentity();
  if (!identity || typeof identity.did !== "string" || identity.did.length < 1)
    throw codedError(
      "CC_BROWSER_LOCK_MAINTENANCE_AUTHENTICATION_REQUIRED",
      "An unlocked DID is required for browser quarantine lock maintenance",
    );
  const role = resolveOperatorRole(
    database,
    captured.descriptor.tenantId,
    identity.did,
  );
  const nowMs = now();
  if (!Number.isFinite(nowMs))
    throw new Error("Desktop quarantine lock maintenance clock is invalid");
  const requestId = randomUUID();
  const requestedAt = new Date(nowMs).toISOString();
  const operatorIdDigest = digest(
    "chainlesschain.desktop-browser-quarantine-operator-id/v1",
    identity.did,
  );
  const signedPayload = Object.freeze({
    schema: SIGNED_PAYLOAD_SCHEMA,
    requestId,
    tenantId: captured.descriptor.tenantId,
    senderId,
    frameUrlDigest: digest(
      "chainlesschain.desktop-browser-quarantine-operator-frame-url/v1",
      frameUrl,
    ),
    operation: normalized.operation,
    artifactRefDigest: digest(
      "chainlesschain.browser-download-artifact-ref/v1",
      normalized.artifactRef,
    ),
    expectedLockStateDigest: normalized.expectedLockStateDigest,
    operatorIdDigest,
    role,
    permission: PERMISSION,
    caseId: normalized.caseId,
    justificationDigest: normalized.justificationDigest,
    requestedAt,
  });
  let signed;
  try {
    signed = signPayloadWithIdentity(signedPayload, identity);
  } catch (cause) {
    throw codedError(
      "CC_BROWSER_LOCK_MAINTENANCE_SIGNATURE_UNAVAILABLE",
      "Current DID cannot sign browser quarantine lock maintenance",
      cause,
    );
  }
  const verification = verifyPayloadAgainstDid(
    signedPayload,
    identity.did,
    signed.sender_pubkey,
    signed.signature,
  );
  if (verification.ok !== true)
    throw codedError(
      "CC_BROWSER_LOCK_MAINTENANCE_SIGNATURE_INVALID",
      "Browser quarantine lock maintenance signature failed verification",
    );
  const request = Object.freeze({
    schema: REQUEST_SCHEMA,
    requestId,
    operation: normalized.operation,
    artifactRef: normalized.artifactRef,
    expectedLockStateDigest: normalized.expectedLockStateDigest,
    operatorIdDigest,
    authorization: Object.freeze({
      schema: AUTHORIZATION_SCHEMA,
      signedPayload,
      payloadDigest: digest(SIGNED_PAYLOAD_SCHEMA, signedPayload),
      senderPublicKey: signed.sender_pubkey,
      signature: signed.signature,
      signatureDigest: digest(
        "chainlesschain.desktop-browser-quarantine-operator-ed25519-signature/v1",
        signed.signature,
      ),
    }),
    requestedAt,
  });
  const result = await Reflect.apply(captured.maintainLock, undefined, [
    request,
  ]);
  try {
    return validateResult(result, {
      ...normalized,
      operatorIdDigest,
    });
  } catch (cause) {
    throw codedError(
      "CC_BROWSER_LOCK_MAINTENANCE_RESULT_UNCERTAIN",
      "Browser quarantine lock maintenance result is uncertain",
      cause,
    );
  }
}

function registerDesktopBrowserQuarantineLockMaintenanceIPC({
  ipcMain,
  host,
  didManager,
  database,
  now = Date.now,
}) {
  if (
    !ipcMain ||
    typeof ipcMain.handle !== "function" ||
    types.isProxy(ipcMain)
  )
    throw new TypeError(
      "Browser quarantine lock maintenance IPC main port is invalid",
    );
  ipcMain.handle(CHANNEL, async (event, input) =>
    maintainDesktopBrowserQuarantineLock(host, input, {
      didManager,
      database,
      senderId: event?.sender?.id,
      frameUrl: event?.senderFrame?.url ?? event?.sender?.getURL?.() ?? "",
      now,
    }),
  );
}

module.exports = {
  CHANNEL,
  createDesktopBrowserQuarantineLockMaintenanceHost,
  maintainDesktopBrowserQuarantineLock,
  registerDesktopBrowserQuarantineLockMaintenanceIPC,
  resolveOperatorRole,
};
