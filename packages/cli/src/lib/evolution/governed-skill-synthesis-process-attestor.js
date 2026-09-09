import {
  createHash,
  createPrivateKey,
  createPublicKey,
  verify,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { types as utilTypes } from "node:util";

import executionBroker, {
  SANDBOX_BOUNDARIES,
} from "../process-execution-broker/index.js";

export const GOVERNED_SKILL_SYNTHESIS_PROCESS_ATTESTOR_SCHEMA =
  "chainlesschain.governed-skill-synthesis-process-attestor/v1";
export const GOVERNED_SKILL_SYNTHESIS_EVALUATION_ATTESTATION_SCHEMA =
  "chainlesschain.skill-synthesis-evaluation-attestation/v1";

const REQUEST_SCHEMA =
  "chainlesschain.skill-synthesis-process-attestor-request/v1";
const WORKER = fileURLToPath(
  new URL(
    "./governed-skill-synthesis-process-attestor-worker.mjs",
    import.meta.url,
  ),
);
const CREDENTIAL_RESOLVER = fileURLToPath(
  new URL(
    "../process-execution-broker/credential-transport.js",
    import.meta.url,
  ),
);
const AUTHORITIES = new WeakSet();
const OPTION_KEYS = new Set([
  "memoryLimitMb",
  "privateKeyPem",
  "publicKeyPem",
  "timeoutMs",
]);
const REQUEST_KEYS = new Set([
  "candidateDigest",
  "descriptor",
  "receiptDigest",
]);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_OUTPUT_BYTES = 32 * 1024;
const REQUIRED_SANDBOX_BOUNDARIES = Object.freeze([
  SANDBOX_BOUNDARIES.PRIVILEGE_REDUCTION,
  SANDBOX_BOUNDARIES.PROCESS_TREE,
  SANDBOX_BOUNDARIES.RESOURCE_LIMITS,
]);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function exactRecord(value, label, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== keys.size ||
    Reflect.ownKeys(descriptors).some(
      (key) =>
        typeof key !== "string" ||
        !keys.has(key) ||
        !("value" in descriptors[key]) ||
        descriptors[key].enumerable !== true,
    )
  ) {
    throw new TypeError(`${label} has unexpected or missing fields`);
  }
  return value;
}

function allowedRecord(value, label, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).some(
      (key) =>
        typeof key !== "string" ||
        !keys.has(key) ||
        !("value" in descriptors[key]) ||
        descriptors[key].enumerable !== true,
    )
  ) {
    throw new TypeError(`${label} contains unsupported fields`);
  }
  return value;
}

function boundedString(value, label, maximum = 256) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    value.includes("\0")
  ) {
    throw new TypeError(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function boundedSecret(value, label, maximum) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum ||
    value.includes("\0")
  ) {
    throw new TypeError(`${label} must be bounded text`);
  }
  return value;
}

function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be from ${minimum} to ${maximum}`);
  }
  return value;
}

function evaluatorDescriptor(value) {
  exactRecord(
    value,
    "evaluation attestor descriptor",
    new Set(["authorityId", "handlerArtifactDigest", "revision"]),
  );
  if (
    !DIGEST.test(value.handlerArtifactDigest ?? "") ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1
  ) {
    throw new TypeError("evaluation attestor descriptor binding is invalid");
  }
  return Object.freeze({
    authorityId: boundedString(value.authorityId, "evaluation authority"),
    handlerArtifactDigest: value.handlerArtifactDigest,
    revision: value.revision,
  });
}

function snapshot(target, label) {
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error(`${label} is not a single-link regular file`);
  }
  const physical = fs.realpathSync.native(target);
  const bytes = fs.readFileSync(physical);
  if (bytes.length === 0 || bytes.length > 128 * 1024) {
    throw new Error(`${label} size is invalid`);
  }
  return Object.freeze({ physical, size: bytes.length, digest: sha256(bytes) });
}

function executionSnapshot() {
  return Object.freeze({
    worker: snapshot(WORKER, "process attestor worker"),
    credentialResolver: snapshot(
      CREDENTIAL_RESOLVER,
      "process attestor credential resolver",
    ),
  });
}

function snapshotMatches(left, right) {
  return ["worker", "credentialResolver"].every(
    (key) =>
      left[key].physical === right[key].physical &&
      left[key].size === right[key].size &&
      left[key].digest === right[key].digest,
  );
}

function minimalEnvironment(privateKeyPem) {
  const environment = { CC_EVOLUTION_ATTESTOR_PRIVATE_KEY: privateKeyPem };
  if (process.platform !== "win32") return environment;
  for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP"]) {
    const value = process.env[key];
    if (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= 32 * 1024 &&
      !value.includes("\0")
    ) {
      environment[key] = value;
    }
  }
  if (!environment.SystemRoot && !environment.WINDIR) {
    throw new Error("Windows process attestor requires a system root");
  }
  return environment;
}

function signingMessage(request, attestor) {
  return Buffer.from(
    `${GOVERNED_SKILL_SYNTHESIS_EVALUATION_ATTESTATION_SCHEMA}\0${canonical({
      receiptDigest: request.receiptDigest,
      candidateDigest: request.candidateDigest,
      evaluatorDescriptor: request.descriptor,
      attestor,
    })}`,
    "utf8",
  );
}

function runAttestor({
  request,
  descriptor,
  privateKeyPem,
  snapshot: pinned,
  timeoutMs,
  memoryLimitMb,
}) {
  return new Promise((resolve, reject) => {
    const child = executionBroker.spawn(
      process.execPath,
      [
        `--max-old-space-size=${memoryLimitMb}`,
        ...(process.platform === "win32"
          ? []
          : [
              "--experimental-permission",
              `--allow-fs-read=${pinned.worker.physical}`,
              `--allow-fs-read=${pinned.credentialResolver.physical}`,
            ]),
        pinned.worker.physical,
      ],
      {
        cwd: path.dirname(pinned.worker.physical),
        env: minimalEnvironment(privateKeyPem),
        credentialTargetHost: descriptor.credentialTarget,
        credentialTtlMs: descriptor.credentialTtlMs,
        credentialMaxUses: descriptor.credentialMaxUses,
        policy: "allow",
        requirePersistentAudit: true,
        sandboxPolicy: {
          profile: descriptor.sandboxProfile,
          requiredBoundaries: REQUIRED_SANDBOX_BOUNDARIES,
        },
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        origin: "governed-skill-synthesis-process-attestor",
        reason: "Sign one bounded learning synthesis evaluation receipt",
      },
    );
    let stdout = "";
    let stderr = "";
    let terminalError = null;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      terminalError = new Error(
        `learning synthesis process attestor timed out after ${timeoutMs}ms`,
      );
      terminalError.code = "LEARNING_SYNTHESIS_PROCESS_ATTESTOR_TIMEOUT";
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref?.();
    for (const [stream, append] of [
      [child.stdout, (chunk) => (stdout += chunk.toString("utf8"))],
      [child.stderr, (chunk) => (stderr += chunk.toString("utf8"))],
    ]) {
      stream.on("data", (chunk) => {
        append(chunk);
        if (
          Buffer.byteLength(stream === child.stdout ? stdout : stderr, "utf8") >
          MAX_OUTPUT_BYTES
        ) {
          terminalError = new Error(
            "process attestor output exceeded its bound",
          );
          child.kill("SIGKILL");
        }
      });
    }
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code, signal) => {
      if (terminalError) return finish(reject, terminalError);
      if (code !== 0) {
        return finish(
          reject,
          new Error(
            `learning synthesis process attestor exited ${code ?? "null"}/${signal ?? "none"}: ${stderr.slice(0, 256)}`,
          ),
        );
      }
      try {
        const lines = stdout.trimEnd().split("\n");
        if (lines.length !== 1) throw new Error("multiple output records");
        const result = JSON.parse(lines[0]);
        exactRecord(
          result,
          "process attestor output",
          new Set(["attestation", "ok"]),
        );
        if (result.ok !== true) throw new Error("attestor output was not ok");
        finish(resolve, result.attestation);
      } catch (cause) {
        finish(
          reject,
          new Error("learning synthesis process attestor output is invalid", {
            cause,
          }),
        );
      }
    });
    child.stdin.once("error", (error) => {
      terminalError ??= error;
    });
    child.stdin.end(
      JSON.stringify({
        schema: REQUEST_SCHEMA,
        receiptDigest: request.receiptDigest,
        candidateDigest: request.candidateDigest,
        evaluatorDescriptor: request.descriptor,
        attestor: descriptor,
      }),
    );
  });
}

export function createGovernedSkillSynthesisProcessAttestationAuthority(
  options = {},
) {
  allowedRecord(options, "process attestor options", OPTION_KEYS);
  const privateKeyPem = boundedSecret(
    options.privateKeyPem,
    "process attestor privateKeyPem",
    16 * 1024,
  );
  const publicKeyPem = boundedSecret(
    options.publicKeyPem,
    "process attestor publicKeyPem",
    16 * 1024,
  );
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(publicKeyPem);
  if (
    privateKey.asymmetricKeyType !== "ed25519" ||
    publicKey.asymmetricKeyType !== "ed25519"
  ) {
    throw new TypeError("process attestor keys must be Ed25519");
  }
  const derivedPublic = createPublicKey(privateKey).export({
    type: "spki",
    format: "der",
  });
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  if (!Buffer.from(derivedPublic).equals(Buffer.from(publicDer))) {
    throw new TypeError("process attestor key pair does not match");
  }
  const timeoutMs = integer(
    options.timeoutMs ?? 5_000,
    "process attestor timeoutMs",
    1_000,
    30_000,
  );
  const memoryLimitMb = integer(
    options.memoryLimitMb ?? 64,
    "process attestor memoryLimitMb",
    32,
    256,
  );
  const pinned = executionSnapshot();
  const publicKeyDigest = sha256(publicDer);
  const descriptor = Object.freeze({
    schema: GOVERNED_SKILL_SYNTHESIS_PROCESS_ATTESTOR_SCHEMA,
    algorithm: "Ed25519",
    keyId: `key:ed25519:${publicKeyDigest.slice(7)}`,
    publicKeyDigest,
    isolation: "process",
    workerArtifactDigest: pinned.worker.digest,
    credentialResolverArtifactDigest: pinned.credentialResolver.digest,
    credentialDelivery: "single-use-broker-reference",
    credentialTarget: "governed-skill-attestor.local",
    credentialMaxUses: 1,
    credentialTtlMs: Math.min(timeoutMs + 5_000, 35_000),
    hardDeadlineEnforced: true,
    sandboxProfile: "network-only",
    requiredSandboxBoundaries: REQUIRED_SANDBOX_BOUNDARIES,
    persistentProcessAuditRequired: true,
  });
  const normalizeRequest = (value) => {
    exactRecord(value, "process attestor request", REQUEST_KEYS);
    if (
      !DIGEST.test(value.receiptDigest ?? "") ||
      !DIGEST.test(value.candidateDigest ?? "")
    ) {
      throw new TypeError("process attestor request digests are invalid");
    }
    return Object.freeze({
      receiptDigest: value.receiptDigest,
      candidateDigest: value.candidateDigest,
      descriptor: evaluatorDescriptor(value.descriptor),
    });
  };
  const attestReceipt = async (value) => {
    const request = normalizeRequest(value);
    if (!snapshotMatches(executionSnapshot(), pinned)) {
      throw new Error("process attestor artifacts changed after construction");
    }
    const attestation = await runAttestor({
      request,
      descriptor,
      privateKeyPem,
      snapshot: pinned,
      timeoutMs,
      memoryLimitMb,
    });
    if (!snapshotMatches(executionSnapshot(), pinned)) {
      throw new Error("process attestor artifacts changed during execution");
    }
    return attestation;
  };
  const verifyAttestation = async (value) => {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      utilTypes.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      return false;
    }
    const inputDescriptors = Object.getOwnPropertyDescriptors(value);
    const inputKeys = new Set([
      "attestation",
      "candidateDigest",
      "descriptor",
      "receiptDigest",
    ]);
    if (
      Reflect.ownKeys(inputDescriptors).length !== inputKeys.size ||
      Reflect.ownKeys(inputDescriptors).some(
        (key) =>
          typeof key !== "string" ||
          !inputKeys.has(key) ||
          !("value" in inputDescriptors[key]) ||
          inputDescriptors[key].enumerable !== true,
      )
    ) {
      return false;
    }
    let request;
    try {
      request = normalizeRequest({
        receiptDigest: inputDescriptors.receiptDigest.value,
        candidateDigest: inputDescriptors.candidateDigest.value,
        descriptor: inputDescriptors.descriptor.value,
      });
    } catch {
      return false;
    }
    const attestation = inputDescriptors.attestation.value;
    if (
      !attestation ||
      typeof attestation !== "object" ||
      Array.isArray(attestation) ||
      utilTypes.isProxy(attestation)
    ) {
      return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(attestation);
    const expectedKeys = new Set([
      ...Object.keys(descriptor).filter((key) => key !== "schema"),
      "attestorSchema",
      "schema",
      "signature",
    ]);
    if (
      Reflect.ownKeys(descriptors).length !== expectedKeys.size ||
      Reflect.ownKeys(descriptors).some(
        (key) =>
          typeof key !== "string" ||
          !expectedKeys.has(key) ||
          !("value" in descriptors[key]) ||
          descriptors[key].enumerable !== true,
      )
    ) {
      return false;
    }
    const { schema, attestorSchema, signature, ...execution } = attestation;
    if (
      schema !== GOVERNED_SKILL_SYNTHESIS_EVALUATION_ATTESTATION_SCHEMA ||
      attestorSchema !== descriptor.schema ||
      canonical(execution) !==
        canonical(
          Object.fromEntries(
            Object.entries(descriptor).filter(([key]) => key !== "schema"),
          ),
        ) ||
      typeof signature !== "string" ||
      signature.length === 0 ||
      signature.length > 1024
    ) {
      return false;
    }
    try {
      return verify(
        null,
        signingMessage(request, descriptor),
        publicKey,
        Buffer.from(signature, "base64"),
      );
    } catch {
      return false;
    }
  };
  Object.freeze(attestReceipt);
  Object.freeze(verifyAttestation);
  const authority = Object.freeze({
    descriptor,
    attestReceipt,
    verifyAttestation,
  });
  AUTHORITIES.add(authority);
  return authority;
}

export function isGovernedSkillSynthesisProcessAttestationAuthority(value) {
  return AUTHORITIES.has(value);
}
