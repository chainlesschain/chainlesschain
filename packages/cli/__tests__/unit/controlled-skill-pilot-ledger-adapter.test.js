import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  CONTROLLED_SKILL_PILOT_STAGE,
  ControlledSkillProductionPilot,
  digestControlledSkillPilotDescriptor,
} from "../../src/lib/evolution/controlled-skill-production-pilot.js";
import {
  CONTROLLED_SKILL_PILOT_LEDGER_CONFLICT_CODE,
  CONTROLLED_SKILL_PILOT_LEDGER_EVENT_TYPE,
  ControlledSkillPilotLedgerAdapter,
} from "../../src/lib/evolution/controlled-skill-pilot-ledger-adapter.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";

const NOW = 1_000;
const TENANT_ID = "tenant-pilot-ledger";
const ARTIFACT_TENANT_ID = "artifact-tenant-pilot-ledger";
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return `sha256:${createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex")}`;
}

function signingAuthority(label) {
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://tests/pilot-ledger-${label}`,
    trustPolicyDigest: digest(`${label}-policy`),
  });
  const secret = `test-only-pilot-ledger-${label}-secret`;
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
  let nextDescriptor = -130_000;
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

function resources() {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-pilot-ledger-"),
  );
  roots.push(root);
  const now = Date.parse("2026-09-05T18:00:00.000Z");
  const artifactSecret = "test-only-pilot-artifact-secret";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/pilot-ledger-artifacts";
  const policyDigest = digest("pilot-ledger-artifact-policy");
  const sign = (message) =>
    createHmac("sha256", artifactSecret).update(message).digest("base64url");
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: path.join(root, "artifacts"),
      now: () => now,
    }),
    audience: "evolution-runtime",
    tenantId: ARTIFACT_TENANT_ID,
    now: () => now,
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
          checkedAt: "2026-09-05T18:00:00.000Z",
          decisionExpiresAt: "2026-09-05T18:01:00.000Z",
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
          receiptDigest: digest(
            `chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`,
          ),
        };
      },
    },
  });
  const resolver = artifactPorts.createEvolutionLedgerArtifactResolver({
    purpose: "evolution-ledger",
  });
  const witnessRoot = path.join(root, "witness");
  fs.mkdirSync(witnessRoot, { mode: 0o700 });
  return {
    artifactPorts,
    resolver,
    backendOptions: {
      rootDir: path.join(root, "ledger-events"),
      authorityRootDir: path.join(root, "ledger-authority"),
      witnessFilePath: path.join(witnessRoot, "checkpoint.json"),
      witnessId: "controlled-skill-pilot-ledger-witness",
      ledgerAuthority: signingAuthority("ledger"),
      witnessAuthority: signingAuthority("witness"),
      artifactResolver: resolver,
      fsImpl: durableFilesystem(),
      secure: false,
      clock: () => now,
    },
  };
}

function pilotDescriptor() {
  return {
    tenantId: TENANT_ID,
    pilotId: "pilot-ledger",
    skillName: "safe-refactor",
    candidateDigest: digest("candidate"),
    baselineDigest: digest("baseline"),
    evalReceiptDigest: digest("eval"),
    whyEvidenceDigest: digest("why"),
    candidateDiffDigest: digest("candidate-diff"),
    permissionDiffDigest: digest("permission-diff"),
    beforeEvaluationDigest: digest("before"),
    afterEvaluationDigest: digest("after"),
    reviewPacketDigest: digest("review"),
    cohort: {
      id: "cohort-pilot-ledger",
      optInRequired: true,
      maxSubjects: 3,
      canaryPercent: 100,
    },
    observation: {
      minSamples: 1,
      minWindowMs: 1,
      maxWindowMs: 1_000,
    },
    thresholds: {
      minAdoptionRate: 0.5,
      minSuccessDelta: 0,
      maxCostDelta: 0,
      maxUserRevisionRate: 0,
      maxMisPromotionRate: 0,
      maxRollbackRate: 0,
      maxSecurityEvents: 0,
    },
  };
}

function adapter(storage, ledger, descriptorDigest) {
  return new ControlledSkillPilotLedgerAdapter({
    descriptor: {
      tenantId: TENANT_ID,
      artifactTenantId: ARTIFACT_TENANT_ID,
      streamId: "controlled-pilot:ledger",
      pilotId: "pilot-ledger",
      skillName: "safe-refactor",
      descriptorDigest,
      audience: "evolution-runtime",
      purpose: "evolution-ledger",
    },
    artifactPorts: storage.artifactPorts,
    ledger,
    ledgerArtifactResolver: storage.resolver,
  });
}

function externalPorts(activeRef) {
  return {
    readActiveState: async () => activeRef.value,
    verifyApproval: async ({ descriptor, descriptorDigest }) => ({
      authenticated: true,
      durable: true,
      automated: false,
      tenantId: descriptor.tenantId,
      pilotId: descriptor.pilotId,
      packetDigest: descriptor.reviewPacketDigest,
      descriptorDigest,
      decision: "approved",
      receiptDigest: digest("approval"),
    }),
    verifyObservation: async (input) => ({
      ...input,
      authenticated: true,
      durable: true,
    }),
    transitionStage: async ({ request, requestDigest }) => {
      if (request.to === CONTROLLED_SKILL_PILOT_STAGE.ROLLED_BACK) {
        activeRef.value = { release: "last-known-good", revision: 2 };
      }
      return {
        authenticated: true,
        durable: true,
        descriptorDigest: request.descriptorDigest,
        requestDigest,
        from: request.from,
        to: request.to,
        receiptDigest: digest(`transition:${request.from}:${request.to}`),
        activeStateDigest: digest(activeRef.value),
      };
    },
  };
}

function subject({ ledgerAdapter, activeRef, restore = null }) {
  return new ControlledSkillProductionPilot({
    descriptor: pilotDescriptor(),
    ports: ledgerAdapter.pilotPorts(externalPorts(activeRef)),
    now: () => NOW,
    restore,
  });
}

describe("ControlledSkillPilotLedgerAdapter", () => {
  it("reopens a real kill-switch rollback and exports its Wiki source", async () => {
    const storage = resources();
    const firstBackend = createEvolutionLedgerFileBackend(
      storage.backendOptions,
    );
    const descriptorDigest =
      digestControlledSkillPilotDescriptor(pilotDescriptor());
    const firstAdapter = adapter(
      storage,
      firstBackend.ledger,
      descriptorDigest,
    );
    const activeRef = { value: { release: "baseline", revision: 1 } };
    const first = subject({ ledgerAdapter: firstAdapter, activeRef });
    await first.start({
      optedIn: true,
      tenantId: TENANT_ID,
      cohortId: "cohort-pilot-ledger",
    });
    await first.approveShadow({ approvalRef: "approval:pilot-ledger" });
    await first.engageKillSwitch({ reasonDigest: digest("kill-switch") });

    const reopenedBackend = createEvolutionLedgerFileBackend(
      storage.backendOptions,
    );
    const reopenedAdapter = adapter(
      storage,
      reopenedBackend.ledger,
      descriptorDigest,
    );
    const reopened = subject({
      ledgerAdapter: reopenedAdapter,
      activeRef,
      restore: reopenedAdapter.load(),
    });
    expect(reopened.view()).toMatchObject({
      stage: CONTROLLED_SKILL_PILOT_STAGE.ROLLED_BACK,
      revision: 5,
      killSwitch: true,
      reconciliationRequired: false,
    });
    await expect(reopened.createWikiOutcomeSource().list()).resolves.toEqual([
      expect.objectContaining({
        authenticated: true,
        durable: true,
        tenantId: TENANT_ID,
        pilotId: "pilot-ledger",
        skillName: "safe-refactor",
        outcome: "rollback",
      }),
    ]);
    expect(reopenedBackend.ledger.verify()).toMatchObject({ sequence: 5 });
    expect(reopenedBackend.ledger.read().map(({ type }) => type)).toEqual(
      Array.from({ length: 5 }, () => CONTROLLED_SKILL_PILOT_LEDGER_EVENT_TYPE),
    );
  });

  it("recovers an append response loss without duplicating Pilot state", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const descriptorProbe = subjectDescriptorDigest();
    let loseTransitionAck = false;
    const ledger = {
      read: backend.ledger.read.bind(backend.ledger),
      verify: backend.ledger.verify.bind(backend.ledger),
      appendDomainEvent(input, options) {
        const receipt = backend.ledger.appendDomainEvent(input, options);
        if (
          loseTransitionAck &&
          input.reason === "pilot.stage-transition-prepared committed"
        ) {
          loseTransitionAck = false;
          throw new Error("simulated Pilot ledger response loss");
        }
        return receipt;
      },
    };
    const ledgerAdapter = adapter(storage, ledger, descriptorProbe);
    const activeRef = { value: { release: "baseline", revision: 1 } };
    const pilot = subject({ ledgerAdapter, activeRef });
    await pilot.start({
      optedIn: true,
      tenantId: TENANT_ID,
      cohortId: "cohort-pilot-ledger",
    });
    loseTransitionAck = true;
    await pilot.approveShadow({ approvalRef: "approval:pilot-ledger" });
    expect(pilot.view()).toMatchObject({
      stage: CONTROLLED_SKILL_PILOT_STAGE.SHADOW,
      revision: 3,
    });
    expect(backend.ledger.verify()).toMatchObject({ sequence: 3 });
  });

  it("rejects a competing first revision from another active baseline", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const descriptorDigest = subjectDescriptorDigest();
    const first = subject({
      ledgerAdapter: adapter(storage, backend.ledger, descriptorDigest),
      activeRef: { value: { release: "baseline-a", revision: 1 } },
    });
    const competing = subject({
      ledgerAdapter: adapter(storage, backend.ledger, descriptorDigest),
      activeRef: { value: { release: "baseline-b", revision: 1 } },
    });
    await first.start({
      optedIn: true,
      tenantId: TENANT_ID,
      cohortId: "cohort-pilot-ledger",
    });
    await expect(
      competing.start({
        optedIn: true,
        tenantId: TENANT_ID,
        cohortId: "cohort-pilot-ledger",
      }),
    ).rejects.toMatchObject({
      code: CONTROLLED_SKILL_PILOT_LEDGER_CONFLICT_CODE,
    });
    expect(backend.ledger.verify()).toMatchObject({ sequence: 1 });
  });
});

function subjectDescriptorDigest() {
  return digestControlledSkillPilotDescriptor(pilotDescriptor());
}
