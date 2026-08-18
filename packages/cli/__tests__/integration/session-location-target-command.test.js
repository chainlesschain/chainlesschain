import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSessionLocationSubcommands } from "../../src/commands/session-location.js";
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
        artifacts: [
          expect.objectContaining({ mediaType: "application/json" }),
        ],
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
    const receipt = {
      schema: "cc-execution-location-target-result-collection/v1",
      requestId: "collect-request-2",
      requestDigest: DIGEST,
      resultId: "result-2",
      bundleDigest: DIGEST,
      collectionDigest: `sha256:${"d".repeat(64)}`,
      applied: false,
      gaps: ["returned-result-not-applied"],
    };
    const settlement = {
      schema:
        "chainlesschain.session-execution-location-result-collection-receipt/v1",
      requestId: "collect-request-2",
      receiptDigest: `sha256:${"e".repeat(64)}`,
    };
    const collect = vi.fn(() => receipt);
    await program(
      dependencies({
        createExecutionLocationTargetResultCollectionRequest: () => ({
          requestId: "collect-request-2",
          requestDigest: DIGEST,
        }),
        readVerifiedSessionExecutionLocationResultSettlement: () => null,
        collectExecutionLocationTargetResult: collect,
        settleSessionExecutionLocationResultCollection: vi.fn(
          () => settlement,
        ),
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
        artifacts: [
          { mediaType: "application/json", path: "artifact.json" },
        ],
      }),
      expect.any(Object),
    );
    expect(JSON.parse(stdout.mock.calls.at(-1)[0])).toEqual({
      ...receipt,
      settlement,
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
});
