import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerSessionLocationSubcommands,
  writeSessionExecutionLocationResultPreview,
} from "../../src/commands/session-location.js";
import {
  EXECUTION_LOCATION_HANDOFF_FACTS_SCHEMA,
  computeExecutionLocationTargetFactsDigest,
  createExecutionLocationBinding,
} from "../../src/lib/execution-location-contract.js";
import {
  EXECUTION_LOCATION_PROFILE_SCHEMA,
  EXECUTION_LOCATION_TARGET_ATTESTATION_SCHEMA,
  EXECUTION_LOCATION_TARGET_RESUME_SCHEMA,
} from "../../src/lib/execution-location-target.js";

const COMMIT = "a".repeat(40);
const HEAD_HASH = "b".repeat(64);
const DIGEST = `sha256:${"c".repeat(64)}`;
const TRANSCRIPT_BYTES = Buffer.from("exact transcript bytes\n", "utf8");

function authority() {
  return {
    sessionId: "session-command-1",
    headHash: HEAD_HASH,
    eventCount: 5,
    binding: createExecutionLocationBinding({
      location: "local",
      observed: true,
      observedAt: "2026-08-18T08:00:00.000Z",
      source: {
        cwd: "/source/repo",
        git: { root: "/source/repo", commit: COMMIT },
      },
      runtime: { platform: "linux", arch: "x64", tools: ["node"] },
      policy: {
        network: "restricted",
        sandbox: "strong",
        dataBoundary: { kind: "repository", root: "/source/repo" },
      },
    }),
  };
}

function facts() {
  return {
    schema: EXECUTION_LOCATION_HANDOFF_FACTS_SCHEMA,
    authority: {
      sessionId: "session-command-1",
      headHash: HEAD_HASH,
      eventCount: 5,
    },
    target: {
      configured: true,
      evidenceId: "ssh-evidence-1",
      networkPolicy: "restricted",
      sandboxStrength: "strong",
      dataBoundary: { kind: "declared", root: "/target/repo" },
      capabilities: ["node"],
    },
    git: { status: "clean", baseCommit: COMMIT },
    strategy: { kind: "commit", ref: COMMIT },
    summary: { included: true, digest: DIGEST },
    permissions: { included: true, digest: DIGEST },
    artifacts: [],
    credentials: [],
    requiredCapabilities: ["node"],
  };
}

function profile() {
  return {
    schema: EXECUTION_LOCATION_PROFILE_SCHEMA,
    id: "ssh-profile-1",
    target: "ssh",
    evidenceId: "ssh-evidence-1",
    cliCommand: "/usr/local/bin/chainlesschain",
    cwd: "/target/repo",
    transport: {},
    expected: {},
    sessionStore: null,
  };
}

describe("session location target command routes", () => {
  let stdout;
  let stderr;
  let previousExitCode;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    previousExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    process.exitCode = previousExitCode;
  });

  function program(deps) {
    const command = new Command();
    command.exitOverride();
    const session = command.command("session");
    registerSessionLocationSubcommands(session, deps);
    return command;
  }

  function dependencies(overrides = {}) {
    return {
      getVerifiedSessionExecutionLocationAuthority: () => authority(),
      readHandoffFacts: () => facts(),
      readExecutionLocationProfile: () => profile(),
      ...overrides,
    };
  }

  it("routes attest through an allowed handoff and emits exact JSON", async () => {
    const attest = vi.fn(({ handoff, profile: targetProfile }) => ({
      schema: EXECUTION_LOCATION_TARGET_ATTESTATION_SCHEMA,
      binding: { location: handoff.target.location },
      profileId: targetProfile.id,
      targetFactsDigest: DIGEST,
      attestationDigest: `sha256:${"d".repeat(64)}`,
      gaps: [],
    }));
    await program(
      dependencies({ attestExecutionLocationTarget: attest }),
    ).parseAsync([
      "node",
      "cc",
      "session",
      "location",
      "attest",
      "session-command-1",
      "ssh",
      "--facts",
      "facts.json",
      "--profile",
      "profile.json",
      "--json",
    ]);

    expect(process.exitCode).toBe(0);
    expect(attest).toHaveBeenCalledWith(
      expect.objectContaining({
        handoff: expect.objectContaining({ allowed: true }),
        profile: expect.objectContaining({ id: "ssh-profile-1" }),
      }),
      expect.any(Object),
    );
    expect(JSON.parse(stdout.mock.calls.at(-1)[0])).toMatchObject({
      schema: EXECUTION_LOCATION_TARGET_ATTESTATION_SCHEMA,
      profileId: "ssh-profile-1",
      targetFactsDigest: DIGEST,
    });
    expect(stderr).not.toHaveBeenCalled();
  });

  it("requires and forwards the accepted stable facts digest for resume", async () => {
    const resume = vi.fn(
      ({ expectedTargetFactsDigest, handoff, profile: targetProfile }) => ({
        schema: EXECUTION_LOCATION_TARGET_RESUME_SCHEMA,
        target: handoff.target.location,
        profileId: targetProfile.id,
        acceptedFacts: expectedTargetFactsDigest,
        receiptDigest: `sha256:${"e".repeat(64)}`,
        gaps: [],
      }),
    );
    const replicatedProfile = {
      ...profile(),
      sessionStore: {
        mode: "replicated",
        targetSessionId: "session-command-1",
        headHash: HEAD_HASH,
        eventCount: 5,
      },
    };
    await program(
      dependencies({
        readExecutionLocationProfile: () => replicatedProfile,
        readVerifiedTranscriptBytes: () => TRANSCRIPT_BYTES,
        resumeExecutionLocationTarget: resume,
      }),
    ).parseAsync([
      "node",
      "cc",
      "session",
      "location",
      "resume",
      "session-command-1",
      "ssh",
      "--facts",
      "facts.json",
      "--profile",
      "profile.json",
      "--expected-target-facts-digest",
      DIGEST,
      "--json",
    ]);

    expect(process.exitCode).toBe(0);
    expect(resume).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedTargetFactsDigest: DIGEST,
        transcriptBytes: TRANSCRIPT_BYTES,
        readSourceAuthority: expect.any(Function),
      }),
      expect.any(Object),
    );
    expect(JSON.parse(stdout.mock.calls.at(-1)[0])).toMatchObject({
      schema: EXECUTION_LOCATION_TARGET_RESUME_SCHEMA,
      target: "ssh",
      acceptedFacts: DIGEST,
    });
    expect(resume.mock.calls[0][0].readSourceAuthority()).toMatchObject({
      sessionId: "session-command-1",
      headHash: HEAD_HASH,
      eventCount: 5,
    });
  });

  it("routes bounded replica stdin into the canonical installer", async () => {
    const receipt = {
      schema: "chainlesschain.session-replica-install/v1",
      sessionId: "session-command-1",
      headHash: HEAD_HASH,
      eventCount: 5,
      transcriptDigest: DIGEST,
      installed: true,
      receiptDigest: `sha256:${"e".repeat(64)}`,
    };
    const install = vi.fn(() => receipt);
    await program(
      dependencies({
        readSessionReplicaInput: () => TRANSCRIPT_BYTES,
        installSessionReplica: install,
      }),
    ).parseAsync([
      "node",
      "cc",
      "session",
      "location",
      "receive",
      "session-command-1",
      "--expected-head-hash",
      HEAD_HASH,
      "--expected-event-count",
      "5",
      "--expected-transcript-digest",
      DIGEST,
      "--json",
    ]);

    expect(process.exitCode).toBe(0);
    expect(install).toHaveBeenCalledWith(
      "session-command-1",
      TRANSCRIPT_BYTES,
      {
        headHash: HEAD_HASH,
        eventCount: 5,
        transcriptDigest: DIGEST,
      },
    );
    expect(JSON.parse(stdout.mock.calls.at(-1)[0])).toEqual(receipt);
  });

  it("binds prepare stdin to the ambient target facts and handoff installer", async () => {
    const targetBinding = createExecutionLocationBinding({
      location: "container",
      observed: true,
      observedAt: "2026-08-18T08:02:00.000Z",
      source: {
        cwd: "/target/repo",
        git: { root: "/target/repo", commit: COMMIT },
      },
      runtime: {
        platform: "linux",
        arch: "x64",
        cliVersion: "0.200.0-test",
        tools: ["chainlesschain-cli", "node"],
      },
    });
    const targetFactsDigest =
      computeExecutionLocationTargetFactsDigest(targetBinding);
    const receipt = {
      schema: "chainlesschain.session-execution-location-handoff-install/v1",
      sessionId: "session-command-1",
      targetHeadHash: "f".repeat(64),
      receiptDigest: `sha256:${"e".repeat(64)}`,
    };
    const install = vi.fn(() => receipt);
    await program(
      dependencies({
        captureAmbientExecutionLocation: () => targetBinding,
        readSessionReplicaInput: () => TRANSCRIPT_BYTES,
        installSessionReplicaWithLocationHandoff: install,
      }),
    ).parseAsync([
      "node",
      "cc",
      "session",
      "location",
      "prepare",
      "session-command-1",
      "--expected-head-hash",
      HEAD_HASH,
      "--expected-event-count",
      "5",
      "--expected-transcript-digest",
      DIGEST,
      "--expected-target-facts-digest",
      targetFactsDigest,
      "--profile-digest",
      DIGEST,
      "--target-evidence-id",
      "container-evidence-1",
      "--attestation-digest",
      DIGEST,
      "--json",
    ]);

    expect(process.exitCode).toBe(0);
    expect(install).toHaveBeenCalledWith(
      "session-command-1",
      TRANSCRIPT_BYTES,
      {
        headHash: HEAD_HASH,
        eventCount: 5,
        transcriptDigest: DIGEST,
      },
      {
        profileDigest: DIGEST,
        targetEvidenceId: "container-evidence-1",
        targetFactsDigest,
        attestationDigest: DIGEST,
        binding: targetBinding,
      },
    );
    expect(JSON.parse(stdout.mock.calls.at(-1)[0])).toEqual(receipt);
  });

  it("routes result-pack with bounded returned content and emits the bundle", async () => {
    const bundle = {
      schema: "cc-execution-location-result-bundle/v1",
      resultId: "result-1",
      bundleDigest: DIGEST,
      totalBytes: 12,
    };
    const create = vi.fn(() => bundle);
    const read = vi.fn((filePath) => Buffer.from(filePath));
    await program(
      dependencies({
        readExecutionLocationResultFile: read,
        createExecutionLocationResultBundle: create,
      }),
    ).parseAsync([
      "node",
      "cc",
      "session",
      "location",
      "result-pack",
      "session-command-1",
      "--result-id",
      "result-1",
      "--summary",
      "/source/repo/summary.txt",
      "--diff",
      "/source/repo/result.diff",
      "--artifact",
      "application/json=/source/repo/artifact.json",
      "--evidence",
      "text/plain=/source/repo/evidence.txt",
      "--json",
    ]);

    expect(process.exitCode).toBe(0);
    expect(read).toHaveBeenCalledTimes(4);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        resultId: "result-1",
        artifacts: [expect.objectContaining({ mediaType: "application/json" })],
        evidence: [expect.objectContaining({ mediaType: "text/plain" })],
      }),
    );
    expect(JSON.parse(stdout.mock.calls.at(-1)[0])).toEqual(bundle);
  });

  it("routes result-verify without echoing returned content", async () => {
    const bundle = { bundleDigest: DIGEST, privateBytes: "not projected" };
    const receipt = {
      schema: "cc-execution-location-result-verification/v1",
      resultId: "result-1",
      bundleDigest: DIGEST,
      verificationDigest: `sha256:${"d".repeat(64)}`,
      applied: false,
    };
    const verify = vi.fn(() => receipt);
    await program(
      dependencies({
        readExecutionLocationResultBundle: () => bundle,
        verifyExecutionLocationResultBundle: verify,
      }),
    ).parseAsync([
      "node",
      "cc",
      "session",
      "location",
      "result-verify",
      "session-command-1",
      "--bundle",
      "/source/repo/result.json",
      "--expected-handoff-id",
      `sha256:${"4".repeat(64)}`,
      "--json",
    ]);

    expect(process.exitCode).toBe(0);
    expect(verify).toHaveBeenCalledWith({
      bundle,
      sourceAuthority: expect.objectContaining({
        sessionId: "session-command-1",
        headHash: HEAD_HASH,
        eventCount: 5,
      }),
      expectedHandoffId: `sha256:${"4".repeat(64)}`,
    });
    expect(JSON.parse(stdout.mock.calls.at(-1)[0])).toEqual(receipt);
    expect(stdout.mock.calls.at(-1)[0]).not.toContain("not projected");
  });

  it("routes fixed-transport result collection with exact accepted authority", async () => {
    const bundle = { bundleDigest: DIGEST, privateBytes: "returned" };
    const receipt = {
      schema: "cc-execution-location-target-result-collection/v1",
      requestId: "collect-request-2",
      requestDigest: DIGEST,
      resultId: "result-2",
      bundleDigest: DIGEST,
      collectionDigest: `sha256:${"d".repeat(64)}`,
      bundle,
      applied: false,
      gaps: ["returned-result-not-applied"],
    };
    const settlement = {
      schema:
        "chainlesschain.session-execution-location-result-collection-receipt/v2",
      requestId: "collect-request-2",
      receiptDigest: `sha256:${"e".repeat(64)}`,
    };
    const storageReceipt = {
      schema: "chainlesschain.execution-location-result-store-receipt/v1",
      receiptDigest: `sha256:${"f".repeat(64)}`,
    };
    const collect = vi.fn(() => receipt);
    const settle = vi.fn(() => settlement);
    await program(
      dependencies({
        createExecutionLocationTargetResultCollectionRequest: () => ({
          requestId: "collect-request-2",
          requestDigest: DIGEST,
        }),
        readVerifiedSessionExecutionLocationResultSettlement: () => null,
        collectExecutionLocationTargetResult: collect,
        storeExecutionLocationResultBundle: vi.fn(() => ({
          receipt: storageReceipt,
          stored: true,
        })),
        settleSessionExecutionLocationResultCollection: settle,
      }),
    ).parseAsync([
      "node",
      "cc",
      "session",
      "location",
      "result-collect",
      "session-command-1",
      "ssh",
      "--facts",
      "facts.json",
      "--profile",
      "profile.json",
      "--expected-target-facts-digest",
      DIGEST,
      "--expected-handoff-id",
      `sha256:${"4".repeat(64)}`,
      "--request-id",
      "collect-request-2",
      "--result-id",
      "result-2",
      "--summary",
      "summary.txt",
      "--diff",
      "result.diff",
      "--artifact",
      "application/json=artifact.json",
      "--json",
    ]);

    expect(process.exitCode).toBe(0);
    expect(collect).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedTargetFactsDigest: DIGEST,
        expectedHandoffId: `sha256:${"4".repeat(64)}`,
        requestId: "collect-request-2",
        resultId: "result-2",
        summaryPath: "summary.txt",
        diffPath: "result.diff",
        artifacts: [{ mediaType: "application/json", path: "artifact.json" }],
      }),
      expect.any(Object),
    );
    expect(settle).toHaveBeenCalledWith(
      "session-command-1",
      "collect-request-2",
      receipt,
      storageReceipt,
    );
    expect(JSON.parse(stdout.mock.calls.at(-1)[0])).toEqual({
      ...receipt,
      storage: { ...storageReceipt, stored: true },
      settlement,
    });
  });

  it("recovers stored bundle bytes from a v2 settlement without a target command", async () => {
    const collect = vi.fn();
    const bundle = { bundleDigest: DIGEST, privateBytes: "durable-returned" };
    const verification = {
      verificationDigest: `sha256:${"d".repeat(64)}`,
      applied: false,
    };
    const recovered = {
      schema:
        "chainlesschain.session-execution-location-result-collection-receipt/v2",
      sessionId: "session-command-1",
      requestId: "collect-request-stored-retry",
      requestDigest: DIGEST,
      resultId: "result-2",
      handoffId: `sha256:${"4".repeat(64)}`,
      sourceHeadHash: HEAD_HASH,
      sourceEventCount: 5,
      bundleDigest: DIGEST,
      verificationDigest: verification.verificationDigest,
      receiptDigest: `sha256:${"e".repeat(64)}`,
      storage: { receiptDigest: `sha256:${"f".repeat(64)}` },
      applied: false,
    };
    await program(
      dependencies({
        createExecutionLocationTargetResultCollectionRequest: () => ({
          requestId: recovered.requestId,
          requestDigest: DIGEST,
        }),
        readVerifiedSessionExecutionLocationResultSettlement: () => recovered,
        readStoredExecutionLocationResultBundle: () => bundle,
        verifyExecutionLocationResultBundle: () => verification,
        collectExecutionLocationTargetResult: collect,
      }),
    ).parseAsync([
      "node",
      "cc",
      "session",
      "location",
      "result-collect",
      "session-command-1",
      "ssh",
      "--facts",
      "facts.json",
      "--profile",
      "profile.json",
      "--expected-target-facts-digest",
      DIGEST,
      "--expected-handoff-id",
      recovered.handoffId,
      "--request-id",
      recovered.requestId,
      "--result-id",
      "result-2",
      "--summary",
      "summary.txt",
      "--diff",
      "result.diff",
      "--json",
    ]);

    expect(process.exitCode).toBe(0);
    expect(collect).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.mock.calls.at(-1)[0])).toEqual({
      ...recovered,
      settlementAppended: false,
      recovered: true,
      bundleAvailable: true,
      bundle,
      verification,
    });
  });

  it("recovers a canonical collection settlement without rerunning target collection", async () => {
    const collect = vi.fn();
    const recovered = {
      schema:
        "chainlesschain.session-execution-location-result-collection-receipt/v1",
      sessionId: "session-command-1",
      requestId: "collect-request-retry",
      requestDigest: DIGEST,
      resultId: "result-2",
      receiptDigest: `sha256:${"e".repeat(64)}`,
      applied: false,
    };
    await program(
      dependencies({
        createExecutionLocationTargetResultCollectionRequest: () => ({
          requestId: "collect-request-retry",
          requestDigest: DIGEST,
        }),
        readVerifiedSessionExecutionLocationResultSettlement: () => recovered,
        collectExecutionLocationTargetResult: collect,
      }),
    ).parseAsync([
      "node",
      "cc",
      "session",
      "location",
      "result-collect",
      "session-command-1",
      "ssh",
      "--facts",
      "facts.json",
      "--profile",
      "profile.json",
      "--expected-target-facts-digest",
      DIGEST,
      "--expected-handoff-id",
      `sha256:${"4".repeat(64)}`,
      "--request-id",
      "collect-request-retry",
      "--result-id",
      "result-2",
      "--summary",
      "summary.txt",
      "--diff",
      "result.diff",
      "--json",
    ]);

    expect(process.exitCode).toBe(0);
    expect(collect).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.mock.calls.at(-1)[0])).toEqual({
      ...recovered,
      settlementAppended: false,
      recovered: true,
      bundleAvailable: false,
    });
  });

  it("routes stored result review without printing returned content", async () => {
    const storage = { receiptDigest: `sha256:${"f".repeat(64)}` };
    const settlement = {
      schema:
        "chainlesschain.session-execution-location-result-collection-receipt/v2",
      requestId: "review-request-1",
      resultId: "review-result-1",
      storage,
    };
    const bundle = {
      bundleDigest: DIGEST,
      privateBytes: "private returned bytes",
    };
    const review = {
      schema: "cc-execution-location-result-review/v1",
      resultId: "review-result-1",
      reviewDigest: `sha256:${"6".repeat(64)}`,
      bundleDigest: DIGEST,
      summary: { byteLength: 21, digest: `sha256:${"7".repeat(64)}` },
      diff: { byteLength: 31, digest: `sha256:${"8".repeat(64)}` },
      applied: false,
    };
    const readStored = vi.fn(() => bundle);
    const createReview = vi.fn(() => review);

    await program(
      dependencies({
        readVerifiedSessionExecutionLocationResultSettlement: () => settlement,
        readStoredExecutionLocationResultBundle: readStored,
        createExecutionLocationResultReview: createReview,
      }),
    ).parseAsync([
      "node",
      "cc",
      "session",
      "location",
      "result-review",
      "session-command-1",
      "--request-id",
      "review-request-1",
    ]);

    expect(process.exitCode).toBe(0);
    expect(readStored).toHaveBeenCalledWith(storage, {});
    expect(createReview).toHaveBeenCalledWith({ settlement, bundle });
    const output = stdout.mock.calls.at(-1)[0];
    expect(output).toContain(`Review: ${review.reviewDigest}`);
    expect(output).toContain("Applied: no");
    expect(output).not.toContain("private returned bytes");
  });

  it("fails closed when a legacy settlement has no stored bundle to review", async () => {
    await program(
      dependencies({
        readVerifiedSessionExecutionLocationResultSettlement: () => ({
          schema:
            "chainlesschain.session-execution-location-result-collection-receipt/v1",
          requestId: "legacy-review-request",
          resultId: "legacy-result",
        }),
      }),
    ).parseAsync([
      "node",
      "cc",
      "session",
      "location",
      "result-review",
      "session-command-1",
      "--request-id",
      "legacy-review-request",
    ]);

    expect(process.exitCode).toBe(1);
    expect(stderr.mock.calls.at(-1)[0]).toMatch(/no durable bundle/u);
    expect(stdout).not.toHaveBeenCalled();
  });

  it("streams only the explicitly selected item bound to the review digest", async () => {
    const reviewDigest = `sha256:${"4".repeat(64)}`;
    const content = Buffer.from("private reviewed summary\n", "utf8");
    const record = {
      mediaType: "text/plain",
      byteLength: content.byteLength,
      digest: `sha256:${"5".repeat(64)}`,
      contentBase64: content.toString("base64"),
    };
    await program(
      dependencies({
        readVerifiedSessionExecutionLocationResultSettlement: () => ({
          schema:
            "chainlesschain.session-execution-location-result-collection-receipt/v2",
          requestId: "preview-request-1",
          storage: {},
        }),
        readStoredExecutionLocationResultBundle: () => ({
          summary: record,
          diff: record,
          artifacts: [],
          evidence: [],
        }),
        createExecutionLocationResultReview: () => ({
          reviewDigest,
          summary: {
            mediaType: record.mediaType,
            byteLength: record.byteLength,
            digest: record.digest,
          },
        }),
      }),
    ).parseAsync([
      "node",
      "cc",
      "session",
      "location",
      "result-preview",
      "session-command-1",
      "--request-id",
      "preview-request-1",
      "--review-digest",
      reviewDigest,
      "--item",
      "summary",
    ]);

    expect(process.exitCode).toBe(0);
    expect(stdout.mock.calls.at(-1)[0]).toEqual(content);
  });

  it("rejects preview drift before writing content", async () => {
    await program(
      dependencies({
        readVerifiedSessionExecutionLocationResultSettlement: () => ({
          schema:
            "chainlesschain.session-execution-location-result-collection-receipt/v2",
          requestId: "preview-drift-request",
          storage: {},
        }),
        readStoredExecutionLocationResultBundle: () => ({
          summary: {},
          diff: {},
          artifacts: [],
          evidence: [],
        }),
        createExecutionLocationResultReview: () => ({
          reviewDigest: `sha256:${"1".repeat(64)}`,
        }),
      }),
    ).parseAsync([
      "node",
      "cc",
      "session",
      "location",
      "result-preview",
      "session-command-1",
      "--request-id",
      "preview-drift-request",
      "--review-digest",
      `sha256:${"2".repeat(64)}`,
      "--item",
      "summary",
    ]);

    expect(process.exitCode).toBe(1);
    expect(stderr.mock.calls.at(-1)[0]).toMatch(/review digest/u);
    expect(stdout).not.toHaveBeenCalled();
  });

  it("imports only the reviewed item and emits a content-free ArtifactStore receipt", async () => {
    const reviewDigest = `sha256:${"4".repeat(64)}`;
    const content = Buffer.from("private reviewed artifact bytes\n", "utf8");
    const record = {
      mediaType: "application/octet-stream",
      byteLength: content.byteLength,
      digest: `sha256:${"5".repeat(64)}`,
      contentBase64: content.toString("base64"),
    };
    const importArtifact = vi.fn(() => ({
      schema: "cc-execution-location-result-artifact-import/v1",
      importDigest: `sha256:${"6".repeat(64)}`,
      source: {
        schema: "cc-execution-location-result-artifact-lineage/v1",
        sessionId: "session-command-1",
        requestId: "import-request-1",
        reviewDigest,
        item: `artifact:${record.digest}`,
        kind: "artifact",
        mediaType: record.mediaType,
        byteLength: record.byteLength,
        sourceDigest: record.digest,
      },
      artifact: {
        id: "art_imported",
        size: record.byteLength,
      },
      retention: "artifact-store-ttl-explicit-delete-not-worm",
      receiptDigest: `sha256:${"7".repeat(64)}`,
      imported: true,
    }));
    const artifactStore = { marker: "injected-store" };

    await program(
      dependencies({
        readVerifiedSessionExecutionLocationResultSettlement: () => ({
          schema:
            "chainlesschain.session-execution-location-result-collection-receipt/v2",
          requestId: "import-request-1",
          storage: {},
        }),
        readStoredExecutionLocationResultBundle: () => ({
          summary: record,
          diff: record,
          artifacts: [record],
          evidence: [],
        }),
        createExecutionLocationResultReview: () => ({
          reviewDigest,
          artifacts: [
            {
              mediaType: record.mediaType,
              byteLength: record.byteLength,
              digest: record.digest,
            },
          ],
        }),
        importExecutionLocationResultArtifact: importArtifact,
        artifactStore,
      }),
    ).parseAsync([
      "node",
      "cc",
      "session",
      "location",
      "result-import",
      "session-command-1",
      "--request-id",
      "import-request-1",
      "--review-digest",
      reviewDigest,
      "--item",
      `artifact:${record.digest}`,
      "--json",
    ]);

    expect(process.exitCode).toBe(0);
    expect(importArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-command-1",
        requestId: "import-request-1",
        reviewDigest,
        item: `artifact:${record.digest}`,
        bytes: content,
      }),
      { artifactStore },
    );
    const output = stdout.mock.calls.at(-1)[0];
    expect(JSON.parse(output)).toMatchObject({
      schema: "cc-execution-location-result-artifact-import/v1",
      imported: true,
      artifact: { id: "art_imported" },
    });
    expect(output).not.toContain("private reviewed artifact bytes");
  });

  it("escapes terminal controls and requires redirection for binary items", () => {
    const writes = [];
    const output = { write: (value) => writes.push(value), isTTY: true };
    writeSessionExecutionLocationResultPreview(
      {
        kind: "summary",
        bytes: Buffer.from("safe\u001b[31m\u202eevil", "utf8"),
      },
      { stdout: output },
    );
    expect(writes).toEqual(["safe\\x1b[31m\\u202eevil"]);
    expect(() =>
      writeSessionExecutionLocationResultPreview(
        { kind: "artifact", bytes: Buffer.from([0, 1, 2]) },
        { stdout: output },
      ),
    ).toThrow(/redirected stdout/u);
  });

  it("routes reviewed result apply through reservation and terminal settlement", async () => {
    const reviewDigest = `sha256:${"6".repeat(64)}`;
    const settlement = {
      schema:
        "chainlesschain.session-execution-location-result-collection-receipt/v2",
      requestId: "apply-collect-request",
      settlementEventHash: HEAD_HASH,
      settlementEventCount: 5,
      storage: { receiptDigest: `sha256:${"7".repeat(64)}` },
    };
    const bundle = {
      diff: {
        contentBase64: Buffer.from("private apply patch").toString("base64"),
      },
    };
    const review = {
      schema: "cc-execution-location-result-review/v1",
      requestId: settlement.requestId,
      reviewDigest,
    };
    const source = {
      workspaceRoot: "/source/repo",
      sourceGit: {
        rootDigest: `sha256:${"8".repeat(64)}`,
        commit: COMMIT,
      },
    };
    const prepared = {
      id: "result-apply-transaction",
      checkpointId: "checkpoint-result-apply-transaction",
      checkpointDigest: `sha256:${"9".repeat(64)}`,
      coverage: "partial",
      externalSideEffects: false,
    };
    const terminalTransaction = {
      ...prepared,
      evidenceDigest: `sha256:${"a".repeat(64)}`,
      writeManifestDigest: `sha256:${"b".repeat(64)}`,
      fileCoverage: "partial",
      uncoveredPaths: [".git"],
    };
    const reserve = vi.fn();
    const verifySource = vi.fn(() => source);
    const execute = vi.fn((input) => {
      input.onPrepared(prepared);
      return {
        ok: true,
        outcome: "applied",
        stage: "complete",
        transaction: terminalTransaction,
        process: {
          exitCode: 0,
          signal: null,
          stdoutBytes: 0,
          stderrBytes: 0,
          errorCode: null,
        },
      };
    });
    const applyReceipt = {
      schema:
        "chainlesschain.session-execution-location-result-apply-receipt/v1",
      applyId: "apply-command-1",
      requestId: settlement.requestId,
      reviewDigest,
      transaction: terminalTransaction,
      terminal: { outcome: "applied" },
      status: "applied",
      applied: true,
    };
    const settle = vi.fn(() => applyReceipt);

    await program(
      dependencies({
        readVerifiedSessionExecutionLocationResultSettlement: () => settlement,
        readStoredExecutionLocationResultBundle: () => bundle,
        createExecutionLocationResultReview: () => review,
        readVerifiedSessionExecutionLocationResultApply: () => null,
        verifyExecutionLocationResultApplySourceGit: verifySource,
        executeControlledExecutionLocationResultApply: execute,
        reserveSessionExecutionLocationResultApply: reserve,
        settleSessionExecutionLocationResultApply: settle,
        executionBroker: {},
      }),
    ).parseAsync([
      "node",
      "cc",
      "session",
      "location",
      "result-apply",
      "session-command-1",
      "--request-id",
      settlement.requestId,
      "--apply-id",
      "apply-command-1",
      "--review-digest",
      reviewDigest,
      "--json",
    ]);

    expect(process.exitCode).toBe(0);
    expect(verifySource).toHaveBeenCalledTimes(2);
    expect(reserve).toHaveBeenCalledWith(
      "session-command-1",
      "apply-command-1",
      review,
      source.sourceGit,
      prepared,
    );
    expect(execute.mock.calls[0][0].diffBytes).toEqual(
      Buffer.from("private apply patch"),
    );
    expect(settle).toHaveBeenCalledWith(
      "session-command-1",
      "apply-command-1",
      "applied",
      terminalTransaction,
    );
    const output = JSON.parse(stdout.mock.calls.at(-1)[0]);
    expect(output).toMatchObject({
      ...applyReceipt,
      recovered: false,
      allowed: true,
      stage: "complete",
    });
    expect(JSON.stringify(output)).not.toContain("private apply patch");
  });

  it("rejects result apply before a transaction when the review digest drifts", async () => {
    const execute = vi.fn();
    await program(
      dependencies({
        readVerifiedSessionExecutionLocationResultSettlement: () => ({
          schema:
            "chainlesschain.session-execution-location-result-collection-receipt/v2",
          requestId: "apply-review-drift",
          storage: {},
        }),
        readStoredExecutionLocationResultBundle: () => ({ diff: {} }),
        createExecutionLocationResultReview: () => ({
          reviewDigest: `sha256:${"1".repeat(64)}`,
        }),
        executeControlledExecutionLocationResultApply: execute,
      }),
    ).parseAsync([
      "node",
      "cc",
      "session",
      "location",
      "result-apply",
      "session-command-1",
      "--request-id",
      "apply-review-drift",
      "--apply-id",
      "apply-drift-1",
      "--review-digest",
      `sha256:${"2".repeat(64)}`,
    ]);

    expect(process.exitCode).toBe(1);
    expect(stderr.mock.calls.at(-1)[0]).toMatch(/review digest/u);
    expect(execute).not.toHaveBeenCalled();
  });

  it("explicitly recovers only the reserved apply transaction without replay", async () => {
    const reviewDigest = `sha256:${"3".repeat(64)}`;
    const transactionId = "result-apply-recovery-1";
    const prior = {
      schema:
        "chainlesschain.session-execution-location-result-apply-receipt/v1",
      requestId: "apply-recovery-request",
      applyId: "apply-recovery-1",
      reviewDigest,
      transaction: { id: transactionId },
      terminal: null,
      applied: false,
    };
    const terminalTransaction = {
      id: transactionId,
      checkpointId: "checkpoint-result-apply-recovery-1",
      checkpointDigest: `sha256:${"4".repeat(64)}`,
      evidenceDigest: `sha256:${"5".repeat(64)}`,
      writeManifestDigest: `sha256:${"6".repeat(64)}`,
      coverage: "partial",
      fileCoverage: "partial",
      externalSideEffects: false,
      uncoveredPaths: [".git"],
    };
    const terminalState = {
      state: "rolled_back",
      evidence: {},
    };
    const inspect = vi
      .fn()
      .mockReturnValueOnce({ state: "running" })
      .mockReturnValueOnce(terminalState);
    const recover = vi.fn(() => [{ id: transactionId, status: "rolled_back" }]);
    const settle = vi.fn(() => ({
      ...prior,
      transaction: terminalTransaction,
      terminal: { outcome: "rolled_back" },
      status: "rolled_back",
      applied: false,
    }));
    const broker = {
      inspectWorkspaceTransaction: inspect,
      recoverWorkspaceTransactions: recover,
    };

    await program(
      dependencies({
        readVerifiedSessionExecutionLocationResultSettlement: () => ({
          schema:
            "chainlesschain.session-execution-location-result-collection-receipt/v2",
          requestId: prior.requestId,
          storage: {},
        }),
        readStoredExecutionLocationResultBundle: () => ({ diff: {} }),
        createExecutionLocationResultReview: () => ({ reviewDigest }),
        readVerifiedSessionExecutionLocationResultApply: () => prior,
        verifyExecutionLocationResultApplySourceGit: () => ({
          workspaceRoot: "/source/repo",
          sourceGit: {},
        }),
        terminalExecutionLocationResultApplyTransaction: () =>
          terminalTransaction,
        settleSessionExecutionLocationResultApply: settle,
        executionBroker: broker,
      }),
    ).parseAsync([
      "node",
      "cc",
      "session",
      "location",
      "result-apply-recover",
      "session-command-1",
      "--request-id",
      prior.requestId,
      "--apply-id",
      prior.applyId,
      "--review-digest",
      reviewDigest,
      "--json",
    ]);

    expect(process.exitCode).toBe(2);
    expect(recover).toHaveBeenCalledWith({
      id: transactionId,
      workspaceRoot: "/source/repo",
      reason: "explicit session result apply recovery",
    });
    expect(settle).toHaveBeenCalledWith(
      "session-command-1",
      prior.applyId,
      "rolled_back",
      terminalTransaction,
    );
    expect(JSON.parse(stdout.mock.calls.at(-1)[0])).toMatchObject({
      status: "rolled_back",
      applied: false,
      allowed: false,
      recovered: true,
      stage: "recovery",
    });
  });
});
