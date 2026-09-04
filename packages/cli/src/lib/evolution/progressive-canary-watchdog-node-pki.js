import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";

import {
  createProgressiveCanaryExternalRollbackAuthority,
  createProgressiveCanaryHeartbeatAuthority,
} from "./progressive-canary-external-watchdog.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ACTION_RECEIPT_SCHEMA =
  "chainlesschain.progressive-canary-watchdog-action-receipt/v1";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function sha(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function domainDigest(value) {
  return sha(`${ACTION_RECEIPT_SCHEMA}\0${canonical(value)}`);
}

function publicKeyObject(input, label) {
  let key;
  try {
    key = input?.type === "public" ? input : createPublicKey(input);
  } catch (cause) {
    throw new TypeError(`${label} is invalid`, { cause });
  }
  if (key.asymmetricKeyType !== "ed25519")
    throw new TypeError(`${label} must be Ed25519`);
  return key;
}

function privateKeyObject(input, label) {
  let key;
  try {
    key = input?.type === "private" ? input : createPrivateKey(input);
  } catch (cause) {
    throw new TypeError(`${label} is invalid`, { cause });
  }
  if (key.asymmetricKeyType !== "ed25519")
    throw new TypeError(`${label} must be Ed25519`);
  return key;
}

export function progressiveCanaryPublicKeySpkiDigest(publicKeyInput) {
  const key = publicKeyObject(publicKeyInput, "publicKey");
  return sha(key.export({ type: "spki", format: "der" }));
}

function signatureBytes(value) {
  if (typeof value !== "string" || value.length < 32) return null;
  const bytes = Buffer.from(value, "base64url");
  return bytes.toString("base64url") === value ? bytes : null;
}

function signer(privateKeyInput, publicKeyInput, expectedDigest, label) {
  const publicKey = publicKeyObject(publicKeyInput, `${label} publicKey`);
  if (progressiveCanaryPublicKeySpkiDigest(publicKey) !== expectedDigest)
    throw new Error(`${label} public key does not match the watchdog plan`);
  const privateKey =
    privateKeyInput === null || privateKeyInput === undefined
      ? null
      : privateKeyObject(privateKeyInput, `${label} privateKey`);
  if (
    privateKey &&
    progressiveCanaryPublicKeySpkiDigest(createPublicKey(privateKey)) !==
      expectedDigest
  )
    throw new Error(`${label} private key does not match its public key`);
  return Object.freeze({ privateKey, publicKey });
}

export function createNodeProgressiveCanaryHeartbeatAuthority({
  plan,
  privateKey = null,
  publicKey,
  now = Date.now,
} = {}) {
  const keys = signer(
    privateKey,
    publicKey,
    plan?.heartbeatAuthority?.publicKeySpkiDigest,
    "heartbeat authority",
  );
  return createProgressiveCanaryHeartbeatAuthority({
    plan,
    now,
    attestor: async (payload) => {
      if (!keys.privateKey)
        throw new Error("heartbeat signing key is unavailable in this process");
      return sign(
        null,
        Buffer.from(canonical(payload), "utf8"),
        keys.privateKey,
      ).toString("base64url");
    },
    verifier: async ({ payload, signature }) => {
      const bytes = signatureBytes(signature);
      return (
        bytes !== null &&
        verify(
          null,
          Buffer.from(canonical(payload), "utf8"),
          keys.publicKey,
          bytes,
        )
      );
    },
  });
}

function validateEffect(value, action, plan, request) {
  if (
    value?.authenticated !== true ||
    value?.durable !== true ||
    value.incidentDigest !== request.incidentDigest ||
    !DIGEST.test(value.effectDigest ?? "")
  )
    throw new Error(`${action} effect was not durably authenticated`);
  if (
    action === "kill" &&
    (value.hostId !== plan.hostId || value.processAbsent !== true)
  )
    throw new Error("kill effect did not prove the host process is absent");
  if (
    action === "rollback" &&
    (value.baselineDigest !== plan.baselineDigest ||
      !DIGEST.test(value.activeStateDigest ?? ""))
  )
    throw new Error("rollback effect did not prove the LKG readback");
  return value;
}

function actionCore(plan, request, action, effect) {
  return {
    schema: ACTION_RECEIPT_SCHEMA,
    authenticated: true,
    durable: true,
    action,
    planDigest: plan.planDigest,
    incidentDigest: request.incidentDigest,
    authorityId: plan.rollbackAuthority.id,
    authorityRevision: plan.rollbackAuthority.revision,
    handlerDigest: plan.rollbackAuthority.handlerDigest,
    publicKeySpkiDigest: plan.rollbackAuthority.publicKeySpkiDigest,
    effectDigest: effect.effectDigest,
    ...(action === "kill"
      ? { hostId: plan.hostId }
      : {
          baselineDigest: plan.baselineDigest,
          activeStateDigest: effect.activeStateDigest,
        }),
  };
}

export function createNodeProgressiveCanaryExternalRollbackAuthority({
  plan,
  privateKey,
  publicKey,
  killHost,
  rollbackToBaseline,
} = {}) {
  if (
    typeof killHost !== "function" ||
    typeof rollbackToBaseline !== "function"
  )
    throw new TypeError("Node watchdog effect ports are required");
  const keys = signer(
    privateKey,
    publicKey,
    plan?.rollbackAuthority?.publicKeySpkiDigest,
    "rollback authority",
  );
  if (!keys.privateKey)
    throw new TypeError("rollback authority privateKey is required");

  async function issue(action, request, perform) {
    const effect = validateEffect(
      await perform(request),
      action,
      plan,
      request,
    );
    const core = actionCore(plan, request, action, effect);
    const signature = sign(
      null,
      Buffer.from(canonical(core), "utf8"),
      keys.privateKey,
    ).toString("base64url");
    const signed = { ...core, signature };
    return Object.freeze({
      ...signed,
      receiptDigest: domainDigest(signed),
    });
  }

  async function verifyReceipt({ request, receipt }) {
    if (
      receipt?.schema !== ACTION_RECEIPT_SCHEMA ||
      receipt.receiptDigest !==
        domainDigest(
          Object.fromEntries(
            Object.entries(receipt).filter(([key]) => key !== "receiptDigest"),
          ),
        )
    )
      return false;
    const signature = signatureBytes(receipt.signature);
    if (!signature) return false;
    const signed = structuredClone(receipt);
    delete signed.receiptDigest;
    const unsigned = structuredClone(signed);
    delete unsigned.signature;
    const expected = actionCore(
      plan,
      request,
      receipt.action,
      receipt.action === "kill"
        ? {
            effectDigest: receipt.effectDigest,
          }
        : {
            effectDigest: receipt.effectDigest,
            activeStateDigest: receipt.activeStateDigest,
          },
    );
    return (
      canonical(unsigned) === canonical(expected) &&
      verify(
        null,
        Buffer.from(canonical(unsigned), "utf8"),
        keys.publicKey,
        signature,
      )
    );
  }

  return createProgressiveCanaryExternalRollbackAuthority({
    plan,
    killHost: (request) =>
      issue("kill", request, (value) =>
        killHost({ ...value, hostId: plan.hostId }),
      ),
    rollbackToBaseline: (request) =>
      issue("rollback", request, (value) =>
        rollbackToBaseline({ ...value, baselineDigest: plan.baselineDigest }),
      ),
    verifyKill: verifyReceipt,
    verifyRollback: verifyReceipt,
  });
}
