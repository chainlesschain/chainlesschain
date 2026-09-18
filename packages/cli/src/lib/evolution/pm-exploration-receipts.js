import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { isKeyObject, isProxy } from "node:util/types";

export const PM_EXPLORATION_EXECUTION_RECEIPT_SCHEMA =
  "chainlesschain.pm-exploration-execution-receipt/v1";
export const PM_EXPLORATION_GRADER_RECEIPT_SCHEMA =
  "chainlesschain.pm-exploration-grader-receipt/v1";
export const PM_EXPLORATION_MERGE_RECEIPT_SCHEMA =
  "chainlesschain.pm-exploration-merge-receipt/v1";
export const PM_EXPLORATION_EVALUATOR_RECEIPT_SCHEMA =
  "chainlesschain.pm-exploration-evaluator-receipt/v1";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[a-z][a-z0-9]*(?:[._:@/-][a-z0-9]+)*$/u;
const ROLES = Object.freeze({
  execution: PM_EXPLORATION_EXECUTION_RECEIPT_SCHEMA,
  grader: PM_EXPLORATION_GRADER_RECEIPT_SCHEMA,
  merge: PM_EXPLORATION_MERGE_RECEIPT_SCHEMA,
  evaluator: PM_EXPLORATION_EVALUATOR_RECEIPT_SCHEMA,
});
const AUTHORITIES = new WeakMap();
const SIGNERS = new WeakMap();

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key !== "string" ||
        !keys.includes(key) ||
        !descriptor ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  ) {
    throw new TypeError(`${label} has unexpected or accessor fields`);
  }
}

function identifier(value, label) {
  if (typeof value !== "string" || value.length > 256 || !ID.test(value))
    throw new TypeError(`${label} is invalid`);
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value))
    throw new TypeError(`${label} must be a sha256 digest`);
  return value;
}

function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new TypeError(`${label} is outside its allowed range`);
  return value;
}

function role(value) {
  if (typeof value !== "string" || !Object.hasOwn(ROLES, value))
    throw new TypeError("PM exploration receipt role is invalid");
  return value;
}

function issuedAt(value) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new TypeError("receipt issuedAt must be an ISO timestamp");
  }
  return value;
}

function metrics(value, label) {
  exact(value, ["tokens", "toolCalls", "wallClockMs"], label);
  return Object.freeze({
    tokens: integer(value.tokens, `${label}.tokens`),
    toolCalls: integer(value.toolCalls, `${label}.toolCalls`),
    wallClockMs: integer(value.wallClockMs, `${label}.wallClockMs`),
  });
}

function branchCheckpoints(value) {
  if (
    !Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < 1 ||
    value.length > 8 ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new TypeError("merge branchCheckpoints are invalid");
  }
  const seen = new Set();
  return Object.freeze(
    value.map((entry, index) => {
      if (!Object.hasOwn(value, index))
        throw new TypeError("merge branchCheckpoints cannot contain holes");
      exact(
        entry,
        ["branchId", "checkpointDigest", "memoryDigest"],
        `merge branch checkpoint ${index}`,
      );
      const normalized = Object.freeze({
        branchId: identifier(entry.branchId, "merge branchId"),
        checkpointDigest: digest(
          entry.checkpointDigest,
          "merge checkpointDigest",
        ),
        memoryDigest: digest(entry.memoryDigest, "merge memoryDigest"),
      });
      if (seen.has(normalized.branchId))
        throw new TypeError("merge branchCheckpoints must be unique");
      seen.add(normalized.branchId);
      return normalized;
    }),
  );
}

function normalizeExecutionPayload(value) {
  exact(
    value,
    [
      "planDigest",
      "environmentDigest",
      "requestDigest",
      "roundId",
      "stage",
      "branchId",
      "taskId",
      "inputMemoryDigest",
      "outputMemoryDigest",
      "traceDigest",
      "status",
      "failureClass",
      "metrics",
      "issuedAt",
    ],
    "execution receipt payload",
  );
  if (!["broad", "deep"].includes(value.stage))
    throw new TypeError("execution receipt stage is invalid");
  if (value.stage === "broad") identifier(value.branchId, "branchId");
  else if (value.branchId !== null)
    throw new TypeError("Deep execution receipts cannot name a branch");
  if (!["succeeded", "failed", "aborted"].includes(value.status))
    throw new TypeError("execution receipt status is invalid");
  if (
    ![
      "none",
      "model",
      "tool",
      "provider",
      "sandbox",
      "permission",
      "budget",
      "infrastructure",
      "unknown",
    ].includes(value.failureClass)
  ) {
    throw new TypeError("execution receipt failureClass is invalid");
  }
  if (
    (value.status === "succeeded" && value.failureClass !== "none") ||
    (value.status !== "succeeded" && value.failureClass === "none")
  ) {
    throw new TypeError("execution receipt status and failureClass disagree");
  }
  return deepFreeze({
    planDigest: digest(value.planDigest, "planDigest"),
    environmentDigest: digest(value.environmentDigest, "environmentDigest"),
    requestDigest: digest(value.requestDigest, "requestDigest"),
    roundId: identifier(value.roundId, "roundId"),
    stage: value.stage,
    branchId: value.branchId,
    taskId: identifier(value.taskId, "taskId"),
    inputMemoryDigest: digest(value.inputMemoryDigest, "inputMemoryDigest"),
    outputMemoryDigest: digest(value.outputMemoryDigest, "outputMemoryDigest"),
    traceDigest: digest(value.traceDigest, "traceDigest"),
    status: value.status,
    failureClass: value.failureClass,
    metrics: metrics(value.metrics, "execution metrics"),
    issuedAt: issuedAt(value.issuedAt),
  });
}

function normalizeGraderPayload(value) {
  exact(
    value,
    [
      "planDigest",
      "environmentDigest",
      "requestDigest",
      "roundId",
      "executionReceiptDigest",
      "outputMemoryDigest",
      "decision",
      "scoreBasisPoints",
      "resultDigest",
      "metrics",
      "issuedAt",
    ],
    "grader receipt payload",
  );
  if (!["accept", "reject", "unsafe"].includes(value.decision))
    throw new TypeError("grader receipt decision is invalid");
  return deepFreeze({
    planDigest: digest(value.planDigest, "planDigest"),
    environmentDigest: digest(value.environmentDigest, "environmentDigest"),
    requestDigest: digest(value.requestDigest, "requestDigest"),
    roundId: identifier(value.roundId, "roundId"),
    executionReceiptDigest: digest(
      value.executionReceiptDigest,
      "executionReceiptDigest",
    ),
    outputMemoryDigest: digest(value.outputMemoryDigest, "outputMemoryDigest"),
    decision: value.decision,
    scoreBasisPoints: integer(
      value.scoreBasisPoints,
      "scoreBasisPoints",
      0,
      10_000,
    ),
    resultDigest: digest(value.resultDigest, "resultDigest"),
    metrics: metrics(value.metrics, "grader metrics"),
    issuedAt: issuedAt(value.issuedAt),
  });
}

function normalizeMergePayload(value) {
  exact(
    value,
    [
      "planDigest",
      "environmentDigest",
      "requestDigest",
      "mergeId",
      "branchCheckpoints",
      "outputMemoryDigest",
      "conflictResolutionDigest",
      "status",
      "failureClass",
      "metrics",
      "issuedAt",
    ],
    "merge receipt payload",
  );
  if (!["succeeded", "failed", "aborted"].includes(value.status))
    throw new TypeError("merge receipt status is invalid");
  if (
    !["none", "budget", "infrastructure", "unknown"].includes(
      value.failureClass,
    )
  ) {
    throw new TypeError("merge receipt failureClass is invalid");
  }
  if (
    (value.status === "succeeded" && value.failureClass !== "none") ||
    (value.status !== "succeeded" && value.failureClass === "none")
  ) {
    throw new TypeError("merge receipt status and failureClass disagree");
  }
  return deepFreeze({
    planDigest: digest(value.planDigest, "planDigest"),
    environmentDigest: digest(value.environmentDigest, "environmentDigest"),
    requestDigest: digest(value.requestDigest, "requestDigest"),
    mergeId: identifier(value.mergeId, "mergeId"),
    branchCheckpoints: branchCheckpoints(value.branchCheckpoints),
    outputMemoryDigest: digest(value.outputMemoryDigest, "outputMemoryDigest"),
    conflictResolutionDigest: digest(
      value.conflictResolutionDigest,
      "conflictResolutionDigest",
    ),
    status: value.status,
    failureClass: value.failureClass,
    metrics: metrics(value.metrics, "merge metrics"),
    issuedAt: issuedAt(value.issuedAt),
  });
}

function normalizeEvaluatorPayload(value) {
  exact(
    value,
    [
      "planDigest",
      "environmentDigest",
      "requestDigest",
      "mergeReceiptDigest",
      "finalCheckpointDigest",
      "finalMemoryDigest",
      "decision",
      "scoreBasisPoints",
      "evaluationDigest",
      "metrics",
      "issuedAt",
    ],
    "evaluator receipt payload",
  );
  if (!["accept", "reject", "unsafe"].includes(value.decision))
    throw new TypeError("evaluator receipt decision is invalid");
  return deepFreeze({
    planDigest: digest(value.planDigest, "planDigest"),
    environmentDigest: digest(value.environmentDigest, "environmentDigest"),
    requestDigest: digest(value.requestDigest, "requestDigest"),
    mergeReceiptDigest: digest(value.mergeReceiptDigest, "mergeReceiptDigest"),
    finalCheckpointDigest: digest(
      value.finalCheckpointDigest,
      "finalCheckpointDigest",
    ),
    finalMemoryDigest: digest(value.finalMemoryDigest, "finalMemoryDigest"),
    decision: value.decision,
    scoreBasisPoints: integer(
      value.scoreBasisPoints,
      "scoreBasisPoints",
      0,
      10_000,
    ),
    evaluationDigest: digest(value.evaluationDigest, "evaluationDigest"),
    metrics: metrics(value.metrics, "evaluator metrics"),
    issuedAt: issuedAt(value.issuedAt),
  });
}

function normalizePayload(receiptRole, value) {
  if (receiptRole === "execution") return normalizeExecutionPayload(value);
  if (receiptRole === "grader") return normalizeGraderPayload(value);
  if (receiptRole === "merge") return normalizeMergePayload(value);
  return normalizeEvaluatorPayload(value);
}

function publicKey(value) {
  let key;
  try {
    key = isKeyObject(value) ? value : createPublicKey(value);
  } catch (cause) {
    throw new TypeError("PM exploration receipt publicKey is invalid", {
      cause,
    });
  }
  if (key.type !== "public" || key.asymmetricKeyType !== "ed25519")
    throw new TypeError("PM exploration receipt publicKey must be Ed25519");
  return key;
}

function privateKey(value) {
  let key;
  try {
    key = isKeyObject(value) ? value : createPrivateKey(value);
  } catch (cause) {
    throw new TypeError("PM exploration receipt privateKey is invalid", {
      cause,
    });
  }
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519")
    throw new TypeError("PM exploration receipt privateKey must be Ed25519");
  return key;
}

function keyDigest(key) {
  return `sha256:${createHash("sha256")
    .update(key.export({ format: "der", type: "spki" }))
    .digest("hex")}`;
}

function descriptor(input, key) {
  exact(
    input,
    ["role", "authorityId", "revision", "handlerArtifactDigest"],
    "PM exploration receipt authority descriptor",
  );
  return deepFreeze({
    role: role(input.role),
    authorityId: identifier(input.authorityId, "authorityId"),
    revision: integer(input.revision, "revision", 1),
    handlerArtifactDigest: digest(
      input.handlerArtifactDigest,
      "handlerArtifactDigest",
    ),
    publicKeyDigest: keyDigest(key),
  });
}

export function createPmExplorationReceiptAuthority(options = {}) {
  exact(
    options,
    ["role", "authorityId", "revision", "handlerArtifactDigest", "publicKey"],
    "PM exploration receipt authority options",
  );
  const key = publicKey(options.publicKey);
  const authority = Object.freeze({});
  AUTHORITIES.set(authority, {
    descriptor: descriptor(
      {
        role: options.role,
        authorityId: options.authorityId,
        revision: options.revision,
        handlerArtifactDigest: options.handlerArtifactDigest,
      },
      key,
    ),
    publicKey: key,
  });
  return authority;
}

export function createPmExplorationReceiptSigner(options = {}) {
  exact(
    options,
    [
      "role",
      "authorityId",
      "revision",
      "handlerArtifactDigest",
      "privateKey",
      "publicKey",
    ],
    "PM exploration receipt signer options",
  );
  const signingKey = privateKey(options.privateKey);
  const verificationKey = publicKey(options.publicKey);
  if (keyDigest(createPublicKey(signingKey)) !== keyDigest(verificationKey))
    throw new TypeError("PM exploration receipt key pair does not match");
  const authority = createPmExplorationReceiptAuthority({
    role: options.role,
    authorityId: options.authorityId,
    revision: options.revision,
    handlerArtifactDigest: options.handlerArtifactDigest,
    publicKey: verificationKey,
  });
  const signer = Object.freeze({});
  SIGNERS.set(signer, { authority, privateKey: signingKey });
  return signer;
}

export function inspectPmExplorationReceiptAuthority(value) {
  const signer = SIGNERS.get(value);
  const binding = signer
    ? AUTHORITIES.get(signer.authority)
    : AUTHORITIES.get(value);
  if (!binding)
    throw new TypeError(
      "a branded PM exploration receipt authority is required",
    );
  return binding.descriptor;
}

export function getPmExplorationReceiptSignerAuthority(value) {
  const binding = SIGNERS.get(value);
  if (!binding)
    throw new TypeError("a branded PM exploration receipt signer is required");
  return binding.authority;
}

export function issuePmExplorationReceipt(signer, payloadInput) {
  const signing = SIGNERS.get(signer);
  if (!signing)
    throw new TypeError("a branded PM exploration receipt signer is required");
  const authority = AUTHORITIES.get(signing.authority);
  const receiptRole = authority.descriptor.role;
  const payload = normalizePayload(receiptRole, payloadInput);
  const core = deepFreeze({
    schema: ROLES[receiptRole],
    role: receiptRole,
    authenticated: true,
    authority: authority.descriptor,
    payload,
  });
  const receiptDigest = hash(ROLES[receiptRole], core);
  const signature = sign(
    null,
    Buffer.from(`${ROLES[receiptRole]}\0${receiptDigest}`, "utf8"),
    signing.privateKey,
  ).toString("base64url");
  return deepFreeze({ ...core, receiptDigest, signature });
}

function signatureBytes(value) {
  if (typeof value !== "string" || value.length > 256)
    throw new TypeError("PM exploration receipt signature is invalid");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 64 || bytes.toString("base64url") !== value)
    throw new TypeError("PM exploration receipt signature is invalid");
  return bytes;
}

function expectedPayload(value) {
  if (value === undefined) return null;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError("expected receipt payload bindings must be plain data");
  }
  for (const key of Reflect.ownKeys(value)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !field ||
      !field.enumerable ||
      !("value" in field)
    ) {
      throw new TypeError("expected receipt payload bindings are invalid");
    }
  }
  return value;
}

export function verifyPmExplorationReceipt(
  authorityValue,
  value,
  expectedInput,
) {
  const authority = AUTHORITIES.get(authorityValue);
  if (!authority)
    throw new TypeError(
      "a branded PM exploration receipt authority is required",
    );
  exact(
    value,
    [
      "schema",
      "role",
      "authenticated",
      "authority",
      "payload",
      "receiptDigest",
      "signature",
    ],
    "PM exploration receipt",
  );
  const receiptRole = authority.descriptor.role;
  if (
    value.schema !== ROLES[receiptRole] ||
    value.role !== receiptRole ||
    value.authenticated !== true ||
    canonical(value.authority) !== canonical(authority.descriptor)
  ) {
    throw new Error("PM exploration receipt authority binding mismatch");
  }
  const payload = normalizePayload(receiptRole, value.payload);
  const core = deepFreeze({
    schema: value.schema,
    role: value.role,
    authenticated: true,
    authority: authority.descriptor,
    payload,
  });
  const receiptDigest = hash(value.schema, core);
  if (value.receiptDigest !== receiptDigest)
    throw new Error("PM exploration receipt digest mismatch");
  if (
    !verify(
      null,
      Buffer.from(`${value.schema}\0${receiptDigest}`, "utf8"),
      authority.publicKey,
      signatureBytes(value.signature),
    )
  ) {
    throw new Error("PM exploration receipt signature rejected");
  }
  const expected = expectedPayload(expectedInput);
  if (expected) {
    for (const key of Object.keys(expected)) {
      if (
        !Object.hasOwn(payload, key) ||
        canonical(payload[key]) !== canonical(expected[key])
      ) {
        throw new Error(`PM exploration receipt ${key} binding mismatch`);
      }
    }
  }
  return deepFreeze({ ...core, receiptDigest, signature: value.signature });
}

export function computePmExplorationReceiptDigest(domain, value) {
  return hash(domain, value);
}
