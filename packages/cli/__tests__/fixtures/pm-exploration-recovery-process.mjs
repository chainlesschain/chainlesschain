import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import { createEvolutionLedgerDurableArtifactResolver } from "../../src/lib/evolution/evolution-ledger-ports.js";
import { PmExplorationLedgerAdapter } from "../../src/lib/evolution/pm-exploration-ledger-adapter.js";
import {
  completePmExplorationRound,
  createPmExplorationJournal,
  createPmExplorationPlan,
  inspectPmExplorationJournal,
  startPmExplorationRound,
} from "../../src/lib/evolution/pm-exploration-rounds.js";
import { replicaAuthority } from "./skill-revocation-release-registry.js";

const NOW = Date.parse("2026-09-17T09:00:00.000Z");
const TENANT_ID = "tenant-pm-recovery-drill";
const ARTIFACT_TENANT_ID = "artifact-tenant-pm-recovery-drill";
const SUFFIX = /^[a-z0-9][a-z0-9-]{0,31}$/u;
const CRASH_PHASES = new Set([
  "after-retain",
  "after-segment-link",
  "after-segment",
  "after-anchor-link",
  "after-anchor",
  "after-witness",
  "after-head",
]);
const FAULT_PROFILES = new Map([
  ["artifact-erofs", "commit"],
  ["authority-retain-timeout", "commit"],
  ["authority-retain-reset", "commit"],
  ["authority-invalid-receipt", "commit"],
  ["authority-resolve-timeout", "verify"],
  ["ledger-enospc-after-segment", "commit"],
  ["ledger-enospc-after-witness", "commit"],
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function sha(value) {
  return `sha256:${createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex")}`;
}

function signingAuthority(label, secret) {
  if (typeof secret !== "string" || secret === "")
    throw new Error(`${label} drill secret is unavailable`);
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://pm-recovery-drill/${label}`,
    trustPolicyDigest: sha(`${label}-policy`),
  });
  const sign = (message) =>
    createHmac("sha256", secret).update(message).digest("base64url");
  return Object.freeze({
    trust,
    signer: Object.freeze({
      sign: ({ message }) => Object.freeze({ ...trust, value: sign(message) }),
    }),
    verifier: Object.freeze({
      verify: ({ message, signature }) =>
        signature.algorithm === trust.algorithm &&
        signature.keyId === trust.keyId &&
        signature.trustPolicyDigest === trust.trustPolicyDigest &&
        signature.value === sign(message),
    }),
  });
}

function durableFilesystem() {
  const directories = new Set();
  let nextDescriptor = -180_000;
  return {
    ...fs,
    constants: fs.constants,
    realpathSync: fs.realpathSync,
    closeSync(descriptor) {
      if (directories.delete(descriptor)) return;
      return fs.closeSync(descriptor);
    },
    fsyncSync(descriptor) {
      if (directories.has(descriptor)) return;
      try {
        return fs.fsyncSync(descriptor);
      } catch (error) {
        if (
          process.platform === "win32" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.fstatSync(descriptor).isDirectory()
        ) {
          return;
        }
        throw error;
      }
    },
    openSync(target, flags, mode) {
      try {
        return fs.openSync(target, flags, mode);
      } catch (error) {
        if (
          process.platform === "win32" &&
          flags === "r" &&
          ["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code) &&
          fs.statSync(target).isDirectory()
        ) {
          const descriptor = nextDescriptor;
          nextDescriptor -= 1;
          directories.add(descriptor);
          return descriptor;
        }
        throw error;
      }
    },
  };
}

function forcedExit(phase) {
  fs.writeSync(
    1,
    `${JSON.stringify({
      ok: false,
      forcedExit: true,
      phase,
      pid: process.pid,
    })}\n`,
  );
  process.exit(86);
}

function injectedFailure(code, message) {
  return Object.assign(new Error(message), { code });
}

function errorCodes(error) {
  const codes = [];
  const seen = new Set();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (typeof current.code === "string" && !codes.includes(current.code))
      codes.push(current.code);
    current = current.cause;
  }
  return codes;
}

function faultingAuthority(authority, fault) {
  if (fault === null) return authority;
  return {
    id: authority.id,
    retain(request) {
      if (fault === "authority-retain-timeout") {
        throw injectedFailure(
          "ETIMEDOUT",
          "fault injection: durability authority retain timed out",
        );
      }
      if (fault === "authority-retain-reset") {
        throw injectedFailure(
          "ECONNRESET",
          "fault injection: durability authority connection reset",
        );
      }
      const receipt = authority.retain(request);
      if (fault === "authority-invalid-receipt") {
        return { ...receipt, durable: false };
      }
      return receipt;
    },
    resolve(request) {
      if (fault === "authority-resolve-timeout") {
        throw injectedFailure(
          "ETIMEDOUT",
          "fault injection: durability authority resolve timed out",
        );
      }
      return authority.resolve(request);
    },
  };
}

function plan() {
  return createPmExplorationPlan({
    planId: "pm-recovery-drill-plan",
    suiteDigest: sha("suite"),
    trainingPartitionDigest: sha("training"),
    trainingTaskIds: ["train-project"],
    environmentDigest: sha("environment"),
    initialMemoryDigest: sha("initial-memory"),
    broadBranchIds: ["workflow"],
    maxRounds: 6,
    maxTokens: 10_000,
    maxToolCalls: 100,
    maxWallClockMs: 60_000,
    maxConsecutiveNoGain: 3,
  });
}

function completeBroad(journal, suffix) {
  const current = inspectPmExplorationJournal(journal).branchHeads[0];
  const round = startPmExplorationRound(journal, {
    roundId: `round-${suffix}`,
    stage: "broad",
    branchId: "workflow",
    taskId: "train-project",
    inputMemoryDigest: current.memoryDigest,
  });
  completePmExplorationRound(journal, round, {
    executionReceiptDigest: sha(`execution-${suffix}`),
    graderReceiptDigest: sha(`grader-${suffix}`),
    outputMemoryDigest: sha(`memory-${suffix}`),
    decision: "accept",
    metrics: { tokens: 100, toolCalls: 2, wallClockMs: 250 },
  });
}

function projection(evidence) {
  if (evidence === null) return null;
  return {
    authenticated: evidence.authenticated,
    durable: evidence.durable,
    authorityDurable: evidence.authorityDurable,
    powerLossDurabilityTested: evidence.powerLossDurabilityTested,
    revision: evidence.revision,
    snapshotDigest: evidence.snapshotDigest,
    stage: evidence.snapshot.stage,
    checkpointCount: evidence.snapshot.checkpoints.length,
    snapshotAuthenticated: evidence.snapshotAuthenticated,
    qualifiesForPromotion: evidence.qualifiesForPromotion,
  };
}

function waitForBarrier(barrier, suffix) {
  if (barrier === "-") return;
  const absolute = path.resolve(barrier);
  fs.writeFileSync(`${absolute}.${suffix}.ready`, `${process.pid}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  const signal = `${absolute}.go`;
  const startedAt = Date.now();
  while (!fs.existsSync(signal)) {
    if (Date.now() - startedAt > 30_000)
      throw new Error("PM recovery drill barrier timed out");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}

let activeFault = null;
try {
  const root = path.resolve(process.argv[2]);
  const mode = process.argv[3] ?? "verify";
  const phase = process.argv[4] === "-" ? null : process.argv[4];
  const suffix = process.argv[5] ?? "seed";
  const barrier = process.argv[6] ?? "-";
  const participant = process.argv[7] ?? suffix;
  const faultArgument = process.argv[8] ?? "-";
  const fault = faultArgument === "-" ? null : faultArgument;
  activeFault = fault;
  if (
    !["commit", "crash", "verify"].includes(mode) ||
    (mode === "crash" && !CRASH_PHASES.has(phase)) ||
    (mode !== "crash" && phase !== null) ||
    (fault !== null && FAULT_PROFILES.get(fault) !== mode) ||
    (mode === "crash" && fault !== null) ||
    !SUFFIX.test(suffix) ||
    !SUFFIX.test(participant)
  ) {
    throw new Error("invalid PM recovery process arguments");
  }
  const artifactSecret = process.env.CC_TEST_PM_ARTIFACT_SECRET;
  if (!artifactSecret) throw new Error("artifact drill secret is unavailable");
  const artifactSign = (message) =>
    createHmac("sha256", artifactSecret).update(message).digest("base64url");
  const artifactKeyId = "key://pm-recovery-drill/artifact";
  const artifactPolicyDigest = sha("artifact-policy");
  const artifactDir = path.join(root, "artifacts");
  const replicaDir = path.join(root, "durable-replica");
  const witnessDir = path.join(root, "witness");
  fs.mkdirSync(witnessDir, { recursive: true, mode: 0o700 });
  const artifactStoreOptions = {
    dir: artifactDir,
    now: () => NOW,
    ...(fault === "artifact-erofs"
      ? {
          indexLock() {
            throw injectedFailure(
              "EROFS",
              "fault injection: artifact store is read only",
            );
          },
        }
      : {}),
  };
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore(artifactStoreOptions),
    audience: "evolution-runtime",
    tenantId: ARTIFACT_TENANT_ID,
    now: () => NOW,
    envelopeSigner: {
      sign: ({ message }) => ({
        algorithm: "hmac-sha256",
        keyId: artifactKeyId,
        value: artifactSign(message),
      }),
    },
    envelopeVerifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === "hmac-sha256" &&
        signature.keyId === artifactKeyId &&
        signature.value === artifactSign(message),
    },
    currentAuthorityResolver: {
      resolve(request) {
        const core = {
          action: request.action,
          algorithm: "hmac-sha256",
          allowed: true,
          audience: request.audience,
          checkedAt: "2026-09-17T09:00:00.000Z",
          decisionExpiresAt: "2026-09-17T09:01:00.000Z",
          digest: request.digest,
          issuedAt: request.issuedAt,
          issuedPolicyDigest: request.issuedPolicyDigest,
          issuedPolicyRevision: request.issuedPolicyRevision,
          issuedPolicyTrusted: true,
          keyId: request.keyId || artifactKeyId,
          policyDigest: artifactPolicyDigest,
          policyRevision: 1,
          purpose: request.purpose,
          requestedAt: request.requestedAt,
          retention: request.retention,
          revocationRevision: 1,
          revoked: false,
          schema: EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
          tenantId: request.tenantId,
          type: request.type,
        };
        return {
          ...core,
          receiptDigest: sha(
            `chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`,
          ),
        };
      },
    },
  });
  const artifactDurabilityAuthority = faultingAuthority(
    replicaAuthority(
      replicaDir,
      phase === "after-retain"
        ? () => forcedExit(phase)
        : barrier === "-"
          ? null
          : () => waitForBarrier(barrier, participant),
    ),
    fault,
  );
  const ledgerArtifactResolver = createEvolutionLedgerDurableArtifactResolver({
    artifactPorts,
    artifactDurabilityAuthority,
    artifactTenantId: ARTIFACT_TENANT_ID,
    purpose: "evolution-ledger",
  });
  let observedFault = null;
  const backend = createEvolutionLedgerFileBackend({
    rootDir: path.join(root, "ledger-events"),
    authorityRootDir: path.join(root, "ledger-authority"),
    witnessFilePath: path.join(witnessDir, "checkpoint.json"),
    witnessId: "pm-recovery-drill-witness",
    ledgerAuthority: signingAuthority(
      "ledger",
      process.env.CC_TEST_PM_LEDGER_SECRET,
    ),
    witnessAuthority: signingAuthority(
      "witness",
      process.env.CC_TEST_PM_WITNESS_SECRET,
    ),
    artifactResolver: ledgerArtifactResolver,
    fsImpl: durableFilesystem(),
    secure: false,
    clock: () => NOW,
    crashHook(current) {
      if (mode === "crash" && phase !== "after-retain" && current === phase)
        forcedExit(phase);
      if (
        fault === "ledger-enospc-after-segment" &&
        current === "after-segment"
      ) {
        observedFault = {
          code: "ENOSPC",
          phase: current,
          profile: fault,
        };
        throw injectedFailure(
          "ENOSPC",
          "fault injection: no space after ledger segment",
        );
      }
      if (
        fault === "ledger-enospc-after-witness" &&
        current === "after-witness"
      ) {
        observedFault = {
          code: "ENOSPC",
          phase: current,
          profile: fault,
        };
        throw injectedFailure(
          "ENOSPC",
          "fault injection: no space after ledger witness",
        );
      }
    },
  });
  const boundPlan = plan();
  const adapter = new PmExplorationLedgerAdapter({
    descriptor: {
      tenantId: TENANT_ID,
      artifactTenantId: ARTIFACT_TENANT_ID,
      audience: "evolution-runtime",
      purpose: "evolution-ledger",
      planDigest: boundPlan.planDigest,
      durabilityAuthorityId: artifactDurabilityAuthority.id,
    },
    plan: boundPlan,
    artifactPorts,
    artifactDurabilityAuthority,
    ledger: backend.ledger,
    ledgerArtifactResolver,
    now: () => NOW,
  });
  let acknowledgement = null;
  if (mode !== "verify") {
    const journal = createPmExplorationJournal(boundPlan);
    completeBroad(journal, suffix);
    acknowledgement = adapter.commitJournal(journal);
    if (mode === "crash")
      throw new Error(
        "the requested crash phase did not terminate the process",
      );
  }
  const evidence = adapter.load();
  const verification = backend.ledger.verify();
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      pid: process.pid,
      mode,
      fault,
      observedFault,
      acknowledgement:
        acknowledgement === null
          ? null
          : {
              authenticated: acknowledgement.authenticated,
              durable: acknowledgement.durable,
              recovered: acknowledgement.recovered,
              revision: acknowledgement.revision,
              snapshotDigest: acknowledgement.snapshotDigest,
            },
      evidence: projection(evidence),
      ledgerSequence: verification.sequence,
      ledgerEventCount: verification.eventCount,
    })}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      pid: process.pid,
      fault: activeFault,
      code: error?.code ?? null,
      causeCodes: errorCodes(error),
      message: error?.message ?? String(error),
    })}\n`,
  );
  process.exitCode = 2;
}
