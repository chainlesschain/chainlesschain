"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { types } = require("node:util");

const {
  signPayloadWithIdentity,
  verifyPayloadAgainstDid,
} = require("../did/did-signer");

const CHANNEL = "browser:operator:revoke-quarantine-artifact";
const REQUEST_SCHEMA =
  "chainlesschain.browser-quarantine-operator-revocation-request/v1";
const RESULT_SCHEMA =
  "chainlesschain.browser-quarantine-operator-revocation-result/v1";
const AUTHORIZATION_SCHEMA =
  "chainlesschain.desktop-browser-quarantine-operator-authorization/v1";
const SIGNED_PAYLOAD_SCHEMA =
  "chainlesschain.desktop-browser-quarantine-operator-revocation-signature/v1";
const PERMISSION = "browser.quarantine.revoke";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ARTIFACT_REF = /^quarantine:[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u;
const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const ALLOWED_ROLES = new Set(["owner", "admin"]);
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
      "artifactRef",
      "artifactDigest",
      "sourceActionReceiptDigest",
      "caseId",
      "justification",
    ],
    "Desktop quarantine operator revocation input",
  );
  if (
    !ARTIFACT_REF.test(value.artifactRef) ||
    !DIGEST.test(value.artifactDigest) ||
    !DIGEST.test(value.sourceActionReceiptDigest) ||
    !CASE_ID.test(value.caseId) ||
    typeof value.justification !== "string" ||
    value.justification.trim().length < 8 ||
    Buffer.byteLength(value.justification, "utf8") > 2048
  )
    throw new TypeError(
      "Desktop quarantine operator revocation input is invalid",
    );
  return Object.freeze({
    artifactRef: value.artifactRef,
    artifactDigest: value.artifactDigest,
    sourceActionReceiptDigest: value.sourceActionReceiptDigest,
    caseId: value.caseId,
    justificationDigest: digest(
      "chainlesschain.desktop-browser-quarantine-operator-justification/v1",
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
      "CC_BROWSER_OPERATOR_REVOCATION_RBAC_UNAVAILABLE",
      "Browser quarantine operator RBAC database is unavailable",
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
    if (cause?.code === "CC_BROWSER_OPERATOR_REVOCATION_RBAC_UNAVAILABLE")
      throw cause;
    throw codedError(
      "CC_BROWSER_OPERATOR_REVOCATION_RBAC_UNAVAILABLE",
      "Browser quarantine operator RBAC check failed closed",
      cause,
    );
  }
  throw codedError(
    "CC_BROWSER_OPERATOR_REVOCATION_RBAC_DENIED",
    "Current DID is not authorized to revoke quarantined browser artifacts",
  );
}

function createDesktopBrowserQuarantineOperatorRevocationHost(
  authority,
  captureAuthority,
) {
  if (typeof captureAuthority !== "function" || types.isProxy(captureAuthority))
    throw new TypeError(
      "Browser quarantine operator revocation authority capture is invalid",
    );
  const captured = Reflect.apply(captureAuthority, undefined, [authority]);
  if (!captured || typeof captured !== "object" || types.isProxy(captured))
    throw new TypeError(
      "Browser quarantine operator revocation authority port is invalid",
    );
  const descriptor = ownData(
    captured,
    "descriptor",
    "browser quarantine operator revocation descriptor",
  );
  if (
    !descriptor ||
    typeof descriptor !== "object" ||
    types.isProxy(descriptor) ||
    ownData(descriptor, "approvalMode", "operator revocation approval mode") !==
      "operator-signed" ||
    ownData(descriptor, "auditMode", "operator revocation audit mode") !==
      "authenticated-durable-readback" ||
    ownData(descriptor, "effectMode", "operator revocation effect mode") !==
      "irreversible-byte-revocation"
  )
    throw new TypeError(
      "Browser quarantine operator revocation descriptor is invalid",
    );
  const tenantId = ownData(
    descriptor,
    "tenantId",
    "operator revocation tenant",
  );
  if (
    typeof tenantId !== "string" ||
    tenantId.length < 1 ||
    tenantId.length > 128
  )
    throw new TypeError(
      "Browser quarantine operator revocation tenant is invalid",
    );
  const host = Object.freeze({});
  hosts.set(host, {
    descriptor,
    revokeArtifact: ownFunction(
      captured,
      "revokeArtifact",
      "browser quarantine operator revocation port",
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
      "Desktop quarantine operator revocation context is invalid",
    );
  return { didManager, database, senderId, frameUrl, now };
}

function validateResult(result, request) {
  exact(
    result,
    [
      "schema",
      "status",
      "artifactRefDigest",
      "artifactDigest",
      "sourceActionReceiptDigest",
      "operatorIdDigest",
      "discardedAt",
      "deletionReceiptDigest",
      "outcomeRequestDigest",
      "auditEventDigest",
      "durabilityReceiptDigest",
      "resultDigest",
    ],
    "Desktop quarantine operator revocation result",
  );
  const core = Object.freeze({
    schema: result.schema,
    status: result.status,
    artifactRefDigest: result.artifactRefDigest,
    artifactDigest: result.artifactDigest,
    sourceActionReceiptDigest: result.sourceActionReceiptDigest,
    operatorIdDigest: result.operatorIdDigest,
    discardedAt: result.discardedAt,
    deletionReceiptDigest: result.deletionReceiptDigest,
    outcomeRequestDigest: result.outcomeRequestDigest,
    auditEventDigest: result.auditEventDigest,
    durabilityReceiptDigest: result.durabilityReceiptDigest,
  });
  if (
    result.schema !== RESULT_SCHEMA ||
    result.status !== "revoked" ||
    result.artifactRefDigest !==
      digest(
        "chainlesschain.browser-download-artifact-ref/v1",
        request.artifactRef,
      ) ||
    result.artifactDigest !== request.artifactDigest ||
    result.sourceActionReceiptDigest !== request.sourceActionReceiptDigest ||
    result.operatorIdDigest !== request.operatorIdDigest ||
    !Number.isFinite(Date.parse(result.discardedAt)) ||
    !DIGEST.test(result.deletionReceiptDigest) ||
    !DIGEST.test(result.outcomeRequestDigest) ||
    !DIGEST.test(result.auditEventDigest) ||
    !DIGEST.test(result.durabilityReceiptDigest) ||
    result.resultDigest !== digest(RESULT_SCHEMA, core)
  )
    throw new Error("Desktop quarantine operator revocation result is invalid");
  return Object.freeze({ ...result });
}

async function revokeDesktopBrowserQuarantineArtifact(host, input, context) {
  const captured = hosts.get(host);
  if (!captured)
    throw codedError(
      "CC_BROWSER_OPERATOR_REVOCATION_UNAVAILABLE",
      "A signed browser quarantine operator revocation deployment is required",
    );
  const normalized = normalizeInput(input);
  const { didManager, database, senderId, frameUrl, now } =
    normalizeExecutionContext(context);
  const identity = didManager.getCurrentIdentity();
  if (!identity || typeof identity.did !== "string" || identity.did.length < 1)
    throw codedError(
      "CC_BROWSER_OPERATOR_REVOCATION_AUTHENTICATION_REQUIRED",
      "An unlocked DID is required for browser quarantine revocation",
    );
  const role = resolveOperatorRole(
    database,
    captured.descriptor.tenantId,
    identity.did,
  );
  const nowMs = now();
  if (!Number.isFinite(nowMs))
    throw new Error("Desktop quarantine operator revocation clock is invalid");
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
    artifactRefDigest: digest(
      "chainlesschain.browser-download-artifact-ref/v1",
      normalized.artifactRef,
    ),
    artifactDigest: normalized.artifactDigest,
    sourceActionReceiptDigest: normalized.sourceActionReceiptDigest,
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
      "CC_BROWSER_OPERATOR_REVOCATION_SIGNATURE_UNAVAILABLE",
      "Current DID cannot sign the browser quarantine revocation",
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
      "CC_BROWSER_OPERATOR_REVOCATION_SIGNATURE_INVALID",
      "Browser quarantine operator signature failed verification",
    );
  const request = Object.freeze({
    schema: REQUEST_SCHEMA,
    requestId,
    artifactRef: normalized.artifactRef,
    artifactDigest: normalized.artifactDigest,
    sourceActionReceiptDigest: normalized.sourceActionReceiptDigest,
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
  const result = await Reflect.apply(captured.revokeArtifact, undefined, [
    request,
  ]);
  try {
    return validateResult(result, {
      ...normalized,
      operatorIdDigest,
    });
  } catch (cause) {
    throw codedError(
      "CC_BROWSER_OPERATOR_REVOCATION_RESULT_UNCERTAIN",
      "Browser quarantine operator revocation result is uncertain",
      cause,
    );
  }
}

function registerDesktopBrowserQuarantineOperatorRevocationIPC({
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
    throw new TypeError("Browser quarantine operator IPC main port is invalid");
  ipcMain.handle(CHANNEL, async (event, input) =>
    revokeDesktopBrowserQuarantineArtifact(host, input, {
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
  createDesktopBrowserQuarantineOperatorRevocationHost,
  registerDesktopBrowserQuarantineOperatorRevocationIPC,
  resolveOperatorRole,
  revokeDesktopBrowserQuarantineArtifact,
};
