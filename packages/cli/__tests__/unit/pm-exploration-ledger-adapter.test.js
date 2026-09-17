import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ArtifactStore } from "../../src/lib/artifact-store.js";
import {
  EVOLUTION_ARTIFACT_AUTHORITY_DECISION_SCHEMA,
  EvolutionArtifactPorts,
} from "../../src/lib/evolution/evolution-artifact-ports.js";
import { createEvolutionLedgerFileBackend } from "../../src/lib/evolution/evolution-ledger-file-backend.js";
import { createEvolutionLedgerDurableArtifactResolver } from "../../src/lib/evolution/evolution-ledger-ports.js";
import {
  PM_EXPLORATION_LEDGER_CONFLICT_CODE,
  PmExplorationLedgerAdapter,
  capturePmExplorationLedgerStore,
} from "../../src/lib/evolution/pm-exploration-ledger-adapter.js";
import {
  completePmExplorationRound,
  createPmExplorationJournal,
  createPmExplorationPlan,
  enterPmExplorationDeepStage,
  freezePmExplorationMemory,
  inspectPmExplorationJournal,
  mergePmExplorationBroadBranches,
  startPmExplorationRound,
} from "../../src/lib/evolution/pm-exploration-rounds.js";
import { replicaAuthority } from "../fixtures/skill-revocation-release-registry.js";

const {
  inspectDesktopPmExplorationStorageHost,
  isDesktopPmExplorationStorageHost,
  loadDesktopEvolutionDependencies,
} = createRequire(import.meta.url)(
  "../../../../desktop-app-vue/src/main/evolution/desktop-evolution-deployment.js",
);

const TENANT_ID = "tenant-pm-exploration";
const ARTIFACT_TENANT_ID = "artifact-tenant-pm-exploration";
const NOW = Date.parse("2026-09-17T09:00:00.000Z");
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

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

function signingAuthority(label) {
  const trust = Object.freeze({
    algorithm: "hmac-sha256",
    keyId: `key://tests/pm-exploration-${label}`,
    trustPolicyDigest: sha(`${label}-policy`),
  });
  const secret = `test-only-pm-exploration-${label}-secret`;
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
  let nextDescriptor = -170_000;
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

function resources({ onRetain = null, onResolve = null } = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-pm-exploration-ledger-"),
  );
  roots.push(root);
  const artifactSecret = "test-only-pm-exploration-artifact-secret";
  const algorithm = "hmac-sha256";
  const keyId = "test:key/pm-exploration-artifacts";
  const policyDigest = sha("pm-exploration-artifact-policy");
  const sign = (message) =>
    createHmac("sha256", artifactSecret).update(message).digest("base64url");
  const artifactDir = path.join(root, "artifacts");
  const artifactPorts = new EvolutionArtifactPorts({
    artifactStore: new ArtifactStore({
      dir: artifactDir,
      now: () => NOW,
    }),
    audience: "evolution-runtime",
    tenantId: ARTIFACT_TENANT_ID,
    now: () => NOW,
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
          checkedAt: "2026-09-17T09:00:00.000Z",
          decisionExpiresAt: "2026-09-17T09:01:00.000Z",
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
          receiptDigest: sha(
            `chainlesschain.evolution-artifact-authority-decision/v1\0${canonical(core)}`,
          ),
        };
      },
    },
  });
  const replicaDir = path.join(root, "durable-replica");
  const replica = replicaAuthority(replicaDir, onRetain);
  const artifactDurabilityAuthority =
    onResolve === null
      ? replica
      : {
          id: replica.id,
          retain: (request) => replica.retain(request),
          resolve(request) {
            onResolve(request);
            return replica.resolve(request);
          },
        };
  const ledgerArtifactResolver = createEvolutionLedgerDurableArtifactResolver({
    artifactPorts,
    artifactDurabilityAuthority,
    artifactTenantId: ARTIFACT_TENANT_ID,
    purpose: "evolution-ledger",
  });
  const witnessRoot = path.join(root, "witness");
  fs.mkdirSync(witnessRoot, { mode: 0o700 });
  return {
    artifactDir,
    replicaDir,
    artifactPorts,
    artifactDurabilityAuthority,
    ledgerArtifactResolver,
    backendOptions: {
      rootDir: path.join(root, "ledger-events"),
      authorityRootDir: path.join(root, "ledger-authority"),
      witnessFilePath: path.join(witnessRoot, "checkpoint.json"),
      witnessId: "pm-exploration-ledger-witness",
      ledgerAuthority: signingAuthority("ledger"),
      witnessAuthority: signingAuthority("witness"),
      artifactResolver: ledgerArtifactResolver,
      fsImpl: durableFilesystem(),
      secure: false,
      clock: () => NOW,
    },
  };
}

function plan(overrides = {}) {
  return createPmExplorationPlan({
    planId: "pm-exploration-ledger-plan",
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
    ...overrides,
  });
}

function adapter(storage, ledger, boundPlan, options = {}) {
  return new PmExplorationLedgerAdapter({
    descriptor: {
      tenantId: TENANT_ID,
      artifactTenantId: ARTIFACT_TENANT_ID,
      audience: "evolution-runtime",
      purpose: "evolution-ledger",
      planDigest: boundPlan.planDigest,
      durabilityAuthorityId: storage.artifactDurabilityAuthority.id,
    },
    plan: boundPlan,
    artifactPorts: storage.artifactPorts,
    artifactDurabilityAuthority: storage.artifactDurabilityAuthority,
    ledger,
    ledgerArtifactResolver: storage.ledgerArtifactResolver,
    now: options.now ?? (() => NOW),
  });
}

function completeBroad(journal, suffix = "broad") {
  const current = inspectPmExplorationJournal(journal).branchHeads[0];
  const round = startPmExplorationRound(journal, {
    roundId: `round-${suffix}`,
    stage: "broad",
    branchId: "workflow",
    taskId: "train-project",
    inputMemoryDigest: current.memoryDigest,
  });
  return completePmExplorationRound(journal, round, {
    executionReceiptDigest: sha(`execution-${suffix}`),
    graderReceiptDigest: sha(`grader-${suffix}`),
    outputMemoryDigest: sha(`memory-${suffix}`),
    decision: "accept",
    metrics: { tokens: 100, toolCalls: 2, wallClockMs: 250 },
  });
}

function enterDeep(journal) {
  const merge = mergePmExplorationBroadBranches(journal, {
    mergeId: "merge-workflow",
    outputMemoryDigest: sha("merged-memory"),
    conflictResolutionReceiptDigest: sha("merge-receipt"),
  });
  return enterPmExplorationDeepStage(journal, merge.mergeDigest);
}

describe("PM exploration ledger adapter", () => {
  it("returns no restore state before the first durable commit", () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const boundPlan = plan();
    const store = adapter(storage, backend.ledger, boundPlan);
    expect(store.load()).toBeNull();
    expect(store.restoreLatestJournal()).toBeNull();
    expect(capturePmExplorationLedgerStore(store)).toMatchObject({
      load: expect.any(Function),
      commitJournal: expect.any(Function),
      restoreLatestJournal: expect.any(Function),
    });
    expect(() => capturePmExplorationLedgerStore({})).toThrow(/real/);
  });

  it("crosses the Desktop loader through the real capture as an opaque read-only host", async () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const boundPlan = plan();
    const pmAdapter = adapter(storage, backend.ledger, boundPlan);
    const dependencies = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async () => ({
          pmExplorationLedgerStore: pmAdapter,
        }),
      }),
      // Vitest evaluates this ESM file in its transform graph while the CJS
      // Desktop loader uses native import(). Inject the genuine capture from
      // this graph so both sides intentionally share the same WeakMap brand.
      importPmExplorationLedgerModule: async () => ({
        capturePmExplorationLedgerStore,
      }),
    });
    const host = dependencies.desktopPmExplorationStorageHost;
    expect(isDesktopPmExplorationStorageHost(host)).toBe(true);
    expect(Object.keys(host)).toEqual([]);
    expect(host.commitJournal).toBeUndefined();
    expect(inspectDesktopPmExplorationStorageHost(host)).toMatchObject({
      configured: true,
      readable: true,
      snapshotAvailable: false,
      durableSnapshotAvailable: false,
      qualifiesForPromotion: false,
    });

    const journal = createPmExplorationJournal(boundPlan);
    completeBroad(journal, "desktop-readonly");
    pmAdapter.commitJournal(journal);
    expect(inspectDesktopPmExplorationStorageHost(host)).toEqual({
      configured: true,
      readable: true,
      snapshotAvailable: true,
      snapshotAuthenticated: false,
      durableSnapshotAvailable: true,
      powerLossDurabilityTested: false,
      qualifiesForPromotion: false,
    });
  });

  it("commits and reopens a signed ledger anchor with artifact readback", () => {
    const storage = resources();
    const firstBackend = createEvolutionLedgerFileBackend(
      storage.backendOptions,
    );
    const boundPlan = plan();
    const first = adapter(storage, firstBackend.ledger, boundPlan);
    const journal = createPmExplorationJournal(boundPlan);
    completeBroad(journal);
    const acknowledgement = first.commitJournal(journal);
    expect(acknowledgement).toMatchObject({
      authenticated: true,
      durable: true,
      ledgerAuthenticated: true,
      ledgerDurable: true,
      artifactPersisted: true,
      artifactReadbackVerified: true,
      durabilityAuthorityId: storage.artifactDurabilityAuthority.id,
      authorityDurable: true,
      powerLossDurabilityTested: false,
      revision: 1,
      recovered: false,
      snapshotAuthenticated: false,
      qualifiesForPromotion: false,
    });

    const reopenedBackend = createEvolutionLedgerFileBackend(
      storage.backendOptions,
    );
    const reopened = adapter(storage, reopenedBackend.ledger, boundPlan);
    const restored = reopened.restoreLatestJournal();
    expect(restored.evidence).toMatchObject({
      authenticated: true,
      durable: true,
      ledgerAuthenticated: true,
      ledgerDurable: true,
      artifactPersisted: true,
      artifactReadbackVerified: true,
      durabilityAuthorityId: storage.artifactDurabilityAuthority.id,
      authorityDurable: true,
      powerLossDurabilityTested: false,
      revision: 1,
      snapshotAuthenticated: false,
      qualifiesForPromotion: false,
    });
    expect(inspectPmExplorationJournal(restored.journal)).toEqual(
      inspectPmExplorationJournal(journal),
    );
  });

  it("persists append-only progress and continues after a real reopen", () => {
    const storage = resources();
    const boundPlan = plan();
    const firstBackend = createEvolutionLedgerFileBackend(
      storage.backendOptions,
    );
    const first = adapter(storage, firstBackend.ledger, boundPlan);
    const journal = createPmExplorationJournal(boundPlan);
    expect(first.commitJournal(journal).revision).toBe(1);
    completeBroad(journal);
    expect(first.commitJournal(journal).revision).toBe(2);

    const reopenedBackend = createEvolutionLedgerFileBackend(
      storage.backendOptions,
    );
    const reopened = adapter(storage, reopenedBackend.ledger, boundPlan);
    const restored = reopened.restoreLatestJournal().journal;
    const entry = enterDeep(restored);
    const deepRound = startPmExplorationRound(restored, {
      roundId: "round-deep-after-reopen",
      stage: "deep",
      branchId: null,
      taskId: "train-project",
      inputMemoryDigest: entry.inputMemoryDigest,
    });
    completePmExplorationRound(restored, deepRound, {
      executionReceiptDigest: sha("execution-deep"),
      graderReceiptDigest: sha("grader-deep"),
      outputMemoryDigest: sha("memory-deep"),
      decision: "accept",
      metrics: { tokens: 50, toolCalls: 1, wallClockMs: 100 },
    });
    expect(reopened.commitJournal(restored)).toMatchObject({
      revision: 3,
      recovered: false,
    });
    expect(reopened.load().snapshot.stage).toBe("deep");
    expect(reopened.load().snapshot.checkpoints).toHaveLength(2);
  });

  it("treats an identical retry as recovered without duplicating history", () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const boundPlan = plan();
    const store = adapter(storage, backend.ledger, boundPlan);
    const journal = createPmExplorationJournal(boundPlan);
    const first = store.commitJournal(journal);
    const retry = store.commitJournal(journal);
    expect(retry).toMatchObject({ revision: 1, recovered: true });
    expect(retry.snapshotDigest).toBe(first.snapshotDigest);
    expect(
      backend.ledger
        .read()
        .filter((event) => event.correlationId === boundPlan.planDigest),
    ).toHaveLength(1);
  });

  it("recovers from the authority replica when the local artifact is missing", () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const boundPlan = plan();
    const store = adapter(storage, backend.ledger, boundPlan);
    store.commitJournal(createPmExplorationJournal(boundPlan));
    fs.rmSync(storage.artifactDir, { recursive: true, force: true });
    expect(store.load()).toMatchObject({
      authenticated: true,
      durable: true,
      authorityDurable: true,
      powerLossDurabilityTested: false,
      revision: 1,
    });
    fs.rmSync(storage.replicaDir, { recursive: true, force: true });
    expect(() => store.load()).toThrow();
  });

  it("fails closed when the authority is unavailable even if the local cache remains", () => {
    let unavailable = false;
    const storage = resources({
      onResolve() {
        if (unavailable) {
          throw Object.assign(new Error("authority timed out"), {
            code: "ETIMEDOUT",
          });
        }
      },
    });
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const boundPlan = plan();
    const store = adapter(storage, backend.ledger, boundPlan);
    store.commitJournal(createPmExplorationJournal(boundPlan));
    unavailable = true;
    expect(() => store.load()).toThrow(
      expect.objectContaining({
        code: "CC_EVOLUTION_LEDGER_PORTS_UNAVAILABLE",
      }),
    );
  });

  it("does not append a Ledger event when durability retention fails", () => {
    const storage = resources({
      onRetain() {
        throw new Error("simulated durability failure");
      },
    });
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const boundPlan = plan();
    const store = adapter(storage, backend.ledger, boundPlan);
    expect(() =>
      store.commitJournal(createPmExplorationJournal(boundPlan)),
    ).toThrow(/simulated durability failure/);
    expect(
      backend.ledger
        .read()
        .filter((event) => event.correlationId === boundPlan.planDigest),
    ).toHaveLength(0);
  });

  it("rejects a stale journal that would roll back committed checkpoints", () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const boundPlan = plan();
    const store = adapter(storage, backend.ledger, boundPlan);
    const current = createPmExplorationJournal(boundPlan);
    const stale = createPmExplorationJournal(boundPlan);
    store.commitJournal(current);
    completeBroad(current);
    store.commitJournal(current);
    expect(() => store.commitJournal(stale)).toThrow(
      expect.objectContaining({ code: PM_EXPLORATION_LEDGER_CONFLICT_CODE }),
    );
  });

  it("rejects active rounds and journals bound to another plan", () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const boundPlan = plan();
    const store = adapter(storage, backend.ledger, boundPlan);
    const active = createPmExplorationJournal(boundPlan);
    const head =
      inspectPmExplorationJournal(active).branchHeads[0].memoryDigest;
    startPmExplorationRound(active, {
      roundId: "round-active-persistence",
      stage: "broad",
      branchId: "workflow",
      taskId: "train-project",
      inputMemoryDigest: head,
    });
    expect(() => store.commitJournal(active)).toThrow(/Active rounds/);

    const anotherPlan = plan({ planId: "pm-exploration-another-plan" });
    const foreign = createPmExplorationJournal(anotherPlan);
    expect(() => store.commitJournal(foreign)).toThrow(
      expect.objectContaining({ code: PM_EXPLORATION_LEDGER_CONFLICT_CODE }),
    );
  });

  it("persists a frozen snapshot without converting it into promotion proof", () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const boundPlan = plan();
    const store = adapter(storage, backend.ledger, boundPlan);
    const journal = createPmExplorationJournal(boundPlan);
    completeBroad(journal);
    const entry = enterDeep(journal);
    const round = startPmExplorationRound(journal, {
      roundId: "round-deep-freeze-ledger",
      stage: "deep",
      branchId: null,
      taskId: "train-project",
      inputMemoryDigest: entry.inputMemoryDigest,
    });
    const checkpoint = completePmExplorationRound(journal, round, {
      executionReceiptDigest: sha("execution-freeze"),
      graderReceiptDigest: sha("grader-freeze"),
      outputMemoryDigest: sha("memory-freeze"),
      decision: "accept",
      metrics: { tokens: 50, toolCalls: 1, wallClockMs: 100 },
    });
    freezePmExplorationMemory(journal, {
      finalMemoryDigest: checkpoint.effectiveMemoryDigest,
      evaluatorReceiptDigest: sha("evaluator-freeze"),
    });
    store.commitJournal(journal);
    const loaded = store.load();
    expect(loaded.snapshot.stage).toBe("frozen");
    expect(loaded.authenticated).toBe(true);
    expect(loaded.snapshot.authenticated).toBe(false);
    expect(loaded.snapshot.frozen.authenticated).toBe(false);
    expect(loaded.qualifiesForPromotion).toBe(false);
  });

  it("rejects descriptor accessors, plan mismatches and unbranded resolvers", () => {
    const storage = resources();
    const backend = createEvolutionLedgerFileBackend(storage.backendOptions);
    const boundPlan = plan();
    const descriptor = {
      tenantId: TENANT_ID,
      artifactTenantId: ARTIFACT_TENANT_ID,
      audience: "evolution-runtime",
      purpose: "evolution-ledger",
      planDigest: boundPlan.planDigest,
      durabilityAuthorityId: storage.artifactDurabilityAuthority.id,
    };
    Object.defineProperty(descriptor, "tenantId", {
      enumerable: true,
      get: () => TENANT_ID,
    });
    expect(
      () =>
        new PmExplorationLedgerAdapter({
          descriptor,
          plan: boundPlan,
          artifactPorts: storage.artifactPorts,
          artifactDurabilityAuthority: storage.artifactDurabilityAuthority,
          ledger: backend.ledger,
          ledgerArtifactResolver: storage.ledgerArtifactResolver,
        }),
    ).toThrow(/data field/);

    expect(
      () =>
        new PmExplorationLedgerAdapter({
          descriptor: {
            tenantId: TENANT_ID,
            artifactTenantId: ARTIFACT_TENANT_ID,
            audience: "evolution-runtime",
            purpose: "evolution-ledger",
            planDigest: sha("wrong-plan"),
            durabilityAuthorityId: storage.artifactDurabilityAuthority.id,
          },
          plan: boundPlan,
          artifactPorts: storage.artifactPorts,
          artifactDurabilityAuthority: storage.artifactDurabilityAuthority,
          ledger: backend.ledger,
          ledgerArtifactResolver: storage.ledgerArtifactResolver,
        }),
    ).toThrow(/differs/);

    expect(
      () =>
        new PmExplorationLedgerAdapter({
          descriptor: {
            tenantId: TENANT_ID,
            artifactTenantId: ARTIFACT_TENANT_ID,
            audience: "evolution-runtime",
            purpose: "evolution-ledger",
            planDigest: boundPlan.planDigest,
            durabilityAuthorityId: storage.artifactDurabilityAuthority.id,
          },
          plan: boundPlan,
          artifactPorts: storage.artifactPorts,
          artifactDurabilityAuthority: storage.artifactDurabilityAuthority,
          ledger: backend.ledger,
          ledgerArtifactResolver: () => null,
        }),
    ).toThrow(/branded/);

    const otherDurabilityAuthority = replicaAuthority(
      path.join(path.dirname(storage.replicaDir), "other-durable-replica"),
    );
    expect(
      () =>
        new PmExplorationLedgerAdapter({
          descriptor: {
            tenantId: TENANT_ID,
            artifactTenantId: ARTIFACT_TENANT_ID,
            audience: "evolution-runtime",
            purpose: "evolution-ledger",
            planDigest: boundPlan.planDigest,
            durabilityAuthorityId: otherDurabilityAuthority.id,
          },
          plan: boundPlan,
          artifactPorts: storage.artifactPorts,
          artifactDurabilityAuthority: otherDurabilityAuthority,
          ledger: backend.ledger,
          ledgerArtifactResolver: storage.ledgerArtifactResolver,
        }),
    ).toThrow(/differs/);

    expect(
      () =>
        new PmExplorationLedgerAdapter({
          descriptor: {
            tenantId: TENANT_ID,
            artifactTenantId: ARTIFACT_TENANT_ID,
            audience: "evolution-runtime",
            purpose: "evolution-ledger",
            planDigest: boundPlan.planDigest,
            durabilityAuthorityId: storage.artifactDurabilityAuthority.id,
          },
          plan: boundPlan,
          artifactPorts: storage.artifactPorts,
          artifactDurabilityAuthority: storage.artifactDurabilityAuthority,
          ledger: {
            read: () => [],
            verify: () => ({}),
            appendDomainEvent: () => ({}),
          },
          ledgerArtifactResolver: storage.ledgerArtifactResolver,
        }),
    ).toThrow(/exact instance/);
  });
});
