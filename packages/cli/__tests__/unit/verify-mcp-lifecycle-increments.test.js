import crypto from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FRAGMENT_SCHEMA,
  PROFILE_VERSION,
  PRODUCER_FILES,
  TEST_IDS,
  THRESHOLDS,
  aggregateEvidenceEntries,
  exactTreeProducerDigests,
  validateFragment,
  validateRequiredWorkflowBinding,
  workflowSource,
} from "../../scripts/verify-mcp-lifecycle-increments.mjs";
import {
  MCP_LIFECYCLE_PROFILE_TEST_IDS,
  MCP_LIFECYCLE_PROFILE_THRESHOLDS,
  MCP_LIFECYCLE_PROFILE_VERSION,
} from "../../scripts/mcp-lifecycle-profile.mjs";

const HEAD_SHA = "a".repeat(40);
const WORKFLOW_PATH = ".github/workflows/cli-reliability-soak.yml";
const WORKFLOW_ID = `owner/repo/${WORKFLOW_PATH}@refs/pull/1/merge`;
const WORKFLOW_BYTES = Buffer.from("exact workflow fixture\n");
const PRODUCER_DIGESTS = Object.freeze(
  Object.fromEntries(
    PRODUCER_FILES.map((producerPath) => [
      producerPath,
      producerPath === WORKFLOW_PATH
        ? digest(WORKFLOW_BYTES)
        : `sha256:${"b".repeat(64)}`,
    ]),
  ),
);

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function measurements() {
  return {
    disabledOutboundCount: 0,
    rpcOrderExact: true,
    authenticationRefreshesPerRejection: 1,
    reconnectFlightsPerServer: 1,
    initializeCount: 5,
    subscriptionRestoreCount: 4,
    maxRecoveryLatencyMs: 100,
    hotReconnectLatencyMs: 100,
    restartRecoveryLatencyMs: 90,
    inFlightRestartLatencyMs: 80,
    crossProcessRestartLatencyMs: 120,
    crossProcessRestartWallClockMs: 450,
    lifecycleReceiptCount: 20,
    lifecycleReceiptDigest: `sha256:${"c".repeat(64)}`,
    rpcRegistered: 12,
    rpcSettled: 12,
    rpcRecoveredAfterRestart: 1,
    crossProcessRestartTakeovers: 1,
    duplicateCallbacksAccepted: 0,
    staleCallbacksAccepted: 0,
    lostCallbacks: 0,
    staleCallbacksRejected: 1,
    duplicateCallbacksRejected: 1,
    expiredTokenRefreshRequests: 1,
    revokeRefreshRequests: 1,
    idpRevokedRefreshRequests: 1,
    protocolBoundaryFailures: 2,
    invalidProtocolPostInitializeRequests: 0,
    revokedTokenResurrections: 0,
    tlsIdentityRotations: 1,
    mtlsAuthorizedConnections: 2,
    distinctTlsIdentityDigests: 2,
    invalidTlsMaterialRejected: 1,
    invalidTlsOutboundCount: 0,
    invalidTlsLifecycleFailed: 1,
    helperTimeoutMs: 10_000,
    helperMaxOutputBytes: 64 * 1024,
    helperMaxHeaders: 128,
    helperMaxHeaderValueBytes: 16 * 1024,
    lifecycleMaxPendingRpc: 512,
    logSecretHits: 0,
    regressionTestDurationMs: 250,
    regressionTestFileCount: 8,
  };
}

function fragment(
  os,
  {
    disposition = "required",
    workflowId = WORKFLOW_ID,
    runId = "123456",
    jobId = `mcp-security-soak-${os}`,
  } = {},
) {
  const artifactName = `mcp-lifecycle-${os}-${HEAD_SHA}`;
  return {
    schema: FRAGMENT_SCHEMA,
    commitmentId: "MCP-LIFECYCLE",
    headSha: HEAD_SHA,
    os,
    runtime: { name: "node", version: "v22.12.0", arch: "x64" },
    profileVersion: MCP_LIFECYCLE_PROFILE_VERSION,
    thresholds: { ...MCP_LIFECYCLE_PROFILE_THRESHOLDS },
    measurements: measurements(),
    testIds: [...MCP_LIFECYCLE_PROFILE_TEST_IDS],
    producerDigests: { ...PRODUCER_DIGESTS },
    disposition,
    source: {
      workflowId,
      runId,
      jobId,
      artifactName,
    },
    outcome: "passed",
  };
}

function entry(os, mutate = (value) => value) {
  const value = mutate(fragment(os));
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  return {
    file: path.join(
      "evidence",
      value.source.artifactName,
      "mcp-lifecycle-audit-fragment.json",
    ),
    bytes,
    value,
  };
}

function requiredEnvironment(overrides = {}) {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_WORKFLOW_SHA: HEAD_SHA,
    GITHUB_WORKFLOW_REF: WORKFLOW_ID,
    GITHUB_REPOSITORY: "owner/repo",
    GITHUB_RUN_ID: "123456",
    GITHUB_JOB: "mcp-security-soak",
    ...overrides,
  };
}

describe("MCP lifecycle canonical audit fragment", () => {
  it("exports the locked profile contract for drift checks", () => {
    expect(PROFILE_VERSION).toBe(MCP_LIFECYCLE_PROFILE_VERSION);
    expect(THRESHOLDS).toBe(MCP_LIFECYCLE_PROFILE_THRESHOLDS);
    expect(TEST_IDS).toBe(MCP_LIFECYCLE_PROFILE_TEST_IDS);
    expect(PRODUCER_FILES).toHaveLength(23);
  });

  it("accepts required GitHub evidence and explicitly non-qualifying advisory evidence", () => {
    expect(() =>
      validateFragment(fragment("linux"), HEAD_SHA, PRODUCER_DIGESTS, {
        requireWorkflowSource: true,
      }),
    ).not.toThrow();

    const advisory = fragment("linux", {
      disposition: "advisory",
      workflowId: "local",
      runId: "local",
      jobId: "local",
    });
    expect(() =>
      validateFragment(advisory, HEAD_SHA, PRODUCER_DIGESTS, {
        allowAdvisory: true,
      }),
    ).not.toThrow();
    expect(() =>
      validateFragment(advisory, HEAD_SHA, PRODUCER_DIGESTS),
    ).toThrow(/non-qualifying/u);
    expect(() =>
      validateFragment(
        { ...advisory, disposition: "required" },
        HEAD_SHA,
        PRODUCER_DIGESTS,
      ),
    ).toThrow(/GitHub workflow ref/u);
    expect(
      workflowSource(undefined, HEAD_SHA, { environment: {} }),
    ).toMatchObject({
      workflowId: "local",
      runId: "local",
      jobId: "local",
    });
  });

  it("binds required production to GitHub Actions and the exact workflow blob", () => {
    const readProducer = (headSha, producerPath) => {
      expect(headSha).toBe(HEAD_SHA);
      expect(producerPath).toBe(WORKFLOW_PATH);
      return WORKFLOW_BYTES;
    };
    expect(
      workflowSource(`mcp-lifecycle-linux-${HEAD_SHA}`, HEAD_SHA, {
        required: true,
        environment: requiredEnvironment(),
        producerDigests: PRODUCER_DIGESTS,
        readProducer,
      }),
    ).toMatchObject({
      workflowId: WORKFLOW_ID,
      runId: "123456",
      jobId: "mcp-security-soak",
    });
    expect(() =>
      validateRequiredWorkflowBinding({
        environment: requiredEnvironment({ GITHUB_ACTIONS: "false" }),
        headSha: HEAD_SHA,
        producerDigests: PRODUCER_DIGESTS,
        readProducer,
      }),
    ).toThrow(/GitHub Actions/u);
    expect(() =>
      validateRequiredWorkflowBinding({
        environment: requiredEnvironment({
          GITHUB_WORKFLOW_SHA: "d".repeat(40),
        }),
        headSha: HEAD_SHA,
        producerDigests: PRODUCER_DIGESTS,
        readProducer,
      }),
    ).toThrow(/exact evidence commit/u);
    expect(() =>
      validateRequiredWorkflowBinding({
        environment: requiredEnvironment(),
        headSha: HEAD_SHA,
        producerDigests: PRODUCER_DIGESTS,
        readProducer: () => Buffer.from("tampered workflow\n"),
      }),
    ).toThrow(/attested workflow blob/u);
  });

  it("derives every producer digest from the exact Git tree reader", () => {
    const calls = [];
    const producerDigests = exactTreeProducerDigests(
      HEAD_SHA,
      (headSha, producerPath) => {
        calls.push({ headSha, producerPath });
        return Buffer.from(`tree:${headSha}:${producerPath}`);
      },
    );
    expect(calls).toEqual(
      PRODUCER_FILES.map((producerPath) => ({
        headSha: HEAD_SHA,
        producerPath,
      })),
    );
    expect(Object.keys(producerDigests)).toEqual(PRODUCER_FILES);
    expect(producerDigests[PRODUCER_FILES[0]]).toBe(
      digest(Buffer.from(`tree:${HEAD_SHA}:${PRODUCER_FILES[0]}`)),
    );
  });

  it("rejects a legacy schema and stale exact-head binding", () => {
    expect(() =>
      validateFragment(
        {
          ...fragment("linux"),
          schema: "chainlesschain.mcp-lifecycle-evidence.v1",
        },
        HEAD_SHA,
        PRODUCER_DIGESTS,
        { requireWorkflowSource: true },
      ),
    ).toThrow();
    expect(() =>
      validateFragment(fragment("linux"), "d".repeat(40), PRODUCER_DIGESTS, {
        requireWorkflowSource: true,
      }),
    ).toThrow();
  });

  it("rejects top-level, runtime, and source field injection", () => {
    const topLevel = { ...fragment("linux"), injected: true };
    expect(() =>
      validateFragment(topLevel, HEAD_SHA, PRODUCER_DIGESTS, {
        requireWorkflowSource: true,
      }),
    ).toThrow(/exactly/u);

    const runtime = fragment("linux");
    runtime.runtime.workflowSha = HEAD_SHA;
    expect(() =>
      validateFragment(runtime, HEAD_SHA, PRODUCER_DIGESTS, {
        requireWorkflowSource: true,
      }),
    ).toThrow(/fragment\.runtime must contain exactly/u);

    const source = fragment("linux");
    source.source.workflowSha = HEAD_SHA;
    expect(() =>
      validateFragment(source, HEAD_SHA, PRODUCER_DIGESTS, {
        requireWorkflowSource: true,
      }),
    ).toThrow(/fragment\.source must contain exactly/u);
  });

  it("rehashes a complete three-OS matrix in deterministic order", () => {
    const aggregate = aggregateEvidenceEntries({
      entries: [entry("windows"), entry("linux"), entry("macos")],
      headSha: HEAD_SHA,
      producerDigests: PRODUCER_DIGESTS,
    });
    expect(aggregate.operatingSystems).toEqual(["linux", "macos", "windows"]);
    expect(aggregate.fragments.map((item) => item.operatingSystem)).toEqual([
      "linux",
      "macos",
      "windows",
    ]);
    expect(
      aggregate.fragments.every((item) =>
        /^sha256:[a-f0-9]{64}$/u.test(item.digest),
      ),
    ).toBe(true);
    expect(
      new Set(aggregate.fragments.map((item) => item.source.jobId)).size,
    ).toBe(3);
  });

  it("rejects missing, duplicate, and non-canonical matrix cells", () => {
    const complete = [entry("linux"), entry("macos"), entry("windows")];
    expect(() =>
      aggregateEvidenceEntries({
        entries: complete.slice(0, 2),
        headSha: HEAD_SHA,
        producerDigests: PRODUCER_DIGESTS,
      }),
    ).toThrow(/exactly one/u);
    expect(() =>
      aggregateEvidenceEntries({
        entries: [entry("linux"), entry("linux"), entry("windows")],
        headSha: HEAD_SHA,
        producerDigests: PRODUCER_DIGESTS,
      }),
    ).toThrow(/duplicate linux/u);
    const nonCanonical = entry("macos");
    nonCanonical.bytes = Buffer.from(JSON.stringify(nonCanonical.value));
    expect(() =>
      aggregateEvidenceEntries({
        entries: [entry("linux"), nonCanonical, entry("windows")],
        headSha: HEAD_SHA,
        producerDigests: PRODUCER_DIGESTS,
      }),
    ).toThrow(/canonical producer encoding/u);
  });

  it("rejects cross-workflow and cross-run evidence mixing", () => {
    const crossRun = entry("macos", (value) => {
      value.source.runId = "654321";
      return value;
    });
    expect(() =>
      aggregateEvidenceEntries({
        entries: [entry("linux"), crossRun, entry("windows")],
        headSha: HEAD_SHA,
        producerDigests: PRODUCER_DIGESTS,
      }),
    ).toThrow(/runId differs/u);

    const crossWorkflow = entry("windows", (value) => {
      value.source.workflowId =
        "owner/repo/.github/workflows/cli-ci.yml@refs/heads/main";
      return value;
    });
    expect(() =>
      aggregateEvidenceEntries({
        entries: [entry("linux"), entry("macos"), crossWorkflow],
        headSha: HEAD_SHA,
        producerDigests: PRODUCER_DIGESTS,
      }),
    ).toThrow(/workflowId differs/u);

    expect(() =>
      aggregateEvidenceEntries({
        entries: [entry("linux"), entry("macos"), entry("windows")],
        headSha: HEAD_SHA,
        producerDigests: PRODUCER_DIGESTS,
        expectedSource: { workflowId: WORKFLOW_ID, runId: "999999" },
      }),
    ).toThrow(/current aggregate run/u);
  });

  it("rejects a self-consistent fragment tamper and mixed disposition", () => {
    const tampered = entry("macos", (value) => {
      value.producerDigests["packages/cli/src/lib/mcp-lifecycle-authority.js"] =
        `sha256:${"0".repeat(64)}`;
      return value;
    });
    expect(() =>
      aggregateEvidenceEntries({
        entries: [entry("linux"), tampered, entry("windows")],
        headSha: HEAD_SHA,
        producerDigests: PRODUCER_DIGESTS,
      }),
    ).toThrow();

    const advisory = entry("macos", (value) => {
      value.disposition = "advisory";
      return value;
    });
    expect(() =>
      aggregateEvidenceEntries({
        entries: [entry("linux"), advisory, entry("windows")],
        headSha: HEAD_SHA,
        producerDigests: PRODUCER_DIGESTS,
        allowAdvisory: true,
      }),
    ).toThrow(/disposition differs/u);
  });
});
