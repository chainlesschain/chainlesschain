import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FRAGMENT_SCHEMA,
  aggregateEvidenceEntries,
  validateFragment,
} from "../../scripts/verify-mcp-lifecycle-increments.mjs";
import {
  MCP_LIFECYCLE_PROFILE_TEST_IDS,
  MCP_LIFECYCLE_PROFILE_THRESHOLDS,
  MCP_LIFECYCLE_PROFILE_VERSION,
} from "../../scripts/mcp-lifecycle-profile.mjs";

const HEAD_SHA = "a".repeat(40);
const PRODUCER_DIGESTS = Object.freeze({
  "packages/cli/src/lib/mcp-lifecycle-authority.js": `sha256:${"b".repeat(64)}`,
});

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

function fragment(os) {
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
    disposition: "required",
    source: {
      workflowId:
        "owner/repo/.github/workflows/cli-reliability-soak.yml@refs/pull/1/merge",
      runId: "123456",
      jobId: "mcp-security-soak",
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

describe("MCP lifecycle canonical audit fragment", () => {
  it("accepts the complete canonical contract", () => {
    expect(() =>
      validateFragment(fragment("linux"), HEAD_SHA, PRODUCER_DIGESTS, {
        requireWorkflowSource: true,
      }),
    ).not.toThrow();
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
});
