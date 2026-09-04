import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import executionBroker from "../process-execution-broker/index.js";

import {
  buildEvolutionEvalAttestationDigest,
  computeEvolutionEvalIsolatedTargetDigest,
  computeEvolutionEvalSupervisedResultDigest,
  computeEvolutionEvalTargetAuthorityDigest,
  EVOLUTION_EVAL_ATTESTATION_PURPOSES,
  EVOLUTION_EVAL_SUPERVISION_SCHEMA,
  EVOLUTION_EVAL_TARGET_INVOCATION_SCHEMA,
  EVOLUTION_EVAL_TARGET_REVOCATION_SCHEMA,
} from "./evolution-eval-gate.js";

const WORKER = fileURLToPath(
  new URL("./evolution-eval-process-supervisor-worker.mjs", import.meta.url),
);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_MEMORY_LIMIT_MB = 128;
const MIN_MEMORY_LIMIT_MB = 32;
const MAX_MEMORY_LIMIT_MB = 1024;
const MAX_PERMISSION_PATHS = 32;
const PROCESS_SUPERVISORS = new WeakSet();

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

function jsonClone(value, label) {
  let encoded;
  let cloned;
  try {
    encoded = JSON.stringify(value);
    cloned = JSON.parse(encoded);
  } catch (cause) {
    throw new TypeError(`${label} must be JSON data`, { cause });
  }
  if (!encoded || Buffer.byteLength(encoded) > MAX_OUTPUT_BYTES)
    throw new TypeError(`${label} exceeds 1 MiB`);
  if (canonical(cloned) !== canonical(value))
    throw new TypeError(`${label} contains non-JSON values`);
  return cloned;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) throw new TypeError(`${label} is invalid`);
  return value;
}

function timestamp(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new TypeError("supervisor clock is invalid");
  return date.toISOString();
}

async function moduleSnapshot(path, expectedDigest) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
    throw new Error(
      "evaluation target module is not a single-link regular file",
    );
  const physical = await realpath(path);
  const bytes = await readFile(physical);
  if (bytes.length < 1 || bytes.length > MAX_OUTPUT_BYTES)
    throw new Error("evaluation target module exceeds 1 MiB");
  if (sha(bytes) !== expectedDigest)
    throw new Error(
      "evaluation target module bytes differ from its descriptor",
    );
  return Object.freeze({
    physical,
    size: bytes.length,
    digest: expectedDigest,
    moduleUrl: `data:text/javascript;base64,${bytes.toString("base64")}`,
  });
}

function moduleSnapshotSync(path, expectedDigest) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
    throw new Error(
      "evaluation target module is not a single-link regular file",
    );
  const physical = realpathSync(path);
  const bytes = readFileSync(physical);
  if (bytes.length < 1 || bytes.length > MAX_OUTPUT_BYTES)
    throw new Error("evaluation target module exceeds 1 MiB");
  if (sha(bytes) !== expectedDigest)
    throw new Error(
      "evaluation target module bytes differ from its descriptor",
    );
  return Object.freeze({
    physical,
    size: bytes.length,
    digest: expectedDigest,
    moduleUrl: `data:text/javascript;base64,${bytes.toString("base64")}`,
  });
}

function sandboxPolicy(value) {
  if (value === undefined) value = {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("process target sandboxPolicy must be an object");
  const keys = Object.keys(value);
  if (keys.some((key) => !["fsRead", "fsWrite", "memoryLimitMb"].includes(key)))
    throw new TypeError("process target sandboxPolicy contains unknown fields");
  const normalizePaths = (paths, label) => {
    if (paths === undefined) return Object.freeze([]);
    if (!Array.isArray(paths) || paths.length > MAX_PERMISSION_PATHS)
      throw new TypeError(`${label} must be a bounded array`);
    const normalized = paths.map((path) => {
      if (typeof path !== "string" || !isAbsolute(path))
        throw new TypeError(`${label} paths must be absolute`);
      return resolve(path);
    });
    if (new Set(normalized).size !== normalized.length)
      throw new TypeError(`${label} paths must be unique`);
    return Object.freeze(normalized);
  };
  const memoryLimitMb = value.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB;
  if (
    !Number.isSafeInteger(memoryLimitMb) ||
    memoryLimitMb < MIN_MEMORY_LIMIT_MB ||
    memoryLimitMb > MAX_MEMORY_LIMIT_MB
  )
    throw new TypeError("process target memoryLimitMb is out of bounds");
  return Object.freeze({
    fsRead: normalizePaths(value.fsRead, "sandboxPolicy.fsRead"),
    fsWrite: normalizePaths(value.fsWrite, "sandboxPolicy.fsWrite"),
    memoryLimitMb,
  });
}

function workerArguments(policy) {
  return Object.freeze([
    `--max-old-space-size=${policy.memoryLimitMb}`,
    "--permission",
    ...policy.fsRead.map((path) => `--allow-fs-read=${path}`),
    ...policy.fsWrite.map((path) => `--allow-fs-write=${path}`),
    WORKER,
  ]);
}

async function attest(core, purpose, authority) {
  const payloadDigest = buildEvolutionEvalAttestationDigest(core, purpose);
  const attestation = await authority({ purpose, payloadDigest });
  return Object.freeze({
    ...core,
    attestation: jsonClone(attestation, "attestation"),
  });
}

function processResult(child, input) {
  return new Promise((resolveResult, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let completionError = null;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (!completionError && Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) {
        completionError = new Error("evaluation target stdout exceeds 1 MiB");
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (!completionError && Buffer.byteLength(stderr) > MAX_OUTPUT_BYTES) {
        completionError = new Error("evaluation target stderr exceeds 1 MiB");
        child.kill("SIGKILL");
      }
    });
    child.once("error", rejectOnce);
    child.once("close", (code, signal) => {
      if (settled) return;
      if (completionError) {
        rejectOnce(completionError);
        return;
      }
      if (code !== 0) {
        rejectOnce(
          new Error(
            `evaluation target exited ${code ?? "null"}/${signal ?? "none"}: ${stderr.slice(0, 512)}`,
          ),
        );
        return;
      }
      try {
        const lines = stdout.trimEnd().split("\n");
        if (lines.length !== 1)
          throw new Error("target returned multiple records");
        const message = JSON.parse(lines[0]);
        if (message?.ok !== true || Object.keys(message).length !== 2)
          throw new Error("target returned an invalid record");
        settled = true;
        resolveResult(jsonClone(message.value, "evaluation target result"));
      } catch (cause) {
        rejectOnce(
          new Error("evaluation target response is invalid", { cause }),
        );
      }
    });
    child.stdin.once("error", (error) => {
      completionError ??= error;
    });
    child.stdin.end(JSON.stringify(input));
  });
}

export function createEvolutionEvalProcessSupervisor({
  targets,
  authorityDescriptor,
  supervisorRevision,
  invocationRevision,
  revocationRevision,
  attestSupervisor,
  attestInvocation,
  attestRevocation,
  verifyEnforcement,
  clock = Date.now,
  spawnProcess = (...args) => executionBroker.spawn(...args),
  fallbackSupervisor = null,
} = {}) {
  if (!(targets instanceof Map) || targets.size < 1 || targets.size > 256)
    throw new TypeError("process supervisor targets must be a bounded Map");
  if (
    typeof attestSupervisor !== "function" ||
    typeof attestInvocation !== "function" ||
    typeof attestRevocation !== "function" ||
    typeof verifyEnforcement !== "function" ||
    typeof clock !== "function" ||
    typeof spawnProcess !== "function"
  )
    throw new TypeError("process supervisor authority ports are required");
  if (typeof supervisorRevision !== "string" || supervisorRevision.length < 1)
    throw new TypeError("supervisorRevision is required");
  if (
    typeof invocationRevision !== "string" ||
    invocationRevision.length < 1 ||
    typeof revocationRevision !== "string" ||
    revocationRevision.length < 1
  )
    throw new TypeError("invocation and revocation revisions are required");
  const registry = new Map();
  for (const [handlerId, entry] of targets) {
    if (
      typeof handlerId !== "string" ||
      entry?.target?.handlerId !== handlerId ||
      entry.target.isolation !== "process" ||
      typeof entry.exportName !== "string" ||
      !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(entry.exportName) ||
      typeof entry.modulePath !== "string" ||
      !isAbsolute(entry.modulePath)
    )
      throw new TypeError(`process target is invalid: ${handlerId}`);
    digest(entry.target.handlerArtifactDigest, "target handlerArtifactDigest");
    const snapshot = moduleSnapshotSync(
      resolve(entry.modulePath),
      entry.target.handlerArtifactDigest,
    );
    registry.set(
      handlerId,
      Object.freeze({
        target: Object.freeze(structuredClone(entry.target)),
        exportName: entry.exportName,
        snapshot,
        sandboxPolicy: sandboxPolicy(entry.sandboxPolicy),
      }),
    );
  }
  const active = new Map();
  const processTargetDigests = new Set(
    [...registry.values()].map(({ target }) =>
      computeEvolutionEvalIsolatedTargetDigest(target),
    ),
  );
  if (
    fallbackSupervisor !== null &&
    (!fallbackSupervisor ||
      typeof fallbackSupervisor.run !== "function" ||
      typeof fallbackSupervisor.invokeTarget !== "function" ||
      typeof fallbackSupervisor.revokeTarget !== "function")
  )
    throw new TypeError("fallbackSupervisor contract is invalid");

  async function invocationEvidence(request, target, result, invokedAt) {
    const core = {
      schema: EVOLUTION_EVAL_TARGET_INVOCATION_SCHEMA,
      requestDigest: request.requestDigest,
      capabilityDigest: request.capabilityDigest,
      targetDigest: computeEvolutionEvalIsolatedTargetDigest(target),
      handlerArtifactDigest: target.handlerArtifactDigest,
      targetHandlerId: target.handlerId,
      targetRevision: target.handlerRevision,
      targetAuthorityDigest: computeEvolutionEvalTargetAuthorityDigest(target),
      operation: target.operation,
      invocationId: request.invocationId,
      invokedAt,
      completedAt: timestamp(clock),
      resultDigest: computeEvolutionEvalSupervisedResultDigest(result),
      authorityRevision: invocationRevision,
    };
    return attest(
      core,
      EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetInvocation,
      attestInvocation,
    );
  }

  async function revokeTarget(request) {
    if (!processTargetDigests.has(request.targetDigest)) {
      if (fallbackSupervisor) return fallbackSupervisor.revokeTarget(request);
      throw new Error("evaluation revocation target is not registered");
    }
    const running = active.get(request.capabilityDigest);
    const wasActive = Boolean(running);
    if (request.mode === "hard-terminate" && running) {
      running.child.kill("SIGKILL");
      await running.closed;
    }
    active.delete(request.capabilityDigest);
    const revokedAt = request.requestedAt;
    const core = {
      schema: EVOLUTION_EVAL_TARGET_REVOCATION_SCHEMA,
      requestDigest: request.requestDigest,
      capabilityDigest: request.capabilityDigest,
      targetDigest: request.targetDigest,
      invocationId: request.invocationId,
      mode: request.mode,
      requestedAt: request.requestedAt,
      revoked: true,
      wasActive,
      activeInvocationTerminated:
        request.mode === "hard-terminate" && wasActive,
      revokedAt,
      terminatedAt:
        request.mode === "hard-terminate" && wasActive ? revokedAt : null,
      authorityRevision: revocationRevision,
    };
    return attest(
      core,
      EVOLUTION_EVAL_ATTESTATION_PURPOSES.targetRevocation,
      attestRevocation,
    );
  }

  async function invokeTarget(request) {
    const entry = registry.get(request?.target?.handlerId);
    if (!entry) {
      if (fallbackSupervisor) return fallbackSupervisor.invokeTarget(request);
      throw new Error("evaluation target is not in the process registry");
    }
    if (canonical(entry.target) !== canonical(request.target))
      throw new Error(
        "evaluation target is not in the captured process registry",
      );
    if (active.has(request.capabilityDigest))
      throw new Error("evaluation capability is already active");
    await moduleSnapshot(entry.snapshot.physical, entry.snapshot.digest);
    const invokedAt = timestamp(clock);
    const child = spawnProcess(
      process.execPath,
      workerArguments(entry.sandboxPolicy),
      {
        cwd: dirname(entry.snapshot.physical),
        env: Object.freeze({}),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        origin: "evolution-eval-process-supervisor",
        reason: "Execute an attested evaluation target in a killable process",
      },
    );
    const closed = new Promise((resolveClose) =>
      child.once("close", (code, signal) => resolveClose({ code, signal })),
    );
    active.set(request.capabilityDigest, { child, closed });
    try {
      const value = await processResult(child, {
        moduleUrl: entry.snapshot.moduleUrl,
        exportName: entry.exportName,
        payload: request.payload,
      });
      await moduleSnapshot(entry.snapshot.physical, entry.snapshot.digest);
      return Object.freeze({
        value,
        evidence: await invocationEvidence(
          request,
          entry.target,
          value,
          invokedAt,
        ),
      });
    } finally {
      active.delete(request.capabilityDigest);
    }
  }

  async function supervisionReceipt(request, status, value, revocation) {
    const core = {
      schema: EVOLUTION_EVAL_SUPERVISION_SCHEMA,
      requestDigest: request.requestDigest,
      invocationNonce: request.invocationNonce,
      invocationId: request.invocationId,
      capabilityDigest: request.capabilityDigest,
      operation: request.operation,
      requestedAt: request.requestedAt,
      deadlineAt: request.deadlineAt,
      payloadDigest: request.payloadDigest,
      targetDigest: request.targetDigest,
      targetHandlerId: request.targetHandlerId,
      targetRevision: request.targetRevision,
      targetAuthorityDigest: request.targetAuthorityDigest,
      completedAt:
        status === "terminated" ? request.deadlineAt : timestamp(clock),
      status,
      isolation: "process",
      hardDeadlineEnforced: true,
      lateSideEffectsPrevented: true,
      invocationCount: 1,
      capabilityRevoked: true,
      resultDigest:
        status === "completed"
          ? computeEvolutionEvalSupervisedResultDigest(value)
          : null,
      targetInvocationDigest:
        status === "completed" ? revocation.targetInvocationDigest : null,
      revocationDigest: revocation.revocationDigest,
      revocationMode: revocation.revocationMode,
      wasActive: revocation.wasActive,
      activeInvocationTerminated: revocation.activeInvocationTerminated,
      terminatedAt: revocation.terminatedAt,
      supervisorRevision,
    };
    return attest(
      core,
      EVOLUTION_EVAL_ATTESTATION_PURPOSES.supervisor,
      attestSupervisor,
    );
  }

  const supervisor = Object.freeze({
    authorityDescriptor: Object.freeze(structuredClone(authorityDescriptor)),
    invokeTarget,
    revokeTarget,
    verifyEnforcement,
    async run(request, capability) {
      if (!registry.has(request.targetHandlerId)) {
        if (fallbackSupervisor)
          return fallbackSupervisor.run(request, capability);
        throw new Error("evaluation supervision target is not registered");
      }
      const remaining =
        new Date(request.deadlineAt).getTime() -
        new Date(timestamp(clock)).getTime();
      if (!Number.isFinite(remaining) || remaining <= 0)
        throw new Error("process supervision deadline is exhausted");
      let timer;
      const timeout = new Promise((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout({ timedOut: true }), remaining);
      });
      const invocation = Promise.resolve()
        .then(() => capability.invoke(Object.freeze({})))
        .then(
          (value) => ({ timedOut: false, value }),
          (error) => ({ timedOut: false, error }),
        );
      const result = await Promise.race([invocation, timeout]);
      clearTimeout(timer);
      if (result.timedOut) {
        const revocation = await capability.revoke({ mode: "hard-terminate" });
        await invocation;
        return {
          value: null,
          receipt: await supervisionReceipt(
            request,
            "terminated",
            null,
            revocation,
          ),
        };
      }
      if (result.error) throw result.error;
      const revocation = await capability.revoke({ mode: "completed-release" });
      return {
        value: result.value.value,
        receipt: await supervisionReceipt(
          request,
          "completed",
          result.value.value,
          {
            ...revocation,
            targetInvocationDigest: result.value.targetInvocationDigest,
          },
        ),
      };
    },
  });
  PROCESS_SUPERVISORS.add(supervisor);
  return supervisor;
}

export function isEvolutionEvalProcessSupervisor(value) {
  return PROCESS_SUPERVISORS.has(value);
}
