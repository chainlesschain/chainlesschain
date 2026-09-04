import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ArtifactStore } from "../../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../../src/lib/evolution/evolution-artifact-ports.js";
import { createEvolutionLedgerFileBackend } from "../../../src/lib/evolution/evolution-ledger-file-backend.js";
import { EvolutionReleaseTrainLedgerAdapter } from "../../../src/lib/evolution/evolution-release-train-ledger-adapter.js";
import {
  EVOLUTION_RELEASE_TRAIN_STAGES,
  createEvolutionPlan,
  createEvolutionReleaseTrain,
  createEvolutionTrainStageReceipt,
} from "../../../src/lib/evolution/evolution-release-train.js";

const [rootInput, operation = "run", crashStage = "none"] =
  process.argv.slice(2);
const root = path.resolve(rootInput);
const NOW = "2026-09-05T12:00:00.000Z";
const TENANT = "tenant-process";
const SKILL = "safe-refactor";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

const digest = (value) =>
  `sha256:${crypto
    .createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex")}`;
const domainDigest = (domain, value) =>
  digest(`${domain}\0${canonical(value)}`);

function signingAuthority(label) {
  const secret = `test-only-${label}-process-secret`;
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://process/${label}`,
    trustPolicyDigest: digest(`${label}-policy`),
  });
  const sign = (message) =>
    crypto.createHmac("sha256", secret).update(message).digest("base64url");
  return {
    trust,
    signer: { sign: ({ message }) => ({ ...trust, value: sign(message) }) },
    verifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === trust.algorithm &&
        signature.keyId === trust.keyId &&
        signature.trustPolicyDigest === trust.trustPolicyDigest &&
        signature.value === sign(message),
    },
  };
}

function durableFilesystem() {
  const directories = new Set();
  let nextDescriptor = -70_000;
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
          const descriptor = nextDescriptor--;
          directories.add(descriptor);
          return descriptor;
        }
        throw error;
      }
    },
  };
}

function artifactPorts() {
  const secret = "test-only-release-train-artifact-secret";
  const algorithm = "hmac-sha256";
  const keyId = "key://process/artifact";
  const policyDigest = digest("artifact-policy");
  const sign = (message) =>
    crypto.createHmac("sha256", secret).update(message).digest("base64url");
  return new EvolutionArtifactPorts({
    tenantId: TENANT,
    audience: "evolution-runtime",
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => Date.parse(NOW),
    }),
    envelopeSigner: {
      sign: ({ message }) => ({ algorithm, keyId, value: sign(message) }),
    },
    envelopeVerifier: {
      verify: ({ message, signature }) =>
        signature.algorithm === algorithm &&
        signature.keyId === keyId &&
        signature.value === sign(message),
    },
    currentAuthorityResolver: {
      resolve(request) {
        const core = {
          action: request.action,
          algorithm,
          allowed: true,
          audience: request.audience,
          checkedAt: NOW,
          decisionExpiresAt: "2026-09-05T12:01:00.000Z",
          digest: request.digest,
          issuedAt: request.issuedAt,
          issuedPolicyDigest: request.issuedPolicyDigest,
          issuedPolicyRevision: request.issuedPolicyRevision,
          issuedPolicyTrusted: true,
          keyId: request.keyId || keyId,
          policyDigest,
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
          receiptDigest: domainDigest(
            "chainlesschain.evolution-artifact-authority-decision/v1",
            core,
          ),
        };
      },
    },
    now: () => Date.parse(NOW),
  });
}

fs.mkdirSync(path.join(root, "witness"), { recursive: true });
const artifacts = artifactPorts();
const resolver = artifacts.createEvolutionLedgerArtifactResolver({
  purpose: "evolution-ledger",
});
const backend = createEvolutionLedgerFileBackend({
  rootDir: path.join(root, "ledger-events"),
  authorityRootDir: path.join(root, "ledger-authority"),
  witnessFilePath: path.join(root, "witness", "checkpoint.json"),
  witnessId: "release-train-process-witness",
  ledgerAuthority: signingAuthority("ledger"),
  witnessAuthority: signingAuthority("witness"),
  artifactResolver: resolver,
  fsImpl: durableFilesystem(),
  secure: false,
  clock: () => Date.parse(NOW),
});

if (operation === "init") {
  process.stdout.write(`${JSON.stringify({ ok: true, initialized: true })}\n`);
  process.exit(0);
}

const plan = createEvolutionPlan({
  tenantId: TENANT,
  skillId: SKILL,
  gitCommit: "a".repeat(40),
  baselineReleaseDigest: digest("baseline"),
  candidateDigest: digest("candidate"),
  wikiRevisionDigest: digest("wiki"),
  evalSuiteDigest: digest("eval"),
  targetMatrixDigest: digest("matrix"),
  riskTier: "low",
  rolloutPolicyDigest: digest("rollout"),
  metricPolicyDigest: digest("metrics"),
  permissionManifestDigest: digest("permissions"),
  policyDigest: digest("policy"),
  requestedCapabilityDigests: [digest("read")],
  baselineCapabilityDigests: [digest("read")],
  rootBudget: { tokens: 100, cost: 1, timeMs: 60_000, turns: 16 },
  expiresAt: "2030-01-01T00:00:00.000Z",
  triggerDigest: digest("trigger"),
});

const effectsDir = path.join(root, "stage-effects");
fs.mkdirSync(effectsDir, { recursive: true });
const stages = Object.fromEntries(
  EVOLUTION_RELEASE_TRAIN_STAGES.map((stage, index) => [
    stage,
    (context) => {
      const receipt = createEvolutionTrainStageReceipt({
        planDigest: context.plan.planDigest,
        stage,
        operationKey: context.operationKey,
        inputDigest: context.inputDigest,
        outputDigest: digest(`${context.plan.planDigest}:${stage}`),
        accepted: true,
        durable: true,
        usage: { tokens: 1, cost: 0.01, timeMs: 10, turns: 1 },
      });
      const effectPath = path.join(
        effectsDir,
        `${String(index).padStart(2, "0")}-${stage}.json`,
      );
      let created = false;
      try {
        fs.writeFileSync(effectPath, JSON.stringify(receipt), {
          encoding: "utf8",
          flag: "wx",
        });
        created = true;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const prior = JSON.parse(fs.readFileSync(effectPath, "utf8"));
        if (canonical(prior) !== canonical(receipt)) {
          throw new Error(`stage effect conflict: ${stage}`);
        }
      }
      if (created && crashStage === stage) process.exit(71 + index);
      return receipt;
    },
  ]),
);

const adapter = new EvolutionReleaseTrainLedgerAdapter({
  descriptor: {
    tenantId: TENANT,
    artifactTenantId: TENANT,
    skillName: SKILL,
    audience: "evolution-runtime",
    purpose: "evolution-ledger",
  },
  artifactPorts: artifacts,
  ledger: backend.ledger,
  ledgerArtifactResolver: resolver,
  clock: () => NOW,
});
const result = await createEvolutionReleaseTrain({
  plan,
  stateStore: adapter.createStateStore(),
  stages,
  clock: () => Date.parse(NOW),
}).run();
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    pid: process.pid,
    stateDigest: result.state.stateDigest,
    stageIndex: result.state.stageIndex,
    effectCount: fs.readdirSync(effectsDir).length,
    ledgerEventCount: backend.ledger.verify().eventCount,
  })}\n`,
);
