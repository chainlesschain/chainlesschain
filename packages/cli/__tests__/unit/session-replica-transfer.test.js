import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  computeExecutionLocationTargetFactsDigest,
  createExecutionLocationBinding,
  createExecutionLocationTargetAttestation,
} from "../../src/lib/execution-location-contract.js";
import {
  createExecutionLocationResultBundle,
  verifyExecutionLocationResultBundle,
} from "../../src/lib/execution-location-result.js";
import { canonicalJson } from "../../src/lib/scheduler-kernel/contract.js";

const root = mkdtempSync(join(tmpdir(), "cc-session-replica-"));
const sourceHome = join(root, "source-home");
const sourceAnchors = join(root, "source-anchors");
const targetHome = join(root, "target-home");
const targetAnchors = join(root, "target-anchors");
let activeHome = sourceHome;
let activeAnchorBase = sourceAnchors;

vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => activeHome,
  getStatePath: () => join(activeHome, "state"),
  getMachineSecurityAnchorDir: () => activeAnchorBase,
}));

const store = await import("../../src/harness/jsonl-session-store.js");
const anchors = await import("../../src/lib/session-anti-rollback-anchor.js");

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("verified session replica installation", () => {
  beforeAll(() => {
    anchors._registerTestScopedSessionAntiRollbackDirectory({
      homeDir: sourceHome,
      anchorBase: sourceAnchors,
    });
    anchors._registerTestScopedSessionAntiRollbackDirectory({
      homeDir: targetHome,
      anchorBase: targetAnchors,
    });
  });

  afterAll(() => {
    delete process.env.CC_SESSION_SCALE_FAULT_INJECTION;
    store._sessionScaleFaultHooks.afterReplicaPublish = null;
    store._sessionScaleFaultHooks.afterLocationHandoffAppend = null;
    rmSync(root, { recursive: true, force: true });
  });

  function selectSource() {
    activeHome = sourceHome;
    activeAnchorBase = sourceAnchors;
  }

  function selectTarget() {
    activeHome = targetHome;
    activeAnchorBase = targetAnchors;
  }

  function createSource(sessionId) {
    selectSource();
    store.startSession(sessionId, {
      title: "portable",
      executionLocation: createExecutionLocationBinding({
        location: "local",
        observed: true,
        observedAt: "2026-08-18T05:00:00.000Z",
        source: {
          cwd: "/source/repo",
          git: { root: "/source/repo", commit: "a".repeat(40) },
        },
        runtime: { platform: "linux", arch: "x64", tools: ["node"] },
      }),
    });
    store.appendUserMessage(sessionId, "move this exact revision");
    const bytes = Buffer.from(store.readVerifiedTranscriptBytes(sessionId));
    const verification = store.verifySession(sessionId);
    return {
      sessionId,
      bytes,
      expected: {
        headHash: verification.lastHash,
        eventCount: verification.chainedEvents,
        transcriptDigest: sha256(bytes),
      },
    };
  }

  function targetBinding(observedAt = "2026-08-18T05:01:00.000Z") {
    return createExecutionLocationBinding({
      location: "container",
      observed: true,
      observedAt,
      source: {
        cwd: "/target/repo",
        git: { root: "/target/repo", commit: "a".repeat(40) },
      },
      runtime: {
        platform: "linux",
        arch: "x64",
        cliVersion: "0.200.0-test",
        tools: ["chainlesschain-cli", "node"],
      },
    });
  }

  function targetAuthority(source, binding = targetBinding(), overrides = {}) {
    const profileDigest = `sha256:${"1".repeat(64)}`;
    const targetEvidenceId = "container-evidence-1";
    const attestation = createExecutionLocationTargetAttestation({
      profileDigest,
      sourceSessionId: source.sessionId,
      sourceHeadHash: source.expected.headHash,
      sourceEventCount: source.expected.eventCount,
      targetEvidenceId,
      baseCommit: binding.source.git.commit,
      binding,
    });
    return {
      profileDigest,
      targetEvidenceId,
      targetFactsDigest: computeExecutionLocationTargetFactsDigest(binding),
      attestationDigest: attestation.attestationDigest,
      binding,
      ...overrides,
    };
  }

  it("atomically installs an exact replica and makes retries idempotent", () => {
    const sessionId = "session-replica-exact";
    const source = createSource(sessionId);
    selectTarget();

    const first = store.installSessionReplica(
      sessionId,
      source.bytes,
      source.expected,
    );
    expect(first).toMatchObject({
      schema: store.SESSION_REPLICA_INSTALL_SCHEMA,
      sessionId,
      installed: true,
      ...source.expected,
    });
    expect(first.receiptDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(store.readVerifiedTranscriptBytes(sessionId)).toBe(
      source.bytes.toString("utf8"),
    );

    const retry = store.installSessionReplica(
      sessionId,
      source.bytes,
      source.expected,
    );
    expect(retry).toMatchObject({ installed: false, sessionId });
    expect(store.verifySession(sessionId)).toMatchObject({
      status: "verified",
      lastHash: source.expected.headHash,
      chainedEvents: source.expected.eventCount,
    });
  }, 20_000);

  it("rejects byte, head, and count drift before publishing", () => {
    const sessionId = "session-replica-reject";
    const source = createSource(sessionId);
    selectTarget();

    expect(() =>
      store.installSessionReplica(sessionId, source.bytes, {
        ...source.expected,
        transcriptDigest: `sha256:${"0".repeat(64)}`,
      }),
    ).toThrow(/transcript digest mismatch/u);
    expect(() =>
      store.installSessionReplica(sessionId, source.bytes, {
        ...source.expected,
        eventCount: source.expected.eventCount + 1,
      }),
    ).toThrow(/not fully verified/u);
    expect(store.sessionExists(sessionId)).toBe(false);
  });

  it("never replaces a divergent canonical target session", () => {
    const sessionId = "session-replica-conflict";
    const source = createSource(sessionId);
    selectTarget();
    store.startSession(sessionId, { title: "target-owned" });

    expect(() =>
      store.installSessionReplica(sessionId, source.bytes, source.expected),
    ).toThrow();
    expect(store.readVerifiedTranscriptBytes(sessionId)).not.toBe(
      source.bytes.toString("utf8"),
    );
  });

  it("settles an exact published replica after a crash before local anchors", () => {
    const sessionId = "session-replica-crash-recovery";
    const source = createSource(sessionId);
    selectTarget();
    let crashed = false;
    process.env.CC_SESSION_SCALE_FAULT_INJECTION = "1";
    store._sessionScaleFaultHooks.afterReplicaPublish = () => {
      if (!crashed) {
        crashed = true;
        throw new Error("injected replica publication crash");
      }
    };

    expect(() =>
      store.installSessionReplica(sessionId, source.bytes, source.expected),
    ).toThrow(/injected replica publication crash/u);
    store._sessionScaleFaultHooks.afterReplicaPublish = null;
    delete process.env.CC_SESSION_SCALE_FAULT_INJECTION;

    const recovery = store.installSessionReplica(
      sessionId,
      source.bytes,
      source.expected,
    );
    expect(recovery).toMatchObject({ installed: false, sessionId });
    expect(store.readVerifiedTranscriptBytes(sessionId)).toBe(
      source.bytes.toString("utf8"),
    );
  });

  it("appends one canonical target-location successor and retries idempotently", () => {
    const sessionId = "session-replica-location-handoff";
    const source = createSource(sessionId);
    selectTarget();
    const target = targetAuthority(source);

    const first = store.installSessionReplicaWithLocationHandoff(
      sessionId,
      source.bytes,
      source.expected,
      target,
    );
    expect(first).toMatchObject({
      schema: store.SESSION_EXECUTION_LOCATION_HANDOFF_INSTALL_SCHEMA,
      sessionId,
      sourceHeadHash: source.expected.headHash,
      sourceEventCount: source.expected.eventCount,
      targetEventCount: source.expected.eventCount + 1,
      targetFactsDigest: target.targetFactsDigest,
      replicaInstalled: true,
      handoffAppended: true,
    });
    const authority =
      store.getVerifiedSessionExecutionLocationAuthority(sessionId);
    expect(authority).toMatchObject({
      authority: "verified-session-location-handoff",
      headHash: first.targetHeadHash,
      eventCount: first.targetEventCount,
      bindingEventHash: first.targetHeadHash,
      bindingEventCount: first.targetEventCount,
      binding: { location: "container" },
      locationHandoff: {
        handoffId: first.handoffId,
        source: {
          sessionId,
          headHash: source.expected.headHash,
          eventCount: source.expected.eventCount,
        },
      },
    });

    const retryBinding = targetBinding("2026-08-18T05:02:00.000Z");
    const retry = store.installSessionReplicaWithLocationHandoff(
      sessionId,
      source.bytes,
      source.expected,
      targetAuthority(source, retryBinding),
    );
    expect(retry).toMatchObject({
      handoffId: first.handoffId,
      targetHeadHash: first.targetHeadHash,
      replicaInstalled: false,
      handoffAppended: false,
      attestationDigest: target.attestationDigest,
    });
  });

  it("binds returned bytes to the real target handoff and source predecessor", () => {
    const sessionId = "session-replica-result-return";
    const source = createSource(sessionId);
    selectTarget();
    const installed = store.installSessionReplicaWithLocationHandoff(
      sessionId,
      source.bytes,
      source.expected,
      targetAuthority(source),
    );
    const target = store.getVerifiedSessionExecutionLocationAuthority(sessionId);
    const bundle = createExecutionLocationResultBundle({
      sessionAuthority: target,
      resultId: "return-1",
      summaryBytes: Buffer.from("target work completed"),
      diffBytes: Buffer.from("diff --git a/a b/a\n"),
      artifacts: [],
      evidence: [],
    });

    selectSource();
    const predecessor = store.getVerifiedSessionExecutionLocationAuthority(
      sessionId,
    );
    expect(
      verifyExecutionLocationResultBundle({
        bundle,
        sourceAuthority: predecessor,
        expectedHandoffId: installed.handoffId,
      }),
    ).toMatchObject({
      sessionId,
      handoffId: installed.handoffId,
      sourceHeadHash: source.expected.headHash,
      sourceEventCount: source.expected.eventCount,
      targetHeadHash: installed.targetHeadHash,
      targetEventCount: installed.targetEventCount,
      applied: false,
    });
  });

  it("settles an accepted result once and recovers the receipt without content", () => {
    const sessionId = "session-result-collection-settlement";
    const source = createSource(sessionId);
    selectTarget();
    const installed = store.installSessionReplicaWithLocationHandoff(
      sessionId,
      source.bytes,
      source.expected,
      targetAuthority(source),
    );
    const target = store.getVerifiedSessionExecutionLocationAuthority(sessionId);
    const bundle = createExecutionLocationResultBundle({
      sessionAuthority: target,
      resultId: "settled-return-1",
      summaryBytes: Buffer.from("private returned summary"),
      diffBytes: Buffer.from("diff --git a/a b/a\n"),
      artifacts: [],
      evidence: [],
    });

    selectSource();
    const predecessor = store.getVerifiedSessionExecutionLocationAuthority(
      sessionId,
    );
    const sourceAuthority = {
      sessionId,
      headHash: predecessor.headHash,
      eventCount: predecessor.eventCount,
    };
    const verification = verifyExecutionLocationResultBundle({
      bundle,
      sourceAuthority,
      expectedHandoffId: installed.handoffId,
    });
    const requestId = "collect-settlement-1";
    const requestDigest = `sha256:${"2".repeat(64)}`;
    const material = {
      schema: "cc-execution-location-target-result-collection/v1",
      requestId,
      requestDigest,
      resultId: bundle.resultId,
      target: "container",
      profileDigest: target.locationHandoff.target.profileDigest,
      targetFactsDigest: target.locationHandoff.target.targetFactsDigest,
      collectionAttestationDigest:
        target.locationHandoff.target.attestationDigest,
      handoffId: installed.handoffId,
      sourceAuthority,
      targetHeadHash: target.headHash,
      targetEventCount: target.eventCount,
      bundleDigest: bundle.bundleDigest,
      verificationDigest: verification.verificationDigest,
      applied: false,
      continuity: "single-fixed-command-response",
      gaps: [
        "returned-result-bytes-not-durable",
        "cross-host-concurrent-writer-fencing-not-durable",
        "returned-result-not-applied",
      ],
    };
    const collection = {
      ...material,
      bundle,
      verification,
      collectionDigest: `sha256:${createHash("sha256")
        .update(
          "chainlesschain.execution-location.target-result-collection.v1\0",
          "utf8",
        )
        .update(canonicalJson(material, "testResultCollection"), "utf8")
        .digest("hex")}`,
    };

    const first = store.settleSessionExecutionLocationResultCollection(
      sessionId,
      requestId,
      collection,
    );
    expect(first).toMatchObject({
      schema:
        store.SESSION_EXECUTION_LOCATION_RESULT_COLLECTION_RECEIPT_SCHEMA,
      sessionId,
      requestId,
      requestDigest,
      sourceHeadHash: source.expected.headHash,
      sourceEventCount: source.expected.eventCount,
      settlementEventCount: source.expected.eventCount + 1,
      bundleDigest: bundle.bundleDigest,
      totalBytes: bundle.totalBytes,
      applied: false,
      settlementAppended: true,
      recovered: false,
    });
    const retry = store.settleSessionExecutionLocationResultCollection(
      sessionId,
      requestId,
      collection,
    );
    expect(retry).toMatchObject({
      receiptDigest: first.receiptDigest,
      settlementEventHash: first.settlementEventHash,
      settlementAppended: false,
      recovered: true,
    });
    expect(
      store.readVerifiedSessionExecutionLocationResultSettlement(
        sessionId,
        requestId,
        { requestDigest },
      ),
    ).toMatchObject({ receiptDigest: first.receiptDigest });
    expect(() =>
      store.readVerifiedSessionExecutionLocationResultSettlement(
        sessionId,
        requestId,
        { requestDigest: `sha256:${"3".repeat(64)}` },
      ),
    ).toThrow(/already bound to different inputs/u);
    const event = store.findLatestEvent(
      sessionId,
      store.SESSION_EXECUTION_LOCATION_RESULT_COLLECTION_EVENT,
    );
    expect(JSON.stringify(event.data)).not.toContain("private returned summary");
    expect(event.data).not.toHaveProperty("bundle");
    expect(event.data).not.toHaveProperty("verification");
  });

  it("recovers response loss after the canonical handoff append", () => {
    const sessionId = "session-replica-handoff-response-loss";
    const source = createSource(sessionId);
    selectTarget();
    const target = targetAuthority(source);
    let failed = false;
    process.env.CC_SESSION_SCALE_FAULT_INJECTION = "1";
    store._sessionScaleFaultHooks.afterLocationHandoffAppend = () => {
      if (!failed) {
        failed = true;
        throw new Error("injected handoff response loss");
      }
    };

    expect(() =>
      store.installSessionReplicaWithLocationHandoff(
        sessionId,
        source.bytes,
        source.expected,
        target,
      ),
    ).toThrow(/injected handoff response loss/u);
    store._sessionScaleFaultHooks.afterLocationHandoffAppend = null;
    delete process.env.CC_SESSION_SCALE_FAULT_INJECTION;

    const retry = store.installSessionReplicaWithLocationHandoff(
      sessionId,
      source.bytes,
      source.expected,
      target,
    );
    expect(retry).toMatchObject({
      replicaInstalled: false,
      handoffAppended: false,
      targetEventCount: source.expected.eventCount + 1,
    });
  });

  it("rejects replay after the target session advances beyond handoff", () => {
    const sessionId = "session-replica-handoff-advanced";
    const source = createSource(sessionId);
    selectTarget();
    const target = targetAuthority(source);
    store.installSessionReplicaWithLocationHandoff(
      sessionId,
      source.bytes,
      source.expected,
      target,
    );
    store.appendUserMessage(sessionId, "target continued");

    expect(() =>
      store.installSessionReplicaWithLocationHandoff(
        sessionId,
        source.bytes,
        source.expected,
        target,
      ),
    ).toThrow(/advanced after location handoff/u);
  });

  it("rejects an attestation digest not derived from the handoff facts", () => {
    const sessionId = "session-replica-handoff-attestation-tamper";
    const source = createSource(sessionId);
    selectTarget();

    expect(() =>
      store.installSessionReplicaWithLocationHandoff(
        sessionId,
        source.bytes,
        source.expected,
        targetAuthority(source, targetBinding(), {
          attestationDigest: `sha256:${"8".repeat(64)}`,
        }),
      ),
    ).toThrow(/handoff attestation digest is invalid/u);
    expect(store.sessionExists(sessionId)).toBe(false);
  });

  it("fails closed when a canonical handoff event carries drifted target facts", () => {
    const sessionId = "session-replica-handoff-tampered-facts";
    const source = createSource(sessionId);
    selectTarget();
    store.installSessionReplica(sessionId, source.bytes, source.expected);
    const target = targetAuthority(source);
    store.appendAuthorityEventIfHead(
      sessionId,
      store.SESSION_EXECUTION_LOCATION_HANDOFF_EVENT,
      {
        schema: store.SESSION_EXECUTION_LOCATION_HANDOFF_SCHEMA,
        handoffId: `sha256:${"9".repeat(64)}`,
        source: { sessionId, ...source.expected },
        target: {
          ...target,
          targetFactsDigest: `sha256:${"8".repeat(64)}`,
        },
      },
      source.expected.headHash,
    );

    expect(() =>
      store.getVerifiedSessionExecutionLocationAuthority(sessionId),
    ).toThrow(/handoff target is invalid/u);
  });
});
