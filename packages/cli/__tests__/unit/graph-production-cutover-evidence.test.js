import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GRAPH_MINIMUM_SHADOW_OBSERVATION_MS,
  GRAPH_PRODUCTION_EVIDENCE_WORKFLOW,
  GRAPH_REQUIRED_CUTOVER_STAGES,
  GRAPH_REQUIRED_ROLLBACK_DRILLS,
  GRAPH_REQUIRED_SHADOW_DIMENSIONS,
  createGraphProductionCutoverReceipt,
  normalizeGraphProductionCutoverEvidence,
} from "../../src/lib/graph-kernel/production-cutover-evidence.js";
import {
  GRAPH_PRODUCTION_RAW_LOG_SCHEMA,
  GRAPH_PRODUCTION_SOURCE_ENVIRONMENT,
  GRAPH_PRODUCTION_SOURCE_RECEIPT_SCHEMA,
  GRAPH_PRODUCTION_SOURCE_REF,
  GRAPH_PRODUCTION_SOURCE_REGISTRY_SCHEMA,
  GRAPH_PRODUCTION_SOURCE_WORKFLOW,
  graphProductionRawEventDigest,
  graphProductionRawLogMerkleRoot,
  graphProductionSourceRegistryDigest,
  normalizeGraphProductionSourceRegistry,
  signGraphProductionSourceReceipt,
} from "../../src/lib/graph-kernel/production-source-evidence.js";
import {
  assertBoundedAggregateBytes,
  assertBoundedSourceReceiptBytes,
  assertStableFileIdentity,
  assembleGraphProductionCutoverEvidence,
  stageGraphProductionSourceReceipts,
  writeNewAggregateFile,
} from "../../scripts/assemble-graph-production-cutover-evidence.mjs";
import { validateCurrentGraphProductionSourceJob } from "../../scripts/collect-graph-production-source-receipts.mjs";
import { freezeGraphProductionInput } from "../../scripts/freeze-graph-production-inputs.mjs";
import { queryGraphProductionJobs } from "../../scripts/query-graph-production-jobs.mjs";
import { selectGraphProductionArtifact } from "../../scripts/select-graph-production-artifact.mjs";
import { verifyGraphProductionAttestationCertificate } from "../../scripts/verify-graph-production-attestation-certificate.mjs";
import {
  assertGraphProductionRuntimeSurfaceManifest,
  graphRuntimeEntryManifestDigest,
  graphRuntimeSurfaceManifestDigest,
  loadGraphRuntimeSurfaceManifest,
} from "../../src/lib/graph-kernel/runtime-surface-manifest.js";

const COMMIT = "a".repeat(40);
const REPOSITORY = "chainlesschain/chainlesschain";
const RUN_ID = 1234;
const RUN_ATTEMPT = 2;
const CHALLENGE = createHash("sha256")
  .update("hosted-current-run-challenge")
  .digest("base64url");
const NOW_MS = Date.parse("2026-09-01T00:10:00.000Z");
const OBSERVATION_BASE_MS = Date.parse("2026-08-31T18:00:00.000Z");
const COLLECTOR_STARTED_AT = "2026-09-01T00:00:00.000Z";
const COLLECTOR_ENDED_AT = "2026-09-01T00:02:00.000Z";
const manifest = loadGraphRuntimeSurfaceManifest();
const manifestDigest = graphRuntimeSurfaceManifestDigest(manifest);
const PLATFORMS = ["linux", "macos", "windows"];
const ZERO_DIGEST = `sha256:${"0".repeat(64)}`;

function digestText(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function iso(value) {
  return new Date(value).toISOString();
}

function legacyErrorCode(surface) {
  return manifest.cutoverPolicy.legacyMutationErrorCodes[surface.originSurface];
}

function mutationProbes(surface, entry) {
  return [...entry.mutationFunctions].sort().map((mutationFunction) => ({
    mutationFunction,
    attemptCount: 3,
    blockedCount: 3,
    successCount: 0,
    errorCode: legacyErrorCode(surface),
  }));
}

function shadowPayload(durationMs = GRAPH_MINIMUM_SHADOW_OBSERVATION_MS) {
  const startedAt = Date.parse("2026-08-31T19:00:00.000Z");
  return {
    startedAt: iso(startedAt),
    endedAt: iso(startedAt + durationMs),
    durationMs,
    monotonicDurationMs: durationMs,
    runCount: 12,
    divergenceCount: 0,
    unknownEffectCount: 0,
    realEffectInvocationCount: 0,
    comparisons: [...GRAPH_REQUIRED_SHADOW_DIMENSIONS]
      .sort()
      .map((dimension) => ({
        dimension,
        status: "equivalent",
        sampleCount: 12,
      })),
  };
}

function canaryPayload() {
  const startedAt = Date.parse("2026-08-31T19:30:00.000Z");
  const durationMs = 60 * 60 * 1_000;
  return {
    startedAt: iso(startedAt),
    endedAt: iso(startedAt + durationMs),
    durationMs,
    monotonicDurationMs: durationMs,
    internalRunCount: 3,
    optInRunCount: 3,
    defaultRunCount: 6,
    failureCount: 0,
    reconciliationCount: 0,
    platformJourneys: PLATFORMS.map((platform) => ({
      platform,
      commitSha: COMMIT,
      status: "passed",
    })),
  };
}

function rollbackPayload() {
  return {
    observedAt: "2026-08-31T21:32:00.000Z",
    drills: [...GRAPH_REQUIRED_ROLLBACK_DRILLS].sort().map((transition) => ({
      transition,
      status: "passed",
      activeDispatchCount: 0,
      rpoLossCount: 0,
      duplicateEffectCount: 0,
      existingCanonicalRunsRetained: transition !== "shadow_to_legacy",
    })),
  };
}

function finalLedgerPayload() {
  return {
    stage: "legacy_read_only",
    canonicalCommitSha: COMMIT,
    canonicalActivatedAt: "2026-08-31T21:33:00.000Z",
    eventHead: digestText("final-ledger-head"),
    rollbackCount: 3,
    transitionCount: 10,
  };
}

function writerPayload(surface, entry) {
  const durationMs = 60 * 60 * 1_000;
  return {
    startedAt: "2026-08-31T21:34:00.000Z",
    endedAt: "2026-08-31T22:34:00.000Z",
    durationMs,
    monotonicDurationMs: durationMs,
    observationSampleCount: 12,
    activeLegacyRunCount: 0,
    legacyMutationSuccessCount: 0,
    writerObservations: [...entry.writerFiles].sort().map((writerFile) => ({
      writerFile,
      observationSampleCount: 12,
      mutationSuccessCount: 0,
    })),
    mutationProbes: mutationProbes(surface, entry),
  };
}

function retirementPayload(surface, entry) {
  const durationMs = 60 * 60 * 1_000;
  return {
    startedAt: "2026-08-31T20:31:00.000Z",
    endedAt: "2026-08-31T21:31:00.000Z",
    durationMs,
    monotonicDurationMs: durationMs,
    observationSampleCount: 12,
    activeLegacyRunCount: 0,
    legacyMutationSuccessCount: 0,
    replacementJourneys: [...entry.replacementEntryIds]
      .sort()
      .flatMap((replacementEntryId) =>
        PLATFORMS.map((platform) => ({
          replacementEntryId,
          productEntrypoint: entry.replacementEntrypoint,
          platform,
          commitSha: COMMIT,
          status: "passed",
        })),
      ),
    mutationProbes: mutationProbes(surface, entry),
    historicalReadProbes: [...entry.historicalReadFunctions]
      .sort()
      .map((historicalReadFunction) => ({
        historicalReadFunction,
        status: "passed",
        readCount: 3,
        mutationAttemptCount: 0,
      })),
  };
}

function eventPayloads(surface, entry, options) {
  if (entry.cutoverStrategy === "disabled") {
    return [
      {
        type: "disabled_probe",
        payload: {
          observedAt: "2026-08-31T22:35:00.000Z",
          runtimeDurability: "non_durable",
          featureFlagDefault: "disabled",
          directEngineInvocationCount: 0,
          durableAuthorityClaimCount: 0,
        },
      },
    ];
  }
  const events = [
    {
      type: "shadow_observation",
      payload: shadowPayload(options.shadowDurationMs),
    },
    { type: "canary_observation", payload: canaryPayload() },
  ];
  if (entry.cutoverStrategy === "retire") {
    events.push({
      type: "retirement_observation",
      payload: retirementPayload(surface, entry),
    });
  }
  events.push(
    { type: "rollback_observation", payload: rollbackPayload() },
    { type: "final_ledger_observation", payload: finalLedgerPayload() },
    {
      type: "legacy_writer_observation",
      payload: writerPayload(surface, entry),
    },
  );
  return events;
}

function eventWallTime(type, payload) {
  if (
    [
      "shadow_observation",
      "canary_observation",
      "retirement_observation",
      "legacy_writer_observation",
    ].includes(type)
  ) {
    return payload.endedAt;
  }
  if (type === "final_ledger_observation") {
    return payload.canonicalActivatedAt;
  }
  return payload.observedAt;
}

function rawLog(source, surface, entry, options) {
  let previousEventDigest = ZERO_DIGEST;
  const events = eventPayloads(surface, entry, options).map(
    ({ type, payload }, index) => {
      const wallTime = eventWallTime(type, payload);
      const event = {
        sequence: index + 1,
        wallTime,
        monotonicMs: Date.parse(wallTime) - OBSERVATION_BASE_MS,
        type,
        payload,
        previousEventDigest,
      };
      event.eventDigest = graphProductionRawEventDigest(event, source.sourceId);
      previousEventDigest = event.eventDigest;
      return event;
    },
  );
  return {
    schema: GRAPH_PRODUCTION_RAW_LOG_SCHEMA,
    bootIdDigest: digestText(`${source.sourceId}/boot`),
    events,
    chainHead: events.at(-1).eventDigest,
    merkleRoot: graphProductionRawLogMerkleRoot(
      events.map((event) => event.eventDigest),
    ),
  };
}

function productionFixture(options = {}) {
  const privateKeys = new Map();
  const sources = PLATFORMS.map((platform, index) => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyBytes = publicKey.export({ type: "spki", format: "der" });
    const sourceId = `physical-${platform}-graph-source`;
    privateKeys.set(sourceId, privateKey);
    return {
      sourceId,
      platform,
      sourceKind: "physical_self_hosted_runner",
      enabled: true,
      validFrom: "2026-08-01T00:00:00.000Z",
      validUntil: "2026-09-30T00:00:00.000Z",
      keyId: digestText(publicKeyBytes),
      publicKeySpki: publicKeyBytes.toString("base64url"),
      hardwareIdentityDigest: digestText(`fixture-hardware-${platform}`),
      operatorIdentityDigest: digestText(`fixture-operator-${platform}`),
      attester: {
        identityDigest: digestText(`fixture-attester-${platform}`),
        measurementDigest: digestText("fixture-reviewed-attester-measurement"),
        logAuthorityDigest: digestText(`fixture-log-authority-${platform}`),
      },
      runner: {
        registrationId: 1001 + index,
        name: `graph-${platform}-physical-01`,
        labels: [
          "graph-kernel-production",
          platform,
          "physical",
          "self-hosted",
          "x64",
        ].sort(),
      },
      collector: {
        endpoint: `https://collector.invalid/graph/${platform}`,
        credentialDigest: digestText(`fixture-token-${platform}`),
      },
    };
  });
  const unsignedRegistry = {
    schema: GRAPH_PRODUCTION_SOURCE_REGISTRY_SCHEMA,
    repository: REPOSITORY,
    ref: GRAPH_PRODUCTION_SOURCE_REF,
    workflow: GRAPH_PRODUCTION_SOURCE_WORKFLOW,
    environment: GRAPH_PRODUCTION_SOURCE_ENVIRONMENT,
    manifestDigest,
    sources,
  };
  const sourceRegistry = {
    ...unsignedRegistry,
    registryDigest: graphProductionSourceRegistryDigest(unsignedRegistry),
  };
  const jobsInventory = {
    apiTotalCount: sources.length,
    workflowRunId: RUN_ID,
    workflowRunAttempt: RUN_ATTEMPT,
    headSha: COMMIT,
    jobs: sources.map((source, index) => ({
      id: 2001 + index,
      run_id: RUN_ID,
      run_attempt: RUN_ATTEMPT,
      head_sha: COMMIT,
      name: `Collect signed ${source.platform} source receipts`,
      status: "completed",
      conclusion: "success",
      runner_id: source.runner.registrationId,
      runner_name: source.runner.name,
      labels: [
        "self-hosted",
        source.platform === "macos"
          ? "macOS"
          : source.platform[0].toUpperCase() + source.platform.slice(1),
        "physical",
        "graph-kernel-production",
      ],
      started_at: "2026-08-31T23:55:00Z",
      completed_at: "2026-09-01T00:05:00Z",
    })),
  };
  const receipts = [];
  for (const surface of manifest.surfaces) {
    for (const entry of surface.entries) {
      for (const [sourceIndex, source] of sources.entries()) {
        const payload = {
          schema: GRAPH_PRODUCTION_SOURCE_RECEIPT_SCHEMA,
          sourceId: source.sourceId,
          platform: source.platform,
          keyId: source.keyId,
          registryDigest: sourceRegistry.registryDigest,
          manifestDigest,
          entryManifestDigest: graphRuntimeEntryManifestDigest(
            manifest,
            surface.originSurface,
            entry.id,
          ),
          surface: surface.originSurface,
          entryId: entry.id,
          commitSha: COMMIT,
          repository: REPOSITORY,
          ref: GRAPH_PRODUCTION_SOURCE_REF,
          workflow: GRAPH_PRODUCTION_SOURCE_WORKFLOW,
          workflowRunId: RUN_ID,
          workflowRunAttempt: RUN_ATTEMPT,
          workflowJob: "source",
          workflowJobDatabaseId: 2001 + sourceIndex,
          runner: clone(source.runner),
          hardwareIdentityDigest: source.hardwareIdentityDigest,
          operatorIdentityDigest: source.operatorIdentityDigest,
          attester: clone(source.attester),
          challenge: CHALLENGE,
          nonce: createHash("sha256")
            .update(`${source.sourceId}/${surface.originSurface}/${entry.id}`)
            .digest("base64url"),
          collectorStartedAt: COLLECTOR_STARTED_AT,
          collectorEndedAt: COLLECTOR_ENDED_AT,
          collectorMonotonicElapsedMs: 120_000,
          rawLog: rawLog(source, surface, entry, options),
        };
        receipts.push(
          signGraphProductionSourceReceipt(
            payload,
            privateKeys.get(source.sourceId),
          ),
        );
      }
    }
  }
  return {
    receipts,
    sourceRegistry,
    jobsInventory,
    privateKeys,
    verification: {
      sourceRegistry,
      expectedRegistryDigest: sourceRegistry.registryDigest,
      challenge: CHALLENGE,
      commitSha: COMMIT,
      repository: REPOSITORY,
      workflowRunId: RUN_ID,
      workflowRunAttempt: RUN_ATTEMPT,
      jobsInventory,
      manifest,
      clock: () => NOW_MS,
    },
  };
}

function assembleFixture(fixture) {
  return assembleGraphProductionCutoverEvidence(
    fixture.receipts,
    fixture.verification,
  );
}

function resign(fixture, receipt) {
  return signGraphProductionSourceReceipt(
    receipt.payload,
    fixture.privateKeys.get(receipt.payload.sourceId),
  );
}

function rebindFixtureRegistry(fixture, { updateKeyIds = false } = {}) {
  fixture.sourceRegistry.registryDigest = graphProductionSourceRegistryDigest(
    fixture.sourceRegistry,
  );
  fixture.verification.expectedRegistryDigest =
    fixture.sourceRegistry.registryDigest;
  fixture.receipts = fixture.receipts.map((receipt) => {
    receipt.payload.registryDigest = fixture.sourceRegistry.registryDigest;
    if (updateKeyIds) {
      const source = fixture.sourceRegistry.sources.find(
        (candidate) => candidate.sourceId === receipt.payload.sourceId,
      );
      receipt.payload.keyId = source.keyId;
    }
    return resign(fixture, receipt);
  });
}

describe("Graph production cutover signed source contract", () => {
  it("derives the frozen 5/23/20/7/13/3 aggregate from 69 current-run receipts", () => {
    const fixture = productionFixture();
    const evidence = assembleFixture(fixture);
    expect(evidence.entries).toHaveLength(20);
    expect(evidence.disabledEntries).toHaveLength(3);
    expect(evidence.sourceFragments).toHaveLength(23);
    expect(evidence.provenance.sourceRegistryDigest).toBe(
      fixture.sourceRegistry.registryDigest,
    );
    expect(evidence.provenance.challenge).toBe(CHALLENGE);
    const receipt = createGraphProductionCutoverReceipt(
      evidence,
      fixture.verification,
    );
    expect(receipt).toEqual(
      expect.objectContaining({
        status: "passed",
        surfaceCount: 5,
        durableEntryCount: 20,
        migratedEntryCount: 7,
        retiredEntryCount: 13,
        disabledEntryCount: 3,
        observationSourceCount: 69,
        distinctObservationSourceCount: 3,
      }),
    );
  }, 30_000);

  it("rejects forged raw metrics, future collectors, hosts, registry pins, and job identity", () => {
    const forgedMetric = productionFixture();
    forgedMetric.receipts[0].payload.rawLog.events[0].payload.runCount += 1;
    expect(() => assembleFixture(forgedMetric)).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_PRODUCTION_RAW_EVENT_DIGEST_MISMATCH",
      }),
    );

    const future = productionFixture();
    future.receipts[0].payload.collectorStartedAt = "2026-09-01T00:20:00.000Z";
    future.receipts[0].payload.collectorEndedAt = "2026-09-01T00:22:00.000Z";
    future.receipts[0] = resign(future, future.receipts[0]);
    expect(() => assembleFixture(future)).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_PRODUCTION_SOURCE_CLOCK_INVALID",
      }),
    );

    const forgedHost = productionFixture();
    forgedHost.receipts[0].payload.runner.name = "unregistered-runner";
    forgedHost.receipts[0] = resign(forgedHost, forgedHost.receipts[0]);
    expect(() => assembleFixture(forgedHost)).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_PRODUCTION_SOURCE_BINDING_MISMATCH",
      }),
    );

    const wrongRegistry = productionFixture();
    wrongRegistry.verification.expectedRegistryDigest = digestText("wrong");
    expect(() => assembleFixture(wrongRegistry)).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_PRODUCTION_SOURCE_REGISTRY_DIGEST_MISMATCH",
      }),
    );

    const wrongJob = productionFixture();
    wrongJob.jobsInventory.jobs[0].run_id = RUN_ID + 1;
    expect(() => assembleFixture(wrongJob)).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_PRODUCTION_JOB_BINDING_MISMATCH",
      }),
    );

    const truncatedJobs = productionFixture();
    truncatedJobs.jobsInventory.apiTotalCount += 1;
    expect(() => assembleFixture(truncatedJobs)).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_PRODUCTION_JOB_INVENTORY_INVALID",
      }),
    );
  }, 30_000);

  it("rejects replayed nonces, short signed windows, and non-manifest error codes", () => {
    const replay = productionFixture();
    replay.receipts[3].payload.nonce = replay.receipts[0].payload.nonce;
    replay.receipts[3] = resign(replay, replay.receipts[3]);
    expect(() => assembleFixture(replay)).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_PRODUCTION_SOURCE_REPLAYED" }),
    );

    const shortWindow = productionFixture({
      shadowDurationMs: GRAPH_MINIMUM_SHADOW_OBSERVATION_MS - 1_000,
    });
    expect(() => assembleFixture(shortWindow)).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_PRODUCTION_OBSERVATION_TOO_SHORT",
      }),
    );

    const wrongError = productionFixture();
    for (const receipt of wrongError.receipts.slice(0, 3)) {
      const raw = receipt.payload.rawLog;
      const writer = raw.events.find(
        (event) => event.type === "legacy_writer_observation",
      );
      for (const probe of writer.payload.mutationProbes) {
        probe.errorCode = "CC_FAKE_READ_ONLY";
      }
      let previousEventDigest = ZERO_DIGEST;
      for (const event of raw.events) {
        event.previousEventDigest = previousEventDigest;
        event.eventDigest = graphProductionRawEventDigest(
          event,
          receipt.payload.sourceId,
        );
        previousEventDigest = event.eventDigest;
      }
      raw.chainHead = previousEventDigest;
      raw.merkleRoot = graphProductionRawLogMerkleRoot(
        raw.events.map((event) => event.eventDigest),
      );
      const index = wrongError.receipts.indexOf(receipt);
      wrongError.receipts[index] = resign(wrongError, receipt);
    }
    expect(() => assembleFixture(wrongError)).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_PRODUCTION_LEGACY_ERROR_CODE_MISMATCH",
      }),
    );
  }, 30_000);

  it("fails closed for revoked, expired, or rotated registry keys", () => {
    const revoked = productionFixture();
    revoked.sourceRegistry.sources[0].enabled = false;
    revoked.sourceRegistry.registryDigest = graphProductionSourceRegistryDigest(
      revoked.sourceRegistry,
    );
    revoked.verification.expectedRegistryDigest =
      revoked.sourceRegistry.registryDigest;
    expect(() => assembleFixture(revoked)).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_PRODUCTION_SOURCE_KEY_INACTIVE",
      }),
    );

    const expired = productionFixture();
    expired.sourceRegistry.sources[0].validUntil = "2026-08-31T23:00:00.000Z";
    rebindFixtureRegistry(expired);
    expect(() => assembleFixture(expired)).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_PRODUCTION_JOB_BINDING_MISMATCH",
      }),
    );

    const rotated = productionFixture();
    const replacement = generateKeyPairSync("ed25519").publicKey.export({
      type: "spki",
      format: "der",
    });
    rotated.sourceRegistry.sources[0].publicKeySpki =
      replacement.toString("base64url");
    rotated.sourceRegistry.sources[0].keyId = digestText(replacement);
    rebindFixtureRegistry(rotated, { updateKeyIds: true });
    expect(() => assembleFixture(rotated)).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_PRODUCTION_SOURCE_SIGNATURE_INVALID",
      }),
    );
  }, 30_000);

  it("requires one stable boot per source and independent collector custody", () => {
    const changedBoot = productionFixture();
    changedBoot.receipts[3].payload.rawLog.bootIdDigest =
      digestText("replacement-boot");
    changedBoot.receipts[3] = resign(changedBoot, changedBoot.receipts[3]);
    expect(() => assembleFixture(changedBoot)).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_PRODUCTION_SOURCE_CROSS_CHECK_FAILED",
      }),
    );

    for (const mutate of [
      (registry) => {
        registry.sources[1].collector.endpoint =
          registry.sources[0].collector.endpoint;
      },
      (registry) => {
        registry.sources[1].collector.endpoint += "?tenant=untrusted";
      },
      (registry) => {
        registry.sources[1].collector.credentialDigest =
          registry.sources[0].collector.credentialDigest;
      },
      (registry) => {
        registry.sources[1].operatorIdentityDigest =
          registry.sources[0].operatorIdentityDigest;
      },
      (registry) => {
        registry.sources[1].hardwareIdentityDigest =
          registry.sources[0].hardwareIdentityDigest;
      },
      (registry) => {
        registry.sources[1].attester.identityDigest =
          registry.sources[0].attester.identityDigest;
      },
      (registry) => {
        registry.sources[1].attester.logAuthorityDigest =
          registry.sources[0].attester.logAuthorityDigest;
      },
    ]) {
      const fixture = productionFixture();
      mutate(fixture.sourceRegistry);
      fixture.sourceRegistry.registryDigest =
        graphProductionSourceRegistryDigest(fixture.sourceRegistry);
      expect(() =>
        normalizeGraphProductionSourceRegistry(fixture.sourceRegistry, {
          expectedRepository: REPOSITORY,
          expectedManifestDigest: manifestDigest,
          expectedRegistryDigest: fixture.sourceRegistry.registryDigest,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "CC_GRAPH_PRODUCTION_SOURCE_REGISTRY_INVALID",
        }),
      );
    }
  }, 30_000);

  it("freezes the production manifest and keeps the checked-in registry fail-closed", () => {
    const changedManifest = clone(manifest);
    changedManifest.surfaces[0].entries.pop();
    expect(() =>
      assertGraphProductionRuntimeSurfaceManifest(changedManifest),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_PRODUCTION_MANIFEST_CONTRACT_MISMATCH",
      }),
    );

    const registry = JSON.parse(
      fs.readFileSync(
        fileURLToPath(
          new URL(
            "../../../../.github/graph-kernel-production-source-registry.json",
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    );
    expect(registry.sources).toHaveLength(0);
    expect(() =>
      normalizeGraphProductionSourceRegistry(registry, {
        expectedRepository: REPOSITORY,
        expectedManifestDigest: manifestDigest,
        expectedRegistryDigest: registry.registryDigest,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "CC_GRAPH_PRODUCTION_SOURCE_COVERAGE_INCOMPLETE",
      }),
    );
  });
});

function makeReceiptDirectory(
  base,
  { oversized = false, hardlinked = false } = {},
) {
  const source = path.join(base, "source");
  fs.mkdirSync(source, { mode: 0o700 });
  const count = hardlinked ? 68 : 69;
  for (let index = 0; index < count; index += 1) {
    fs.writeFileSync(
      path.join(source, `receipt-${String(index).padStart(2, "0")}.json`),
      oversized && index === 0 ? Buffer.alloc(512 * 1024 + 1, 65) : "{}",
      { mode: 0o400 },
    );
  }
  if (hardlinked) {
    fs.linkSync(
      path.join(source, "receipt-00.json"),
      path.join(source, "receipt-68.json"),
    );
  }
  if (process.platform !== "win32") fs.chmodSync(source, 0o500);
  return source;
}

describe("Graph source artifact filesystem boundary", () => {
  it("rejects traversal, symlinks, hardlinks, oversized inputs, and replacement", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "graph-source-test-"));
    try {
      const source = makeReceiptDirectory(base);
      const traversal = `${base}${path.sep}missing${path.sep}..${path.sep}source`;
      expect(() =>
        stageGraphProductionSourceReceipts({
          sourceArtifacts: traversal,
          stagingRoot: path.join(base, "traversal-stage"),
        }),
      ).toThrowError();

      try {
        const link = path.join(base, "source-link");
        fs.symlinkSync(
          source,
          link,
          process.platform === "win32" ? "junction" : "dir",
        );
        expect(() =>
          stageGraphProductionSourceReceipts({
            sourceArtifacts: link,
            stagingRoot: path.join(base, "symlink-stage"),
          }),
        ).toThrowError();
      } catch (error) {
        if (error?.code !== "EPERM") throw error;
      }

      const oversizeBase = fs.mkdtempSync(path.join(base, "oversize-"));
      const oversized = makeReceiptDirectory(oversizeBase, { oversized: true });
      expect(() =>
        stageGraphProductionSourceReceipts({
          sourceArtifacts: oversized,
          stagingRoot: path.join(oversizeBase, "stage"),
        }),
      ).toThrowError();

      const hardlinkBase = fs.mkdtempSync(path.join(base, "hardlink-"));
      const hardlinked = makeReceiptDirectory(hardlinkBase, {
        hardlinked: true,
      });
      expect(() =>
        stageGraphProductionSourceReceipts({
          sourceArtifacts: hardlinked,
          stagingRoot: path.join(hardlinkBase, "stage"),
        }),
      ).toThrowError();

      expect(() =>
        assertStableFileIdentity(
          {
            dev: 1,
            ino: 2,
            size: 3,
            mtimeMs: 4,
            ctimeMs: 5,
            mode: 6,
            nlink: 1,
          },
          {
            dev: 1,
            ino: 2,
            size: 3,
            mtimeMs: 4,
            ctimeMs: 6,
            mode: 6,
            nlink: 1,
          },
          "replaced.json",
        ),
      ).toThrowError();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("enforces total input/output limits and refuses output replacement", () => {
    expect(() =>
      assertBoundedSourceReceiptBytes(36 * 1024 * 1024 + 1),
    ).toThrowError();
    expect(() =>
      assertBoundedAggregateBytes(64 * 1024 * 1024 + 1),
    ).toThrowError();
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "graph-output-test-"));
    try {
      const output = path.join(base, "evidence.json");
      fs.writeFileSync(output, "existing", { mode: 0o600 });
      expect(() => writeNewAggregateFile("{}\n", output)).toThrowError();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("Graph Actions and attestation trust boundary", () => {
  it("validates the current physical source job with real API label casing", () => {
    const fixture = productionFixture();
    const source = fixture.sourceRegistry.sources[0];
    const job = {
      ...clone(fixture.jobsInventory.jobs[0]),
      status: "in_progress",
      conclusion: null,
      completed_at: null,
    };
    const current = {
      apiTotalCount: 6,
      fetchedJobCount: 6,
      workflowRunId: RUN_ID,
      workflowRunAttempt: RUN_ATTEMPT,
      headSha: COMMIT,
      job,
    };
    expect(
      validateCurrentGraphProductionSourceJob(current, {
        platform: source.platform,
        commitSha: COMMIT,
        workflowRunId: RUN_ID,
        workflowRunAttempt: RUN_ATTEMPT,
        source,
      }),
    ).toEqual(expect.objectContaining({ id: job.id }));

    const forgedRunner = clone(current);
    forgedRunner.job.runner_id += 1;
    expect(() =>
      validateCurrentGraphProductionSourceJob(forgedRunner, {
        platform: source.platform,
        commitSha: COMMIT,
        workflowRunId: RUN_ID,
        workflowRunAttempt: RUN_ATTEMPT,
        source,
      }),
    ).toThrowError();

    const missingRoutingLabel = clone(current);
    missingRoutingLabel.job.labels = missingRoutingLabel.job.labels.filter(
      (label) => label !== "physical",
    );
    expect(() =>
      validateCurrentGraphProductionSourceJob(missingRoutingLabel, {
        platform: source.platform,
        commitSha: COMMIT,
        workflowRunId: RUN_ID,
        workflowRunAttempt: RUN_ATTEMPT,
        source,
      }),
    ).toThrowError();
  });

  it("merges bounded Jobs API pages and rejects repeated job ids", async () => {
    const pageBodies = [
      { total_count: 3, jobs: [{ id: 11 }, { id: 12 }] },
      { total_count: 3, jobs: [{ id: 13 }] },
    ];
    const fetchImpl = async (url) => {
      const page = Number(new URL(url).searchParams.get("page"));
      const body = JSON.stringify(pageBodies[page - 1]);
      return new Response(body, {
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body)),
        },
      });
    };
    const queried = await queryGraphProductionJobs({
      apiUrl: "https://api.github.com",
      token: "test-token",
      repository: REPOSITORY,
      runId: RUN_ID,
      runAttempt: RUN_ATTEMPT,
      headSha: COMMIT,
      fetchImpl,
    });
    expect(queried.apiTotalCount).toBe(3);
    expect(queried.jobs.map((job) => job.id)).toEqual([11, 12, 13]);

    pageBodies[1].jobs[0].id = 12;
    await expect(
      queryGraphProductionJobs({
        apiUrl: "https://api.github.com",
        token: "test-token",
        repository: REPOSITORY,
        runId: RUN_ID,
        runAttempt: RUN_ATTEMPT,
        headSha: COMMIT,
        fetchImpl,
      }),
    ).rejects.toThrowError(/repeated/u);
  });

  it("selects one attempt artifact and rejects truncation, replay, and expiry", () => {
    const run = {
      id: RUN_ID,
      run_attempt: RUN_ATTEMPT,
      head_sha: COMMIT,
      run_started_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:10:00Z",
    };
    const artifact = {
      id: 991,
      name: `graph-production-cutover-evidence-${RUN_ATTEMPT}`,
      expired: false,
      created_at: "2026-09-01T00:08:00Z",
      updated_at: "2026-09-01T00:09:00Z",
      workflow_run: { id: RUN_ID, head_sha: COMMIT },
    };
    const options = {
      expectedName: artifact.name,
      expectedRunId: RUN_ID,
      expectedRunAttempt: RUN_ATTEMPT,
      expectedCommitSha: COMMIT,
    };
    expect(
      selectGraphProductionArtifact(
        [{ total_count: 1, artifacts: [artifact] }],
        run,
        options,
      ).id,
    ).toBe(artifact.id);
    expect(() =>
      selectGraphProductionArtifact(
        [{ total_count: 2, artifacts: [artifact] }],
        run,
        options,
      ),
    ).toThrowError(/truncated/u);
    expect(() =>
      selectGraphProductionArtifact(
        [{ total_count: 2, artifacts: [artifact, clone(artifact)] }],
        run,
        options,
      ),
    ).toThrowError(/duplicate ids/u);
    expect(() =>
      selectGraphProductionArtifact(
        [
          {
            total_count: 2,
            artifacts: [artifact, { ...clone(artifact), id: 993 }],
          },
        ],
        run,
        options,
      ),
    ).toThrowError(/exactly one/u);
    const unrelated = {
      ...clone(artifact),
      id: 992,
      name: "unrelated-attempt-artifact",
    };
    expect(() =>
      selectGraphProductionArtifact(
        [
          { total_count: 2, artifacts: [artifact] },
          { total_count: 1, artifacts: [unrelated] },
        ],
        run,
        options,
      ),
    ).toThrowError(/total_count changed/u);
    expect(() =>
      selectGraphProductionArtifact(
        [
          { total_count: 2, artifacts: [artifact] },
          {
            total_count: 2,
            artifacts: [{ ...unrelated, id: artifact.id }],
          },
        ],
        run,
        options,
      ),
    ).toThrowError(/duplicate ids/u);
    expect(() =>
      selectGraphProductionArtifact(
        [{ total_count: 1, artifacts: [artifact] }, null],
        run,
        options,
      ),
    ).toThrowError(/invalid shape/u);
    const expired = clone(artifact);
    expired.expired = true;
    expect(() =>
      selectGraphProductionArtifact(
        [{ total_count: 1, artifacts: [expired] }],
        run,
        options,
      ),
    ).toThrowError();
    const wrongAttempt = clone(run);
    wrongAttempt.run_attempt += 1;
    expect(() =>
      selectGraphProductionArtifact(
        [{ total_count: 1, artifacts: [artifact] }],
        wrongAttempt,
        options,
      ),
    ).toThrowError();
  });

  it("binds one hosted certificate and a fresh trusted timestamp", () => {
    const run = {
      id: RUN_ID,
      run_attempt: RUN_ATTEMPT,
      head_sha: COMMIT,
      path: GRAPH_PRODUCTION_EVIDENCE_WORKFLOW,
      event: "workflow_dispatch",
      conclusion: "success",
      head_branch: "main",
      run_started_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:10:00Z",
    };
    const artifact = {
      id: 991,
      name: `graph-production-cutover-evidence-${RUN_ATTEMPT}`,
      expired: false,
      created_at: "2026-09-01T00:08:00Z",
      updated_at: "2026-09-01T00:09:00Z",
      workflow_run: { id: RUN_ID, head_sha: COMMIT },
    };
    const repositoryUrl = `https://github.com/${REPOSITORY}`;
    const signer = `${repositoryUrl}/${GRAPH_PRODUCTION_EVIDENCE_WORKFLOW}@refs/heads/main`;
    const expected = {
      serverUrl: "https://github.com",
      repository: REPOSITORY,
      workflow: GRAPH_PRODUCTION_EVIDENCE_WORKFLOW,
      commitSha: COMMIT,
      runId: RUN_ID,
      runAttempt: RUN_ATTEMPT,
      run,
      artifact,
    };
    const result = {
      verificationResult: {
        signature: {
          certificate: {
            certificateIssuer: "CN=Fulcio Intermediate l2,O=GitHub, Inc.",
            issuer: "https://token.actions.githubusercontent.com",
            subjectAlternativeName: signer,
            runnerEnvironment: "github-hosted",
            sourceRepositoryURI: repositoryUrl,
            sourceRepositoryRef: "refs/heads/main",
            sourceRepositoryDigest: COMMIT,
            buildSignerURI: signer,
            buildSignerDigest: COMMIT,
            buildTrigger: "workflow_dispatch",
            runInvocationURI: `${repositoryUrl}/actions/runs/${RUN_ID}/attempts/${RUN_ATTEMPT}`,
          },
        },
        verifiedTimestamps: [
          {
            type: "TimestampAuthority",
            uri: "https://timestamp.github.com",
            timestamp: "2026-09-01T00:07:00Z",
          },
        ],
      },
    };
    const clock = () => Date.parse("2027-08-31T00:00:00Z");
    const verified = verifyGraphProductionAttestationCertificate(
      [result],
      expected,
      { clock },
    );
    expect(verified.trustedTimestamp).toBe("2026-09-01T00:07:00.000Z");
    expect(() =>
      verifyGraphProductionAttestationCertificate([], expected, { clock }),
    ).toThrowError();
    expect(() =>
      verifyGraphProductionAttestationCertificate(
        [result, clone(result)],
        expected,
        { clock },
      ),
    ).toThrowError(/exactly one/u);

    for (const mutate of [
      (candidate) => {
        candidate.verificationResult.signature.certificate.runInvocationURI = `${repositoryUrl}/actions/runs/${RUN_ID}/attempts/99`;
      },
      (candidate) => {
        candidate.verificationResult.signature.certificate.sourceRepositoryRef =
          "refs/heads/feature";
      },
      (candidate) => {
        candidate.verificationResult.signature.certificate.buildSignerDigest =
          "b".repeat(40);
      },
      (candidate) => {
        candidate.verificationResult.verifiedTimestamps = [];
      },
      (candidate) => {
        candidate.verificationResult.verifiedTimestamps[0].timestamp =
          "2026-09-01T00:20:00Z";
      },
    ]) {
      const forged = clone(result);
      mutate(forged);
      expect(() =>
        verifyGraphProductionAttestationCertificate([forged], expected, {
          clock,
        }),
      ).toThrowError();
    }
    expect(() =>
      verifyGraphProductionAttestationCertificate([result], expected, {
        clock: () => Date.parse("2027-09-10T00:00:00Z"),
      }),
    ).toThrowError();
  });

  it("freezes only canonical non-hardlinked trust input files", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "graph-freeze-test-"));
    try {
      const file = path.join(base, "input.json");
      fs.writeFileSync(file, "{}\n", { mode: 0o600 });
      expect(freezeGraphProductionInput(file)).toBe(file);
      if (process.platform !== "win32") {
        expect(fs.lstatSync(file).mode & 0o222).toBe(0);
      }
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("runs the close verifier CLI with read-only trusted files and producer time", () => {
    const fixture = productionFixture();
    const evidence = assembleFixture(fixture);
    const run = {
      id: RUN_ID,
      run_attempt: RUN_ATTEMPT,
      head_sha: COMMIT,
      path: GRAPH_PRODUCTION_EVIDENCE_WORKFLOW,
      event: "workflow_dispatch",
      conclusion: "success",
      head_branch: "main",
      run_started_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:10:00Z",
    };
    const artifact = {
      id: 992,
      name: `graph-production-cutover-evidence-${RUN_ATTEMPT}`,
      expired: false,
      created_at: "2026-09-01T00:08:00Z",
      updated_at: "2026-09-01T00:09:00Z",
      workflow_run: { id: RUN_ID, head_sha: COMMIT },
    };
    const repositoryUrl = `https://github.com/${REPOSITORY}`;
    const signer = `${repositoryUrl}/${GRAPH_PRODUCTION_EVIDENCE_WORKFLOW}@refs/heads/main`;
    const attestation = [
      {
        verificationResult: {
          signature: {
            certificate: {
              certificateIssuer: "CN=Fulcio Intermediate l2,O=GitHub, Inc.",
              issuer: "https://token.actions.githubusercontent.com",
              subjectAlternativeName: signer,
              runnerEnvironment: "github-hosted",
              sourceRepositoryURI: repositoryUrl,
              sourceRepositoryRef: "refs/heads/main",
              sourceRepositoryDigest: COMMIT,
              buildSignerURI: signer,
              buildSignerDigest: COMMIT,
              buildTrigger: "workflow_dispatch",
              runInvocationURI: `${repositoryUrl}/actions/runs/${RUN_ID}/attempts/${RUN_ATTEMPT}`,
            },
          },
          verifiedTimestamps: [
            {
              type: "TimestampAuthority",
              uri: "https://timestamp.github.com",
              timestamp: "2026-09-01T00:07:00Z",
            },
          ],
        },
      },
    ];
    const base = fs.mkdtempSync(
      path.join(os.tmpdir(), "graph-cli-close-test-"),
    );
    const files = {
      evidence: path.join(base, "evidence.json"),
      jobs: path.join(base, "jobs.json"),
      run: path.join(base, "run.json"),
      artifact: path.join(base, "artifact.json"),
      attestation: path.join(base, "attestation.json"),
      output: path.join(base, "receipt.json"),
    };
    const manifestPath = fileURLToPath(
      new URL(
        "../../src/lib/graph-kernel/graph-runtime-surfaces.json",
        import.meta.url,
      ),
    );
    const originalManifestMode = fs.lstatSync(manifestPath).mode;
    try {
      for (const [name, value] of [
        ["evidence", evidence],
        ["jobs", fixture.jobsInventory],
        ["run", run],
        ["artifact", artifact],
        ["attestation", attestation],
      ]) {
        fs.writeFileSync(files[name], `${JSON.stringify(value)}\n`, {
          mode: 0o400,
        });
        if (process.platform !== "win32") fs.chmodSync(files[name], 0o400);
      }
      if (process.platform !== "win32") fs.chmodSync(manifestPath, 0o400);
      const cli = fileURLToPath(
        new URL(
          "../../scripts/graph-production-cutover-evidence.mjs",
          import.meta.url,
        ),
      );
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          `data:text/javascript,Date.now=()=>${NOW_MS}`,
          cli,
          "--evidence",
          files.evidence,
          "--expected-commit",
          COMMIT,
          "--expected-repository",
          REPOSITORY,
          "--expected-workflow",
          GRAPH_PRODUCTION_EVIDENCE_WORKFLOW,
          "--expected-environment",
          "graph-kernel-production",
          "--expected-run-id",
          String(RUN_ID),
          "--expected-run-attempt",
          String(RUN_ATTEMPT),
          "--expected-registry-digest",
          fixture.sourceRegistry.registryDigest,
          "--jobs-inventory",
          files.jobs,
          "--attestation-verification",
          files.attestation,
          "--producer-run",
          files.run,
          "--selected-artifact",
          files.artifact,
          "--server-url",
          "https://github.com",
          "--output",
          files.output,
        ],
        { encoding: "utf8", timeout: 30_000 },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(fs.readFileSync(files.output, "utf8")).status).toBe(
        "passed",
      );
    } finally {
      if (process.platform !== "win32") {
        fs.chmodSync(manifestPath, originalManifestMode & 0o777);
      }
      fs.rmSync(base, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("Graph producer and close workflow boundary", () => {
  it("uses hosted challenge/aggregate, three physical jobs, fixed registry, and aggregate-only OIDC", () => {
    const producer = fs.readFileSync(
      fileURLToPath(
        new URL(
          "../../../../.github/workflows/graph-kernel-production-evidence.yml",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    const close = fs.readFileSync(
      fileURLToPath(
        new URL(
          "../../../../.github/workflows/graph-kernel-production-cutover.yml",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    expect(producer).toContain("Generate a hosted current-run challenge");
    expect(producer).toContain("runs-on: ubuntu-latest");
    expect(producer).toContain(
      "graph-kernel-production-evidence-authoritative",
    );
    expect(producer).toContain("cancel-in-progress: true");
    expect(producer).toContain('--ref-protected "${{ github.ref_protected }}"');
    expect(
      (producer.match(/node scripts\/verify-github-live-main\.mjs/gu) || [])
        .length,
    ).toBeGreaterThanOrEqual(5);
    expect(producer).toContain(
      "Collect signed ${{ matrix.platform }} source receipts",
    );
    expect(producer).toContain("graph-kernel-production-source-registry.json");
    expect(producer).toContain("GRAPH_KERNEL_PRODUCTION_COLLECTOR_TOKEN_LINUX");
    expect(producer).toContain(
      "GRAPH_KERNEL_PRODUCTION_COLLECTOR_TOKEN_WINDOWS",
    );
    expect(producer).toContain("GRAPH_KERNEL_PRODUCTION_COLLECTOR_TOKEN_MACOS");
    expect(producer).toContain("query-graph-production-jobs.mjs");
    expect(producer).not.toContain("&& secrets.");
    expect(producer).not.toContain("actions/runners");
    const sourceJob = producer.slice(
      producer.indexOf("  source:"),
      producer.indexOf("  aggregate:"),
    );
    expect(sourceJob).not.toContain("shell: bash");
    expect(sourceJob).not.toContain("gh api");
    expect(sourceJob).not.toContain("jq ");
    expect(sourceJob).toContain(
      "Revalidate protected live main before collector credential access",
    );
    expect(sourceJob.indexOf("verify-github-live-main.mjs")).toBeLessThan(
      sourceJob.indexOf("GRAPH_KERNEL_PRODUCTION_COLLECTOR_TOKEN"),
    );
    expect(producer).not.toContain("GRAPH_KERNEL_PRODUCTION_EVIDENCE_ROOT");
    expect(producer).not.toContain("evidence_bundle_id");
    expect(close).toContain("--deny-self-hosted-runners");
    expect(close).toContain('--ref-protected "${{ github.ref_protected }}"');
    expect(
      (close.match(/node scripts\/verify-github-live-main\.mjs/gu) || [])
        .length,
    ).toBeGreaterThanOrEqual(2);
    expect(close).toContain("--source-ref refs/heads/main");
    expect(close).toContain('--signer-digest "${CUTOVER_SHA}"');
    expect(close).toContain('--run-attempt "${EVIDENCE_RUN_ATTEMPT}"');
    expect(close).toContain("--attestation-verification");
    expect(close).toContain("--expected-registry-digest");
    expect(close).not.toContain("--runner-inventory");
    expect(close).not.toContain("actions/runners");
    expect(close).toContain("--jobs-inventory");
    expect(close).toContain(
      `--expected-workflow ${GRAPH_PRODUCTION_EVIDENCE_WORKFLOW}`,
    );
    expect(close).not.toContain("continue-on-error");
    expect(close).not.toContain("jq -r --jq");
    expect(close).toContain(
      'run_identity="$(jq -r \'[.head_sha, (.run_attempt | tostring), .path, .conclusion, .event, .head_repository.full_name, .head_branch] | @tsv\' "${RUNNER_TEMP}/producer-run.json")"',
    );
    expect(close).toContain(
      "os: [ubuntu-latest, windows-latest, macos-latest]",
    );

    const runBlock = close.match(
      /- name: Verify exact producer run identity[\s\S]*?\n        run: \|\n([\s\S]*?)\n\n      - name:/u,
    );
    expect(runBlock).not.toBeNull();
    const shell = runBlock[1].replace(/^ {10}/gmu, "");
    const syntax = spawnSync("bash", ["-n"], {
      input: shell,
      encoding: "utf8",
    });
    expect(syntax.status, syntax.stderr).toBe(0);
    expect(GRAPH_REQUIRED_CUTOVER_STAGES).toHaveLength(5);
  });
});
